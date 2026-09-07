/**
 * networkAnalyzer.js
 * Analyzes network evidence collected by Playwright's browserCollector.
 *
 * Detects:
 *  - Slow API calls (>1000ms)
 *  - Very slow API calls (>3000ms)
 *  - Duplicate API requests (method + normalised URL)
 *  - HTTP 4xx / 5xx errors
 *  - Failed requests (status 0 / net errors)
 *  - Large responses (>1 MB)
 *  - Excessive API request counts (>20 XHR/fetch)
 *  - Duplicated static resource requests
 *  - Unnecessary repeated requests (static assets fetched >1x)
 *
 * All findings carry:
 *  { id, category:"network", severity, title, description,
 *    impact, recommendation, evidence, confidence, source:"networkAnalyzer" }
 */

import { randomUUID } from "crypto";
import { logger }     from "../utils/logger.js";

// ── Thresholds ────────────────────────────────────────────────────────────────
const T = {
  slowApiMs:         1_000,
  verySlowApiMs:     3_000,
  largeResponseBytes: 1_000_000,   // 1 MB
  excessiveApiCount:    20,
  highRequestCount:     60,
  duplicateCountWarn:    2,        // ≥2 identical method+url = duplicate
  duplicateCountHigh:    4,        // ≥4 = strong evidence of bug
};

// ── API resource types ────────────────────────────────────────────────────────
const API_TYPES    = new Set(["xhr", "fetch"]);
const STATIC_TYPES = new Set(["script", "stylesheet", "image", "font", "media"]);

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string}  url              Page URL (used in finding descriptions)
 * @param {object}  browserEvidence  Evidence from collectBrowserEvidence()
 * @returns {Promise<Array>}         Normalised network findings
 */
