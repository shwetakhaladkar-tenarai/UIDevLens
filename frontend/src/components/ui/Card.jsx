import React from "react";

/** White card with a subtle border — the base surface for every section. `as` picks the rendered tag (div/section/article/...). */
export default function Card({ as: Tag = "div", className = "", children, ...rest }) {
  return (
    <Tag
      className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
