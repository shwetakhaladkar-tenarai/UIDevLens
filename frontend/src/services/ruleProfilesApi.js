/**
 * ruleProfilesApi.js
 * HTTP client for /api/rule-profiles — matches analysisApi.js's base-URL /
 * error-handling conventions.
 */
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:3001";

async function handle(res) {
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
  return json.data;
}

/**
 * @returns {Promise<Array<{targetType:string, filename:string, profile:object|null, error:string|null}>>}
 */
export async function fetchRuleProfiles() {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/api/rule-profiles`, { credentials: "include" });
  } catch {
    throw new Error(`Could not reach the analysis server. Is the backend running on ${API_BASE_URL}?`);
  }
  return handle(res);
}

/**
 * PATCH /api/rule-profiles/:filename — persists a real edit to the profile
 * file on disk; the next analysis run picks it up (see
 * ruleProfile.service.js's updateRuleProfile()).
 * @param {string} filename
 * @param {{enabledChecks?:object, browsers?:string[], accessibility?:{level:string}}} updates
 * @returns {Promise<object>} the updated, validated profile
 */
export async function updateRuleProfile(filename, updates) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/api/rule-profiles/${encodeURIComponent(filename)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  } catch {
    throw new Error(`Could not reach the analysis server. Is the backend running on ${API_BASE_URL}?`);
  }
  return handle(res);
}
