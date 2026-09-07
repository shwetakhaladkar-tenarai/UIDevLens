"""
responsive/cross_browser_validator.py
Real cross-browser validation using Playwright Python across Chromium,
Firefox, and WebKit. Which engines run is driven entirely by the selected
rule profile's `browsers` array (common/config.py's EngineConfig.browsers) —
never hardcoded here.

For each browser this module independently launches, navigates, and
collects: page load status, console errors, failed requests, DOM
dimensions, visible interactive elements, a screenshot, horizontal
overflow, clipped content, obvious element overlap, and JS/runtime errors.

Two kinds of findings are produced, deliberately kept separate so ordinary
rendering variance is never reported as a failure:

  1. Per-browser facts (page load errors, HTTP errors, console/runtime
     errors, failed requests) — reported for whichever browser(s) actually
     exhibit them. If every browser shares the same issue, every browser's
     findings will say so; if only one does, only that one will — the
     returned per-browser structure IS the comparison for these.

  2. Comparison-only findings (missing/hidden controls, horizontal overflow,
     clipped content, overlaps, gross layout-size divergence) — these are
     NOT inherently bugs in isolation (a page can legitimately overflow in
     every browser; that's a design issue, not a cross-browser one). They
     are only raised when browsers DISAGREE, diffed against a Chromium
     baseline (or the first tested browser, if Chromium wasn't requested).

Returns exactly:
  {"chromium": {"status": "pass"|"issues"|"error", "findings": [...]}, ...}
(each browser's object also carries screenshot/dimensions/summary counts —
additive, see build_browser_comparison()).
"""

from __future__ import annotations

import base64

from common.logger import get_logger
from common.models import ValidationResult, mock_result

log = get_logger("python-validation.responsive.cross_browser")

try:
    from playwright.sync_api import sync_playwright

    _PLAYWRIGHT_IMPORT_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001 — Playwright not installed
    sync_playwright = None  # type: ignore[assignment]
    _PLAYWRIGHT_IMPORT_ERROR = str(exc)

VALID_BROWSERS = ("chromium", "firefox", "webkit")
DEFAULT_BROWSERS = ("chromium",)

MAX_FINDINGS_PER_KIND = 10
# Layout height must differ by more than this fraction from the reference
# browser before it's worth a (low-confidence, low-severity) mention —
# ordinary font/scrollbar rendering differences stay well under this.
LAYOUT_HEIGHT_DIVERGENCE_THRESHOLD = 0.20

