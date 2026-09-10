/**
 * scoring.js
 * Deterministic 0-100 scoring. The LLM never calculates or overrides these
 * — computeScores() is pure arithmetic over factual findings/anchors.
 *
 * Six category scores + overall, matching the expanded architecture:
 *   functional     ← Python functional findings (links/buttons/forms/nav/console/states)
 *   accessibility  ← axe-core score (strong anchor, if available) + accessibility findings
 *                    (Node axe-core + Python wcag_validator, merged)
 *   responsive     ← responsive findings (Node design-analyzer overflow/tap-targets
 *                    split + Python responsive_validator)
 *   crossBrowser   ← Python cross_browser_validator findings
 *   performance    ← Lighthouse score (strong anchor, if available) + performance
 *                    & network findings
 *   uiConsistency  ← Node design-analyzer findings + Python ui_consistency findings
 *
 * A category that was NOT enabled by the validation plan is never scored —
 * it returns {status:"not-run"} rather than a fake number, and is excluded
 * (not just zero-weighted) from the overall-score calculation, whose
 * remaining weights are renormalized to sum to 1.
 *
 * Weights are configurable — pass `weights` to override DEFAULT_WEIGHTS
 * (e.g. from a rule profile's optional `scoring.weights`).
 *
 * Penalty model (unchanged, capped so noise cannot zero a score):
 *   - Each finding contributes a per-severity penalty.
 *   - Penalty per severity BUCKET is capped (diminishing returns), so hundreds
 *     of low findings cannot drive a score to 0.
 *   - Total finding penalty is also globally capped per category.
 */

export const CATEGORY_KEYS = [
  "functional",
  "accessibility",
  "responsive",
  "crossBrowser",
  "performance",
  "uiConsistency",
];

// ── Per-finding severity penalties ────────────────────────────────────────────
const SEVERITY_PENALTY = {
  critical: 18,
  high:     10,
  medium:    4,
  low:       1.5,
  info:      0,
};

// ── Cap on total penalty contributed by each severity bucket (per category) ────
// Diminishing returns: the Nth low-severity finding matters far less than the 1st.
const SEVERITY_BUCKET_CAP = {
  critical: 55,
  high:     45,
  medium:   30,
  low:      15,
  info:      0,
};

// ── Global cap on total finding-based penalty for any single category ─────────
const MAX_FINDING_PENALTY = 70;

// ── Weight of Lighthouse/axe anchor vs finding-derived score ──────────────────
// performance & accessibility have authoritative external scores; we blend them.
const ANCHOR_BLEND = {
  performance:   0.6,   // 60% Lighthouse score, 40% finding-derived
  accessibility: 0.6,   // 60% axe score,        40% finding-derived
};

// ── Default (configurable) overall-score weights ───────────────────────────────
// Sum to 1.0. A caller (scoringNode, from a rule profile's optional
// `scoring.weights`) may override any subset; missing keys fall back to these.
export const DEFAULT_WEIGHTS = {
  functional:    0.25,
  accessibility: 0.20,
  responsive:    0.15,
  crossBrowser:  0.10,
  performance:   0.20,
  uiConsistency: 0.10,
};

const NOT_RUN = Object.freeze({ status: "not-run" });

// ─────────────────────────────────────────────────────────────────────────────
// Penalty calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a capped total penalty from a list of findings.
 * Buckets findings by severity, applies a diminishing/capped penalty per bucket,
 * then caps the grand total.
 *
 * @param {Array<{severity:string, confidence?:number}>} findings
 * @returns {number} penalty 0..MAX_FINDING_PENALTY
 */
export function penaltyFromFindings(findings = []) {
  const buckets = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  for (const f of findings) {
    const sev = (f?.severity || "info").toLowerCase();
    if (!(sev in buckets)) continue;
    // Confidence scales the penalty (low-confidence findings hurt less).
    const confidence = typeof f?.confidence === "number" ? clamp01(f.confidence) : 1;
    buckets[sev] += (SEVERITY_PENALTY[sev] ?? 0) * confidence;
  }

  // Apply per-bucket caps, then sum.
  let total = 0;
  for (const sev of Object.keys(buckets)) {
    const capped = Math.min(buckets[sev], SEVERITY_BUCKET_CAP[sev] ?? 0);
    total += capped;
  }

  return Math.min(total, MAX_FINDING_PENALTY);
}

/**
 * Score derived purely from findings: 100 - cappedPenalty.
 * @param {Array} findings
 * @returns {number} 0..100
 */
export function scoreFromFindings(findings = []) {
  return clampScore(100 - penaltyFromFindings(findings));
}

