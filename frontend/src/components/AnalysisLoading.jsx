import React, { useEffect, useState } from "react";

const STEPS = [
  {
    label: "Validating URL & Profiling Target",
    detail: "Detecting app type and selecting rule profile",
    duration: 800,
  },
  {
    label: "Collecting Browser Evidence",
    detail: "Launching Chromium, Firefox & WebKit across desktop, tablet, mobile",
    duration: 12000,
  },
  {
    label: "Performance Audit",
    detail: "Running Lighthouse — LCP, CLS, FCP, TBT, Speed Index",
    duration: 10000,
  },
  {
    label: "Accessibility Checks",
    detail: "axe-core WCAG scan + keyboard & focus validation",
    duration: 8000,
  },
  {
    label: "UI Consistency & Design",
    detail: "Checking colors, typography, spacing & component consistency",
    duration: 6000,
  },
  {
    label: "Functional & Network Analysis",
    detail: "Broken links, form inputs, navigation & network requests",
    duration: 6000,
  },
  {
    label: "AI Reasoning & Scoring",
    detail: "GPT-4o prioritizing findings and generating recommendations",
    duration: 10000,
  },
  {
    label: "Building Report",
    detail: "Assembling final scores, insights and findings",
    duration: 6000,
  },
];

// Cumulative start time for each step
const START_TIMES = STEPS.reduce((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + STEPS[i - 1].duration);
  return acc;
}, []);

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
 * Progress bar is driven by step index — each step = one equal slice —
 * and is capped at 95% so it never falsely claims completion.
 */
export default function AnalysisLoading({ url }) {
  const [step, setStep] = useState(0);
  // Track progress within the current step using a fine-grained ticker
  const [subProgress, setSubProgress] = useState(0);

  // Advance steps on their estimated schedule
  useEffect(() => {
    const timers = START_TIMES.map((t, i) =>
      setTimeout(() => {
        setStep(i);
        setSubProgress(0); // reset sub-progress when a new step starts
      }, t)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Within each step, tick sub-progress from 0→1 over that step's duration
  useEffect(() => {
    const stepDuration = STEPS[step]?.duration ?? 1000;
    const tickMs = 200;
    const increment = tickMs / stepDuration;
    const id = setInterval(() => {
      setSubProgress((prev) => Math.min(1, prev + increment));
    }, tickMs);
    return () => clearInterval(id);
  }, [step]);

  // Each step contributes an equal slice; within the step we interpolate
  // smoothly. Cap at 95% — only the real report completion reaches 100%.
  const sliceSize = 100 / STEPS.length;
  const rawProgress = step * sliceSize + subProgress * sliceSize;
  const progress = Math.min(95, Math.round(rawProgress));

  const currentStep = STEPS[step];

  return (
    <div className="w-full py-6 px-2" role="status" aria-live="polite">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Analyzing your application…</h2>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-sm text-brand-600 hover:underline">
            {url}
          </a>
        )}
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
