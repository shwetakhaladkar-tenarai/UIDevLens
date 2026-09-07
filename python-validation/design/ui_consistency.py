"""
design/ui_consistency.py
Deterministic UI design-consistency validation via frequency/outlier
analysis on real Playwright-collected computed-style evidence.

Complements the existing Node-side design analyzer
(backend/src/tools/designAnalyzer.js) with an independent engine that
applies the same proven methodology (frequency maps, mode-relative outlier
detection, explicit tolerances) — ported here rather than shared, since
this Python engine collects and analyzes its own evidence.

Analyzes: typography (font family/size/weight), text/background colors,
spacing (padding/margins), border radius, repeated buttons, form controls,
component dimensions, and alignment.

Deterministic only — never calls OpenAI, never asks it to judge
consistency. Every finding carries category "ui-consistency".
"""

from __future__ import annotations

from common.logger import get_logger
from common.models import ValidationResult, mock_result

log = get_logger("python-validation.design.ui_consistency")

# ── Tolerances — mirrors backend/src/tools/designAnalyzer.js so both
# engines apply the same notion of "meaningful difference" ─────────────────
TOL_PX_ROUND = 2            # px differences below this are rounding noise
TOL_GAP_VARIANCE = 8        # gap difference (px) below this is acceptable
TOL_ALIGN_VARIANCE = 4      # x-position difference (px) below this is fine
TOL_HEIGHT_VARIANCE = 4     # component height diff below this is acceptable
TOL_FONT_SIZE_VARIANCE = 1  # px — outlier font sizes within 1px of mode are fine
TOL_OUTLIER_RATIO = 0.15    # value must appear in <=15% of samples to be an "outlier"
MIN_SAMPLES = 3             # need at least this many samples to reason about consistency
MIN_FONT_SIZE_PX = 12
EXCESSIVE_FONT_VARIANTS = 6
EXCESSIVE_FAMILIES = 3
EXCESSIVE_WEIGHTS = 5
EXCESSIVE_TEXT_COLORS = 8

MAX_FINDINGS_PER_KIND = 10

