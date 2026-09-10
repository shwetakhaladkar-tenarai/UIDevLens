import React from "react";

/**
 * Simple controlled tab list. `tabs`: [{id,label,badge?}], `active`: id,
 * `onChange`: (id) => void. Wires id/aria-controls to matching tabpanel
 * ids ("tab-<id>" / "panel-<id>") so callers just need to give their panel
 * `role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}`.
 * Arrow keys move focus + selection between tabs per the standard tablist pattern.
 */
export default function Tabs({ tabs = [], active, onChange, className = "" }) {
  function onKeyDown(e, index) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    onChange?.(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div role="tablist" className={`flex flex-wrap gap-1 border-b border-gray-200 ${className}`}>
      {tabs.map((t, i) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange?.(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
              isActive
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${isActive ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-600"}`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