/** Blend an authoritative external anchor (Lighthouse/axe) with a finding-derived score. */
function blendWithAnchor(anchorScore, findingScore, weight) {
  if (anchorScore == null || isNaN(anchorScore)) return findingScore;
  const anchor = clampScore(anchorScore);
  return clampScore(anchor * weight + findingScore * (1 - weight));
}

// ─────────────────────────────────────────────────────────────────────────────
// Category scores (kept as named exports — useful standalone, e.g. in tests)
// ─────────────────────────────────────────────────────────────────────────────

/** Performance score: Lighthouse anchor (if available) blended with performance+network findings. */
export function performanceScore({ lighthouseScore = null, findings = [] } = {}) {
  return blendWithAnchor(lighthouseScore, scoreFromFindings(findings), ANCHOR_BLEND.performance);
}

/** Accessibility score: axe-core anchor (if available) blended with accessibility findings. */
export function accessibilityScore({ axeScore = null, findings = [] } = {}) {
  return blendWithAnchor(axeScore, scoreFromFindings(findings), ANCHOR_BLEND.accessibility);
}

// functional / responsive / crossBrowser / uiConsistency have no external
// anchor — they're purely finding-derived. scoreFromFindings() covers them.

// ─────────────────────────────────────────────────────────────────────────────
// Overall — weighted average over ONLY the enabled categories, renormalized
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weighted overall score across whichever categories actually produced a
 * numeric score. Categories missing from `numericScores` (i.e. not-run) are
 * excluded entirely — the remaining weights are renormalized to sum to 1,
 * not just left to under-count toward a lower ceiling.
 *
 * @param {Record<string, number>} numericScores  category -> 0..100 (only enabled/run categories)
 * @param {Record<string, number>} [weights]       category -> weight (defaults to DEFAULT_WEIGHTS)
 * @returns {number} 0..100
 */
export function overallScore(numericScores = {}, weights = DEFAULT_WEIGHTS) {
  const entries = Object.entries(numericScores).filter(([, v]) => typeof v === "number");
  if (!entries.length) return 0;

  const totalWeight = entries.reduce((sum, [cat]) => sum + (weights[cat] ?? 0), 0);
  if (totalWeight <= 0) {
    // No weights configured for any enabled category — fall back to a plain mean
    // rather than divide by zero.
    return clampScore(entries.reduce((sum, [, v]) => sum + v, 0) / entries.length);
  }

  const weighted = entries.reduce((sum, [cat, v]) => sum + clampScore(v) * (weights[cat] ?? 0), 0);
  return clampScore(weighted / totalWeight);
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the full deterministic score bundle. Single entry point used by
 * scoringNode. Only include a category's findings if it's the appropriate
 * shape — see CATEGORY_KEYS for the 6 supported categories.
 *
 * @param {object} input
 * @param {Record<string, boolean>} [input.enabledCategories]  category -> whether the
 *   validation plan enabled it. A category missing here (or `undefined`) is
 *   treated as enabled by default (back-compat for simple callers); only an
 *   EXPLICIT `false` marks it not-run.
 * @param {Record<string, number>}  [input.weights]  overrides DEFAULT_WEIGHTS (configurable)
 * @param {number|null} [input.lighthouseScore]
 * @param {number|null} [input.axeScore]
 * @param {Record<string, Array>} [input.findingsByCategory]  category -> findings[]
 * @returns {{overall:number, functional:number|{status:"not-run"}, accessibility:number|{status:"not-run"}, responsive:number|{status:"not-run"}, crossBrowser:number|{status:"not-run"}, performance:number|{status:"not-run"}, uiConsistency:number|{status:"not-run"}, label:string}}
 */
export function computeScores(input = {}) {
  const {
    enabledCategories = {},
    weights = DEFAULT_WEIGHTS,
    lighthouseScore = null,
    axeScore = null,
    findingsByCategory = {},
  } = input;

  const result = {};
  const numeric = {};

  for (const category of CATEGORY_KEYS) {
    const enabled = enabledCategories[category] !== false;
    if (!enabled) {
      result[category] = NOT_RUN;
      continue;
    }

    const findings = findingsByCategory[category] ?? [];
    let score;
    if (category === "performance") {
      score = performanceScore({ lighthouseScore, findings });
    } else if (category === "accessibility") {
      score = accessibilityScore({ axeScore, findings });
    } else {
      score = scoreFromFindings(findings);
    }

    result[category] = Math.round(score);
    numeric[category] = result[category];
  }

  result.overall = Math.round(overallScore(numeric, weights));
  result.label = scoreLabel(result.overall);
  return result;
}

/**
 * Map a numeric score to a human label.
 * @param {number} score
 * @returns {string}
 */
export function scoreLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Needs Improvement";
  if (score >= 40) return "Poor";
  return "Critical";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp01(n)     { return Math.max(0, Math.min(1, n)); }
function clampScore(n)  { return Math.max(0, Math.min(100, n)); }
