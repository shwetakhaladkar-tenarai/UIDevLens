"""
responsive/responsive_validator.py
Real responsive-layout validation using Playwright Python, across every
configured browser AND every configured named viewport. Both come from the
selected rule profile (common/config.py's EngineConfig.browsers/viewports,
driven by rule-profiles/*.json's `browsers`/`viewports`) — never hardcoded.

For each (browser, viewport) combination this inspects: horizontal
scrolling / document width vs. viewport width, clipped content, overlapping
elements, hidden important controls, very small tap targets, fixed-width
containers, unusable navigation, text overflow, and off-screen
buttons/forms. A separate pass then compares viewports (within the same
browser) to catch layout that behaves inconsistently across breakpoints
(e.g. a control visible at both desktop and mobile but mysteriously gone
at tablet — a real breakpoint gap, not "ordinary rendering variance").

Every threshold below has an explicit tolerance so ordinary sub-pixel
rendering noise (scrollbar width, font metrics, 1-2px rounding) is never
reported as a finding.

Findings are shaped as requested — {category, browser, viewport, severity,
title, evidence} — plus id/description/recommendation/confidence/source
for pipeline consistency with the rest of this engine.
"""

from __future__ import annotations

from common.logger import get_logger
from common.models import ValidationResult, mock_result

log = get_logger("python-validation.responsive.responsive_validator")

try:
    from playwright.sync_api import sync_playwright

    _PLAYWRIGHT_IMPORT_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001 — Playwright not installed
    sync_playwright = None  # type: ignore[assignment]
    _PLAYWRIGHT_IMPORT_ERROR = str(exc)

DEFAULT_BROWSERS = ("chromium",)
DEFAULT_VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "tablet":  {"width": 768,  "height": 1024},
    "mobile":  {"width": 390,  "height": 844},
}

MAX_FINDINGS_PER_KIND = 10

