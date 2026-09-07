import React from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export default function ScoresChart({ scores }) {
  const data = [
    { subject: "Performance", value: scores.performance ?? 0 },
    { subject: "Design",      value: scores.design ?? 0 },
    { subject: "Accessibility", value: scores.accessibility ?? 0 },
  ];

  return (
    <div className="w-full h-52" role="img" aria-label="Radar chart of category scores">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <PolarGrid stroke="#374151" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: "#9ca3af", fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#f9fafb",
              fontSize: "12px",
            }}
            formatter={(val) => [`${val}/100`, "Score"]}
          />
          <Radar
            name="Score"
            dataKey="value"
            stroke="#4f6ef7"
            fill="#4f6ef7"
            fillOpacity={0.25}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
