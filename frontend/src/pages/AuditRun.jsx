import React, { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { useAuditRun } from "../state/AuditRunContext.jsx";

import TopBar from "../layout/TopBar.jsx";
import Card from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import Tabs from "../components/ui/Tabs.jsx";
import SectionHeader from "../components/ui/SectionHeader.jsx";
import ErrorState from "../components/ui/ErrorState.jsx";
import PipelineStatusBadge from "../components/audit/PipelineStatusBadge.jsx";
import TargetProfilerPills from "../components/audit/TargetProfilerPills.jsx";
import ValidationMatrixCards from "../components/audit/ValidationMatrixCards.jsx";

import UrlInput          from "../components/UrlInput.jsx";
import AnalysisLoading   from "../components/AnalysisLoading.jsx";
import ApplicationProfile from "../components/ApplicationProfile.jsx";
import ScoreOverview     from "../components/ScoreOverview.jsx";
import FunctionalPanel   from "../components/FunctionalPanel.jsx";
import AccessibilityPanel from "../components/AccessibilityPanel.jsx";
import ResponsiveMatrix  from "../components/ResponsiveMatrix.jsx";
import CrossBrowserFindings from "../components/CrossBrowserFindings.jsx";
import PerformancePanel  from "../components/PerformancePanel.jsx";
import UiConsistencyPanel from "../components/UiConsistencyPanel.jsx";
import AiInsightsPanel   from "../components/AiInsightsPanel.jsx";
import IssuesTable       from "../components/IssuesTable.jsx";

const REPORT_TABS = [
  { id: "overview",       label: "Overview" },
  { id: "functional",     label: "Functional" },
  { id: "accessibility",  label: "Accessibility / WCAG" },
  { id: "responsive",     label: "Responsive" },
  { id: "cross-browser",  label: "Cross-Browser" },
  { id: "performance",    label: "Performance" },
  { id: "ui-consistency", label: "UI Consistency" },
  { id: "findings",       label: "Findings" },
  { id: "ai-insights",    label: "AI Insights" },
];

export default function AuditRun() {
  const { openMobileNav } = useOutletContext() ?? {};
  const { urlValue, setUrlValue, report, analyzing, error, pendingUrl, handleAnalyze, resetAll, setError } = useAuditRun();
  const [activeTab, setActiveTab] = useState("overview");
  const tabsRef = useRef(null);

  const pipelineState = analyzing ? "running" : error ? "error" : report ? "done" : "idle";

  // Land back on Overview and scroll the tab strip into view whenever a
  // different run completes, rather than staying on a stale/empty tab.
  useEffect(() => {
    if (report) setActiveTab("overview");
  }, [report?.analysisId]);

  function selectTab(id) {
    setActiveTab(id);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function copyJson() {
    if (!report) return;
    navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
  }

  const validationPlan = report?.metadata?.validationPlan ?? {};
  const warnings = report?.metadata?.warnings ?? [];
  const durationS = report?.metadata?.analysisDurationMs != null
    ? (report.metadata.analysisDurationMs / 1000).toFixed(1)
    : null;

  const tabBadges = useMemo(() => {
    const issues = report?.issues ?? [];
    const count = (pred) => issues.filter(pred).length;
    return {
      functional:     count((i) => i.category === "functional"),
      accessibility:  count((i) => i.category === "accessibility"),
      responsive:     count((i) => i.category === "responsive"),
      "cross-browser": count((i) => i.category === "cross-browser"),
      "ui-consistency": count((i) => i.category === "design" || i.category === "ui-consistency"),
      findings:       issues.length,
    };
  }, [report]);

  const tabsWithBadges = REPORT_TABS.map((t) => ({ ...t, badge: tabBadges[t.id] }));

  return (
    <>
      <TopBar
        onMenuClick={openMobileNav}
        left={<PipelineStatusBadge state={pipelineState} />}
        right={
          <>
            <Link to="/rule-profiles">
              <Button variant="secondary" size="sm">Load Preset Rules</Button>
            </Link>
            {/* Same slot, state-aware: nothing to reset while idle (the
                Run button lives inline next to the URL field instead —
                see section 01 below); once a run has started or finished,
                this becomes Cancel / Reset in place of a duplicate button. */}
            {analyzing ? (
              <Button variant="danger" size="sm" onClick={resetAll}>✕ Cancel Run</Button>
            ) : (report || error) ? (
              <Button variant="primary" size="sm" onClick={resetAll}>↺ Reset</Button>
            ) : null}
          </>
        }
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* 01 — Target Application Profiler & Configuration */}
        <Card as="section" aria-labelledby="target-heading" className="p-5">
          <SectionHeader
            id="target-heading"
            step="01"
            title="Target Application Profiler & Configuration"
            status={report && <Badge color="green">Analysis Complete</Badge>}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Target Application URL</p>
              <UrlInput value={urlValue} onValueChange={setUrlValue} onAnalyze={handleAnalyze} analyzing={analyzing} />
            </div>
            <TargetProfilerPills detectedType={report?.applicationProfile?.targetType} />
          </div>
        </Card>

        {/* 02 — Rule Profile & Validation Matrix */}
        <Card as="section" aria-labelledby="matrix-heading" className="p-5">
          <SectionHeader
            id="matrix-heading"
            step="02"
            title="Rule Profile Selector & Validation Matrix"
            status={<Badge color="blue">Python Validation Engine</Badge>}
          />
          <ValidationMatrixCards checks={validationPlan.checks} />
        </Card>

        {/* Execution states */}
        {analyzing && (
          <Card className="p-5">
            <AnalysisLoading url={pendingUrl} />
          </Card>
        )}

        {error && !analyzing && (
          <ErrorState message={error} onRetry={() => setError("")} />
        )}

        {report && !analyzing && (
          <>
            {/* Run metadata bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
              <div className="min-w-0">
                <a href={report.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-brand-600 underline decoration-brand-400/40 underline-offset-2 hover:text-brand-700">
                  {report.url}
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {report.timestamp && <span>{new Date(report.timestamp).toLocaleString()}</span>}
                {durationS && <span>Completed in {durationS}s</span>}
                {report.metadata?.partial && (
                  <span className="font-medium text-amber-600"><span aria-hidden="true">⚠</span> Partial report</span>
                )}
              </div>
            </div>

            {/* Each category gets its own tab/page instead of one long
                scroll — see REPORT_TABS above. */}
            <div ref={tabsRef}>
              <Tabs tabs={tabsWithBadges} active={activeTab} onChange={selectTab} className="mb-6" />
            </div>

            {activeTab === "overview" && (
              <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" tabIndex={0} className="space-y-6">
                <ApplicationProfile applicationProfile={report.applicationProfile} />

                <Card as="section" aria-labelledby="scores-panel-heading" className="p-5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Final Report &amp; JSON Payload Exporter</span>
                    <Button variant="secondary" size="sm" onClick={copyJson}>Copy Raw JSON</Button>
                  </div>
                  <ScoreOverview scores={report.scores} />
                </Card>

                {warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="mb-2 text-sm font-medium text-amber-800">Analysis warnings</p>
                    {warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-700">{w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "functional" && (
              <Card role="tabpanel" id="panel-functional" aria-labelledby="tab-functional" tabIndex={0} className="p-5">
                <FunctionalPanel issues={report.issues} />
              </Card>
            )}

            {activeTab === "accessibility" && (
              <Card role="tabpanel" id="panel-accessibility" aria-labelledby="tab-accessibility" tabIndex={0} className="p-5">
                <AccessibilityPanel
                  issues={report.issues}
                  accessibilityMeta={report.metadata?.accessibility}
                  accessibilitySummary={report.accessibilitySummary}
                />
              </Card>
            )}

            {activeTab === "responsive" && (
              <Card role="tabpanel" id="panel-responsive" aria-labelledby="tab-responsive" tabIndex={0} className="p-5">
                <ResponsiveMatrix issues={report.issues} validationPlan={validationPlan} />
              </Card>
            )}

            {activeTab === "cross-browser" && (
              <Card role="tabpanel" id="panel-cross-browser" aria-labelledby="tab-cross-browser" tabIndex={0} className="p-5">
                <CrossBrowserFindings issues={report.issues} crossBrowserSummary={report.crossBrowserSummary} />
              </Card>
            )}

            {activeTab === "performance" && (
              <Card role="tabpanel" id="panel-performance" aria-labelledby="tab-performance" tabIndex={0} className="p-5">
                <PerformancePanel metrics={report.metrics} loadTest={report.metadata?.loadTest} performanceSummary={report.performanceSummary} />
              </Card>
            )}

            {activeTab === "ui-consistency" && (
              <Card role="tabpanel" id="panel-ui-consistency" aria-labelledby="tab-ui-consistency" tabIndex={0} className="p-5">
                <UiConsistencyPanel issues={report.issues} />
              </Card>
            )}

            {activeTab === "findings" && (
              <Card as="section" role="tabpanel" id="panel-findings" aria-labelledby="tab-findings" tabIndex={0} className="p-5">
                <SectionHeader
                  title="Normalized Findings"
                  status={<Badge color="amber">{report.issues?.length ?? 0} Findings</Badge>}
                />
                <IssuesTable issues={report.issues} counts={report.metadata?.counts?.bySeverity} />
              </Card>
            )}

            {activeTab === "ai-insights" && (
              <Card as="section" role="tabpanel" id="panel-ai-insights" aria-labelledby="tab-ai-insights" tabIndex={0} className="p-5">
                <AiInsightsPanel
                  executiveSummary={report.executiveSummary}
                  majorRisks={report.majorRisks}
                  issues={report.issues}
                  quickWins={report.quickWins}
                  recommendations={report.recommendations}
                  aiMeta={report.metadata?.aiAnalysis}
                />
              </Card>
            )}
          </>
        )}
      </main>
    </>
  );
}
