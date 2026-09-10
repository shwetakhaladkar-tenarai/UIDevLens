import React from "react";

/**
 * Accessible on/off switch (role="switch"). Used for rule-profile check
 * toggles — most of the app's toggles are display-only reflections of the
 * backend's real validation plan, so `disabled` is expected to be true more
 * often than not; the label still explains what the toggle represents.
 */
export default function Toggle({ checked = false, onChange, disabled = false, label, className = "" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-brand-600" : "bg-gray-300"
      } ${className}`}
    >
      {label && <span className="sr-only">{label}</span>}
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(4px)" }}
      />
    </button>
  );
}
