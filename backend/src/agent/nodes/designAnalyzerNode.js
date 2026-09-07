import { runDesignAnalysis } from "../../tools/designAnalyzer.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 5 — designAnalyzerNode
 * Analyzes visual design quality: contrast, typography, spacing, responsiveness.
 *
 * Conditional Tool Execution: skipped when validationPlannerNode's plan
 * didn't enable "uiConsistency" — e.g. the powerbi/tableau rule profiles,
 * where the embedded report's design isn't this application's to judge.
 */
export async function designAnalyzerNode(state) {
  if (state.fatal) {
    logger.warn("[designAnalyzerNode] Skipping — prior fatal error");
    return {};
  }

  if (state.validationPlan?.checks && state.validationPlan.checks.uiConsistency === false) {
    logger.info("[designAnalyzerNode] Skipping — not enabled by the validation plan", {
      reason: state.validationPlan.reasons?.uiConsistency,
    });
    return {};
  }

  logger.info("[designAnalyzerNode] Running design analysis", {
    url: state.url,
  });

  try {
    const findings = await runDesignAnalysis(state.url, state.browserEvidence);
    logger.info("[designAnalyzerNode] Done", { count: findings.length });
    return { designFindings: findings };
  } catch (err) {
    // Non-fatal: performance/accessibility continue; partial report produced.
    logger.error("[designAnalyzerNode] Failed (non-fatal)", { error: err.message });
    return {
      warnings: [{ node: "designAnalyzerNode", message: `Design analysis failed: ${err.message}` }],
    };
  }
}
