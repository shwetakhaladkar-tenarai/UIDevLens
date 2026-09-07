import React from "react";

const LEVEL_STYLES = {
  low:    "bg-green-500/20 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high:   "bg-red-500/20 text-red-400 border-red-500/30",
};

function levelClass(v) {
  return LEVEL_STYLES[String(v || "").toLowerCase()] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

export default function AiInsightsPanel({ aiAnalysis }) {
  if (!aiAnalysis) return null;

  const {
    executiveSummary,
    prioritizedIssues = [],
    quickWins = [],
    recommendations = [],
    _mocked,
    _partial,
    _fallbackReason,
  } = aiAnalysis;

  const badge = _mocked ? "Deterministic" : _partial ? "Partial (AI)" : "GPT-4o";

  return (
    <section aria-labelledby="ai-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 id="ai-heading" className="text-base font-semibold text-white">
          AI Analysis
        </h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 border border-brand-500/30">
          🤖 {badge}
        </span>
      </div>

      {/* Fallback notice */}
      {_mocked && _fallbackReason && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
          <p className="text-xs text-yellow-400">
            AI narrative unavailable — showing deterministic analysis. ({_fallbackReason})
          </p>
        </div>
      )}

      {/* Executive summary */}
      {executiveSummary && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-400 mb-2">Executive Summary</p>
          <p className="text-sm text-gray-200 leading-relaxed">{executiveSummary}</p>
        </div>
      )}

      {/* Prioritized issues */}
      {prioritizedIssues.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Prioritized Issues</h3>
          <ol className="space-y-3">
            {prioritizedIssues.map((issue, i) => (
              <li
                key={`${issue.findingId || "issue"}-${issue.priority ?? i}`}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-gray-600 w-6 shrink-0 pt-0.5">
                    #{issue.priority ?? i + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {issue.findingId && (
                        <code className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
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
                      <p className="text-xs text-gray-400">
                        <span className="font-medium text-gray-300">Why: </span>
                        {issue.reason}
                      </p>
                    )}
                    {issue.likelyRootCause && (
                      <p className="text-xs text-gray-400">
                        <span className="font-medium text-gray-300">Likely cause: </span>
                        {issue.likelyRootCause}
                      </p>
                    )}
                    {issue.recommendation && (
                      <p className="text-xs text-gray-400">
                        <span className="font-medium text-gray-300">Fix: </span>
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
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-medium text-green-400 mb-3">⚡ Quick Wins</h3>
            <ul className="space-y-2">
              {quickWins.map((win, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-300">
                  <span className="text-green-400 shrink-0">✓</span>
                  {win}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-medium text-blue-400 mb-3">📋 Recommendations</h3>
            <ul className="space-y-2">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-300">
                  <span className="text-blue-400 shrink-0">•</span>
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
