/**
 * lighthouseAnalyzer.js
 * Runs a real Lighthouse 13 audit and converts results to normalised findings.
 *
 * Collected metrics:
 *   performance score, FCP, LCP, CLS, TBT, Speed Index, TTI, INP (if available)
 *   total bytes, JS bytes, CSS bytes, image bytes, request count
 *   render-blocking resources, unused JS, unused CSS
 *   image optimisation opportunities, lazy-loading opportunities
 *
 * All thresholds are deterministic — no AI involved in pass/fail decisions.
 *
 * Thresholds (source: web.dev / Chrome team guidance):
 *   LCP  : ≤2500 good | 2501–4000 warning | >4000 poor
 *   FCP  : ≤1800 good | 1801–3000 warning | >3000 poor
 *   TBT  : ≤200  good | 201–600   warning | >600  poor
 *   CLS  : ≤0.1  good | 0.11–0.25 warning | >0.25 poor
 *   SI   : ≤3400 good | 3401–5800 warning | >5800 poor
 *   TTI  : ≤3800 good | 3801–7300 warning | >7300 poor
 *   Score: ≥0.90 good | 0.50–0.89 warning | <0.50 poor
 */

import { launch }    from "chrome-launcher";
import lighthouse    from "lighthouse";
import { chromium }  from "playwright";
import { logger }    from "../utils/logger.js";

// ── Thresholds ────────────────────────────────────────────────────────────────

const T = {
  lcp:   { good: 2500,  warn: 4000  },   // ms
  fcp:   { good: 1800,  warn: 3000  },   // ms
  tbt:   { good: 200,   warn: 600   },   // ms
  cls:   { good: 0.1,   warn: 0.25  },   // unitless
  si:    { good: 3400,  warn: 5800  },   // ms
  tti:   { good: 3800,  warn: 7300  },   // ms
  score: { good: 0.90,  warn: 0.50  },   // 0–1
  // Resource budget thresholds
  totalBytes:    { warn: 1_600_000, poor: 4_000_000 }, // bytes
  jsBytes:       { warn:   300_000, poor:   800_000 },
  cssBytes:      { warn:    60_000, poor:   150_000 },
  imageBytes:    { warn:   500_000, poor: 1_500_000 },
  unusedJsMs:    { warn:    20_000                  }, // savings ms
  unusedCssMs:   { warn:    10_000                  },
};

// ── Severity helpers ──────────────────────────────────────────────────────────

function metricSeverity(value, thresholds) {
  if (value == null) return "info";
  if (value <= thresholds.good)            return "info";     // good — no issue
  if (value <= thresholds.warn)            return "medium";   // needs attention
  return "high";                                               // poor
}

function reverseSeverity(value, thresholds) {
  // For scores: higher is better
  if (value == null) return "info";
  if (value >= thresholds.good)  return "info";
  if (value >= thresholds.warn)  return "medium";
  return "high";
}

function bytesSeverity(bytes, thresholds) {
  if (bytes == null) return "info";
  if (bytes < thresholds.warn)  return "info";
  if (bytes < thresholds.poor)  return "medium";
  return "high";
}

