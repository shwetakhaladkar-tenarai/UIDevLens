/**
 * scoring.test.js
 * Unit tests for the deterministic scoring engine.
 * Run: npm test   (uses node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeScores,
  performanceScore,
  designScore,
  accessibilityScore,
  overallScore,
  scoreFromFindings,
  penaltyFromFindings,
  scoreLabel,
} from "./scoring.js";

const F = (severity, confidence = 1, id = "x") => ({ id, severity, confidence });

// ─────────────────────────────────────────────────────────────────────────────
// Range guarantees
// ─────────────────────────────────────────────────────────────────────────────

test("scores are always within 0..100", () => {
  const empty = computeScores({});
  for (const k of ["overall", "performance", "design", "accessibility"]) {
    assert.ok(empty[k] >= 0 && empty[k] <= 100, `${k} in range`);
  }
});

test("no findings + no anchors → perfect finding-derived scores", () => {
  assert.equal(scoreFromFindings([]), 100);
  assert.equal(designScore({ designFindings: [], responsiveFindings: [] }), 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// Penalty capping — the core requirement
// ─────────────────────────────────────────────────────────────────────────────

test("hundreds of low-severity findings cannot push a score to zero", () => {
  const many = Array.from({ length: 500 }, () => F("low"));
  const score = scoreFromFindings(many);
  assert.ok(score > 0, `expected > 0, got ${score}`);
  // low bucket cap is 15, so score should stay near 85
  assert.ok(score >= 80, `expected >= 80 due to bucket cap, got ${score}`);
});

test("per-severity bucket penalty is capped", () => {
  const fewLows  = penaltyFromFindings([F("low"), F("low")]);            // 2 * 1.5 = 3
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
// Lighthouse as a strong input
// ─────────────────────────────────────────────────────────────────────────────

test("Lighthouse score is a strong input to performance", () => {
  // No findings, LH=50 → blended toward 50 (60% weight) but lifted by clean findings
  const s = performanceScore({ lighthouseScore: 50, performanceFindings: [], networkFindings: [] });
  // 50*0.6 + 100*0.4 = 70
  assert.equal(Math.round(s), 70);
});

test("performance falls back to findings when Lighthouse unavailable", () => {
  const s = performanceScore({ lighthouseScore: null, performanceFindings: [F("high")], networkFindings: [] });
  // pure finding score: 100 - 10 = 90
  assert.equal(Math.round(s), 90);
});

test("network findings influence performance score", () => {
  const withoutNet = performanceScore({ lighthouseScore: 100, performanceFindings: [], networkFindings: [] });
  const withNet    = performanceScore({ lighthouseScore: 100, performanceFindings: [], networkFindings: [F("high"), F("high")] });
  assert.ok(withNet < withoutNet, `network issues lower perf: ${withNet} < ${withoutNet}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Responsive → design
// ─────────────────────────────────────────────────────────────────────────────

test("responsive findings influence design score", () => {
  const clean     = designScore({ designFindings: [], responsiveFindings: [] });
  const withResp  = designScore({ designFindings: [], responsiveFindings: [F("high"), F("critical")] });
  assert.ok(withResp < clean, `responsive issues lower design: ${withResp} < ${clean}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility axe anchor
// ─────────────────────────────────────────────────────────────────────────────

test("axe score is a strong input to accessibility", () => {
  const s = accessibilityScore({ axeScore: 40, accessibilityFindings: [] });
  // 40*0.6 + 100*0.4 = 64
  assert.equal(Math.round(s), 64);
});

test("accessibility falls back to findings when axe unavailable", () => {
  const s = accessibilityScore({ axeScore: null, accessibilityFindings: [F("critical")] });
  assert.equal(Math.round(s), 82); // 100 - 18
});

// ─────────────────────────────────────────────────────────────────────────────
// Overall weighting 40/30/30
// ─────────────────────────────────────────────────────────────────────────────

test("overall uses 40/30/30 weighting", () => {
  const o = overallScore({ performance: 100, design: 0, accessibility: 0 });
  assert.equal(o, 40);
  const o2 = overallScore({ performance: 0, design: 100, accessibility: 0 });
  assert.equal(o2, 30);
  const o3 = overallScore({ performance: 0, design: 0, accessibility: 100 });
  assert.equal(o3, 30);
});

test("computeScores returns the exact required shape", () => {
  const r = computeScores({
    lighthouseScore: 90,
    axeScore: 80,
    performanceFindings: [F("medium")],
    networkFindings: [F("low")],
    designFindings: [F("high")],
    responsiveFindings: [F("medium")],
    accessibilityFindings: [F("critical")],
  });
  assert.deepEqual(Object.keys(r).sort(), ["accessibility", "design", "label", "overall", "performance"]);
  for (const k of ["overall", "performance", "design", "accessibility"]) {
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
    lighthouseScore: 76,
    axeScore: 84,
    performanceFindings: [F("medium"), F("low")],
    networkFindings: [F("medium")],
    designFindings: [F("low"), F("low"), F("medium")],
    responsiveFindings: [F("medium")],
    accessibilityFindings: [F("low")],
  });
  for (const k of ["overall", "performance", "design", "accessibility"]) {
    assert.ok(r[k] > 40 && r[k] <= 100, `${k}=${r[k]} is mid/high range`);
  }
});
