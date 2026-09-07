import React from "react";
import Header from "../components/Header.jsx";
import ScoreGauge from "../components/ScoreGauge.jsx";
import ScoresChart from "../components/ScoresChart.jsx";
import MetricsBar from "../components/MetricsBar.jsx";
import FindingsPanel from "../components/FindingsPanel.jsx";
import AiInsightsPanel from "../components/AiInsightsPanel.jsx";

export default function ResultsPage({ report, onReset }) {
  if (!report) return null;

  const {
    url,
    timestamp,
    scores = {},
    metrics = {},
    executiveSummary,
    issues = [],
    quickWins = [],
    recommendations = [],
    metadata = {},
  } = report;

  const counts = metadata.counts ?? { total: issues.length, bySeverity: {}, byCategory: {} };
  const sev = counts.bySeverity ?? {};
  const cat = counts.byCategory ?? {};
  const warnings = metadata.warnings ?? [];

  // AI panel expects the AI-analysis shape; reconstruct from the stable contract.
  const aiAnalysis = {
    executiveSummary,
    prioritizedIssues: issues
      .filter((i) => i.ai)
      .map((i) => ({
        findingId:       i.id,
        priority:        i.ai.priority,
        reason:          i.ai.reason,
        likelyRootCause: i.ai.likelyRootCause,
        recommendation:  i.ai.recommendation,
        impact:          i.ai.impact,
        effort:          i.ai.effort,
      })),
    quickWins,
    recommendations,
    _mocked:         !(metadata.aiAnalysis?.available),
    _partial:        Boolean(metadata.aiAnalysis?.partial),
    _fallbackReason: metadata.aiAnalysis?.fallbackReason ?? null,
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onReset={onReset} showReset />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-8">

        {/* ── URL + timestamp bar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-800">
          <div>
            <p className="text-xs text-gray-500 mb-1">Analyzed URL</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brand-400 hover:underline break-all"
            >
              {url}
            </a>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">
              {timestamp ? new Date(timestamp).toLocaleString() : ""}
            </p>
            {metadata.analysisDurationMs != null && (
              <p className="text-xs text-gray-600">
                Analyzed in {(metadata.analysisDurationMs / 1000).toFixed(1)}s
              </p>
            )}
            {metadata.partial && (
              <span className="text-xs text-yellow-500/80">⚠ Partial report</span>
            )}
          </div>
        </div>

        {/* ── Scores row ── */}
        <section aria-labelledby="scores-heading">
          <h2 id="scores-heading" className="text-base font-semibold text-white mb-4">
            Scores
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <ScoreGauge score={scores.overall}       label="Overall"       size="lg" />
            <ScoreGauge score={scores.performance}   label="Performance"   size="sm" />
            <ScoreGauge score={scores.design}        label="Design"        size="sm" />
            <ScoreGauge score={scores.accessibility} label="Accessibility" size="sm" />
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <ScoresChart scores={scores} />
          </div>
        </section>

        {/* ── Summary chips ── */}
        <div className="flex flex-wrap gap-3">
          {[
            { label: `${counts.total ?? 0} total findings`,       color: "text-gray-400 bg-gray-800 border-gray-700" },
            { label: `${sev.critical ?? 0} critical`,             color: "text-red-400 bg-red-500/10 border-red-500/20" },
            { label: `${sev.high ?? 0} high`,                     color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
            { label: `${cat.performance ?? 0} performance`,       color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
            { label: `${cat.accessibility ?? 0} accessibility`,   color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
          ].map((c) => (
            <span key={c.label} className={`text-xs px-3 py-1.5 rounded-full border ${c.color}`}>
              {c.label}
            </span>
          ))}
        </div>

        {/* ── Metrics ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <MetricsBar metrics={metrics} />
        </div>

        {/* ── AI Insights ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <AiInsightsPanel aiAnalysis={aiAnalysis} />
        </div>

        {/* ── Findings ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <FindingsPanel issues={issues} />
        </div>

        {/* ── Warnings (partial failures) ── */}
        {warnings.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-4">
            <p className="text-sm font-medium text-yellow-400 mb-2">
              Analysis warnings
            </p>
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-300/80">{w}</p>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
