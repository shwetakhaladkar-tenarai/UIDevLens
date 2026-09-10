/**
 * urlHistory.js
 * Lightweight, persistent (localStorage) history of URLs actually entered
 * into the "Target Application URL" field and submitted for analysis —
 * distinct from services/runHistory.js, which stores full completed
 * reports. This is just "what did I search before", kept even if that
 * particular run failed or errored, so a URL is always easy to find and
 * re-run — it's a record of intent to analyze, not of a successful result.
 */

const STORAGE_KEY = "qa_url_history_v1";
const MAX_ENTRIES = 10;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded / storage unavailable — not fatal, just no persisted history this session.
  }
}

/**
 * Record a URL as searched (moves it to the front if already present,
 * de-duplicated, capped at MAX_ENTRIES).
 * @param {string} url
 * @returns {string[]} the updated list, most-recent first
 */
export function addRecentUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return readAll();
  const rest = readAll().filter((u) => u !== trimmed);
  const next = [trimmed, ...rest].slice(0, MAX_ENTRIES);
  writeAll(next);
  return next;
}

/** All recently-searched URLs, most-recent first. */
export function getRecentUrls() {
  return readAll();
}

/** Remove a single URL from history. */
export function removeRecentUrl(url) {
  const next = readAll().filter((u) => u !== url);
  writeAll(next);
  return next;
}

/** Clear all URL history. */
export function clearRecentUrls() {
  writeAll([]);
  return [];
}
