"""
accessibility/wcag_validator.py
Deterministic WCAG accessibility validation against a real, shared
Chromium page (see common/browser.py). Supports a configurable conformance
target level — "A" or "AA" (default "AA") — driven by the selected rule
profile's `accessibility.level` (rule-profiles/*.json), never hardcoded
here.

IMPORTANT — this is a PARTIAL, automated check. It does NOT and CANNOT
claim full WCAG compliance: many success criteria require human judgment
(does this alt text actually describe the image? does this heading order
make sense in context?). Every run therefore returns two distinct lists:

  - automatedFindings：           measurable, deterministic violations
  - manualReviewRecommendations： items a human must judge — NEVER counted
                                   as violations or scored

Checks implemented: missing alt text, form labels, accessible button/link
names, color contrast (AA only), heading structure, document language,
ARIA misuse, duplicate ids, keyboard focus (real focusability + tab order),
focus visibility (AA only), and landmark issues.
"""

from __future__ import annotations

import re

from common.models import ValidationResult, mock_result

VALID_WCAG_LEVELS = ("A", "AA")
DEFAULT_LEVEL = "AA"

# A reasonably complete list of valid WAI-ARIA 1.2 (concrete) roles, used to
# flag `role="..."` values that are simply typos/invalid.
_VALID_ARIA_ROLES = {
    "alert", "alertdialog", "application", "article", "banner", "button",
    "cell", "checkbox", "columnheader", "combobox", "complementary",
    "contentinfo", "definition", "dialog", "directory", "document", "feed",
    "figure", "form", "grid", "gridcell", "group", "heading", "img", "link",
    "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu",
    "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation",
    "none", "note", "option", "presentation", "progressbar", "radio",
    "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar",
    "search", "searchbox", "separator", "slider", "spinbutton", "status",
    "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
    "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
}

_GENERIC_LINK_TEXTS = {"click here", "here", "read more", "more", "link", "this link", "learn more"}

MAX_PER_CATEGORY = 30

