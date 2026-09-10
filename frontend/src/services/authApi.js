/**
 * authApi.js
 * HTTP client for /api/auth/* — matches analysisApi.js's base-URL / error
 * conventions. Every call sends `credentials: "include"` so the httpOnly
 * session cookie the backend issues (auth.routes.js) is sent/received even
 * though the frontend (5173) and backend (3001) are different origins.
 */
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:3001";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error(`Could not reach the auth server. Is the backend running on ${API_BASE_URL}?`);
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
  return json.data;
}

/** @returns {Promise<{id,email,name,createdAt}>} */
export function register(email, password, name) {
  return request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) });
}

/** @returns {Promise<{id,email,name,createdAt}>} */
export function login(email, password) {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function logout() {
  return request("/api/auth/logout", { method: "POST" });
}

/** @returns {Promise<{id,email,name,createdAt}>} @throws (status 401) if there's no valid session */
export function fetchMe() {
  return request("/api/auth/me");
}

/**
 * PATCH /api/auth/me — update name/email/password. `currentPassword` is
 * required by the backend whenever `email` or `newPassword` is included.
 * @param {{name?:string, email?:string, currentPassword?:string, newPassword?:string}} updates
 * @returns {Promise<{id,email,name,createdAt,updatedAt}>}
 */
export function updateProfile(updates) {
  return request("/api/auth/me", { method: "PATCH", body: JSON.stringify(updates) });
}
