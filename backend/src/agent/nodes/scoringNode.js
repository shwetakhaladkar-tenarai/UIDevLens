import { computeScores } from "../../utils/scoring.js";
import { logger } from "../../utils/logger.js";

/**
 * Responsive/viewport findings are produced by the design analyzer but must
 * influence the DESIGN score as a distinct group. Same split logic as
 * normalizeFindingsNode so scoring and reporting stay consistent.
 */
const RESPONSIVE_ID_PREFIXES = [
  "design-overflow-",
  "design-elements-wider-",
  "design-fixed-width-",
  "design-small-tap-targets",
  "design-overlapping-elements-",
];

function isResponsive(finding) {
  const id = String(finding?.id || "");
  return RESPONSIVE_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Node 8 — scoringNode
 * Calculates deterministic category + overall scores.
 * The LLM never sees or influences these numbers.
 */
export async function scoringNode(state) {
  logger.info("[scoringNode] Calculating scores");

  const designAll   = state.designFindings ?? [];
  const responsive  = designAll.filter(isResponsive);
  const design      = designAll.filter((f) => !isResponsive(f));

  const scores = computeScores({
    // Strong external anchors
    lighthouseScore:       state.metrics?.lighthouseScore ?? null,
    axeScore:              state.accessibilityAxeScore ?? null,
    // Finding buckets
    performanceFindings:   state.performanceFindings ?? [],
    networkFindings:       state.networkFindings ?? [],   // influences performance
    designFindings:        design,
    responsiveFindings:    responsive,                    // influences design
    accessibilityFindings: state.accessibilityFindings ?? [],
  });

  logger.info("[scoringNode] Scores calculated", scores);
  return { scores };
}
