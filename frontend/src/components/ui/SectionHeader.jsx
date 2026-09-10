import React from "react";

/**
 * Consistent section title row used at the top of each numbered card
 * ("01. Target Application Profiler & Configuration ... [status]").
 */
export default function SectionHeader({ step, title, status, action, id }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-base font-semibold text-gray-900">
        {step != null && <span className="text-gray-500">{step}. </span>}
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {status}
        {action}
      </div>
    </div>
  );
}
