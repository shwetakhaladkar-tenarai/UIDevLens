import React from "react";
import Badge from "./Badge.jsx";

/**
 * Semantic status pill — maps known status vocabularies (finding severities,
 * pipeline/run states, pass-fail) to a consistent color + label so callers
 * don't each invent their own mapping.
 */
const STATUS_MAP = {
  // Finding severities
  critical: { color: "red",    label: "Critical" },
  high:     { color: "amber",  label: "High" },
  medium:   { color: "amber",  label: "Medium" },
  low:      { color: "blue",   label: "Low" },
  info:     { color: "gray",   label: "Info" },
  // Pipeline / run states
  idle:      { color: "gray",  label: "Idle" },
  running:   { color: "blue",  label: "Running" },
  completed: { color: "green", label: "Completed" },
  success:   { color: "green", label: "Success" },
  partial:   { color: "amber", label: "Partial" },
  failed:    { color: "red",   label: "Failed" },
  error:     { color: "red",   label: "Error" },
  // Check-level outcomes
  pass:      { color: "green", label: "Pass" },
  issues:    { color: "amber", label: "Issues" },
  "not-run": { color: "gray",  label: "Not Run" },
};

export default function StatusBadge({ status, label, className = "" }) {
  const key = String(status ?? "").toLowerCase();
  const mapped = STATUS_MAP[key] ?? { color: "gray", label: label ?? status ?? "Unknown" };
  return (
    <Badge color={mapped.color} className={className}>
      {label ?? mapped.label}
    </Badge>
  );
}
