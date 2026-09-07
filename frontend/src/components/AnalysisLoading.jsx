import React, { useEffect, useState } from "react";

const STEPS = [
  "Validating URL",
  "Collecting browser evidence (desktop, tablet, mobile)",
  "Running Lighthouse performance audit",
  "Analyzing network requests",
  "Analyzing design consistency",
  "Running axe-core accessibility checks",
  "Scoring & AI reasoning",
  "Building report",
];

/**
 * Progress indicator shown while the analysis runs. The backend does not stream
 * step events, so steps advance on an estimated schedule for feedback only.
 */
export default function AnalysisLoading({ url }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const delays = [600, 3500, 6000, 9000, 11000, 13000, 16000, 20000];
    const timers = delays.map((d, i) => setTimeout(() => setStep(i + 1), d));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="mx-auto max-w-md py-10 text-center" role="status" aria-live="polite">
      <div className="mb-6 flex justify-center">
        <span className="h-14 w-14 animate-spin rounded-full border-4 border-gray-800 border-t-brand-500" aria-hidden="true" />
      </div>

      <h2 className="mb-1 text-lg font-semibold text-white">Analyzing</h2>
      {url && <p className="mb-6 break-all text-sm text-brand-400">{url}</p>}

      <ul className="space-y-2 text-left">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li
              key={label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                active ? "bg-brand-500/10 text-white"
                : done ? "text-gray-500"
                : "text-gray-600 opacity-60"
              }`}
            >
              <span className="w-4 text-center" aria-hidden="true">
                {done ? "✓" : active ? "•" : "○"}
              </span>
              {label}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs text-gray-600">
        A full analysis takes ~20-30 seconds (real browser, Lighthouse & axe-core).
      </p>
    </div>
  );
}
