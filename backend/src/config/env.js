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
  // loopback / private targets so the local demo-site can be analyzed.
  // MUST stay false in production. Never weaken the default.
  allowLocalTargets: process.env.ALLOW_LOCAL_TARGETS === "true",

  // Custom Python validation engine (python-validation/runner.py), invoked
  // as a subprocess via stdin/stdout JSON — never via shell interpolation.
  pythonValidation: {
    executable: process.env.PYTHON_EXECUTABLE || "python3",
    scriptPath:
      process.env.PYTHON_VALIDATION_SCRIPT_PATH ||
      path.resolve(__dirname, "../../../python-validation/runner.py"),
    timeoutMs: parseInt(process.env.PYTHON_VALIDATION_TIMEOUT_MS || "30000", 10),
  },

  // Configurable validation profiles (rule-profiles/*.json), selected by
  // ruleProfileNode based on the Target/Application Profiler's targetType.
  ruleProfiles: {
    dir: process.env.RULE_PROFILES_DIR || path.resolve(__dirname, "../../../rule-profiles"),
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
