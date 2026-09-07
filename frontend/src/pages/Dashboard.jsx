import React, { useState, useRef } from "react";
import { analyzeUrl } from "../services/analysisApi.js";

import UrlInput          from "../components/UrlInput.jsx";
import AnalysisLoading   from "../components/AnalysisLoading.jsx";
import ScoreOverview     from "../components/ScoreOverview.jsx";
import MetricsPanel      from "../components/MetricsPanel.jsx";
import IssuesTable       from "../components/IssuesTable.jsx";
import RecommendationList from "../components/RecommendationList.jsx";
import QuickWins         from "../components/QuickWins.jsx";

export default function Dashboard() {
  const [report, setReport]       = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]         = useState("");
  const [pendingUrl, setPendingUrl] = useState("");
  const abortRef = useRef(null);

  async function handleAnalyze(url) {
    setError("");
    setReport(null);
    setPendingUrl(url);
    setAnalyzing(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await analyzeUrl(url, { signal: controller.signal });
      setReport(data);
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message || "Analysis failed. Please try again.");
      }
    } finally {
      setAnalyzing(false);
      setPendingUrl("");
      abortRef.current = null;
    }
  }

  function reset() {
    if (abortRef.current) abortRef.current.abort();
    setReport(null);
    setError("");
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <button onClick={reset} className="flex items-center gap-3 text-left" aria-label="Home">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
              AI
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-white">
                Frontend Quality &amp; Performance Analyzer
              </h1>
              <p className="text-xs text-gray-500">LangGraph · Lighthouse · axe-core · OpenAI</p>
            </div>
          </button>
          {report && (
            <button
              onClick={reset}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
            >
              ← New Analysis
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* ── Input (hidden while showing a report) ── */}
        {!report && (
          <div className={analyzing ? "" : "py-6"}>
            {!analyzing && (
              <div className="mb-8 text-center">
                <h2 className="mb-2 text-3xl font-bold text-white">
                  Analyze any website's <span className="text-brand-500">frontend quality</span>
                </h2>
                <p className="mx-auto max-w-xl text-sm text-gray-400">
                  Enter a URL to run a real browser audit across performance, design,
                  responsiveness, and accessibility — with an AI-generated summary.
                </p>
              </div>
            )}

            <div className="mx-auto max-w-2xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
              {analyzing ? (
                <AnalysisLoading url={pendingUrl} />
              ) : (
                <UrlInput onAnalyze={handleAnalyze} analyzing={analyzing} />
              )}
            </div>

            {error && (
              <div role="alert" className="mx-auto mt-4 max-w-2xl rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── Report ── */}
        {report && <ReportView report={report} />}
      </main>
    </div>
  );
}

/** The full results view for a completed report (stable API contract). */
function ReportView({ report }) {
  const {
    url, timestamp, scores = {}, metrics = {},
    executiveSummary, issues = [], quickWins = [], recommendations = [],
    metadata = {},
  } = report;

  const durationS = metadata.analysisDurationMs != null
    ? (metadata.analysisDurationMs / 1000).toFixed(1)
    : null;
  const warnings = metadata.warnings ?? [];

  return (
    <div className="space-y-8">
      {/* URL bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-4">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Analyzed URL</p>
          <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand-400 hover:underline">
            {url}
          </a>
        </div>
        <div className="text-right text-xs text-gray-500">
          {timestamp && <p>{new Date(timestamp).toLocaleString()}</p>}
          {durationS && <p className="text-gray-600">Completed in {durationS}s</p>}
          {metadata.partial && <p className="text-yellow-500/80">⚠ Partial report</p>}
        </div>
      </div>

      {/* Scores */}
      <ScoreOverview scores={scores} />

      {/* Executive summary */}
      {executiveSummary && (
        <section aria-labelledby="summary-heading" className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-2 flex items-center gap-2">
            <h2 id="summary-heading" className="text-base font-semibold text-white">Executive Summary</h2>
            <span className="rounded-full border border-brand-500/30 bg-brand-500/20 px-2 py-0.5 text-xs text-brand-400">
              {metadata.aiAnalysis?.available ? "🤖 AI" : "Deterministic"}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-200">{executiveSummary}</p>
        </section>
      )}

      {/* Metrics */}
      <MetricsPanel metrics={metrics} />

      {/* Recommendations + Quick wins */}
      {(recommendations.length > 0 || quickWins.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <RecommendationList recommendations={recommendations} />
          <QuickWins quickWins={quickWins} />
        </div>
      )}

      {/* Issues */}
      <IssuesTable issues={issues} counts={metadata.counts?.bySeverity} />

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
          <p className="mb-2 text-sm font-medium text-yellow-400">Analysis warnings</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-300/80">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
