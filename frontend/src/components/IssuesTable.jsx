import React, { useMemo, useState } from "react";

const SEVERITY = {
  critical: { label: "Critical", badge: "bg-red-50 text-red-700 border-red-200",       rank: 5 },
  high:     { label: "High",     badge: "bg-orange-50 text-orange-700 border-orange-200", rank: 4 },
  medium:   { label: "Medium",   badge: "bg-amber-50 text-amber-700 border-amber-200", rank: 3 },
  low:      { label: "Low",      badge: "bg-blue-50 text-blue-700 border-blue-200",     rank: 2 },
  info:     { label: "Info",     badge: "bg-gray-100 text-gray-600 border-gray-200",     rank: 1 },
};

const CATEGORY = {
  performance:      "⚡ Performance",
  network:          "📡 Network",
  design:           "🎨 Design",
  responsive:       "📱 Responsive",
  accessibility:    "♿ Accessibility",
  functional:       "🧩 Functional",
  "ui-consistency": "🎨 UI Consistency",
  "cross-browser":  "🌐 Cross-Browser",
};

/** Render an evidence object as a short, human-readable string. */
function evidenceText(evidence) {
  if (!evidence || typeof evidence !== "object") return "—";
  const parts = [];
  for (const [k, v] of Object.entries(evidence)) {
    if (v == null || k === "merged" || k === "nodes") continue;
    if (typeof v === "object") continue; // skip nested blobs for the cell
    parts.push(`${k}: ${v}`);
    if (parts.length >= 3) break;
  }
  // Surface axe rule + affected element count if present
  if (evidence.axeRule && !parts.some((p) => p.startsWith("axeRule"))) {
    parts.unshift(`rule: ${evidence.axeRule}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

/** Best recommendation to show: analyzer's own, else the AI's advisory fix. */
function recommendationText(issue) {
  return issue.recommendation || issue.ai?.recommendation || "—";
}

/**
 * Issues table with a severity summary bar and a severity filter.
 * Columns: Severity | Category | Issue | Evidence | Recommendation
 *
 * @param {object[]} issues  stable-contract issue objects
 * @param {object}   counts  metadata.counts.bySeverity (optional; derived if absent)
 */
export default function IssuesTable({ issues = [], counts }) {
  const [filter, setFilter] = useState("all");

  const bySeverity = useMemo(() => {
    if (counts) return counts;
    const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const i of issues) if (i.severity in c) c[i.severity] += 1;
    return c;
  }, [issues, counts]);

  const filtered = useMemo(() => {
    const rows = filter === "all" ? issues : issues.filter((i) => i.severity === filter);
    return [...rows].sort(
      (a, b) => (SEVERITY[b.severity]?.rank ?? 0) - (SEVERITY[a.severity]?.rank ?? 0)
    );
  }, [issues, filter]);

  const SUMMARY = ["critical", "high", "medium", "low"];

  return (
    <section aria-labelledby="issues-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="issues-heading" className="text-base font-semibold text-gray-900">
          Issues <span className="text-sm font-normal text-gray-500">({issues.length})</span>
        </h2>

        {/* Severity summary chips (also act as filters) */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter issues by severity">
          <button
            type="button"
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
            className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
              filter === "all" ? "border-brand-300 bg-brand-50 text-brand-700"
              : "border-gray-300 bg-white text-gray-500 hover:border-gray-400"
            }`}
          >
            All ({issues.length})
          </button>
          {SUMMARY.map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setFilter(filter === sev ? "all" : sev)}
              aria-pressed={filter === sev}
              className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                filter === sev ? SEVERITY[sev].badge : "border-gray-300 bg-white text-gray-500 hover:border-gray-400"
              }`}
            >
              {SEVERITY[sev].label} ({bySeverity[sev] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">No issues in this category.</p>
      ) : (
        <div tabIndex={0} role="region" aria-label="Issues table" className="overflow-x-auto rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Severity</th>
                <th scope="col" className="px-4 py-3 font-medium">Category</th>
                <th scope="col" className="px-4 py-3 font-medium">Issue</th>
                <th scope="col" className="px-4 py-3 font-medium">Evidence</th>
                <th scope="col" className="px-4 py-3 font-medium">Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((issue) => {
                const sev = SEVERITY[issue.severity] ?? SEVERITY.info;
                return (
                  <tr key={issue.id} className="align-top transition-colors hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${sev.badge}`}>
                        {sev.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {CATEGORY[issue.category] ?? issue.category}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{issue.title}</p>
                      {issue.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{issue.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {evidenceText(issue.evidence)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {recommendationText(issue)}
                      {issue.ai?.recommendation && issue.ai.recommendation !== issue.recommendation && (
                        <span className="ml-1 text-brand-600" title="AI suggestion">🤖</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
