import { config } from "../config/env.js";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = config.nodeEnv === "production" ? LEVELS.warn : LEVELS.debug;

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, meta = undefined) {
  if (LEVELS[level] > currentLevel) return;
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      prefix,
      message,
      meta
    );
  } else {
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      prefix,
      message
    );
  }
}

export const logger = {
  error: (msg, meta) => log("error", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  info: (msg, meta) => log("info", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
};
