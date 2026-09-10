import React from "react";

/** Search box with a leading icon — used in top bars (Reports, Rule Profiles). */
export default function SearchInput({ value, onChange, placeholder = "Search…", className = "", ariaLabel }) {
  return (
    <div className={`relative ${className}`}>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
      >
        <circle cx="9" cy="9" r="6" />
        <line x1="14" y1="14" x2="18" y2="18" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40"
      />
    </div>
  );
}
