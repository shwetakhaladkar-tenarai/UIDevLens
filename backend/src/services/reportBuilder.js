/**
 * reportBuilder.js
 * Assembles the final, STABLE report contract from completed graph state.
 *
 * Contract (top-level keys the React dashboard depends on):
 *   analysisId, url, timestamp, scores, metrics, executiveSummary,
 *   issues, quickWins, recommendations, metadata
 *
 * Principles:
 *  - Findings are FACTUAL evidence from the analyzers. The LLM may ANNOTATE a
 *    finding (priority, reason, rootCause, recommendation, impact, effort) but
 *    it can NEVER overwrite the factual fields (id, category, severity, title,
 *    description, evidence, confidence, source).
 *  - AI reasoning is joined to findings by findingId.
 *  - Deterministic scores are copied verbatim; the AI never changes them.
 */
import { scoreLabel } from "../utils/scoring.js";

const VIEWPORTS_TESTED = ["desktop", "tablet", "mobile"];

/**
 * @param {object} state - completed FrontendQualityState
 * @returns {object} stable report
 */
export function buildReport(state) {
  const {
    analysisId = "",
    url = "",
    scores = {},
    normalizedFindings = [],
    metrics = {},
    aiAnalysis = {},
    browserEvidence = {},
    errors = [],
    warnings = [],
    analysisStartedAt = null,
    fatal = false,
    pythonValidationResults = {},
    validationPlan = {},
  } = state;

  const timestamp = new Date().toISOString();
  const analysisDurationMs = analysisStartedAt ? Math.max(0, Date.now() - analysisStartedAt) : null;

  // ── Join AI reasoning to findings by findingId ─────────────────────────────
  const aiByFindingId = indexAiIssues(aiAnalysis.prioritizedIssues ?? []);
  const issues = buildIssues(normalizedFindings, aiByFindingId);

  // ── AI narrative availability ──────────────────────────────────────────────
  const aiUnavailable = Boolean(aiAnalysis._mocked);
  const combinedWarnings = collectWarnings(warnings, errors, aiAnalysis, aiUnavailable);

  return {
    analysisId,
    url,
    timestamp,

    scores: {
      overall:       num(scores.overall),
      performance:   num(scores.performance),
      design:        num(scores.design),
      accessibility: num(scores.accessibility),
      label:         scores.label ?? scoreLabel(num(scores.overall)),
    },

    // Flat, dashboard-friendly metrics (stable keys).
    metrics: buildMetrics(metrics),

    executiveSummary: aiAnalysis.executiveSummary ?? "",

    // Findings + AI annotations joined by findingId. Factual fields preserved.
    issues,

    quickWins:       Array.isArray(aiAnalysis.quickWins) ? aiAnalysis.quickWins : [],
    recommendations: Array.isArray(aiAnalysis.recommendations) ? aiAnalysis.recommendations : [],

    metadata: {
      analysisDurationMs,
      viewportsTested: Array.isArray(validationPlan.viewports) && validationPlan.viewports.length
        ? validationPlan.viewports
        : VIEWPORTS_TESTED,
      warnings: combinedWarnings,
      partial: fatal || combinedWarnings.length > 0,
      aiAnalysis: {
        available:      !aiUnavailable,
        partial:        Boolean(aiAnalysis._partial),
        fallbackReason: aiAnalysis._fallbackReason ?? null,
      },
      counts: buildCounts(normalizedFindings),
      fatal,
      // WCAG automated results are PARTIAL by design — never claim full
      // compliance. manualReviewRecommendations are NOT violations and are
      // never scored; they're surfaced here so a human can act on them.
      accessibility: buildAccessibilityMeta(pythonValidationResults),
      // The agentic validation plan (validationPlannerNode): which checks
      // ran and why, browsers/viewports used, and — when available — the
      // AI-suggested execution order/rationale for already-enabled checks.
      // Persisted verbatim so a reader can see exactly what was decided and
      // why, without re-deriving it from the rule profile.
      validationPlan,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Index AI prioritized issues by findingId for O(1) join. */
function indexAiIssues(prioritizedIssues) {
  const map = new Map();
  for (const it of prioritizedIssues) {
    if (it && typeof it.findingId === "string" && it.findingId) {
      // Keep the highest-priority (lowest number) if duplicated.
      const existing = map.get(it.findingId);
      if (!existing || (it.priority ?? 999) < (existing.priority ?? 999)) {
        map.set(it.findingId, it);
      }
    }
  }
  return map;
}

/**
 * Build the issues list: each factual finding, optionally annotated with AI
 * reasoning under an `ai` sub-object. Factual fields are NEVER overwritten.
 * Sorted so AI-prioritized issues surface first (by priority), then by severity.
 */
function buildIssues(findings, aiByFindingId) {
  const SEV = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

  const issues = findings.map((f) => {
    const ai = aiByFindingId.get(f.id) || null;

    return {
      // ── Factual (from analyzers — authoritative, never LLM-overwritten) ──
      id:          f.id,
      category:    f.category,
      severity:    f.severity,
      title:       f.title,
      description: f.description ?? "",
      evidence:    f.evidence ?? {},
      confidence:  typeof f.confidence === "number" ? f.confidence : null,
      source:      f.source ?? f.category,
      // Human-facing analyzer hints (also factual, from the analyzer)
      impact:         f.impact ?? null,
      recommendation: f.recommendation ?? null,
      // WCAG-specific structured fields (accessibility findings only; null otherwise)
      standard: f.standard ?? null,
      level:    f.level ?? null,
      selector: f.selector ?? null,
      // Responsive/cross-browser structured fields (null otherwise)
      browser:  f.browser ?? null,
      viewport: f.viewport ?? null,

      // ── AI annotation (advisory only; null when the LLM said nothing) ──
      ai: ai
        ? {
            priority:        ai.priority ?? null,
            reason:          ai.reason ?? null,
            likelyRootCause: ai.likelyRootCause ?? null,
            recommendation:  ai.recommendation ?? null,   // AI's suggested fix (advisory)
            impact:          ai.impact ?? null,           // low|medium|high
            effort:          ai.effort ?? null,           // low|medium|high
          }
        : null,
    };
  });

  // Sort: AI-prioritized first (ascending priority), then by severity desc,
  // then by confidence desc.
  issues.sort((a, b) => {
    const pa = a.ai?.priority ?? Infinity;
    const pb = b.ai?.priority ?? Infinity;
    if (pa !== pb) return pa - pb;
    const sv = (SEV[b.severity] ?? 0) - (SEV[a.severity] ?? 0);
    if (sv !== 0) return sv;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  return issues;
}

/** Flatten metrics into the stable dashboard shape. */
function buildMetrics(m) {
  return {
    // Core Web Vitals (stable top-level keys per the contract)
    lcp: numOrNull(m.largestContentfulPaint),
    cls: numOrNull(m.cumulativeLayoutShift),
    fcp: numOrNull(m.firstContentfulPaint),
    tbt: numOrNull(m.totalBlockingTime),

    // Volume
    requests:     numOrNull(m.totalRequests ?? m.requestCount),
    transferSize: numOrNull(m.totalPageWeight ?? m.totalBytes),

    // Extended (kept for richer dashboards; additive, non-breaking)
    ttfb:            numOrNull(m.timeToFirstByte),
    speedIndex:      numOrNull(m.speedIndex),
    tti:             numOrNull(m.timeToInteractive),
    inp:             numOrNull(m.interactionToNextPaint),
    lighthouseScore: numOrNull(m.lighthouseScore),
    javascriptBytes: numOrNull(m.javascriptBytes),
    cssBytes:        numOrNull(m.cssBytes),
    imageBytes:      numOrNull(m.imageBytes),
    renderBlockingResources: numOrNull(m.renderBlockingResources ?? m.renderBlockingCount),
  };
}

/** Finding counts by severity and category, for dashboard summary chips. */
function buildCounts(findings) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = { performance: 0, network: 0, design: 0, responsive: 0, accessibility: 0, functional: 0, "ui-consistency": 0 };
  for (const f of findings) {
    if (f.severity in bySeverity) bySeverity[f.severity] += 1;
    if (f.category in byCategory) byCategory[f.category] += 1;
  }
  return { total: findings.length, bySeverity, byCategory };
}

/**
 * Surface the Python WCAG validator's manual-review distinction into the
 * report. These are NOT findings/violations (they're not in `issues` and
 * are never scored) — they're advisory items that need a human to judge.
 */
function buildAccessibilityMeta(pythonValidationResults) {
  const a11yMetrics = pythonValidationResults?.metrics?.accessibility ?? null;
  if (!a11yMetrics) {
    return { wcagLevel: null, automatedViolations: null, manualReviewRecommendations: [] };
  }
  return {
    wcagLevel: a11yMetrics.wcagLevel ?? null,
    automatedViolations: typeof a11yMetrics.automatedViolations === "number" ? a11yMetrics.automatedViolations : null,
    manualReviewRecommendations: Array.isArray(a11yMetrics.manualReviewRecommendations)
      ? a11yMetrics.manualReviewRecommendations
      : [],
  };
}

/**
 * Merge pipeline warnings/errors + AI-availability into a single flat string[]
 * for the metadata.warnings contract.
 */
function collectWarnings(warnings, errors, aiAnalysis, aiUnavailable) {
  const out = [];
  for (const w of warnings ?? []) {
    out.push(typeof w === "string" ? w : `[${w.node ?? "pipeline"}] ${w.message ?? "warning"}`);
  }
  // Non-fatal errors also surface as warnings (fatal ones are captured too).
  for (const e of errors ?? []) {
    out.push(typeof e === "string" ? e : `[${e.node ?? "pipeline"}] ${e.message ?? "error"}`);
  }
  if (aiUnavailable) {
    out.push(`AI analysis unavailable: ${aiAnalysis._fallbackReason ?? "using deterministic results"}`);
  }
  return out;
}

function num(v)        { return typeof v === "number" ? v : 0; }
function numOrNull(v)  { return typeof v === "number" ? v : null; }
