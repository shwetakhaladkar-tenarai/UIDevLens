import React from "react";
import Badge from "./ui/Badge.jsx";

const SEVERITY_COLOR = {
  critical: "red",
  high:     "amber",
  medium:   "amber",
  low:      "blue",
  info:     "gray",
};
const SEVERITY_LABEL = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info",
};

/** Small pill for a finding's severity — shared across the panel components. */
export default function SeverityBadge({ severity }) {
  return (
    <Badge color={SEVERITY_COLOR[severity] ?? "gray"}>
      {SEVERITY_LABEL[severity] ?? "Info"}
    </Badge>
  );
}
