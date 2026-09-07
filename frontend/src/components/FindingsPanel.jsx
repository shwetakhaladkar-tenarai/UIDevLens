import React, { useState } from "react";

const SEVERITY_STYLES = {
  critical: { badge: "bg-red-500/20 text-red-400 border-red-500/30",    dot: "bg-red-400",    label: "Critical" },
  high:     { badge: "bg-orange-500/20 text-orange-400 border-orange-500/30", dot: "bg-orange-400", label: "High" },
  medium:   { badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", dot: "bg-yellow-400", label: "Medium" },
  low:      { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",  dot: "bg-blue-400",   label: "Low" },
  info:     { badge: "bg-gray-500/20 text-gray-400 border-gray-500/30",  dot: "bg-gray-400",   label: "Info" },
};

const CATEGORY_LABELS = {
  performance:   { label: "Performance",   icon: "⚡" },
  network:       { label: "Network",       icon: "📡" },
  design:        { label: "Design",        icon: "🎨" },
  responsive:    { label: "Responsive",    icon: "📱" },
  accessibility: { label: "Accessibility", icon: "♿" },
};

function FindingCard({ finding }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info;

  return (
    <li className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-800/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{finding.title}</p>
          <p className="text-xs text-gray-500 truncate mt-0.5">{finding.description}</p>
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${sev.badge}`}>
          {sev.label}
        </span>
        <span className="text-gray-600 text-xs ml-1 shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 bg-gray-900/50 border-t border-gray-800 space-y-3">
          {finding.description && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Description</p>
              <p className="text-xs text-gray-300">{finding.description}</p>
            </div>
          )}
          {finding.impact && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Impact</p>
              <p className="text-xs text-gray-300">{finding.impact}</p>
            </div>
          )}
          {finding.recommendation && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Recommendation</p>
              <p className="text-xs text-gray-300">{finding.recommendation}</p>
            </div>
          )}
          {/* AI annotation (advisory only — never overwrites factual fields) */}
          {finding.ai && (
            <div className="border-t border-gray-800 pt-3 space-y-2">
              <p className="text-xs font-medium text-brand-400">
                🤖 AI insight
                {finding.ai.priority != null && (
                  <span className="ml-2 text-gray-500">priority #{finding.ai.priority}</span>
                )}
                {finding.ai.impact && finding.ai.effort && (
                  <span className="ml-2 text-gray-500">
                    impact: {finding.ai.impact} · effort: {finding.ai.effort}
                  </span>
                )}
              </p>
              {finding.ai.likelyRootCause && (
                <p className="text-xs text-gray-300">
                  <span className="font-medium text-gray-400">Likely cause: </span>
                  {finding.ai.likelyRootCause}
                </p>
              )}
              {finding.ai.recommendation && (
                <p className="text-xs text-gray-300">
                  <span className="font-medium text-gray-400">Suggested fix: </span>
                  {finding.ai.recommendation}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function FindingsPanel({ issues = [] }) {
  const [activeTab, setActiveTab] = useState("all");

  const categories = ["all", "performance", "network", "design", "responsive", "accessibility"];

  const allFindings = issues;
  const countFor = (cat) => allFindings.filter((f) => f.category === cat).length;

  const displayed =
    activeTab === "all"
      ? allFindings
      : allFindings.filter((f) => f.category === activeTab);

  return (
    <section aria-labelledby="findings-heading">
      <h2 id="findings-heading" className="text-base font-semibold text-white mb-4">
        Findings
        <span className="ml-2 text-xs text-gray-500 font-normal">
          {allFindings.length} total
        </span>
      </h2>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-4" role="tablist">
        {categories.map((cat) => {
          const count = cat === "all" ? allFindings.length : countFor(cat);
          const info = CATEGORY_LABELS[cat] ?? { label: "All", icon: "📋" };
          return (
            <button
              key={cat}
              role="tab"
              aria-selected={activeTab === cat}
              onClick={() => setActiveTab(cat)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                activeTab === cat
                  ? "bg-brand-500/20 border-brand-500/40 text-brand-400"
                  : "bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              {cat !== "all" && <span aria-hidden="true">{info.icon}</span>}
              {cat === "all" ? "All" : info.label}
              <span className="ml-0.5 opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {displayed.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">No findings in this category.</p>
      ) : (
        <ul className="space-y-2" role="tabpanel">
          {displayed.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </section>
  );
}
