import React, { useState } from "react";

const SAMPLES = ["https://example.com", "https://news.ycombinator.com"];

/**
 * URL input + Analyze button. Validates the URL client-side before submitting.
 */
export default function UrlInput({ onAnalyze, analyzing }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  function validate(value) {
    if (!value.trim()) return "Please enter a URL.";
    try {
      const u = new URL(value.trim());
      if (!["http:", "https:"].includes(u.protocol)) {
        return "Only http:// and https:// URLs are supported.";
      }
    } catch {
      return "Enter a valid URL, e.g. https://example.com";
    }
    return "";
  }

  function submit(e) {
    e.preventDefault();
    const err = validate(url);
    if (err) return setError(err);
    setError("");
    onAnalyze(url.trim());
  }

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label htmlFor="url" className="sr-only">Website URL</label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); if (error) setError(""); }}
            placeholder="https://your-website.com"
            disabled={analyzing}
            aria-invalid={!!error}
            aria-describedby={error ? "url-error" : undefined}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={analyzing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
              Analyzing…
            </>
          ) : "Analyze"}
        </button>
      </div>

      {error && (
        <p id="url-error" role="alert" className="mt-2 text-xs text-red-400">{error}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Try:</span>
        {SAMPLES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={analyzing}
            onClick={() => { setUrl(s); setError(""); }}
            className="text-xs text-brand-400 transition-colors hover:text-brand-300 hover:underline disabled:opacity-40"
          >
            {s.replace("https://", "")}
          </button>
        ))}
      </div>
    </form>
  );
}
