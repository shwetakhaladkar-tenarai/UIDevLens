import React from "react";

/**
 * Quick wins — high-impact / low-effort actionable items (array of strings).
 */
export default function QuickWins({ quickWins = [] }) {
  if (!quickWins.length) return null;

  return (
    <section aria-labelledby="qw-heading" className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 id="qw-heading" className="mb-3 text-base font-semibold text-white">
        ⚡ Quick Wins
      </h2>
      <ul className="space-y-2">
        {quickWins.map((win, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-300">
            <span className="shrink-0 text-green-400" aria-hidden="true">✓</span>
            <span>{win}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
