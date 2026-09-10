import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o",
  },
  // DEV-ONLY escape hatch. When true, the SSRF validator permits localhost /
  // loopback / private targets so the local fixture-site can be analyzed.
  // MUST stay false in production. Never weaken the default.
  allowLocalTargets: process.env.ALLOW_LOCAL_TARGETS === "true",

  // Custom Python validation engine (python-validation/runner.py), invoked
  // as a subprocess via stdin/stdout JSON — never via shell interpolation.
  //
  // Default timeout is generous (150s) because a full run with all checks
  // enabled launches Playwright serially many times over: responsive_validator.py
  // alone launches one browser per (browser × viewport) combination (e.g. 3
  // browsers × 3 viewports = 9 launches), and cross_browser_validator.py adds
  // 3 more — each with its own navigation + settle wait. Measured ~27s for a
  // 3-browser × 3-viewport run against our own small demo site, but a real,
  // content-heavy external site measured 9 WebKit/Firefox launches alone
  // taking 90s+ (one WebKit viewport took ~24s by itself) with cross_browser's
  // 3 launches not even reached yet. No fixed timeout can guarantee success
  // against an arbitrarily heavy real site — scoringNode's not-run fallback
  // (see scoringNode.js) is the actual safety net for whatever still exceeds
  // this; this value is just "generous enough for most real sites."
  pythonValidation: {
    executable: process.env.PYTHON_EXECUTABLE || "python3",
    scriptPath:
      process.env.PYTHON_VALIDATION_SCRIPT_PATH ||
      path.resolve(__dirname, "../../../python-validation/runner.py"),
    timeoutMs: parseInt(process.env.PYTHON_VALIDATION_TIMEOUT_MS || "150000", 10),
  },

  // Configurable validation profiles (rule-profiles/*.json), selected by
  // ruleProfileNode based on the Target/Application Profiler's targetType.
  ruleProfiles: {
    dir: process.env.RULE_PROFILES_DIR || path.resolve(__dirname, "../../../rule-profiles"),
  },

  // Cookie-session auth (auth.service.js / auth.middleware.js). Users are
  // stored locally (userStore.service.js, data/users.json) — there's no
  // external identity provider here. The JWT secret MUST be overridden via
  // .env for any deployment beyond this local dev instance.
  auth: {
    jwtSecret: process.env.JWT_SECRET || "dev-insecure-secret-change-me",
    cookieName: "qa_session",
    tokenTtlSeconds: parseInt(process.env.JWT_TTL_SECONDS || String(60 * 60 * 24 * 7), 10), // 7 days
    usersFile: process.env.USERS_FILE || path.resolve(__dirname, "../../data/users.json"),
  },
};

if (config.allowLocalTargets) {
  console.warn(
    "[config] ALLOW_LOCAL_TARGETS=true — SSRF protection is RELAXED for local targets. " +
      "Use this ONLY in development."
  );
}

// Warn (never throw) — app still runs with mocked AI when key is missing
if (!config.openai.apiKey) {
  console.warn(
    "[config] OPENAI_API_KEY is not set. aiReasoningNode will return a mocked AI response."
  );
}

if (config.auth.jwtSecret === "dev-insecure-secret-change-me") {
  console.warn(
    "[config] JWT_SECRET is not set — using an insecure default. Set JWT_SECRET in .env before deploying anywhere beyond local dev."
  );
}
