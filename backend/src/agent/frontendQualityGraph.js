/**
 * FrontendQualityAgent — the ONE LangGraph workflow for this system.
 *
 * Flow:
 *   START
 *     -> validateInputNode           (Validate Request)
 *     -> browserCollectorNode        (Collect Initial Context)
 *     -> applicationProfilerNode     (Target/Application Profiler — deterministic
 *                                     standard-web | powerbi | tableau | databricks | unknown)
 *     -> ruleProfileNode             (Rule Profile Selector — loads rule-profiles/*.json)
 *     -> validationPlannerNode       (Validation Planner — agentic: builds the concrete
 *                                     checks/browsers/viewports plan; rule profile is
 *                                     authoritative, an optional LLM pass may only
 *                                     suggest execution order for ALREADY-enabled checks)
 *          |--------- (Conditional Tool Execution, fan-out) ----------|
 *          v            v              v                     v
 *     performance     design      accessibility     pythonValidationNode
 *          |                                        (Custom Python Validation
 *        network                                     Engine — functional,
 *          |         (design & accessibility run     accessibility/WCAG,
 *          |          in parallel with the            responsive, cross-
 *          |          performance→network branch)     browser, performance,
 *          |                                          UI-consistency checks)
 *          |------------------- fan-in ------------------------|
 *                                v
 *                      normalizeFindingsNode
 *                                v
 *                           scoringNode
 *                                v
 *                         aiReasoningNode
 *                                v
 *                        reportBuilderNode
 *                                v
 *                               END
 *
 * Design notes (observability + safe concurrency):
 *  - Independent analyzers (performance, design, accessibility, pythonValidation)
 *    are dispatched from browserCollectorNode as parallel edges. LangGraph
 *    executes nodes that become ready in the same super-step concurrently and
 *    merges their partial state updates through the channel reducers. This is
 *    safe here because each analyzer writes to a DISTINCT state key
 *    (performanceFindings, designFindings, accessibilityFindings,
 *    pythonValidationResults, metrics). Shared channels (errors/warnings) use
 *    append reducers, so concurrent writes never clobber each other.
 *  - performance -> network is sequential (network analysis consumes the same
 *    browser evidence but is grouped under the performance branch per the spec).
 *  - pythonValidationNode manages its OWN browser session (via python-validation's
 *    common/browser.py) rather than reusing Node's Playwright evidence, and never
 *    calls OpenAI — it returns deterministic structured evidence only.
 *  - normalizeFindingsNode is a fan-in point: it only runs after ALL of
 *    network, design, accessibility, and pythonValidation complete (LangGraph
 *    waits for every incoming edge).
 *  - applicationProfilerNode and ruleProfileNode are both deterministic and
 *    side-effect-free (no browser, no OpenAI) — they run once, sequentially,
 *    between browser collection and validationPlannerNode. ruleProfileNode
 *    loads/validates rule-profiles/<targetType>.json (falling back to
 *    default.json); its output (ruleProfile) is AUTHORITATIVE for every
 *    enable/disable decision validationPlannerNode makes — no validation
 *    behavior is hardcoded.
 *  - validationPlannerNode turns (targetProfile, ruleProfile, userConfig,
 *    browserEvidence) into state.validationPlan — the concrete plan every
 *    downstream node executes against. It may optionally consult OpenAI to
 *    SEQUENCE checks that are already enabled, but that call cannot add,
 *    remove, or re-enable anything (strictly validated; see the node for the
 *    full authority model). "Conditional Tool Execution" below means each
 *    analyzer node checks state.validationPlan.checks.* itself and skips its
 *    real (expensive) work when disabled — every node still fires structurally
 *    (LangGraph's multi-source fan-in requires every listed source to
 *    complete), but does nothing when its check is off, so no cost is paid
 *    for a validator the plan didn't ask for.
 *  - Fatal failures (invalid URL, empty browser evidence) route STRAIGHT to
 *    reportBuilderNode via conditional edges, so a partial/among report is still
 *    produced instead of throwing.
 *  - The graph is intentionally flat and declarative so it is easy to extend
 *    later with retries, checkpointers, human-approval interrupts, or more
 *    analyzers — none of which are added yet.
 */
import { StateGraph, START, END } from "@langchain/langgraph";
import { FrontendQualityState } from "./frontendQualityState.js";

import { validateInputNode }         from "./nodes/validateInputNode.js";
import { browserCollectorNode }      from "./nodes/browserCollectorNode.js";
import { performanceAnalyzerNode }   from "./nodes/performanceAnalyzerNode.js";
import { networkAnalyzerNode }       from "./nodes/networkAnalyzerNode.js";
import { designAnalyzerNode }        from "./nodes/designAnalyzerNode.js";
import { accessibilityAnalyzerNode } from "./nodes/accessibilityAnalyzerNode.js";
import { applicationProfilerNode }   from "./nodes/applicationProfilerNode.js";
import { ruleProfileNode }           from "./nodes/ruleProfileNode.js";
import { validationPlannerNode }     from "./nodes/validationPlannerNode.js";
import { pythonValidationNode }      from "./nodes/pythonValidationNode.js";
import { normalizeFindingsNode }     from "./nodes/normalizeFindingsNode.js";
import { scoringNode }               from "./nodes/scoringNode.js";
import { aiReasoningNode }           from "./nodes/aiReasoningNode.js";
import { reportBuilderNode }         from "./nodes/reportBuilderNode.js";

// ── Conditional routers (short-circuit on fatal errors) ───────────────────────

