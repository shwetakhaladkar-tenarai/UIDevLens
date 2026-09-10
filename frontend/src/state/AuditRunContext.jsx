import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { analyzeUrl } from "../services/analysisApi.js";
import { saveRun } from "../services/runHistory.js";

const AuditRunContext = createContext(null);

const STORAGE_KEY = "qa_current_run_v1";

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { urlValue: "", report: null };
    const parsed = JSON.parse(raw);
    return {
      urlValue: typeof parsed?.urlValue === "string" ? parsed.urlValue : "",
      report: parsed?.report ?? null,
    };
  } catch {
    return { urlValue: "", report: null }; // corrupted/unavailable storage — fail to a clean slate
  }
}

/**
 * Holds the in-progress/most-recent analysis run's state ABOVE the router
 * (see App.jsx — this Provider wraps <Routes>, AuditRun.jsx just consumes
 * it), so the report and typed URL survive both navigating away from /audit
 * and back, and a full page reload (mirrored to localStorage — a reload
 * remounts everything, so context state alone isn't enough). `analyzing`
 * is deliberately not persisted: a reload aborts any in-flight request, so
 * there's nothing to resume — starting idle on reload is correct.
 */
export function AuditRunProvider({ children }) {
  const persisted = useRef(loadPersisted()).current;
  const [urlValue, setUrlValue]     = useState(persisted.urlValue);
  const [report, setReport]         = useState(persisted.report);
  const [analyzing, setAnalyzing]   = useState(false);
  const [error, setError]           = useState("");
  const [pendingUrl, setPendingUrl] = useState("");
  const abortRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ urlValue, report }));
    } catch {
      // Quota exceeded or storage unavailable (private browsing, etc.) — the
      // run itself already succeeded; losing reload-persistence isn't fatal.
    }
  }, [urlValue, report]);

  async function handleAnalyze(url) {
    setError("");
    setReport(null);
    setPendingUrl(url);
    setAnalyzing(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await analyzeUrl(url, { signal: controller.signal });
      setReport(data);
      saveRun(data);
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message || "Analysis failed. Please try again.");
      }
    } finally {
      setAnalyzing(false);
      setPendingUrl("");
      abortRef.current = null;
    }
  }

  function resetAll() {
    if (abortRef.current) abortRef.current.abort();
    setReport(null);
    setError("");
    setAnalyzing(false);
    setUrlValue("");
  }

  const value = { urlValue, setUrlValue, report, analyzing, error, pendingUrl, handleAnalyze, resetAll, setError };
  return <AuditRunContext.Provider value={value}>{children}</AuditRunContext.Provider>;
}

/** @returns {{urlValue, setUrlValue, report, analyzing, error, pendingUrl, handleAnalyze, resetAll, setError}} */
export function useAuditRun() {
  const ctx = useContext(AuditRunContext);
  if (!ctx) throw new Error("useAuditRun must be used within an AuditRunProvider");
  return ctx;
}
