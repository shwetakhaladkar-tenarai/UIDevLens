import { randomUUID } from "crypto";
import { validateUrlWithDns } from "../../utils/urlSecurity.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 1 — validateInputNode
 * Validates the incoming URL, starts the analysis clock, assigns an analysisId.
 * An invalid URL is FATAL: the graph routes straight to the report builder.
 */
export async function validateInputNode(state) {
  const analysisId        = state.analysisId || randomUUID();
  const analysisStartedAt = state.analysisStartedAt || Date.now();

  logger.info("[validateInputNode] Validating URL", { url: state.url, analysisId });

  const result = await validateUrlWithDns(state.url);

  if (!result.valid) {
    logger.warn("[validateInputNode] Invalid URL", { error: result.error });
    return {
      analysisId,
      analysisStartedAt,
      fatal: true,
      errors: [{ node: "validateInputNode", message: result.error, fatal: true }],
    };
  }

  // Sanitize userConfig defensively — an invalid/non-object value must never
  // reach the planner; it just falls back to "no overrides requested".
  const userConfig = (state.userConfig && typeof state.userConfig === "object" && !Array.isArray(state.userConfig))
    ? state.userConfig
    : {};

  logger.info("[validateInputNode] URL is valid", { url: result.url });
  return {
    analysisId,
    analysisStartedAt,
    url: result.url,
    userConfig,
  };
}
