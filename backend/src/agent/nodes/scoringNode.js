import { computeScores } from "../../utils/scoring.js";
import { logger } from "../../utils/logger.js";

function groupByCategory(findings) {
  const groups = {};
  for (const f of findings ?? []) {
    const cat = f?.category;
    if (!cat) continue;
    (groups[cat] ??= []).push(f);
  }
  return groups;
}

/**
 * Node 8 — scoringNode
 * Calculates deterministic category + overall scores from the fully
 * normalized, cross-engine findings list (state.normalizedFindings) — the
 * LLM never sees or influences these numbers.
 *
 * Category composition (see scoring.js for the full model):
 *   - performance folds in "network" findings (Node's networkAnalyzer)
 *   - uiConsistency folds in "design" findings (Node's live designAnalyzer)
 *     alongside Python's "ui-consistency" findings — two engines, one score
 *   - functional / responsive / crossBrowser / accessibility read directly
 *     from their matching category (Node + Python findings already merged
 *     into normalizedFindings under the same category by normalizeFindingsNode)
 *
 * Which categories get scored at all is driven by validationPlan.checks
 * (built by validationPlannerNode) — a category the plan didn't enable
 * returns {status:"not-run"} instead of a fake number, and is excluded from
 * the overall-score weighting (not just zero-weighted).
 */
export async function scoringNode(state) {
  logger.info("[scoringNode] Calculating scores");

  const byCategory = groupByCategory(state.normalizedFindings);
  const weights = state.ruleProfile?.scoring?.weights;

  // The validation plan's checks say what SHOULD run, not what actually did.
  // "functional" and "crossBrowser" have no Node-side fallback at all — they
  // exist only via the Python engine. If Python failed completely (subprocess
  // timeout/crash, or every requested check group errored — status "error"),
  // those two categories have zero findings not because the site is flawless
  // but because nothing was ever checked. Scoring an empty list would report
  // a fake "100" instead of admitting the check didn't run, so treat them as
  // not-run in that case — overriding the plan's original enabled=true intent
  // with the runtime reality. (A "partial" Python status is left alone: some
  // check groups did complete, so real findings may still exist.)
  const pythonFailedEntirely = state.pythonValidationResults?.status === "error";
  const enabledCategories = { ...(state.validationPlan?.checks ?? {}) };
  if (pythonFailedEntirely) {
    enabledCategories.functional = false;
    enabledCategories.crossBrowser = false;
    logger.warn("[scoringNode] Python validation failed entirely — marking functional/crossBrowser as not-run instead of scoring an empty findings list");
  }

  const scores = computeScores({
    enabledCategories,
    weights,
    // Strong external anchors
    lighthouseScore: state.metrics?.lighthouseScore ?? null,
    axeScore:        state.accessibilityAxeScore ?? null,
    findingsByCategory: {
      functional:    byCategory.functional ?? [],
      accessibility: byCategory.accessibility ?? [],
      responsive:    byCategory.responsive ?? [],
      crossBrowser:  byCategory["cross-browser"] ?? [],
      performance:   [...(byCategory.performance ?? []), ...(byCategory.network ?? [])],
      uiConsistency: [...(byCategory.design ?? []), ...(byCategory["ui-consistency"] ?? [])],
    },
  });

  logger.info("[scoringNode] Scores calculated", scores);
  return { scores };
}
