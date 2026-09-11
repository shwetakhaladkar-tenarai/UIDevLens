import React from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import ScoreCard from "./ScoreCard.jsx";

export const SCORE_CATEGORIES = [
  { key: "functional",    label: "Functional UI",        panel: "functional" },
  { key: "accessibility", label: "Accessibility / WCAG", panel: "accessibility" },
  { key: "responsive",    label: "Responsiveness",       panel: "responsive" },
  { key: "crossBrowser",  label: "Cross-Browser",        panel: "cross-browser" },
  { key: "performance",   label: "Performance",          panel: "performance" },
  { key: "uiConsistency", label: "UI Consistency",       panel: "ui-consistency" },
];

function isNumber(v) {
  return typeof v === "number";
}

/**
 * Score overview: an overall gauge plus one clickable gauge per validation
 * category. Clicking a category card opens its detail panel below (handled
 * by the parent via onCategoryClick). The active category is highlighted.
 *
 * Also renders a radar chart comparing whichever categories actually ran.
 * A category the validation plan didn't enable is {status:"not-run"} —
 * excluded from the radar chart entirely rather than plotted as a fake 0.
 */
export default function ScoreOverview({ scores = {}, activePanel = null, onCategoryClick }) {
  const { overall = 0, label } = scores;

  const radarData = SCORE_CATEGORIES
    .filter((c) => isNumber(scores[c.key]))
    .map((c) => ({ axis: c.label, value: scores[c.key] }));

  return (
    <section aria-labelledby="scores-heading">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id="scores-heading" className="text-base font-semibold text-gray-900">Overall Score</h2>
        {label && <span className="text-sm text-gray-500">{label}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Gauges */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {/* Overall — not clickable */}
          <ScoreCard label="Overall" score={overall} primary />

          {/* Category cards — each opens its detail panel */}
          {SCORE_CATEGORIES.map((c) => (
            <ScoreCard
              key={c.key}
              label={c.label}
              score={scores[c.key]}
              active={activePanel === c.panel}
              onClick={() => onCategoryClick?.(c.panel)}
            />
          ))}
        </div>

        {/* Radar — only categories that actually ran */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="h-56 w-full" role="img" aria-label="Radar chart of category scores">
            {radarData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: "#6b7280", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, color: "#111827", fontSize: 12 }}
                    formatter={(v) => [`${v}/100`, "Score"]}
                  />
                  <Radar dataKey="value" stroke="#3b55e6" fill="#4f6ef7" fillOpacity={0.2} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                No categories ran for this analysis.
              </div>
            )}
          </div>
        </div>
      </div>

      {onCategoryClick && (
        <p className="mt-3 text-xs text-gray-400 text-center">Click a category score to view its detail panel below.</p>
      )}
    </section>
  );
}
