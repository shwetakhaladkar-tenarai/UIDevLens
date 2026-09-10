/**
 * analysisApi.js
 * HTTP client for the backend analysis API.
 *
 * The base URL comes from VITE_API_BASE_URL. No secrets ever live here —
 * the OpenAI key stays server-side in the backend.
 */

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:3001";

/**
 * POST /api/analyze — run the full FrontendQualityAgent pipeline.
 * @param {string} url
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object>} the stable report contract (data payload)
 */
export async function analyzeUrl(url, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      credentials: "include", // sends the session cookie — this route requires auth (server.js)
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error(
      "Could not reach the analysis server. Is the backend running on " +
        `${API_BASE_URL}?`
    );
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
  }

  if (!res.ok || !json.success) {
    const err = new Error(json?.error || `Server error (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }

  // Controller wraps the report as { success, elapsedMs, data }
  return json.data;
}

/**
 * GET /health — backend liveness probe.
 * @returns {Promise<object>}
 */
export async function checkHealth() {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed (HTTP ${res.status}).`);
  return res.json();
}

export { API_BASE_URL };
