import { profileApplication } from "../../profiling/applicationProfiler.js";
import { logger } from "../../utils/logger.js";

/**
 * Node — applicationProfilerNode
 * Target/Application Profiler: deterministically classifies what kind of
 * web-accessible application was just collected (standard-web, powerbi,
 * tableau, databricks, or unknown) BEFORE rule-profile selection and
 * validation run. Never calls OpenAI — see profiling/applicationProfiler.js.
 *
 * Runs once, right after browserCollectorNode, so its output (targetProfile)
 * is available to every downstream analyzer — most importantly the future
 * Rule Profile Selector and pythonValidationNode, which already reads
 * state.targetProfile.targetType when present.
 */
export async function applicationProfilerNode(state) {
  if (state.fatal) {
    logger.warn("[applicationProfilerNode] Skipping — prior fatal error");
    return {};
  }

  logger.info("[applicationProfilerNode] Profiling target application", { url: state.url });

  try {
    const profile = profileApplication(state.browserEvidence);

    logger.info("[applicationProfilerNode] Done", {
      targetType: profile.targetType,
      confidence: profile.confidence,
    });

    return { targetProfile: profile };
  } catch (err) {
    // Deterministic and side-effect-free — a failure here means a bug, not a
    // transient condition. Never fatal: fall back to "unknown" so rule
    // selection and validation still proceed with sane defaults.
    logger.error("[applicationProfilerNode] Failed (non-fatal)", { error: err.message });
    return {
      targetProfile: { targetType: "unknown", confidence: 0.4, evidence: [] },
      warnings: [
        { node: "applicationProfilerNode", message: `Application profiling failed: ${err.message}` },
      ],
    };
  }
}
