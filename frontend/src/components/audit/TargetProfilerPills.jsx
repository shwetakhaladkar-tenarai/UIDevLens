import React from "react";

const TYPES = [
  { key: "standard-web", label: "Standard Web" },
  { key: "powerbi",      label: "Power BI" },
];

/**
 * Shows the target types the backend's applicationProfilerNode can
 * classify a URL as (see backend/src/profiling/applicationProfiler.js).
 * `detectedType` is only known AFTER a run completes (the classifier reads
 * the real collected page) — before that, every pill is neutral rather than
 * guessing. This is informational, not a selector: nothing here can be
 * clicked to force a type: the backend decides.
 */
export default function TargetProfilerPills({ detectedType }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Target App Type</p>
      <div className="flex flex-wrap gap-2" role="list" aria-label="Detected application type">
        {TYPES.map((t) => {
          const isDetected = detectedType === t.key;
          return (
            <span
              key={t.key}
              role="listitem"
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                isDetected
                  ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                  : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              {t.label}
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {detectedType ? "Auto-detected by applicationProfilerNode from the collected page." : "Detected automatically once a run completes — not user-selectable."}
      </p>
    </div>
  );
}
