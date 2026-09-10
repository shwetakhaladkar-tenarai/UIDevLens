import React from "react";

const COLORS = {
  gray:   "bg-gray-100 text-gray-700 border-gray-200",
  blue:   "bg-blue-50 text-blue-700 border-blue-200",
  green:  "bg-green-50 text-green-700 border-green-200",
  amber:  "bg-amber-50 text-amber-700 border-amber-200",
  red:    "bg-red-50 text-red-700 border-red-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
};

/** Generic colored pill. `color`: gray|blue|green|amber|red|purple. */
export default function Badge({ color = "gray", className = "", children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${COLORS[color] ?? COLORS.gray} ${className}`}
    >
      {children}
    </span>
  );
}