export async function runNetworkAnalysis(url, browserEvidence = {}) {
  logger.info("[networkAnalyzer] Analysing network evidence", { url });

  const findings = [];
  const net       = browserEvidence.network   ?? {};
  const resources = browserEvidence.resources ?? {};
  const httpResp  = browserEvidence.httpResponse ?? {};

  const allRequests    = net.allRequests    ?? [];
  const xhrRequests    = net.xhrRequests    ?? [];
  const failedRequests = net.failedRequests ?? [];

  // ── 1. Failed requests (status 0 / network error) ────────────────────────
  findings.push(...detectFailedRequests(failedRequests));

  // ── 2. HTTP 4xx ──────────────────────────────────────────────────────────
  findings.push(...detectHttpErrors(allRequests, 400, 499, "4xx"));

  // ── 3. HTTP 5xx ──────────────────────────────────────────────────────────
  findings.push(...detectHttpErrors(allRequests, 500, 599, "5xx"));

  // ── 4. Slow / very-slow API calls ────────────────────────────────────────
  findings.push(...detectSlowApis(xhrRequests));

  // ── 5. Large responses ───────────────────────────────────────────────────
  findings.push(...detectLargeResponses(allRequests));

  // ── 6. Duplicate API requests ────────────────────────────────────────────
  findings.push(...detectDuplicateRequests(xhrRequests, "api"));

  // ── 7. Duplicate static resource requests ────────────────────────────────
  const staticReqs = allRequests.filter(r => STATIC_TYPES.has(r.resourceType));
  findings.push(...detectDuplicateRequests(staticReqs, "static"));

  // ── 8. Excessive API request count ───────────────────────────────────────
  findings.push(...detectExcessiveApiCount(xhrRequests));

  // ── 9. High total request count ──────────────────────────────────────────
  findings.push(...detectHighTotalRequests(allRequests));

  // ── 10. Missing compression ──────────────────────────────────────────────
  findings.push(...detectMissingCompression(httpResp));

  // ── 11. Missing cache headers on static assets ───────────────────────────
  findings.push(...detectMissingCacheHeaders(allRequests, resources));

  logger.info("[networkAnalyzer] Done", { findings: findings.length });
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Duration = responseEnd - requestStart (both are ms offsets from startTime) */
function durationMs(timing) {
  if (!timing) return null;
  const { requestStart, responseEnd } = timing;
  if (requestStart == null || responseEnd == null) return null;
  if (requestStart < 0 || responseEnd < 0)          return null;
  const d = responseEnd - requestStart;
  return d >= 0 ? Math.round(d) : null;
}

function fmtMs(ms)    { return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`; }
function fmtBytes(b)  { return b >= 1_000_000 ? `${(b/1_000_000).toFixed(2)} MB` : `${Math.round(b/1024)} KB`; }
function shortUrl(u)  { try { const p = new URL(u); return p.pathname + (p.search || ""); } catch { return u; } }

// ── Finding factory ───────────────────────────────────────────────────────────
function finding({ id, severity, title, description, impact, recommendation, evidence = {}, confidence = 1 }) {
  return {
    id:             id || randomUUID(),
    category:       "network",
    severity,
    title,
    description,
    impact:         impact         ?? "",
    recommendation: recommendation ?? "",
    evidence,
    confidence,     // 0–1
    source:         "networkAnalyzer",
  };
}

// ── 1. Failed requests ────────────────────────────────────────────────────────
function detectFailedRequests(failedRequests) {
  const truly = failedRequests.filter(r => r.status === 0 || r.status === null);
  if (!truly.length) return [];
  return [finding({
    id:          "net-failed-requests",
    severity:    truly.length >= 3 ? "high" : "medium",
    title:       `${truly.length} network request(s) failed to load`,
    description: `${truly.length} request(s) received no response (network error or DNS failure).`,
    impact:      "Missing resources can break page functionality, layout, or features.",
    recommendation: "Check the browser console and server logs. Verify DNS, firewall rules, and CORS configuration.",
    evidence: { count: truly.length, requests: truly.slice(0, 10).map(r => ({ url: shortUrl(r.url), method: r.method })) },
    confidence: 0.95,
  })];
}

// ── 2 & 3. HTTP 4xx / 5xx ─────────────────────────────────────────────────────
function detectHttpErrors(allRequests, lo, hi, label) {
  const errored = allRequests.filter(r => r.status >= lo && r.status <= hi);
  if (!errored.length) return [];
  const isCritical = label === "5xx";
  return [finding({
    id:          `net-http-${label}`,
    severity:    isCritical ? "high" : "medium",
    title:       `${errored.length} HTTP ${label} response(s) detected`,
    description: `${errored.length} request(s) returned ${label} status codes indicating ${isCritical ? "server errors" : "client/resource errors"}.`,
    impact:      isCritical
      ? "Server errors may indicate broken APIs or infrastructure issues affecting all users."
      : "Client errors may indicate broken links, missing resources, or authentication problems.",
    recommendation: isCritical
      ? "Investigate server logs for the failing endpoints. Check for unhandled exceptions and infrastructure issues."
      : "Review each 4xx URL. Fix broken links, add missing resources, and handle auth errors gracefully.",
    evidence: {
      count: errored.length,
      requests: errored.slice(0, 10).map(r => ({ url: shortUrl(r.url), status: r.status, method: r.method })),
    },
    confidence: 1.0,
  })];
}

// ── 4. Slow / very-slow API calls ─────────────────────────────────────────────
function detectSlowApis(xhrRequests) {
  const findings = [];
  const verySlowList = [];
  const slowList     = [];

  for (const r of xhrRequests) {
    const ms = durationMs(r.timing);
    if (ms == null) continue;
    if (ms > T.verySlowApiMs) verySlowList.push({ url: shortUrl(r.url), method: r.method, durationMs: ms });
    else if (ms > T.slowApiMs) slowList.push({ url: shortUrl(r.url), method: r.method, durationMs: ms });
  }

  if (verySlowList.length) {
    findings.push(finding({
      id:          "net-very-slow-api",
      severity:    "high",
      title:       `${verySlowList.length} very slow API call(s) detected (>${T.verySlowApiMs / 1000} s)`,
      description: `${verySlowList.length} XHR/fetch request(s) took longer than ${fmtMs(T.verySlowApiMs)} to complete.`,
      impact:      "Very slow APIs block rendering and interaction, significantly degrading perceived performance.",
      recommendation: "Profile slow endpoints with APM tooling. Add database indexes, caching, or pagination. Consider streaming responses.",
      evidence: { threshold: T.verySlowApiMs, calls: verySlowList.slice(0, 10) },
      confidence: 0.95,
    }));
  }

  if (slowList.length) {
    findings.push(finding({
      id:          "net-slow-api",
      severity:    "medium",
      title:       `${slowList.length} slow API call(s) detected (>${T.slowApiMs} ms)`,
      description: `${slowList.length} XHR/fetch request(s) took between ${fmtMs(T.slowApiMs)} and ${fmtMs(T.verySlowApiMs)}.`,
      impact:      "Slow API calls delay content updates and interactive features.",
      recommendation: "Review response times with server-side profiling. Add caching for repeated queries and optimise database access.",
      evidence: { threshold: T.slowApiMs, calls: slowList.slice(0, 10) },
      confidence: 0.9,
    }));
  }

  return findings;
}

// ── 5. Large responses ────────────────────────────────────────────────────────
function detectLargeResponses(allRequests) {
  const large = [];

  for (const r of allRequests) {
    const bytes = safeGet(() => r.timing?.responseBodySize) ?? 0;
    if (bytes > T.largeResponseBytes) {
      large.push({
        url:    shortUrl(r.url),
        method: r.method,
        type:   r.resourceType,
        bytes,
      });
    }
  }

  if (!large.length) return [];

  return [finding({
    id:          "net-large-responses",
    severity:    large.some(l => l.bytes > 5_000_000) ? "high" : "medium",
    title:       `${large.length} large response(s) exceeding 1 MB`,
    description: `${large.length} resource(s) transferred more than ${fmtBytes(T.largeResponseBytes)}.`,
    impact:      "Large payloads increase load time and data usage, especially on mobile connections.",
    recommendation: "Compress API responses with gzip/brotli. Paginate large data sets. Use CDN for large static assets. Convert images to WebP/AVIF.",
    evidence: {
      threshold: T.largeResponseBytes,
      resources: large.slice(0, 10).map(l => ({ ...l, formatted: fmtBytes(l.bytes) })),
    },
    confidence: 0.85, // responseBodySize not always accurate in headless
  })];
}

// ── 6 & 7. Duplicate requests (API and static) ────────────────────────────────

/**
 * Normalise a URL for duplicate detection:
 *  - Strip common cache-busting query params (v, ver, _t, _ts, cb, cachebust, t, rev, hash, build)
 *  - Preserve meaningful query params (id, page, filter, q, etc.)
 */
function normaliseUrlForDedupe(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const CACHE_BUST = new Set(["v","ver","version","_t","_ts","cb","cachebust","t","rev","hash","build","bust","nocache","nc","ts"]);
    for (const key of [...u.searchParams.keys()]) {
      if (CACHE_BUST.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    // Sort remaining params for stable comparison
    u.searchParams.sort();
    return `${u.pathname}${u.search}`;
  } catch {
    return rawUrl;
  }
}

function detectDuplicateRequests(requests, scope) {
  // Group by method + normalised URL
  const groups = new Map();

  for (const r of requests) {
    const norm = normaliseUrlForDedupe(r.url);
    const key  = `${r.method.toUpperCase()}:${norm}`;
    if (!groups.has(key)) groups.set(key, []);
    const dur = durationMs(r.timing);
    groups.get(key).push({ url: r.url, durationMs: dur, status: r.status });
  }

  const duplicates = [];
  for (const [key, hits] of groups) {
    if (hits.length < T.duplicateCountWarn) continue;
    const [method, normUrl] = key.split(/:(.+)/);   // split on first colon only
    const durations = hits.map(h => h.durationMs).filter(d => d != null);
    duplicates.push({ method, normUrl, count: hits.length, durations, hits });
  }

  if (!duplicates.length) return [];

  const findings = [];

  for (const dup of duplicates) {
    const isStrong  = dup.count >= T.duplicateCountHigh;
    const isApi     = scope === "api";
    // Confidence: stronger with more repetitions; lower for static (CDN retry is normal)
    const confidence = isApi
      ? Math.min(0.95, 0.6 + dup.count * 0.08)
      : Math.min(0.8,  0.5 + dup.count * 0.06);

    const avgDur = dup.durations.length
      ? Math.round(dup.durations.reduce((a, b) => a + b, 0) / dup.durations.length)
      : null;

    findings.push(finding({
      id:       `net-duplicate-${scope}-${randomUUID().slice(0, 8)}`,
      severity: isStrong ? "high" : "medium",
      title:    `${isApi ? "API" : "Static resource"} requested ${dup.count}× — ${dup.method} ${dup.normUrl}`,
      description:
        `${dup.method} ${dup.normUrl} was requested ${dup.count} time(s)` +
        (avgDur != null ? ` (avg ${fmtMs(avgDur)})` : "") +
        `. Cache-busting parameters were stripped before comparison.`,
      impact: isApi
        ? "Duplicate API calls waste server resources, increase latency, and may cause race conditions or stale data."
        : "Repeated static asset requests bypass the browser cache and increase bandwidth usage.",
      recommendation: isApi
        ? "Review component lifecycle and event handlers for unintended re-triggers. Implement request deduplication or SWR/React Query."
        : "Ensure the asset has correct Cache-Control headers. Check for multiple bundle entries importing the same file.",
      evidence: {
        method:    dup.method,
        normUrl:   dup.normUrl,
        count:     dup.count,
        durations: dup.durations,
        avgDurationMs: avgDur,
        sample:    dup.hits.slice(0, 5).map(h => ({ url: shortUrl(h.url), durationMs: h.durationMs, status: h.status })),
      },
      confidence,
    }));
  }

  return findings;
}

// ── 8. Excessive API request count ───────────────────────────────────────────
function detectExcessiveApiCount(xhrRequests) {
  const count = xhrRequests.length;
  if (count <= T.excessiveApiCount) return [];

  return [finding({
    id:          "net-excessive-api-count",
    severity:    count > 50 ? "high" : "medium",
    title:       `Excessive API request count: ${count} XHR/fetch requests`,
    description: `The page made ${count} XHR/fetch requests (threshold: ${T.excessiveApiCount}). This may indicate over-fetching or missing request batching.`,
    impact:      "Each API request adds network round-trip overhead. Large numbers degrade page load and Time to Interactive.",
    recommendation: "Batch related API calls. Use GraphQL or aggregator endpoints. Implement pagination and lazy-loading for data-heavy pages.",
    evidence: { count, threshold: T.excessiveApiCount, sample: xhrRequests.slice(0, 10).map(r => shortUrl(r.url)) },
    confidence: 0.9,
  })];
}

// ── 9. High total request count ───────────────────────────────────────────────
function detectHighTotalRequests(allRequests) {
  const count = allRequests.length;
  if (count <= T.highRequestCount) return [];

  return [finding({
    id:          "net-high-request-count",
    severity:    count > 120 ? "high" : "medium",
    title:       `High total request count: ${count} requests`,
    description: `The page made ${count} total network requests. Pages with more than ${T.highRequestCount} requests have measurable performance overhead.`,
    impact:      "Each request adds TCP/TLS/HTTP overhead. Even with HTTP/2 multiplexing, large request counts increase resource contention.",
    recommendation: "Bundle scripts and stylesheets. Use sprites or icon fonts for small images. Remove unused third-party tags. Audit tracking scripts.",
    evidence: { count, threshold: T.highRequestCount },
    confidence: 0.95,
  })];
}

// ── 10. Missing compression ───────────────────────────────────────────────────
function detectMissingCompression(httpResp) {
  if (httpResp.compressionEnabled !== false) return [];

  return [finding({
    id:          "net-no-compression",
    severity:    "high",
    title:       "Text compression not enabled on the main document",
    description: "The main HTML response is not served with gzip or brotli encoding. Text-based resources are typically 60–80% smaller when compressed.",
    impact:      "Larger HTML payload increases Time to First Byte and overall page weight for every visitor.",
    recommendation: "Enable gzip or brotli on your web server: nginx (`gzip on; gzip_types text/html ...`), Apache (`mod_deflate`), or CDN-level compression.",
    evidence: { compressionEnabled: false, server: httpResp.server ?? null },
    confidence: 0.9, // inferred from response headers; may miss asset-level compression
  })];
}

// ── 11. Missing cache headers on static assets ────────────────────────────────
function detectMissingCacheHeaders(allRequests, resources) {
  // We don't have Cache-Control per-request from Playwright's basic interception.
  // Fire this finding when there are static assets AND we can see the overall resource counts.
  const staticCount = (resources.scripts ?? 0) + (resources.stylesheets ?? 0) + (resources.images ?? 0);
  if (staticCount === 0) return [];

  // Only raise this as informational — we can't confirm cache headers without
  // inspecting each response header individually.
  return [finding({
    id:          "net-cache-headers",
    severity:    "low",
    title:       `Verify Cache-Control headers on ${staticCount} static asset(s)`,
    description: `The page loads ${staticCount} static asset(s) (scripts, stylesheets, images). Without long-lived Cache-Control headers, repeat visitors re-download these on every visit.`,
    impact:      "Uncached assets increase load time and bandwidth for returning users.",
    recommendation: "Set Cache-Control: max-age=31536000, immutable on all content-hashed static assets. Use cache-busting filenames (e.g. main.abc123.js) rather than query strings.",
    evidence: { staticCount, scripts: resources.scripts, stylesheets: resources.stylesheets, images: resources.images },
    confidence: 0.6, // cannot confirm actual headers without per-response inspection
  })];
}

// ── Utility ───────────────────────────────────────────────────────────────────
function safeGet(fn) { try { return fn(); } catch { return null; } }
