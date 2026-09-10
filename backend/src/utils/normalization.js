/**
 * normalization.js
 * Combines findings from all analyzers into a single unified list.
 *
 * Categories: performance | network | design | responsive | accessibility |
 *             functional | ui-consistency | cross-browser
 *
 * Unified finding shape (expanded architecture):
 * {
 *   id:          string,
 *   category:    "performance"|"network"|"design"|"responsive"|"accessibility"|"functional"|"ui-consistency"|"cross-browser",
 *   severity:    "critical"|"high"|"medium"|"low"|"info",
 *   title:       string,
 *   description: string,
 *   evidence:    object,
 *   confidence:  number (0-1),
 *   source:      string,
 *   // preserved passthrough (optional, kept when present):
 *   impact?:     string,
 *   recommendation?: string,
 *   browser?:    string,   // e.g. "chromium" | "firefox" | "webkit"
 *   viewport?:   string,   // e.g. "desktop" | "tablet" | "mobile"
 *   standard?:   string,   // e.g. "WCAG"
 *   rule?:       string,
 *   selector?:   string,
 *   level?:      string,
 *   threshold?:  number|string,
 * }
 *
 * Pipeline: normalize → dedupe (exact) → merge (closely related) → sort.
 * Sort order: severity (desc) → confidence (desc) → category (stable order).
 */

import { randomUUID } from "crypto";

// ── Canonical scales ──────────────────────────────────────────────────────────
const SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

const CATEGORY_ORDER = {
  performance:   1,
  accessibility: 2,
  network:       3,
  design:        4,
  responsive:    5,
  functional:    6, // sourced from the Python validation engine
  "ui-consistency": 7, // sourced from the Python validation engine (design/ui_consistency.py)
  "cross-browser": 8, // sourced from the Python validation engine (responsive/cross_browser_validator.py)
};

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_ORDER));

// ── Severity normalisation (accepts axe/lighthouse/custom vocab) ──────────────
const SEVERITY_MAP = {
  critical:      "critical",
  serious:       "high",
  high:          "high",
  moderate:      "medium",
  medium:        "medium",
  minor:         "low",
  low:           "low",
  info:          "info",
  informational: "info",
};

function normalizeSeverity(severity) {
  return SEVERITY_MAP[String(severity || "").toLowerCase()] || "info";
}

