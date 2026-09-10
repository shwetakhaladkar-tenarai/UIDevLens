/**
 * browserCollector.js
 * Collects comprehensive browser evidence from a URL using Playwright.
 *
 * Single browser launch, shared network collection (desktop pass),
 * then lightweight viewport-specific passes for tablet and mobile.
 *
 * Collects:
 *  - Final URL, title, HTTP status, meta tags, lang, charset
 *  - DOM: element counts, headings, links, buttons, forms, images
 *  - Computed styles for representative visible elements
 *  - Network: all requests, XHR/fetch, failed requests, timing, sizes
 *  - Resources: scripts, stylesheets, images with URLs
 *  - Console errors
 *  - Rendering hints (render-blocking scripts/CSS, lazy images)
 *  - Visible text summary (capped)
 *  - viewports: { desktop, tablet, mobile } — screenshot + responsive findings
 *
 * Limits (safe defaults, all configurable via options):
 *  navigationTimeoutMs : 30 000 ms
 *  maxRequests         : 200
 *  maxPerType          : 50
 *  maxStyledElements   : 20
 *  maxConsoleMessages  : 50
 *  maxTextChars        : 3 000
 *  maxOverflowElements : 20
 */

import { chromium } from "playwright";
import { logger }   from "../utils/logger.js";

// ── Viewport definitions ──────────────────────────────────────────────────────
const VIEWPORTS = {
  desktop: { width: 1440, height: 900  },
  tablet:  { width: 768,  height: 1024 },
  mobile:  { width: 390,  height: 844  },
};

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  navigationTimeoutMs : 30_000,
  maxRequests         : 200,
  maxPerType          : 50,
  maxStyledElements   : 20,
  maxConsoleMessages  : 50,
  maxTextChars        : 3_000,
  maxOverflowElements : 20,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Launch Chromium, collect full evidence on desktop, then collect responsive
 * data on tablet and mobile viewports. One browser, three pages.
 *
 * @param {string} url
 * @param {object} [options]  Override any DEFAULTS key
 * @returns {Promise<object>}
 */
