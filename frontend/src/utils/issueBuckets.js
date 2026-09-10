/**
 * issueBuckets.js
 * Deterministic client-side grouping of the flat `issues` list into the
 * sub-categories the dashboard displays. Bucketing is by finding `id`
 * prefix — a stable, documented convention set by the validators that
 * produce these findings (python-validation/functional/*.py and
 * python-validation/design/ui_consistency.py, plus Node's own
 * designAnalyzer.js which reuses the same "design-*" prefixes). Nothing
 * here re-derives severity/evidence — it only sorts already-normalized
 * issues into named buckets so no finding is ever dropped (unmatched
 * findings land in `other`).
 */

const FUNCTIONAL_RULES = [
  { key: "brokenLinks",        label: "Broken Links",         test: (id) => id.startsWith("functional-link-") },
  { key: "failedButtons",      label: "Failed Buttons",       test: (id) => id.startsWith("functional-buttons-") },
  { key: "forms",              label: "Forms",                 test: (id) => id.startsWith("functional-forms-") },
  { key: "navigationFailures", label: "Navigation Failures",  test: (id) => id.startsWith("functional-nav-") },
  { key: "failedRequests",     label: "Failed Requests",      test: (id) => id.startsWith("functional-network-error-") || id === "functional-page-http-error" || id === "functional-page-navigation-error" },
  { key: "consoleErrors",      label: "Console Errors",       test: (id) => id.startsWith("functional-console-error-") || id.startsWith("functional-page-error-") },
  { key: "missingStates",      label: "Missing States",       test: (id) => id.startsWith("functional-states-") },
];

/** @param {object[]} issues - report.issues filtered to category === "functional" */
export function bucketFunctionalIssues(issues = []) {
  const buckets = Object.fromEntries(FUNCTIONAL_RULES.map((r) => [r.key, []]));
  buckets.other = [];
  for (const issue of issues) {
    const id = issue.id || "";
    const rule = FUNCTIONAL_RULES.find((r) => r.test(id));
    (rule ? buckets[rule.key] : buckets.other).push(issue);
  }
  return { rules: FUNCTIONAL_RULES, buckets };
}

const UI_CONSISTENCY_RULES = [
  { key: "typography", label: "Typography", test: (id) => id.includes("font") },
  { key: "colors",     label: "Colors",     test: (id) => id.includes("color") },
  { key: "spacing",    label: "Spacing",    test: (id) => id.includes("padding") || id.includes("margin") || id.includes("gap") || id.includes("spacing") },
  { key: "components", label: "Components", test: (id) => id.includes("button") || id.includes("input") || id.includes("card") || id.includes("radius") || id.includes("height") || id.includes("dimension") || id.includes("tap-target") },
];

/** @param {object[]} issues - report.issues filtered to category in {"design","ui-consistency"} */
export function bucketUiConsistencyIssues(issues = []) {
  const buckets = Object.fromEntries(UI_CONSISTENCY_RULES.map((r) => [r.key, []]));
  buckets.other = [];
  for (const issue of issues) {
    const id = issue.id || "";
    const rule = UI_CONSISTENCY_RULES.find((r) => r.test(id));
    (rule ? buckets[rule.key] : buckets.other).push(issue);
  }
  return { rules: UI_CONSISTENCY_RULES, buckets };
}
