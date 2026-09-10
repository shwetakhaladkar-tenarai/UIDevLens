/**
 * runHistory.js
 * Client-side (localStorage) history of completed analysis runs.
 *
 * There is no backend persistence for run history today (only POST
 * /api/analyze + GET /health exist) — this is real data (every run
 * actually happened), just scoped to this browser rather than shared
 * across devices/users. Never presented as server-side history.
 */

const STORAGE_KEY = "qa_run_history_v1";
const MAX_ENTRIES = 50; // cap so localStorage never grows unbounded

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // corrupted/unavailable storage — fail to an empty list, never throw
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage unavailable (private browsing, etc.) — the
    // run itself already succeeded; losing local history isn't fatal.
  }
}

/**
 * Save a completed report as a history entry (newest first, capped at
 * MAX_ENTRIES). Stores the full report so "View JSON" can show exactly
 * what was returned, alongside a compact summary for fast list rendering.
 * @param {object} report - the real report contract from POST /api/analyze
 */
export function saveRun(report) {
  if (!report?.analysisId) return;
  const entry = {
    id: report.analysisId,
    url: report.url,
    timestamp: report.timestamp ?? new Date().toISOString(),
    targetType: report.applicationProfile?.targetType ?? null,
    ruleProfileId: report.applicationProfile?.ruleProfileId ?? null,
    overall: typeof report.scores?.overall === "number" ? report.scores.overall : null,
    label: report.scores?.label ?? null,
    findingCount: report.issues?.length ?? 0,
    bySeverity: report.metadata?.counts?.bySeverity ?? null,
    elapsedMs: report.metadata?.analysisDurationMs ?? null,
    partial: Boolean(report.metadata?.partial),
    report,
  };
  const rest = readAll().filter((e) => e.id !== entry.id);
  writeAll([entry, ...rest].slice(0, MAX_ENTRIES));
}

/** All history entries, newest first. */
export function listRuns() {
  return readAll();
}

/** One entry by id, or null. */
export function getRun(id) {
  return readAll().find((e) => e.id === id) ?? null;
}

/** Remove a single entry by id. */
export function deleteRun(id) {
  writeAll(readAll().filter((e) => e.id !== id));
}

/** Clear all local history. */
export function clearRuns() {
  writeAll([]);
}
