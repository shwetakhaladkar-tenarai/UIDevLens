import React, { useEffect, useRef, useState } from "react";
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

import UrlInput           from "../components/UrlInput.jsx";
import AnalysisLoading    from "../components/AnalysisLoading.jsx";
import ApplicationProfile from "../components/ApplicationProfile.jsx";
import ScoreOverview      from "../components/ScoreOverview.jsx";
import FunctionalPanel    from "../components/FunctionalPanel.jsx";
import AccessibilityPanel from "../components/AccessibilityPanel.jsx";
import ResponsiveMatrix   from "../components/ResponsiveMatrix.jsx";
import CrossBrowserFindings from "../components/CrossBrowserFindings.jsx";
import PerformancePanel   from "../components/PerformancePanel.jsx";
import UiConsistencyPanel from "../components/UiConsistencyPanel.jsx";
import AiInsightsPanel    from "../components/AiInsightsPanel.jsx";
import IssuesTable        from "../components/IssuesTable.jsx";

// Only two top-level tabs — Overview (with inline category panels) and AI Insights.
const REPORT_TABS = [
  { id: "overview",    label: "Overview" },
  { id: "ai-insights", label: "AI Insights" },
];

// Maps each score card key to the panel id rendered below the score cards.
const CATEGORY_PANELS = [
  { id: "functional",    label: "Functional UI" },
  { id: "accessibility", label: "Accessibility / WCAG" },
  { id: "responsive",    label: "Responsiveness" },
  { id: "cross-browser", label: "Cross-Browser" },
  { id: "performance",   label: "Performance" },
  { id: "ui-consistency",label: "UI Consistency" },
  { id: "findings",      label: "Findings" },
];

