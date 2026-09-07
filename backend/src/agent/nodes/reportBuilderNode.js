import { buildReport } from "../../services/reportBuilder.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 10 — reportBuilderNode
 * Assembles the complete final report from all prior state fields.
 */
export async function reportBuilderNode(state) {
  logger.info("[reportBuilderNode] Assembling final report");

  const finalReport = buildReport(state);

  logger.info("[reportBuilderNode] Report ready", {
    analysisId:   finalReport.analysisId,
    findingCount: finalReport.metadata?.counts?.total ?? 0,
    durationMs:   finalReport.metadata?.analysisDurationMs,
    partial:      finalReport.metadata?.partial,
  });

  return { finalReport };
}
