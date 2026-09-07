/**
 * accessibilityAnalyzer.js
 * Runs axe-core (WCAG 2.0/2.1 A + AA rules) inside a Playwright Chromium page.
 *
 * Detects (via axe-core, no fabrication):
 *  - missing image alt text        (image-alt)
 *  - poor color contrast           (color-contrast)
 *  - form labels                   (label, select-name, ...)
 *  - button accessible names       (button-name)
 *  - link accessible names         (link-name)
 *  - ARIA misuse                   (aria-*)
 *  - heading issues                (empty-heading, heading-order, ...)
 *  - document language             (html-has-lang, html-lang-valid)
 *  - duplicate IDs                 (duplicate-id*)
 *  - landmark problems             (region, landmark-*)
 *  - and every other rule axe-core reports
 *
 * Returns:
 *   { score: 0-100, findings: [] }
 *
 * Each finding:
 *   { id, category:"accessibility", severity, title, description,
 *     impact, recommendation, evidence, confidence, source:"axe-core" }
 */

import { chromium }      from "playwright";
import { readFileSync }  from "fs";
import { createRequire } from "module";
import { logger }        from "../utils/logger.js";

const require = createRequire(import.meta.url);

// Load axe-core source once at module load (injected into every page)
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// ── axe impact → our severity scale ───────────────────────────────────────────
const IMPACT_SEVERITY = {
  critical: "critical",
  serious:  "high",
  moderate: "medium",
  minor:    "low",
  // axe sometimes returns null impact
  null:     "info",
};

// ── axe impact → confidence (how certain the automated check is) ──────────────
// Contrast and some checks have known false-positive potential; most rules are
// deterministic DOM assertions with very high confidence.
const RULE_CONFIDENCE = {
  "color-contrast": 0.8,   // can false-positive on gradients / images / opacity
  "color-contrast-enhanced": 0.8,
  default:          0.95,  // structural DOM checks are highly reliable
};

// ── Limits ────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  navigationTimeoutMs: 30_000,
  maxNodesPerRule:     15,   // cap affected-element samples per rule
  maxFindings:         100,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {object} [_browserEvidence]  Unused (kept for interface compatibility)
 * @param {object} [options]
 * @returns {Promise<{ score: number, findings: Array }>}
 */
export async function runAccessibilityAnalysis(url, _browserEvidence = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  logger.info("[accessibilityAnalyzer] Starting axe-core audit", { url });

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport:          { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout:   cfg.navigationTimeoutMs,
      });
      await page.waitForTimeout(1_000).catch(() => {});
    } catch (err) {
      logger.warn("[accessibilityAnalyzer] Navigation error", { error: err.message });
    }

    // Inject axe-core into the page and run it
    await page.evaluate(AXE_SOURCE);

    const axeResults = await page.evaluate(async () => {
      // Run WCAG 2.0/2.1 A + AA rule sets
      return await window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
        },
      });
    });

    const violations = axeResults?.violations ?? [];
    logger.info("[accessibilityAnalyzer] axe-core complete", {
      violations: violations.length,
      passes:     axeResults?.passes?.length ?? 0,
    });

    const findings = violations
      .slice(0, cfg.maxFindings)
      .map((v) => mapViolation(v, cfg));

    const score = computeScore(violations, axeResults?.passes ?? []);

    return { score, findings };

  } catch (err) {
    logger.error("[accessibilityAnalyzer] axe-core run failed", { error: err.message });
    return {
      score: null,
      findings: [{
        id:          "a11y-axe-error",
        category:    "accessibility",
        severity:    "info",
        title:       "Accessibility audit could not complete",
        description: `axe-core failed to run: ${err.message}`,
        impact:      "Accessibility issues could not be automatically detected for this page.",
        recommendation: "Verify the page loads correctly and retry the audit.",
        evidence:    { error: err.message },
        confidence:  0,
        source:      "axe-core",
      }],
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping: axe violation → normalised finding
// ─────────────────────────────────────────────────────────────────────────────

function mapViolation(v, cfg) {
  const severity   = IMPACT_SEVERITY[String(v.impact)] ?? "info";
  const confidence = RULE_CONFIDENCE[v.id] ?? RULE_CONFIDENCE.default;

  const nodes = (v.nodes ?? []).slice(0, cfg.maxNodesPerRule).map((n) => ({
    // affected element
    selector:       Array.isArray(n.target) ? n.target.join(" ") : String(n.target ?? ""),
    html:           truncate(n.html ?? "", 200),
    failureSummary: truncate(n.failureSummary ?? "", 300),
  }));

  return {
    id:          `a11y-${v.id}`,
    category:    "accessibility",
    severity,
    title:       v.help ?? v.id,
    description: v.description ?? v.help ?? "",
    impact:      impactSentence(v, nodes.length),
    recommendation: v.helpUrl
      ? `${v.help}. See ${v.helpUrl}`
      : (v.help ?? ""),
    evidence: {
      axeRule:      v.id,            // axe rule id
      axeImpact:    v.impact,        // original axe impact
      wcagTags:     (v.tags ?? []).filter((t) => t.startsWith("wcag")),
      helpUrl:      v.helpUrl ?? null,
      affectedCount: v.nodes?.length ?? 0,
      nodes,                          // selector + affected element + help text
    },
    confidence,
    source: "axe-core",
  };
}

function impactSentence(v, shownNodes) {
  const total = v.nodes?.length ?? 0;
  const noun  = total === 1 ? "element" : "elements";
  return `${total} ${noun} affected by "${v.id}"` +
    (total > shownNodes ? ` (showing first ${shownNodes})` : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Score: 100 minus weighted penalties, floored at 0
// ─────────────────────────────────────────────────────────────────────────────

function computeScore(violations, passes) {
  if (!violations.length) return 100;

  const PENALTY = { critical: 15, serious: 8, moderate: 4, minor: 1 };
  let penalty = 0;

  for (const v of violations) {
    const per   = PENALTY[String(v.impact)] ?? 1;
    const nodes = v.nodes?.length ?? 1;
    // Each rule penalised once for the rule + a smaller amount per extra node
    penalty += per + Math.min(per, (nodes - 1) * (per * 0.15));
  }

  return Math.max(0, Math.round(100 - penalty));
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function truncate(str, max) {
  if (typeof str !== "string") return "";
  const clean = str.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}
