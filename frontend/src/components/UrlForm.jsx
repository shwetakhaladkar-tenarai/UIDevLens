import React, { useState } from "react";

const DEMO_URLS = [
  "https://example.com",
  "https://github.com",
  "https://news.ycombinator.com",
];

export default function UrlForm({ onSubmit, analyzing }) {
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
      return "Please enter a valid URL (e.g. https://example.com).";
    }
    return "";
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate(url);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    onSubmit(url.trim());
  }

  function handleDemo(demoUrl) {
    setUrl(demoUrl);
    setError("");
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label htmlFor="url-input" className="sr-only">
            Website URL to analyze
          </label>
          <input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError("");
            }}
            placeholder="https://your-website.com"
            disabled={analyzing}
            className="w-full bg-gray-800 border border-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl px-4 py-3 text-white placeholder-gray-500 outline-none transition-colors disabled:opacity-50 text-sm"
            aria-describedby={error ? "url-error" : undefined}
            aria-invalid={!!error}
          />
          {error && (
            <p id="url-error" className="mt-1.5 text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={analyzing}
          className="shrink-0 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-colors text-sm flex items-center gap-2"
        >
          {analyzing ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
              Analyzing…
            </>
          ) : (
            "Analyze"
          )}
        </button>
      </div>

      {/* Demo URL shortcuts */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Try:</span>
        {DEMO_URLS.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => handleDemo(u)}
            disabled={analyzing}
            className="text-xs text-brand-500 hover:text-brand-400 hover:underline disabled:opacity-40 transition-colors"
          >
            {u.replace("https://", "")}
          </button>
        ))}
      </div>
    </form>
  );
}
