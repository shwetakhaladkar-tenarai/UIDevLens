# Python Validation Engine

Dedicated **deterministic** validation layer for the AI-Powered UI Quality Validation Agent.

This package **does not** call OpenAI and **does not** make AI decisions. It returns structured evidence. Node.js + Express + LangGraph remain the orchestration and reasoning layer.

## Architecture

```text
React Dashboard
  → Node.js + Express API
    → LangGraph AI Validation Agent
      → Target/Application Profiler
        → Rule Profile Selector
          → Custom Python Validation Engine   ← this folder
            → Functional / Accessibility / Responsive /
              Cross-Browser / Performance / UI Consistency
          → Structured Evidence
        → Normalized Findings
      → OpenAI Reasoning
    → Final Report
```

## Run

From this directory (`python-validation/`):

```bash
python runner.py '{"url":"https://example.com","targetType":"standard-web","checks":["functional","accessibility","responsive"]}'
```

Or from a file:

```bash
python runner.py --input payload.json
```

Or stdin:

```bash
echo '{"url":"https://example.com","checks":["design"]}' | python runner.py
```

Install (required for `functional` checks — they use real Chromium automation via Playwright; the other check groups are still mocked and need only the stdlib):

```bash
pip install -r requirements.txt
python -m playwright install chromium
```

## Request format

```json
{
  "url": "https://example.com",
  "targetType": "standard-web",
  "checks": [
    "functional",
    "accessibility",
    "responsive"
  ]
}
```

Supported `checks` values:

- `functional`
- `accessibility`
- `responsive`
- `cross_browser`
- `performance`
- `design`

