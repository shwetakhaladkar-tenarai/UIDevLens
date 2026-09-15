import React from "react";

const CARDS = [
  {
    title: "Functional UI",
    checkKeys: ["functional"],
    items: ["Broken Links & Buttons", "Form Inputs & Navigation", "Missing States & Console Errors"],
  },
  {
    title: "Accessibility (WCAG)",
    checkKeys: ["accessibility"],
    items: ["WCAG Contrast & Structure", "Alt Text & Form Labels", "Keyboard / Focus"],
  },
  {
    title: "Cross-Browser & Responsive",
    checkKeys: ["crossBrowser", "responsive"],
    items: ["Chromium / Firefox / WebKit", "Desktop / Tablet / Mobile", "Clipping, Overlap & Overflow"],
  },
  {
    title: "Performance",
    checkKeys: ["performance"],
    items: ["Core Web Vitals (LCP, CLS)", "Frontend Metrics (Lighthouse)", "Load Benchmarking (when approved)"],
  },
  {
    title: "UI Consistency",
    checkKeys: ["uiConsistency"],
    items: ["Colors / Typography", "Grid Alignment & Spacing", "Component Consistency"],
  },
];

/** Green check, red X, or neutral dash depending on enabled state. */
function CheckIcon({ enabled }) {
  // Pre-run — neutral, no plan yet
  if (enabled === null) {
    return (
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-gray-300 text-sm leading-none">—</span>
    );
  }

  // Enabled — green checkmark
  if (enabled) {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-green-500">
        <path d="M3 8.5 6.5 12 13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Disabled — red X
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-red-400">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function ValidationMatrixCards({ checks }) {
  const cardEnabled = (checkKeys) => {
    if (!checks) return null;
    return checkKeys.some((k) => checks[k] === true);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {CARDS.map((card) => {
        const enabled = cardEnabled(card.checkKeys);
        return (
          <div key={card.title} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">{card.title}</p>
            <ul className="space-y-2">
              {card.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-gray-600">
                  <CheckIcon enabled={enabled} />
                  <span className={enabled === false ? "text-gray-400 line-through" : ""}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
