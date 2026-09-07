import { combineFindings } from "../../utils/normalization.js";
import { logger } from "../../utils/logger.js";

/**
 * Responsive/viewport findings are produced by the design analyzer but belong
 * to the "responsive" category. We split them out by id prefix so the unified
 * list correctly classifies them.
 */
const RESPONSIVE_ID_PREFIXES = [
  "design-overflow-",
  "design-elements-wider-",
  "design-fixed-width-",
  "design-small-tap-targets",
  "design-overlapping-elements-",
];

function isResponsive(finding) {
  const id = String(finding.id || "");
  return RESPONSIVE_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Group the Python validation engine's flat findings list by category so
 * each one can be folded into the matching Node-side bucket. Python's
 * category values are: functional | accessibility | responsive | performance
 * | ui-consistency (cross_browser findings are emitted under "responsive";
 * design/ui_consistency.py's findings use "ui-consistency", a category
 * distinct from Node's own live "design" analyzer).
 */
function groupByCategory(findings) {
  const groups = {};
  for (const f of findings ?? []) {
    const cat = f?.category || "functional";
    (groups[cat] ??= []).push(f);
  }
  return groups;
}

/**
 * Node 7 — normalizeFindingsNode
 * Combines findings from all analyzers — including the Custom Python
 * Validation Engine (pythonValidationResults) — into a single unified,
 * deduped, merged, and sorted list via combineFindings().
 */
export async function normalizeFindingsNode(state) {
  logger.info("[normalizeFindingsNode] Normalizing all findings");

  const designAll = state.designFindings ?? [];

  // Split design findings into pure-design vs responsive
  const responsive = designAll.filter(isResponsive);
  const design     = designAll.filter((f) => !isResponsive(f));

  const pythonByCategory = groupByCategory(state.pythonValidationResults?.findings);

  const normalizedFindings = combineFindings({
    performance:   [...(state.performanceFindings ?? []), ...(pythonByCategory.performance ?? [])],
    network:       state.networkFindings ?? [],
    design:        [...design, ...(pythonByCategory.design ?? [])],
    responsive:    [...responsive, ...(pythonByCategory.responsive ?? [])],
    accessibility: [...(state.accessibilityFindings ?? []), ...(pythonByCategory.accessibility ?? [])],
    functional:    pythonByCategory.functional ?? [],
    uiConsistency: pythonByCategory["ui-consistency"] ?? [],
  });

  logger.info("[normalizeFindingsNode] Done", {
    total:       normalizedFindings.length,
    performance: (state.performanceFindings ?? []).length,
    network:     (state.networkFindings ?? []).length,
    design:      design.length,
    responsive:  responsive.length,
    accessibility: (state.accessibilityFindings ?? []).length,
    pythonValidation: (state.pythonValidationResults?.findings ?? []).length,
    uiConsistency: (pythonByCategory["ui-consistency"] ?? []).length,
  });

  return { normalizedFindings };
}