Optional `options` object: `timeout_ms`, `viewport_width`, `viewport_height`, `wcagLevel` (`"A"` or `"AA"`, default `"AA"` — see [Accessibility validation](#accessibility-validation-real) below).

## Response format

```json
{
  "status": "success",
  "findings": [],
  "metrics": {},
  "warnings": [],
  "errors": []
}
```

`status` is `success`, `partial`, or `error`.

Each finding includes `id`, `category`, `severity`, `title`, `description`, `evidence`, `recommendation`, `confidence`, `source`, and `mocked`.

## Functional validation (real)

`functional/*.py` use a real, shared Chromium session (`common/browser.py`, Playwright) — one navigation per run, with console/network/error listeners attached before load. Each module returns findings shaped as:

```json
{
  "id": "functional-link-1",
  "category": "functional",
  "severity": "high",
  "title": "Broken internal navigation link",
  "description": "...",
  "evidence": {},
  "confidence": 0.9,
  "source": "python-functional"
}
```

| Module | Detects |
| --- | --- |
| `links.py` | Broken/unreachable links (4xx/5xx, DNS/connection failures), broken redirect chains, broken internal navigation — via safe HTTP HEAD/GET only, never a full navigation |
| `buttons.py` | Buttons/controls that look interactive but produce no observable effect when clicked, and controls that fail to click at all — **safe controls only**, see below |
| `forms.py` | Required-looking fields missing `required`/`aria-required`, and forms whose `checkValidity()` passes despite empty required fields — inspected via the Constraint Validation API only, **never submitted** |
| `navigation.py` | Broken/redirect-broken links inside `<nav>` elements, plus a real-browser render check for a small sample of internal nav destinations |
| `console_errors.py` | Console errors, uncaught exceptions, failed network requests, and HTTP error responses observed during load + the other functional checks |
| `states.py` | Heuristic: stuck loading indicators, error states visible without user action |

**Safe-interaction policy** (`common/safe_interaction.py`), enforced by `buttons.py`/`forms.py`: never clicks/submits a control inside a `<form>` or of `type="submit"`, and never clicks anything whose text/aria-label/title/name matches a destructive or irreversible action — delete, remove, purchase, buy, pay/payment, checkout, logout/sign out, unsubscribe, deactivate, cancel subscription/account, etc. Such controls are counted as skipped, never as failures. `common/browser.py` also auto-dismisses any `alert()`/`confirm()`/`prompt()` dialog so a safe click can never hang the run.

If Playwright (or its Chromium binary) isn't installed, every `functional/*.py` module degrades to its previous mocked placeholder (with a warning) instead of crashing the run — see `common/browser.py`'s `open_session`.

## Accessibility validation (real)

`accessibility/wcag_validator.py` runs deterministic WCAG checks against the same shared Chromium page. It supports a configurable conformance target level — `"A"` or `"AA"` (default `"AA"`) — passed via `options.wcagLevel`; in the full pipeline this comes from the selected rule profile's `accessibility.level` (`rule-profiles/*.json`), never hardcoded in the validator.

**This is a partial, automated check — it never claims full WCAG compliance.** Every run separates results into two lists:

- `automatedFindings` — measurable, deterministic violations, each shaped as:

  ```json
  {
    "id": "accessibility-1",
    "category": "accessibility",
    "standard": "WCAG",
    "level": "AA",
    "rule": "WCAG 1.4.3 Contrast (Minimum)",
    "severity": "high",
    "selector": "p.low-contrast",
    "description": "...",
    "recommendation": "...",
    "evidence": {},
    "confidence": 0.8
  }
  ```

- `manualReviewRecommendations` — items that need a human to judge (e.g. generic link text, no `<nav>` found, no skip link found). **Never counted as violations and never scored** — surfaced separately in `ValidationResult.metrics.manualReviewRecommendations`, and from there into the final Node report's `metadata.accessibility`.

Checks: missing `alt` text, form labels, accessible button/link names, color contrast (**AA only** — 1.4.3 doesn't apply at Level A), heading structure, document `lang`, ARIA misuse (invalid roles, dangling `aria-labelledby`/`describedby`, focusable content inside `aria-hidden`), duplicate ids, keyboard focus (tabindex misuse + real `.focus()`-based focusability), focus visibility (**AA only** — 2.4.7), and landmarks (`<main>`/`<nav>`/skip link).

Like the functional validators, `wcag_validator.py` degrades to its mocked placeholder if Playwright isn't available.

## Cross-browser validation (real)

`responsive/cross_browser_validator.py` independently launches and navigates each configured browser engine — Chromium, Firefox, and/or WebKit — via Playwright Python. Which engines run is driven by `options.browsers`; in the full pipeline this comes from the selected rule profile's `browsers` array (`rule-profiles/*.json`), never hardcoded here. `python -m playwright install firefox webkit` (in addition to `chromium`) is required.

Per browser it collects page load status, console errors, failed requests, DOM dimensions, visible interactive elements, a JPEG screenshot (base64), horizontal overflow, clipped content, and element overlap, then returns exactly:

```json
{
  "chromium": { "status": "pass", "findings": [] },
  "firefox":  { "status": "issues", "findings": [] },
  "webkit":   { "status": "issues", "findings": [] }
}
```

(each browser's object also carries `screenshot`, `pageLoadStatus`, `domDimensions`, and summary counts.)

**Two distinct kinds of findings, so ordinary rendering variance is never reported as a failure:**
- *Absolute per-browser facts* — page load failures, HTTP errors, console/runtime errors, failed requests — reported for whichever browser(s) actually exhibit them. The per-browser structure itself IS the comparison: if every browser shares an issue, every browser's findings say so; if only one does, only that one's does.
- *Comparison-only findings* — missing/hidden controls, horizontal overflow, clipped content, overlap, gross layout-height divergence — these are **not** inherently bugs in isolation (a page overflowing identically in all 3 browsers is a responsive-design issue, out of scope here). They're only raised when a browser disagrees with a Chromium baseline (or the first browser tested, if Chromium wasn't requested) — e.g. "control visible in Chromium but missing in Firefox", "horizontal overflow only appears in Firefox".

If the shared browser session (used by `functional`/`accessibility`) is already running, this module reuses its Playwright driver connection instead of starting a second one — Playwright's sync API only allows one per process. Degrades to its mocked placeholder if Playwright isn't installed at all.

## Responsive validation (real)

`responsive/responsive_validator.py` tests every configured **browser × viewport** combination (a full matrix, not just browsers). Both come from the selected rule profile — `browsers` (`rule-profiles/*.json`, same as cross-browser) and `viewports` (default `desktop 1440×900`, `tablet 768×1024`, `mobile 390×844`) — via `options.browsers`/`options.viewports`, never hardcoded.

Per combination it checks: horizontal scrolling (document width vs. viewport width), off-screen buttons/forms, clipped content, text overflow (visual spillage, not intentional ellipsis truncation), overlapping elements, tap targets under 44×44px, fixed-width containers wider than the viewport, and navigation usability (no visible nav links **and** no usable menu toggle). A separate pass compares the same tracked primary/CTA controls (checkout/submit/save-style buttons — never generic nav links, which legitimately collapse behind a toggle) **across viewports within one browser** to catch a control that's visible at both the smallest and largest tested viewport but mysteriously gone at one in between — a real CSS breakpoint gap, not a design choice.

Every finding is shaped as:

```json
{
  "id": "responsive-firefox-mobile-3",
  "category": "responsive",
  "browser": "firefox",
  "viewport": "mobile",
  "severity": "high",
  "title": "Checkout button outside viewport",
  "description": "...",
  "recommendation": "...",
  "evidence": { "viewportWidth": 390, "rightEdge": 436 },
  "confidence": 0.75,
  "source": "python-responsive"
}
```

**Every threshold has an explicit tolerance** so ordinary sub-pixel rendering noise is never reported: horizontal overflow must exceed 10px, off-screen/clip/overlap must exceed 4px, tap targets must be under 40px (not exactly 44), fixed-width containers must exceed the viewport by more than 8px, and a cross-viewport layout-height comparison (in `cross_browser_validator.py`) requires a >20% divergence.

Same shared-driver-reuse and mocked-fallback behavior as the other real Playwright validators.

## Load benchmarking (real, opt-in only)

`performance/load_benchmark.py` covers the second performance category — concurrent-user / load benchmarking — as a companion to the existing (still-mocked) `frontend_metrics.py` and the real, Lighthouse-based Node-side performance analysis (kept as-is; this doesn't touch it).

**This sends real concurrent HTTP requests at the target and NEVER runs automatically.** It requires BOTH flags to be the literal boolean `true` in the selected rule profile's `performance.loadTest`:

```json
{
  "loadTest": {
    "enabled": true,
    "approved": true,
    "users": [10, 100, 500, 1000],
    "durationSeconds": 60,
    "thresholds": { "p95ResponseTimeMs": 2000, "errorRatePercent": 1 }
  }
}
```

- `enabled` — load testing is being considered at all for this profile.
- `approved` — the operator's explicit attestation that they are authorized to load-test this exact target (their own staging/production, or a target they otherwise have permission to test). **Every rule profile in `rule-profiles/*.json` ships with both `false` by default** — a target is only load-tested if someone deliberately edits a profile to opt in.

If `approved` is anything other than the literal `true` (missing, `false`, or even the string `"true"`), the module returns immediately with `loadTest.executed: false` and a warning — never partial execution. `common/config.py` sanitizes this config on the way in; `load_benchmark.py` independently re-checks both flags itself, so a bug upstream can never silently enable it.

**Hard safety caps apply regardless of configuration** (a misconfigured `durationSeconds: 3600` can never become a multi-hour test): up to 6 user levels, up to 1000 concurrent users per level, and a 60-second ceiling on **total** wall-clock time across all levels combined (the configured duration is distributed evenly across levels and clamped down, never up).

Returns metrics keyed by user count, exactly as specified:

```json
{
  "100":  { "avgResponseTimeMs": 420,  "p95ResponseTimeMs": 800,  "errorRatePercent": 0.2 },
  "1000": { "avgResponseTimeMs": 1600, "p95ResponseTimeMs": 3200, "errorRatePercent": 3.1 }
}
```

Threshold comparisons (`p95ResponseTimeMs`, `errorRatePercent`) are deterministic Python arithmetic — `check_thresholds()` — never delegated to OpenAI or any AI reasoning step.

## UI consistency validation (real)

`design/ui_consistency.py` complements (doesn't replace) the existing Node-side design analyzer (`backend/src/tools/designAnalyzer.js`, real, Lighthouse-adjacent) with an independent engine applying the same proven methodology — frequency maps, mode-relative outlier detection, explicit tolerances — ported here since Python collects its own evidence via a real Chromium page.

Analyzes: typography (font family/size/weight), text and background colors, spacing (padding/margins), border radius, repeated buttons, form controls, component dimensions (including card height variance), and alignment. Deterministic only — **never calls OpenAI** to judge consistency.

Every finding uses `category: "ui-consistency"` — a category distinct from Node's own `"design"` findings, so both engines' results appear side by side in the final report rather than one overwriting the other. Shaped as:

```json
{
  "category": "ui-consistency",
  "severity": "medium",
  "title": "Inconsistent button padding",
  "evidence": {
    "commonPadding": "10px 18px 10px 18px",
    "outlierPadding": "16px 40px 16px 40px",
    "affectedSelector": "button.btn.btn-weird"
  }
}
```

(plus `id`/`description`/`recommendation`/`confidence`/`source` for pipeline consistency with the other real validators). Outlier checks only fire when a value is both meaningfully different from the mode (beyond an explicit px tolerance) **and** genuinely rare (≤15% of samples) — a near-even 2-way or 3-way split (e.g. 3 cards each with different padding, no clear majority) is intentionally left unflagged rather than guessed at.

## Remaining mocked modules

| Check | Modules |
| --- | --- |
| performance | `frontend_metrics.py` (frontend browser performance is already covered for real by the Node-side Lighthouse analyzer) |

Shared helpers: `common/models.py`, `common/browser.py`, `common/config.py`, `common/normalization.py`, `common/logger.py`, `common/http_check.py`, `common/safe_interaction.py`.
