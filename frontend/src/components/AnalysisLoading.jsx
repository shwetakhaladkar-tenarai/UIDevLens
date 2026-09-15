import React, { useEffect, useState } from "react";

const STEPS = [
  {
    label: "Validating URL & Profiling Target",
    detail: "Detecting app type and selecting rule profile",
    duration: 600,
  },
  {
    label: "Collecting Browser Evidence",
    detail: "Launching Chromium, Firefox & WebKit across desktop, tablet, mobile",
    duration: 7000,
  },
  {
    label: "Performance Audit",
    detail: "Running Lighthouse — LCP, CLS, FCP, TBT, Speed Index",
    duration: 5000,
  },
  {
    label: "Accessibility Checks",
    detail: "axe-core WCAG scan + keyboard & focus validation",
    duration: 4000,
  },
  {
    label: "UI Consistency & Design",
    detail: "Checking colors, typography, spacing & component consistency",
    duration: 3000,
  },
  {
    label: "Functional & Network Analysis",
    detail: "Broken links, form inputs, navigation & network requests",
    duration: 3000,
  },
  {
    label: "AI Reasoning & Scoring",
    detail: "GPT-4o prioritizing findings and generating recommendations",
    duration: 5000,
  },
  {
    label: "Building Report",
    detail: "Assembling final scores, insights and findings",
    duration: 2000,
  },
];

// Cumulative delay for each step to start
const START_TIMES = STEPS.reduce((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + STEPS[i - 1].duration);
  return acc;
}, []);

const TOTAL_DURATION = START_TIMES[START_TIMES.length - 1] + STEPS[STEPS.length - 1].duration;

function StepIcon({ state }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100">
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </span>
    );
  }
  // pending
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-white">
      <span className="h-2 w-2 rounded-full bg-gray-300" />
    </span>
  );
}

/**
 * Rich step-by-step progress indicator shown while the analysis runs.
 * Steps advance on an estimated schedule (backend doesn't stream events).
 */
export default function AnalysisLoading({ url }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Advance steps on their estimated schedule
  useEffect(() => {
    const timers = START_TIMES.map((t, i) =>
      setTimeout(() => setStep(i), t)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Tick elapsed time every 200ms for the progress bar
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(id);
  }, []);

  const progress = Math.min(100, Math.round((elapsed / TOTAL_DURATION) * 100));
  const currentStep = STEPS[step];

  return (
    <div className="w-full py-6 px-2" role="status" aria-live="polite">
      {/* Header */}
      <div className="mb-5 flex items-start gap-4">
        <span className="mt-1 h-10 w-10 shrink-0 animate-spin rounded-full border-4 border-gray-100 border-t-brand-500" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">Analyzing your application…</h2>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-sm text-brand-600 hover:underline">
              {url}
            </a>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between text-xs text-gray-400">
          <span>{currentStep?.label}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step list */}
      <ul className="space-y-2">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li
              key={s.label}
              className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all duration-300 ${
                state === "active"
                  ? "bg-brand-50 ring-1 ring-brand-100"
                  : state === "done"
                  ? "bg-green-50/50"
                  : "opacity-50"
              }`}
            >
              <StepIcon state={state} />
              <div className="min-w-0">
                <p className={`text-sm font-medium leading-tight ${
                  state === "active" ? "text-brand-700"
                  : state === "done" ? "text-green-700"
                  : "text-gray-400"
                }`}>
                  {s.label}
                </p>
                {state === "active" && (
                  <p className="mt-0.5 text-xs text-brand-500">{s.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-center text-xs text-gray-400">
        Full analysis takes ~30–90 seconds depending on site complexity.
      </p>
    </div>
  );
}
