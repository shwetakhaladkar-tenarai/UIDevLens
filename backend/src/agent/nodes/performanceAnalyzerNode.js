import { runPerformanceAnalysis } from "../../tools/lighthouseAnalyzer.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 3 — performanceAnalyzerNode
 * Runs Lighthouse / performance analysis.
 *
 * Conditional Tool Execution: skips the (expensive) Lighthouse audit
 * entirely when validationPlannerNode's plan didn't enable "performance" —
 * e.g. a rule profile that disables it, or the user opting out. Still fires
 * as a cheap no-op so the fan-in into normalizeFindingsNode stays intact.
 */
export async function performanceAnalyzerNode(state) {
  if (state.fatal) {
    logger.warn("[performanceAnalyzerNode] Skipping — prior fatal error");
    return {};
  }

  if (state.validationPlan?.checks && state.validationPlan.checks.performance === false) {
    logger.info("[performanceAnalyzerNode] Skipping — not enabled by the validation plan", {
      reason: state.validationPlan.reasons?.performance,
    });
    return {};
  }

  logger.info("[performanceAnalyzerNode] Running performance analysis", {
    url: state.url,
  });

  try {
    const { findings, metrics } = await runPerformanceAnalysis(
      state.url,
      state.browserEvidence
    );
    logger.info("[performanceAnalyzerNode] Done", { count: findings.length });
    return {
      performanceFindings: findings,
      metrics,
    };
  } catch (err) {
    // Non-fatal: warn and continue. Design/accessibility still run; the report
    // is produced without performance findings.
    logger.error("[performanceAnalyzerNode] Failed (non-fatal)", { error: err.message });
    return {
      warnings: [{ node: "performanceAnalyzerNode", message: `Performance analysis failed: ${err.message}` }],
    };
  }
}
