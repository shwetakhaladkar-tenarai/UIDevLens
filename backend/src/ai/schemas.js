import { z } from "zod";

/**
 * schemas.js
 * Zod schemas for validating the LLM's structured output.
 * The AI produces qualitative reasoning ONLY — it never emits numerical scores.
 */

// ── Prioritized issue ─────────────────────────────────────────────────────────
export const PrioritizedIssueSchema = z.object({
  findingId:       z.string(),
  priority:        z.number().int().min(1),
  reason:          z.string(),
  likelyRootCause: z.string(),
  recommendation:  z.string(),
  impact:          z.enum(["low", "medium", "high"]),
  effort:          z.enum(["low", "medium", "high"]),
});

// ── Full AI analysis ──────────────────────────────────────────────────────────
export const AiAnalysisSchema = z.object({
  executiveSummary:     z.string(),
  majorRisks:           z.array(z.string()),
  prioritizedIssues:    z.array(PrioritizedIssueSchema),
  crossBrowserSummary:  z.string(),
  accessibilitySummary: z.string(),
  performanceSummary:   z.string(),
  quickWins:            z.array(z.string()),
  recommendations:      z.array(z.string()),
});

/**
 * Strip markdown fences and extract the first {...} JSON block.
 * @param {string} raw
 * @returns {string}
 */
export function extractJson(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // If there is leading/trailing prose, grab the outermost JSON object.
  const first = s.indexOf("{");
  const last  = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

/**
 * Safely parse + validate the LLM response.
 * Returns { ok, data, error }:
 *   - ok:true, data = validated object (fully conforms to schema)
 *   - ok:false, error = reason; data = best-effort parsed object or null
 *
 * Never throws.
 * @param {string} raw
 * @returns {{ ok: boolean, data: object|null, error?: string }}
 */
export function parseAiResponse(raw) {
  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    return { ok: false, data: null, error: `Invalid JSON: ${err.message}` };
  }

  const result = AiAnalysisSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  // Schema mismatch — attempt a lenient coercion so partial output is still usable.
  const coerced = coerceLenient(parsed);
  const recheck = AiAnalysisSchema.safeParse(coerced);
  if (recheck.success) {
    return { ok: true, data: recheck.data };
  }

  return {
    ok:    false,
    data:  coerced,   // best-effort, may be partially populated
    error: result.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
             || "Schema validation failed",
  };
}

/**
 * Lenient coercion: fill missing arrays/strings and normalise enum casing so a
 * mostly-correct response still validates instead of being discarded.
 * @param {any} obj
 * @returns {object}
 */
function coerceLenient(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const lc = (v) => (typeof v === "string" ? v.toLowerCase() : v);
  const enumOrMedium = (v) => (["low", "medium", "high"].includes(lc(v)) ? lc(v) : "medium");

  const issues = Array.isArray(o.prioritizedIssues) ? o.prioritizedIssues : [];
  const strArr = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);
  const str    = (v) => (typeof v === "string" ? v : "");

  return {
    executiveSummary:     str(o.executiveSummary),
    majorRisks:           strArr(o.majorRisks),
    prioritizedIssues: issues.map((it, idx) => ({
      findingId:       typeof it?.findingId === "string" ? it.findingId : "",
      priority:        Number.isInteger(it?.priority) ? it.priority : idx + 1,
      reason:          typeof it?.reason === "string" ? it.reason : "",
      likelyRootCause: typeof it?.likelyRootCause === "string" ? it.likelyRootCause : "",
      recommendation:  typeof it?.recommendation === "string" ? it.recommendation : "",
      impact:          enumOrMedium(it?.impact),
      effort:          enumOrMedium(it?.effort),
    })),
    crossBrowserSummary:  str(o.crossBrowserSummary),
    accessibilitySummary: str(o.accessibilitySummary),
    performanceSummary:   str(o.performanceSummary),
    quickWins:            strArr(o.quickWins),
    recommendations:      strArr(o.recommendations),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning response (validationPlannerNode) — sequencing/rationale ONLY.
// This schema intentionally has NO power to enable/disable a check; that
// authority never leaves validationPlannerNode's deterministic logic.
// ─────────────────────────────────────────────────────────────────────────────

export const PlanningResponseSchema = z.object({
  executionOrder: z.array(z.string()),
  notes: z.record(z.string()).optional().default({}),
});

/**
 * Safely parse + validate the LLM's planning-sequencing response.
 * Never throws. Does NOT check that executionOrder matches the enabled-check
 * set — that authorization check happens in validationPlannerNode itself,
 * which is the sole place allowed to decide what's enabled.
 * @param {string} raw
 * @returns {{ ok: boolean, data: {executionOrder: string[], notes: object}|null, error?: string }}
 */
export function parsePlanningResponse(raw) {
  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    return { ok: false, data: null, error: `Invalid JSON: ${err.message}` };
  }

  const result = PlanningResponseSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    data: null,
    error: result.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      || "Schema validation failed",
  };
}
