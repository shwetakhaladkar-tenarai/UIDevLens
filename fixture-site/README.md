# Flawed Fixture Site

A deliberately broken website used to prove the analyzer detects real issues.

## Run it

```bash
cd fixture-site
node server.js            # serves http://localhost:4173
# optional: FIXTURE_PORT=5000 node server.js
```

No dependencies — plain Node.js.

## Analyze it (development only)

The production SSRF rules **block localhost**. To analyze the local fixture site,
start the backend with the dev-only escape hatch enabled:

```bash
cd backend
ALLOW_LOCAL_TARGETS=true npm start
```

Then in the dashboard, analyze: `http://localhost:4173`

> ⚠️ `ALLOW_LOCAL_TARGETS=true` relaxes SSRF protection for local targets.
> Use it only in development. Never set it in production.

## Power BI classification fixture (`/powerbi`)

`powerbi.html` (served at `http://localhost:4173/powerbi`) is a **separate,
deliberately clean** fixture — unlike the rest of this site, it isn't full of
intentional bugs. Its purpose is to exercise
[`applicationProfiler.js`](../backend/src/profiling/applicationProfiler.js)'s
`"powerbi"` classification and [`rule-profiles/powerbi.json`](../rule-profiles/powerbi.json)
end-to-end, using **real, non-fabricated** signals rather than a mocked target
type:

- Page `<title>` mentions "Power BI"
- Real Power BI DOM markers: `#reportContainer` + `.powerbi-embed`
- The **real, official** `powerbi-client` SDK, loaded from the real jsDelivr
  CDN at a pinned version (`https://cdn.jsdelivr.net/npm/powerbi-client@2.24.1/...`)
  — not a fake/local stand-in script

There is no real Power BI workspace or embed token here (none is fabricated) —
`showStatus()` in the page's own script reports that honestly instead of
faking a rendered report. The SDK itself may still log its own console
warnings/network attempts when initialized without a real embed config; that's
genuine third-party SDK behavior this fixture doesn't suppress, not an
intentional bug like the rest of this site.

Analyzing `http://localhost:4173/powerbi` should classify as `targetType:
"powerbi"` with high confidence, select the `powerbi-v1` rule profile, and
show `uiConsistency: {"status":"not-run"}` in the scores (that profile
disables it) while every other category scores normally.

## Safety & determinism

Every issue on this page is **safe** and **deterministic**:

- Nothing destructive is ever wired up (`#delete-account-btn` has no click
  handler and must never be auto-clicked by any automated test).
- No fixture depends on randomness, wall-clock time (beyond the one fixed
  `/api/slow` delay), or external state — the same run always produces the
  same findings.
- The one external link (`https://example.com/definitely-not-a-real-page-xyz123`)
  is deliberately a non-existent path on a stable, well-known domain, so its
  "broken" status never flips.
- The cross-browser difference (`.legacy-badge`) uses a standard CSS
  feature-detection technique (`@supports (-moz-appearance: none)`), not
  user-agent sniffing or timing — it is stable across engine versions.

This makes the site a reliable fixture for automated tests to assert exact
expected findings against.

## Intentional issues (what the analyzer should find)

Every issue below is deliberate — this page is **not** an example of good
practice. Grouped by the category the finding is expected to land in.

### Functional

| Issue | Where | Fixture for |
|---|---|---|
| Broken internal link (404) | `index.html` `#functional-demo` → `/this-page-does-not-exist` | `functional/links.py` |
| Broken external link (404) | `index.html` `#functional-demo` → `https://example.com/definitely-not-a-real-page-xyz123` | `functional/links.py` |
| Broken redirect chain (302 → 404) | `server.js` `/old-promo`, linked from `#functional-demo` | `functional/links.py` |
| Working redirect (contrast case) | `server.js` `/promo` (301 → `/`) | `functional/links.py` (false-positive check) |
| Navigation issue — broken nav link | `index.html` `.secondary-nav` → `/this-page-does-not-exist` | `functional/navigation.py` |
| Navigation issue — broken redirect nav link | `index.html` `.secondary-nav` → `/old-promo` | `functional/navigation.py` |
| Non-working safe button ("Refresh data", no handler) | `index.html`/`app.js` `#dead-btn` | `functional/buttons.py` |
| Working button (contrast case — reveals a hidden panel) | `index.html`/`app.js` `#reveal-btn` | `functional/buttons.py` (false-positive check) |
| Destructive-looking button — must never be auto-clicked | `index.html`/`app.js` `#delete-account-btn` | safe-interaction policy fixture |
| Form missing required validation (looks required, no `required` attribute) | `index.html` `.contact-form` "Full Name \*" | `functional/forms.py` |
| Correctly-marked required field (contrast case) | `index.html` `.contact-form` "Email" | `functional/forms.py` (false-positive check) |
| Console error (+ warning) on load | `app.js` top | `functional/console_errors.py` |
| Failed API request (404) | `app.js` `fetch("/api/does-not-exist")` | `functional/console_errors.py` |
| Missing error state — a failed request leaves the UI stuck loading forever, with no error ever shown | `index.html` `.loading-spinner` + `app.js` `fetch("/api/widget-stats")` | `functional/states.py` (stuck-loading detector) |
| Unexpected default error state (contrast case — visible without user action) | `index.html` `.error-banner` | `functional/states.py` (unexpected-error detector) |

