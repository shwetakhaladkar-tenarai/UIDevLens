/**
 * designAnalyzer.js
 * Analyzes visual design quality using DOM + computed CSS evidence from Playwright.
 *
 * Produces findings for:
 *  Typography  — font-family/size/weight frequency maps, outlier detection
 *  Color       — text/background color consistency, brand color variance
 *  Spacing     — padding/margin outliers on buttons, inputs, cards
 *  Components  — inconsistent button/input heights, border-radius outliers
 *  Layout      — misaligned elements, inconsistent card/list-item gaps
 *  Content     — clipped elements, horizontal overflow (from viewport data)
 *  Page basics — missing viewport meta, heading hierarchy, images without alt
 *
 * Rules:
 *  - Findings are only emitted when evidence is measurable.
 *  - Tolerances prevent noise (e.g. 1-2px rounding differences are ignored).
 *  - Every finding carries { category:"design", severity, evidence, confidence }.
 *  - No AI is used; all decisions are deterministic.
 */

import { randomUUID } from "crypto";
import { logger }     from "../utils/logger.js";

// ── Tolerances ────────────────────────────────────────────────────────────────
const TOL = {
  pxRound:         2,   // px differences below this are rounding noise
  gapVariance:     8,   // gap difference (px) below this is acceptable
  alignVariance:   4,   // x-position difference (px) below this is fine
  heightVariance:  4,   // component height diff below this is acceptable
  fontSizeVariance: 1,  // px — outlier font sizes within 1px of mode are fine
  outlierRatio:    0.15,// value must appear in ≤15% of samples to be "outlier"
  minSamples:      3,   // need at least 3 samples to reason about consistency
  minFontSizePx:   12,  // below this is considered "too small"
  excessiveFontVariants: 6, // more than this many distinct font sizes = chaotic
  excessiveFamilies: 3, // more than this many font families = inconsistent
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {object} browserEvidence  Full evidence from collectBrowserEvidence()
 * @returns {Promise<Array>}        Normalised design findings
 */
export async function runDesignAnalysis(url, browserEvidence = {}) {
  logger.info("[designAnalyzer] Analysing design evidence", { url });

  const de   = browserEvidence.designEvidence ?? {};
  const dom  = browserEvidence.dom            ?? {};
  const meta = browserEvidence.meta           ?? {};
  const vp   = browserEvidence.viewports      ?? {};
  const findings = [];

  // ── 1. Page basics ────────────────────────────────────────────────────────
  findings.push(...detectPageBasics(meta, dom));

  // ── 2. Typography frequency maps + outliers ───────────────────────────────
  findings.push(...detectTypographyIssues(de.typography ?? {}));

  // ── 3. Color consistency ──────────────────────────────────────────────────
  findings.push(...detectColorIssues(de.typography ?? {}, de.components ?? {}));

  // ── 4. Component consistency (buttons, inputs) ────────────────────────────
  findings.push(...detectComponentConsistency(de.components ?? {}));

  // ── 5. Spacing outliers ───────────────────────────────────────────────────
  findings.push(...detectSpacingOutliers(de.components ?? {}));

  // ── 6. Layout gap consistency ─────────────────────────────────────────────
  findings.push(...detectGapConsistency(de.gaps ?? {}));

  // ── 7. Alignment ──────────────────────────────────────────────────────────
  findings.push(...detectAlignmentIssues(de.alignment ?? {}));

  // ── 8. Clipped content ────────────────────────────────────────────────────
  findings.push(...detectClippedContent(de.clippedElements ?? []));

  // ── 9. Viewport / responsive findings ────────────────────────────────────
  findings.push(...detectViewportIssues(vp, meta));

  logger.info("[designAnalyzer] Done", { findings: findings.length });
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding factory
// ─────────────────────────────────────────────────────────────────────────────

function finding({ id, severity, title, description, impact, recommendation, evidence = {}, confidence = 1 }) {
  return {
    id:             id || `design-${randomUUID().slice(0, 8)}`,
    category:       "design",
    severity,
    title,
    description,
    impact:         impact         ?? "",
    recommendation: recommendation ?? "",
    evidence,
    confidence,
    source:         "designAnalyzer",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: statistics helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a frequency map from an array of values */
function freqMap(values) {
  const map = {};
  for (const v of values) {
    if (v == null) continue;
    map[v] = (map[v] ?? 0) + 1;
  }
  return map;
}

/** Return the mode (most common value) from a frequency map */
function mode(map) {
  let best = null, bestCount = 0;
  for (const [k, v] of Object.entries(map)) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

/** Return entries sorted descending by count */
function sortedEntries(map) {
  return Object.entries(map).sort(([, a], [, b]) => b - a);
}

/** Parse a CSS px string → number, or null */
function parsePx(str) {
  if (!str) return null;
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

/** Normalise a font-family string to the primary family name */
function primaryFont(familyStr) {
  if (!familyStr) return null;
  return familyStr.split(",")[0].trim().replace(/['"]/g, "").toLowerCase();
}

/** Given an array of numbers, return { mean, min, max, range, stdev } */
function stats(nums) {
  if (!nums.length) return { mean: null, min: null, max: null, range: null, stdev: null };
  const mean  = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min   = Math.min(...nums);
  const max   = Math.max(...nums);
  const range = max - min;
  const stdev = Math.sqrt(nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length);
  return { mean: round2(mean), min, max, range: round2(range), stdev: round2(stdev) };
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Find outlier values: values that differ from the mode by more than `tolerance`
 * AND appear in ≤ `outlierRatio` fraction of samples.
 */
function findOutliers(values, tolerance, outlierRatio = TOL.outlierRatio) {
  if (values.length < TOL.minSamples) return [];
  const map     = freqMap(values);
  const modeVal = mode(map);
  const total   = values.length;
  const modeNum = parsePx(modeVal) ?? parseFloat(modeVal);

  return Object.entries(map)
    .filter(([val, count]) => {
      const num     = parsePx(val) ?? parseFloat(val);
      const isClose = !isNaN(modeNum) && !isNaN(num) && Math.abs(num - modeNum) <= tolerance;
      const isRare  = count / total <= outlierRatio;
      return !isClose && isRare;
    })
    .map(([val, count]) => ({ value: val, count, total }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 1. Page basics
// ─────────────────────────────────────────────────────────────────────────────

function detectPageBasics(meta, dom) {
  const findings = [];

  if (!meta.viewport) {
    findings.push(finding({
      id:          "design-missing-viewport",
      severity:    "high",
      title:       "Missing viewport meta tag",
      description: 'The page has no <meta name="viewport"> tag, required for responsive rendering on mobile.',
      impact:      "Page renders at full desktop width on mobile, making it unusable on small screens.",
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
      evidence:    {},
      confidence:  1.0,
    }));
  }

  if (dom.hasMissingH1) {
    findings.push(finding({
      id:          "design-missing-h1",
      severity:    "medium",
      title:       "Page has no H1 heading",
      description: "No <h1> element was found on the page. Every page should have exactly one H1.",
      impact:      "Degrades content hierarchy, visual scanning, and SEO.",
      recommendation: "Add a single descriptive <h1> that identifies the page's primary topic.",
      evidence:    {},
      confidence:  1.0,
    }));
  }

  if (dom.missingHeadingHierarchy) {
    findings.push(finding({
      id:          "design-heading-hierarchy",
      severity:    "medium",
      title:       "Heading levels are skipped",
      description: "One or more heading levels are skipped (e.g. H1 → H3 without an H2).",
      impact:      "Makes the page hard to scan visually and breaks screen reader navigation.",
      recommendation: "Ensure headings follow a strict sequential order: H1 → H2 → H3. Never skip a level.",
      evidence:    {},
      confidence:  1.0,
    }));
  }

  if ((dom.imagesWithoutAlt ?? 0) > 0) {
    findings.push(finding({
      id:          "design-images-missing-alt",
      severity:    "medium",
      title:       `${dom.imagesWithoutAlt} image(s) missing alt text`,
      description: "Images without alt attributes degrade content fallback and accessibility.",
      impact:      "Screen reader users and search engines cannot understand the image content.",
      recommendation: "Add descriptive alt text to informative images. Use alt=\"\" for decorative images.",
      evidence:    { count: dom.imagesWithoutAlt },
      confidence:  1.0,
    }));
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 2. Typography
// ─────────────────────────────────────────────────────────────────────────────

function detectTypographyIssues(typography) {
  const findings = [];
  const allSamples = [
    ...(typography.body    ?? []),
    ...(typography.headings ?? []),
    ...(typography.links   ?? []),
    ...(typography.labels  ?? []),
  ];
  if (allSamples.length < TOL.minSamples) return findings;

  // ── Font-family frequency map ───────────────────────────────────────────
  const families     = allSamples.map(s => primaryFont(s.fontFamily)).filter(Boolean);
  const familyMap    = freqMap(families);
  const familyList   = sortedEntries(familyMap);
  const uniqueFamilies = familyList.length;

  if (uniqueFamilies > TOL.excessiveFamilies) {
    findings.push(finding({
      id:          "design-font-family-inconsistency",
      severity:    uniqueFamilies > 5 ? "high" : "medium",
      title:       `${uniqueFamilies} different font families detected`,
      description: `The page uses ${uniqueFamilies} distinct font families across body text, headings, links, and labels. A well-designed page typically uses 1–2 families.`,
      impact:      "Excessive font families create visual noise and slow page load (each extra font = a network request).",
      recommendation: "Establish a type scale with a maximum of 2 font families: one for body text and one optional for headings.",
      evidence:    { uniqueFamilies, frequencyMap: Object.fromEntries(familyList.slice(0, 10)) },
      confidence:  0.85,
    }));
  }

  // ── Font-size frequency map ─────────────────────────────────────────────
  const fontSizes    = allSamples.map(s => s.fontSize).filter(Boolean);
  const sizeMap      = freqMap(fontSizes);
  const sizeList     = sortedEntries(sizeMap);
  const uniqueSizes  = sizeList.length;

  if (uniqueSizes > TOL.excessiveFontVariants) {
    findings.push(finding({
      id:          "design-font-size-chaos",
      severity:    uniqueSizes > 10 ? "high" : "medium",
      title:       `${uniqueSizes} distinct font sizes in use`,
      description: `${uniqueSizes} different font sizes were measured across the page. A consistent type scale typically uses 4–6 sizes.`,
      impact:      "Too many font sizes create visual clutter and make the hierarchy harder to read.",
      recommendation: "Define a type scale (e.g. 12/14/16/20/24/32px or rem equivalents) and restrict all text to those sizes.",
      evidence:    { uniqueSizes, frequencyMap: Object.fromEntries(sizeList.slice(0, 15)) },
      confidence:  0.8,
    }));
  }

  // ── Outlier font sizes in body text ─────────────────────────────────────
  const bodySizes    = (typography.body ?? []).map(s => s.fontSize).filter(Boolean);
  const bodyOutliers = findOutliers(bodySizes, TOL.fontSizeVariance);
  if (bodyOutliers.length > 0 && bodySizes.length >= TOL.minSamples) {
    findings.push(finding({
      id:          "design-body-font-size-outlier",
      severity:    "low",
      title:       `Isolated font size(s) in body text: ${bodyOutliers.map(o => o.value).join(", ")}`,
      description: `Most body text uses a consistent font size, but ${bodyOutliers.length} outlier size(s) appear in very few elements.`,
      impact:      "Isolated font sizes suggest accidental overrides rather than intentional type scale decisions.",
      recommendation: "Review elements using non-standard sizes. Use the type scale consistently; remove ad-hoc px overrides.",
      evidence:    {
        dominantSize: mode(freqMap(bodySizes)),
        outliers:     bodyOutliers,
        sampleCount:  bodySizes.length,
      },
      confidence:  0.7,
    }));
  }

  // ── Minimum font size ───────────────────────────────────────────────────
  const tinyText = allSamples.filter(s => {
    const px = parsePx(s.fontSize);
    return px != null && px < TOL.minFontSizePx;
  });
  if (tinyText.length > 0) {
    findings.push(finding({
      id:          "design-font-too-small",
      severity:    "medium",
      title:       `${tinyText.length} element(s) with font size below ${TOL.minFontSizePx}px`,
      description: `${tinyText.length} text element(s) use a font size below ${TOL.minFontSizePx}px, which is hard to read especially on mobile.`,
      impact:      "Text below 12px is difficult to read without zooming, increasing user friction.",
      recommendation: `Set a minimum body font size of 14–16px. Use rem units so users can scale text in browser settings.`,
      evidence:    {
        minFound:    Math.min(...tinyText.map(s => parsePx(s.fontSize) ?? TOL.minFontSizePx)),
        count:       tinyText.length,
        samples:     tinyText.slice(0, 5).map(s => ({ tag: s.tag, fontSize: s.fontSize })),
      },
      confidence:  0.9,
    }));
  }

  // ── Font-weight frequency map ───────────────────────────────────────────
  const weights     = allSamples.map(s => s.fontWeight).filter(Boolean);
  const weightMap   = freqMap(weights);
  const weightList  = sortedEntries(weightMap);
  if (weightList.length > 5) {
    findings.push(finding({
      id:          "design-font-weight-inconsistency",
      severity:    "low",
      title:       `${weightList.length} distinct font weights in use`,
      description: `${weightList.length} different font weights were found. A typical design system uses 2–3 weights (e.g. 400, 500, 700).`,
      impact:      "Excessive weight variation weakens visual hierarchy and can look accidental.",
      recommendation: "Limit font weights to 2–3 intentional levels. Use bold (700) for headings, medium (500) for labels, regular (400) for body.",
      evidence:    { uniqueWeights: weightList.length, frequencyMap: Object.fromEntries(weightList) },
      confidence:  0.7,
    }));
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 3. Color consistency
// ─────────────────────────────────────────────────────────────────────────────

function detectColorIssues(typography, components) {
  const findings = [];

  // Collect all text colors from body + headings + links
  const textColors = [
    ...(typography.body     ?? []).map(s => s.color),
    ...(typography.headings ?? []).map(s => s.color),
  ].filter(c => c && c !== "rgba(0, 0, 0, 0)");

  const colorMap  = freqMap(textColors);
  const colorList = sortedEntries(colorMap);

  if (colorList.length > 8 && textColors.length >= TOL.minSamples) {
    findings.push(finding({
      id:          "design-text-color-inconsistency",
      severity:    colorList.length > 15 ? "medium" : "low",
      title:       `${colorList.length} distinct text colors detected`,
      description: `${colorList.length} different text colors were found across body text and headings. A consistent brand palette typically uses 3–5 text colors.`,
      impact:      "Too many text colors fragment the visual hierarchy and make content harder to scan.",
      recommendation: "Define a restricted text color palette: primary text, secondary text, disabled, link, and error. Apply these consistently.",
      evidence:    {
        uniqueColors: colorList.length,
        topColors:    Object.fromEntries(colorList.slice(0, 10)),
        sampleCount:  textColors.length,
      },
      confidence:  0.75,
    }));
  }

  // Link color consistency
  const linkColors = (typography.links ?? []).map(s => s.color).filter(Boolean);
  const linkColorMap = freqMap(linkColors);
  const linkColorList = sortedEntries(linkColorMap);
  if (linkColorList.length > 3 && linkColors.length >= TOL.minSamples) {
    const outliers = findOutliers(linkColors, 0, 0.1);
    if (outliers.length > 0) {
      findings.push(finding({
        id:          "design-link-color-inconsistency",
        severity:    "low",
        title:       `Links use ${linkColorList.length} different colors`,
        description: `${linkColorList.length} distinct link colors found. Inconsistent link colors make it unclear what is interactive.`,
        impact:      "Users may not recognise all links, reducing discoverability of interactive content.",
        recommendation: "Use one consistent color for all links. Differentiate visited/hover/focus states with the same hue at different opacities.",
        evidence:    { uniqueColors: linkColorList.length, colorMap: Object.fromEntries(linkColorList.slice(0, 8)) },
        confidence:  0.7,
      }));
    }
  }

  // Button background-color consistency
  const btnBgs = (components.buttons ?? []).map(s => s.backgroundColor)
    .filter(c => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent");
  if (btnBgs.length >= TOL.minSamples) {
    const btnBgMap   = freqMap(btnBgs);
    const btnBgList  = sortedEntries(btnBgMap);
    const outliers   = findOutliers(btnBgs, 0, TOL.outlierRatio);
    if (outliers.length > 0) {
      findings.push(finding({
        id:          "design-button-color-outlier",
        severity:    "low",
        title:       `Isolated button background color(s): ${outliers.map(o => o.value).join("; ")}`,
        description: `Most buttons share a consistent background color, but ${outliers.length} button(s) use an unexpected color.`,
        impact:      "Inconsistent button colors weaken the visual affordance of primary actions.",
        recommendation: "Review one-off button colors. Ensure they use design-system color tokens rather than ad-hoc hex values.",
        evidence:    {
          dominant: mode(btnBgMap),
          outliers,
          sampleCount: btnBgs.length,
          colorMap: Object.fromEntries(btnBgList.slice(0, 8)),
        },
        confidence:  0.65,
      }));
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 4. Component consistency (buttons, inputs)
// ─────────────────────────────────────────────────────────────────────────────

function detectComponentConsistency(components) {
  const findings = [];

  // ── Button height consistency ──────────────────────────────────────────
  const btnHeights = (components.buttons ?? []).map(c => c.height).filter(h => h != null && h > 0);
  if (btnHeights.length >= TOL.minSamples) {
    const heightMap  = freqMap(btnHeights);
    const modeHeight = parseFloat(mode(heightMap));
    const outliers   = btnHeights.filter(h => Math.abs(h - modeHeight) > TOL.heightVariance);
    if (outliers.length > 0 && outliers.length / btnHeights.length <= 0.4) {
      findings.push(finding({
        id:          "design-button-height-inconsistency",
        severity:    outliers.length >= 3 ? "medium" : "low",
        title:       `Button heights are inconsistent (${outliers.length} of ${btnHeights.length} deviate)`,
        description: `Most buttons are ${modeHeight}px tall, but ${outliers.length} button(s) use different heights: ${[...new Set(outliers)].join(", ")}px.`,
        impact:      "Inconsistent button heights disrupt visual rhythm and make the UI feel unpolished.",
        recommendation: "Standardise all buttons to a single height per size variant. Use a design token (e.g. --btn-height-md: 40px).",
        evidence:    {
          modeHeight,
          outlierHeights: [...new Set(outliers)],
          heightMap:      Object.fromEntries(sortedEntries(heightMap).slice(0, 8)),
          sampleCount:    btnHeights.length,
        },
        confidence:  0.8,
      }));
    }
  }

  // ── Button border-radius consistency ──────────────────────────────────
  const btnRadii = (components.buttons ?? []).map(c => c.borderRadius).filter(Boolean);
  if (btnRadii.length >= TOL.minSamples) {
    const radiusMap  = freqMap(btnRadii);
    const modeRadius = mode(radiusMap);
    const outliers   = findOutliers(btnRadii, TOL.pxRound, TOL.outlierRatio);
    if (outliers.length > 0) {
      findings.push(finding({
        id:          "design-button-radius-outlier",
        severity:    "low",
        title:       `Inconsistent button border-radius: ${outliers.map(o => o.value).join(", ")}`,
        description: `Most buttons use border-radius "${modeRadius}", but ${outliers.length} button(s) use a different radius.`,
        impact:      "Inconsistent border-radius on buttons breaks visual cohesion.",
        recommendation: "Use a single border-radius value for all primary buttons. Exceptions should be deliberate (e.g. circular icon buttons).",
        evidence:    {
          dominant: modeRadius,
          outliers,
          radiusMap: Object.fromEntries(sortedEntries(radiusMap).slice(0, 8)),
        },
        confidence:  0.75,
      }));
    }
  }

  // ── Input height consistency ───────────────────────────────────────────
  const inputHeights = (components.inputs ?? []).map(c => c.height).filter(h => h != null && h > 0);
  if (inputHeights.length >= TOL.minSamples) {
    const heightMap  = freqMap(inputHeights);
    const modeHeight = parseFloat(mode(heightMap));
    const outliers   = inputHeights.filter(h => Math.abs(h - modeHeight) > TOL.heightVariance);
    if (outliers.length > 0 && outliers.length / inputHeights.length <= 0.4) {
      findings.push(finding({
        id:          "design-input-height-inconsistency",
        severity:    "low",
        title:       `Form input heights are inconsistent (${outliers.length} of ${inputHeights.length} deviate)`,
        description: `Most inputs are ${modeHeight}px tall, but ${outliers.length} input(s) have different heights.`,
        impact:      "Inconsistent input heights make forms look misaligned and unfinished.",
        recommendation: "Standardise all text inputs to a single height. Use CSS custom properties for control heights.",
        evidence:    { modeHeight, outliers: [...new Set(outliers)], sampleCount: inputHeights.length },
        confidence:  0.75,
      }));
    }
  }

  // ── Card dimensions ────────────────────────────────────────────────────
  const cardHeights = (components.cards ?? []).map(c => c.height).filter(h => h != null && h > 20);
  if (cardHeights.length >= TOL.minSamples) {
    const s = stats(cardHeights);
    if (s.range != null && s.range > 60 && s.stdev != null && s.stdev > 30) {
      findings.push(finding({
        id:          "design-card-height-variance",
        severity:    "low",
        title:       `High card height variance (range: ${s.range}px, stdev: ${s.stdev}px)`,
        description: `Card component heights range from ${s.min}px to ${s.max}px. High variance may indicate content overflow or missing min-height constraints.`,
        impact:      "Variable card heights can break grid alignment and look unbalanced.",
        recommendation: "Consider using CSS grid with auto-fill cards, or set a min-height on cards. Use flex-stretch for equal-height rows.",
        evidence:    { ...s, sampleCount: cardHeights.length },
        confidence:  0.6,
      }));
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 5. Spacing outliers
// ─────────────────────────────────────────────────────────────────────────────

function detectSpacingOutliers(components) {
  const findings = [];

  // Helper: detect outlier padding in a component group
  function checkPadding(items, componentName, id) {
    if (!items || items.length < TOL.minSamples) return;

    // Use paddingTop as representative (usually the most intentionally set)
    const padTops = items.map(c => c.paddingTop).filter(p => p != null);
    if (padTops.length < TOL.minSamples) return;

    const padMap    = freqMap(padTops);
    const modeVal   = parseFloat(mode(padMap));
    const outliers  = padTops.filter(p => Math.abs(p - modeVal) > TOL.pxRound + 2);

    if (outliers.length > 0 && outliers.length / padTops.length <= TOL.outlierRatio + 0.1) {
      findings.push(finding({
        id,
        severity:    "low",
        title:       `Inconsistent ${componentName} padding (${outliers.length} outlier(s))`,
        description: `Most ${componentName}s have ${modeVal}px top-padding, but ${outliers.length} use different values: ${[...new Set(outliers)].join(", ")}px.`,
        impact:      `Inconsistent padding makes ${componentName}s look misaligned when placed side-by-side.`,
        recommendation: `Use a design token for ${componentName} padding. Avoid one-off overrides.`,
        evidence:    {
          dominant:    modeVal,
          outliers:    [...new Set(outliers)],
          paddingMap:  Object.fromEntries(sortedEntries(padMap).slice(0, 8)),
          sampleCount: padTops.length,
        },
        confidence:  0.7,
      }));
    }
  }

  checkPadding(components.buttons,  "button",    "design-button-padding-outlier");
  checkPadding(components.inputs,   "input",     "design-input-padding-outlier");
  checkPadding(components.cards,    "card",      "design-card-padding-outlier");
  checkPadding(components.listItems,"list item", "design-list-item-padding-outlier");

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 6. Gap (spacing between repeated elements)
// ─────────────────────────────────────────────────────────────────────────────

function detectGapConsistency(gaps) {
  const findings = [];

  function checkGaps(gapArray, label, id) {
    if (!gapArray || gapArray.length < TOL.minSamples) return;
    const s = stats(gapArray);
    if (s.range == null || s.range <= TOL.gapVariance) return;

    // Filter out structural gaps (very large) — only look at typical spacing gaps
    const typical = gapArray.filter(g => g <= 80);
    if (typical.length < TOL.minSamples) return;
    const ts = stats(typical);
    if (ts.range == null || ts.range <= TOL.gapVariance) return;

    const gapMap    = freqMap(typical.map(g => Math.round(g / 4) * 4)); // bucket to nearest 4px
    const modeGap   = mode(gapMap);
    const outliers  = typical.filter(g => Math.abs(g - parseFloat(modeGap)) > TOL.gapVariance);

    if (outliers.length === 0) return;

    findings.push(finding({
      id,
      severity:    ts.range > 24 ? "medium" : "low",
      title:       `Inconsistent spacing between ${label} (range: ${ts.range}px)`,
      description: `The vertical gap between ${label} varies from ${ts.min}px to ${ts.max}px. Consistent spacing signals design intent.`,
      impact:      "Variable gaps between repeated elements make lists and grids look misaligned.",
      recommendation: `Set a single gap value for all ${label} using CSS gap, margin, or a spacing token. Prefer CSS grid/flexbox gap over individual margins.`,
      evidence:    {
        gapMin:     ts.min,
        gapMax:     ts.max,
        gapRange:   ts.range,
        gapMean:    ts.mean,
        modeGap:    parseFloat(modeGap),
        outlierGaps: outliers.slice(0, 10),
        sampleCount: typical.length,
      },
      confidence:  0.7,
    }));
  }

  checkGaps(gaps.betweenListItems, "list items",    "design-list-gap-inconsistency");
  checkGaps(gaps.betweenCards,     "cards",          "design-card-gap-inconsistency");
  checkGaps(gaps.betweenHeadings,  "headings",       "design-heading-gap-inconsistency");
  checkGaps(gaps.betweenButtons,   "buttons",        "design-button-gap-inconsistency");
  checkGaps(gaps.betweenInputs,    "form inputs",    "design-input-gap-inconsistency");

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 7. Alignment
// ─────────────────────────────────────────────────────────────────────────────

function detectAlignmentIssues(alignment) {
  const findings = [];

  function checkAlignment(xPositions, label, id) {
    if (!xPositions || xPositions.length < TOL.minSamples) return;

    const xMap   = freqMap(xPositions.map(x => Math.round(x / TOL.alignVariance) * TOL.alignVariance));
    const modeX  = parseFloat(mode(xMap));
    const misaligned = xPositions.filter(x => Math.abs(x - modeX) > TOL.alignVariance);

    if (misaligned.length === 0) return;
    if (misaligned.length / xPositions.length > 0.6) return; // majority differs = intentional multi-column layout

    findings.push(finding({
      id,
      severity:    misaligned.length >= 3 ? "medium" : "low",
      title:       `${misaligned.length} ${label}(s) appear misaligned`,
      description: `Most ${label}s are left-aligned at ~${modeX}px, but ${misaligned.length} deviate by more than ${TOL.alignVariance}px.`,
      impact:      "Misaligned elements disrupt the visual grid and make the UI look unfinished.",
      recommendation: `Ensure all ${label}s share the same container left edge. Use CSS grid or flexbox with a consistent column gutter.`,
      evidence:    {
        modeX,
        tolerance:     TOL.alignVariance,
        misalignedX:   misaligned.slice(0, 10),
        allPositions:  xPositions.slice(0, 20),
        sampleCount:   xPositions.length,
      },
      confidence:  0.65,
    }));
  }

  checkAlignment(alignment.buttons,    "button",   "design-button-alignment");
  checkAlignment(alignment.inputs,     "input",    "design-input-alignment");
  checkAlignment(alignment.headings,   "heading",  "design-heading-alignment");
  checkAlignment(alignment.paragraphs, "paragraph","design-paragraph-alignment");

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 8. Clipped content
// ─────────────────────────────────────────────────────────────────────────────

function detectClippedContent(clippedElements) {
  if (!clippedElements || clippedElements.length === 0) return [];

  const significant = clippedElements.filter(c =>
    c.scrollHeight - c.clientHeight > 20   // ignore tiny overflow (1-2 lines)
  );
  if (!significant.length) return [];

  return [finding({
    id:          "design-clipped-content",
    severity:    significant.length >= 3 ? "medium" : "low",
    title:       `${significant.length} element(s) have content clipped by overflow:hidden`,
    description: `${significant.length} container(s) have scrollHeight > clientHeight with overflow:hidden, meaning their content is cut off.`,
    impact:      "Users cannot see or access clipped content, leading to incomplete information and broken layouts.",
    recommendation: "Review these containers. Use overflow:auto or remove the fixed height constraint. Consider expandable sections if content is intentionally hidden.",
    evidence:    {
      count:   significant.length,
      samples: significant.slice(0, 8).map(c => ({
        tag:          c.tag,
        class:        c.class,
        clientHeight: c.clientHeight,
        scrollHeight: c.scrollHeight,
        clippedPx:    c.scrollHeight - c.clientHeight,
        x:            c.x,
        y:            c.y,
      })),
    },
    confidence:  0.85,
  })];
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection — 9. Viewport / responsive issues
// ─────────────────────────────────────────────────────────────────────────────

function detectViewportIssues(viewports, meta) {
  const findings = [];
  if (!viewports) return findings;

  // ── Horizontal overflow per viewport ──────────────────────────────────
  for (const [vpName, vpData] of Object.entries(viewports)) {
    if (!vpData) continue;

    if (vpData.hasHorizontalOverflow && (vpData.overflowAmount ?? 0) > 4) {
      findings.push(finding({
        id:          `design-overflow-${vpName}`,
        severity:    vpName === "mobile" ? "high" : "medium",
        title:       `Horizontal overflow on ${vpName} viewport (+${vpData.overflowAmount}px)`,
        description: `At ${vpData.viewport?.width}px width the page content overflows by ${vpData.overflowAmount}px horizontally.`,
        impact:      "Causes unwanted horizontal scrolling, breaks the layout, and makes the page unusable on " + vpName + " devices.",
        recommendation: "Add max-width:100% to images and containers. Avoid fixed-pixel widths wider than the viewport. Use overflow-x:hidden on body only as a last resort.",
        evidence:    {
          viewport:       vpData.viewport,
          overflowAmount: vpData.overflowAmount,
          docWidth:       vpData.documentDimensions?.width,
        },
        confidence:  0.95,
      }));
    }

    // ── Elements wider than viewport ─────────────────────────────────────
    if ((vpData.widerThanViewport ?? []).length > 0) {
      findings.push(finding({
        id:          `design-elements-wider-${vpName}`,
        severity:    vpName === "mobile" ? "high" : "medium",
        title:       `${vpData.widerThanViewport.length} element(s) wider than the ${vpName} viewport`,
        description: `${vpData.widerThanViewport.length} element(s) exceed the ${vpData.viewport?.width}px viewport width.`,
        impact:      "Wide elements cause layout breakage and horizontal scrolling.",
        recommendation: "Add max-width:100% or width:100% to these elements. Replace fixed-pixel widths with percentage or max-width values.",
        evidence:    {
          viewport:  vpData.viewport,
          elements:  vpData.widerThanViewport.slice(0, 10),
        },
        confidence:  0.9,
      }));
    }

    // ── Fixed-width layout problems ───────────────────────────────────────
    if ((vpData.fixedWidthProblems ?? []).length > 0) {
      findings.push(finding({
        id:          `design-fixed-width-${vpName}`,
        severity:    vpName === "mobile" ? "high" : "medium",
        title:       `${vpData.fixedWidthProblems.length} element(s) with fixed px width wider than ${vpName} viewport`,
        description: `${vpData.fixedWidthProblems.length} element(s) use inline style width values wider than the ${vpData.viewport?.width}px viewport.`,
        impact:      "Fixed-pixel widths break responsive layouts on smaller screens.",
        recommendation: "Replace fixed-pixel widths with max-width, width:100%, or fluid CSS units (%, vw, fr).",
        evidence:    {
          viewport:  vpData.viewport,
          problems:  vpData.fixedWidthProblems.slice(0, 10),
        },
        confidence:  0.9,
      }));
    }

    // ── Small tap targets (raise on mobile only) ──────────────────────────
    if (vpName === "mobile" && (vpData.smallTapTargets ?? []).length > 3) {
      findings.push(finding({
        id:          "design-small-tap-targets",
        severity:    "medium",
        title:       `${vpData.smallTapTargets.length} interactive element(s) with tap targets below 44×44px`,
        description: `${vpData.smallTapTargets.length} buttons/links/inputs have touch targets smaller than Apple/Google's recommended 44×44px minimum.`,
        impact:      "Small tap targets cause accidental taps, frustrating mobile users and increasing error rates.",
        recommendation: "Increase button/link minimum size to 44×44px. Use padding to expand the clickable area without changing the visual size.",
        evidence:    {
          count:   vpData.smallTapTargets.length,
          samples: vpData.smallTapTargets.slice(0, 10),
        },
        confidence:  0.85,
      }));
    }

    // ── Overlapping elements ──────────────────────────────────────────────
    if ((vpData.overlaps ?? []).length > 0) {
      findings.push(finding({
        id:          `design-overlapping-elements-${vpName}`,
        severity:    "medium",
        title:       `${vpData.overlaps.length} overlapping element pair(s) on ${vpName} viewport`,
        description: `${vpData.overlaps.length} pair(s) of sibling elements overlap at the ${vpName} breakpoint.`,
        impact:      "Overlapping elements obscure content and indicate layout breakage.",
        recommendation: "Review the layout at this breakpoint. Use z-index intentionally, or fix the positioning/sizing that causes the overlap.",
        evidence:    {
          viewport:  vpData.viewport,
          overlaps:  vpData.overlaps.slice(0, 5),
        },
        confidence:  0.8,
      }));
    }
  }

  return findings;
}