export async function collectBrowserEvidence(url, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  logger.info("[browserCollector] Starting collection", { url });

  const browser = await chromium.launch({ headless: true });

  try {
    // ── PASS 1 — Desktop (full collection + network) ──────────────────────
    const desktopEvidence = await collectDesktopPass(browser, url, cfg);

    // ── PASS 2 & 3 — Tablet / Mobile (viewport-only, no duplicate network) ─
    const [tabletEvidence, mobileEvidence] = await Promise.all([
      collectViewportPass(browser, url, "tablet",  cfg),
      collectViewportPass(browser, url, "mobile",  cfg),
    ]);

    // ── Assemble ──────────────────────────────────────────────────────────
    const evidence = {
      ...desktopEvidence,
      viewports: {
        desktop: desktopEvidence.viewports.desktop,
        tablet:  tabletEvidence,
        mobile:  mobileEvidence,
      },
    };

    logger.info("[browserCollector] All viewports collected", {
      finalUrl:     evidence.finalUrl,
      status:       evidence.httpResponse?.statusCode,
      totalRequests: evidence.resources?.totalRequests,
      domElements:  evidence.dom?.totalElements,
    });

    return evidence;

  } finally {
    await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop pass — full evidence collection
// ─────────────────────────────────────────────────────────────────────────────

async function collectDesktopPass(browser, url, cfg) {
  const vp = VIEWPORTS.desktop;

  const context = await browser.newContext({
    viewport:           vp,
    userAgent:          "Mozilla/5.0 (compatible; FrontendQualityAnalyzer/1.0)",
    ignoreHTTPSErrors:  true,
  });

  const page = await context.newPage();

  // ── Network + console listeners ───────────────────────────────────────
  const networkLog   = [];
  const consoleLog   = [];
  let   mainResponse = null;

  page.on("response", (res) => {
    if (networkLog.length >= cfg.maxRequests) return;
    try {
      networkLog.push({
        url:          res.url(),
        status:       res.status(),
        resourceType: res.request().resourceType(),
        method:       res.request().method(),
        timing:       safeGet(() => res.request().timing()),
      });
      if (!mainResponse && res.request().resourceType() === "document") {
        mainResponse = {
          url:     res.url(),
          status:  res.status(),
          headers: filterHeaders(res.headers()),
        };
      }
    } catch { /* response already gone */ }
  });

  page.on("console", (msg) => {
    if (consoleLog.length >= cfg.maxConsoleMessages) return;
    consoleLog.push({ type: msg.type(), text: msg.text() });
  });

  // ── Navigate ──────────────────────────────────────────────────────────
  const navStart  = Date.now();
  let   navError  = null;
  let   finalUrl  = url;

  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout:   cfg.navigationTimeoutMs,
    });
    finalUrl = page.url();
    if (!mainResponse && res) {
      mainResponse = {
        url:     finalUrl,
        status:  res.status(),
        headers: filterHeaders(res.headers()),
      };
    }
    await page.waitForTimeout(1_500).catch(() => {});
  } catch (err) {
    navError = err.message;
    logger.warn("[browserCollector] Desktop navigation error", { error: err.message });
  }

  const navDurationMs = Date.now() - navStart;

  // ── Screenshot ────────────────────────────────────────────────────────
  const screenshot = await captureScreenshot(page, "desktop");

  // ── DOM + styles + responsive data + design evidence ────────────────
  const domData        = await extractDomData(page, cfg);
  const responsiveData = await extractResponsiveData(page, vp, cfg);
  const designEvidence = await extractDesignEvidence(page, cfg);

  await context.close().catch(() => {});

  // ── Classify network ──────────────────────────────────────────────────
  const scripts     = networkLog.filter(r => r.resourceType === "script");
  const stylesheets = networkLog.filter(r => r.resourceType === "stylesheet");
  const imageReqs   = networkLog.filter(r => r.resourceType === "image");
  const fontReqs    = networkLog.filter(r => r.resourceType === "font");
  const xhrReqs     = networkLog.filter(r => ["xhr","fetch"].includes(r.resourceType));
  const failedReqs  = networkLog.filter(r => r.status === 0 || r.status >= 400);
  const otherReqs   = networkLog.filter(r =>
    !["document","script","stylesheet","image","font","xhr","fetch"].includes(r.resourceType)
  );

  const hdrs    = mainResponse?.headers ?? {};
  const encoding = hdrs["content-encoding"] || "";

  return {
    url,
    finalUrl,
    domain:      new URL(finalUrl || url).hostname,
    collectedAt: new Date().toISOString(),
    mocked:      false,

    meta: {
      title:       domData.title       ?? null,
      description: domData.meta?.description ?? null,
      viewport:    domData.meta?.viewport    ?? null,
      charset:     domData.charset     ?? null,
      lang:        domData.lang        ?? null,
      ogTags:      pickOgTags(domData.meta ?? {}),
    },

    httpResponse: {
      finalUrl,
      statusCode:          mainResponse?.status ?? null,
      server:              hdrs["server"]        || null,
      compressionEnabled:  encoding.includes("gzip") || encoding.includes("br"),
      cacheControl:        hdrs["cache-control"] || null,
      http2:               url.startsWith("https://"),
      navDurationMs,
      navError,
    },

    resources: {
      totalRequests:  networkLog.length,
      scripts:        scripts.length,
      stylesheets:    stylesheets.length,
      images:         imageReqs.length,
      fonts:          fontReqs.length,
      xhr:            xhrReqs.length,
      other:          otherReqs.length,
      totalTransferSize: networkLog.reduce((s, r) =>
        s + (safeGet(() => r.timing?.responseBodySize) ?? 0), 0),
      scriptUrls:     scripts.map(r => r.url).slice(0, cfg.maxPerType),
      stylesheetUrls: stylesheets.map(r => r.url).slice(0, cfg.maxPerType),
      imageUrls:      imageReqs.map(r => r.url).slice(0, cfg.maxPerType),
    },

    network: {
      allRequests:    networkLog.slice(0, cfg.maxRequests),
      xhrRequests:    xhrReqs.slice(0, cfg.maxPerType),
      failedRequests: failedReqs.slice(0, cfg.maxPerType),
      consoleErrors:  consoleLog.filter(m => m.type === "error").slice(0, cfg.maxConsoleMessages),
    },

    dom:            domData.dom      ?? {},
    elements:       domData.elements ?? {},
    rendering:      domData.rendering ?? {},
    styledElements: domData.styledElements ?? [],
    visibleText:    domData.visibleText ?? "",
    designEvidence,  // rich multi-instance style + layout data for designAnalyzer
    appSignatures:  domData.appSignatures ?? {}, // framework/embed markers for applicationProfiler

    // Top-level screenshot kept for backward compat
    screenshot,

    // Viewport data (desktop filled here; tablet/mobile merged later)
    viewports: {
      desktop: {
        viewport:    vp,
        screenshot,
        ...responsiveData,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewport pass — lightweight: navigate + screenshot + responsive checks only
// ─────────────────────────────────────────────────────────────────────────────

async function collectViewportPass(browser, url, vpName, cfg) {
  const vp = VIEWPORTS[vpName];

  const context = await browser.newContext({
    viewport:          vp,
    userAgent:         vpName === "mobile"
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (compatible; FrontendQualityAnalyzer/1.0)",
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout:   cfg.navigationTimeoutMs,
    }).catch((err) => {
      logger.warn(`[browserCollector] ${vpName} navigation error`, { error: err.message });
    });

    await page.waitForTimeout(1_000).catch(() => {});

    const screenshot     = await captureScreenshot(page, vpName);
    const responsiveData = await extractResponsiveData(page, vp, cfg);

    return { viewport: vp, screenshot, ...responsiveData };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Responsive data extraction (in-page evaluate)
// ─────────────────────────────────────────────────────────────────────────────

async function extractResponsiveData(page, vp, cfg) {
  return page.evaluate(
    ({ vpWidth, vpHeight, maxOverflow }) => {
      const docW = Math.max(
        document.body?.scrollWidth    ?? 0,
        document.documentElement?.scrollWidth ?? 0,
      );
      const docH = Math.max(
        document.body?.scrollHeight   ?? 0,
        document.documentElement?.scrollHeight ?? 0,
      );

      const hasHorizontalOverflow = docW > vpWidth;
      const overflowAmount        = Math.max(0, docW - vpWidth);

      // Elements wider than viewport
      const widerThanViewport = [];
      document.querySelectorAll("*").forEach((el) => {
        if (widerThanViewport.length >= maxOverflow) return;
        try {
          const r = el.getBoundingClientRect();
          if (r.width > vpWidth + 2) {          // +2px tolerance
            widerThanViewport.push({
              tag:   el.tagName,
              id:    el.id   || null,
              class: (el.className || "").toString().split(" ").slice(0, 3).join(" ") || null,
              width: Math.round(r.width),
              left:  Math.round(r.left),
            });
          }
        } catch { /* ignore */ }
      });

      // Elements extending outside the right edge of viewport
      const outsideViewport = [];
      document.querySelectorAll("*").forEach((el) => {
        if (outsideViewport.length >= maxOverflow) return;
        try {
          const r = el.getBoundingClientRect();
          if (r.right > vpWidth + 2) {
            outsideViewport.push({
              tag:   el.tagName,
              id:    el.id   || null,
              class: (el.className || "").toString().split(" ").slice(0, 3).join(" ") || null,
              right: Math.round(r.right),
            });
          }
        } catch { /* ignore */ }
      });

      // Obvious overlaps (elements sharing same area as a sibling)
      const overlaps = [];
      const siblings = Array.from(document.querySelectorAll("body > * > *")).slice(0, 60);
      for (let i = 0; i < siblings.length && overlaps.length < 10; i++) {
        for (let j = i + 1; j < siblings.length && overlaps.length < 10; j++) {
          try {
            const a = siblings[i].getBoundingClientRect();
            const b = siblings[j].getBoundingClientRect();
            if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) continue;
            const overlapX = Math.min(a.right,  b.right)  - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top,  b.top);
            if (overlapX > 4 && overlapY > 4) {
              overlaps.push({
                elementA: siblings[i].tagName + (siblings[i].id ? `#${siblings[i].id}` : ""),
                elementB: siblings[j].tagName + (siblings[j].id ? `#${siblings[j].id}` : ""),
                overlapPx: { x: Math.round(overlapX), y: Math.round(overlapY) },
              });
            }
          } catch { /* ignore */ }
        }
      }

      // Small tap targets (< 44×44 px) on interactive elements
      const smallTapTargets = [];
      document.querySelectorAll("a,button,[role=button],input,select,textarea").forEach((el) => {
        if (smallTapTargets.length >= maxOverflow) return;
        try {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
            smallTapTargets.push({
              tag:    el.tagName,
              text:   (el.innerText || el.getAttribute("aria-label") || "").slice(0, 40),
              width:  Math.round(r.width),
              height: Math.round(r.height),
            });
          }
        } catch { /* ignore */ }
      });

      // Fixed-width layout detection
      // Look for elements using px widths > viewport width in inline styles or
      // whose computed width exceeds viewport
      const fixedWidthProblems = [];
      document.querySelectorAll("[style*='width']").forEach((el) => {
        if (fixedWidthProblems.length >= maxOverflow) return;
        try {
          const match = (el.getAttribute("style") || "").match(/width\s*:\s*(\d+)px/);
          if (match) {
            const pxW = parseInt(match[1], 10);
            if (pxW > vpWidth) {
              fixedWidthProblems.push({
                tag:        el.tagName,
                inlineWidth: pxW,
                viewport:   vpWidth,
              });
            }
          }
        } catch { /* ignore */ }
      });

      // Visible element count at this viewport
      let visibleCount = 0;
      document.querySelectorAll("*").forEach((el) => {
        try {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 &&
              r.top < vpHeight && r.bottom > 0 &&
              r.left < vpWidth && r.right > 0) {
            visibleCount++;
          }
        } catch { /* ignore */ }
      });

      return {
        documentDimensions: { width: docW, height: docH },
        visibleElementCount: visibleCount,
        hasHorizontalOverflow,
        overflowAmount,
        widerThanViewport,
        outsideViewport,
        overlaps,
        smallTapTargets,
        fixedWidthProblems,
      };
    },
    { vpWidth: vp.width, vpHeight: vp.height, maxOverflow: cfg.maxOverflowElements }
  ).catch((err) => {
    logger.warn("[browserCollector] Responsive evaluate failed", { error: err.message });
    return {
      documentDimensions: null,
      visibleElementCount: null,
      hasHorizontalOverflow: null,
      overflowAmount: null,
      widerThanViewport: [],
      outsideViewport: [],
      overlaps: [],
      smallTapTargets: [],
      fixedWidthProblems: [],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Full DOM + styles extraction (desktop only)
// ─────────────────────────────────────────────────────────────────────────────

async function extractDomData(page, cfg) {
  return page.evaluate(
    ({ maxPerType, maxStyledElements, maxTextChars }) => {

      function getStyles(el) {
        try {
          const cs = window.getComputedStyle(el);
          const r  = el.getBoundingClientRect();
          return {
            fontFamily:      cs.fontFamily,
            fontSize:        cs.fontSize,
            fontWeight:      cs.fontWeight,
            color:           cs.color,
            backgroundColor: cs.backgroundColor,
            margin:          cs.margin,
            padding:         cs.padding,
            borderRadius:    cs.borderRadius,
            width:           cs.width,
            height:          cs.height,
            x:               Math.round(r.x),
            y:               Math.round(r.y),
          };
        } catch { return null; }
      }

      function isVisible(el) {
        try {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        } catch { return false; }
      }

      // Meta tags
      const metaObj = {};
      document.querySelectorAll("meta").forEach((m) => {
        const name = m.getAttribute("name") || m.getAttribute("property");
        if (name) metaObj[name] = m.getAttribute("content") || "";
      });

      // Headings
      const headings = [];
      document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
        if (headings.length >= maxPerType) return;
        headings.push({ tag: h.tagName, text: h.innerText.trim().slice(0, 120) });
      });

      // Links
      const links = [];
      document.querySelectorAll("a[href]").forEach((a) => {
        if (links.length >= maxPerType) return;
        links.push({
          text: a.innerText.trim().slice(0, 80),
          href: a.getAttribute("href"),
          rel:  a.getAttribute("rel") || null,
        });
      });

      // Buttons
      const buttons = [];
      document.querySelectorAll("button,input[type=button],input[type=submit],input[type=reset],[role=button]").forEach((b) => {
        if (buttons.length >= maxPerType) return;
        buttons.push({
          tag:  b.tagName,
          text: (b.innerText || b.getAttribute("value") || "").trim().slice(0, 80),
          type: b.getAttribute("type") || null,
        });
      });

      // Forms
      const forms = [];
      document.querySelectorAll("form").forEach((f) => {
        if (forms.length >= maxPerType) return;
        const inputs = Array.from(f.querySelectorAll("input,select,textarea"))
          .slice(0, 20)
          .map((i) => ({
            tag:         i.tagName,
            type:        i.getAttribute("type") || null,
            name:        i.getAttribute("name") || null,
            placeholder: i.getAttribute("placeholder") || null,
            hasLabel:    !!document.querySelector(`label[for="${i.id}"]`) || !!i.closest("label"),
          }));
        forms.push({
          action: f.getAttribute("action") || null,
          method: f.getAttribute("method") || "get",
          inputs,
        });
      });

      // Images
      const images = [];
      document.querySelectorAll("img").forEach((img) => {
        if (images.length >= maxPerType) return;
        images.push({
          src:     img.getAttribute("src") || "",
          alt:     img.getAttribute("alt"),
          hasAlt:  img.hasAttribute("alt"),
          loading: img.getAttribute("loading") || null,
          width:   img.naturalWidth  || img.getAttribute("width")  || null,
          height:  img.naturalHeight || img.getAttribute("height") || null,
        });
      });

      // Iframes — embedded BI/report platforms (e.g. Power BI) are almost
      // always surfaced through an <iframe src="..."> embed.
      const iframes = [];
      document.querySelectorAll("iframe").forEach((f) => {
        if (iframes.length >= maxPerType) return;
        iframes.push({
          src:   f.getAttribute("src") || "",
          title: f.getAttribute("title") || null,
        });
      });

      // App/framework signatures — deterministic markers used by the
      // Target/Application Profiler to classify the site (standard-web vs.
      // an embedded BI/analytics platform). Cheap, one-pass DOM checks only.
      const customElementTags = [...new Set(
        Array.from(document.querySelectorAll("*"))
          .map((el) => el.tagName.toLowerCase())
          .filter((t) => t.includes("-"))
      )].slice(0, 20);

      const appSignatures = {
        hasReactRoot: !!(
          (document.querySelector("#root") && document.querySelector("#root").children.length) ||
          document.querySelector("[data-reactroot]") ||
          document.querySelector("#__next")
        ),
        hasVueApp: !!(
          document.querySelector("[data-v-app]") ||
          Array.from(document.querySelectorAll("*")).some((el) =>
            Array.from(el.attributes).some((a) => a.name.startsWith("data-v-"))
          )
        ),
        hasAngular: !!document.querySelector("[ng-version]"),
        hasSvelte:  !!document.querySelector("[class*='svelte-']"),
        generator:  document.querySelector('meta[name="generator"]')?.getAttribute("content") || null,
        customElementTags,
        // Application-specific HTML markers for known embed platforms.
        hasPowerBiEmbedMarkers: !!(
          document.querySelector('[class*="powerbi-embed"]') ||
          document.querySelector("#reportContainer") ||
          document.querySelector("[data-embed-type]")
        ),
      };

      // Computed styles
      const styleTargets = ["p","h1","h2","a","button","input","nav","header","main","footer"];
      const styledElements = [];
      for (const sel of styleTargets) {
        if (styledElements.length >= maxStyledElements) break;
        const el = document.querySelector(sel);
        if (el && isVisible(el)) {
          const styles = getStyles(el);
          if (styles) styledElements.push({ selector: sel, styles });
        }
      }
      document.querySelectorAll("div,span,li").forEach((el) => {
        if (styledElements.length >= maxStyledElements) return;
        if ((el.innerText?.trim().length ?? 0) > 10 && isVisible(el)) {
          const styles = getStyles(el);
          if (styles) styledElements.push({ selector: el.tagName.toLowerCase(), styles });
        }
      });

      // a11y signals
      const imagesWithoutAlt   = document.querySelectorAll("img:not([alt])").length;
      const inputsWithoutLabel = Array.from(document.querySelectorAll("input:not([type=hidden])"))
        .filter((i) => !document.querySelector(`label[for="${i.id}"]`) && !i.closest("label")).length;
      const hasSkipLink  = !!document.querySelector('a[href^="#main"],a[href^="#content"],.skip-link,[class*="skip"]');
      const hasMissingH1 = document.querySelectorAll("h1").length === 0;

      const hTags = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => parseInt(h.tagName[1]));
      let missingHeadingHierarchy = false;
      for (let i = 1; i < hTags.length; i++) {
        if (hTags[i] - hTags[i - 1] > 1) { missingHeadingHierarchy = true; break; }
      }

      // Rendering hints
      const blockingScripts = Array.from(document.querySelectorAll("script[src]"))
        .filter((s) => !s.hasAttribute("async") && !s.hasAttribute("defer") && s.closest("head")).length;
      const blockingCSS = Array.from(document.querySelectorAll("link[rel=stylesheet]"))
        .filter((l) => !l.getAttribute("media") || l.getAttribute("media") === "all").length;
      const lazyImages  = document.querySelectorAll("img[loading=lazy]").length;
      const totalImages = document.querySelectorAll("img").length;

      // DOM depth (sample)
      const allEls   = document.querySelectorAll("*");
      const totalEls = allEls.length;
      let maxDepth   = 0;
      Array.from(allEls).slice(0, 50).forEach((el) => {
        let d = 0, cur = el;
        while (cur.parentElement) { d++; cur = cur.parentElement; }
        if (d > maxDepth) maxDepth = d;
      });

      // Visible text
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, maxTextChars);

      return {
        title:   document.title,
        lang:    document.documentElement.getAttribute("lang") || null,
        charset: document.characterSet || null,
        meta:    metaObj,
        dom: {
          totalElements: totalEls, depth: maxDepth,
          imagesWithoutAlt, inputsWithoutLabel, hasSkipLink, hasMissingH1,
          missingHeadingHierarchy,
          interactiveElements: buttons.length + forms.reduce((s, f) => s + f.inputs.length, 0),
        },
        elements:       { headings, links, buttons, forms, images, iframes },
        styledElements,
        rendering:      { renderBlockingScripts: blockingScripts, renderBlockingStylesheets: blockingCSS, lazyLoadedImages: lazyImages, totalImages },
        visibleText:    bodyText,
        appSignatures,
      };
    },
    { maxPerType: cfg.maxPerType, maxStyledElements: cfg.maxStyledElements, maxTextChars: cfg.maxTextChars }
  ).catch((err) => {
    logger.warn("[browserCollector] DOM evaluate failed", { error: err.message });
    return {};
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Design evidence extraction — multi-instance computed styles + layout data
// ─────────────────────────────────────────────────────────────────────────────

async function extractDesignEvidence(page, cfg) {
  return page.evaluate(({ maxPerType }) => {

    // ── Helpers ──────────────────────────────────────────────────────────
    function cs(el) { return window.getComputedStyle(el); }
    function bb(el) { return el.getBoundingClientRect(); }
    function visible(el) {
      try { const r = bb(el); return r.width > 0 && r.height > 0; } catch { return false; }
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    function pxInt(str) {
      const n = parseFloat(str);
      return isNaN(n) ? null : Math.round(n);
    }
    function firstClass(el) {
      return (el.className || "").toString().trim().split(/\s+/).slice(0, 3).join(" ") || null;
    }

    // ── Typography samples — ALL matching visible elements (capped) ──────
    function sampleTypography(selector, cap) {
      const results = [];
      document.querySelectorAll(selector).forEach((el) => {
        if (results.length >= cap || !visible(el)) return;
        const s = cs(el);
        results.push({
          tag:             el.tagName,
          class:           firstClass(el),
          fontFamily:      s.fontFamily,
          fontSize:        s.fontSize,
          fontWeight:      s.fontWeight,
          lineHeight:      s.lineHeight,
          color:           s.color,
          backgroundColor: s.backgroundColor,
          textAlign:       s.textAlign,
        });
      });
      return results;
    }

    // ── Component geometry — bounding box + padding + radius ─────────────
    function sampleComponents(selector, cap) {
      const results = [];
      document.querySelectorAll(selector).forEach((el) => {
        if (results.length >= cap || !visible(el)) return;
        const s  = cs(el);
        const r  = bb(el);
        results.push({
          tag:             el.tagName,
          class:           firstClass(el),
          x:               Math.round(r.x),
          y:               Math.round(r.y),
          width:           Math.round(r.width),
          height:          Math.round(r.height),
          paddingTop:      pxInt(s.paddingTop),
          paddingRight:    pxInt(s.paddingRight),
          paddingBottom:   pxInt(s.paddingBottom),
          paddingLeft:     pxInt(s.paddingLeft),
          marginTop:       pxInt(s.marginTop),
          marginBottom:    pxInt(s.marginBottom),
          borderRadius:    s.borderRadius,
          fontSize:        s.fontSize,
          fontWeight:      s.fontWeight,
          color:           s.color,
          backgroundColor: s.backgroundColor,
          display:         s.display,
        });
      });
      return results;
    }

    // ── Gap analysis: vertical gaps between consecutive same-type siblings ─
    function measureGaps(selector, cap) {
      const gaps = [];
      const els  = Array.from(document.querySelectorAll(selector))
        .filter(visible)
        .sort((a, b) => bb(a).top - bb(b).top)
        .slice(0, cap);
      for (let i = 1; i < els.length; i++) {
        const prev = bb(els[i - 1]);
        const curr = bb(els[i]);
        const gap  = Math.round(curr.top - prev.bottom);
        if (gap >= 0 && gap < 500) gaps.push(gap);  // ignore negative (overlap) and huge gaps
      }
      return gaps;
    }

    // ── Left-edge alignment: x positions of same-type elements ───────────
    function measureAlignment(selector, cap) {
      return Array.from(document.querySelectorAll(selector))
        .filter(visible)
        .slice(0, cap)
        .map(el => Math.round(bb(el).x));
    }

    // ── Clipped content: elements where scrollHeight > clientHeight ───────
    const clipped = [];
    document.querySelectorAll("div,section,article,aside,td,li").forEach((el) => {
      if (clipped.length >= 20 || !visible(el)) return;
      try {
        if (el.scrollHeight > el.clientHeight + 4 && cs(el).overflow === "hidden") {
          const r = bb(el);
          clipped.push({
            tag:          el.tagName,
            class:        firstClass(el),
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            x: Math.round(r.x), y: Math.round(r.y),
          });
        }
      } catch { /* ignore */ }
    });

    const CAP = Math.min(maxPerType, 60);

    return {
      // Typography multi-instance samples
      typography: {
        body:     sampleTypography("p,li,td,dd",            CAP),
        headings: sampleTypography("h1,h2,h3,h4,h5,h6",    CAP),
        links:    sampleTypography("a",                      CAP),
        labels:   sampleTypography("label,legend,th,dt",    CAP),
        code:     sampleTypography("code,pre,kbd",           20),
      },

      // Component geometry
      components: {
        buttons:  sampleComponents("button,input[type=submit],input[type=button],[role=button]", CAP),
        inputs:   sampleComponents("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea", CAP),
        cards:    sampleComponents("article,[class*=card],[class*=Card],[class*=item],[class*=Item]", CAP),
        listItems: sampleComponents("li",                   CAP),
        navLinks: sampleComponents("nav a",                 CAP),
        headings: sampleComponents("h1,h2,h3,h4,h5,h6",    CAP),
        images:   sampleComponents("img",                   CAP),
      },

      // Gap / spacing between repeated elements
      gaps: {
        betweenListItems: measureGaps("li",             40),
        betweenCards:     measureGaps("[class*=card],[class*=Card],[class*=item]", 30),
        betweenHeadings:  measureGaps("h1,h2,h3,h4,h5,h6", 20),
        betweenButtons:   measureGaps("button,[role=button]", 20),
        betweenInputs:    measureGaps("input:not([type=hidden]),select,textarea", 20),
      },

      // Alignment: left-edge x positions
      alignment: {
        buttons:   measureAlignment("button,[role=button]",  30),
        inputs:    measureAlignment("input:not([type=hidden]),select", 30),
        headings:  measureAlignment("h1,h2,h3,h4,h5,h6",    20),
        paragraphs: measureAlignment("p",                    20),
      },

      // Clipped content
      clippedElements: clipped,
    };

  }, { maxPerType: cfg.maxPerType }).catch((err) => {
    // Design evidence is best-effort — never fail the whole collection
    return {
      typography: { body: [], headings: [], links: [], labels: [], code: [] },
      components: { buttons: [], inputs: [], cards: [], listItems: [], navLinks: [], headings: [], images: [] },
      gaps:       { betweenListItems: [], betweenCards: [], betweenHeadings: [], betweenButtons: [], betweenInputs: [] },
      alignment:  { buttons: [], inputs: [], headings: [], paragraphs: [] },
      clippedElements: [],
      error: err.message,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot helper
// ─────────────────────────────────────────────────────────────────────────────

async function captureScreenshot(page, vpName) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false, timeout: 5_000 });
    return { format: "jpeg", encoding: "base64", viewport: vpName, data: buf.toString("base64") };
  } catch (err) {
    logger.warn(`[browserCollector] Screenshot failed (${vpName})`, { error: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeGet(fn) { try { return fn(); } catch { return null; } }

function filterHeaders(headers) {
  const KEEP = ["content-type","content-encoding","server","cache-control","x-powered-by"];
  return Object.fromEntries(Object.entries(headers).filter(([k]) => KEEP.includes(k)));
}

function pickOgTags(meta) {
  return Object.fromEntries(
    Object.entries(meta).filter(([k]) => k.startsWith("og:") || k.startsWith("twitter:"))
  );
}
