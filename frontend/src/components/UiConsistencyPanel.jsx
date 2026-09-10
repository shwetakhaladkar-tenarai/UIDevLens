import React, { useMemo } from "react";
import IssueBucketGrid from "./IssueBucketGrid.jsx";
import { bucketUiConsistencyIssues } from "../utils/issueBuckets.js";

/**
 * UI Consistency: typography, colors, spacing, and component findings —
 * bucketed from report.issues (category "design" from Node's live analyzer
 * + "ui-consistency" from Python's ui_consistency.py; both feed the same
 * uiConsistency score, see scoring.js). Deterministic evidence only.
 */
export default function UiConsistencyPanel({ issues = [] }) {
  const uiIssues = useMemo(
    () => issues.filter((i) => i.category === "design" || i.category === "ui-consistency"),
    [issues]
  );
  const { rules, buckets } = useMemo(() => bucketUiConsistencyIssues(uiIssues), [uiIssues]);

  const groups = rules.map((r) => ({ ...r, items: buckets[r.key] }));
  if (buckets.other.length) groups.push({ key: "other", label: "Other", items: buckets.other });

  if (!uiIssues.length) {
    return (
      <section aria-labelledby="ui-consistency-heading">
        <h2 id="ui-consistency-heading" className="mb-4 text-base font-semibold text-gray-900">UI Consistency</h2>
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No UI-consistency findings — either the site's typography/color/spacing/components were consistent, or this check did not run.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="ui-consistency-heading">
      <h2 id="ui-consistency-heading" className="mb-4 text-base font-semibold text-gray-900">
        UI Consistency <span className="text-sm font-normal text-gray-500">({uiIssues.length})</span>
      </h2>
      <IssueBucketGrid groups={groups} />
    </section>
  );
}
