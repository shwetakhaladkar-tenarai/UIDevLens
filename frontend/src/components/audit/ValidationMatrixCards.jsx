import React from "react";

/**
 * Five cards summarizing what the real validation plan (built by
 * validationPlannerNode from the selected rule profile — see
 * metadata.validationPlan) enabled for this run. Each item's checkmark
 * reflects the real per-category enabled flag from `validationPlan.checks`;
 * the backend doesn't expose finer-than-category granularity, so items
 * within a card share that category's state rather than inventing one.
 * Before any run, everything renders neutral (no plan exists yet) rather
 * than a fake "all enabled" guess.
 */
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

function CheckIcon({ enabled }) {
  if (enabled === null) {
    return <span aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-300 bg-white" />;
  }
  return enabled ? (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm bg-brand-600 text-white">
      <path d="M3 7.2 5.8 10 11 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <span aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-300 bg-gray-100" />
  );
}

export default function ValidationMatrixCards({ checks }) {
  // No plan yet (pre-run): every card is neutral (null), not a fake guess.
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
