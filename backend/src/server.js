import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { countUsers } from "./services/userStore.service.js";
import analyzeRoutes from "./routes/analyze.routes.js";
import ruleProfilesRoutes from "./routes/ruleProfiles.routes.js";
import authRoutes from "./routes/auth.routes.js";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Content-Type"],
    credentials: true, // required for the httpOnly session cookie (auth.routes.js)
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "ai-frontend-analyzer",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    openaiConfigured: !!config.openai.apiKey,
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
// Auth routes are unprotected by definition (you need them to log in at
// all); everything else requires a valid session cookie.
app.use("/api", authRoutes);
app.use("/api", requireAuth, analyzeRoutes);
app.use("/api", requireAuth, ruleProfilesRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found.` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error("[server] Unhandled error", err);
  res.status(500).json({ success: false, error: "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info(`[server] AI Frontend Analyzer running on http://localhost:${config.port}`);
  logger.info(`[server] Health:   GET  http://localhost:${config.port}/health`);
  logger.info(`[server] Analyze:  POST http://localhost:${config.port}/api/analyze (requires session)`);
  logger.info(`[server] Profiles: GET  http://localhost:${config.port}/api/rule-profiles (requires session)`);
  logger.info(`[server] Auth:     POST http://localhost:${config.port}/api/auth/{register,login,logout}, GET .../api/auth/me`);
  logger.info(`[server] Users:    ${countUsers()} account(s) on record in ${config.auth.usersFile}`);
  logger.info(`[server] OpenAI:   ${config.openai.apiKey ? "configured ✓" : "NOT configured — AI node will use mock"}`);
});

// Release the port immediately on shutdown — without this, `node --watch`
// restarting on a file save can race the still-closing old process and fail
// to rebind with EADDRINUSE (observed locally: repeated restarts left the
// server briefly unreachable even though the user's session/account on disk
// were untouched).
function shutdown(signal) {
  logger.info(`[server] ${signal} received, closing server…`);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
