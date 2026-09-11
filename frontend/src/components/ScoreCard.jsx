import React from "react";

function tone(score) {
  if (score >= 90) return { text: "text-green-600",  ring: "stroke-green-500"  };
  if (score >= 75) return { text: "text-emerald-600", ring: "stroke-emerald-500" };
  if (score >= 60) return { text: "text-amber-600", ring: "stroke-amber-500" };
  if (score >= 40) return { text: "text-orange-600", ring: "stroke-orange-500" };
  return               { text: "text-red-600",    ring: "stroke-red-500"    };
}

/**
 * A single score as a circular gauge. `primary` renders larger for the overall score.
 * `score` may be a 0-100 number, or {status:"not-run"} when the validation
 * plan didn't enable this category — rendered as a muted "Not run" gauge
 * instead of a fake number.
 */
export default function ScoreCard({ label, score = 0, primary = false, active = false, onClick }) {
  const notRun = score && typeof score === "object" && score.status === "not-run";
  const value = notRun ? 0 : Math.max(0, Math.min(100, Math.round(score)));
  const t = notRun ? { text: "text-gray-500", ring: "stroke-gray-300" } : tone(value);
  const r = primary ? 46 : 38;
  const stroke = primary ? 8 : 6;
  const size = (r + stroke) * 2;
  const circ = 2 * Math.PI * r;
  const dash = notRun ? 0 : (value / 100) * circ;

  const isClickable = typeof onClick === "function";

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={isClickable ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      aria-pressed={isClickable ? active : undefined}
      className={`flex flex-col items-center justify-center rounded-xl border bg-white p-4 transition-all
        ${primary ? "sm:col-span-1" : ""}
        ${isClickable ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2" : ""}
        ${active ? "border-brand-400 ring-2 ring-brand-400/30 shadow-sm" : "border-gray-200"}
        ${isClickable && !active ? "hover:border-brand-300 hover:shadow-sm" : ""}
      `}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={notRun ? `${label} not run` : `${label} score ${value} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-gray-100" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={`${t.ring} transition-all duration-700`}
        />
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="currentColor"
          className={`${t.text} font-bold`} fontSize={notRun ? (primary ? 13 : 11) : (primary ? 24 : 18)}>
          {notRun ? "—" : value}
        </text>
      </svg>
      <span className={`mt-2 text-xs font-medium ${primary ? "text-gray-900" : "text-gray-500"}`}>{label}</span>
      {notRun && <span className="text-[11px] text-gray-500">Not run</span>}
    </div>
  );
}