_COLLECT_JS = """
() => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0;
  };
  const selectorFor = (el) => {
    if (el.id) return '#' + el.id;
    const cls = (el.className || '').toString().trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };

  const docW = Math.max(document.body?.scrollWidth || 0, document.documentElement?.scrollWidth || 0);
  const docH = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="link"]';
  const interactiveElements = Array.from(document.querySelectorAll(INTERACTIVE))
    .slice(0, 80)
    .map((el) => ({
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60),
      visible: isVisible(el),
    }));

  const clippedElements = [];
  document.querySelectorAll('div,section,article,aside,td,li').forEach((el) => {
    if (clippedElements.length >= 15 || !isVisible(el)) return;
    try {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && cs.overflow === 'hidden') {
        clippedElements.push({ selector: selectorFor(el), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight });
      }
    } catch (e) { /* ignore */ }
  });

  const overlaps = [];
  const siblings = Array.from(document.querySelectorAll('body > * > *')).slice(0, 60);
  for (let i = 0; i < siblings.length && overlaps.length < 10; i++) {
    for (let j = i + 1; j < siblings.length && overlaps.length < 10; j++) {
      try {
        const a = siblings[i].getBoundingClientRect();
        const b = siblings[j].getBoundingClientRect();
        if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 4 && overlapY > 4) {
          overlaps.push({ elementA: selectorFor(siblings[i]), elementB: selectorFor(siblings[j]) });
        }
      } catch (e) { /* ignore */ }
    }
  }

  return {
    title: document.title,
    documentDimensions: { width: docW, height: docH },
    viewport: { width: viewportW, height: viewportH },
    hasHorizontalOverflow: docW > viewportW + 2,
    overflowAmount: Math.max(0, docW - viewportW),
    interactiveElements,
    clippedElements,
    overlaps,
  };
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Finding helper
# ─────────────────────────────────────────────────────────────────────────────

def _finding(finding_id: str, rule: str, severity: str, description: str,
             recommendation: str, evidence: dict, confidence: float) -> dict:
    return {
        "id": finding_id,
        # Category "responsive" (not a separate "cross_browser" bucket) —
        # matches the Category enum used across this engine and the Node
        # normalizer's known category buckets.
        "category": "responsive",
        "severity": severity,
        "title": rule,
        "description": description,
        "recommendation": recommendation,
        "evidence": evidence,
        "confidence": confidence,
        "source": "python-cross-browser",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Per-browser evidence collection
# ─────────────────────────────────────────────────────────────────────────────

def _collect_for_browser(playwright, browser_name: str, url: str, config) -> dict:
    """Launch ONE browser engine, navigate once, and collect all evidence."""
    evidence: dict = {"browser": browser_name}
    browser = None
    try:
        launcher = getattr(playwright, browser_name)
        browser = launcher.launch(headless=True)
        context = browser.new_context(
            viewport={"width": config.viewport_width, "height": config.viewport_height},
            ignore_https_errors=True,
        )
        page = context.new_page()

        console_messages: list[dict] = []
        page_errors: list[str] = []
        network_log: list[dict] = []

        page.on("dialog", lambda d: d.dismiss())
        page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        def _on_response(response):
            try:
                req = response.request
                network_log.append({
                    "url": response.url, "status": response.status, "ok": response.ok,
                    "resourceType": req.resource_type, "failure": None,
                })
            except Exception:  # noqa: BLE001
                pass

        def _on_request_failed(request):
            try:
                network_log.append({
                    "url": request.url, "status": None, "ok": False,
                    "resourceType": request.resource_type, "failure": request.failure or "unknown failure",
                })
            except Exception:  # noqa: BLE001
                pass

        page.on("response", _on_response)
        page.on("requestfailed", _on_request_failed)

        nav_status = None
        nav_error = None
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=config.timeout_ms)
            page.wait_for_timeout(800)
            if resp is not None:
                nav_status = resp.status
        except Exception as exc:  # noqa: BLE001
            nav_error = str(exc)

        dom = {}
        screenshot_b64 = None
        if nav_error is None:
            try:
                dom = page.evaluate(_COLLECT_JS)
            except Exception as exc:  # noqa: BLE001
                dom = {"error": str(exc)}
            try:
                screenshot_bytes = page.screenshot(type="jpeg", quality=40, full_page=False, timeout=5000)
                screenshot_b64 = base64.b64encode(screenshot_bytes).decode("ascii")
            except Exception:  # noqa: BLE001
                screenshot_b64 = None

        context.close()

        evidence.update({
            "navStatus": nav_status,
            "navError": nav_error,
            "consoleErrors": [m["text"] for m in console_messages if m["type"] == "error"],
            "pageErrors": page_errors,
            "failedRequests": [n for n in network_log if not n["ok"]],
            "dom": dom,
            "screenshot": screenshot_b64,
        })

    except Exception as exc:  # noqa: BLE001 — could not even launch this browser
        evidence["launchError"] = str(exc)
    finally:
        try:
            if browser:
                browser.close()
        except Exception:  # noqa: BLE001
            pass

    return evidence


# ─────────────────────────────────────────────────────────────────────────────
# Per-browser absolute findings (page load, errors, failed requests)
# ─────────────────────────────────────────────────────────────────────────────

def _own_findings(browser_name: str, ev: dict, ref_name: str, ref_ev: dict) -> list[dict]:
    findings: list[dict] = []
    counter = [0]

    def add(rule, severity, description, recommendation, evidence, confidence):
        counter[0] += 1
        findings.append(_finding(f"cross-browser-{browser_name}-{counter[0]}", rule, severity, description, recommendation, evidence, confidence))

    if ev.get("launchError"):
        add(
            "Browser launch failed", "high",
            f'Could not launch {browser_name}: {ev["launchError"]}',
            f'Verify the {browser_name} Playwright browser binary is installed ("playwright install {browser_name}").',
            {"error": ev["launchError"]}, 0.9,
        )
        return findings

    if ev.get("navError"):
        is_only_here = browser_name != ref_name and not ref_ev.get("navError")
        suffix = f" (navigation succeeded in {ref_name})" if is_only_here else ""
        add(
            "Page failed to load", "high",
            f'Navigation to the page failed in {browser_name}: {ev["navError"]}{suffix}',
            "Check server availability, timeouts, and browser-specific navigation/TLS behavior.",
            {"error": ev["navError"]}, 0.85,
        )
        return findings  # nothing else is checkable if the page never loaded

    if (ev.get("navStatus") or 200) >= 400:
        ref_ok = ref_ev and (ref_ev.get("navStatus") or 200) < 400 and not ref_ev.get("navError")
        suffix = f" (loaded successfully in {ref_name} with HTTP {ref_ev.get('navStatus')})" if browser_name != ref_name and ref_ok else ""
        add(
            "Page returned an HTTP error", "high",
            f'The page responded with HTTP {ev["navStatus"]} in {browser_name}{suffix}.',
            "Investigate why this route errors in this browser and fix the underlying issue.",
            {"status": ev["navStatus"]}, 0.9,
        )

    ref_errors = set(ref_ev.get("pageErrors", [])) if ref_ev else set()
    for err in ev.get("pageErrors", [])[:MAX_FINDINGS_PER_KIND]:
        only_here = browser_name != ref_name and err not in ref_errors
        suffix = f" (does not occur in {ref_name})" if only_here else ""
        add(
            "Uncaught JavaScript exception", "high",
            f'An uncaught exception occurred in {browser_name}{suffix}: "{err[:200]}"',
            "Fix the uncaught exception; it likely breaks functionality for users of this browser.",
            {"error": err}, 0.85,
        )

    for msg in ev.get("consoleErrors", [])[:MAX_FINDINGS_PER_KIND]:
        add(
            "JavaScript console error", "medium",
            f'{browser_name} logged a console error: "{msg[:200]}"',
            "Investigate and fix the source of this console error.",
            {"message": msg}, 0.75,
        )

    for req in ev.get("failedRequests", [])[:MAX_FINDINGS_PER_KIND]:
        is_critical = req.get("resourceType") in ("document", "xhr", "fetch")
        add(
            "Failed network request" if req.get("failure") else "HTTP error response",
            "high" if is_critical else "medium",
            f'A {req.get("resourceType")} request to {req.get("url")} '
            + (f'failed: {req["failure"]}' if req.get("failure") else f'returned HTTP {req.get("status")}')
            + f' in {browser_name}.',
            "Fix or remove this request; a failing network call can break the feature that depends on it.",
            req, 0.8,
        )

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Comparison-only findings (only raised when browsers DISAGREE)
# ─────────────────────────────────────────────────────────────────────────────

def _diff_findings(browser_name: str, ev: dict, ref_name: str, ref_ev: dict) -> list[dict]:
    """
    Findings that only make sense as a COMPARISON — a page that overflows
    (or has clipped/overlapping content) identically in every browser has a
    responsive-design problem, not a cross-browser one; that's out of scope
    here. Only genuine disagreement with the reference browser is reported.
    """
    if browser_name == ref_name:
        return []
    # Nothing meaningful to compare if either side never loaded.
    if ev.get("navError") or ref_ev.get("navError") or ev.get("launchError") or ref_ev.get("launchError"):
        return []

    findings: list[dict] = []
    counter = [0]

    def add(rule, severity, description, recommendation, evidence, confidence):
        counter[0] += 1
        findings.append(_finding(f"cross-browser-diff-{browser_name}-{counter[0]}", rule, severity, description, recommendation, evidence, confidence))

    dom = ev.get("dom") or {}
    ref_dom = ref_ev.get("dom") or {}

    # Horizontal overflow only in this browser
    if dom.get("hasHorizontalOverflow") and not ref_dom.get("hasHorizontalOverflow"):
        add(
            "Browser-specific horizontal overflow", "medium",
            f'Horizontal overflow only appears in {browser_name} (not in {ref_name}).',
            f"Investigate why layout width differs from {ref_name} — check for browser-specific CSS behavior (flex/grid sizing, scrollbar width, min-width).",
            {"referenceBrowser": ref_name, "overflowAmount": dom.get("overflowAmount")}, 0.7,
        )

    # Missing/hidden controls: visible in reference, not visible here
    ref_controls = {(c["selector"], c["tag"]): c["visible"] for c in ref_dom.get("interactiveElements", [])}
    this_controls = {(c["selector"], c["tag"]): c["visible"] for c in dom.get("interactiveElements", [])}
    reported = 0
    for (selector, tag), ref_visible in ref_controls.items():
        if not ref_visible or reported >= MAX_FINDINGS_PER_KIND:
            continue
        if not this_controls.get((selector, tag), False):
            reported += 1
            add(
                "Control missing or hidden in this browser", "high",
                f'Control ({selector}) is visible in {ref_name} but missing/hidden in {browser_name}.',
                f"Check for {browser_name}-specific CSS/feature-detection issues hiding this control (e.g. an unsupported CSS property or a failed script).",
                {"referenceBrowser": ref_name, "selector": selector, "tag": tag}, 0.65,
            )

    # Clipped content only in this browser
    ref_clipped = {c["selector"] for c in ref_dom.get("clippedElements", [])}
    this_clipped = {c["selector"] for c in dom.get("clippedElements", [])}
    for selector in list(this_clipped - ref_clipped)[:MAX_FINDINGS_PER_KIND]:
        add(
            "Browser-specific clipped content", "medium",
            f'Content is clipped in {browser_name} ({selector}) but not in {ref_name}.',
            "Check for browser-specific box-sizing/line-height/overflow differences causing this element to clip its content.",
            {"referenceBrowser": ref_name, "selector": selector}, 0.6,
        )

    # More overlapping elements here than in the reference
    ref_overlap_count = len(ref_dom.get("overlaps", []))
    this_overlaps = dom.get("overlaps", [])
    if len(this_overlaps) > ref_overlap_count:
        add(
            "Browser-specific element overlap", "medium",
            f'{len(this_overlaps)} overlapping element pair(s) detected in {browser_name} vs {ref_overlap_count} in {ref_name}.',
            "Check for browser-specific layout/positioning differences (flex/grid gap handling, absolute positioning) causing elements to overlap.",
            {"referenceBrowser": ref_name, "overlaps": this_overlaps[:5]}, 0.55,
        )

    # Grossly different content height — conservative threshold so ordinary
    # font-metric/scrollbar rendering differences are never flagged.
    ref_h = (ref_dom.get("documentDimensions") or {}).get("height") or 0
    this_h = (dom.get("documentDimensions") or {}).get("height") or 0
    if ref_h > 0 and this_h > 0:
        rel_diff = abs(this_h - ref_h) / ref_h
        if rel_diff > LAYOUT_HEIGHT_DIVERGENCE_THRESHOLD:
            add(
                "Significant layout height difference", "low",
                f'Page content height differs significantly between {ref_name} ({ref_h}px) and {browser_name} ({this_h}px) — {rel_diff:.0%} difference.',
                "Investigate the layout for browser-specific rendering causing significantly more/less content height.",
                {"referenceBrowser": ref_name, "referenceHeight": ref_h, "height": this_h}, 0.4,
            )

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def build_browser_comparison(url: str, browsers: tuple[str, ...], config, playwright) -> dict:
    """
    Launch each requested browser, collect evidence, diff against a
    reference (Chromium if present, else the first browser tested), and
    return exactly:
      {"<browser>": {"status": "pass"|"issues"|"error", "findings": [...],
                      "screenshot": "<base64 jpeg>"|None,
                      "pageLoadStatus": int|None,
                      "domDimensions": {...}, "interactiveElementCount": int,
                      "consoleErrorCount": int, "failedRequestCount": int}}

    `playwright` must be an ALREADY-STARTED driver connection (Playwright's
    sync API allows only one per process) — see validate() for how it's
    obtained.
    """
    browsers = tuple(dict.fromkeys(b for b in browsers if b in VALID_BROWSERS)) or DEFAULT_BROWSERS

    evidence_by_browser: dict[str, dict] = {}
    for name in browsers:
        log.info("Collecting cross-browser evidence: %s for %s", name, url)
        evidence_by_browser[name] = _collect_for_browser(playwright, name, url, config)

    ref_name = "chromium" if "chromium" in evidence_by_browser else next(iter(evidence_by_browser))

    comparison: dict[str, dict] = {}
    for name, ev in evidence_by_browser.items():
        ref_ev = evidence_by_browser[ref_name]
        findings = _own_findings(name, ev, ref_name, ref_ev) + _diff_findings(name, ev, ref_name, ref_ev)

        dom = ev.get("dom") or {}
        status = "error" if ev.get("launchError") or ev.get("navError") else ("issues" if findings else "pass")

        comparison[name] = {
            "status": status,
            "findings": findings,
            "screenshot": ev.get("screenshot"),
            "pageLoadStatus": ev.get("navStatus"),
            "domDimensions": dom.get("documentDimensions") or {},
            "interactiveElementCount": len(dom.get("interactiveElements", [])),
            "consoleErrorCount": len(ev.get("consoleErrors", [])),
            "failedRequestCount": len(ev.get("failedRequests", [])),
        }

    return comparison


def validate(url: str, session=None, config=None, **_kwargs) -> ValidationResult:
    if sync_playwright is None:
        return mock_result(
            check="cross_browser",
            source="cross_browser_validator",
            category="responsive",
            title="Cross-browser validation (mocked)",
            description=f"Would compare rendering of {url} across configured browsers ({_PLAYWRIGHT_IMPORT_ERROR}).",
            metrics={"mocked": True},
        )

    browsers = tuple(getattr(config, "browsers", DEFAULT_BROWSERS)) if config is not None else DEFAULT_BROWSERS
    if not browsers:
        browsers = DEFAULT_BROWSERS

    # Playwright's sync API allows only ONE driver connection per process.
    # If the shared session (functional/accessibility) already started one,
    # reuse it — starting a second independent one here would raise
    # "using Playwright Sync API inside the asyncio loop". Only start our
    # own when the shared session isn't running one (e.g. cross_browser was
    # requested without functional/accessibility).
    shared_playwright = getattr(session, "playwright", None) if session is not None and not getattr(session, "mocked", True) else None

    try:
        if shared_playwright is not None:
            comparison = build_browser_comparison(url, browsers, config, shared_playwright)
        else:
            with sync_playwright() as playwright:
                comparison = build_browser_comparison(url, browsers, config, playwright)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="cross_browser", errors=[f"cross_browser_validator: failed to run comparison: {exc}"])

    all_findings: list[dict] = []
    for result in comparison.values():
        all_findings.extend(result["findings"])

    error_browsers = [name for name, r in comparison.items() if r["status"] == "error"]
    warnings = []
    if len(browsers) == 1:
        warnings.append(f"Only one browser ({browsers[0]}) was tested — cross-browser comparison findings require 2+ browsers.")
    if error_browsers:
        warnings.append(f"Browser(s) failed to load the page entirely: {', '.join(error_browsers)}.")

    return ValidationResult(
        check="cross_browser",
        findings=all_findings,
        metrics={
            "browsersTested": list(comparison.keys()),
            "browserComparison": comparison,
            "overallStatus": "error" if error_browsers else ("issues" if all_findings else "pass"),
        },
        warnings=warnings,
    )
