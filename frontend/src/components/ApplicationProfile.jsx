import React from "react";
import Card from "./ui/Card.jsx";

const TARGET_LABELS = {
  "standard-web": "Standard Web",
  powerbi:        "Power BI",
  unknown:        "Unknown",
};

/**
 * Application Profile: the deterministic target classification
 * (applicationProfilerNode) and the rule profile it selected
 * (ruleProfileNode) — never AI-derived. See report.applicationProfile.
 */
export default function ApplicationProfile({ applicationProfile = {} }) {
  const { targetType, confidence, ruleProfileId, ruleProfileDescription } = applicationProfile;
  if (!targetType && !ruleProfileId) return null;

  const confidencePct = typeof confidence === "number" ? Math.round(confidence * 100) : null;

  return (
    <Card as="section" aria-labelledby="app-profile-heading" className="p-5">
      <h2 id="app-profile-heading" className="mb-4 text-base font-semibold text-gray-900">
        Application Profile
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Detected Type</p>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {TARGET_LABELS[targetType] ?? targetType ?? "Unknown"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Rule Profile</p>
          <p className="mt-1 text-sm font-medium text-gray-900">{ruleProfileId ?? "n/a"}</p>
          {ruleProfileDescription && (
            <p className="mt-0.5 text-xs text-gray-500">{ruleProfileDescription}</p>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Confidence</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${confidencePct ?? 0}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-900">
              {confidencePct != null ? `${confidencePct}%` : "n/a"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
