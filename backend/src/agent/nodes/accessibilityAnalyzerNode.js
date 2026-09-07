import { runAccessibilityAnalysis } from "../../tools/accessibilityAnalyzer.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 6 — accessibilityAnalyzerNode
 * Checks WCAG 2.1 AA compliance, ARIA, and keyboard navigation via axe-core.
 *
 * Conditional Tool Execution: skips the (real) axe-core audit entirely when
 * validationPlannerNode's plan didn't enable "accessibility".
 */
export async function accessibilityAnalyzerNode(state) {
  if (state.fatal) {
    logger.warn("[accessibilityAnalyzerNode] Skipping — prior fatal error");
    return {};
  }

  if (state.validationPlan?.checks && state.validationPlan.checks.accessibility === false) {
    logger.info("[accessibilityAnalyzerNode] Skipping — not enabled by the validation plan", {
      reason: state.validationPlan.reasons?.accessibility,
    });
    return {};
  }

  logger.info("[accessibilityAnalyzerNode] Running accessibility analysis", {
    url: state.url,
  });

  try {
    const { score, findings } = await runAccessibilityAnalysis(
      state.url,
      state.browserEvidence
    );
    logger.info("[accessibilityAnalyzerNode] Done", { count: findings.length, score });
    return {
      accessibilityFindings: findings,
      accessibilityAxeScore: score,
    };
  } catch (err) {
    // Non-fatal (per spec): add a warning, let performance/design continue,
    // and produce a partial report. accessibilityAxeScore stays null so the
    // scorer relies on findings (none) → neutral contribution.
    logger.error("[accessibilityAnalyzerNode] Failed (non-fatal)", { error: err.message });
    return {
      warnings: [{ node: "accessibilityAnalyzerNode", message: `Accessibility analysis failed: ${err.message}` }],
    };
  }
}
