/**
 * analyzeService.js
 * HTTP client for the backend API.
 * Never exposes any API keys — all AI calls happen server-side.
 */

const BASE = "/api";

/**
 * POST /api/analyze
 * @param {string} url
 * @returns {Promise<object>} report data
 */
export async function analyzeUrl(url) {
  const res = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json.error || `Server error ${res.status}`);
  }

  return json;
}

/**
 * GET /health
 * @returns {Promise<object>}
 */
export async function checkHealth() {
  const res = await fetch("/health");
  return res.json();
}
