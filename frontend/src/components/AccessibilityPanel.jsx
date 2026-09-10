import React, { useMemo } from "react";
import SeverityBadge from "./SeverityBadge.jsx";

/**
 * WCAG rule id + affected selector come from two sources with different
 * shapes: Python's wcag_validator.py sets `rule`/`selector` directly on the
 * finding, while Node's live axe-core analyzer keeps them under
 * `evidence.axeRule` / `evidence.nodes[].selector` instead (see
 * accessibilityAnalyzer.js). Read whichever is present rather than only
 * the Python-shaped fields, so both engines' findings render fully.
 */
function ruleOf(f)     { return f.rule ?? f.evidence?.axeRule ?? "—"; }
function selectorOf(f) {
  if (f.selector) return f.selector;
  const nodes = f.evidence?.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return "—";
  const first = nodes[0]?.selector ?? "—";
  return nodes.length > 1 ? `${first} (+${nodes.length - 1} more)` : first;
}

/**
 * Accessibility / WCAG: target level, automated-violation count, the
 * per-finding severity/rule/selector table, and the manual-review
 * recommendations the WCAG validator explicitly does NOT count as
 * violations (python-validation/accessibility/wcag_validator.py) —
 * surfaced separately so a human can judge them, never scored.
 */
export default function AccessibilityPanel({ issues = [], accessibilityMeta = {}, accessibilitySummary }) {
  const findings = useMemo(() => issues.filter((i) => i.category === "accessibility"), [issues]);
  const { wcagLevel, automatedViolations, manualReviewRecommendations = [] } = accessibilityMeta;

  return (
    <section aria-labelledby="a11y-heading">
      <h2 id="a11y-heading" className="mb-4 text-base font-semibold text-gray-900">
        Accessibility / WCAG
      </h2>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">WCAG Target Level</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{wcagLevel ?? "n/a"}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Automated Violations</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{automatedViolations ?? findings.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Manual Review Items</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{manualReviewRecommendations.length}</p>
        </div>
      </div>

      {findings.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No automated WCAG violations detected — this is a partial, automated check only; see manual review items below.
        </p>
      ) : (
        <div tabIndex={0} role="region" aria-label="WCAG findings table" className="overflow-x-auto rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Severity</th>
                <th scope="col" className="px-4 py-3 font-medium">Rule</th>
                <th scope="col" className="px-4 py-3 font-medium">Selector</th>
                <th scope="col" className="px-4 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {findings.map((f) => (
                <tr key={f.id} className="align-top hover:bg-gray-50/80">
                  <td className="px-4 py-3"><SeverityBadge severity={f.severity} /></td>
                  <td className="px-4 py-3 text-xs text-gray-700">{ruleOf(f)}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-gray-500 break-all">{selectorOf(f)}</code>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{f.description || f.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {manualReviewRecommendations.length > 0 && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">
            Manual Review Recommendations
            <span className="ml-2 text-xs font-normal text-gray-500">
              (not automated violations — never scored; a human should judge these)
            </span>
          </p>
          <ul className="space-y-2">
            {manualReviewRecommendations.map((m, i) => (
              <li key={i} className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">{m.rule ?? "WCAG"}</span>
                {m.level && <span className="ml-1 text-gray-500">(Level {m.level})</span>}
                {m.selector && <code className="ml-2 text-gray-500 break-all">{m.selector}</code>}
                {m.reason && <p className="mt-0.5">{m.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {accessibilitySummary && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
          <span className="shrink-0 text-brand-600" aria-hidden="true">🤖</span>
          {accessibilitySummary}
        </p>
      )}
    </section>
  );
}
