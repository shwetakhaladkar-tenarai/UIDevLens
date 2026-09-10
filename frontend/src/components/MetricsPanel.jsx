import React from "react";

/**
 * Threshold-based tone. `lowerIsBetter` metrics turn green below `good`,
 * amber up to `warn`, red beyond.
 */
function tone(value, good, warn) {
  if (value == null) return "text-gray-400";
  if (value <= good) return "text-green-600";
  if (value <= warn) return "text-amber-600";
  return "text-red-600";
}

function fmtMs(v)    { return v == null ? "—" : `${Math.round(v).toLocaleString()} ms`; }
function fmtCls(v)   { return v == null ? "—" : v.toFixed(3); }
function fmtCount(v) { return v == null ? "—" : v.toLocaleString(); }
function fmtBytes(v) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} MB`;
  return `${Math.round(v / 1000)} KB`;
}

function Metric({ label, value, tone: t, hint }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${t}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

/**
 * Core Web Vitals + volume metrics. Reads the flat metrics contract:
 * { lcp, cls, fcp, tbt, requests, transferSize }
 */
export default function MetricsPanel({ metrics = {} }) {
  const { lcp, cls, fcp, tbt, requests, transferSize } = metrics;

  return (
    <section aria-labelledby="metrics-heading">
      <h3 id="metrics-heading" className="mb-4 text-sm font-semibold text-gray-900">
        Core Web Vitals
      </h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="LCP" value={fmtMs(lcp)} tone={tone(lcp, 2500, 4000)} hint="≤ 2.5 s good" />
        <Metric label="CLS" value={fmtCls(cls)} tone={tone(cls, 0.1, 0.25)} hint="≤ 0.1 good" />
        <Metric label="FCP" value={fmtMs(fcp)} tone={tone(fcp, 1800, 3000)} hint="≤ 1.8 s good" />
        <Metric label="TBT" value={fmtMs(tbt)} tone={tone(tbt, 200, 600)} hint="≤ 200 ms good" />
        <Metric label="Requests" value={fmtCount(requests)} tone={tone(requests, 50, 100)} />
        <Metric label="Transfer" value={fmtBytes(transferSize)} tone={tone(transferSize, 1_000_000, 3_000_000)} />
      </div>
    </section>
  );
}
