import { selectRuleProfile } from "../../profiling/ruleProfile.service.js";
import { logger } from "../../utils/logger.js";

/**
 * Node — ruleProfileNode
 * Rule Profile Selector: reads targetProfile (set by applicationProfilerNode),
 * selects the matching configurable validation profile from rule-profiles/,
 * validates it, and places it in LangGraph state as `ruleProfile`.
 *
 * Every downstream validator (pythonValidationNode today) reads its enabled
 * checks/browsers/viewports/thresholds from this profile — no validation
 * behavior is hardcoded.
 */
export async function ruleProfileNode(state) {
  if (state.fatal) {
    logger.warn("[ruleProfileNode] Skipping — prior fatal error");
    return {};
  }

  const targetType = state.targetProfile?.targetType || "unknown";
  logger.info("[ruleProfileNode] Selecting rule profile", { targetType });

  try {
    const ruleProfile = selectRuleProfile(targetType);
    logger.info("[ruleProfileNode] Selected profile", {
      id: ruleProfile.id,
      targetType: ruleProfile.targetType,
    });
    return { ruleProfile };
  } catch (err) {
    // A broken/misconfigured profile for this targetType must not crash the
    // pipeline: fall back to the default profile, and record why.
    logger.error("[ruleProfileNode] Selection failed — falling back to default", {
      targetType,
      error: err.message,
    });

    try {
      const fallback = selectRuleProfile("unknown");
      return {
        ruleProfile: fallback,
        warnings: [
          {
            node: "ruleProfileNode",
            message: `Rule profile selection failed for targetType "${targetType}" (${err.message}); using default profile "${fallback.id}" instead.`,
          },
        ],
      };
    } catch (fallbackErr) {
      // default.json itself is broken/missing — nothing sane left to fall
      // back to. Still non-fatal: downstream nodes must tolerate an empty
      // ruleProfile (they already default their own checks when absent).
      logger.error("[ruleProfileNode] default.json is also invalid", { error: fallbackErr.message });
      return {
        warnings: [
          {
            node: "ruleProfileNode",
            message: `Rule profile selection failed entirely: ${fallbackErr.message}`,
          },
        ],
      };
    }
  }
}
