import React, { useMemo } from "react";

const LEVEL_STYLES = {
  low:    "bg-green-50 text-green-700 border-green-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high:   "bg-red-50 text-red-700 border-red-200",
};

function levelClass(v) {
  return LEVEL_STYLES[String(v || "").toLowerCase()] ?? "bg-gray-100 text-gray-600 border-gray-200";
}

/**
 * AI Summary — advisory narrative ONLY. All of this is grounded in the
 * deterministic evidence shown elsewhere on the dashboard (Functional UI,
 * Accessibility, Responsive Matrix, Cross-Browser, Performance, UI
 * Consistency panels + the full Issues table) — this panel never
 * substitutes for that evidence, only summarizes and prioritizes it.
 *
 * `prioritizedIssues` is derived from `issues[].ai` (reportBuilder.js joins
 * the LLM's per-finding annotation onto each factual finding by id) rather
 * than a separate list, so every prioritized issue here is traceable back
 * to a real finding.
 */
export default function AiInsightsPanel({
  executiveSummary,
  majorRisks = [],
  issues = [],
  quickWins = [],
  recommendations = [],
  aiMeta = {},
}) {
  const prioritizedIssues = useMemo(() => {
    return issues
      .filter((i) => i.ai)
      .sort((a, b) => (a.ai.priority ?? Infinity) - (b.ai.priority ?? Infinity))
      .map((i) => ({ findingId: i.id, title: i.title, ...i.ai }));
  }, [issues]);

  const hasContent = executiveSummary || majorRisks.length || prioritizedIssues.length || quickWins.length || recommendations.length;
  if (!hasContent) return null;

  const { available = true, partial = false, fallbackReason = null } = aiMeta;
  const badge = !available ? "Deterministic" : partial ? "Partial (AI)" : "GPT-4o Inference";

  return (
    <section aria-labelledby="ai-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 id="ai-heading" className="text-base font-semibold text-gray-900">
          AI Root Cause &amp; Fixes
        </h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
          <span aria-hidden="true">🤖</span> {badge}
        </span>
      </div>

      {/* Fallback notice */}
      {!available && fallbackReason && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-800">
            AI reasoning unavailable — showing a deterministic summary instead. ({fallbackReason})
          </p>
        </div>
      )}

      {/* Executive summary */}
      {executiveSummary && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-purple-700 mb-2">Executive Summary</p>
          <p className="text-sm text-gray-700 leading-relaxed">{executiveSummary}</p>
        </div>
      )}

      {/* Major risks */}
      {majorRisks.length > 0 && (
        <div className="bg-red-50/60 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-medium text-red-700 mb-2"><span aria-hidden="true">⚠</span> Major Risks</h3>
          <ul className="space-y-1.5">
            {majorRisks.map((risk, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-red-500 shrink-0" aria-hidden="true">•</span>
                {risk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prioritized issues (with likely root cause + recommendation) */}
      {prioritizedIssues.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Prioritized Issues</h3>
          <ol className="space-y-3">
            {prioritizedIssues.map((issue, i) => (
              <li
                key={`${issue.findingId || "issue"}-${issue.priority ?? i}`}
                className="bg-white border border-gray-200 rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-gray-400 w-6 shrink-0 pt-0.5">
                    #{issue.priority ?? i + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {issue.title && <p className="text-sm font-medium text-gray-900">{issue.title}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {issue.findingId && (
                        <code className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {issue.findingId}
                        </code>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${levelClass(issue.impact)}`}>
                        impact: {issue.impact}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${levelClass(issue.effort)}`}>
                        effort: {issue.effort}
                      </span>
                    </div>
                    {issue.reason && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">Why: </span>
                        {issue.reason}
                      </p>
                    )}
                    {issue.likelyRootCause && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">Likely cause: </span>
                        {issue.likelyRootCause}
                      </p>
                    )}
                    {issue.recommendation && (
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">Fix: </span>
                        {issue.recommendation}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Quick Wins + Recommendations */}
      <div className="grid sm:grid-cols-2 gap-4">
        {quickWins.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-medium text-green-700 mb-3"><span aria-hidden="true">⚡</span> Quick Wins</h3>
            <ul className="space-y-2">
              {quickWins.map((win, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-700">
                  <span className="text-green-600 shrink-0" aria-hidden="true">✓</span>
                  {win}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-medium text-blue-700 mb-3"><span aria-hidden="true">📋</span> Recommendations</h3>
            <ul className="space-y-2">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-700">
                  <span className="text-blue-600 shrink-0" aria-hidden="true">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