_COLLECT_JS = """
(validRoles) => {
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

  const accessibleNameFor = (el) => {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/).map((id) => {
        const ref = document.getElementById(id);
        return ref ? (ref.innerText || ref.textContent || '') : '';
      }).join(' ').trim();
      if (text) return text;
    }
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text;
    if (el.tagName === 'INPUT' && el.value && ['submit', 'button'].includes((el.type || '').toLowerCase())) {
      return el.value.trim();
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '';
  };

  const cap = (arr, n) => arr.slice(0, n);

  // 1. Images missing alt
  const imagesMissingAlt = cap(
    Array.from(document.querySelectorAll('img')).filter((img) => isVisible(img) && !img.hasAttribute('alt')),
    30
  ).map((img) => ({ selector: selectorFor(img), src: img.getAttribute('src') || '' }));

  // 2. Form fields missing labels
  const unlabeledFields = [];
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes((el.type || '').toLowerCase())) return;
    if (!isVisible(el)) return;
    const hasLabelFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const hasWrappingLabel = !!el.closest('label');
    const hasAriaLabel = el.getAttribute('aria-label');
    const hasAriaLabelledby = el.getAttribute('aria-labelledby');
    if (!hasLabelFor && !hasWrappingLabel && !hasAriaLabel && !hasAriaLabelledby) {
      unlabeledFields.push({
        selector: selectorFor(el), tag: el.tagName.toLowerCase(),
        type: el.type || null, name: el.getAttribute('name'),
      });
    }
  });

  // 3. Buttons without accessible name
  const unnamedButtons = [];
  document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]').forEach((el) => {
    if (!isVisible(el)) return;
    if (!accessibleNameFor(el)) unnamedButtons.push({ selector: selectorFor(el), tag: el.tagName.toLowerCase() });
  });

  // 4. Links: missing accessible name, or generic/vague text
  const unnamedLinks = [];
  const genericLinks = [];
  document.querySelectorAll('a[href]').forEach((el) => {
    if (!isVisible(el)) return;
    const name = accessibleNameFor(el);
    if (!name) {
      unnamedLinks.push({ selector: selectorFor(el), href: el.getAttribute('href') });
    } else if (['click here', 'here', 'read more', 'more', 'link', 'this link', 'learn more'].includes(name.toLowerCase())) {
      genericLinks.push({ selector: selectorFor(el), text: name, href: el.getAttribute('href') });
    }
  });

  // 5. Color contrast sampling (only elements whose OWN text node is non-trivial,
  // to avoid re-sampling the same visible text via every ancestor wrapper)
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  const contrastSamples = [];
  document.querySelectorAll('p, span, a, li, td, th, label, button, h1, h2, h3, h4, h5, h6').forEach((el) => {
    if (contrastSamples.length >= 60 || !isVisible(el)) return;
    const hasDirectText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasDirectText) return;
    const text = (el.innerText || '').trim();
    if (!text) return;
    const cs = getComputedStyle(el);
    contrastSamples.push({
      selector: selectorFor(el),
      color: cs.color,
      backgroundColor: effectiveBackground(el),
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      textSample: text.slice(0, 60),
    });
  });

  // 6. Heading structure
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
    level: parseInt(h.tagName[1], 10),
    text: (h.innerText || '').trim().slice(0, 80),
  }));

  // 7. Document language
  const htmlLang = document.documentElement.getAttribute('lang') || '';

  // 8. ARIA misuse
  const ariaIssues = [];
  document.querySelectorAll('[role]').forEach((el) => {
    const role = (el.getAttribute('role') || '').toLowerCase().split(/\\s+/)[0];
    if (role && !validRoles.includes(role)) {
      ariaIssues.push({ selector: selectorFor(el), issue: 'invalid-role', role });
    }
  });
  ['aria-labelledby', 'aria-describedby'].forEach((attr) => {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const ids = (el.getAttribute(attr) || '').split(/\\s+/).filter(Boolean);
      const missing = ids.filter((id) => !document.getElementById(id));
      if (missing.length) {
        ariaIssues.push({
          selector: selectorFor(el),
          issue: attr === 'aria-labelledby' ? 'aria-labelledby-missing-target' : 'aria-describedby-missing-target',
          missingIds: missing,
        });
      }
    });
  });
  document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] input:not([type=hidden])').forEach((el) => {
    if (isVisible(el)) ariaIssues.push({ selector: selectorFor(el), issue: 'focusable-inside-aria-hidden' });
  });

  // 9. Duplicate ids
  const idCounts = {};
  document.querySelectorAll('[id]').forEach((el) => {
    if (el.id) idCounts[el.id] = (idCounts[el.id] || 0) + 1;
  });
  const duplicateIds = Object.entries(idCounts)
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));

  // 10. Keyboard focus: static tabindex misuse
  const positiveTabindex = [];
  document.querySelectorAll('[tabindex]').forEach((el) => {
    const ti = parseInt(el.getAttribute('tabindex'), 10);
    if (!isNaN(ti) && ti > 0) positiveTabindex.push({ selector: selectorFor(el), tabindex: ti });
  });
  const NATIVE_INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="link"]';
  const negativeTabindexInteractive = [];
  document.querySelectorAll(NATIVE_INTERACTIVE).forEach((el) => {
    if (isVisible(el) && el.getAttribute('tabindex') === '-1') {
      negativeTabindexInteractive.push({ selector: selectorFor(el), tag: el.tagName.toLowerCase() });
    }
  });

  // Real focusability + focus-visible check. Calling .focus()/.blur() is
  // always safe — it never navigates, clicks, or submits anything.
  const activeBefore = document.activeElement;
  const focusabilityResults = [];
  cap(Array.from(document.querySelectorAll(NATIVE_INTERACTIVE)).filter(isVisible), 20).forEach((el) => {
    const beforeCs = getComputedStyle(el);
    const beforeSig = beforeCs.outlineStyle + '|' + beforeCs.outlineWidth + '|' + beforeCs.boxShadow + '|' + beforeCs.borderColor;
    try { el.focus(); } catch (e) { /* ignore */ }
    const focused = document.activeElement === el;
    let indicatorChanged = false;
    if (focused) {
      const afterCs = getComputedStyle(el);
      const afterSig = afterCs.outlineStyle + '|' + afterCs.outlineWidth + '|' + afterCs.boxShadow + '|' + afterCs.borderColor;
      indicatorChanged = afterSig !== beforeSig;
      try { el.blur(); } catch (e) { /* ignore */ }
    }
    focusabilityResults.push({ selector: selectorFor(el), tag: el.tagName.toLowerCase(), focusable: focused, focusIndicatorChanges: indicatorChanged });
  });
  try { if (activeBefore && activeBefore.focus) activeBefore.focus(); } catch (e) { /* ignore */ }

  // 11. Landmarks
  const landmarks = {
    mains: document.querySelectorAll('main, [role="main"]').length,
    navs: document.querySelectorAll('nav, [role="navigation"]').length,
    hasSkipLink: !!document.querySelector('a[href^="#main"], a[href^="#content"], .skip-link, [class*="skip-link" i]'),
  };

  return {
    imagesMissingAlt, unlabeledFields, unnamedButtons, unnamedLinks, genericLinks,
    contrastSamples, headings, htmlLang, ariaIssues, duplicateIds,
    positiveTabindex, negativeTabindexInteractive, focusabilityResults, landmarks,
  };
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# WCAG 1.4.3 contrast math
# ─────────────────────────────────────────────────────────────────────────────

def _parse_rgb(color: str) -> tuple[float, float, float] | None:
    m = re.match(r"rgba?\(([^)]+)\)", (color or "").strip())
    if not m:
        return None
    parts = [p.strip() for p in m.group(1).split(",")]
    if len(parts) < 3:
        return None
    try:
        return float(parts[0]), float(parts[1]), float(parts[2])
    except ValueError:
        return None


def _relative_luminance(r: float, g: float, b: float) -> float:
    def lin(c: float) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def _contrast_ratio(fg: str, bg: str) -> float | None:
    fg_rgb = _parse_rgb(fg)
    bg_rgb = _parse_rgb(bg)
    if not fg_rgb or not bg_rgb:
        return None
    l1 = _relative_luminance(*fg_rgb)
    l2 = _relative_luminance(*bg_rgb)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _is_large_text(font_size_px: float, font_weight: str) -> bool:
    try:
        bold = int(font_weight) >= 700
    except (TypeError, ValueError):
        bold = str(font_weight).lower() in ("bold", "bolder")
    if font_size_px >= 24:
        return True
    return font_size_px >= 18.66 and bold


_LANG_TAG_RE = re.compile(r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$")


# ─────────────────────────────────────────────────────────────────────────────
# Evidence -> findings
# ─────────────────────────────────────────────────────────────────────────────

def check_wcag(evidence: dict, level: str = DEFAULT_LEVEL) -> dict:
    """
    Run all WCAG checks against already-collected DOM evidence.

    Returns exactly:
      {"automatedFindings": [...], "manualReviewRecommendations": [...]}

    automatedFindings are measurable, deterministic violations — each shaped
    as {category, standard, level, rule, severity, selector, evidence,
    confidence} (plus id/description/recommendation for pipeline usefulness).
    manualReviewRecommendations are NOT violations — they flag things that
    require human judgment and are never scored.
    """
    if level not in VALID_WCAG_LEVELS:
        level = DEFAULT_LEVEL

    automated: list[dict] = []
    manual: list[dict] = []

    def add_finding(rule: str, severity: str, selector: str, description: str,
                     recommendation: str, finding_evidence: dict, confidence: float,
                     finding_level: str | None = None) -> None:
        automated.append({
            "id": f"accessibility-{len(automated) + 1}",
            "category": "accessibility",
            "standard": "WCAG",
            "level": finding_level or level,
            "rule": rule,
            "severity": severity,
            "selector": selector,
            "description": description,
            "recommendation": recommendation,
            "evidence": finding_evidence,
            "confidence": confidence,
        })

    def add_manual(rule: str, reason: str, selector: str, manual_evidence: dict,
                    manual_level: str | None = None) -> None:
        manual.append({
            "rule": rule,
            "level": manual_level or level,
            "reason": reason,
            "selector": selector,
            "evidence": manual_evidence,
        })

    # 1. Images missing alt — 1.1.1, Level A
    for img in evidence.get("imagesMissingAlt", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 1.1.1 Non-text Content",
            severity="high",
            selector=img["selector"],
            description=f'Image ({img["selector"]}) has no `alt` attribute.',
            recommendation='Add a descriptive `alt` attribute, or `alt=""` if the image is purely decorative.',
            finding_evidence={"src": img.get("src", "")},
            confidence=0.9,
            finding_level="A",
        )

    # 2. Unlabeled form fields — 1.3.1 / 4.1.2, Level A
    for field in evidence.get("unlabeledFields", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 1.3.1 Info and Relationships / 4.1.2 Name, Role, Value",
            severity="high",
            selector=field["selector"],
            description=f'Form field ({field["selector"]}) has no associated label, aria-label, or aria-labelledby.',
            recommendation="Associate a <label for=...>, wrap it in a <label>, or add aria-label/aria-labelledby.",
            finding_evidence=field,
            confidence=0.85,
            finding_level="A",
        )

    # 3. Buttons without accessible name — 4.1.2, Level A
    for btn in evidence.get("unnamedButtons", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 4.1.2 Name, Role, Value",
            severity="high",
            selector=btn["selector"],
            description=f'Button ({btn["selector"]}) has no accessible name (no text, aria-label, or aria-labelledby).',
            recommendation="Add visible text, an aria-label, or aria-labelledby so assistive technology can announce this control.",
            finding_evidence=btn,
            confidence=0.85,
            finding_level="A",
        )

    # 4. Links without accessible name — 2.4.4 / 4.1.2, Level A
    for link in evidence.get("unnamedLinks", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 2.4.4 Link Purpose (In Context) / 4.1.2 Name, Role, Value",
            severity="high",
            selector=link["selector"],
            description=f'Link ({link["selector"]}) has no accessible name.',
            recommendation="Add link text, an aria-label, or aria-labelledby describing the link's destination/purpose.",
            finding_evidence=link,
            confidence=0.85,
            finding_level="A",
        )

    # Generic/vague link text needs human judgment of surrounding context —
    # manual review, not an automated violation.
    for link in evidence.get("genericLinks", [])[:MAX_PER_CATEGORY]:
        add_manual(
            rule="WCAG 2.4.4 Link Purpose (In Context)",
            reason=f'Link text "{link["text"]}" is generic; verify surrounding context makes its destination/purpose clear.',
            selector=link["selector"],
            manual_evidence=link,
            manual_level="A",
        )

    # 5. Color contrast — 1.4.3, Level AA only (not applicable at Level A)
    if level == "AA":
        for sample in evidence.get("contrastSamples", []):
            ratio = _contrast_ratio(sample["color"], sample["backgroundColor"])
            if ratio is None:
                continue
            large = _is_large_text(sample["fontSize"], sample["fontWeight"])
            threshold = 3.0 if large else 4.5
            if ratio < threshold:
                severity = "high" if ratio < threshold * 0.75 else "medium"
                add_finding(
                    rule="WCAG 1.4.3 Contrast (Minimum)",
                    severity=severity,
                    selector=sample["selector"],
                    description=(
                        f'Text ({sample["selector"]}, "{sample["textSample"]}") has a contrast ratio of '
                        f'{ratio:.2f}:1 against its background, below the required {threshold}:1 '
                        f'({"large" if large else "normal"} text).'
                    ),
                    recommendation="Increase the contrast between the text color and its background to meet WCAG AA.",
                    finding_evidence={**sample, "ratio": round(ratio, 2), "threshold": threshold},
                    confidence=0.8,
                )

    # 6. Heading structure — 1.3.1, Level A
    headings = evidence.get("headings", [])
    levels = [h["level"] for h in headings]
    for i in range(1, len(levels)):
        if levels[i] - levels[i - 1] > 1:
            add_finding(
                rule="WCAG 1.3.1 Info and Relationships (heading structure)",
                severity="medium",
                selector=f"h{levels[i]}",
                description=(
                    f'Heading level skips from h{levels[i - 1]} ("{headings[i - 1]["text"]}") to '
                    f'h{levels[i]} ("{headings[i]["text"]}") without an intermediate level.'
                ),
                recommendation="Use heading levels in order (don't skip levels) to preserve document structure for assistive technology.",
                finding_evidence={"from": headings[i - 1], "to": headings[i]},
                confidence=0.75,
                finding_level="A",
            )
            break  # one representative finding avoids noise from repeated skips
    h1_count = levels.count(1)
    if h1_count == 0 and headings:
        add_manual(
            rule="WCAG 1.3.1 Info and Relationships",
            reason="No <h1> was found even though the page has other headings — verify the page has a single top-level heading.",
            selector="h1",
            manual_evidence={"headingCount": len(headings)},
            manual_level="A",
        )
    elif h1_count > 1:
        add_manual(
            rule="WCAG 1.3.1 Info and Relationships",
            reason=f"Page has {h1_count} <h1> elements — verify multiple top-level headings are intentional.",
            selector="h1",
            manual_evidence={"h1Count": h1_count},
            manual_level="A",
        )

    # 7. Document language — 3.1.1, Level A
    html_lang = (evidence.get("htmlLang") or "").strip()
    if not html_lang:
        add_finding(
            rule="WCAG 3.1.1 Language of Page",
            severity="high",
            selector="html",
            description="The <html> element has no `lang` attribute.",
            recommendation='Add a `lang` attribute to <html> (e.g. lang="en").',
            finding_evidence={},
            confidence=0.95,
            finding_level="A",
        )
    elif not _LANG_TAG_RE.match(html_lang):
        add_finding(
            rule="WCAG 3.1.1 Language of Page",
            severity="medium",
            selector="html",
            description=f'The <html lang="{html_lang}"> value does not look like a valid BCP 47 language tag.',
            recommendation='Use a valid BCP 47 language tag (e.g. "en", "en-US", "fr").',
            finding_evidence={"lang": html_lang},
            confidence=0.6,
            finding_level="A",
        )

    # 8. ARIA misuse — 4.1.2, Level A
    for issue in evidence.get("ariaIssues", [])[:MAX_PER_CATEGORY]:
        kind = issue.get("issue")
        if kind == "invalid-role":
            add_finding(
                rule="WCAG 4.1.2 Name, Role, Value (invalid ARIA role)",
                severity="medium",
                selector=issue["selector"],
                description=f'Element ({issue["selector"]}) uses an invalid ARIA role: "{issue.get("role")}".',
                recommendation="Use a valid WAI-ARIA role or remove the role attribute.",
                finding_evidence=issue,
                confidence=0.85,
                finding_level="A",
            )
        elif kind in ("aria-labelledby-missing-target", "aria-describedby-missing-target"):
            add_finding(
                rule="WCAG 4.1.2 Name, Role, Value (dangling ARIA reference)",
                severity="medium",
                selector=issue["selector"],
                description=f'Element ({issue["selector"]}) references an id that does not exist: {issue.get("missingIds")}.',
                recommendation="Fix the referenced id(s), or remove the attribute if it's no longer needed.",
                finding_evidence=issue,
                confidence=0.9,
                finding_level="A",
            )
        elif kind == "focusable-inside-aria-hidden":
            add_finding(
                rule="WCAG 4.1.2 Name, Role, Value (focusable content hidden from assistive tech)",
                severity="high",
                selector=issue["selector"],
                description=f'A focusable element ({issue["selector"]}) is inside an aria-hidden="true" container.',
                recommendation="Remove aria-hidden from ancestors of focusable elements, or make the element non-focusable too.",
                finding_evidence=issue,
                confidence=0.85,
                finding_level="A",
            )

    # 9. Duplicate ids — 4.1.1, Level A
    for dup in evidence.get("duplicateIds", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 4.1.1 Parsing (duplicate id)",
            severity="medium",
            selector=f'#{dup["id"]}',
            description=f'The id "{dup["id"]}" is used on {dup["count"]} elements; ids must be unique.',
            recommendation="Make each id attribute unique on the page.",
            finding_evidence=dup,
            confidence=0.95,
            finding_level="A",
        )

    # 10. Keyboard focus — 2.1.1 / 2.4.3, Level A; focus visibility is AA
    for item in evidence.get("positiveTabindex", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 2.4.3 Focus Order (positive tabindex)",
            severity="medium",
            selector=item["selector"],
            description=f'Element ({item["selector"]}) has a positive tabindex ({item["tabindex"]}), which can create a confusing tab order.',
            recommendation='Use tabindex="0" (or remove it) and rely on DOM order for a natural tab sequence.',
            finding_evidence=item,
            confidence=0.8,
            finding_level="A",
        )
    for item in evidence.get("negativeTabindexInteractive", [])[:MAX_PER_CATEGORY]:
        add_finding(
            rule="WCAG 2.1.1 Keyboard",
            severity="medium",
            selector=item["selector"],
            description=f'Natively interactive element ({item["selector"]}) has tabindex="-1", removing it from the keyboard tab order.',
            recommendation="Verify this is intentional; otherwise remove tabindex=-1 so the control stays keyboard-reachable.",
            finding_evidence=item,
            confidence=0.7,
            finding_level="A",
        )
    for item in evidence.get("focusabilityResults", []):
        if not item.get("focusable"):
            add_finding(
                rule="WCAG 2.1.1 Keyboard",
                severity="high",
                selector=item["selector"],
                description=f'Interactive element ({item["selector"]}) could not receive keyboard focus.',
                recommendation="Ensure the element is natively focusable or has a valid tabindex.",
                finding_evidence=item,
                confidence=0.7,
                finding_level="A",
            )
        elif level == "AA" and not item.get("focusIndicatorChanges"):
            add_finding(
                rule="WCAG 2.4.7 Focus Visible",
                severity="medium",
                selector=item["selector"],
                description=f'No visible focus indicator (outline/box-shadow/border) was detected when ({item["selector"]}) received keyboard focus.',
                recommendation="Ensure a visible focus style (outline, box-shadow, etc.) appears on :focus / :focus-visible.",
                finding_evidence=item,
                confidence=0.55,
            )

    # 11. Landmarks — 1.3.1 / 2.4.1, Level A
    landmarks = evidence.get("landmarks", {})
    if landmarks.get("mains", 0) == 0:
        add_finding(
            rule='WCAG 1.3.1 Info and Relationships (landmark-one-main)',
            severity="medium",
            selector="body",
            description='The page has no <main> (or role="main") landmark.',
            recommendation="Wrap the page's primary content in a <main> element.",
            finding_evidence=landmarks,
            confidence=0.8,
            finding_level="A",
        )
    elif landmarks.get("mains", 0) > 1:
        add_finding(
            rule='WCAG 1.3.1 Info and Relationships (landmark-one-main)',
            severity="medium",
            selector="body",
            description=f'The page has {landmarks["mains"]} <main>/role="main" landmarks; there should be exactly one.',
            recommendation="Use only one <main> landmark per page.",
            finding_evidence=landmarks,
            confidence=0.8,
            finding_level="A",
        )
    if landmarks.get("navs", 0) == 0:
        add_manual(
            rule="WCAG 1.3.1 Info and Relationships",
            reason='No <nav> (or role="navigation") landmark was found — verify this page doesn\'t need one.',
            selector="body",
            manual_evidence=landmarks,
            manual_level="A",
        )
    if not landmarks.get("hasSkipLink"):
        add_manual(
            rule="WCAG 2.4.1 Bypass Blocks",
            reason="No skip link was detected — verify repeated content blocks can otherwise be bypassed (e.g. via landmarks/headings), or add a skip-to-content link.",
            selector="body",
            manual_evidence=landmarks,
            manual_level="A",
        )

    return {"automatedFindings": automated, "manualReviewRecommendations": manual}


# ─────────────────────────────────────────────────────────────────────────────
# Validator entry point
# ─────────────────────────────────────────────────────────────────────────────

def validate(url: str, session=None, config=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="accessibility",
            source="wcag_validator",
            category="accessibility",
            title="WCAG validation (mocked)",
            description=f"Would run deterministic WCAG checks against {url}.",
            metrics={"violations": 0, "mocked": True},
        )

    level = getattr(config, "wcag_level", DEFAULT_LEVEL) if config is not None else DEFAULT_LEVEL
    if level not in VALID_WCAG_LEVELS:
        level = DEFAULT_LEVEL

    page = session.page
    if page is None:
        return ValidationResult(check="accessibility", warnings=["wcag_validator: no page available"], metrics={"violations": 0})

    try:
        dom_evidence = page.evaluate(_COLLECT_JS, sorted(_VALID_ARIA_ROLES))
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="accessibility", errors=[f"wcag_validator: failed to inspect DOM: {exc}"])

    result = check_wcag(dom_evidence, level)
    automated = result["automatedFindings"]
    manual = result["manualReviewRecommendations"]

    return ValidationResult(
        check="accessibility",
        findings=automated,
        metrics={
            "wcagLevel": level,
            "automatedViolations": len(automated),
            "manualReviewCount": len(manual),
            "manualReviewRecommendations": manual,
        },
        warnings=[
            f"Automated WCAG {level} check only — it does NOT guarantee full compliance. "
            f"{len(manual)} item(s) require manual review."
        ],
    )
