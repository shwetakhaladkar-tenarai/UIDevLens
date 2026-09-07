import { FrontendQualityAgent } from "../agent/frontendQualityGraph.js";
import { logger } from "../utils/logger.js";

/**
 * POST /api/analyze
 * Runs the full FrontendQualityAgent LangGraph pipeline against the given URL.
 */
export async function analyzeController(req, res) {
  const { url, userConfig } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "Request body must include a `url` field.",
    });
  }

  logger.info("[analyzeController] Starting analysis", { url, hasUserConfig: Boolean(userConfig) });
  const startTime = Date.now();

  try {
    // userConfig (optional): { checks?: {...}, browsers?: [...], viewports?: [...] }
    // Can only narrow what the selected rule profile already permits —
    // see validationPlannerNode.js. Never trusted to enable anything on its own.
    const finalState = await FrontendQualityAgent.invoke({ url, userConfig });

    const elapsed = Date.now() - startTime;
    logger.info("[analyzeController] Analysis complete", {
      url,
      elapsedMs: elapsed,
      score: finalState.finalReport?.scores?.overall,
    });

    // Invalid URL is a client error (422). Identify it specifically so a bad
    // input isn't reported the same way as an internal failure.
    const validationError = (finalState.errors ?? []).find(
      (e) => e.node === "validateInputNode"
    );
    if (validationError) {
      return res.status(422).json({
        success: false,
        error: validationError.message,
      });
    }

    // A partial report (some analyzer failed, or browser collection was fatal)
    // is still returned with 200 — the dashboard renders what succeeded plus
    // the warnings. success:true means "we produced a report".
    return res.json({
      success: true,
      elapsedMs: elapsed,
      data: finalState.finalReport,
    });
  } catch (err) {
    logger.error("[analyzeController] Unhandled error", err);
    return res.status(500).json({
      success: false,
      error: "An unexpected error occurred during analysis.",
      detail: err.message,
    });
  }
}
