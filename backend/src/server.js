import express from "express";
import cors from "cors";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import analyzeRoutes from "./routes/analyze.routes.js";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "1mb" }));

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
app.use("/api", analyzeRoutes);

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
app.listen(config.port, () => {
  logger.info(`[server] AI Frontend Analyzer running on http://localhost:${config.port}`);
  logger.info(`[server] Health:   GET  http://localhost:${config.port}/health`);
  logger.info(`[server] Analyze:  POST http://localhost:${config.port}/api/analyze`);
  logger.info(`[server] OpenAI:   ${config.openai.apiKey ? "configured ✓" : "NOT configured — AI node will use mock"}`);
});

export default app;
