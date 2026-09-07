/**
 * testBrowserCollector.js
 * Standalone integration test for browserCollector.js
 *
 * Usage:
 *   node src/tools/testBrowserCollector.js
 *   node src/tools/testBrowserCollector.js https://github.com
 *
 * Does NOT send any data to OpenAI.
 * Writes a human-readable report to stdout and exits 0 on success, 1 on failure.
 */

import { collectBrowserEvidence } from "./browserCollector.js";

const TARGET_URL = process.argv[2] || "https://example.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(label, detail = "") {
  console.log(`  ✓ ${label}${detail ? `  → ${detail}` : ""}`);
}
function fail(label, detail = "") {
  console.log(`  ✗ ${label}${detail ? `  → ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n─── ${title} ${"─".repeat(Math.max(0, 50 - title.length))}`);
}
function info(label, value) {
  const display = value === null || value === undefined ? "(null)" : String(value);
  console.log(`    ${label.padEnd(28)} ${display}`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log("\n━━━ browserCollector.js — Integration Test ━━━");
console.log(`    Target URL: ${TARGET_URL}`);
console.log(`    Started:    ${new Date().toISOString()}\n`);

const start = Date.now();
let evidence;

try {
  evidence = await collectBrowserEvidence(TARGET_URL);
} catch (err) {
  console.error(`\n✗ collectBrowserEvidence() threw: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}

const elapsed = Date.now() - start;
console.log(`\n  Collection finished in ${elapsed} ms`);

// ── Validate: top-level shape ─────────────────────────────────────────────────
section("1  Top-level shape");

const requiredKeys = [
  "url", "finalUrl", "domain", "collectedAt", "mocked",
  "meta", "httpResponse", "resources", "network",
  "dom", "elements", "rendering", "styledElements",
  "visibleText", "screenshot",
];
let shapeOk = true;
for (const k of requiredKeys) {
  if (k in evidence) {
    pass(`key present: ${k}`);
  } else {
    fail(`key MISSING: ${k}`);
    shapeOk = false;
  }
}

if (!shapeOk) {
  console.error("\nFATAL: evidence shape is wrong — aborting further checks.");
  process.exit(1);
}

// ── Validate: mocked flag ─────────────────────────────────────────────────────
section("2  Mocked flag");
if (evidence.mocked === false) {
  pass("mocked === false  (real Playwright run)");
} else {
  fail(`mocked === ${evidence.mocked}  (expected false)`);
}

// ── Validate: HTTP response ───────────────────────────────────────────────────
section("3  HTTP response");
const hr = evidence.httpResponse;
info("finalUrl",          evidence.finalUrl);
info("statusCode",        hr.statusCode);
info("server",            hr.server);
info("compressionEnabled", hr.compressionEnabled);
info("http2",             hr.http2);
info("navDurationMs",     `${hr.navDurationMs} ms`);
info("navError",          hr.navError ?? "(none)");

if (hr.statusCode >= 200 && hr.statusCode < 400) {
  pass(`HTTP ${hr.statusCode} — success`);
} else {
  fail(`HTTP ${hr.statusCode} — unexpected`);
}

// ── Validate: meta ────────────────────────────────────────────────────────────
section("4  Page metadata");
const m = evidence.meta;
info("title",       m.title);
info("description", m.description ?? "(none)");
info("viewport",    m.viewport    ?? "(none)");
info("charset",     m.charset);
info("lang",        m.lang);
info("ogTags count", Object.keys(m.ogTags ?? {}).length);

if (m.title) {
  pass(`title present: "${m.title}"`);
} else {
  fail("title is empty");
}

// ── Validate: DOM ─────────────────────────────────────────────────────────────
section("5  DOM");
const dom = evidence.dom;
info("totalElements",          dom.totalElements);
info("depth",                  dom.depth);
info("imagesWithoutAlt",       dom.imagesWithoutAlt);
info("inputsWithoutLabel",     dom.inputsWithoutLabel);
info("hasSkipLink",            dom.hasSkipLink);
info("hasMissingH1",           dom.hasMissingH1);
info("missingHeadingHierarchy",dom.missingHeadingHierarchy);
info("interactiveElements",    dom.interactiveElements);

if (dom.totalElements > 0) {
  pass(`DOM has ${dom.totalElements} elements`);
} else {
  fail("DOM element count is 0");
}

// ── Validate: elements ────────────────────────────────────────────────────────
section("6  Extracted elements");
const el = evidence.elements;
info("headings count", el.headings?.length ?? 0);
info("links count",    el.links?.length    ?? 0);
info("buttons count",  el.buttons?.length  ?? 0);
info("forms count",    el.forms?.length    ?? 0);
info("images count",   el.images?.length   ?? 0);

if (el.headings?.length > 0) pass(`headings: ${el.headings.map(h => `[${h.tag}] ${h.text.slice(0,40)}`).join(" | ")}`);
else                          fail("no headings found");
if (el.links?.length > 0)    pass(`links: ${el.links.length} found`);
else                         fail("no links found");

// ── Validate: computed styles ─────────────────────────────────────────────────
section("7  Computed styles");
const styled = evidence.styledElements;
info("styled elements collected", styled.length);

if (styled.length > 0) {
  pass(`${styled.length} elements with computed styles`);
  styled.slice(0, 3).forEach((s) => {
    info(`  ${s.selector}`, `font:${s.styles.fontSize}/${s.styles.fontFamily?.split(",")[0]} color:${s.styles.color}`);
  });
} else {
  fail("no styled elements collected");
}

// ── Validate: network ─────────────────────────────────────────────────────────
section("8  Network");
const res = evidence.resources;
info("totalRequests",   res.totalRequests);
info("scripts",         res.scripts);
info("stylesheets",     res.stylesheets);
info("images",          res.images);
info("fonts",           res.fonts);
info("xhr",             res.xhr);
info("other",           res.other);
info("totalTransferSize", res.totalTransferSize ? `${(res.totalTransferSize/1000).toFixed(1)} KB` : "N/A");

const net = evidence.network;
info("xhrRequests",     net.xhrRequests?.length  ?? 0);
info("failedRequests",  net.failedRequests?.length ?? 0);
info("consoleErrors",   net.consoleErrors?.length  ?? 0);

if (res.totalRequests > 0) pass(`${res.totalRequests} total network requests captured`);
else                       fail("no network requests captured");

if (net.failedRequests?.length > 0) {
  fail(`${net.failedRequests.length} failed request(s):`);
  net.failedRequests.slice(0, 5).forEach((r) => {
    info(`  [${r.status}]`, r.url.slice(0, 80));
  });
} else {
  pass("no failed requests");
}

if (net.consoleErrors?.length > 0) {
  fail(`${net.consoleErrors.length} console error(s):`);
  net.consoleErrors.slice(0, 3).forEach((e) => {
    info("  error", e.text.slice(0, 100));
  });
} else {
  pass("no console errors");
}

// ── Validate: rendering ───────────────────────────────────────────────────────
section("9  Rendering hints");
const rnd = evidence.rendering;
info("renderBlockingScripts",     rnd.renderBlockingScripts);
info("renderBlockingStylesheets", rnd.renderBlockingStylesheets);
info("lazyLoadedImages",          rnd.lazyLoadedImages);
info("totalImages",               rnd.totalImages);
pass("rendering hints collected");

// ── Validate: visible text ────────────────────────────────────────────────────
section("10 Visible text");
const txt = evidence.visibleText || "";
info("length (chars)", txt.length);
info("preview",        txt.slice(0, 120).replace(/\n/g, " ") + (txt.length > 120 ? "…" : ""));
if (txt.length > 0) pass("visible text extracted");
else                fail("visible text is empty");

// ── Validate: screenshot ──────────────────────────────────────────────────────
section("11 Screenshot");
const ss = evidence.screenshot;
if (ss?.data) {
  const sizeKB = Math.round(Buffer.from(ss.data, "base64").length / 1024);
  pass(`screenshot captured — format:${ss.format} size:${sizeKB} KB`);
} else {
  fail("screenshot not captured");
}

// ── Resource URL samples ──────────────────────────────────────────────────────
if (res.scriptUrls?.length > 0) {
  section("12 Sample script URLs");
  res.scriptUrls.slice(0, 5).forEach((u) => info("  script", u.slice(0, 80)));
}
if (res.stylesheetUrls?.length > 0) {
  section("13 Sample stylesheet URLs");
  res.stylesheetUrls.slice(0, 3).forEach((u) => info("  css", u.slice(0, 80)));
}

// ── XHR/Fetch detail ─────────────────────────────────────────────────────────
if (net.xhrRequests?.length > 0) {
  section("14 XHR/Fetch requests");
  net.xhrRequests.slice(0, 5).forEach((r) => {
    info(`  [${r.status}] ${r.method}`, r.url.slice(0, 80));
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n━━━ Test complete ━━━");
console.log(`    Elapsed: ${elapsed} ms`);
console.log(`    URL:     ${evidence.finalUrl}`);
console.log(`    Status:  HTTP ${hr.statusCode}`);
console.log(`    DOM:     ${dom.totalElements} elements, depth ${dom.depth}`);
console.log(`    Network: ${res.totalRequests} requests`);
console.log(`    Styled:  ${styled.length} elements`);
console.log(`    Screenshot: ${ss?.data ? "YES" : "NO"}\n`);
