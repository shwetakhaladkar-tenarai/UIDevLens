import React from "react";

const VARIANTS = {
  primary:   "bg-brand-600 text-white hover:bg-brand-700 border border-transparent",
  secondary: "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50",
  ghost:     "bg-transparent text-gray-600 border border-transparent hover:bg-gray-100",
  danger:    "bg-red-600 text-white hover:bg-red-700 border border-transparent",
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
};

/** Shared button primitive. `variant`: primary|secondary|ghost|danger. `size`: sm|md|lg. */
export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  disabled = false,
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant] ?? VARIANTS.secondary} ${SIZES[size] ?? SIZES.md} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
