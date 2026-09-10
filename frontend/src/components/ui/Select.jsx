import React, { useId } from "react";

/** Native select styled to match Input — options: [{value,label}]. */
export default function Select({ label, hideLabel = false, options = [], className = "", id, ...rest }) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div>
      {label && (
        <label
          htmlFor={selectId}
          className={hideLabel ? "sr-only" : "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"}
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