_COLLECT_JS = """
() => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const selectorFor = (el) => {
    if (el.id) return '#' + el.id;
    const cls = (el.className || '').toString().trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const pxInt = (s) => {
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n);
  };

  const CAP = 60;

  function sampleTypography(selector, cap) {
    const results = [];
    document.querySelectorAll(selector).forEach((el) => {
      if (results.length >= cap || !isVisible(el)) return;
      const s = getComputedStyle(el);
      results.push({
        selector: selectorFor(el),
        fontFamily: s.fontFamily, fontSize: pxInt(s.fontSize),
        fontWeight: s.fontWeight, color: s.color,
      });
    });
    return results;
  }

  function sampleComponents(selector, cap) {
    const results = [];
    document.querySelectorAll(selector).forEach((el) => {
      if (results.length >= cap || !isVisible(el)) return;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      results.push({
        selector: selectorFor(el),
        width: Math.round(r.width), height: Math.round(r.height), x: Math.round(r.x),
        paddingTop: pxInt(s.paddingTop), paddingRight: pxInt(s.paddingRight),
        paddingBottom: pxInt(s.paddingBottom), paddingLeft: pxInt(s.paddingLeft),
        marginTop: pxInt(s.marginTop), marginRight: pxInt(s.marginRight),
        marginBottom: pxInt(s.marginBottom), marginLeft: pxInt(s.marginLeft),
        borderRadius: s.borderRadius, backgroundColor: s.backgroundColor, color: s.color,
      });
    });
    return results;
  }

  function measureGaps(selector, cap) {
    const els = Array.from(document.querySelectorAll(selector)).filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .slice(0, cap);
    const gaps = [];
    for (let i = 1; i < els.length; i++) {
      const prev = els[i - 1].getBoundingClientRect();
      const curr = els[i].getBoundingClientRect();
      const gap = Math.round(curr.top - prev.bottom);
      if (gap >= 0 && gap < 500) gaps.push(gap);
    }
    return gaps;
  }

  function measureAlignment(selector, cap) {
    return Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(0, cap)
      .map((el) => ({ selector: selectorFor(el), x: Math.round(el.getBoundingClientRect().x) }));
  }

  return {
    typography: {
      body: sampleTypography('p,li,td,dd', CAP),
      headings: sampleTypography('h1,h2,h3,h4,h5,h6', CAP),
      links: sampleTypography('a', CAP),
      labels: sampleTypography('label,legend,th,dt', CAP),
    },
    components: {
      buttons: sampleComponents('button,input[type=submit],input[type=button],[role=button]', CAP),
      inputs: sampleComponents('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea', CAP),
      cards: sampleComponents('article,[class*=card],[class*=Card],[class*=item],[class*=Item]', CAP),
      listItems: sampleComponents('li', CAP),
    },
    gaps: {
      betweenListItems: measureGaps('li', 40),
      betweenCards: measureGaps('[class*=card],[class*=Card],[class*=item]', 30),
      betweenButtons: measureGaps('button,[role=button]', 20),
    },
    alignment: {
      buttons: measureAlignment('button,[role=button]', 30),
      inputs: measureAlignment('input:not([type=hidden]),select', 30),
    },
  };
}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Finding helper
# ─────────────────────────────────────────────────────────────────────────────

def _finding(finding_id: str, severity: str, title: str, description: str,
             recommendation: str, evidence: dict, confidence: float) -> dict:
    return {
        "id": finding_id,
        "category": "ui-consistency",
        "severity": severity,
        "title": title,
        "description": description,
        "recommendation": recommendation,
        "evidence": evidence,
        "confidence": confidence,
        "source": "python-ui-consistency",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Statistics helpers — deterministic frequency/outlier analysis
# ─────────────────────────────────────────────────────────────────────────────

def _freq_map(values: list) -> dict:
    freq: dict = {}
    for v in values:
        if v is None:
            continue
        freq[v] = freq.get(v, 0) + 1
    return freq


def _mode(freq: dict):
    if not freq:
        return None
    return max(freq.items(), key=lambda kv: kv[1])[0]


def _sorted_entries(freq: dict, limit: int | None = None) -> list:
    items = sorted(freq.items(), key=lambda kv: -kv[1])
    return items[:limit] if limit else items


def _primary_font(family: str | None) -> str | None:
    if not family:
        return None
    return family.split(",")[0].strip().strip("'\"").lower()


def _numeric_outliers(labeled_values: list[tuple[str, float]], tolerance: float,
                       outlier_ratio: float = TOL_OUTLIER_RATIO) -> list[tuple[str, float, float]]:
    """
    labeled_values: [(selector, value), ...]. Returns [(selector, value, modeValue), ...]
    for values that differ from the mode by more than `tolerance` AND appear in
    <= outlier_ratio fraction of samples (so a genuine 50/50 split — e.g. two
    equally common button sizes — is never flagged; only true rarities are).
    """
    if len(labeled_values) < MIN_SAMPLES:
        return []
    values = [v for _, v in labeled_values]
    freq = _freq_map(values)
    mode_val = _mode(freq)
    total = len(values)

    outliers = []
    for selector, val in labeled_values:
        count = freq[val]
        is_close = abs(val - mode_val) <= tolerance
        is_rare = (count / total) <= outlier_ratio
        if not is_close and is_rare:
            outliers.append((selector, val, mode_val))
    return outliers


# ─────────────────────────────────────────────────────────────────────────────
# 1. Typography — font family / size / weight
# ─────────────────────────────────────────────────────────────────────────────

def _check_typography(typography: dict) -> list[dict]:
    findings: list[dict] = []
    all_samples = (
        typography.get("body", []) + typography.get("headings", [])
        + typography.get("links", []) + typography.get("labels", [])
    )
    if len(all_samples) < MIN_SAMPLES:
        return findings

    # ── Font-family variety (design-system consistency signal) ─────────────
    families = [f for f in (_primary_font(s.get("fontFamily")) for s in all_samples) if f]
    family_freq = _freq_map(families)
    if len(family_freq) > EXCESSIVE_FAMILIES:
        findings.append(_finding(
            f"ui-consistency-font-family-{len(findings) + 1}",
            "high" if len(family_freq) > 5 else "medium",
            f"{len(family_freq)} different font families detected",
            f"The page uses {len(family_freq)} distinct font families across body text, headings, "
            f"links, and labels. A well-designed page typically uses 1-2.",
            "Establish a type scale with at most 2 font families: one for body, one optional for headings.",
            {"uniqueFamilies": len(family_freq), "frequencyMap": dict(_sorted_entries(family_freq, 10))},
            0.85,
        ))

    # ── Font-size variety ────────────────────────────────────────────────────
    sizes = [s["fontSize"] for s in all_samples if s.get("fontSize") is not None]
    size_freq = _freq_map(sizes)
    if len(size_freq) > EXCESSIVE_FONT_VARIANTS:
        findings.append(_finding(
            f"ui-consistency-font-size-variety-{len(findings) + 1}",
            "high" if len(size_freq) > 10 else "medium",
            f"{len(size_freq)} distinct font sizes in use",
            f"{len(size_freq)} different font sizes were measured across the page. A consistent "
            f"type scale typically uses 4-6 sizes.",
            "Define a type scale (e.g. 12/14/16/20/24/32px) and restrict text to those sizes.",
            {"uniqueSizes": len(size_freq), "frequencyMap": {str(k): v for k, v in _sorted_entries(size_freq, 15)}},
            0.8,
        ))

    # ── Isolated body font-size outliers (per-element) ──────────────────────
    body_sizes = [(s["selector"], s["fontSize"]) for s in typography.get("body", []) if s.get("fontSize") is not None]
    for selector, val, mode_val in _numeric_outliers(body_sizes, TOL_FONT_SIZE_VARIANCE)[:MAX_FINDINGS_PER_KIND]:
        findings.append(_finding(
            f"ui-consistency-font-size-outlier-{len(findings) + 1}",
            "low",
            "Isolated body font size",
            f'Most body text uses {mode_val}px, but "{selector}" uses {val}px.',
            "Review this element; use the established type scale instead of an ad-hoc size override.",
            {"commonFontSize": f"{mode_val}px", "outlierFontSize": f"{val}px", "affectedSelector": selector},
            0.65,
        ))

    # ── Minimum readable font size ───────────────────────────────────────────
    for s in all_samples:
        if s.get("fontSize") is not None and s["fontSize"] < MIN_FONT_SIZE_PX:
            findings.append(_finding(
                f"ui-consistency-font-too-small-{len(findings) + 1}",
                "medium",
                f"Font size below {MIN_FONT_SIZE_PX}px",
                f'Element "{s["selector"]}" uses a {s["fontSize"]}px font, below the {MIN_FONT_SIZE_PX}px '
                f"readability minimum.",
                "Set a minimum body font size of 14-16px; use rem units so browser zoom/scaling works.",
                {"fontSize": f'{s["fontSize"]}px', "affectedSelector": s["selector"]},
                0.9,
            ))
            if sum(1 for f in findings if f["title"].startswith("Font size below")) >= MAX_FINDINGS_PER_KIND:
                break

    # ── Font-weight variety ──────────────────────────────────────────────────
    weights = [s["fontWeight"] for s in all_samples if s.get("fontWeight")]
    weight_freq = _freq_map(weights)
    if len(weight_freq) > EXCESSIVE_WEIGHTS:
        findings.append(_finding(
            f"ui-consistency-font-weight-variety-{len(findings) + 1}",
            "low",
            f"{len(weight_freq)} distinct font weights in use",
            f"{len(weight_freq)} different font weights were found. A typical design system uses 2-3 "
            f"(e.g. 400, 500, 700).",
            "Limit font weights to 2-3 intentional levels.",
            {"uniqueWeights": len(weight_freq), "frequencyMap": dict(_sorted_entries(weight_freq))},
            0.7,
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# 2. Colors — text + background
# ─────────────────────────────────────────────────────────────────────────────

def _is_real_color(c: str | None) -> bool:
    return bool(c) and c not in ("rgba(0, 0, 0, 0)", "transparent")


def _check_colors(typography: dict, components: dict) -> list[dict]:
    findings: list[dict] = []

    # ── Text color variety ───────────────────────────────────────────────────
    text_colors = [
        s["color"] for s in (typography.get("body", []) + typography.get("headings", []))
        if _is_real_color(s.get("color"))
    ]
    color_freq = _freq_map(text_colors)
    if len(color_freq) > EXCESSIVE_TEXT_COLORS and len(text_colors) >= MIN_SAMPLES:
        findings.append(_finding(
            f"ui-consistency-text-color-variety-{len(findings) + 1}",
            "medium" if len(color_freq) > 15 else "low",
            f"{len(color_freq)} distinct text colors detected",
            f"{len(color_freq)} different text colors were found across body text and headings. A "
            f"consistent brand palette typically uses 3-5.",
            "Define a restricted text color palette (primary, secondary, disabled, link, error).",
            {"uniqueColors": len(color_freq), "topColors": dict(_sorted_entries(color_freq, 10))},
            0.75,
        ))

    # ── Button background-color outliers (per-element) ──────────────────────
    button_bgs = [
        (c["selector"], c["backgroundColor"]) for c in components.get("buttons", [])
        if _is_real_color(c.get("backgroundColor"))
    ]
    if len(button_bgs) >= MIN_SAMPLES:
        values = [v for _, v in button_bgs]
        freq = _freq_map(values)
        mode_val = _mode(freq)
        total = len(values)
        for selector, val in button_bgs:
            if freq[val] != mode_val and val != mode_val and (freq[val] / total) <= TOL_OUTLIER_RATIO:
                findings.append(_finding(
                    f"ui-consistency-button-color-outlier-{len(findings) + 1}",
                    "medium",
                    "Inconsistent primary button background color",
                    f'Most buttons use background "{mode_val}", but "{selector}" uses "{val}".',
                    "Use design-system color tokens for all buttons rather than one-off values.",
                    {"commonBackgroundColor": mode_val, "outlierBackgroundColor": val, "affectedSelector": selector},
                    0.65,
                ))
                if len([f for f in findings if "button background color" in f["title"]]) >= MAX_FINDINGS_PER_KIND:
                    break

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# 3. Repeated buttons / form controls / component dimensions
# ─────────────────────────────────────────────────────────────────────────────

def _shorthand_padding(c: dict) -> str:
    return f'{c.get("paddingTop", 0)}px {c.get("paddingRight", 0)}px {c.get("paddingBottom", 0)}px {c.get("paddingLeft", 0)}px'


def _shorthand_margin(c: dict) -> str:
    return f'{c.get("marginTop", 0)}px {c.get("marginRight", 0)}px {c.get("marginBottom", 0)}px {c.get("marginLeft", 0)}px'


def _check_component_group(items: list[dict], label: str, findings: list[dict]) -> None:
    """Height, padding, margin, and border-radius consistency for one component group (buttons/inputs/cards/list items)."""
    if len(items) < MIN_SAMPLES:
        return

    # Height
    heights = [(c["selector"], c["height"]) for c in items if c.get("height")]
    for selector, val, mode_val in _numeric_outliers(heights, TOL_HEIGHT_VARIANCE):
        findings.append(_finding(
            f"ui-consistency-{label}-height-outlier-{len(findings) + 1}",
            "medium",
            f"Inconsistent {label} height",
            f'Most {label}s are {mode_val}px tall, but "{selector}" is {val}px.',
            f"Standardize {label} height using a design token.",
            {"commonHeight": f"{mode_val}px", "outlierHeight": f"{val}px", "affectedSelector": selector},
            0.7,
        ))

    # Padding (top used as the representative value, mirrors the shorthand check)
    pad_tops = [(c["selector"], c["paddingTop"]) for c in items if c.get("paddingTop") is not None]
    outliers = _numeric_outliers(pad_tops, TOL_PX_ROUND + 2)
    by_selector = {c["selector"]: c for c in items}
    for selector, _val, _mode_val in outliers[:MAX_FINDINGS_PER_KIND]:
        common = next((c for c in items if c["paddingTop"] == _mode_val), None)
        this_c = by_selector.get(selector)
        if not common or not this_c:
            continue
        findings.append(_finding(
            f"ui-consistency-{label}-padding-outlier-{len(findings) + 1}",
            "medium",
            f"Inconsistent {label} padding",
            f'Most {label}s use padding "{_shorthand_padding(common)}", but "{selector}" uses '
            f'"{_shorthand_padding(this_c)}".',
            f"Use a design token for {label} padding; avoid one-off overrides.",
            {
                "commonPadding": _shorthand_padding(common),
                "outlierPadding": _shorthand_padding(this_c),
                "affectedSelector": selector,
            },
            0.7,
        ))

    # Margin (bottom used as the representative value — the common vertical-rhythm axis)
    margin_bottoms = [(c["selector"], c["marginBottom"]) for c in items if c.get("marginBottom") is not None]
    for selector, _val, _mode_val in _numeric_outliers(margin_bottoms, TOL_PX_ROUND + 2)[:MAX_FINDINGS_PER_KIND]:
        common = next((c for c in items if c["marginBottom"] == _mode_val), None)
        this_c = by_selector.get(selector)
        if not common or not this_c:
            continue
        findings.append(_finding(
            f"ui-consistency-{label}-margin-outlier-{len(findings) + 1}",
            "low",
            f"Inconsistent {label} margin",
            f'Most {label}s use margin "{_shorthand_margin(common)}", but "{selector}" uses '
            f'"{_shorthand_margin(this_c)}".',
            f"Use a design token for {label} margin; avoid one-off overrides.",
            {
                "commonMargin": _shorthand_margin(common),
                "outlierMargin": _shorthand_margin(this_c),
                "affectedSelector": selector,
            },
            0.6,
        ))

    # Border radius
    radii = [(c["selector"], c["borderRadius"]) for c in items if c.get("borderRadius") and c["borderRadius"] != "0px"]
    if len(radii) >= MIN_SAMPLES:
        values = [v for _, v in radii]
        freq = _freq_map(values)
        mode_val = _mode(freq)
        total = len(values)
        for selector, val in radii:
            if val != mode_val and (freq[val] / total) <= TOL_OUTLIER_RATIO:
                findings.append(_finding(
                    f"ui-consistency-{label}-radius-outlier-{len(findings) + 1}",
                    "low",
                    f"Inconsistent {label} border radius",
                    f'Most {label}s use border-radius "{mode_val}", but "{selector}" uses "{val}".',
                    f"Use a single border-radius value for all {label}s (exceptions should be deliberate).",
                    {"commonBorderRadius": mode_val, "outlierBorderRadius": val, "affectedSelector": selector},
                    0.65,
                ))
                if len([f for f in findings if f"Inconsistent {label} border radius" == f["title"]]) >= MAX_FINDINGS_PER_KIND:
                    break


def _check_card_dimension_variance(cards: list[dict]) -> list[dict]:
    findings: list[dict] = []
    heights = [c["height"] for c in cards if c.get("height") and c["height"] > 20]
    if len(heights) < MIN_SAMPLES:
        return findings
    mean = sum(heights) / len(heights)
    variance = sum((h - mean) ** 2 for h in heights) / len(heights)
    stdev = variance ** 0.5
    rng = max(heights) - min(heights)
    if rng > 60 and stdev > 30:
        findings.append(_finding(
            "ui-consistency-card-dimension-variance-1",
            "low",
            f"High card height variance (range {rng}px)",
            f"Card component heights range from {min(heights)}px to {max(heights)}px (stdev {round(stdev, 1)}px). "
            f"High variance may indicate content overflow or a missing min-height.",
            "Use CSS grid auto-fill with a min-height, or flex-stretch for equal-height rows.",
            {"minHeight": min(heights), "maxHeight": max(heights), "range": rng, "stdev": round(stdev, 1), "sampleCount": len(heights)},
            0.6,
        ))
    return findings


# ─────────────────────────────────────────────────────────────────────────────
# 4. Gap consistency (spacing between repeated siblings)
# ─────────────────────────────────────────────────────────────────────────────

def _check_gaps(gaps: dict) -> list[dict]:
    findings: list[dict] = []

    def check_one(gap_values: list[int], label: str):
        if len(gap_values) < MIN_SAMPLES:
            return
        typical = [g for g in gap_values if g <= 80]
        if len(typical) < MIN_SAMPLES:
            return
        rng = max(typical) - min(typical)
        if rng <= TOL_GAP_VARIANCE:
            return
        bucketed = [round(g / 4) * 4 for g in typical]
        freq = _freq_map(bucketed)
        mode_gap = _mode(freq)
        outliers = [g for g in typical if abs(g - mode_gap) > TOL_GAP_VARIANCE]
        if not outliers:
            return
        findings.append(_finding(
            f"ui-consistency-gap-{label.replace(' ', '-')}-1",
            "medium" if rng > 24 else "low",
            f"Inconsistent spacing between {label}",
            f"The vertical gap between {label} varies from {min(typical)}px to {max(typical)}px "
            f"(most common: {mode_gap}px).",
            f"Set a single gap value for all {label} using CSS gap or a spacing token.",
            {
                "commonGap": f"{mode_gap}px",
                "outlierGaps": [f"{g}px" for g in sorted(set(outliers))[:10]],
                "range": f"{rng}px",
                "sampleCount": len(typical),
            },
            0.7,
        ))

    check_one(gaps.get("betweenListItems", []), "list items")
    check_one(gaps.get("betweenCards", []), "cards")
    check_one(gaps.get("betweenButtons", []), "buttons")

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# 5. Alignment
# ─────────────────────────────────────────────────────────────────────────────

def _check_alignment(alignment: dict) -> list[dict]:
    findings: list[dict] = []

    def check_one(items: list[dict], label: str):
        if len(items) < MIN_SAMPLES:
            return
        xs = [it["x"] for it in items]
        bucketed = [round(x / TOL_ALIGN_VARIANCE) * TOL_ALIGN_VARIANCE for x in xs]
        freq = _freq_map(bucketed)
        mode_x = _mode(freq)
        misaligned = [it for it in items if abs(it["x"] - mode_x) > TOL_ALIGN_VARIANCE]
        if not misaligned:
            return
        # A majority differing means an intentional multi-column layout, not misalignment.
        if len(misaligned) / len(items) > 0.6:
            return
        for it in misaligned[:MAX_FINDINGS_PER_KIND]:
            findings.append(_finding(
                f"ui-consistency-alignment-{label.replace(' ', '-')}-{len(findings) + 1}",
                "medium" if len(misaligned) >= 3 else "low",
                f"Misaligned {label}",
                f'Most {label}s are left-aligned at ~{mode_x}px, but "{it["selector"]}" is at {it["x"]}px.',
                f"Ensure all {label}s share the same container left edge (CSS grid/flexbox with a consistent gutter).",
                {"commonX": f"{mode_x}px", "outlierX": f'{it["x"]}px', "affectedSelector": it["selector"]},
                0.6,
            ))

    check_one(alignment.get("buttons", []), "button")
    check_one(alignment.get("inputs", []), "input")

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def analyze_evidence(evidence: dict) -> list[dict]:
    """Run every deterministic frequency/outlier check against collected DOM evidence."""
    findings: list[dict] = []
    typography = evidence.get("typography", {})
    components = evidence.get("components", {})

    findings.extend(_check_typography(typography))
    findings.extend(_check_colors(typography, components))

    for label, key in (("button", "buttons"), ("input", "inputs"), ("card", "cards"), ("list item", "listItems")):
        _check_component_group(components.get(key, []), label, findings)

    findings.extend(_check_card_dimension_variance(components.get("cards", [])))
    findings.extend(_check_gaps(evidence.get("gaps", {})))
    findings.extend(_check_alignment(evidence.get("alignment", {})))

    return findings


def validate(url: str, session=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="design",
            source="ui_consistency",
            category="ui-consistency",
            title="UI consistency validation (mocked)",
            description=f"Would analyze typography/color/spacing consistency for {url}.",
            metrics={"mocked": True},
        )

    page = session.page
    if page is None:
        return ValidationResult(check="design", warnings=["ui_consistency: no page available"], metrics={})

    try:
        evidence = page.evaluate(_COLLECT_JS)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="design", errors=[f"ui_consistency: failed to inspect DOM: {exc}"])

    findings = analyze_evidence(evidence)

    return ValidationResult(
        check="design",
        findings=findings,
        metrics={
            "typographySamples": sum(len(v) for v in evidence.get("typography", {}).values()),
            "componentSamples": sum(len(v) for v in evidence.get("components", {}).values()),
            "issuesFound": len(findings),
        },
    )
