import { getModel, isModelConfigured } from "../../ai/model.js";
import { planningPrompt } from "../../ai/prompts.js";
import { parsePlanningResponse } from "../../ai/schemas.js";
import { logger } from "../../utils/logger.js";

const CHECK_KEYS = ["functional", "accessibility", "responsive", "crossBrowser", "performance", "uiConsistency"];

/**
 * Node — validationPlannerNode
 * The agentic core of the pipeline: turns (targetProfile, ruleProfile,
 * userConfig, initial browserEvidence) into a concrete validation plan that
 * every downstream node executes against.
 *
 * AUTHORITY MODEL (read before changing this file):
 *   - The selected rule profile is AUTHORITATIVE for every enable/disable
 *     decision. A check is only ever `true` in the plan if the rule profile
 *     already permits it.
 *   - userConfig may only NARROW that permission (opt a check off, or
 *     restrict browsers/viewports to a subset) — it can never widen it.
 *   - An optional LLM pass may SUGGEST an execution order (and a short
 *     rationale) for checks that are ALREADY enabled. It has no path to
 *     add, remove, or re-enable anything — its output is strictly validated
 *     as a permutation of the already-decided enabled-check set and
 *     discarded wholesale otherwise (see sequenceOptionalChecks()).
 *   - Load benchmarking is the sharpest edge of this policy: it can only be
 *     true when the rule profile's performance.loadTest has BOTH `enabled`
 *     and `approved` literally `true`. Neither userConfig nor the LLM can
 *     ever flip it on.
 *
 * Produces state.validationPlan:
 *   { checks, browsers, viewports, reasons, executionOrder, meta }
 * — persisted verbatim into the final report's metadata by reportBuilder.js.
 */
