/**
 * scoring.test.js
 * Unit tests for the deterministic scoring engine (6-category model).
 * Run: npm test   (uses node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeScores,
  performanceScore,
  accessibilityScore,
  overallScore,
  scoreFromFindings,
  penaltyFromFindings,
  scoreLabel,
  CATEGORY_KEYS,
  DEFAULT_WEIGHTS,
} from "./scoring.js";

const F = (severity, confidence = 1, id = "x") => ({ id, severity, confidence });
const ALL_ENABLED = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, true]));

// ─────────────────────────────────────────────────────────────────────────────
// Range guarantees
// ─────────────────────────────────────────────────────────────────────────────

test("all 6 categories + overall are within 0..100 when enabled", () => {
  const r = computeScores({ enabledCategories: ALL_ENABLED });
  for (const k of ["overall", ...CATEGORY_KEYS]) {
    assert.equal(typeof r[k], "number", `${k} should be a number`);
    assert.ok(r[k] >= 0 && r[k] <= 100, `${k} in range`);
  }
});

test("no findings + no anchors → perfect finding-derived scores", () => {
  assert.equal(scoreFromFindings([]), 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// Penalty capping — the core requirement
// ─────────────────────────────────────────────────────────────────────────────

test("hundreds of low-severity findings cannot push a score to zero", () => {
  const many = Array.from({ length: 500 }, () => F("low"));
  const score = scoreFromFindings(many);
  assert.ok(score > 0, `expected > 0, got ${score}`);
  assert.ok(score >= 80, `expected >= 80 due to bucket cap, got ${score}`);
});

test("per-severity bucket penalty is capped", () => {
  const fewLows  = penaltyFromFindings([F("low"), F("low")]);
  const manyLows = penaltyFromFindings(Array.from({ length: 100 }, () => F("low")));
  assert.ok(fewLows < manyLows, "more findings = more penalty (until cap)");
  assert.ok(manyLows <= 15 + 1e-9, `low bucket capped at 15, got ${manyLows}`);
});

test("total finding penalty is globally capped at 70", () => {
  const catastrophic = [
    ...Array.from({ length: 50 }, () => F("critical")),
    ...Array.from({ length: 50 }, () => F("high")),
    ...Array.from({ length: 50 }, () => F("medium")),
  ];
  const penalty = penaltyFromFindings(catastrophic);
  assert.ok(penalty <= 70 + 1e-9, `global cap 70, got ${penalty}`);
  assert.equal(scoreFromFindings(catastrophic), 30, "100 - 70 = 30 floor");
});

test("critical findings penalise more than low findings", () => {
  const crit = penaltyFromFindings([F("critical")]);
  const low  = penaltyFromFindings([F("low")]);
  assert.ok(crit > low, `critical(${crit}) > low(${low})`);
});

test("confidence scales penalty down", () => {
  const full = penaltyFromFindings([F("high", 1.0)]);
  const half = penaltyFromFindings([F("high", 0.5)]);
  assert.ok(half < full, `low-confidence(${half}) < full(${full})`);
  assert.ok(Math.abs(half - full / 2) < 1e-9, "0.5 confidence halves penalty");
});

// ─────────────────────────────────────────────────────────────────────────────
// Lighthouse / axe as strong anchors
// ─────────────────────────────────────────────────────────────────────────────

test("Lighthouse score is a strong input to performance", () => {
  const s = performanceScore({ lighthouseScore: 50, findings: [] });
  // 50*0.6 + 100*0.4 = 70
  assert.equal(Math.round(s), 70);
});

test("performance falls back to findings when Lighthouse unavailable", () => {
  const s = performanceScore({ lighthouseScore: null, findings: [F("high")] });
  assert.equal(Math.round(s), 90); // 100 - 10
});

test("axe score is a strong input to accessibility", () => {
  const s = accessibilityScore({ axeScore: 40, findings: [] });
  // 40*0.6 + 100*0.4 = 64
  assert.equal(Math.round(s), 64);
});

test("accessibility falls back to findings when axe unavailable", () => {
  const s = accessibilityScore({ axeScore: null, findings: [F("critical")] });
  assert.equal(Math.round(s), 82); // 100 - 18
});

// ─────────────────────────────────────────────────────────────────────────────
// not-run categories
// ─────────────────────────────────────────────────────────────────────────────

test("a disabled category returns {status:'not-run'} instead of a fake number", () => {
  const r = computeScores({
    enabledCategories: { ...ALL_ENABLED, crossBrowser: false, uiConsistency: false },
  });
  assert.deepEqual(r.crossBrowser, { status: "not-run" });
  assert.deepEqual(r.uiConsistency, { status: "not-run" });
  assert.equal(typeof r.functional, "number");
  assert.equal(typeof r.overall, "number");
});

test("an unspecified category defaults to enabled (back-compat for simple callers)", () => {
  const r = computeScores({});
  for (const k of CATEGORY_KEYS) {
    assert.equal(typeof r[k], "number", `${k} should default to enabled/scored`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Overall: only enabled categories count, weights renormalized
// ─────────────────────────────────────────────────────────────────────────────

test("overall excludes not-run categories entirely (renormalizes remaining weights)", () => {
  // Only functional (weight 0.25) and performance (weight 0.20) enabled/scored.
  // Renormalized: functional contributes 0.25/0.45, performance 0.20/0.45.
  const o = overallScore({ functional: 100, performance: 0 });
  const expected = 100 * (0.25 / 0.45) + 0 * (0.20 / 0.45);
  assert.ok(Math.abs(o - expected) < 0.5, `expected ~${expected}, got ${o}`);
});

test("overall with every category at 100 is 100 regardless of weights", () => {
  const allHundred = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 100]));
  assert.equal(Math.round(overallScore(allHundred)), 100);
});

test("overall falls back to a plain mean when no weights are configured for the enabled set", () => {
  const o = overallScore({ functional: 80, performance: 40 }, {});
  assert.equal(o, 60);
});

// ─────────────────────────────────────────────────────────────────────────────
// Configurable weights
// ─────────────────────────────────────────────────────────────────────────────

test("custom weights override DEFAULT_WEIGHTS", () => {
  const customWeights = { functional: 1, accessibility: 0, responsive: 0, crossBrowser: 0, performance: 0, uiConsistency: 0 };
  const r = computeScores({
    enabledCategories: ALL_ENABLED,
    weights: customWeights,
    findingsByCategory: { functional: [], accessibility: [F("critical")], responsive: [], crossBrowser: [], performance: [], uiConsistency: [] },
  });
  // Only functional's weight is non-zero, and functional has no findings -> overall should be 100
  // regardless of accessibility's critical finding.
  assert.equal(r.overall, 100);
});

test("DEFAULT_WEIGHTS sum to 1", () => {
  const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `expected weights to sum to 1, got ${sum}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Category composition (folding — verified via computeScores' findingsByCategory contract)
// ─────────────────────────────────────────────────────────────────────────────

test("computeScores returns the exact required shape", () => {
  const r = computeScores({
    enabledCategories: ALL_ENABLED,
    lighthouseScore: 90,
    axeScore: 80,
    findingsByCategory: {
      functional: [F("medium")],
      accessibility: [F("critical")],
      responsive: [F("medium")],
      crossBrowser: [F("low")],
      performance: [F("medium")],
      uiConsistency: [F("high")],
    },
  });
  assert.deepEqual(Object.keys(r).sort(), ["accessibility", "crossBrowser", "functional", "label", "overall", "performance", "responsive", "uiConsistency"]);
  for (const k of ["overall", ...CATEGORY_KEYS]) {
    assert.equal(typeof r[k], "number");
    assert.ok(Number.isInteger(r[k]), `${k} is integer`);
    assert.ok(r[k] >= 0 && r[k] <= 100);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

test("scoreLabel thresholds", () => {
  assert.equal(scoreLabel(95), "Excellent");
  assert.equal(scoreLabel(80), "Good");
  assert.equal(scoreLabel(65), "Needs Improvement");
  assert.equal(scoreLabel(45), "Poor");
  assert.equal(scoreLabel(20), "Critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// A realistic mixed scenario resembling the example output
// ─────────────────────────────────────────────────────────────────────────────

test("realistic scenario produces sensible mid-range scores", () => {
  const r = computeScores({
    enabledCategories: ALL_ENABLED,
    lighthouseScore: 76,
    axeScore: 84,
    findingsByCategory: {
      functional: [F("low")],
      accessibility: [F("low")],
      responsive: [F("medium")],
      crossBrowser: [F("low")],
      performance: [F("medium"), F("low")],
      uiConsistency: [F("low"), F("low"), F("medium")],
    },
  });
  for (const k of ["overall", ...CATEGORY_KEYS]) {
    assert.ok(r[k] > 40 && r[k] <= 100, `${k}=${r[k]} is mid/high range`);
  }
});
