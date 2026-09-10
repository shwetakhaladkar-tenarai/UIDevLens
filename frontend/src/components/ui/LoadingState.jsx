import React from "react";

/** Small inline loading indicator for section-level async fetches (not the full-page pipeline experience). */
export default function LoadingState({ message = "Loading…", className = "" }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-3 py-8 text-sm text-gray-500 ${className}`}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" aria-hidden="true" />
      {message}
    </div>
  );
}
