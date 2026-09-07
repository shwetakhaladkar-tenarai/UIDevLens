import React from "react";

function scoreColor(score) {
  if (score >= 90) return { text: "text-green-400",  ring: "stroke-green-400",  bg: "bg-green-400/10"  };
  if (score >= 75) return { text: "text-blue-400",   ring: "stroke-blue-400",   bg: "bg-blue-400/10"   };
  if (score >= 60) return { text: "text-yellow-400", ring: "stroke-yellow-400", bg: "bg-yellow-400/10" };
  if (score >= 40) return { text: "text-orange-400", ring: "stroke-orange-400", bg: "bg-orange-400/10" };
  return               { text: "text-red-400",    ring: "stroke-red-400",    bg: "bg-red-400/10"    };
}

export default function ScoreGauge({ score = 0, label = "", size = "lg" }) {
  const colors = scoreColor(score);
  const radius = size === "lg" ? 52 : 38;
  const stroke = size === "lg" ? 8 : 6;
  const svgSize = (radius + stroke) * 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  return (
    <div className={`flex flex-col items-center gap-2 p-4 rounded-2xl ${colors.bg}`}>
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        role="img"
        aria-label={`${label} score: ${score} out of 100`}
      >
        {/* Track */}
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-gray-800"
        />
        {/* Progress */}
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          strokeDashoffset={0}
          transform={`rotate(-90 ${svgSize / 2} ${svgSize / 2})`}
          className={`${colors.ring} transition-all duration-700`}
        />
        {/* Score text */}
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className={`${colors.text} font-bold`}
          fill="currentColor"
          fontSize={size === "lg" ? 22 : 16}
        >
          {score}
        </text>
      </svg>
      <span className={`text-xs font-medium ${colors.text}`}>{label}</span>
    </div>
  );
}