# ── Tolerances — never report noise this small ──────────────────────────────
OVERFLOW_TOLERANCE_PX = 10       # ignore scrollbar-width-scale overflow
OFFSCREEN_TOLERANCE_PX = 4
CLIP_TOLERANCE_PX = 4
OVERLAP_TOLERANCE_PX = 4
TAP_TARGET_MIN_PX = 44           # WCAG 2.5.5 / platform guidance
TAP_TARGET_TOLERANCE_PX = 4      # only flag meaningfully-small targets (< 40px)
FIXED_WIDTH_TOLERANCE_PX = 8
TEXT_OVERFLOW_TOLERANCE_PX = 4

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

  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const docW = Math.max(document.body?.scrollWidth || 0, document.documentElement?.scrollWidth || 0);
  const docH = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);

  // Off-screen interactive elements / forms (bounding box extends past the
  // viewport's left/right edge while still supposedly "visible")
  const OFFSCREEN_SELECTOR = 'button, [role="button"], input[type=submit], input[type=button], form, a[href]';
  const offscreenElements = [];
  document.querySelectorAll(OFFSCREEN_SELECTOR).forEach((el) => {
    if (offscreenElements.length >= 20 || !isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > vpW || r.left < 0) {
      offscreenElements.push({
        selector: selectorFor(el), tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60),
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      });
    }
  });

  // Clipped content (invisible cut-off, not intentional scroll/ellipsis)
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

  // Text visually spilling outside its box (NOT intentional truncation —
  // those set overflow:hidden/auto/scroll or text-overflow:ellipsis, which
  // we explicitly exclude here since that's handled, not a bug)
  const textOverflowElements = [];
  document.querySelectorAll('p,span,a,li,td,th,label,button,h1,h2,h3,h4,h5,h6').forEach((el) => {
    if (textOverflowElements.length >= 15 || !isVisible(el)) return;
    const hasDirectText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasDirectText) return;
    try {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' || ['hidden', 'auto', 'scroll'].includes(cs.overflow)) return;
      if (el.scrollWidth > el.clientWidth + 4) {
        textOverflowElements.push({
          selector: selectorFor(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          text: (el.innerText || '').trim().slice(0, 60),
        });
      }
    } catch (e) { /* ignore */ }
  });

  // Overlapping siblings
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

  // Very small tap targets
  const smallTapTargets = [];
  document.querySelectorAll('a[href],button,[role=button],input:not([type=hidden]),select,textarea').forEach((el) => {
    if (smallTapTargets.length >= 20 || !isVisible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) {
      smallTapTargets.push({
        selector: selectorFor(el), width: Math.round(r.width), height: Math.round(r.height),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      });
    }
  });

  // Fixed-width containers wider than the viewport (inline style OR computed)
  const fixedWidthProblems = [];
  const seenFixedWidth = new Set();
  document.querySelectorAll('[style*="width"]').forEach((el) => {
    if (fixedWidthProblems.length >= 15) return;
    const m = (el.getAttribute('style') || '').match(/width\\s*:\\s*(\\d+)px/);
    if (m) {
      const pxW = parseInt(m[1], 10);
      if (pxW > vpW + 8 && isVisible(el)) {
        const sel = selectorFor(el);
        if (!seenFixedWidth.has(sel)) {
          seenFixedWidth.add(sel);
          fixedWidthProblems.push({ selector: sel, width: pxW, source: 'inline-style' });
        }
      }
    }
  });
  document.querySelectorAll('div,section,table,img,figure').forEach((el) => {
    if (fixedWidthProblems.length >= 15 || !isVisible(el)) return;
    try {
      const cs = getComputedStyle(el);
      if (!cs.width.endsWith('px')) return;
      const w = parseFloat(cs.width);
      const r = el.getBoundingClientRect();
      if (w > vpW + 8 && r.width > vpW + 8) {
        const sel = selectorFor(el);
        if (!seenFixedWidth.has(sel)) {
          seenFixedWidth.add(sel);
          fixedWidthProblems.push({ selector: sel, width: Math.round(w), source: 'computed-style' });
        }
      }
    } catch (e) { /* ignore */ }
  });

  // Navigation usability: does at least one way to navigate remain visible?
  const navInfo = Array.from(document.querySelectorAll('nav, [role="navigation"]')).slice(0, 5).map((nav) => {
    const links = Array.from(nav.querySelectorAll('a[href]'));
    const visibleLinks = links.filter(isVisible);
    const toggle = nav.querySelector('[aria-label*="menu" i], [class*="hamburger" i], [class*="menu-toggle" i], [aria-expanded], button');
    const toggleVisible = toggle ? isVisible(toggle) : false;
    let toggleTapSize = null;
    if (toggle && toggleVisible) {
      const r = toggle.getBoundingClientRect();
      toggleTapSize = { width: Math.round(r.width), height: Math.round(r.height) };
    }
    return {
      selector: selectorFor(nav), totalLinks: links.length, visibleLinks: visibleLinks.length,
      hasToggle: !!toggle, toggleVisible, toggleTapSize,
    };
  });

  // Important primary/CTA controls — tracked for "hidden important controls"
  // AND the cross-viewport consistency pass. Deliberately narrow (checkout/
  // submit/save-style CTAs), NOT generic nav links, since nav links
  // legitimately collapse behind a toggle at small viewports.
  const CTA_KEYWORDS = /\\b(submit|checkout|buy|purchase|continue|save|confirm|pay|sign\\s*up|register|subscribe|add to cart)\\b/i;
  const importantControls = [];
  document.querySelectorAll('button, input[type=submit], [role="button"]').forEach((el) => {
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim();
    if (!text || !CTA_KEYWORDS.test(text)) return;
    const r = el.getBoundingClientRect();
    importantControls.push({
      selector: selectorFor(el), text: text.slice(0, 60), visible: isVisible(el),
      right: Math.round(r.right), left: Math.round(r.left),
    });
  });

  return {
    viewport: { width: vpW, height: vpH },
    documentDimensions: { width: docW, height: docH },
    hasHorizontalOverflow: docW > vpW,
    overflowAmount: Math.max(0, docW - vpW),
    offscreenElements, clippedElements, textOverflowElements, overlaps,
    smallTapTargets, fixedWidthProblems, navInfo, importantControls,
  };
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Finding helper
# ─────────────────────────────────────────────────────────────────────────────

