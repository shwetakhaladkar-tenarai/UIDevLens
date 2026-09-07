import React, { useMemo, useState } from "react";

const SEVERITY = {
  critical: { label: "Critical", badge: "bg-red-500/20 text-red-400 border-red-500/30",       rank: 5 },
  high:     { label: "High",     badge: "bg-orange-500/20 text-orange-400 border-orange-500/30", rank: 4 },
  medium:   { label: "Medium",   badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", rank: 3 },
  low:      { label: "Low",      badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",     rank: 2 },
  info:     { label: "Info",     badge: "bg-gray-500/20 text-gray-400 border-gray-500/30",     rank: 1 },
};

const CATEGORY = {
  performance:   "⚡ Performance",
  network:       "📡 Network",
  design:        "🎨 Design",
  responsive:    "📱 Responsive",
  accessibility: "♿ Accessibility",
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
        <h2 id="issues-heading" className="text-base font-semibold text-white">
          Issues <span className="text-sm font-normal text-gray-500">({issues.length})</span>
        </h2>

        {/* Severity summary chips (also act as filters) */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === "all" ? "border-brand-500/40 bg-brand-500/20 text-brand-300"
              : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
            }`}
          >
            All ({issues.length})
          </button>
          {SUMMARY.map((sev) => (
            <button
              key={sev}
              onClick={() => setFilter(filter === sev ? "all" : sev)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === sev ? SEVERITY[sev].badge : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
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
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Issue</th>
                <th className="px-4 py-3 font-medium">Evidence</th>
                <th className="px-4 py-3 font-medium">Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((issue) => {
                const sev = SEVERITY[issue.severity] ?? SEVERITY.info;
                return (
                  <tr key={issue.id} className="align-top transition-colors hover:bg-gray-900/50">
                    <td className="px-4 py-3">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${sev.badge}`}>
                        {sev.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                      {CATEGORY[issue.category] ?? issue.category}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{issue.title}</p>
                      {issue.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{issue.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {evidenceText(issue.evidence)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-300">
                      {recommendationText(issue)}
                      {issue.ai?.recommendation && issue.ai.recommendation !== issue.recommendation && (
                        <span className="ml-1 text-brand-400" title="AI suggestion">🤖</span>
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
