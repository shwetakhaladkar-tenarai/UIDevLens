import React, { useMemo } from "react";
import SeverityBadge from "./SeverityBadge.jsx";

const BROWSER_LABELS = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" };

/**
 * Cross-Browser Findings: differences that occur only in specific browsers
 * (python-validation/responsive/cross_browser_validator.py), grouped by the
 * browser they were observed in. crossBrowserSummary is the AI's narrative
 * gloss on this same evidence — shown secondary to, never instead of, it.
 */
export default function CrossBrowserFindings({ issues = [], crossBrowserSummary }) {
  const findings = useMemo(() => issues.filter((i) => i.category === "cross-browser"), [issues]);

  const byBrowser = useMemo(() => {
    const map = new Map();
    for (const f of findings) {
      const b = f.browser || "unknown";
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(f);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [findings]);

  return (
    <section aria-labelledby="cross-browser-heading">
      <h2 id="cross-browser-heading" className="mb-4 text-base font-semibold text-gray-900">
        Cross-Browser Findings <span className="text-sm font-normal text-gray-500">({findings.length})</span>
      </h2>

      {findings.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No browser-specific differences detected — either every tested browser behaved consistently, or cross-browser checks did not run.
        </p>
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2">
          {byBrowser.map(([browser, items]) => (
            <div key={browser} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-gray-900">
                {BROWSER_LABELS[browser] ?? browser}
                <span className="ml-2 text-xs font-normal text-gray-500">({items.length})</span>
              </p>
              <ul className="space-y-2">
                {items.map((f) => (
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
          ))}
        </div>
      )}

      {crossBrowserSummary && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-xs leading-relaxed text-gray-600">
          <span className="shrink-0 text-brand-600" aria-hidden="true">🤖</span>
          <span className="min-w-0 flex-1 break-words">{crossBrowserSummary}</span>
        </p>
      )}
    </section>
  );
}
