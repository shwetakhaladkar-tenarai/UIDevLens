import React from "react";

function tone(score) {
  if (score >= 90) return { text: "text-green-400",  ring: "stroke-green-400"  };
  if (score >= 75) return { text: "text-emerald-400", ring: "stroke-emerald-400" };
  if (score >= 60) return { text: "text-yellow-400", ring: "stroke-yellow-400" };
  if (score >= 40) return { text: "text-orange-400", ring: "stroke-orange-400" };
  return               { text: "text-red-400",    ring: "stroke-red-400"    };
}

/**
 * A single score as a circular gauge. `primary` renders larger for the overall score.
 */
export default function ScoreCard({ label, score = 0, primary = false }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const t = tone(value);
  const r = primary ? 46 : 38;
  const stroke = primary ? 8 : 6;
  const size = (r + stroke) * 2;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;

  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 p-4 ${primary ? "sm:col-span-1" : ""}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} score ${value} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-gray-800" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={`${t.ring} transition-all duration-700`}
        />
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="currentColor"
          className={`${t.text} font-bold`} fontSize={primary ? 24 : 18}>
          {value}
        </text>
      </svg>
      <span className={`mt-2 text-xs font-medium ${primary ? "text-white" : "text-gray-400"}`}>{label}</span>
    </div>
  );
}
