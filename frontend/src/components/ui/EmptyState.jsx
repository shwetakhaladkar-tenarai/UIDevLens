import React from "react";

/** Centered icon/title/description block for empty lists and not-yet-available screens. */
export default function EmptyState({ icon, title, description, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center ${className}`}>
      {icon && <div aria-hidden="true" className="mb-3 text-gray-400">{icon}</div>}
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
