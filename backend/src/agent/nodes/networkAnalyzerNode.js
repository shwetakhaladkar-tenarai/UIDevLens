import { runNetworkAnalysis } from "../../tools/networkAnalyzer.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 4 — networkAnalyzerNode
 * Analyzes network efficiency, caching, compression, and request patterns.
 *
 * Grouped under the "performance" plan check (same as performanceAnalyzerNode,
 * which precedes it) — skipped when the validation plan didn't enable it.
 */
export async function networkAnalyzerNode(state) {
  if (state.fatal) {
    logger.warn("[networkAnalyzerNode] Skipping — prior fatal error");
    return {};
  }

  if (state.validationPlan?.checks && state.validationPlan.checks.performance === false) {
    logger.info("[networkAnalyzerNode] Skipping — not enabled by the validation plan (performance)", {
      reason: state.validationPlan.reasons?.performance,
    });
    return {};
  }

  logger.info("[networkAnalyzerNode] Running network analysis", {
    url: state.url,
  });

  try {
    const findings = await runNetworkAnalysis(state.url, state.browserEvidence);
    logger.info("[networkAnalyzerNode] Done", { count: findings.length });
    return { networkFindings: findings };
  } catch (err) {
    // Non-fatal: network findings feed the performance score, but their absence
    // must not sink the whole report.
    logger.error("[networkAnalyzerNode] Failed (non-fatal)", { error: err.message });
    return {
      warnings: [{ node: "networkAnalyzerNode", message: `Network analysis failed: ${err.message}` }],
    };
  }
}