### Accessibility (WCAG)

| Issue | Where | Fixture for |
|---|---|---|
| Missing `alt` text | `index.html` `.hero-img` | `wcag_validator.py` — 1.1.1 |
| Poor color contrast (#b8b8b8 on white ≈ 2.3:1, fails AA 4.5:1) | `styles.css` `.low-contrast` | `wcag_validator.py` — 1.4.3 |
| Unlabeled form field (no `<label>`/aria-label) | `index.html` `.signup input` | `wcag_validator.py` — form labels |
| Inaccessible button — no accessible name (icon only, no aria-label) | `index.html`/`styles.css` `#icon-only-btn` / `.icon-btn` | `wcag_validator.py` — 4.1.2 |
| Inaccessible link — no accessible name (icon only, no aria-label) | `index.html` `.icon-link` | `wcag_validator.py` — 2.4.4 / 4.1.2 |
| Heading hierarchy issue (h1 → h3 skip) | `index.html` `.hero-title` (h3 right after the h1) | `wcag_validator.py` — heading structure |
| No `<main>` landmark, no skip link | `index.html` (page-level) | `wcag_validator.py` — landmarks (manual review) |

### Responsive

| Issue | Where | Fixture for |
|---|---|---|
| Mobile horizontal overflow (fixed 1200px block) | `styles.css` `.wide-block` | `responsive_validator.py` — horizontal overflow |
| Clipped text (fixed-height box, `overflow: hidden`) | `index.html`/`styles.css` `.clipped-box` | `responsive_validator.py` — clipped content |
| Overlapping controls ("Save" / "Discard" deliberately overlap) | `index.html`/`styles.css` `#overlap-demo` `.overlap-a`/`.overlap-b` | `responsive_validator.py` — overlapping elements |
| Small tap target (24×24px icon button, below the 44px minimum) | `index.html`/`styles.css` `#icon-only-btn` / `.icon-btn` | `responsive_validator.py` — small tap targets |

### Cross-Browser

| Issue | Where | Fixture for |
|---|---|---|
| Controlled browser-specific styling difference — visible in Chromium/WebKit, hidden **only** in Firefox via a Firefox-only CSS feature query (`@supports (-moz-appearance: none)`) | `index.html`/`styles.css` `#legacy-badge-link` / `.legacy-badge` | `cross_browser_validator.py` — "control missing/hidden in this browser" (diffed against the Chromium baseline) |

### Performance

| Issue | Where | Fixture for |
|---|---|---|
| Large, unoptimized image (1600×1200 PNG, no dimensions, no lazy-load) | `index.html` `.hero-img`, `server.js` `/big-image.png` | Lighthouse / frontend metrics |
| Delayed API response (~2.5s) | `app.js` `/api/slow`, `server.js` | performance findings |
| Layout shift (late-injected banner with no reserved space) | `app.js` `#late-content` | Core Web Vitals (CLS) |
| Unnecessary/unused JavaScript asset | `unused.js` | Lighthouse unused-JS |
| Duplicate API request (`/api/products` ×3) | `app.js` `loadProducts()` | network findings |

### UI Consistency

| Issue | Where | Fixture for |
|---|---|---|
| Inconsistent button styles (3 different looks: color/padding/radius/font-size) | `styles.css` `.btn-primary`/`.btn-secondary`/`.btn-weird` | `ui_consistency.py` / `designAnalyzer.js` — component consistency |
| Unusual font size (9px, 13.5px) | `styles.css` `.tiny-text`, `.odd-font` | `ui_consistency.py` / `designAnalyzer.js` — typography |
| Inconsistent typography (Georgia / Courier / Times / Arial mix) | `styles.css` `.brand`, `.hero-title`, `.odd-font` | `ui_consistency.py` / `designAnalyzer.js` — typography |
| Inconsistent spacing between cards (padding + gap all differ) | `styles.css` `.card-a`/`.card-b`/`.card-c` | `ui_consistency.py` / `designAnalyzer.js` — spacing |
| Inconsistent color usage (3 different button background colors) | `styles.css` `.btn-primary`/`.btn-secondary`/`.btn-weird` | `ui_consistency.py` / `designAnalyzer.js` — color |

Issues in the Functional table with a "contrast case" or "false-positive
check" note are deliberately paired with a matching *working* case so the
validators can be checked for false positives too, not just true positives.
