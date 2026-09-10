import { getModel, isModelConfigured } from "../../ai/model.js";
import { analysisPrompt } from "../../ai/prompts.js";
import { parseAiResponse } from "../../ai/schemas.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 9 — aiReasoningNode
 * Sends ONLY summarized, structured evidence to the LLM and validates the
 * structured output. Deterministic analyzer results (scores, findings) are
 * never sent for recalculation and are always preserved on failure.
 *
 * Never sent to the model: raw DOM, screenshots, full network logs, raw HTML.
 */
export async function aiReasoningNode(state) {
  logger.info("[aiReasoningNode] Running AI reasoning");

  // No key → deterministic mock, clearly flagged. Report is never lost.
  if (!isModelConfigured()) {
    logger.warn("[aiReasoningNode] No API key — returning deterministic mock analysis");
    return { aiAnalysis: buildFallbackAnalysis(state, "OPENAI_API_KEY not configured") };
  }

  const evidence = buildSummarizedEvidence(state);

  try {
    const model = getModel();
    const chain = analysisPrompt.pipe(model);

    const response = await chain.invoke(evidence);
    const raw = typeof response?.content === "string"
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((c) => c.text ?? "").join("")
        : String(response?.content ?? "");

    const result = parseAiResponse(raw);

    if (!result.ok) {
      // Invalid / non-conforming JSON — keep deterministic results, warn, and
      // use whatever partial data we could coerce (or the mock).
      logger.warn("[aiReasoningNode] AI output failed validation", { error: result.error });
      const fallback = result.data && result.data.executiveSummary
        ? tagAsPartial(result.data)
        : buildFallbackAnalysis(state, `AI output invalid: ${result.error}`);
      return {
        aiAnalysis: fallback,
        warnings: [{ node: "aiReasoningNode", message: `AI output invalid: ${result.error}` }],
      };
    }

    logger.info("[aiReasoningNode] AI analysis complete", {
      issues: result.data.prioritizedIssues?.length ?? 0,
    });
    return { aiAnalysis: { ...result.data, _mocked: false } };

  } catch (err) {
    // OpenAI call failed (network, auth, rate limit, timeout). Preserve the
    // deterministic report and return a warning instead of losing everything.
    logger.error("[aiReasoningNode] OpenAI call failed", { error: err.message });
    return {
      aiAnalysis: buildFallbackAnalysis(state, `OpenAI call failed: ${err.message}`),
      warnings: [{ node: "aiReasoningNode", message: `OpenAI call failed: ${err.message}` }],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence summarization — ONLY compact, structured data goes to the model.
// Explicitly excludes raw DOM, screenshots, full network logs, raw HTML.
//
// The model receives exactly: application type, selected rule profile,
// validation plan, functional findings, WCAG findings, responsive findings,
// cross-browser differences, frontend performance metrics, approved load
// benchmark metrics, UI-consistency findings, and the deterministic scores.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FINDINGS_PER_BUCKET = 20;   // cap each findings list length
const MAX_TITLE_LEN           = 120;

function buildSummarizedEvidence(state) {
  const findings    = state.normalizedFindings ?? [];
  const byCategory   = groupByCategory(findings);

  return {
    url: state.url ?? "",

    applicationType: formatApplicationType(state.targetProfile),
    ruleProfile:     formatRuleProfile(state.ruleProfile),
    validationPlan:  formatValidationPlan(state.validationPlan),

    scores: formatScores(state.scores),

    functionalFindings:   formatFindingsList(byCategory.functional),
    wcagFindings:          formatFindingsList(byCategory.accessibility),
    responsiveFindings:   formatFindingsList(byCategory.responsive),
    crossBrowserFindings: formatFindingsList(byCategory["cross-browser"]),
    uiConsistencyFindings: formatFindingsList([...byCategory.design, ...byCategory["ui-consistency"]]),

    performanceMetrics:   formatPerformanceMetrics(state),
    loadBenchmarkMetrics: formatLoadBenchmark(state.pythonValidationResults),
  };
}

function groupByCategory(findings) {
  const groups = { functional: [], accessibility: [], responsive: [], "cross-browser": [], design: [], "ui-consistency": [], performance: [], network: [] };
  for (const f of findings ?? []) {
    const cat = f?.category;
    if (cat && cat in groups) groups[cat].push(f);
  }
  return groups;
}

function formatApplicationType(targetProfile) {
  const tp = targetProfile ?? {};
  const parts = [
    `Type: ${tp.targetType ?? "unknown"}`,
    `Confidence: ${typeof tp.confidence === "number" ? tp.confidence.toFixed(2) : "n/a"}`,
  ];
  if (Array.isArray(tp.evidence) && tp.evidence.length) {
    parts.push(`Evidence: ${tp.evidence.slice(0, 5).join("; ")}`);
  }
  return parts.join("\n");
}

function formatRuleProfile(ruleProfile) {
  const r = ruleProfile ?? {};
  const parts = [`Profile: ${r.id ?? "n/a"}`, `Target type: ${r.targetType ?? "n/a"}`];
  if (r.description) parts.push(`Description: ${r.description}`);
  if (r.accessibility) {
    parts.push(`Accessibility standard: ${r.accessibility.standard ?? "n/a"} level ${r.accessibility.level ?? "n/a"}`);
  }
  return parts.join("\n");
}

function formatValidationPlan(plan) {
  const p = plan ?? {};
  const checks = p.checks ?? {};
  const enabled  = Object.entries(checks).filter(([, v]) => v === true).map(([k]) => k);
  const disabled = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
  const parts = [
    `Enabled checks: ${enabled.length ? enabled.join(", ") : "none"}`,
    `Disabled checks: ${disabled.length ? disabled.join(", ") : "none"}`,
    `Browsers: ${(p.browsers ?? []).join(", ") || "n/a"}`,
    `Viewports: ${(p.viewports ?? []).join(", ") || "n/a"}`,
  ];
  if (Array.isArray(p.executionOrder) && p.executionOrder.length) {
    parts.push(`Execution order: ${p.executionOrder.join(" -> ")}`);
  }
  return parts.join("\n");
}

function formatScores(s) {
  const scores = s ?? {};
  const fmt = (v) => (typeof v === "number" ? `${v}/100` : "not run");
  return [
    `Overall: ${typeof scores.overall === "number" ? scores.overall : "n/a"}/100 (${scores.label ?? "n/a"})`,
    `Functional: ${fmt(scores.functional)}`,
    `Accessibility: ${fmt(scores.accessibility)}`,
    `Responsive: ${fmt(scores.responsive)}`,
    `Cross-Browser: ${fmt(scores.crossBrowser)}`,
    `Performance: ${fmt(scores.performance)}`,
    `UI Consistency: ${fmt(scores.uiConsistency)}`,
  ].join("\n");
}

/** Compact one-line-per-finding list for a single category bucket, capped. */
function formatFindingsList(findings) {
  if (!findings?.length) return "None.";
  return findings
    .slice(0, MAX_FINDINGS_PER_BUCKET)
    .map((f) => {
      const bits = [f.id, f.severity, `conf=${fmtConfidence(f.confidence)}`];
      if (f.standard) bits.push(f.rule ? `${f.standard}:${f.rule}` : f.standard);
      if (f.browser)  bits.push(`browser=${f.browser}`);
      if (f.viewport) bits.push(`viewport=${f.viewport}`);
      if (f.threshold !== null && f.threshold !== undefined) bits.push(`threshold=${JSON.stringify(f.threshold)}`);
      const title = String(f.title ?? "").slice(0, MAX_TITLE_LEN);
      return `${bits.join(" | ")} | ${title}`;
    })
    .join("\n") + (findings.length > MAX_FINDINGS_PER_BUCKET
      ? `\n… (${findings.length - MAX_FINDINGS_PER_BUCKET} more omitted)`
      : "");
}

function formatPerformanceMetrics(state) {
  const m = state.metrics ?? {};
  const findings = state.normalizedFindings ?? [];
  const perf = findings.filter((f) => f.category === "performance" || f.category === "network");

  const parts = [formatCoreWebVitals(m), formatLighthouse(m)];
  parts.push(`Performance/network findings: ${perf.length} (by severity ${JSON.stringify(countBySeverity(perf))})`);
  return parts.join("\n");
}

function formatCoreWebVitals(m) {
  const rows = [
    ["LCP", m.largestContentfulPaint, "ms"],
    ["FCP", m.firstContentfulPaint, "ms"],
    ["TBT", m.totalBlockingTime, "ms"],
    ["CLS", m.cumulativeLayoutShift, ""],
    ["Speed Index", m.speedIndex, "ms"],
    ["TTI", m.timeToInteractive, "ms"],
    ["INP", m.interactionToNextPaint, "ms"],
  ].filter(([, v]) => v !== null && v !== undefined);

  if (!rows.length) return "No Core Web Vitals available.";
  return rows.map(([k, v, u]) => `${k}: ${v}${u}`).join("\n");
}

function formatLighthouse(m) {
  const parts = [];
  if (m.lighthouseScore != null) parts.push(`Lighthouse performance score: ${m.lighthouseScore}/100`);
  if (m.totalBytes != null)      parts.push(`Total bytes: ${fmtBytes(m.totalBytes)}`);
  if (m.javascriptBytes != null) parts.push(`JS bytes: ${fmtBytes(m.javascriptBytes)}`);
  if (m.cssBytes != null)        parts.push(`CSS bytes: ${fmtBytes(m.cssBytes)}`);
  if (m.imageBytes != null)      parts.push(`Image bytes: ${fmtBytes(m.imageBytes)}`);
  if (m.requestCount != null)    parts.push(`Requests: ${m.requestCount}`);
  if (m.renderBlockingResources != null) parts.push(`Render-blocking resources: ${m.renderBlockingResources}`);
  if (m.unusedJavaScriptSavingsMs != null) parts.push(`Unused JS savings: ~${m.unusedJavaScriptSavingsMs}ms`);
  if (m.unusedCssSavingsMs != null)        parts.push(`Unused CSS savings: ~${m.unusedCssSavingsMs}ms`);
  return parts.length ? parts.join("\n") : "No Lighthouse summary available.";
}

/**
 * Approved load-benchmark metrics only — load_benchmark.py never runs
 * (and thus never produces these) unless the rule profile's
 * performance.loadTest has both `enabled` and `approved` literally true.
 */
function formatLoadBenchmark(pythonValidationResults) {
  const loadTest = pythonValidationResults?.metrics?.performance?.loadTest;
  if (!loadTest) return "Not run.";
  if (!loadTest.executed) return `Not executed (${loadTest.reason ?? "not enabled/approved"}).`;

  const results = loadTest.results ?? {};
  const rows = Object.entries(results).map(([users, rm]) =>
    `${users} users: p95=${rm.p95ResponseTimeMs ?? "n/a"}ms, errorRate=${rm.errorRatePercent ?? "n/a"}%, errors=${rm.errorCount ?? "n/a"}`
  );

  return [
    `Duration requested: ${loadTest.durationSecondsRequested ?? "n/a"}s`,
    `Thresholds: ${JSON.stringify(loadTest.thresholds ?? {})}`,
    ...rows,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallbacks — always preserve deterministic results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a deterministic analysis from the actual scores + findings so the
 * report is never empty when the LLM is unavailable or fails.
 */
function buildFallbackAnalysis(state, reason) {
  const scores = state.scores ?? {};
  const findings = [...(state.normalizedFindings ?? [])].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity)
  );
  const top = findings.slice(0, 5);
  const byCategory = groupByCategory(findings);
  const majorRisks = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 5)
    .map((f) => f.title)
    .filter(Boolean);

  return {
    executiveSummary:
      `Automated analysis of ${state.url} scored ${fmtScore(scores.overall)}/100 overall. ` +
      `${findings.length} findings were detected across the enabled validation categories. ` +
      `AI narrative was unavailable (${reason}); this summary is generated deterministically from analyzer results.`,
    majorRisks,
    prioritizedIssues: top.map((f, i) => ({
      findingId:       f.id,
      priority:        i + 1,
      reason:          f.title || "Detected by automated analysis.",
      likelyRootCause: "Not determined — AI reasoning unavailable; see the finding's evidence.",
      recommendation:  f.recommendation || "Review the finding evidence and remediate.",
      impact:          severityToImpact(f.severity),
      effort:          "medium",
    })),
    crossBrowserSummary:  summarizeCategoryFallback(byCategory["cross-browser"], scores.crossBrowser),
    accessibilitySummary: summarizeCategoryFallback(byCategory.accessibility, scores.accessibility),
    performanceSummary:   summarizeCategoryFallback([...byCategory.performance, ...byCategory.network], scores.performance),
    quickWins: findings
      .filter((f) => f.severity === "low" || f.severity === "medium")
      .slice(0, 5)
      .map((f) => f.title)
      .filter(Boolean),
    recommendations: [
      "Address critical and high-severity findings first.",
      "Re-run the analysis after fixes to confirm score improvements.",
    ],
    _mocked: true,
    _fallbackReason: reason,
  };
}

/** Deterministic one-line category summary used only by the fallback path. */
function summarizeCategoryFallback(findings, score) {
  if (score && typeof score === "object" && score.status === "not-run") {
    return "Not run for this analysis.";
  }
  const scoreStr = typeof score === "number" ? `${score}/100` : "n/a";
  if (!findings?.length) return `No findings detected. Score: ${scoreStr}.`;
  return `${findings.length} finding(s) detected (severity ${JSON.stringify(countBySeverity(findings))}). Score: ${scoreStr}.`;
}

/** Mark a partially-valid AI result so downstream knows it wasn't fully clean. */
function tagAsPartial(data) {
  return { ...data, _mocked: false, _partial: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function countBySeverity(findings) {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) if (f.severity in c) c[f.severity] += 1;
  return c;
}

function severityRank(s) {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s] ?? 0;
}

function severityToImpact(s) {
  if (s === "critical" || s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

function fmtScore(v) {
  return typeof v === "number" ? v : "n/a";
}

function fmtConfidence(v) {
  return typeof v === "number" ? v.toFixed(2) : "?";
}

function fmtBytes(b) {
  if (b == null) return "n/a";
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} MB`;
  if (b >= 1_000)     return `${(b / 1_000).toFixed(0)} KB`;
  return `${b} B`;
}
