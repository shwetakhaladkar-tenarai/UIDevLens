/**
 * applicationProfiler.js
 * Target/Application Profiler — deterministically classifies what kind of
 * web-accessible application is being analyzed, BEFORE rule-profile
 * selection and validation run.
 *
 * Supported target types: standard-web | powerbi | tableau | databricks | unknown
 *
 * Purely deterministic: inspects URL/domain, page title, DOM signatures,
 * script/resource URLs, iframe sources, framework markers, and known
 * embed-platform HTML attributes. It never calls OpenAI — ambiguous results
 * are returned as "unknown" with a low confidence for a later step to
 * (optionally) resolve with AI assistance.
 */

export const SUPPORTED_TARGET_TYPES = ["standard-web", "powerbi", "tableau", "databricks", "unknown"];

// A best-scoring embed candidate below this is not a real signal at all.
const AMBIGUOUS_SCORE_THRESHOLD = 10;
// A best-scoring embed candidate at/above this is treated as a confident match.
const CONFIDENT_SCORE_THRESHOLD = 30;

// Fixed sentinel confidence for anything the deterministic rules can't
// resolve — deliberately not derived from the (weak) score.
const LOW_CONFIDENCE = 0.4;

/**
 * @param {string} weight   points this signal contributes when matched
 * @param {string} label    human-readable evidence string
 * @param {(e: ProfileEvidence) => boolean} test
 */
function sig(weight, label, test) {
  return { weight, label, test };
}

