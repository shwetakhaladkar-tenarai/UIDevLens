import React, { useEffect, useState } from "react";

const STEPS = [
  { id: "validate",      label: "Validating URL",              icon: "🔍" },
  { id: "browser",       label: "Collecting browser evidence", icon: "🌐" },
  { id: "performance",   label: "Analyzing performance",       icon: "⚡" },
  { id: "network",       label: "Analyzing network",           icon: "📡" },
  { id: "design",        label: "Analyzing design",            icon: "🎨" },
  { id: "accessibility", label: "Analyzing accessibility",     icon: "♿" },
  { id: "normalize",     label: "Normalizing findings",        icon: "📋" },
  { id: "scoring",       label: "Calculating scores",          icon: "🏆" },
  { id: "ai",            label: "Running AI reasoning",        icon: "🤖" },
  { id: "report",        label: "Building report",             icon: "📊" },
];

export default function AnalysisProgress({ url }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Advance through steps at realistic intervals
    const delays = [300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2800, 3200];
    const timers = delays.map((delay, i) =>
      setTimeout(() => setCurrentStep(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="text-center py-8" role="status" aria-live="polite" aria-label="Analysis in progress">
      {/* Spinner */}
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 rounded-full border-4 border-gray-800 border-t-brand-500 animate-spin" aria-hidden="true" />
      </div>

      <h2 className="text-lg font-semibold text-white mb-1">
        Analyzing <span className="text-brand-500 break-all">{url}</span>
      </h2>
      <p className="text-sm text-gray-400 mb-8">
        Running LangGraph pipeline — this takes a few seconds
      </p>

      {/* Step list */}
      <ul className="max-w-sm mx-auto space-y-2 text-left">
        {STEPS.map((step, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <li
              key={step.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-300 ${
                active
                  ? "bg-brand-500/10 border border-brand-500/30"
                  : done
                  ? "opacity-60"
                  : "opacity-25"
              }`}
            >
              <span className="text-base w-6 text-center" aria-hidden="true">
                {done ? "✓" : step.icon}
              </span>
              <span className={`text-sm ${done ? "text-gray-400" : active ? "text-white font-medium" : "text-gray-500"}`}>
                {step.label}
              </span>
              {active && (
                <span className="ml-auto w-3 h-3 rounded-full bg-brand-500 animate-pulse" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
