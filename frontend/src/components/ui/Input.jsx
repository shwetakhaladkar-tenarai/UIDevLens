import React, { useId } from "react";

/** Text input with an optional visible label (falls back to sr-only) and error message. */
export default function Input({ label, hideLabel = false, error, className = "", id, ...rest }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      {label && (
        <label
          htmlFor={inputId}
          className={hideLabel ? "sr-only" : "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
          error ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-brand-500"
        } ${className}`}
        {...rest}
      />
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
