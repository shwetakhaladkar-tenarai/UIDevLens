/**
 * scoring.js
 * Deterministic 0-100 scoring. The LLM never calculates or overrides these.
 *
 * Category composition:
 *   performance   ← Lighthouse score (strong anchor) + performance & NETWORK findings
 *   design        ← design findings + RESPONSIVE findings
 *   accessibility ← axe-core score (if available) + accessibility findings
 *
 * Overall = weighted average: performance 40%, design 30%, accessibility 30%.
 *
 * Penalty model (capped so noise cannot zero a score):
 *   - Each finding contributes a per-severity penalty.
 *   - Penalty per severity BUCKET is capped (diminishing returns), so hundreds
 *     of low findings cannot drive a score to 0.
 *   - Total finding penalty is also globally capped per category.
 */

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

const OVERALL_WEIGHTS = { performance: 0.4, design: 0.3, accessibility: 0.3 };

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

// ─────────────────────────────────────────────────────────────────────────────
// Category scores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performance score.
 * Blends the Lighthouse score (strong anchor) with a finding-derived score
 * computed from performance + network findings.
 *
 * @param {object}  args
 * @param {number|null} args.lighthouseScore  0..100 (or null if unavailable)
 * @param {Array}   args.performanceFindings
 * @param {Array}   args.networkFindings       network issues influence performance
 * @returns {number} 0..100
 */
export function performanceScore({ lighthouseScore = null, performanceFindings = [], networkFindings = [] }) {
  const findingScore = scoreFromFindings([...performanceFindings, ...networkFindings]);

  if (lighthouseScore == null || isNaN(lighthouseScore)) {
    // No anchor — rely entirely on findings.
    return findingScore;
  }

  const lh = clampScore(lighthouseScore);
  const w  = ANCHOR_BLEND.performance;
  return clampScore(lh * w + findingScore * (1 - w));
}

/**
 * Design score.
 * Combines design findings + responsive findings (responsive influences design).
 *
 * @param {object} args
 * @param {Array}  args.designFindings
 * @param {Array}  args.responsiveFindings   responsive issues influence design
 * @returns {number} 0..100
 */
export function designScore({ designFindings = [], responsiveFindings = [] }) {
  return scoreFromFindings([...designFindings, ...responsiveFindings]);
}

/**
 * Accessibility score.
 * Blends the axe-core score (strong anchor) with a finding-derived score.
 *
 * @param {object} args
 * @param {number|null} args.axeScore  0..100 (or null if unavailable)
 * @param {Array}  args.accessibilityFindings
 * @returns {number} 0..100
 */
export function accessibilityScore({ axeScore = null, accessibilityFindings = [] }) {
  const findingScore = scoreFromFindings(accessibilityFindings);

  if (axeScore == null || isNaN(axeScore)) {
    return findingScore;
  }

  const axe = clampScore(axeScore);
  const w   = ANCHOR_BLEND.accessibility;
  return clampScore(axe * w + findingScore * (1 - w));
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall + orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weighted overall score: performance 40%, design 30%, accessibility 30%.
 * @param {{performance:number, design:number, accessibility:number}} c
 * @returns {number} 0..100
 */
export function overallScore({ performance, design, accessibility }) {
  const score =
    clampScore(performance)   * OVERALL_WEIGHTS.performance +
    clampScore(design)        * OVERALL_WEIGHTS.design +
    clampScore(accessibility) * OVERALL_WEIGHTS.accessibility;
  return clampScore(score);
}

/**
 * Compute the full deterministic score bundle from analyzer state.
 * This is the single entry point used by scoringNode.
 *
 * @param {object} input
 * @param {number|null} input.lighthouseScore
 * @param {number|null} input.axeScore
 * @param {Array} input.performanceFindings
 * @param {Array} input.networkFindings
 * @param {Array} input.designFindings
 * @param {Array} input.responsiveFindings
 * @param {Array} input.accessibilityFindings
 * @returns {{overall:number, performance:number, design:number, accessibility:number, label:string}}
 */
export function computeScores(input = {}) {
  const {
    lighthouseScore = null,
    axeScore = null,
    performanceFindings = [],
    networkFindings = [],
    designFindings = [],
    responsiveFindings = [],
    accessibilityFindings = [],
  } = input;

  const performance = Math.round(performanceScore({ lighthouseScore, performanceFindings, networkFindings }));
  const design      = Math.round(designScore({ designFindings, responsiveFindings }));
  const accessibility = Math.round(accessibilityScore({ axeScore, accessibilityFindings }));
  const overall     = Math.round(overallScore({ performance, design, accessibility }));

  return { overall, performance, design, accessibility, label: scoreLabel(overall) };
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
