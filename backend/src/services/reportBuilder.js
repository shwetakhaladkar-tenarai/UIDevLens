/**
 * reportBuilder.js
 * Assembles the final, STABLE report contract from completed graph state.
 *
 * Contract (top-level keys the React dashboard depends on):
 *   analysisId, url, timestamp, applicationProfile, scores, metrics,
 *   executiveSummary, majorRisks, issues, crossBrowserSummary,
 *   accessibilitySummary, performanceSummary, quickWins, recommendations,
 *   metadata (including metadata.accessibility and metadata.loadTest)
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
    targetProfile = {},
    ruleProfile = {},
  } = state;

  const timestamp = new Date().toISOString();
  const analysisDurationMs = analysisStartedAt ? Math.max(0, Date.now() - analysisStartedAt) : null;

  // ── Join AI reasoning to findings by findingId ─────────────────────────────
  const aiByFindingId = indexAiIssues(aiAnalysis.prioritizedIssues ?? []);
  const issues = buildIssues(normalizedFindings, aiByFindingId);

  // ── AI narrative availability ──────────────────────────────────────────────
  const aiUnavailable = Boolean(aiAnalysis._mocked);
  const combinedWarnings = collectWarnings(warnings, errors, aiAnalysis, aiUnavailable);
  const degradedWarnings = combinedWarnings.filter((w) => !isAdvisoryWarning(w));

  return {
    analysisId,
    url,
    timestamp,

    // Deterministic target classification (applicationProfilerNode) + the
    // rule profile it selected (ruleProfileNode) — never AI-derived.
    applicationProfile: {
      targetType: targetProfile.targetType ?? "unknown",
      confidence: typeof targetProfile.confidence === "number" ? targetProfile.confidence : null,
      ruleProfileId: ruleProfile.id ?? null,
      ruleProfileDescription: ruleProfile.description ?? null,
    },

    // Six category scores + overall (see scoring.js). Each category is
    // EITHER a 0-100 number OR {status:"not-run"} when the validation plan
    // didn't enable it — never a fake number standing in for "didn't run".
    scores: {
      overall:       num(scores.overall),
      functional:    passScore(scores.functional),
      accessibility: passScore(scores.accessibility),
      responsive:    passScore(scores.responsive),
      crossBrowser:  passScore(scores.crossBrowser),
      performance:   passScore(scores.performance),
      uiConsistency: passScore(scores.uiConsistency),
      label:         scores.label ?? scoreLabel(num(scores.overall)),
    },

    // Flat, dashboard-friendly metrics (stable keys).
    metrics: buildMetrics(metrics),

    executiveSummary: aiAnalysis.executiveSummary ?? "",
    majorRisks:       Array.isArray(aiAnalysis.majorRisks) ? aiAnalysis.majorRisks : [],

    // Findings + AI annotations joined by findingId. Factual fields preserved.
    issues,

    // Per-category AI narrative summaries (advisory; grounded only in the
    // structured evidence sent to aiReasoningNode — never invented).
    crossBrowserSummary:  aiAnalysis.crossBrowserSummary ?? "",
    accessibilitySummary: aiAnalysis.accessibilitySummary ?? "",
    performanceSummary:   aiAnalysis.performanceSummary ?? "",

    quickWins:       Array.isArray(aiAnalysis.quickWins) ? aiAnalysis.quickWins : [],
    recommendations: Array.isArray(aiAnalysis.recommendations) ? aiAnalysis.recommendations : [],

    metadata: {
      analysisDurationMs,
      viewportsTested: Array.isArray(validationPlan.viewports) && validationPlan.viewports.length
        ? validationPlan.viewports
        : VIEWPORTS_TESTED,
      warnings: combinedWarnings,
      // "partial" means something genuinely failed to run (fatal error, a
      // validator crashing/timing out, AI reasoning falling back). It does
      // NOT mean "there's an informational caveat" — e.g. the WCAG check's
      // permanent "this doesn't guarantee full compliance" disclaimer, or
      // load testing being safely skipped because it wasn't approved, are
      // both expected on nearly every real run and would make "Partial
      // report" show constantly if counted here. Those are still listed in
      // `warnings` above for transparency; they just don't flip this flag.
      partial: fatal || degradedWarnings.length > 0,
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
      // Approved load-benchmark results (python-validation/performance/load_benchmark.py).
      // Only ever populated when the rule profile's performance.loadTest had
      // BOTH `enabled` and `approved` literally true — see loadTest.executed.
      loadTest: buildLoadTestMeta(pythonValidationResults),
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
      rule:     f.rule ?? null,
      selector: f.selector ?? null,
      // Responsive/cross-browser structured fields (null otherwise)
      browser:  f.browser ?? null,
      viewport: f.viewport ?? null,
      // The configured threshold this finding violated, e.g. load-benchmark
      // p95ResponseTimeMs/errorRatePercent (null otherwise)
      threshold: f.threshold ?? null,

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
  const byCategory = { performance: 0, network: 0, design: 0, responsive: 0, accessibility: 0, functional: 0, "ui-consistency": 0, "cross-browser": 0 };
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
 * Surface the Python load-benchmark validator's results (if it ran) into the
 * report. Never fabricated: `executed` is false whenever the two-factor
 * enabled+approved gate wasn't cleared, and `results` is only ever the raw
 * per-user-count metrics load_benchmark.py itself measured.
 */
function buildLoadTestMeta(pythonValidationResults) {
  const lt = pythonValidationResults?.metrics?.performance?.loadTest ?? null;
  if (!lt) {
    return { executed: false, reason: "Load benchmarking did not run for this analysis.", usersTested: [], durationSecondsRequested: null, thresholds: {}, results: {} };
  }
  return {
    executed: Boolean(lt.executed),
    reason: lt.reason ?? null,
    usersTested: Array.isArray(lt.usersTested) ? lt.usersTested : [],
    durationSecondsRequested: lt.durationSecondsRequested ?? null,
    thresholds: lt.thresholds && typeof lt.thresholds === "object" ? lt.thresholds : {},
    results: lt.results && typeof lt.results === "object" ? lt.results : {},
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

// Warning text that reflects a deliberate, by-design outcome rather than a
// failure — these are permanent/expected on nearly every real analysis
// (e.g. the WCAG check's "this is automated, not full compliance"
// disclaimer fires on every run that has real accessibility findings; load
// testing being skipped because it wasn't approved is the safe default).
// Matched by stable substrings from their known source text (wcag_validator.py,
// load_benchmark.py) — if that wording changes, update this list to match.
const ADVISORY_WARNING_PATTERNS = [
  /does NOT guarantee full compliance/i,
  /was enabled but not explicitly approved/i,
];

function isAdvisoryWarning(message) {
  return ADVISORY_WARNING_PATTERNS.some((re) => re.test(message));
}

function num(v)        { return typeof v === "number" ? v : 0; }
function numOrNull(v)  { return typeof v === "number" ? v : null; }

/** A category score is either a 0-100 number or {status:"not-run"} — never coerced to 0. */
function passScore(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && v.status === "not-run") return v;
  return { status: "not-run" };
}
