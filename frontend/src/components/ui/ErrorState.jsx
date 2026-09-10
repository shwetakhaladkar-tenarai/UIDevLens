import React from "react";
import Button from "./Button.jsx";

/** Error block for network/server failures — e.g. analysisApi.js throws with a clear message. */
export default function ErrorState({ message, onRetry, className = "" }) {
  return (
    <div role="alert" className={`flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center ${className}`}>
      <svg aria-hidden="true" className="h-8 w-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="13" strokeLinecap="round" />
        <circle cx="12" cy="16" r="0.5" fill="currentColor" />
      </svg>
      <p className="text-sm font-medium text-red-800">{message || "Something went wrong."}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
