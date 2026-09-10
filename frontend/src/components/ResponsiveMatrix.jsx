import React, { useMemo, useState } from "react";
import SeverityBadge from "./SeverityBadge.jsx";

const BROWSER_LABELS  = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" };
const VIEWPORT_LABELS = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
const VIEWPORT_ORDER  = ["desktop", "tablet", "mobile"];

/**
 * Responsive Matrix: one row per browser, one column per viewport. A cell is
 * PASS unless at least one category === "responsive" finding was recorded
 * for that exact (browser, viewport) pair (python-validation/responsive/
 * responsive_validator.py runs every configured browser × viewport
 * combination and tags each finding with both). Deterministic — no AI.
 */
export default function ResponsiveMatrix({ issues = [], validationPlan = {} }) {
  const responsive = useMemo(() => issues.filter((i) => i.category === "responsive"), [issues]);
  const enabled = validationPlan.checks?.responsive !== false;
  const [expandedCell, setExpandedCell] = useState(null);

  const browsers = (validationPlan.browsers?.length ? validationPlan.browsers : [...new Set(responsive.map((f) => f.browser))].filter(Boolean));
  const viewports = VIEWPORT_ORDER.filter((v) =>
    (validationPlan.viewports?.length ? validationPlan.viewports.includes(v) : responsive.some((f) => f.viewport === v))
  );

  const cellIssues = useMemo(() => {
    const map = new Map();
    for (const f of responsive) {
      const key = `${f.browser}::${f.viewport}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
    return map;
  }, [responsive]);

  if (!enabled) {
    return (
      <section aria-labelledby="responsive-heading">
        <h2 id="responsive-heading" className="mb-4 text-base font-semibold text-gray-900">Responsive Matrix</h2>
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Responsive checks were not enabled for this analysis.
        </p>
      </section>
    );
  }

  if (!browsers.length || !viewports.length) {
    return (
      <section aria-labelledby="responsive-heading">
        <h2 id="responsive-heading" className="mb-4 text-base font-semibold text-gray-900">Responsive Matrix</h2>
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No browser/viewport combinations were recorded for this analysis.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="responsive-heading">
      <h2 id="responsive-heading" className="mb-4 text-base font-semibold text-gray-900">
        Responsive Matrix <span className="text-sm font-normal text-gray-500">({responsive.length} findings)</span>
      </h2>
      <div tabIndex={0} role="region" aria-label="Responsive matrix table" className="overflow-x-auto rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Browser</th>
              {viewports.map((v) => (
                <th key={v} scope="col" className="px-4 py-3 font-medium">{VIEWPORT_LABELS[v] ?? v}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {browsers.map((b) => (
              <tr key={b} className="hover:bg-gray-50/80">
                <th scope="row" className="px-4 py-3 text-left font-medium text-gray-900">{BROWSER_LABELS[b] ?? b}</th>
                {viewports.map((v) => {
                  const key = `${b}::${v}`;
                  const cellFindings = cellIssues.get(key) ?? [];
                  const pass = cellFindings.length === 0;
                  const isOpen = expandedCell === key;
                  return (
                    <td key={v} className="px-4 py-3">
                      {pass ? (
                        <span className="inline-block rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                          PASS
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setExpandedCell(isOpen ? null : key)}
                          aria-expanded={isOpen}
                          aria-controls={`responsive-cell-${key}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 ${
                            isOpen
                              ? "border-red-300 bg-red-100 text-red-800"
                              : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          }`}
                        >
                          {`ISSUES (${cellFindings.length})`}
                          <span aria-hidden="true">{isOpen ? "▲" : "▾"}</span>
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expandedCell && (() => {
        const [b, v] = expandedCell.split("::");
        const cellFindings = cellIssues.get(expandedCell) ?? [];
        return (
          <div id={`responsive-cell-${expandedCell}`} className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-900">
                {BROWSER_LABELS[b] ?? b} &middot; {VIEWPORT_LABELS[v] ?? v}
                <span className="ml-2 text-xs font-normal text-gray-500">({cellFindings.length} finding{cellFindings.length === 1 ? "" : "s"})</span>
              </p>
              <button
                type="button"
                onClick={() => setExpandedCell(null)}
                aria-label="Close findings"
                className="rounded text-xs font-medium text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                ✕ Close
              </button>
            </div>
            <ul className="space-y-2">
              {cellFindings.map((f) => (
                <li key={f.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <SeverityBadge severity={f.severity} />
                    <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-gray-900">{f.title}</span>
                  </div>
                  {f.description && (
                    <p className="mt-1.5 break-words text-xs leading-relaxed text-gray-500">{f.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </section>
  );
}