export async function validationPlannerNode(state) {
  if (state.fatal) {
    logger.warn("[validationPlannerNode] Skipping — prior fatal error");
    return {};
  }

  logger.info("[validationPlannerNode] Building validation plan", { url: state.url });

  const deterministic = buildDeterministicPlan({
    ruleProfile: state.ruleProfile,
    userConfig: state.userConfig,
    browserEvidence: state.browserEvidence,
  });

  const sequencing = await sequenceOptionalChecks(deterministic, {
    url: state.url,
    targetProfile: state.targetProfile,
    ruleProfile: state.ruleProfile,
    browserEvidence: state.browserEvidence,
  });

  const validationPlan = {
    ...deterministic,
    executionOrder: sequencing.executionOrder,
    meta: {
      aiAssisted: sequencing.aiAssisted,
      aiFallbackReason: sequencing.aiFallbackReason,
      notes: sequencing.notes,
    },
  };

  logger.info("[validationPlannerNode] Plan ready", {
    checks: validationPlan.checks,
    browsers: validationPlan.browsers,
    viewports: validationPlan.viewports,
    executionOrder: validationPlan.executionOrder,
    aiAssisted: sequencing.aiAssisted,
  });

  return { validationPlan };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic core — always correct and safe on its own, with zero AI
// dependency. This is the ONLY code path allowed to decide true/false.
// ─────────────────────────────────────────────────────────────────────────────

export function buildDeterministicPlan({ ruleProfile, userConfig, browserEvidence }) {
  const enabledChecks = ruleProfile?.enabledChecks || {};
  const userChecks = userConfig?.checks || {};
  const evidenceNotes = describeEvidence(browserEvidence);

  const checks = {};
  const reasons = {};

  for (const key of CHECK_KEYS) {
    const allowedByProfile = enabledChecks[key] === true;
    const userDisabled = userChecks[key] === false;
    checks[key] = allowedByProfile && !userDisabled;

    if (!allowedByProfile) {
      reasons[key] = `Disabled by the "${ruleProfile?.id ?? "selected"}" rule profile`;
    } else if (userDisabled) {
      reasons[key] = "Disabled by user configuration (opted out)";
    } else {
      const note = evidenceNotes[key];
      reasons[key] = `Required by the "${ruleProfile?.id ?? "selected"}" rule profile${note ? ` — ${note}` : ""}`;
    }
  }

  // ── Load benchmark — the sharpest safety edge in this plan ─────────────
  // Both flags must be the literal boolean `true` in the rule profile.
  // userConfig can only turn this OFF; it can never turn it on, and neither
  // can the (optional) LLM sequencing pass below.
  const loadTest = ruleProfile?.performance?.loadTest || {};
  const approvedByProfile = loadTest.enabled === true && loadTest.approved === true;
  const userWantedIt = userChecks.loadBenchmark === true;
  const userDisabledIt = userChecks.loadBenchmark === false;

  checks.loadBenchmark = approvedByProfile && !userDisabledIt;

  if (!approvedByProfile) {
    reasons.loadBenchmark = userWantedIt
      ? "Skipped because explicit approval was not provided (performance.loadTest.approved must be true in the rule profile)"
      : "Skipped because load testing is not enabled/approved for this target";
  } else if (userDisabledIt) {
    reasons.loadBenchmark = "Skipped by user configuration despite being approved";
  } else {
    reasons.loadBenchmark = "Enabled — load testing is explicitly approved for this target";
  }

  // ── Browsers/viewports — rule profile is the ceiling; userConfig narrows only ──
  const allowedBrowsers = Array.isArray(ruleProfile?.browsers) && ruleProfile.browsers.length
    ? ruleProfile.browsers
    : ["chromium"];
  const requestedBrowsers = Array.isArray(userConfig?.browsers) ? userConfig.browsers : null;
  const narrowedBrowsers = requestedBrowsers
    ? allowedBrowsers.filter((b) => requestedBrowsers.includes(b))
    : allowedBrowsers;

  const allowedViewports = ruleProfile?.viewports && Object.keys(ruleProfile.viewports).length
    ? Object.keys(ruleProfile.viewports)
    : ["desktop", "tablet", "mobile"];
  const requestedViewports = Array.isArray(userConfig?.viewports) ? userConfig.viewports : null;
  const narrowedViewports = requestedViewports
    ? allowedViewports.filter((v) => requestedViewports.includes(v))
    : allowedViewports;

  return {
    checks,
    // Never let an over-narrow (or empty) request zero out the run entirely —
    // fall back to the rule profile's full allowance if narrowing left nothing.
    browsers: narrowedBrowsers.length ? narrowedBrowsers : allowedBrowsers,
    viewports: narrowedViewports.length ? narrowedViewports : allowedViewports,
    reasons,
  };
}

/** Ground a couple of reasons in the actual page evidence, for transparency. */
function describeEvidence(browserEvidence) {
  const el = browserEvidence?.elements || {};
  const forms = el.forms?.length ?? 0;
  const buttons = el.buttons?.length ?? 0;
  const links = el.links?.length ?? 0;
  const notes = {};
  if (forms || buttons || links) {
    notes.functional = `page has ${forms} form(s), ${buttons} button(s), ${links} link(s) to exercise`;
  }
  return notes;
}

function summarizePageEvidence(browserEvidence) {
  const el = browserEvidence?.elements ?? {};
  const meta = browserEvidence?.meta ?? {};
  return [
    `Title: ${meta.title || "n/a"}`,
    `Forms: ${el.forms?.length ?? 0}`,
    `Buttons: ${el.buttons?.length ?? 0}`,
    `Links: ${el.links?.length ?? 0}`,
    `Images: ${el.images?.length ?? 0}`,
    `Has viewport meta: ${meta.viewport ? "yes" : "no"}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional LLM-assisted sequencing — advisory only, strictly sandboxed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask the model to suggest a priority order for checks ALREADY enabled by
 * buildDeterministicPlan(). The response is discarded wholesale unless it is
 * EXACTLY a permutation of that enabled-key set — the model cannot add,
 * remove, or re-enable a check under any circumstance.
 */
async function sequenceOptionalChecks(plan, { url, targetProfile, ruleProfile, browserEvidence }) {
  const enabledKeys = CHECK_KEYS.filter((k) => plan.checks[k]);
  const defaultOrder = [...enabledKeys];

  if (enabledKeys.length === 0) {
    return { executionOrder: defaultOrder, notes: {}, aiAssisted: false, aiFallbackReason: "No enabled checks to sequence" };
  }
  if (!isModelConfigured()) {
    return { executionOrder: defaultOrder, notes: {}, aiAssisted: false, aiFallbackReason: "OPENAI_API_KEY not configured" };
  }

  try {
    const model = getModel();
    const chain = planningPrompt.pipe(model);
    const response = await chain.invoke({
      url,
      targetType: targetProfile?.targetType ?? "unknown",
      ruleProfileId: ruleProfile?.id ?? "unknown",
      enabledChecks: enabledKeys.join(", "),
      pageEvidence: summarizePageEvidence(browserEvidence),
    });

    const raw = typeof response?.content === "string"
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((c) => c.text ?? "").join("")
        : String(response?.content ?? "");

    const result = parsePlanningResponse(raw);
    if (!result.ok || !result.data) {
      return { executionOrder: defaultOrder, notes: {}, aiAssisted: false, aiFallbackReason: `AI output invalid: ${result.error}` };
    }

    const proposed = result.data.executionOrder;
    const isValidPermutation =
      Array.isArray(proposed) &&
      proposed.length === enabledKeys.length &&
      new Set(proposed).size === enabledKeys.length &&
      proposed.every((k) => enabledKeys.includes(k));

    if (!isValidPermutation) {
      return {
        executionOrder: defaultOrder,
        notes: {},
        aiAssisted: false,
        aiFallbackReason: "AI proposed an invalid execution order (must be exactly the enabled checks, no additions/removals); ignored",
      };
    }

    // Keep notes ONLY for keys that are actually enabled — anything else is discarded.
    const notes = {};
    for (const [key, note] of Object.entries(result.data.notes || {})) {
      if (enabledKeys.includes(key) && typeof note === "string") {
        notes[key] = note.slice(0, 200);
      }
    }

    return { executionOrder: proposed, notes, aiAssisted: true, aiFallbackReason: null };
  } catch (err) {
    logger.warn("[validationPlannerNode] AI sequencing failed (non-fatal)", { error: err.message });
    return { executionOrder: defaultOrder, notes: {}, aiAssisted: false, aiFallbackReason: `AI call failed: ${err.message}` };
  }
}

export { CHECK_KEYS };
