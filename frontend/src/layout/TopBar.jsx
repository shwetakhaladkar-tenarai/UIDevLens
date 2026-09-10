import React from "react";

/**
 * Shared sticky top bar shell — each page fills `left`/`right` with its own
 * contextual content (pipeline status, search, primary/secondary actions).
 * `onMenuClick` shows a hamburger button below the lg breakpoint (sidebar is
 * a drawer there — see Sidebar.jsx).
 */
export default function TopBar({ left, right, onMenuClick }) {
  return (
    <div className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">{left}</div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </div>
  );
}