def _finding(finding_id: str, browser: str, viewport: str, severity: str, title: str,
             description: str, recommendation: str, evidence: dict, confidence: float) -> dict:
    return {
        "id": finding_id,
        "category": "responsive",
        "browser": browser,
        "viewport": viewport,
        "severity": severity,
        "title": title,
        "description": description,
        "recommendation": recommendation,
        "evidence": evidence,
        "confidence": confidence,
        "source": "python-responsive",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Per-(browser, viewport) evidence collection
# ─────────────────────────────────────────────────────────────────────────────

def _collect(playwright, browser_name: str, url: str, viewport_dims: dict, config) -> dict:
    evidence: dict = {}
    browser = None
    try:
        launcher = getattr(playwright, browser_name)
        browser = launcher.launch(headless=True)
        context = browser.new_context(
            viewport={"width": viewport_dims["width"], "height": viewport_dims["height"]},
            ignore_https_errors=True,
        )
        page = context.new_page()
        page.on("dialog", lambda d: d.dismiss())

        nav_error = None
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=config.timeout_ms)
            page.wait_for_timeout(600)
        except Exception as exc:  # noqa: BLE001
            nav_error = str(exc)

        dom = {}
        if nav_error is None:
            try:
                dom = page.evaluate(_COLLECT_JS)
            except Exception as exc:  # noqa: BLE001
                dom = {"error": str(exc)}

        context.close()
        evidence["navError"] = nav_error
        evidence["dom"] = dom

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
# Per-(browser, viewport) findings
# ─────────────────────────────────────────────────────────────────────────────

