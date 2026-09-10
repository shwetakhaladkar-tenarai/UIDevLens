import React, { useId, useState } from "react";
import SeverityBadge from "./SeverityBadge.jsx";

/**
 * Clickable grid of named issue-count cards; clicking one expands its
 * findings below. Shared by FunctionalPanel and UiConsistencyPanel, which
 * both bucket a category's issues into named groups (see utils/issueBuckets.js).
 */
export default function IssueBucketGrid({ groups }) {
  const [open, setOpen] = useState(null);
  const openItems = groups.find((g) => g.key === open)?.items ?? [];
  const panelId = useId();

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setOpen(open === g.key ? null : g.key)}
            disabled={g.items.length === 0}
            aria-expanded={open === g.key}
            aria-controls={open === g.key ? panelId : undefined}
            className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
              g.items.length === 0
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-default"
                : open === g.key
                  ? "border-brand-300 bg-brand-50"
                  : "border-gray-200 bg-white hover:border-gray-400"
            }`}
          >
            <p className="text-xs text-gray-500">{g.label}</p>
            <p className={`mt-1 text-xl font-bold ${g.items.length ? "text-gray-900" : "text-gray-300"}`}>
              {g.items.length}
            </p>
          </button>
        ))}
      </div>

      {open && openItems.length > 0 && (
        <ul id={panelId} className="mt-4 space-y-2">
          {openItems.map((issue) => (
            <li key={issue.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={issue.severity} />
                <p className="text-sm font-medium text-gray-900">{issue.title}</p>
              </div>
              {issue.description && <p className="mt-1 text-xs text-gray-500">{issue.description}</p>}
              {issue.recommendation && (
                <p className="mt-1 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">Fix: </span>{issue.recommendation}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
