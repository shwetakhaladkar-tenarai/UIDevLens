import React from "react";

/**
 * Top strategic recommendations (from AI reasoning; array of strings).
 */
export default function RecommendationList({ recommendations = [] }) {
  if (!recommendations.length) return null;

  return (
    <section aria-labelledby="rec-heading" className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 id="rec-heading" className="mb-3 text-base font-semibold text-white">
        📋 Top Recommendations
      </h2>
      <ol className="space-y-2">
        {recommendations.map((rec, i) => (
          <li key={i} className="flex gap-3 text-sm text-gray-300">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xs font-semibold text-brand-400">
              {i + 1}
            </span>
            <span>{rec}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
