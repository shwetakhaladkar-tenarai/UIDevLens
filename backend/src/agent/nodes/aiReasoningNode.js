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
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FINDINGS_TO_MODEL = 40;   // cap findings list length
const MAX_TITLE_LEN         = 120;

function buildSummarizedEvidence(state) {
  const scores  = state.scores  ?? {};
  const metrics = state.metrics ?? {};
  const findings = state.normalizedFindings ?? [];

  return {
    url: state.url ?? "",

    scores: formatScores(scores),

    coreWebVitals: formatCoreWebVitals(metrics),

    lighthouseSummary: formatLighthouse(metrics),

    networkSummary: formatNetworkSummary(findings, metrics),

    designSummary: formatDesignSummary(state),

    accessibilitySummary: formatA11ySummary(state, findings),

    findings: formatFindings(findings),
  };
}

function formatScores(s) {
  return [
    `Overall: ${s.overall ?? "n/a"}/100 (${s.label ?? "n/a"})`,
    `Performance: ${s.performance ?? "n/a"}/100`,
    `Design: ${s.design ?? "n/a"}/100`,
    `Accessibility: ${s.accessibility ?? "n/a"}/100`,
  ].join("\n");
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

function formatNetworkSummary(findings, m) {
  const net = findings.filter((f) => f.category === "network");
  const parts = [`Network findings: ${net.length}`];
  if (m.totalRequests != null) parts.push(`Total requests: ${m.totalRequests}`);
  // Only counts + titles, never full request logs
  const bySev = countBySeverity(net);
  parts.push(`By severity: ${JSON.stringify(bySev)}`);
  return parts.join("\n");
}

function formatDesignSummary(state) {
  const findings = state.normalizedFindings ?? [];
  const design     = findings.filter((f) => f.category === "design");
  const responsive = findings.filter((f) => f.category === "responsive");
  const de = state.browserEvidence?.designEvidence ?? {};

  const parts = [
    `Design findings: ${design.length} (severity ${JSON.stringify(countBySeverity(design))})`,
    `Responsive findings: ${responsive.length} (severity ${JSON.stringify(countBySeverity(responsive))})`,
  ];
  // Aggregate statistics only — never raw element dumps
  if (de.typography) {
    const fam = new Set((de.typography.body ?? []).concat(de.typography.headings ?? []).map((t) => t.fontFamily)).size;
    const sizes = new Set((de.typography.body ?? []).map((t) => t.fontSize)).size;
    parts.push(`Typography: ~${fam} font families, ~${sizes} body font sizes sampled`);
  }
  if (de.components) {
    parts.push(`Components sampled: ${(de.components.buttons ?? []).length} buttons, ${(de.components.inputs ?? []).length} inputs, ${(de.components.cards ?? []).length} cards`);
  }
  return parts.join("\n");
}

function formatA11ySummary(state, findings) {
  const a11y = findings.filter((f) => f.category === "accessibility");
  const parts = [
    `Accessibility (axe) score: ${state.accessibilityAxeScore ?? "n/a"}/100`,
    `Accessibility findings: ${a11y.length} (severity ${JSON.stringify(countBySeverity(a11y))})`,
  ];
  // List distinct axe rules only (short), not full node dumps
  const rules = [...new Set(a11y.map((f) => f.evidence?.axeRule).filter(Boolean))].slice(0, 15);
  if (rules.length) parts.push(`axe rules: ${rules.join(", ")}`);
  return parts.join("\n");
}

/** Compact one-line-per-finding list, capped and truncated. */
function formatFindings(findings) {
  if (!findings.length) return "No findings.";
  return findings
    .slice(0, MAX_FINDINGS_TO_MODEL)
    .map((f) => {
      const title = String(f.title ?? "").slice(0, MAX_TITLE_LEN);
      const conf  = typeof f.confidence === "number" ? f.confidence.toFixed(2) : "?";
      return `${f.id} | ${f.category} | ${f.severity} | conf=${conf} | ${title}`;
    })
    .join("\n") + (findings.length > MAX_FINDINGS_TO_MODEL
      ? `\n… (${findings.length - MAX_FINDINGS_TO_MODEL} more findings omitted)`
      : "");
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

  return {
    executiveSummary:
      `Automated analysis of ${state.url} scored ${scores.overall ?? "n/a"}/100 overall ` +
      `(performance ${scores.performance ?? "n/a"}, design ${scores.design ?? "n/a"}, ` +
      `accessibility ${scores.accessibility ?? "n/a"}). ` +
      `${findings.length} findings were detected. ` +
      `AI narrative was unavailable (${reason}); this summary is generated deterministically from analyzer results.`,
    prioritizedIssues: top.map((f, i) => ({
      findingId:       f.id,
      priority:        i + 1,
      reason:          f.title || "Detected by automated analysis.",
      likelyRootCause: "Not determined — AI reasoning unavailable; see the finding's evidence.",
      recommendation:  f.recommendation || "Review the finding evidence and remediate.",
      impact:          severityToImpact(f.severity),
      effort:          "medium",
    })),
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

function fmtBytes(b) {
  if (b == null) return "n/a";
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} MB`;
  if (b >= 1_000)     return `${(b / 1_000).toFixed(0)} KB`;
  return `${b} B`;
}
