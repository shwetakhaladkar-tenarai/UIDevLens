# Flawed Demo Site

A deliberately broken website used to prove the analyzer detects real issues.

## Run it

```bash
cd demo-site
node server.js            # serves http://localhost:4173
# optional: DEMO_PORT=5000 node server.js
```

No dependencies — plain Node.js.

## Analyze it (development only)

The production SSRF rules **block localhost**. To analyze the local demo site,
start the backend with the dev-only escape hatch enabled:

```bash
cd backend
ALLOW_LOCAL_TARGETS=true npm start
```

Then in the dashboard, analyze: `http://localhost:4173`

> ⚠️ `ALLOW_LOCAL_TARGETS=true` relaxes SSRF protection for local targets.
> Use it only in development. Never set it in production.

## Intentional issues (what the analyzer should find)

| # | Issue | Where |
|---|-------|-------|
| 1 | Oversized, unoptimized image (1600×1200 PNG, no dimensions, no lazy-load) | `index.html` `.hero-img`, `server.js` `/big-image.png` |
| 2 | Image missing `alt` text | `index.html` `.hero-img` |
| 3 | Poor color contrast (#b8b8b8 on white ≈ 2.3:1) | `styles.css` `.low-contrast` |
| 4 | Inconsistent button styles (3 different looks) | `styles.css` `.btn-*` |
| 5 | Inconsistent button padding | `styles.css` `.btn-primary/secondary/weird` |
| 6 | Inconsistent typography (Georgia / Courier / Times / Arial mix) | `styles.css` `.brand`, `.hero-title`, `.odd-font` |
| 7 | Odd font size (9px, 13.5px) | `styles.css` `.tiny-text`, `.odd-font` |
| 8 | Inconsistent spacing between cards | `styles.css` `.card-a/b/c` |
| 9 | Horizontal overflow on mobile (fixed 1200px block) | `styles.css` `.wide-block` |
| 10 | Layout shift (late-injected banner) | `app.js` `#late-content` |
| 11 | Duplicate API request (`/api/products` ×3) | `app.js` `loadProducts()` |
| 12 | Intentionally slow API (~2.5s) | `app.js` `/api/slow`, `server.js` |
| 13 | Console warning + error | `app.js` top |
| 14 | Unnecessary/unused JavaScript | `unused.js` |
| 15 | Accessibility violations (no `<main>`, no skip link, heading skip h1→h3, unlabeled input, icon link with no accessible name) | `index.html` |
| 16 | Broken internal link (404) | `index.html` `#functional-demo` → `/this-page-does-not-exist` |
| 17 | Broken external link (404) | `index.html` `#functional-demo` → `https://example.com/definitely-not-a-real-page-xyz123` |
| 18 | Broken redirect chain (302 → 404) | `server.js` `/old-promo`, linked from `#functional-demo` |
| 19 | Working redirect (contrast case) | `server.js` `/promo` (301 → `/`) |
| 20 | Dead button — looks interactive, no handler attached | `index.html`/`app.js` `#dead-btn` ("Refresh data") |
| 21 | Destructive-looking button — must never be auto-clicked | `index.html`/`app.js` `#delete-account-btn` ("Delete Account") |
| 22 | Working button (contrast case — reveals a hidden panel) | `index.html`/`app.js` `#reveal-btn` |
| 23 | Required-looking field missing the `required` attribute | `index.html` `.contact-form` "Full Name \*" |
| 24 | Correctly-marked required field (contrast case) | `index.html` `.contact-form` "Email" |

Issues 16–24 are fixtures for the Python functional validators (`python-validation/functional/*.py`) — broken links/navigation, dead/destructive buttons, and missing required-field validation — each paired with a matching "working" case so the validators can be checked for false positives too.

Every issue above is deliberate — this page is **not** an example of good practice.
