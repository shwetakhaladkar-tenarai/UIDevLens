import React from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import ScoreCard from "./ScoreCard.jsx";

/**
 * Score overview: four gauges (overall, performance, design, accessibility)
 * plus a radar chart comparing the three category scores (Recharts — useful here
 * for at-a-glance shape comparison).
 */
export default function ScoreOverview({ scores = {} }) {
  const { overall = 0, performance = 0, design = 0, accessibility = 0, label } = scores;

  const radarData = [
    { axis: "Performance",   value: performance },
    { axis: "Design",        value: design },
    { axis: "Accessibility", value: accessibility },
  ];

  return (
    <section aria-labelledby="scores-heading">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id="scores-heading" className="text-base font-semibold text-white">Scores</h2>
        {label && <span className="text-sm text-gray-400">{label}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Gauges */}
        <div className="grid grid-cols-2 gap-4">
          <ScoreCard label="Overall"       score={overall} primary />
          <ScoreCard label="Performance"   score={performance} />
          <ScoreCard label="Design"        score={design} />
          <ScoreCard label="Accessibility" score={accessibility} />
        </div>

        {/* Radar */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="h-56 w-full" role="img" aria-label="Radar chart of category scores">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, color: "#f9fafb", fontSize: 12 }}
                  formatter={(v) => [`${v}/100`, "Score"]}
                />
                <Radar dataKey="value" stroke="#4f6ef7" fill="#4f6ef7" fillOpacity={0.25} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
