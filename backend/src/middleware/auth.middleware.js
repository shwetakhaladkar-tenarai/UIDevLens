/**
 * auth.middleware.js
 * Gates a route behind a valid session cookie. Attaches `req.user =
 * {id, email}` on success — never a full user record (no password hash).
 */
import { config } from "../config/env.js";
import { verifySessionToken } from "../services/auth.service.js";

export function requireAuth(req, res, next) {
  const token = req.cookies?.[config.auth.cookieName];
  if (!token) {
    return res.status(401).json({ success: false, error: "Not authenticated." });
  }
  try {
    const payload = verifySessionToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.clearCookie(config.auth.cookieName);
    return res.status(401).json({ success: false, error: "Session expired or invalid. Please log in again." });
  }
}