/** Chevron icon that rotates when open. */
function ChevronIcon({ open }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

/** Collapsible section wrapping each category detail panel. */
function CategorySection({ id, label, badge, open, onToggle, children, panelRef }) {
  return (
    <div ref={panelRef} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`category-panel-${id}`}
        id={`category-trigger-${id}`}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {badge}
            </span>
          )}
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          id={`category-panel-${id}`}
          role="region"
          aria-labelledby={`category-trigger-${id}`}
          className="border-t border-gray-100 p-5"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export default function AuditRun() {
  const { openMobileNav } = useOutletContext() ?? {};
  const { urlValue, setUrlValue, report, analyzing, error, pendingUrl, handleAnalyze, resetAll, setError } = useAuditRun();

  const [activeTab, setActiveTab]       = useState("overview");
  const [activePanel, setActivePanel]   = useState(null); // which category panel is open
  const tabsRef    = useRef(null);
  const panelRefs  = useRef({}); // keyed by panel id
  const loadingRef = useRef(null); // scroll target when analysis starts

  const pipelineState = analyzing ? "running" : error ? "error" : report ? "done" : "idle";

  // Scroll the loading card into view just below the topbar when analysis starts.
  useEffect(() => {
    if (analyzing && loadingRef.current) {
      const topbarHeight = 64; // h-16
      const top = loadingRef.current.getBoundingClientRect().top + window.scrollY - topbarHeight - 16;
      window.scrollTo({ top, behavior: "smooth" });
    }
  }, [analyzing]);

  // Reset to overview whenever a new run completes.
  useEffect(() => {
    if (report) {
      setActiveTab("overview");
      setActivePanel(null);
    }
  }, [report?.analysisId]);

  function selectTab(id) {
    setActiveTab(id);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Toggle a category panel open/closed; scroll it into view when opening. */
  function handleCategoryClick(panelId) {
    setActivePanel((prev) => {
      const next = prev === panelId ? null : panelId;
      if (next) {
        // Scroll after state update / paint
        setTimeout(() => {
          panelRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      }
      return next;
    });
  }

  function copyJson() {
    if (!report) return;
    navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
  }

  const validationPlan = report?.metadata?.validationPlan ?? {};
  const warnings       = report?.metadata?.warnings ?? [];
  const durationS      = report?.metadata?.analysisDurationMs != null
    ? (report.metadata.analysisDurationMs / 1000).toFixed(1)
    : null;

  // Issue counts per category for the accordion badge labels.
  const issueCounts = (() => {
    const issues = report?.issues ?? [];
    return {
      functional:      issues.filter((i) => i.category === "functional").length,
      accessibility:   issues.filter((i) => i.category === "accessibility").length,
      responsive:      issues.filter((i) => i.category === "responsive").length,
      "cross-browser": issues.filter((i) => i.category === "cross-browser").length,
      performance:     issues.filter((i) => i.category === "performance").length,
      "ui-consistency":issues.filter((i) => i.category === "design" || i.category === "ui-consistency").length,
      findings:        issues.length,
    };
  })();

  return (
    <>
      <TopBar
        onMenuClick={openMobileNav}
        left={<PipelineStatusBadge state={pipelineState} />}
        right={
          <>
            {analyzing ? (
              <Button variant="danger" size="sm" onClick={resetAll}>✕ Cancel Run</Button>
            ) : (report || error) ? (
              <Button variant="secondary" size="sm" onClick={resetAll}>↺ Reset</Button>
            ) : null}
          </>
        }
      />

      <main className="w-full space-y-6 px-4 py-6 sm:px-8">
        {/* Dashboard header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Run an automated AI quality check across your web app or embedded dashboard. Select your
            target profile below to test functionality, accessibility, cross-browser responsiveness,
            performance, and design consistency in seconds.
          </p>
        </div>

        {/* 01 — Target Application Profiler & Configuration */}
        <Card as="section" aria-labelledby="target-heading" className="p-5">
          <SectionHeader
            id="target-heading"
            step="01"
            title="Choose Target Application & Test Parameters"
          />
          <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Target Application URL</p>
              <UrlInput value={urlValue} onValueChange={setUrlValue} onAnalyze={handleAnalyze} analyzing={analyzing} />
            </div>
            <TargetProfilerPills detectedType={report?.applicationProfile?.targetType} />
          </div>
        </Card>

        {/* Execution states */}
        {analyzing && (
          <Card ref={loadingRef} className="p-5">
            <AnalysisLoading url={pendingUrl} />
          </Card>
        )}

        {/* 02 — Rule Profile & Validation Matrix */}
        {!analyzing && (
          <Card as="section" aria-labelledby="matrix-heading" className="p-5">
            <SectionHeader
              id="matrix-heading"
              step="02"
              title="Validation Rules & Matrix"
              action={
                <Link
                  to="/rule-manager"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
                    <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5Z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Edit Rule
                </Link>
              }
            />
            <ValidationMatrixCards checks={validationPlan.checks} />
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

            {/* Tab strip — Overview & AI Insights only */}
            <div ref={tabsRef}>
              <Tabs tabs={REPORT_TABS} active={activeTab} onChange={selectTab} className="mb-6" />
            </div>

            {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
            {activeTab === "overview" && (
              <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" tabIndex={0} className="space-y-6">

                <ApplicationProfile applicationProfile={report.applicationProfile} />

                {/* Score cards + radar */}
                <Card as="section" aria-labelledby="scores-panel-heading" className="p-5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Final Report &amp; JSON Payload Exporter</span>
                    <Button variant="secondary" size="sm" onClick={copyJson}>Copy Raw JSON</Button>
                  </div>
                  <ScoreOverview
                    scores={report.scores}
                    activePanel={activePanel}
                    onCategoryClick={handleCategoryClick}
                  />
                </Card>

                {/* ── Category detail panels (accordion) ───────────────── */}
                <div className="space-y-3">
                  <CategorySection
                    id="functional"
                    label="Functional UI"
                    badge={issueCounts.functional}
                    open={activePanel === "functional"}
                    onToggle={() => handleCategoryClick("functional")}
                    panelRef={(el) => (panelRefs.current["functional"] = el)}
                  >
                    <FunctionalPanel issues={report.issues} />
                  </CategorySection>

                  <CategorySection
                    id="accessibility"
                    label="Accessibility / WCAG"
                    badge={issueCounts.accessibility}
                    open={activePanel === "accessibility"}
                    onToggle={() => handleCategoryClick("accessibility")}
                    panelRef={(el) => (panelRefs.current["accessibility"] = el)}
                  >
                    <AccessibilityPanel
                      issues={report.issues}
                      accessibilityMeta={report.metadata?.accessibility}
                      accessibilitySummary={report.accessibilitySummary}
                    />
                  </CategorySection>

                  <CategorySection
                    id="responsive"
                    label="Responsiveness"
                    badge={issueCounts.responsive}
                    open={activePanel === "responsive"}
                    onToggle={() => handleCategoryClick("responsive")}
                    panelRef={(el) => (panelRefs.current["responsive"] = el)}
                  >
                    <ResponsiveMatrix issues={report.issues} validationPlan={validationPlan} />
                  </CategorySection>

                  <CategorySection
                    id="cross-browser"
                    label="Cross-Browser"
                    badge={issueCounts["cross-browser"]}
                    open={activePanel === "cross-browser"}
                    onToggle={() => handleCategoryClick("cross-browser")}
                    panelRef={(el) => (panelRefs.current["cross-browser"] = el)}
                  >
                    <CrossBrowserFindings issues={report.issues} crossBrowserSummary={report.crossBrowserSummary} />
                  </CategorySection>

                  <CategorySection
                    id="performance"
                    label="Performance"
                    badge={issueCounts.performance}
                    open={activePanel === "performance"}
                    onToggle={() => handleCategoryClick("performance")}
                    panelRef={(el) => (panelRefs.current["performance"] = el)}
                  >
                    <PerformancePanel
                      metrics={report.metrics}
                      loadTest={report.metadata?.loadTest}
                      performanceSummary={report.performanceSummary}
                    />
                  </CategorySection>

                  <CategorySection
                    id="ui-consistency"
                    label="UI Consistency"
                    badge={issueCounts["ui-consistency"]}
                    open={activePanel === "ui-consistency"}
                    onToggle={() => handleCategoryClick("ui-consistency")}
                    panelRef={(el) => (panelRefs.current["ui-consistency"] = el)}
                  >
                    <UiConsistencyPanel issues={report.issues} />
                  </CategorySection>

                  <CategorySection
                    id="findings"
                    label="Findings"
                    badge={issueCounts.findings}
                    open={activePanel === "findings"}
                    onToggle={() => handleCategoryClick("findings")}
                    panelRef={(el) => (panelRefs.current["findings"] = el)}
                  >
                    <SectionHeader
                      title="Normalized Findings"
                      status={<Badge color="amber">{report.issues?.length ?? 0} Findings</Badge>}
                    />
                    <IssuesTable issues={report.issues} counts={report.metadata?.counts?.bySeverity} />
                  </CategorySection>
                </div>

                {/* Warnings hidden */}
              </div>
            )}

            {/* ── AI INSIGHTS TAB ──────────────────────────────────────── */}
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
