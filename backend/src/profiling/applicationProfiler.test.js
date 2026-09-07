/**
 * applicationProfiler.test.js
 * Unit tests for the deterministic Target/Application Profiler.
 * Run: npm test   (uses node --test)
 *
 * Each test feeds a mocked browserCollector-shaped evidence fixture — no
 * real browser/network involved — matching the profiler's documented
 * input shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { profileApplication, SUPPORTED_TARGET_TYPES } from "./applicationProfiler.js";

function baseEvidence(overrides = {}) {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    domain: "example.com",
    meta: { title: "Example Domain" },
    resources: { scriptUrls: [] },
    elements: { iframes: [], headings: [{ tag: "H1" }], links: [{ href: "/" }], forms: [] },
    dom: { totalElements: 42 },
    appSignatures: {
      hasReactRoot: false,
      hasVueApp: false,
      hasAngular: false,
      hasSvelte: false,
      generator: null,
      customElementTags: [],
      hasPowerBiEmbedMarkers: false,
      hasTableauEmbedMarkers: false,
      hasDatabricksMarkers: false,
    },
    ...overrides,
  };
}

test("SUPPORTED_TARGET_TYPES matches the required set", () => {
  assert.deepEqual(
    [...SUPPORTED_TARGET_TYPES].sort(),
    ["databricks", "powerbi", "standard-web", "tableau", "unknown"].sort()
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// standard-web
// ─────────────────────────────────────────────────────────────────────────────

test("classifies a plain React site as standard-web with high confidence", () => {
  const evidence = baseEvidence({
    appSignatures: {
      ...baseEvidence().appSignatures,
      hasReactRoot: true,
    },
  });

  const result = profileApplication(evidence);

  assert.equal(result.targetType, "standard-web");
  assert.ok(result.confidence >= 0.9, `expected high confidence, got ${result.confidence}`);
  assert.ok(result.evidence.some((e) => /React root detected/.test(e)));
  assert.ok(result.evidence.some((e) => /No Power BI embed signatures found/.test(e)));
  assert.ok(result.evidence.some((e) => /No Tableau embed signatures found/.test(e)));
  assert.ok(result.evidence.some((e) => /No Databricks embed signatures found/.test(e)));
});

test("classifies a bare document with some content as standard-web", () => {
  const result = profileApplication(baseEvidence());
  assert.equal(result.targetType, "standard-web");
  assert.ok(result.confidence > 0.4);
});

// ─────────────────────────────────────────────────────────────────────────────
// Power BI
// ─────────────────────────────────────────────────────────────────────────────

test("classifies a Power BI embed by domain + iframe with very high confidence", () => {
  const evidence = baseEvidence({
    url: "https://app.powerbi.com/view?r=abc123",
    finalUrl: "https://app.powerbi.com/view?r=abc123",
    domain: "app.powerbi.com",
    meta: { title: "Power BI Report" },
    elements: { iframes: [{ src: "https://app.powerbi.com/reportEmbed" }], headings: [], links: [], forms: [] },
  });

  const result = profileApplication(evidence);

  assert.equal(result.targetType, "powerbi");
  assert.ok(result.confidence >= 0.9, `expected very high confidence, got ${result.confidence}`);
  assert.ok(result.evidence.some((e) => /Domain matches Power BI/.test(e)));
  assert.ok(result.evidence.some((e) => /Iframe source points to a Power BI embed/.test(e)));
});

test("classifies an embedded Power BI iframe on a third-party host by iframe src alone", () => {
  const evidence = baseEvidence({
    domain: "internal-dashboards.corp.example.com",
    meta: { title: "Sales Dashboard" },
    elements: { iframes: [{ src: "https://app.powerbi.com/reportEmbed?reportId=1" }], headings: [], links: [], forms: [] },
  });

  const result = profileApplication(evidence);
  assert.equal(result.targetType, "powerbi");
  assert.ok(result.confidence >= 0.7);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tableau
// ─────────────────────────────────────────────────────────────────────────────

test("classifies a Tableau Public view by domain + script with very high confidence", () => {
  const evidence = baseEvidence({
    url: "https://public.tableau.com/views/MyDashboard/Sheet1",
    finalUrl: "https://public.tableau.com/views/MyDashboard/Sheet1",
    domain: "public.tableau.com",
    meta: { title: "MyDashboard - Tableau Public" },
    resources: { scriptUrls: ["https://public.tableau.com/javascripts/api/tableau-2.min.js"] },
  });

  const result = profileApplication(evidence);

  assert.equal(result.targetType, "tableau");
  assert.ok(result.confidence >= 0.9, `expected very high confidence, got ${result.confidence}`);
  assert.ok(result.evidence.some((e) => /Domain matches Tableau/.test(e)));
});

test("classifies a page using the <tableau-viz> custom element", () => {
  const evidence = baseEvidence({
    domain: "dashboards.example.com",
    meta: { title: "Internal Dashboards" },
    appSignatures: {
      ...baseEvidence().appSignatures,
      hasTableauEmbedMarkers: true,
      customElementTags: ["tableau-viz"],
    },
  });

  const result = profileApplication(evidence);
  assert.equal(result.targetType, "tableau");
});

// ─────────────────────────────────────────────────────────────────────────────
// Databricks (bonus coverage — same mechanism as powerbi/tableau)
// ─────────────────────────────────────────────────────────────────────────────

test("classifies a Databricks workspace by domain", () => {
  const evidence = baseEvidence({
    url: "https://my-workspace.cloud.databricks.com/?o=123#notebook/456",
    finalUrl: "https://my-workspace.cloud.databricks.com/?o=123#notebook/456",
    domain: "my-workspace.cloud.databricks.com",
    meta: { title: "Databricks - Notebook" },
  });

  const result = profileApplication(evidence);
  assert.equal(result.targetType, "databricks");
  assert.ok(result.confidence >= 0.9);
});

// ─────────────────────────────────────────────────────────────────────────────
// unknown
// ─────────────────────────────────────────────────────────────────────────────

test("classifies a blank/failed page (no content at all) as unknown with low confidence", () => {
  const result = profileApplication({
    url: "https://broken.example.com/",
    finalUrl: "https://broken.example.com/",
    domain: "broken.example.com",
    meta: { title: "" },
    resources: { scriptUrls: [] },
    elements: { iframes: [], headings: [], links: [], forms: [] },
    dom: { totalElements: 0 },
    visibleText: "",
    appSignatures: {},
  });

  assert.equal(result.targetType, "unknown");
  assert.equal(result.confidence, 0.4);
});

test("classifies weak/ambiguous embed-platform hints as unknown with low confidence", () => {
  // Only a page-title mention (weight 10) — below the ambiguous floor for a
  // confident match, but enough to register as a (weak) signal.
  const evidence = baseEvidence({
    meta: { title: "Notes about Power BI licensing" },
  });

  const result = profileApplication(evidence);

  assert.equal(result.targetType, "unknown");
  assert.equal(result.confidence, 0.4);
});

test("never calls OpenAI — profileApplication is a pure, synchronous function", () => {
  // profileApplication must not return a Promise (i.e. it never awaits an
  // AI call) — deterministic classification only.
  const result = profileApplication(baseEvidence());
  assert.equal(typeof result.then, "undefined");
});