def _findings_for_combination(browser_name: str, viewport_name: str, viewport_dims: dict, ev: dict) -> list[dict]:
    findings: list[dict] = []
    counter = [0]
    vp_w = viewport_dims["width"]

    def add(title, severity, description, recommendation, evidence, confidence):
        counter[0] += 1
        findings.append(_finding(
            f"responsive-{browser_name}-{viewport_name}-{counter[0]}",
            browser_name, viewport_name, severity, title, description, recommendation, evidence, confidence,
        ))

    if ev.get("launchError"):
        add(
            "Browser launch failed", "high",
            f'Could not launch {browser_name}: {ev["launchError"]}',
            f'Verify the {browser_name} Playwright browser binary is installed ("playwright install {browser_name}").',
            {"error": ev["launchError"]}, 0.9,
        )
        return findings

    if ev.get("navError"):
        add(
            "Page failed to load", "high",
            f'Navigation failed in {browser_name} at {viewport_name} ({vp_w}px): {ev["navError"]}',
            "Check server availability and page load timeout.",
            {"error": ev["navError"]}, 0.85,
        )
        return findings

    dom = ev.get("dom") or {}
    if dom.get("error"):
        return findings

    # 1. Horizontal scrolling / document width vs viewport width
    overflow_amount = dom.get("overflowAmount", 0)
    if overflow_amount > OVERFLOW_TOLERANCE_PX:
        add(
            "Horizontal scrolling required", "high" if overflow_amount > vp_w * 0.25 else "medium",
            f'Page content ({dom["documentDimensions"]["width"]}px) is wider than the {viewport_name} viewport '
            f'({vp_w}px) by {overflow_amount}px, causing horizontal scrolling.',
            "Find and fix the element(s) causing overflow (fixed widths, unwrapped content, min-width).",
            {"viewportWidth": vp_w, "documentWidth": dom["documentDimensions"]["width"], "overflowAmount": overflow_amount},
            0.85,
        )

    # 2. Off-screen buttons/forms
    for el in dom.get("offscreenElements", [])[:MAX_FINDINGS_PER_KIND]:
        overhang = max(el["right"] - vp_w, -el["left"])
        if overhang <= OFFSCREEN_TOLERANCE_PX:
            continue
        label = el["text"] or el["selector"]
        add(
            f'{label[:40]} outside viewport', "high",
            f'Element "{label}" ({el["selector"]}) extends outside the {viewport_name} viewport '
            f'(right edge at {el["right"]}px, viewport is {vp_w}px wide).',
            "Reflow or resize this element so it stays within the viewport at this breakpoint.",
            {"viewportWidth": vp_w, "rightEdge": el["right"], "leftEdge": el["left"], "selector": el["selector"]},
            0.75,
        )

    # 3. Clipped content
    for el in dom.get("clippedElements", [])[:MAX_FINDINGS_PER_KIND]:
        if el["scrollHeight"] - el["clientHeight"] <= CLIP_TOLERANCE_PX:
            continue
        add(
            "Clipped content", "medium",
            f'Content in {el["selector"]} is clipped at {viewport_name} ({el["clientHeight"]}px visible of '
            f'{el["scrollHeight"]}px content) with overflow:hidden.',
            "Increase the container's height/max-height or change overflow so this content is reachable.",
            {**el, "viewportWidth": vp_w}, 0.7,
        )

    # 4. Text overflow (visual spillage, not intentional truncation)
    for el in dom.get("textOverflowElements", [])[:MAX_FINDINGS_PER_KIND]:
        if el["scrollWidth"] - el["clientWidth"] <= TEXT_OVERFLOW_TOLERANCE_PX:
            continue
        add(
            "Text overflows its container", "medium",
            f'Text in {el["selector"]} ("{el["text"]}") is wider ({el["scrollWidth"]}px) than its container '
            f'({el["clientWidth"]}px) at {viewport_name} and is not clipped/scrollable, so it visually spills out.',
            "Add word-wrap/overflow-wrap, reduce font size responsively, or widen the container.",
            {**el, "viewportWidth": vp_w}, 0.6,
        )

    # 5. Overlapping elements
    for ov in dom.get("overlaps", [])[:MAX_FINDINGS_PER_KIND]:
        add(
            "Overlapping elements", "medium",
            f'Elements {ov["elementA"]} and {ov["elementB"]} visually overlap at {viewport_name}.',
            "Check spacing/positioning (margins, absolute positioning, flex/grid gaps) at this breakpoint.",
            {**ov, "viewportWidth": vp_w}, 0.6,
        )

    # 6. Very small tap targets
    for el in dom.get("smallTapTargets", [])[:MAX_FINDINGS_PER_KIND]:
        if el["width"] >= TAP_TARGET_MIN_PX - TAP_TARGET_TOLERANCE_PX and el["height"] >= TAP_TARGET_MIN_PX - TAP_TARGET_TOLERANCE_PX:
            continue
        add(
            "Tap target too small", "medium",
            f'Control "{el["text"] or el["selector"]}" is {el["width"]}×{el["height"]}px at {viewport_name} — '
            f'below the recommended {TAP_TARGET_MIN_PX}×{TAP_TARGET_MIN_PX}px minimum for touch targets.',
            f"Increase padding/size so the tap target is at least {TAP_TARGET_MIN_PX}×{TAP_TARGET_MIN_PX}px.",
            {**el, "viewportWidth": vp_w}, 0.65,
        )

    # 7. Fixed-width containers wider than the viewport
    for el in dom.get("fixedWidthProblems", [])[:MAX_FINDINGS_PER_KIND]:
        width = el.get("width", 0)
        if width - vp_w <= FIXED_WIDTH_TOLERANCE_PX:
            continue
        add(
            "Fixed-width container wider than viewport", "high",
            f'Element {el["selector"]} has a fixed width of {width}px, wider than the {viewport_name} '
            f'viewport ({vp_w}px).',
            "Use a responsive width (%, max-width, clamp()) instead of a fixed pixel width.",
            {**el, "viewportWidth": vp_w}, 0.75,
        )

    # 8. Unusable navigation — no visible links AND no usable toggle
    for nav in dom.get("navInfo", []):
        if nav["visibleLinks"] > 0:
            continue  # links are directly visible — navigation is usable
        if nav["hasToggle"] and nav["toggleVisible"]:
            tap = nav.get("toggleTapSize") or {}
            if (tap.get("width", 0) >= TAP_TARGET_MIN_PX - TAP_TARGET_TOLERANCE_PX
                    and tap.get("height", 0) >= TAP_TARGET_MIN_PX - TAP_TARGET_TOLERANCE_PX):
                continue  # a properly-sized, visible menu toggle is a valid way to navigate
        add(
            "Navigation may be unusable at this viewport", "high",
            f'Nav ({nav["selector"]}) has no visible links at {viewport_name}'
            + (f' and its menu toggle is too small ({nav["toggleTapSize"]}).' if nav["hasToggle"] and nav["toggleVisible"]
               else " and no visible/usable menu toggle was found." if nav["hasToggle"]
               else " and provides no menu toggle."),
            "Ensure a visible, adequately-sized way to open navigation exists at every breakpoint.",
            {**nav, "viewportWidth": vp_w}, 0.6,
        )

    # 9. Hidden important controls (primary CTAs, e.g. checkout/submit)
    for ctrl in dom.get("importantControls", []):
        if ctrl["visible"]:
            continue
        add(
            f'Important control "{ctrl["text"]}" not visible', "high",
            f'Control "{ctrl["text"]}" ({ctrl["selector"]}) is not visible at {viewport_name} ({vp_w}px).',
            "Ensure primary actions remain visible/reachable at every configured viewport.",
            {**ctrl, "viewportWidth": vp_w}, 0.6,
        )

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Cross-viewport consistency (within the same browser)
# ─────────────────────────────────────────────────────────────────────────────

