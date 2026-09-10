import React, { useMemo } from "react";
import IssueBucketGrid from "./IssueBucketGrid.jsx";
import { bucketFunctionalIssues } from "../utils/issueBuckets.js";

/**
 * Functional UI: broken links, failed buttons, forms, navigation failures,
 * console errors, failed requests, missing states — bucketed from
 * report.issues (category === "functional"). All deterministic evidence
 * from the Python functional/* validators; no AI involved.
 */
export default function FunctionalPanel({ issues = [] }) {
  const functional = useMemo(() => issues.filter((i) => i.category === "functional"), [issues]);
  const { rules, buckets } = useMemo(() => bucketFunctionalIssues(functional), [functional]);

  const groups = rules.map((r) => ({ ...r, items: buckets[r.key] }));
  if (buckets.other.length) groups.push({ key: "other", label: "Other", items: buckets.other });

  if (!functional.length) {
    return (
      <section aria-labelledby="functional-heading">
        <h2 id="functional-heading" className="mb-4 text-base font-semibold text-gray-900">Functional UI</h2>
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No functional findings — either the site passed every check, or functional checks were not run for this analysis.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="functional-heading">
      <h2 id="functional-heading" className="mb-4 text-base font-semibold text-gray-900">
        Functional UI <span className="text-sm font-normal text-gray-500">({functional.length})</span>
      </h2>
      <IssueBucketGrid groups={groups} />
    </section>
  );
}