function clampConfidence(c) {
  const n = typeof c === "number" ? c : parseFloat(c);
  if (isNaN(n)) return 0.5;                 // default when unknown
  return Math.max(0, Math.min(1, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-finding normaliser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise one raw finding into the unified schema.
 * @param {object} f
 * @param {string} category
 * @returns {object}
 */
export function normalizeFinding(f = {}, category) {
  const cat = VALID_CATEGORIES.has(category)
    ? category
    : (VALID_CATEGORIES.has(f.category) ? f.category : "performance");

  const unified = {
    id:          f.id || `${cat}-${randomUUID().slice(0, 8)}`,
    category:    cat,
    severity:    normalizeSeverity(f.severity),
    title:       f.title || f.rule || f.name || "Untitled finding",
    description: f.description || f.message || "",
    evidence:    f.evidence && typeof f.evidence === "object" ? f.evidence : {},
    confidence:  clampConfidence(f.confidence),
    source:      f.source || cat,
  };

  // Preserve human-facing fields when present (not required by schema, useful downstream)
  if (f.impact)         unified.impact = f.impact;
  if (f.recommendation) unified.recommendation = f.recommendation;
  else if (f.fix)       unified.recommendation = f.fix;
  else if (f.help)      unified.recommendation = f.help;

  // Preserve WCAG-specific structured fields (python-validation/accessibility)
  // so the conformance standard/level/rule and exact DOM selector survive
  // into the final report, not just a generic title/evidence blob.
  if (f.standard) unified.standard = f.standard;
  if (f.level)    unified.level = f.level;
  if (f.rule)     unified.rule = f.rule;
  if (f.selector) unified.selector = f.selector;

  // Preserve browser/viewport (python-validation/responsive) so cross-browser
  // and responsive findings stay attributable to exactly where they occurred.
  if (f.browser)  unified.browser = f.browser;
  if (f.viewport) unified.viewport = f.viewport;

  // Preserve the configured threshold a finding violated (e.g. load-benchmark
  // p95ResponseTimeMs/errorRatePercent) — kept distinct from `evidence` so
  // consumers can read it without knowing each validator's evidence shape.
  if (f.threshold !== undefined && f.threshold !== null) unified.threshold = f.threshold;

  // Flag findings sourced from a still-mocked validator (e.g. the Python
  // engine's placeholder modules) so consumers can down-weight/label them.
  if (f.mocked) unified.mocked = true;

  return unified;
}

/**
 * Normalise an array of findings for a single category.
 * Kept for backward compatibility with per-category callers.
 * @param {Array} findings
 * @param {string} category
 * @returns {Array}
 */
export function normalizeFindings(findings = [], category) {
  return (findings || []).map((f) => normalizeFinding(f, category));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedupe — remove exact duplicates
// ─────────────────────────────────────────────────────────────────────────────

/** Build a stable signature for exact-duplicate detection */
function exactKey(f) {
  return JSON.stringify({
    category:    f.category,
    severity:    f.severity,
    title:       f.title,
    description: f.description,
    source:      f.source,
    evidence:    f.evidence,
  });
}

function dedupeExact(findings) {
  const seen = new Set();
  const out  = [];
  for (const f of findings) {
    const key = exactKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge — combine closely related findings (same category + same rule/title)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two findings are "closely related" (mergeable) when they share the same
 * category AND the same logical rule. We derive the rule key from, in order:
 *   evidence.axeRule → stripped id (trailing hash removed) → normalised title.
 * Merging keeps the higher severity + confidence and combines evidence.
 */
function mergeKey(f) {
  const rule =
    f.evidence?.axeRule ||
    stripHash(f.id) ||
    f.title.toLowerCase().replace(/\s+/g, "-");
  return `${f.category}::${rule}`;
}

/** Remove a trailing "-<8 hex>" or "-<uuid fragment>" suffix from an id */
function stripHash(id) {
  if (!id) return null;
  return String(id).replace(/-[0-9a-f]{6,}$/i, "");
}

function mergeRelated(findings) {
  const groups = new Map();

  for (const f of findings) {
    const key = mergeKey(f);
    if (!groups.has(key)) {
      groups.set(key, { ...f, _mergedCount: 1 });
      continue;
    }
    // Merge into the existing representative
    const rep = groups.get(key);
    rep._mergedCount += 1;

    // Keep the higher severity
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[rep.severity]) {
      rep.severity = f.severity;
    }
    // Keep the higher confidence
    if (f.confidence > rep.confidence) rep.confidence = f.confidence;

    // Combine evidence non-destructively under a `merged` array
    rep.evidence = combineEvidence(rep.evidence, f.evidence);
  }

  // Finalise: annotate merged groups, drop the internal counter
  return [...groups.values()].map((f) => {
    const count = f._mergedCount;
    delete f._mergedCount;
    if (count > 1) {
      f.evidence = { ...f.evidence, mergedFindingCount: count };
    }
    return f;
  });
}

/** Merge two evidence objects; nest additional occurrences under `merged` */
function combineEvidence(a = {}, b = {}) {
  const base   = { ...a };
  const merged = Array.isArray(base.merged) ? base.merged.slice() : [];
  merged.push(b);
  base.merged = merged;

  // If both carry a numeric affectedCount, sum it for a combined view
  if (typeof a.affectedCount === "number" && typeof b.affectedCount === "number") {
    base.affectedCount = a.affectedCount + b.affectedCount;
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort — severity (desc) → confidence (desc) → category (fixed order)
// ─────────────────────────────────────────────────────────────────────────────

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const sev = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (sev !== 0) return sev;

    const conf = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (conf !== 0) return conf;

    const cat = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
    if (cat !== 0) return cat;

    // Stable tiebreaker
    return String(a.title).localeCompare(String(b.title));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: combine findings from all analyzers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combine, normalise, dedupe, merge, and sort findings from every category.
 *
 * @param {object} buckets
 * @param {Array}  [buckets.performance]
 * @param {Array}  [buckets.network]
 * @param {Array}  [buckets.design]
 * @param {Array}  [buckets.responsive]
 * @param {Array}  [buckets.accessibility]
 * @param {Array}  [buckets.functional]   findings from the Python validation engine
 * @param {Array}  [buckets.uiConsistency] findings from design/ui_consistency.py (Python)
 * @param {Array}  [buckets.crossBrowser]  findings from responsive/cross_browser_validator.py (Python)
 * @param {object} [options]
 * @param {boolean} [options.merge=true]  Merge closely-related findings
 * @returns {Array} unified, sorted findings
 */
export function combineFindings(buckets = {}, options = {}) {
  const { merge = true } = options;

  // 1. Normalise every bucket into the unified schema
  const normalized = [
    ...normalizeFindings(buckets.performance,    "performance"),
    ...normalizeFindings(buckets.network,        "network"),
    ...normalizeFindings(buckets.design,         "design"),
    ...normalizeFindings(buckets.responsive,     "responsive"),
    ...normalizeFindings(buckets.accessibility,  "accessibility"),
    ...normalizeFindings(buckets.functional,     "functional"),
    ...normalizeFindings(buckets.uiConsistency,  "ui-consistency"),
    ...normalizeFindings(buckets.crossBrowser,   "cross-browser"),
  ];

  // 2. Remove exact duplicates
  const deduped = dedupeExact(normalized);

  // 3. Merge closely-related findings (optional)
  const mergedList = merge ? mergeRelated(deduped) : deduped;

  // 4. Sort by severity → confidence → category
  return sortFindings(mergedList);
}