// ── Embed-platform signatures ──────────────────────────────────────────────
const EMBED_SIGNALS = {
  powerbi: [
    sig(40, "Domain matches Power BI (app.powerbi.com / powerbi.com)", (e) =>
      /(^|\.)app\.powerbi\.com$/i.test(e.domain) || /(^|\.)powerbi(mobile)?\.com$/i.test(e.domain)
    ),
    sig(35, "Iframe source points to a Power BI embed (reportEmbed/view)", (e) =>
      e.iframeSrcs.some((src) => /powerbi\.com/i.test(src))
    ),
    sig(20, "Script source loads the Power BI client SDK", (e) =>
      e.scriptUrls.some((src) => /powerbi-client|powerbi\.com/i.test(src))
    ),
    sig(15, "Power BI embed container markers found in the DOM", (e) => e.appSignatures.hasPowerBiEmbedMarkers),
    sig(10, "Page title mentions Power BI", (e) => /power\s*bi/i.test(e.title)),
  ],
  tableau: [
    sig(40, "Domain matches Tableau (public.tableau.com / tableau.com)", (e) =>
      /(^|\.)public\.tableau\.com$/i.test(e.domain) || /(^|\.)(online\.)?tableau\.com$/i.test(e.domain)
    ),
    sig(35, "Iframe source points to a Tableau view", (e) =>
      e.iframeSrcs.some((src) => /tableau\.com/i.test(src) || /\/views\//i.test(src))
    ),
    sig(20, "Script source loads the Tableau embedding API", (e) =>
      e.scriptUrls.some((src) => /tableau.*(api|javascripts)/i.test(src))
    ),
    sig(35, "<tableau-viz> custom element or .tableauViz container found", (e) =>
      e.appSignatures.hasTableauEmbedMarkers || e.appSignatures.customElementTags.includes("tableau-viz")
    ),
    sig(10, "Page title mentions Tableau", (e) => /tableau/i.test(e.title)),
  ],
  databricks: [
    sig(40, "Domain matches a Databricks workspace", (e) =>
      /(^|\.)cloud\.databricks\.com$/i.test(e.domain) ||
      /(^|\.)azuredatabricks\.net$/i.test(e.domain) ||
      /(^|\.)gcp\.databricks\.com$/i.test(e.domain)
    ),
    sig(30, "Iframe source points to a Databricks embed", (e) => e.iframeSrcs.some((src) => /databricks/i.test(src))),
    sig(15, "Script source references Databricks assets", (e) => e.scriptUrls.some((src) => /databricks/i.test(src))),
    sig(15, "Databricks notebook/dashboard DOM markers found", (e) => e.appSignatures.hasDatabricksMarkers),
    sig(10, "Page title mentions Databricks", (e) => /databricks/i.test(e.title)),
  ],
};

// ── Generic "ordinary website" signatures (used only once no embed platform matches) ──
const STANDARD_WEB_SIGNALS = [
  sig(15, "React root detected", (e) => e.appSignatures.hasReactRoot),
  sig(15, "Vue application root detected", (e) => e.appSignatures.hasVueApp),
  sig(15, "Angular application detected (ng-version)", (e) => e.appSignatures.hasAngular),
  sig(10, "Svelte-compiled classes detected", (e) => e.appSignatures.hasSvelte),
  sig(10, "Standard document structure present (headings/links/forms)", (e) =>
    e.headingCount > 0 || e.linkCount > 0 || e.formCount > 0
  ),
];

const NEGATIVE_EVIDENCE_LABEL = {
  powerbi: "No Power BI embed signatures found",
  tableau: "No Tableau embed signatures found",
  databricks: "No Databricks embed signatures found",
};

// ─────────────────────────────────────────────────────────────────────────────
// Evidence normalization — tolerant of both full browserCollector evidence
// and minimal mocked fixtures used in tests.
// ─────────────────────────────────────────────────────────────────────────────

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * @typedef {object} ProfileEvidence
 * @property {string} url
 * @property {string} domain
 * @property {string} title
 * @property {string[]} scriptUrls
 * @property {string[]} iframeSrcs
 * @property {object} appSignatures
 * @property {number} headingCount
 * @property {number} linkCount
 * @property {number} formCount
 */

/** @returns {ProfileEvidence} */
function normalizeEvidence(raw = {}) {
  const url = raw.finalUrl || raw.url || "";
  const domain = (raw.domain || safeHostname(url) || "").toLowerCase();
  const title = raw.meta?.title || raw.title || "";

  const scriptUrls = raw.resources?.scriptUrls || raw.scriptUrls || [];
  const iframeSrcs = (raw.elements?.iframes || raw.iframes || [])
    .map((f) => (typeof f === "string" ? f : f?.src))
    .filter(Boolean);

  const appSignatures = {
    hasReactRoot: false,
    hasVueApp: false,
    hasAngular: false,
    hasSvelte: false,
    generator: null,
    customElementTags: [],
    hasPowerBiEmbedMarkers: false,
    hasTableauEmbedMarkers: false,
    hasDatabricksMarkers: false,
    ...(raw.appSignatures || {}),
  };

  return {
    url,
    domain,
    title,
    scriptUrls,
    iframeSrcs,
    appSignatures,
    headingCount: raw.elements?.headings?.length ?? raw.headingCount ?? 0,
    linkCount:    raw.elements?.links?.length    ?? raw.linkCount    ?? 0,
    formCount:    raw.elements?.forms?.length    ?? raw.formCount    ?? 0,
    hasAnyContent: Boolean(
      title || (raw.dom?.totalElements ?? 0) > 0 || raw.visibleText || raw.hasAnyContent
    ),
  };
}

function scoreCandidate(evidence, signals) {
  const matched = signals.filter((s) => {
    try {
      return Boolean(s.test(evidence));
    } catch {
      return false;
    }
  });
  return {
    score: matched.reduce((sum, s) => sum + s.weight, 0),
    labels: matched.map((s) => s.label),
  };
}

function scoreToConfidence(score) {
  if (score >= 60) return 0.98;
  if (score >= 45) return 0.9;
  if (score >= CONFIDENT_SCORE_THRESHOLD) return 0.8;
  return 0.65;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministically classify the target application from collected browser
 * evidence (or an equivalent mocked fixture).
 *
 * @param {object} rawEvidence  browserCollector-shaped evidence (or a mock)
 * @returns {{targetType: string, confidence: number, evidence: string[]}}
 */
export function profileApplication(rawEvidence = {}) {
  const evidence = normalizeEvidence(rawEvidence);

  const candidates = {
    powerbi:    scoreCandidate(evidence, EMBED_SIGNALS.powerbi),
    tableau:    scoreCandidate(evidence, EMBED_SIGNALS.tableau),
    databricks: scoreCandidate(evidence, EMBED_SIGNALS.databricks),
  };

  const [bestType, bestResult] = Object.entries(candidates).sort((a, b) => b[1].score - a[1].score)[0];

  // ── Confident embed-platform match ─────────────────────────────────────
  if (bestResult.score >= CONFIDENT_SCORE_THRESHOLD) {
    const otherNegatives = Object.keys(EMBED_SIGNALS)
      .filter((t) => t !== bestType)
      .map((t) => NEGATIVE_EVIDENCE_LABEL[t]);
    return {
      targetType: bestType,
      confidence: scoreToConfidence(bestResult.score),
      evidence: [...bestResult.labels, ...otherNegatives],
    };
  }

  // ── Weak/contradictory embed-platform signal — too ambiguous to commit ──
  if (bestResult.score >= AMBIGUOUS_SCORE_THRESHOLD) {
    return {
      targetType: "unknown",
      confidence: LOW_CONFIDENCE,
      evidence: [
        ...bestResult.labels,
        `Signals for "${bestType}" were too weak to classify confidently`,
      ],
    };
  }

  // ── No embed-platform signal at all — evaluate as an ordinary website ──
  const standardWeb = scoreCandidate(evidence, STANDARD_WEB_SIGNALS);
  const negativeEvidence = Object.values(NEGATIVE_EVIDENCE_LABEL);

  if (standardWeb.score > 0 || evidence.hasAnyContent) {
    return {
      targetType: "standard-web",
      confidence: standardWeb.score >= 20 ? 0.95 : standardWeb.score >= 10 ? 0.85 : 0.7,
      evidence: [...standardWeb.labels, ...negativeEvidence],
    };
  }

  // ── No usable evidence whatsoever (e.g. blank page / failed navigation) ──
  return {
    targetType: "unknown",
    confidence: LOW_CONFIDENCE,
    evidence: ["No DOM content or framework signatures available to classify the target"],
  };
}
