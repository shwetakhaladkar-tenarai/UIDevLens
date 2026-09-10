import React from "react";
import MetricsPanel from "./MetricsPanel.jsx";

function fmtMs(v)    { return v == null ? "—" : `${Math.round(v).toLocaleString()} ms`; }
function fmtBytes(v) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} MB`;
  return `${Math.round(v / 1000)} KB`;
}
function fmtScore(v) { return v == null ? "—" : `${Math.round(v)}/100`; }
function fmtCount(v) { return v == null ? "—" : v.toLocaleString(); }
function fmtPct(v)   { return v == null ? "—" : `${v}%`; }

function ExtraMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

/**
 * Performance: frontend metrics (Core Web Vitals + Lighthouse volume
 * metrics), plus the approved load-benchmark results table when
 * python-validation/performance/load_benchmark.py actually ran (both
 * `enabled` AND `approved` were true on the rule profile — see
 * report.metadata.loadTest.executed). Never fabricated: a table row only
 * exists for a user-count level that was actually measured.
 */
export default function PerformancePanel({ metrics = {}, loadTest = {}, performanceSummary }) {
  const { lighthouseScore, ttfb, speedIndex, tti, inp, javascriptBytes, cssBytes, imageBytes, renderBlockingResources } = metrics;
  const results = loadTest.results && typeof loadTest.results === "object" ? loadTest.results : {};
  const userCounts = Object.keys(results).sort((a, b) => Number(a) - Number(b));

  return (
    <section aria-labelledby="performance-heading" className="space-y-4">
      <h2 id="performance-heading" className="text-base font-semibold text-gray-900">Performance</h2>

      <MetricsPanel metrics={metrics} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <ExtraMetric label="Lighthouse" value={fmtScore(lighthouseScore)} />
        <ExtraMetric label="TTFB" value={fmtMs(ttfb)} />
        <ExtraMetric label="Speed Index" value={fmtMs(speedIndex)} />
        <ExtraMetric label="TTI" value={fmtMs(tti)} />
        <ExtraMetric label="INP" value={fmtMs(inp)} />
        <ExtraMetric label="Render-Blocking" value={fmtCount(renderBlockingResources)} />
        <ExtraMetric label="JS Size" value={fmtBytes(javascriptBytes)} />
        <ExtraMetric label="CSS Size" value={fmtBytes(cssBytes)} />
        <ExtraMetric label="Image Size" value={fmtBytes(imageBytes)} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700">Approved Load Benchmark</h3>
        {!loadTest.executed ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            {loadTest.reason || "Load benchmarking did not run for this analysis (requires both `enabled` and `approved` on the rule profile)."}
          </p>
        ) : userCounts.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            Load benchmarking ran but produced no per-level results.
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Load benchmark results table" className="overflow-x-auto rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Users</th>
                  <th scope="col" className="px-4 py-3 font-medium">Avg Response</th>
                  <th scope="col" className="px-4 py-3 font-medium">P95</th>
                  <th scope="col" className="px-4 py-3 font-medium">Error Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {userCounts.map((u) => {
                  const r = results[u];
                  const overThreshold =
                    (typeof loadTest.thresholds?.p95ResponseTimeMs === "number" && r.p95ResponseTimeMs > loadTest.thresholds.p95ResponseTimeMs) ||
                    (typeof loadTest.thresholds?.errorRatePercent === "number" && r.errorRatePercent > loadTest.thresholds.errorRatePercent);
                  return (
                    <tr key={u} className={overThreshold ? "bg-red-50" : ""}>
                      <th scope="row" className="px-4 py-3 text-left font-medium text-gray-900">{u}</th>
                      <td className="px-4 py-3 text-gray-700">{fmtMs(r.avgResponseTimeMs)}</td>
                      <td className={`px-4 py-3 ${overThreshold ? "text-red-600 font-medium" : "text-gray-700"}`}>{fmtMs(r.p95ResponseTimeMs)}</td>
                      <td className={`px-4 py-3 ${overThreshold ? "text-red-600 font-medium" : "text-gray-700"}`}>{fmtPct(r.errorRatePercent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {performanceSummary && (
        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <span className="shrink-0 text-brand-600" aria-hidden="true">🤖</span>
          {performanceSummary}
        </p>
      )}
    </section>
  );
}
