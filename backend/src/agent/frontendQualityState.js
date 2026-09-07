/**
 * Shared LangGraph state definition for FrontendQualityAgent.
 * Uses Annotation API from @langchain/langgraph 0.2.x
 */
import { Annotation } from "@langchain/langgraph";

export const FrontendQualityState = Annotation.Root({
  // Input
  url: Annotation({ reducer: (_, b) => b, default: () => "" }),

  // Optional caller-supplied overrides (POST /api/analyze body.userConfig).
  // Can only NARROW what the selected rule profile already permits — see
  // validationPlannerNode.js. Never trusted to enable anything on its own.
  userConfig: Annotation({ reducer: (_, b) => b, default: () => ({}) }),

  // Unique id for this analysis run (set by validateInputNode)
  analysisId: Annotation({ reducer: (_, b) => b, default: () => "" }),

  // Timing — startedAt set once at validation; keep the earliest value
  analysisStartedAt: Annotation({
    reducer: (a, b) => a || b,
    default: () => null,
  }),

  // Fatal error flag — set only when the pipeline cannot meaningfully continue
  // (invalid URL, or browser collection produced nothing). Analyzer failures are
  // NOT fatal: they add a warning and the pipeline produces a partial report.
  fatal: Annotation({ reducer: (a, b) => a || b, default: () => false }),

  // Raw evidence from browser collection
  browserEvidence: Annotation({ reducer: (_, b) => b, default: () => ({}) }),

  // ── Python validation engine wiring ────────────────────────────────────────
  // What the (future) Target/Application Profiler determines about the site.
  targetProfile: Annotation({ reducer: (_, b) => b, default: () => ({}) }),
  // What the (future) Rule Profile Selector picks for this target.
  ruleProfile: Annotation({ reducer: (_, b) => b, default: () => ({}) }),
  // The agentic validation plan built by validationPlannerNode:
  // { checks, browsers, viewports, reasons, executionOrder, meta }.
  // The rule profile is authoritative for every enable/disable decision;
  // an optional LLM pass may only suggest executionOrder/notes — see that
  // node for the full policy. Consumed by pythonValidationNode and the
  // Node-side analyzer nodes to decide whether to do real work.
  validationPlan: Annotation({ reducer: (_, b) => b, default: () => ({}) }),
  // Raw { status, findings, metrics, warnings, errors } from runner.py.
  pythonValidationResults: Annotation({ reducer: (_, b) => b, default: () => ({}) }),

  // Category-specific raw findings (arrays, reducers append)
  performanceFindings: Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  networkFindings: Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  designFindings: Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  accessibilityFindings: Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  // Accessibility score from axe-core (0-100), replace on write
  accessibilityAxeScore: Annotation({ reducer: (_, b) => b, default: () => null }),

  // Normalized cross-category findings
  normalizedFindings: Annotation({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // Raw metrics snapshot
  metrics: Annotation({ reducer: (_, b) => b, default: () => ({}) }),

  // Scores object (replace on each write)
  scores: Annotation({
    reducer: (_, b) => b,
    default: () => ({
      overall: 0,
      performance: 0,
      design: 0,
      accessibility: 0,
    }),
  }),

  // AI reasoning output
  aiAnalysis: Annotation({ reducer: (_, b) => b, default: () => ({}) }),

  // Final assembled report
  finalReport: Annotation({ reducer: (_, b) => b, default: () => ({}) }),

  // Diagnostics
  errors: Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  warnings: Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});
