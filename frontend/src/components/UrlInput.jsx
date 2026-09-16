import React, { useId, useState } from "react";
import { addRecentUrl, clearRecentUrls, getRecentUrls } from "../services/urlHistory.js";

/**
 * URL input + Analyze button. Validates the URL client-side before submitting.
 *
 * Controlled: `value`/`onValueChange` own the field's text (the caller is
 * expected to keep this in state that survives whatever the caller itself
 * is subject to — e.g. AuditRun.jsx sources it from AuditRunContext so the
 * typed URL survives navigating away from /audit and back, instead of
 * being lost to this component unmounting).
 *
 * `formId` names the <form> so an external button elsewhere on the page
 * can submit it via the HTML `form="..."` attribute without duplicating
 * this component's validation logic. `hideSubmitButton` hides the inline
 * button when that external trigger is the only one shown.
 *
 * Every submitted URL is remembered (services/urlHistory.js, localStorage)
 * — shown as a "Recent" chip row (click = re-run immediately) and as native
 * browser autocomplete via <datalist>, so a URL you've analyzed before is
 * always easy to find and run again, independent of whether that run
 * succeeded (this is history of what you searched, not of results — see
 * services/runHistory.js / the Reports page for completed-run history).
 */
export default function UrlInput({ value, onValueChange, onAnalyze, analyzing, formId, hideSubmitButton = false }) {
  const [error, setError] = useState("");
  const [recentUrls, setRecentUrls] = useState(() => getRecentUrls());
  const datalistId = useId();

  function validate(v) {
    if (!v.trim()) return "Please enter a URL.";
    try {
      const u = new URL(v.trim());
      if (!["http:", "https:"].includes(u.protocol)) {
        return "Only http:// and https:// URLs are supported.";
      }
    } catch {
      return "Enter a valid URL, e.g. https://example.com";
    }
    return "";
  }

  function run(rawUrl) {
    const trimmed = rawUrl.trim();
    const err = validate(trimmed);
    if (err) return setError(err);
    setError("");
    setRecentUrls(addRecentUrl(trimmed));
    onAnalyze(trimmed);
  }

  function submit(e) {
    e.preventDefault();
    run(value);
  }

  function runRecent(u) {
    onValueChange(u);
    setError("");
    run(u);
  }

  function handleClearRecent() {
    setRecentUrls(clearRecentUrls());
  }

  return (
    <form id={formId} onSubmit={submit} noValidate className="w-full">
      {/* Input + button joined as one unit */}
      <div className={`flex items-stretch rounded-lg border bg-white transition-colors ${error ? "border-red-400 focus-within:ring-2 focus-within:ring-red-400/40" : "border-gray-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/40"}`}>
        <label htmlFor="url" className="sr-only">Website URL</label>
        <input
          id="url"
          type="url"
          list={datalistId}
          value={value}
          onChange={(e) => { onValueChange(e.target.value); if (error) setError(""); }}
          placeholder="https://your-website.com"
          disabled={analyzing}
          aria-invalid={!!error}
          aria-describedby={error ? "url-error" : undefined}
          className="min-w-0 flex-1 rounded-l-lg bg-transparent px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none disabled:opacity-50"
        />
        <datalist id={datalistId}>
          {recentUrls.map((u) => <option key={u} value={u} />)}
        </datalist>
        {!hideSubmitButton && (
          <button
            type="submit"
            disabled={analyzing}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-r-lg border-l border-gray-300 bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzing ? (
              <>Analyzing…</>
            ) : (
              <>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <circle cx="8.5" cy="8.5" r="5" />
                  <path d="M13 13L17 17" strokeLinecap="round" />
                  <path d="M8.5 6.5v2H10.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Analyze
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <p id="url-error" role="alert" className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {recentUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Recent:</span>
          {recentUrls.slice(0, 6).map((u) => (
            <button
              key={u}
              type="button"
              disabled={analyzing}
              onClick={() => runRecent(u)}
              title={`Run ${u} again`}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-40"
            >
              <span aria-hidden="true" className="text-gray-400">↻</span>
              {u.replace(/^https?:\/\//, "")}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClearRecent}
            className="text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white rounded"
          >
            Clear
          </button>
        </div>
      )}
    </form>
  );
}
