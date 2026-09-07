import React from "react";

function fmt(val, unit = "") {
  if (val === null || val === undefined) return "—";
  if (unit === "ms") return `${val.toLocaleString()} ms`;
  if (unit === "MB") return `${(val / 1_000_000).toFixed(2)} MB`;
  return String(val);
}

function MetricCell({ label, value, unit, good, warn }) {
  let color = "text-gray-300";
  if (value !== null && value !== undefined) {
    if (good !== undefined && value <= good) color = "text-green-400";
    else if (warn !== undefined && value <= warn) color = "text-yellow-400";
    else if (good !== undefined || warn !== undefined) color = "text-red-400";
  }

  return (
    <div className="flex flex-col items-center gap-1 p-3 bg-gray-900 rounded-xl border border-gray-800">
      <span className={`text-lg font-bold ${color}`}>{fmt(value, unit)}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

export default function MetricsBar({ metrics = {} }) {
  return (
    <section aria-labelledby="metrics-heading">
      <h2 id="metrics-heading" className="text-base font-semibold text-white mb-4">
        Core Web Vitals & Volume
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <MetricCell label="LCP"      value={metrics.lcp}          unit="ms" good={2500}      warn={4000} />
        <MetricCell label="FCP"      value={metrics.fcp}          unit="ms" good={1800}      warn={3000} />
        <MetricCell label="TBT"      value={metrics.tbt}          unit="ms" good={200}       warn={600}  />
        <MetricCell label="CLS"      value={metrics.cls}                    good={0.1}       warn={0.25} />
        <MetricCell label="Requests" value={metrics.requests}                good={50}        warn={100}  />
        <MetricCell label="Transfer" value={metrics.transferSize} unit="MB" good={1_000_000} warn={3_000_000} />
      </div>

      <div className="flex flex-wrap gap-3">
        {metrics.lighthouseScore != null && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
            Lighthouse: {metrics.lighthouseScore}/100
          </span>
        )}
        {metrics.ttfb != null && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
            TTFB: {metrics.ttfb} ms
          </span>
        )}
        {metrics.renderBlockingResources != null && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
            Render-blocking: {metrics.renderBlockingResources}
          </span>
        )}
      </div>
    </section>
  );
}
