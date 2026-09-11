import React from "react";
import Badge from "../ui/Badge.jsx";

const STATE = {
  idle:    { color: "gray",  label: "Idle",    description: "Ready for target profile & validation parameters" },
  running: { color: "blue",  label: "Running", description: "Executing the LangGraph validation pipeline…" },
  done:    { color: "green", label: "Done",    description: "Validation run complete" },
  error:   { color: "red",   label: "Error",   description: "The last run failed to complete" },
};

/**
 * Reflects the real, live state of this page's analysis request — never a
 * hardcoded status. `state`: idle|running|done|error.
 */
export default function PipelineStatusBadge({ state = "idle" }) {
  const s = STATE[state] ?? STATE.idle;
  return (
    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
      <Badge color={s.color}>Analysis: {s.label}</Badge>
      <span className="truncate text-sm text-gray-500 hidden sm:block">{s.description}</span>
    </div>
  );
}