function fmtMs(ms)    { return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`; }
function fmtKb(bytes) { return `${(bytes / 1024).toFixed(0)} KB`; }
function fmtMb(bytes) { return `${(bytes / 1_048_576).toFixed(2)} MB`; }

// ── Finding builder ───────────────────────────────────────────────────────────

function finding({ id, severity, title, description, evidence = {}, confidence = 1 }) {
  return {
    id,
    category:   "performance",
    severity,
    title,
    description,
    evidence,
    confidence, // 0–1; 1 = directly measured
    source:     "lighthouse",
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run Lighthouse against `url` and return { metrics, findings }.
 * Falls back to empty results (not mocked) on launch/run failure.
 *
 * @param {string} url
 * @param {object} [_browserEvidence]  Unused — kept for interface compat
 * @returns {Promise<{ metrics: object, findings: Array }>}
 */
export async function runPerformanceAnalysis(url, _browserEvidence = {}) {
  logger.info("[lighthouseAnalyzer] Starting Lighthouse audit", { url });

  const execPath = chromium.executablePath();
  let   chrome   = null;

  try {
    chrome = await launch({
      chromePath:   execPath,
      chromeFlags:  [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
      logLevel: "silent",
    });

    logger.debug("[lighthouseAnalyzer] Chrome launched", { port: chrome.port });

    const runResult = await lighthouse(url, {
      port:       chrome.port,
      output:     "json",
      logLevel:   "silent",
      formFactor: "desktop",
      screenEmulation:  { disabled: true },
      throttlingMethod: "provided",
      throttling: {
        rttMs:                    0,
        throughputKbps:           0,
        cpuSlowdownMultiplier:    1,
        requestLatencyMs:         0,
        downloadThroughputKbps:   0,
        uploadThroughputKbps:     0,
      },
      disableFullPageScreenshot: true,
    });

    const lhr = runResult.lhr;
    logger.info("[lighthouseAnalyzer] Audit complete", {
      url,
      score: lhr.categories?.performance?.score,
    });

    return processLhr(lhr);

  } catch (err) {
    logger.error("[lighthouseAnalyzer] Lighthouse run failed", { error: err.message });
    return {
      metrics:  buildErrorMetrics(err.message),
      findings: [
        finding({
          id:          "perf-lighthouse-error",
          severity:    "high",
          title:       "Lighthouse audit could not complete",
          description: `Lighthouse failed to run: ${err.message}`,
          evidence:    { error: err.message },
          confidence:  0,
        }),
      ],
    };
  } finally {
    if (chrome) try { chrome.kill(); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LHR → metrics + findings
// ─────────────────────────────────────────────────────────────────────────────

function processLhr(lhr) {
  const audits = lhr.audits ?? {};
  const score  = lhr.categories?.performance?.score ?? null;

  // ── Raw metric values ───────────────────────────────────────────────────
  const fcp  = audits["first-contentful-paint"]?.numericValue  ?? null;
  const lcp  = audits["largest-contentful-paint"]?.numericValue ?? null;
  const tbt  = audits["total-blocking-time"]?.numericValue      ?? null;
  const cls  = audits["cumulative-layout-shift"]?.numericValue  ?? null;
  const si   = audits["speed-index"]?.numericValue              ?? null;
  const tti  = audits["interactive"]?.numericValue              ?? null;
  const inp  = audits["interaction-to-next-paint"]?.numericValue ?? null;

  // ── Byte breakdown ──────────────────────────────────────────────────────
  const byteItems  = audits["total-byte-weight"]?.details?.items ?? [];
  const totalBytes = byteItems.reduce((s, i) => s + (i.totalBytes ?? 0), 0)
    || (audits["total-byte-weight"]?.numericValue ?? null);

  const byteByType = {};
  for (const item of byteItems) {
    const t = item.resourceType ?? "other";
    byteByType[t] = (byteByType[t] ?? 0) + (item.totalBytes ?? 0);
  }

  const jsBytes    = byteByType["Script"]  ?? byteByType["script"]  ?? null;
  const cssBytes   = byteByType["Stylesheet"] ?? byteByType["stylesheet"] ?? null;
  const imageBytes = byteByType["Image"]   ?? byteByType["image"]   ?? null;

  // ── Request count ───────────────────────────────────────────────────────
  const requestCount = (audits["network-requests"]?.details?.items ?? []).length || null;

  // ── Opportunity audits ──────────────────────────────────────────────────
  const renderBlockingItems = audits["render-blocking-resources"]?.details?.items ?? [];
  const unusedJsSavingsMs   = audits["unused-javascript"]?.numericValue ?? null;
  const unusedCssSavingsMs  = audits["unused-css-rules"]?.numericValue  ?? null;
  const unusedJsItems       = audits["unused-javascript"]?.details?.items ?? [];
  const unusedCssItems      = audits["unused-css-rules"]?.details?.items  ?? [];
  const offscreenItems      = audits["offscreen-images"]?.details?.items  ?? [];
  const lazyItems           = audits["uses-lazy-loading"]?.details?.items ?? [];
  const bootupItems         = audits["bootup-time"]?.details?.items       ?? [];

  // ── Assemble metrics object ─────────────────────────────────────────────
  const metrics = {
    lighthouseScore:          score  != null ? Math.round(score * 100) : null,
    firstContentfulPaint:     fcp    != null ? Math.round(fcp)         : null,
    largestContentfulPaint:   lcp    != null ? Math.round(lcp)         : null,
    totalBlockingTime:        tbt    != null ? Math.round(tbt)         : null,
    cumulativeLayoutShift:    cls    != null ? +cls.toFixed(3)          : null,
    speedIndex:               si     != null ? Math.round(si)          : null,
    timeToInteractive:        tti    != null ? Math.round(tti)         : null,
    interactionToNextPaint:   inp    != null ? Math.round(inp)         : null,
    totalBytes:               totalBytes     != null ? Math.round(totalBytes)  : null,
    javascriptBytes:          jsBytes        != null ? Math.round(jsBytes)     : null,
    cssBytes:                 cssBytes       != null ? Math.round(cssBytes)    : null,
    imageBytes:               imageBytes     != null ? Math.round(imageBytes)  : null,
    requestCount,
    renderBlockingCount:      renderBlockingItems.length,
    unusedJavaScriptSavingsMs: unusedJsSavingsMs  != null ? Math.round(unusedJsSavingsMs)  : null,
    unusedCssSavingsMs:        unusedCssSavingsMs != null ? Math.round(unusedCssSavingsMs) : null,
    // Keep backward-compat fields used by rest of pipeline
    renderBlockingResources:  renderBlockingItems.length,
    totalPageWeight:          totalBytes ?? 0,
    totalRequests:            requestCount ?? 0,
    timeToFirstByte:          null, // not a standalone LH audit
  };

  // ── Build findings ──────────────────────────────────────────────────────
  const findings = [];

  // ── Overall score
  if (score != null && score < T.score.warn) {
    findings.push(finding({
      id:          "perf-score-poor",
      severity:    score < 0.50 ? "high" : "medium",
      title:       `Poor Lighthouse performance score: ${Math.round(score * 100)}/100`,
      description: `The page scored ${Math.round(score * 100)}/100 on Lighthouse performance (good ≥ 90).`,
      evidence:    { score: Math.round(score * 100) },
    }));
  }

  // ── LCP
  if (lcp != null) {
    const sev = metricSeverity(lcp, T.lcp);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-lcp",
        severity:    sev,
        title:       `Largest Contentful Paint is ${sev === "high" ? "poor" : "needs improvement"}: ${fmtMs(lcp)}`,
        description: `LCP of ${fmtMs(lcp)} exceeds the ${sev === "high" ? "poor (>4 s)" : "needs-improvement (>2.5 s)"} threshold.`,
        evidence:    { lcp: Math.round(lcp), threshold: { good: T.lcp.good, warn: T.lcp.warn } },
      }));
    }
  }

  // ── FCP
  if (fcp != null) {
    const sev = metricSeverity(fcp, T.fcp);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-fcp",
        severity:    sev,
        title:       `First Contentful Paint is slow: ${fmtMs(fcp)}`,
        description: `FCP of ${fmtMs(fcp)} exceeds the ${sev === "high" ? "poor (>3 s)" : "needs-improvement (>1.8 s)"} threshold.`,
        evidence:    { fcp: Math.round(fcp), threshold: { good: T.fcp.good, warn: T.fcp.warn } },
      }));
    }
  }

  // ── TBT
  if (tbt != null) {
    const sev = metricSeverity(tbt, T.tbt);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-tbt",
        severity:    sev,
        title:       `High Total Blocking Time: ${fmtMs(tbt)}`,
        description: `TBT of ${fmtMs(tbt)} means the main thread is blocked for long tasks. Good: ≤200 ms.`,
        evidence:    { tbt: Math.round(tbt), threshold: { good: T.tbt.good, warn: T.tbt.warn } },
      }));
    }
  }

  // ── CLS
  if (cls != null) {
    const sev = metricSeverity(cls, T.cls);
    if (sev !== "info") {
      const clsItems = audits["cumulative-layout-shift"]?.details?.items ?? [];
      findings.push(finding({
        id:          "perf-cls",
        severity:    sev,
        title:       `Cumulative Layout Shift: ${cls.toFixed(3)} (${sev === "high" ? "poor" : "needs improvement"})`,
        description: `CLS of ${cls.toFixed(3)} exceeds threshold (good ≤ 0.1). Elements shift visibly during load.`,
        evidence:    { cls: +cls.toFixed(3), sources: clsItems.slice(0, 5), threshold: { good: T.cls.good, warn: T.cls.warn } },
      }));
    }
  }

  // ── Speed Index
  if (si != null) {
    const sev = metricSeverity(si, T.si);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-speed-index",
        severity:    sev,
        title:       `Speed Index is slow: ${fmtMs(si)}`,
        description: `Speed Index of ${fmtMs(si)} indicates the page takes a long time to be visually complete.`,
        evidence:    { speedIndex: Math.round(si), threshold: { good: T.si.good, warn: T.si.warn } },
      }));
    }
  }

  // ── TTI
  if (tti != null) {
    const sev = metricSeverity(tti, T.tti);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-tti",
        severity:    sev,
        title:       `Time to Interactive is slow: ${fmtMs(tti)}`,
        description: `TTI of ${fmtMs(tti)} means the page is not reliably interactive until after this point.`,
        evidence:    { tti: Math.round(tti), threshold: { good: T.tti.good, warn: T.tti.warn } },
      }));
    }
  }

  // ── Render-blocking resources
  if (renderBlockingItems.length > 0) {
    const savingsMs = renderBlockingItems.reduce((s, i) => s + (i.wastedMs ?? 0), 0);
    findings.push(finding({
      id:          "perf-render-blocking",
      severity:    renderBlockingItems.length >= 3 ? "high" : "medium",
      title:       `${renderBlockingItems.length} render-blocking resource(s) detected`,
      description: `${renderBlockingItems.length} resource(s) are blocking the first paint, wasting ~${fmtMs(savingsMs)}.`,
      evidence:    {
        count:    renderBlockingItems.length,
        savingsMs: Math.round(savingsMs),
        resources: renderBlockingItems.slice(0, 10).map(i => ({ url: i.url, wastedMs: i.wastedMs })),
      },
    }));
  }

  // ── Unused JavaScript
  if (unusedJsSavingsMs != null && unusedJsSavingsMs >= T.unusedJsMs.warn) {
    findings.push(finding({
      id:          "perf-unused-js",
      severity:    unusedJsSavingsMs >= 50_000 ? "high" : "medium",
      title:       `Unused JavaScript wastes ~${fmtMs(unusedJsSavingsMs)}`,
      description: `Reducing unused JavaScript could save ${fmtMs(unusedJsSavingsMs)} of load time.`,
      evidence:    {
        savingsMs: Math.round(unusedJsSavingsMs),
        files: unusedJsItems.slice(0, 5).map(i => ({
          url: i.url, wastedBytes: i.wastedBytes, wastedPercent: i.wastedPercent,
        })),
      },
    }));
  }

  // ── Unused CSS
  if (unusedCssSavingsMs != null && unusedCssSavingsMs >= T.unusedCssMs.warn) {
    findings.push(finding({
      id:          "perf-unused-css",
      severity:    "medium",
      title:       `Unused CSS wastes ~${fmtMs(unusedCssSavingsMs)}`,
      description: `Removing unused CSS rules could save ${fmtMs(unusedCssSavingsMs)} of load time.`,
      evidence:    {
        savingsMs: Math.round(unusedCssSavingsMs),
        files: unusedCssItems.slice(0, 5).map(i => ({ url: i.url, wastedBytes: i.wastedBytes })),
      },
    }));
  }

  // ── Image optimisation opportunities (offscreen-images)
  if (offscreenItems.length > 0) {
    const savedBytes = offscreenItems.reduce((s, i) => s + (i.wastedBytes ?? 0), 0);
    findings.push(finding({
      id:          "perf-offscreen-images",
      severity:    "medium",
      title:       `${offscreenItems.length} off-screen image(s) not lazy-loaded (~${fmtKb(savedBytes)} saveable)`,
      description: "Off-screen images are downloaded eagerly, wasting bandwidth on resources the user may never see.",
      evidence:    {
        count:      offscreenItems.length,
        savedBytes: Math.round(savedBytes),
        images:     offscreenItems.slice(0, 5).map(i => ({ url: i.url, wastedBytes: i.wastedBytes })),
      },
    }));
  }

  // ── Lazy loading opportunities
  if (lazyItems.length > 0) {
    findings.push(finding({
      id:          "perf-lazy-load",
      severity:    "low",
      title:       `${lazyItems.length} image(s) could use lazy loading`,
      description: 'Adding loading="lazy" to below-the-fold images defers their download until needed.',
      evidence:    {
        count:  lazyItems.length,
        images: lazyItems.slice(0, 5).map(i => ({ url: i.url })),
      },
    }));
  }

  // ── Total page weight
  if (totalBytes != null) {
    const sev = bytesSeverity(totalBytes, T.totalBytes);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-page-weight",
        severity:    sev,
        title:       `Total page weight is ${sev === "high" ? "very large" : "large"}: ${fmtMb(totalBytes)}`,
        description: `The page transfers ${fmtMb(totalBytes)} of data (good: <1.6 MB).`,
        evidence:    { totalBytes: Math.round(totalBytes), threshold: T.totalBytes },
      }));
    }
  }

  // ── JavaScript bytes
  if (jsBytes != null) {
    const sev = bytesSeverity(jsBytes, T.jsBytes);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-js-size",
        severity:    sev,
        title:       `JavaScript payload is ${sev === "high" ? "very large" : "large"}: ${fmtKb(jsBytes)}`,
        description: `${fmtKb(jsBytes)} of JavaScript must parse and execute before the page is interactive.`,
        evidence:    { jsBytes: Math.round(jsBytes), threshold: T.jsBytes },
      }));
    }
  }

  // ── CSS bytes
  if (cssBytes != null) {
    const sev = bytesSeverity(cssBytes, T.cssBytes);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-css-size",
        severity:    sev,
        title:       `CSS payload is large: ${fmtKb(cssBytes)}`,
        description: `${fmtKb(cssBytes)} of CSS must download and parse before rendering.`,
        evidence:    { cssBytes: Math.round(cssBytes), threshold: T.cssBytes },
      }));
    }
  }

  // ── Image bytes
  if (imageBytes != null) {
    const sev = bytesSeverity(imageBytes, T.imageBytes);
    if (sev !== "info") {
      findings.push(finding({
        id:          "perf-image-size",
        severity:    sev,
        title:       `Images contribute ${fmtKb(imageBytes)} to page weight`,
        description: `Large unoptimised images slow LCP and increase data usage for mobile users.`,
        evidence:    { imageBytes: Math.round(imageBytes), threshold: T.imageBytes },
      }));
    }
  }

  // ── Heavy JavaScript bootup (top JS files by CPU time)
  if (bootupItems.length > 0) {
    const totalBootupMs = bootupItems.reduce((s, i) => s + (i.total ?? 0), 0);
    if (totalBootupMs > 500) {
      findings.push(finding({
        id:          "perf-js-bootup",
        severity:    totalBootupMs > 2000 ? "high" : "medium",
        title:       `JavaScript execution time: ${fmtMs(totalBootupMs)}`,
        description: `Scripts take ${fmtMs(totalBootupMs)} to parse and execute, delaying interactivity.`,
        evidence:    {
          totalMs: Math.round(totalBootupMs),
          topFiles: bootupItems.slice(0, 5).map(i => ({ url: i.url, totalMs: i.total })),
        },
      }));
    }
  }

  logger.info("[lighthouseAnalyzer] Findings generated", {
    score: metrics.lighthouseScore,
    findingCount: findings.length,
  });

  return { metrics, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback when Lighthouse itself fails to run
// ─────────────────────────────────────────────────────────────────────────────

function buildErrorMetrics(errorMsg) {
  return {
    lighthouseScore: null,
    firstContentfulPaint: null,
    largestContentfulPaint: null,
    totalBlockingTime: null,
    cumulativeLayoutShift: null,
    speedIndex: null,
    timeToInteractive: null,
    interactionToNextPaint: null,
    totalBytes: null,
    javascriptBytes: null,
    cssBytes: null,
    imageBytes: null,
    requestCount: null,
    renderBlockingCount: 0,
    unusedJavaScriptSavingsMs: null,
    unusedCssSavingsMs: null,
    renderBlockingResources: 0,
    totalPageWeight: 0,
    totalRequests: 0,
    timeToFirstByte: null,
    error: errorMsg,
  };
}
