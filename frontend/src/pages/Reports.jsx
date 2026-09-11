import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import TopBar from "../layout/TopBar.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import SearchInput from "../components/ui/SearchInput.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "../components/ui/Table.jsx";
import { listRuns, clearRuns, deleteRun } from "../services/runHistory.js";
import { downloadReportPdf } from "../utils/reportPdf.js";

const TARGET_LABELS = {
  "standard-web": "Standard Web", powerbi: "Power BI", unknown: "Unknown",
};
const FILTERS = [
  { key: "all", label: "All Target Types" },
  { key: "standard-web", label: "Standard Web" },
  { key: "powerbi", label: "Power BI" },
];
const PAGE_SIZE = 10;

function scoreTone(score) {
  if (score == null) return "text-gray-500";
  if (score >= 90) return "text-green-600";
  if (score >= 75) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

export default function Reports() {
  const { openMobileNav } = useOutletContext() ?? {};
  const [runs, setRuns] = useState(() => listRuns());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    let rows = runs;
    if (filter !== "all") rows = rows.filter((r) => r.targetType === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((r) => r.id.toLowerCase().includes(q) || r.url?.toLowerCase().includes(q) || r.targetType?.toLowerCase().includes(q));
    }
    return rows;
  }, [runs, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Keep the current page in range when a filter/search/delete shrinks the result set.
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Status messages are transient confirmations for clipboard/download/delete
  // actions that would otherwise complete silently.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const summary = useMemo(() => {
    const scored = runs.filter((r) => typeof r.overall === "number");
    const avg = scored.length ? scored.reduce((s, r) => s + r.overall, 0) / scored.length : null;
    const criticalCount = runs.reduce((s, r) => s + (r.bySeverity?.critical ?? 0), 0);
    const avgMs = runs.length ? runs.reduce((s, r) => s + (r.elapsedMs ?? 0), 0) / runs.length : null;
    const targetTypes = new Set(runs.map((r) => r.targetType).filter(Boolean));
    return { total: runs.length, avg, criticalCount, avgMs, targetTypeCount: targetTypes.size };
  }, [runs]);

  function handleClear() {
    if (!window.confirm(`Delete all ${runs.length} local run${runs.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    clearRuns();
    setRuns([]);
    setStatus("Local history cleared.");
  }

  function handleDelete(id) {
    deleteRun(id);
    setRuns((prev) => prev.filter((r) => r.id !== id));
    setStatus("Run deleted.");
  }

  function handleDownloadPdf(entry) {
    const opened = downloadReportPdf(entry);
    setStatus(opened ? "Opening print dialog — choose \"Save as PDF\" to download." : "Popup blocked — allow popups for this site to download the PDF.");
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(runs.map((r) => r.report), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quality-agent-reports-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${runs.length} report${runs.length === 1 ? "" : "s"} as JSON.`);
  }

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg border border-brand-100 bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-lg transition-opacity ${
          status ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {status}
      </div>

      <TopBar
        onMenuClick={openMobileNav}
        left={<SearchInput value={query} onChange={(v) => { setQuery(v); setPage(0); }} placeholder="Search by Run ID, Target URL, or App Type…" className="max-w-md" />}
        right={
          <>
            <Button variant="secondary" size="sm" onClick={exportAll} disabled={!runs.length}>Bulk Export (JSON)</Button>
          </>
        }
      />

      <main className="w-full space-y-6 px-4 py-6 sm:px-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit History &amp; Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            Local history of runs completed in this browser. There's no shared/server-side run store yet — see{" "}
            <a href="#local-history-note" className="underline decoration-gray-300">note below</a>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-gray-500">Total Validations</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{summary.total}</p>
            <p className="mt-1 text-xs text-gray-500">Across {summary.targetTypeCount} target types{summary.targetTypeCount === 1 ? "" : "s"}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500">Avg. Quality Score</p>
            <p className={`mt-1 text-2xl font-bold ${scoreTone(summary.avg)}`}>{summary.avg != null ? summary.avg.toFixed(1) : "—"}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500">Critical Issues Found</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{summary.criticalCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-gray-500">Avg. Execution Time</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{summary.avgMs != null ? `${(summary.avgMs / 1000).toFixed(1)}s` : "—"}</p>
            <p className="mt-1 text-xs text-gray-500">Python Engine + LLM</p>
          </Card>
        </div>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by target type">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => { setFilter(f.key); setPage(0); }}
                  aria-pressed={filter === f.key}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                    filter === f.key ? "border-brand-600 bg-brand-600 text-white" : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {runs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClear}>Clear local history</Button>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={runs.length === 0 ? "No runs yet" : "No runs match this filter"}
              description={runs.length === 0 ? "Run an analysis from New Audit Run — it'll show up here automatically." : "Try a different target type or search term."}
            />
          ) : (
            <>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Timestamp</TableHeaderCell>
                    <TableHeaderCell>Target URL &amp; Type</TableHeaderCell>
                    <TableHeaderCell>Scores Summary</TableHeaderCell>
                    <TableHeaderCell>Findings</TableHeaderCell>
                    <TableHeaderCell>Analysis Status</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(r.timestamp).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge color="blue">{TARGET_LABELS[r.targetType] ?? r.targetType ?? "Unknown"}</Badge>
                        <p className="mt-1 max-w-xs truncate text-xs text-gray-500">{r.url}</p>
                      </TableCell>
                      <TableCell>
                        <span className={`font-semibold ${scoreTone(r.overall)}`}>{r.overall ?? "—"} Overall</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge color={r.bySeverity?.critical ? "red" : "gray"}>{r.bySeverity?.critical ?? 0} Critical</Badge>
                          <Badge color="gray">{r.findingCount} total</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge color={r.partial ? "amber" : "green"}>{r.partial ? "Partial" : "Completed"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleDownloadPdf(r)}
                            aria-label={`Download report for ${r.url}`}
                          >
                            Download
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(r.id)}
                            aria-label={`Delete run for ${r.url}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                <span>
                  Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} results
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </Card>

        <p id="local-history-note" className="text-xs text-gray-500">
          These runs are stored in this browser's local storage only (up to the 50 most recent) — there is no backend
          persistence layer yet, so history isn't shared across devices or browsers.
        </p>
      </main>
    </>
  );
}