def _cross_viewport_findings(browser_name: str, evidence_by_viewport: dict[str, dict], viewport_dims_by_name: dict) -> list[dict]:
    """
    Compare the SAME tracked important controls across viewports (within one
    browser, sorted by width). A control visible at both the smallest and
    largest tested viewport but missing at one "sandwiched" in between is a
    real breakpoint gap — not ordinary responsive collapsing (which nav
    links legitimately do; that's why only CTA-style importantControls are
    tracked here, never generic nav links).
    """
    findings: list[dict] = []
    ordered = sorted(
        (name for name, ev in evidence_by_viewport.items() if not ev.get("navError") and not ev.get("launchError")),
        key=lambda name: viewport_dims_by_name[name]["width"],
    )
    if len(ordered) < 3:
        return findings  # need at least 3 viewports to have a "sandwiched" one

    def controls_by_selector(viewport_name: str) -> dict[str, bool]:
        dom = evidence_by_viewport[viewport_name].get("dom") or {}
        return {c["selector"]: c["visible"] for c in dom.get("importantControls", [])}

    smallest, largest = ordered[0], ordered[-1]
    smallest_controls = controls_by_selector(smallest)
    largest_controls = controls_by_selector(largest)

    counter = [0]
    for middle in ordered[1:-1]:
        middle_controls = controls_by_selector(middle)
        for selector, visible_at_smallest in smallest_controls.items():
            if not visible_at_smallest or not largest_controls.get(selector, False):
                continue
            if not middle_controls.get(selector, True):
                counter[0] += 1
                findings.append(_finding(
                    f"responsive-{browser_name}-crossviewport-{counter[0]}",
                    browser_name, middle, "medium",
                    "Inconsistent layout behavior across viewports",
                    f'Control ({selector}) is visible at {smallest} and {largest} but not at {middle} — '
                    f"a likely gap in the responsive breakpoints rather than intentional design.",
                    "Check the CSS media query breakpoints around this viewport width for a gap.",
                    {"selector": selector, "visibleAt": [smallest, largest], "missingAt": middle},
                    0.55,
                ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def validate(url: str, session=None, config=None, **_kwargs) -> ValidationResult:
    if sync_playwright is None:
        return mock_result(
            check="responsive",
            source="responsive_validator",
            category="responsive",
            title="Responsive validation (mocked)",
            description=f"Would measure layout at multiple viewports for {url} ({_PLAYWRIGHT_IMPORT_ERROR}).",
            metrics={"mocked": True},
        )

    browsers = tuple(getattr(config, "browsers", DEFAULT_BROWSERS)) if config is not None else DEFAULT_BROWSERS
    if not browsers:
        browsers = DEFAULT_BROWSERS
    viewports = dict(getattr(config, "viewports", DEFAULT_VIEWPORTS)) if config is not None else dict(DEFAULT_VIEWPORTS)
    if not viewports:
        viewports = dict(DEFAULT_VIEWPORTS)

    # Playwright's sync API allows only ONE driver connection per process —
    # reuse the shared session's (functional/accessibility) if it's already
    # running one, otherwise start our own (torn down before returning).
    shared_playwright = getattr(session, "playwright", None) if session is not None and not getattr(session, "mocked", True) else None

    def _run(playwright) -> tuple[list[dict], dict]:
        all_findings: list[dict] = []
        by_combo: dict[str, dict] = {}
        for browser_name in browsers:
            evidence_by_viewport: dict[str, dict] = {}
            for viewport_name, dims in viewports.items():
                log.info("Collecting responsive evidence: %s @ %s (%sx%s) for %s", browser_name, viewport_name, dims["width"], dims["height"], url)
                ev = _collect(playwright, browser_name, url, dims, config)
                evidence_by_viewport[viewport_name] = ev

                combo_findings = _findings_for_combination(browser_name, viewport_name, dims, ev)
                all_findings.extend(combo_findings)
                by_combo[f"{browser_name}:{viewport_name}"] = {
                    "status": "error" if ev.get("launchError") or ev.get("navError") else ("issues" if combo_findings else "pass"),
                    "issueCount": len(combo_findings),
                }

            all_findings.extend(_cross_viewport_findings(browser_name, evidence_by_viewport, viewports))

        return all_findings, by_combo

    try:
        if shared_playwright is not None:
            all_findings, by_combo = _run(shared_playwright)
        else:
            with sync_playwright() as playwright:
                all_findings, by_combo = _run(playwright)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="responsive", errors=[f"responsive_validator: failed to run: {exc}"])

    return ValidationResult(
        check="responsive",
        findings=all_findings,
        metrics={
            "browsersTested": list(browsers),
            "viewportsTested": {name: dims for name, dims in viewports.items()},
            "combinationsTested": len(browsers) * len(viewports),
            "byBrowserViewport": by_combo,
        },
    )
