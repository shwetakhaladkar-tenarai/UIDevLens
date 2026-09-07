import { runPythonValidation } from "../../services/pythonValidation.service.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_TARGET_TYPE = "standard-web";
const DEFAULT_RULE_PROFILE_ID = "default-v1";
const DEFAULT_WCAG_LEVEL = "AA";
const DEFAULT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet:  { width: 768,  height: 1024 },
  mobile:  { width: 390,  height: 844 },
};

// validationPlan.checks (camelCase, agentic-plan vocabulary) -> Python
// runner.py check-group names. loadBenchmark is deliberately absent here —
// it isn't a separate Python check group; load_benchmark.py runs as part of
// "performance" and is gated by its own options.loadTest (below).
const PLAN_KEY_TO_PYTHON_CHECK = {
  functional:    "functional",
  accessibility: "accessibility",
  responsive:    "responsive",
  crossBrowser:  "cross_browser",
  performance:   "performance",
  uiConsistency: "design",
};

/**
 * Node — pythonValidationNode ("Python Validators")
 * Delegates deterministic UI validation to the custom Python engine
 * (python-validation/runner.py): functional, accessibility/WCAG, responsive,
 * cross-browser, performance (+ opt-in load benchmarking), and UI-consistency
 * checks. Python never calls OpenAI and never makes AI decisions — it
 * returns structured evidence that flows into normalizeFindingsNode
 * alongside the Node-side analyzers.
 *
 * Pure CONSUMER of state.validationPlan (built upstream by
 * validationPlannerNode) — it does not classify, select a profile, or decide
 * what's enabled itself. If validationPlan is missing/empty (shouldn't
 * happen outside of a bug), it falls back to running nothing rather than
 * guessing — see the empty-checks handling below.
 *
 * Runs independently of browserCollectorNode: the Python engine manages its
 * own browser session rather than reusing Node's Playwright evidence.
 *
 * Non-fatal by design: if the Python engine cannot be run at all (missing
 * interpreter, timeout, crash, bad output), this node records a warning and
 * returns an empty/error-shaped pythonValidationResults so the rest of the
 * pipeline (and the final report) still completes with whatever other
 * findings are available.
 */
export async function pythonValidationNode(state) {
  if (state.fatal) {
    logger.warn("[pythonValidationNode] Skipping — prior fatal error");
    return {};
  }

  const targetType = state.targetProfile?.targetType || DEFAULT_TARGET_TYPE;
  const ruleProfile = state.ruleProfile;
  const plan = state.validationPlan?.checks ? state.validationPlan : { checks: {}, browsers: [], viewports: [] };

  const checks = Object.entries(PLAN_KEY_TO_PYTHON_CHECK)
    .filter(([planKey]) => plan.checks[planKey] === true)
    .map(([, pythonCheck]) => pythonCheck);

  // Nothing to do — and critically, we must NOT call Python with an empty
  // checks array: runner.py treats a falsy `checks` as "run everything"
  // (Python's `[] or default`), which would silently re-enable every check
  // the plan just decided to skip. Short-circuit instead.
  if (checks.length === 0) {
    logger.info("[pythonValidationNode] No Python checks enabled by the validation plan — skipping", {
      url: state.url,
    });
    return {
      pythonValidationResults: { status: "success", findings: [], metrics: {}, warnings: [], errors: [] },
    };
  }

  const wcagLevel = ruleProfile?.accessibility?.level || DEFAULT_WCAG_LEVEL;
  const browsers = Array.isArray(plan.browsers) && plan.browsers.length ? plan.browsers : ["chromium"];

  const allViewports = ruleProfile?.viewports && Object.keys(ruleProfile.viewports).length
    ? ruleProfile.viewports
    : DEFAULT_VIEWPORTS;
  const viewportNames = Array.isArray(plan.viewports) && plan.viewports.length
    ? plan.viewports
    : Object.keys(allViewports);
  const viewports = Object.fromEntries(
    Object.entries(allViewports).filter(([name]) => viewportNames.includes(name))
  );

  // The plan's loadBenchmark decision is authoritative here too (defense in
  // depth) — even if the rule profile approves load testing, Python only
  // gets a "go" if the plan actually enabled it (e.g. userConfig could have
  // opted out).
  const loadTest = plan.checks.loadBenchmark === true
    ? (ruleProfile?.performance?.loadTest || { enabled: false, approved: false })
    : { enabled: false, approved: false };

  logger.info("[pythonValidationNode] Running Python validation engine", {
    url: state.url,
    targetType,
    ruleProfileId: ruleProfile?.id ?? null,
    checks,
    wcagLevel,
    browsers,
    viewports: Object.keys(viewports),
    loadTestEnabled: loadTest.enabled === true,
    loadTestApproved: loadTest.approved === true,
  });

  try {
    const result = await runPythonValidation({
      url: state.url,
      targetType,
      ruleProfile: ruleProfile?.id || DEFAULT_RULE_PROFILE_ID,
      checks,
      options: { wcagLevel, browsers, viewports, loadTest },
    });

    logger.info("[pythonValidationNode] Done", {
      status: result.status,
      findings: result.findings.length,
    });

    const update = { pythonValidationResults: result };

    // Surface handled Python-side failures as pipeline warnings without
    // treating them as fatal — other analyzers still produced findings.
    if (result.status === "error") {
      update.warnings = [
        {
          node: "pythonValidationNode",
          message: `Python validation reported an error: ${
            (result.errors || []).join("; ") || "unknown error"
          }`,
        },
      ];
    } else if (result.warnings?.length) {
      update.warnings = result.warnings.map((w) => ({
        node: "pythonValidationNode",
        message: w,
      }));
    }

    return update;
  } catch (err) {
    // The subprocess itself failed to produce a usable result (couldn't
    // spawn, timed out, crashed, or returned unparsable output). Preserve
    // every other analyzer's findings — only add a warning here.
    logger.error("[pythonValidationNode] Failed (non-fatal)", { error: err.message });
    return {
      pythonValidationResults: {
        status: "error",
        findings: [],
        metrics: {},
        warnings: [],
        errors: [err.message],
      },
      warnings: [
        { node: "pythonValidationNode", message: `Python validation engine failed: ${err.message}` },
      ],
    };
  }
}