/**
 * After validation: continue to browser collection, or skip straight to the
 * report if the URL was invalid (fatal).
 */
function afterValidate(state) {
  return state.fatal ? "reportBuilderNode" : "browserCollectorNode";
}

/**
 * After browser collection: profile the target application, or skip to the
 * report if browser collection failed fatally.
 */
function afterBrowser(state) {
  return state.fatal ? "reportBuilderNode" : "applicationProfilerNode";
}

/**
 * After application profiling: select the matching rule profile, or skip to
 * the report if a prior step failed fatally.
 */
function afterProfile(state) {
  return state.fatal ? "reportBuilderNode" : "ruleProfileNode";
}

/**
 * After rule profile selection: build the validation plan, or skip to the
 * report if a prior step failed fatally.
 */
function afterRuleProfile(state) {
  return state.fatal ? "reportBuilderNode" : "validationPlannerNode";
}

/**
 * After the validation plan is built: fan out to the independent analyzers
 * ("Conditional Tool Execution"), or skip to the report if a prior step
 * failed fatally. Every branch still fires structurally (see the module
 * docstring) — each node consults state.validationPlan.checks.* itself and
 * skips its real work when disabled.
 */
function afterPlanner(state) {
  if (state.fatal) return ["reportBuilderNode"];
  // Returning an array dispatches all branches concurrently. pythonValidationNode
  // manages its own browser session (it doesn't consume browserEvidence) but is
  // started here so it fans in alongside the other analyzers.
  return [
    "performanceAnalyzerNode",
    "designAnalyzerNode",
    "accessibilityAnalyzerNode",
    "pythonValidationNode",
  ];
}

// ── Build ─────────────────────────────────────────────────────────────────────

function buildGraph() {
  const graph = new StateGraph(FrontendQualityState);

  // Register nodes
  graph.addNode("validateInputNode",         validateInputNode);
  graph.addNode("browserCollectorNode",      browserCollectorNode);
  graph.addNode("performanceAnalyzerNode",   performanceAnalyzerNode);
  graph.addNode("networkAnalyzerNode",       networkAnalyzerNode);
  graph.addNode("designAnalyzerNode",        designAnalyzerNode);
  graph.addNode("accessibilityAnalyzerNode", accessibilityAnalyzerNode);
  graph.addNode("applicationProfilerNode",   applicationProfilerNode);
  graph.addNode("ruleProfileNode",           ruleProfileNode);
  graph.addNode("validationPlannerNode",     validationPlannerNode);
  graph.addNode("pythonValidationNode",      pythonValidationNode);
  graph.addNode("normalizeFindingsNode",     normalizeFindingsNode);
  graph.addNode("scoringNode",               scoringNode);
  graph.addNode("aiReasoningNode",           aiReasoningNode);
  graph.addNode("reportBuilderNode",         reportBuilderNode);

  // START -> validate
  graph.addEdge(START, "validateInputNode");

  // validate -> browser | (fatal) report
  graph.addConditionalEdges("validateInputNode", afterValidate, {
    browserCollectorNode: "browserCollectorNode",
    reportBuilderNode:    "reportBuilderNode",
  });

  // browser -> applicationProfiler | (fatal) report
  graph.addConditionalEdges("browserCollectorNode", afterBrowser, {
    applicationProfilerNode: "applicationProfilerNode",
    reportBuilderNode:       "reportBuilderNode",
  });

  // applicationProfiler -> ruleProfile | (fatal) report
  graph.addConditionalEdges("applicationProfilerNode", afterProfile, {
    ruleProfileNode:    "ruleProfileNode",
    reportBuilderNode:  "reportBuilderNode",
  });

  // ruleProfile -> validationPlanner | (fatal) report
  graph.addConditionalEdges("ruleProfileNode", afterRuleProfile, {
    validationPlannerNode: "validationPlannerNode",
    reportBuilderNode:     "reportBuilderNode",
  });

  // validationPlanner -> [performance, design, accessibility, pythonValidation]
  // concurrently ("Conditional Tool Execution") | (fatal) report
  graph.addConditionalEdges("validationPlannerNode", afterPlanner, {
    performanceAnalyzerNode:   "performanceAnalyzerNode",
    designAnalyzerNode:        "designAnalyzerNode",
    accessibilityAnalyzerNode: "accessibilityAnalyzerNode",
    pythonValidationNode:      "pythonValidationNode",
    reportBuilderNode:         "reportBuilderNode",
  });

  // performance -> network (network grouped under the performance branch)
  graph.addEdge("performanceAnalyzerNode", "networkAnalyzerNode");

  // Fan-in BARRIER: passing an array of sources makes normalizeFindingsNode run
  // EXACTLY ONCE, only after ALL four branch tips (network, design,
  // accessibility, pythonValidation) have completed. This prevents the tail
  // (scoring, AI, report) from executing multiple times when branches finish
  // in different super-steps.
  graph.addEdge(
    ["networkAnalyzerNode", "designAnalyzerNode", "accessibilityAnalyzerNode", "pythonValidationNode"],
    "normalizeFindingsNode"
  );

  // Sequential tail
  graph.addEdge("normalizeFindingsNode", "scoringNode");
  graph.addEdge("scoringNode",           "aiReasoningNode");
  graph.addEdge("aiReasoningNode",       "reportBuilderNode");
  graph.addEdge("reportBuilderNode",     END);

  return graph.compile();
}

// Singleton — compiled once at module load.
export const FrontendQualityAgent = buildGraph();
