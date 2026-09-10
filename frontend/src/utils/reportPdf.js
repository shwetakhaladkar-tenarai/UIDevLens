/**
 * reportPdf.js
 * Renders one saved run as a print-ready HTML document and hands it to the
 * browser's native print dialog ("Save as PDF" is a print destination in
 * every modern browser) — no PDF library needed, and the output is a real
 * PDF of the real report data, not a mock.
 */

const SEVERITY_LABEL = { critical: "Critical", major: "Major", minor: "Minor", info: "Info" };
const CATEGORY_LABEL = {
  overall: "Overall", functional: "Functional", accessibility: "Accessibility",
  responsive: "Responsive", crossBrowser: "Cross-Browser", performance: "Performance",
  uiConsistency: "UI Consistency",
};
const TARGET_LABEL = { "standard-web": "Standard Web", powerbi: "Power BI", unknown: "Unknown" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function scoreCell(value) {
  if (value && typeof value === "object" && value.status === "not-run") return "Not Run";
  if (typeof value === "number") return value;
  return "—";
}

function issueRows(issues) {
  if (!Array.isArray(issues) || !issues.length) {
    return `<tr><td colspan="4" class="muted">No findings recorded.</td></tr>`;
  }
  return issues.map((issue) => `
    <tr>
      <td>${esc(SEVERITY_LABEL[issue.severity] ?? issue.severity ?? "—")}</td>
      <td>${esc(issue.category ?? "—")}</td>
      <td>
        <strong>${esc(issue.title ?? "Untitled finding")}</strong>
        ${issue.description ? `<div class="muted">${esc(issue.description)}</div>` : ""}
      </td>
      <td>${esc(issue.recommendation ?? issue.ai?.recommendation ?? "—")}</td>
    </tr>
  `).join("");
}

function listItems(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function buildHtml(entry) {
  const report = entry.report ?? {};
  const scores = report.scores ?? {};
  const profile = report.applicationProfile ?? {};
  const generated = new Date().toLocaleString();
  const runDate = new Date(entry.timestamp).toLocaleString();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Quality Agent Report — ${esc(entry.url)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #374151; margin: 22px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 11px; margin: 0 0 16px; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 6px; }
  .meta div { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .meta p:first-child { font-size: 10px; text-transform: uppercase; color: #6b7280; margin: 0 0 2px; }
  .meta p:last-child { font-size: 13px; font-weight: 600; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 6px 8px; border: 1px solid #e5e7eb; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  tr { page-break-inside: avoid; }
  .muted { color: #6b7280; font-size: 10.5px; }
  .scores-table td { text-align: center; font-weight: 600; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 10.5px; font-weight: 600; }
  .badge.partial { background: #fef3c7; color: #92400e; }
  .badge.complete { background: #d1fae5; color: #065f46; }
  ul { margin: 4px 0 0; padding-left: 18px; font-size: 11px; }
  @media print { a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
  <h1>Quality Agent — Validation Report</h1>
  <p class="subtitle">${esc(entry.url)} &middot; generated ${esc(generated)}</p>

  <div class="meta">
    <div><p>Run Timestamp</p><p>${esc(runDate)}</p></div>
    <div><p>Target Type</p><p>${esc(TARGET_LABEL[profile.targetType ?? entry.targetType] ?? profile.targetType ?? entry.targetType ?? "Unknown")}</p></div>
    <div><p>Rule Profile</p><p>${esc(profile.ruleProfileId ?? entry.ruleProfileId ?? "n/a")}</p></div>
    <div><p>Execution Time</p><p>${entry.elapsedMs != null ? `${(entry.elapsedMs / 1000).toFixed(1)}s` : "—"}</p></div>
    <div><p>Pipeline Status</p><p><span class="badge ${entry.partial ? "partial" : "complete"}">${entry.partial ? "Partial" : "Completed"}</span></p></div>
    <div><p>Analysis ID</p><p>${esc(entry.id)}</p></div>
  </div>

  <h2>Scores</h2>
  <table class="scores-table">
    <tr>${Object.keys(CATEGORY_LABEL).map((k) => `<th>${CATEGORY_LABEL[k]}</th>`).join("")}</tr>
    <tr>${Object.keys(CATEGORY_LABEL).map((k) => `<td>${scoreCell(scores[k])}</td>`).join("")}</tr>
  </table>

  ${report.executiveSummary ? `<h2>Executive Summary</h2><p>${esc(report.executiveSummary)}</p>` : ""}
  ${Array.isArray(report.majorRisks) && report.majorRisks.length ? `<h2>Major Risks</h2>${listItems(report.majorRisks)}` : ""}

  <h2>Findings (${report.issues?.length ?? entry.findingCount ?? 0})</h2>
  <table>
    <thead><tr><th>Severity</th><th>Category</th><th>Finding</th><th>Recommendation</th></tr></thead>
    <tbody>${issueRows(report.issues)}</tbody>
  </table>

  ${Array.isArray(report.quickWins) && report.quickWins.length ? `<h2>Quick Wins</h2>${listItems(report.quickWins)}` : ""}
  ${Array.isArray(report.metadata?.warnings) && report.metadata.warnings.length ? `<h2>Warnings</h2>${listItems(report.metadata.warnings)}` : ""}
</body>
</html>`;
}

/**
 * Opens a print-ready view of the report and invokes the browser's print
 * dialog, where "Save as PDF" produces a real PDF file. Returns false if the
 * popup was blocked so callers can show a fallback message.
 */
export function downloadReportPdf(entry) {
  // No "noopener" here: per spec, window.open() with noopener always returns
  // null, which would leave us with no reference to write the report into.
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(buildHtml(entry));
  win.document.close();
  win.focus();
  win.onafterprint = () => win.close();
  win.print();
  return true;
}
