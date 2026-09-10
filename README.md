# AI-Powered Frontend Quality & Performance Analyzer

A LangGraph-orchestrated AI agent that analyzes any public URL for frontend quality,
performance, design, and accessibility issues — behind a real login, as a multi-page
app with editable validation rules and local run history.

## Stack

| Layer    | Tech                                                        |
|----------|--------------------------------------------------------------|
| Frontend | React + React Router + Vite + Tailwind CSS + Recharts        |
| Backend  | Node.js + Express                                             |
| Auth     | bcryptjs (password hashing) + jsonwebtoken (session cookie)   |
| AI       | LangGraph.js + LangChain.js + OpenAI API                      |

## Project Structure

```
AI-Powered/
├── frontend/            # React + Vite app  (port 5173)
├── backend/             # Express API       (port 3001)
│   └── data/users.json  # Local user store (gitignored — created on first register)
├── rule-profiles/       # Editable validation profiles (rule-profiles/*.json)
├── python-validation/   # Deterministic Python validation engine
├── fixture-site/        # Static test-target site (incl. a Power BI fixture)
├── .env.example         # Environment template
├── .gitignore
└── README.md
```

## Quick Start

### 1. Configure environment

```bash
cp .env.example backend/.env
# Edit backend/.env:
#  - add your OPENAI_API_KEY
#  - set JWT_SECRET to a real random value (signs the session cookie):
#      node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Start the backend

```bash
cd backend
npm install
npm run dev
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Open the app

Visit [http://localhost:5173](http://localhost:5173) — you'll land on `/login`.
There's no seeded account: click **Create one** to register, which logs you in
immediately. See [Authentication](#authentication) below.

### 5. (Optional) Analyze the local fixture site

The SSRF validator blocks `localhost` targets by default. To analyze
`fixture-site/`, start the backend with the dev-only escape hatch instead:

```bash
cd backend
ALLOW_LOCAL_TARGETS=true npm run dev
```

Then run the fixture site itself and analyze `http://localhost:4173` from
**New Audit Run** (see [fixture-site/README.md](fixture-site/README.md), which also
documents a `/powerbi` fixture for exercising the Power BI classification path).

### 6. (Optional) Useful dev scripts

```bash
cd backend
npm test                          # real tests: applicationProfiler, scoring, pythonValidation.service
node src/ai/testConnection.js     # verify OPENAI_API_KEY works (no data sent anywhere else)
node src/tools/testBrowserCollector.js [url]   # standalone Playwright collection check
```

## Frontend Pages

Everything under `/` except `/login` and `/register` requires a valid session
(`RequireAuth`, redirecting to `/login` and remembering where you were headed).

| Route | Page | What it does |
|---|---|---|
| `/login`, `/register` | `Login.jsx`, `Register.jsx` | Real, backend-verified sign-in/sign-up — see [Authentication](#authentication) |
| `/audit` | `AuditRun.jsx` | **New Audit Run.** Target URL + validation matrix stay visible at the top; once a run completes, results are split into 9 tabs (Overview, Functional, Accessibility/WCAG, Responsive, Cross-Browser, Performance, UI Consistency, Findings, AI Insights) instead of one long scroll. The current report and typed URL survive both in-app navigation and a full page reload (mirrored to `localStorage`, cleared by **Reset**) |
| `/reports` | `Reports.jsx` | **Reports & History.** A local (this-browser-only) history of completed runs, sourced from `runHistory.js` — filter by target type, search, paginate. Per-run **Download** opens a print-ready view of that report ("Save as PDF" from the browser's print dialog); **Delete** removes one run; **Bulk Export (JSON)** downloads every stored report as one file; **Clear local history** wipes it (with confirmation) |
| `/rule-profiles` | `RuleProfiles.jsx` | **Rule Profiles.** Real profiles from `rule-profiles/*.json`. The six-check Rule Matrix, WCAG level, and enabled Browsers are editable and persist via `PATCH /api/rule-profiles/:filename` — **the next analysis run reads the change for real**. Profile name, target type, viewports, and load-test approval stay read-only by design — the API itself rejects those fields, so load benchmarking's two-factor approval (see [LangGraph Flow](#langgraph-flow)) can't be bypassed through this page either |
| `/profile` | `Profile.jsx` | Update your name/email/password. Changing email or password requires re-entering your current password |

## Authentication

There's no external identity provider — accounts are local to this backend
instance, stored in `backend/data/users.json` (gitignored; created empty on
first run). It's a real, working system, not a UI mock:

- **Passwords** are hashed with bcrypt (`auth.service.js`) — never stored or
  logged in plaintext.
- **Sessions** are a JWT signed with `JWT_SECRET`, carried in an httpOnly,
  `SameSite=Lax` cookie (`qa_session`, 7-day TTL) — never exposed to frontend
  JS. `secure` is forced on outside development.
- **Every** `/api/*` route except `/api/auth/*` requires a valid session
  (`requireAuth` middleware in `server.js`) — a login that didn't actually
  gate the API would just be decorative.
- Changing email or password (`PATCH /api/auth/me`) requires re-proving
  identity with the current password — a left-open session alone isn't
  enough, so it can't be used to silently lock out the real owner.
- Login failures always return the same generic "Invalid email or password"
  regardless of which was wrong, so the endpoint can't be used to enumerate
  registered emails.

| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create an account (email, password ≥ 8 chars, optional name); logs in immediately |
| POST | `/api/auth/login` | No | Verify credentials, issue the session cookie |
| POST | `/api/auth/logout` | No | Clear the session cookie |
| GET | `/api/auth/me` | Yes | The current user |
| PATCH | `/api/auth/me` | Yes | Update name/email/password (current password required for email/password) |

## API Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |
| POST | `/api/analyze` | Yes | Run the full LangGraph analysis |
| GET | `/api/rule-profiles` | Yes | List every rule profile (real config from `rule-profiles/*.json`) |
| PATCH | `/api/rule-profiles/:filename` | Yes | Edit a profile's enabled checks / browsers / WCAG level — writes to disk, takes effect on the next run |

(`/api/auth/*` is listed separately under [Authentication](#authentication) above.)

### POST /api/analyze

**Request body:**
```json
{
  "url": "https://example.com",
  "userConfig": {
    "checks": { "accessibility": false },
    "browsers": ["chromium"],
    "viewports": ["desktop", "mobile"]
  }
}
```

`userConfig` is optional and can only **narrow** what the selected rule profile already permits (opt a check off, or restrict browsers/viewports to a subset) — it can never enable anything the rule profile disables, and it can never turn on load benchmarking (see `validationPlannerNode` below).

**Response:**
```json
{
  "success": true,
  "elapsedMs": 12345,
  "data": {
    "url": "...",
    "scores": {
      "overall": 82,
      "functional": 88,
      "accessibility": 76,
      "responsive": 72,
      "crossBrowser": 79,
      "performance": 74,
      "uiConsistency": 91,
      "label": "Good"
    },
    "issues": [...],
    "executiveSummary": "...",
    "majorRisks": [...],
    "crossBrowserSummary": "...",
    "accessibilitySummary": "...",
    "performanceSummary": "...",
    "quickWins": [...],
    "recommendations": [...],
    "metadata": { "validationPlan": { "...": "..." }, "...": "..." }
  }
}
```

`data` is the report exactly as built by `reportBuilder.js` (see [Scoring](#scoring) below). Any of the six category scores may be `{"status":"not-run"}` instead of a number if the validation plan didn't enable that category for this run. `executiveSummary`, `majorRisks`, `crossBrowserSummary`, `accessibilitySummary`, `performanceSummary`, `quickWins`, `recommendations`, and each issue's `ai` annotation are all produced by `aiReasoningNode` (see [AI reasoning](#ai-reasoning) below) — advisory narrative only, never a source of truth for scores or facts.

**Error responses:** a missing `url` is `400`; a `url` that fails SSRF/format validation (`validateInputNode`) is `422` with the specific reason; anything else that goes wrong in the pipeline is `500`. A partial failure mid-pipeline (one analyzer crashed, browser collection hit a fatal error) still returns `200` with whatever the report managed to produce, plus `metadata.warnings` — `success:true` means "we produced a report," not "everything ran clean."

## LangGraph Flow

```
START
  -> validateInputNode            (Validate Request)
  -> browserCollectorNode         (Collect Initial Context)
  -> applicationProfilerNode      (Target/Application Profiler)
  -> ruleProfileNode              (Rule Profile Selector)
  -> validationPlannerNode        (Validation Planner — agentic)
       |-- Conditional Tool Execution (fan-out, concurrent) --|
       v         v         v          v
  performance  design  accessibility  pythonValidationNode
       |                                (Python Validators —
     network                            functional, accessibility/WCAG,
       |                                responsive, cross-browser,
       |-------------- fan-in ----------performance [+ opt-in load
                        v               benchmark], UI-consistency)
              normalizeFindingsNode
                        v
                   scoringNode
                        v
                 aiReasoningNode
                        v
                reportBuilderNode
                        v
                       END
```

`applicationProfilerNode` ([`backend/src/profiling/applicationProfiler.js`](backend/src/profiling/applicationProfiler.js)) deterministically classifies the target as `standard-web`, `powerbi`, or `unknown` from URL/domain, page title, DOM/framework signatures, script URLs, and iframe sources — never calling OpenAI. Its output (`targetProfile`) feeds `ruleProfileNode`.

`ruleProfileNode` ([`backend/src/profiling/ruleProfile.service.js`](backend/src/profiling/ruleProfile.service.js)) loads and validates the matching configurable profile from [`rule-profiles/*.json`](rule-profiles/README.md) (falling back to `default.json` if the target is `unknown` or its dedicated profile is missing/invalid — a bad file for one target type never blocks the others). Its output (`ruleProfile`) is **authoritative** for every enable/disable decision made downstream. The same service backs the Rule Profiles page's edit path (`updateRuleProfile()`, `PATCH /api/rule-profiles/:filename` — see [Frontend Pages](#frontend-pages)), re-validated through the identical `validateProfile()` every load goes through, so a saved edit can never leave a profile in a shape the rest of the app wouldn't otherwise accept.

**`validationPlannerNode`** ([`backend/src/agent/nodes/validationPlannerNode.js`](backend/src/agent/nodes/validationPlannerNode.js)) is the agentic core of the pipeline. It turns `(targetProfile, ruleProfile, userConfig, browserEvidence)` into a concrete plan:

```json
{
  "checks": { "functional": true, "accessibility": true, "loadBenchmark": false, "...": "..." },
  "browsers": ["chromium", "firefox", "webkit"],
  "viewports": ["desktop", "tablet", "mobile"],
  "reasons": { "functional": "Required by the \"web-ui-v1\" rule profile — page has 2 form(s)...", "loadBenchmark": "Skipped because explicit approval was not provided" },
  "executionOrder": ["accessibility", "functional", "..."],
  "meta": { "aiAssisted": true, "notes": { "uiConsistency": "..." } }
}
```

The rule profile is authoritative: `userConfig` (from the request body) can only **narrow** what it permits (opt a check off, restrict browsers/viewports to a subset) — never widen or re-enable anything. An OpenAI call may optionally suggest `executionOrder`/`notes` for checks that are **already** enabled — its response is strictly validated as an exact permutation of the enabled-check set and discarded wholesale otherwise, so it can never add, remove, or re-enable a check. Load benchmarking is the sharpest edge of this policy: it's only ever `true` when the rule profile's `performance.loadTest` has both `enabled` and `approved` literally `true` — neither `userConfig`, the LLM, nor the Rule Profiles page's edit API can turn it on; that field is only ever changed by hand, directly on the profile file.

Each analyzer node (`performanceAnalyzerNode`, `designAnalyzerNode`, `accessibilityAnalyzerNode`) and `pythonValidationNode` reads `state.validationPlan.checks.*` and skips its real (expensive) work when disabled — this is the "Conditional Tool Execution" step. Every branch still fires structurally (LangGraph's multi-source fan-in requires every listed source to complete), but does nothing when its check is off, so no Lighthouse/axe-core/Python run is ever paid for when the plan didn't ask for it. The full plan is persisted verbatim in the final report's `metadata.validationPlan`.

`pythonValidationNode` shells out to [`python-validation/runner.py`](python-validation/README.md) via `backend/src/services/pythonValidation.service.js` (stdin/stdout JSON, no shell interpolation), driven entirely by `state.validationPlan` — it does not re-derive checks from the rule profile itself. It manages its own browser session and never calls OpenAI; its findings are merged into `normalizeFindingsNode` alongside the Node-side analyzers. If it fails or times out, the run continues and reports a warning instead of failing.

## Scoring

`scoringNode` ([`backend/src/agent/nodes/scoringNode.js`](backend/src/agent/nodes/scoringNode.js) + [`backend/src/utils/scoring.js`](backend/src/utils/scoring.js)) computes six category scores plus `overall` from `state.normalizedFindings` (the fully merged, cross-engine list) — **purely deterministic arithmetic; OpenAI never calculates or modifies a score**:

```json
{
  "overall": 82,
  "functional": 88,
  "accessibility": 76,
  "responsive": 72,
  "crossBrowser": 79,
  "performance": 74,
  "uiConsistency": 91
}
```

- **functional** / **responsive** / **crossBrowser** — purely finding-derived (`scoreFromFindings`, capped-penalty model).
- **performance** — blends the real Lighthouse score (60%) with performance + `network`-category findings (40%).
- **accessibility** — blends the real axe-core score (60%) with `accessibility`-category findings (40%) — Node's axe-core findings and Python's `wcag_validator.py` findings are already merged into one list by this point.
- **uiConsistency** — folds together `design`-category findings (Node's live analyzer) and `ui-consistency`-category findings (Python's `ui_consistency.py`) — two engines, one score, even though they stay distinct categories in the findings list.

**A category the validation plan didn't enable is never scored** — it returns `{"status": "not-run"}` instead of a fake number, and is **excluded** (not zero-weighted) from the `overall` calculation; the remaining enabled categories' weights are renormalized to sum to 1. Weights are configurable: `DEFAULT_WEIGHTS` in `scoring.js`, overridable per rule profile via an optional `scoring.weights` object (see [rule-profiles/README.md](rule-profiles/README.md)).

## AI reasoning

`aiReasoningNode` ([`backend/src/agent/nodes/aiReasoningNode.js`](backend/src/agent/nodes/aiReasoningNode.js) + [`backend/src/ai/prompts.js`](backend/src/ai/prompts.js) + [`backend/src/ai/schemas.js`](backend/src/ai/schemas.js)) is the only node that calls OpenAI for narrative reasoning. It is strictly advisory — **it cannot compute or modify scores, and it can only annotate findings, never alter their factual fields.**

The model receives ONLY compact, structured evidence built by `buildSummarizedEvidence()` — never raw DOM, screenshots, full network logs, or HTML:

- **application type** — `state.targetProfile` (deterministic classification + confidence)
- **selected rule profile** — `state.ruleProfile` (id, target type, accessibility standard/level)
- **validation plan** — `state.validationPlan` (enabled/disabled checks, browsers, viewports, execution order)
- **functional findings**, **WCAG findings**, **responsive findings**, **cross-browser differences**, **UI-consistency findings** — each a capped, one-line-per-finding list from `state.normalizedFindings`, filtered to that category
- **frontend performance metrics** — Core Web Vitals + Lighthouse summary from `state.metrics`
- **approved load benchmark metrics** — from `state.pythonValidationResults.metrics.performance.loadTest`, present only when `load_benchmark.py` actually ran (both `enabled` AND `approved` were `true`); otherwise reported as not executed
- **deterministic scores** — `state.scores`, sent as read-only context

It produces:

```json
{
  "executiveSummary": "...",
  "majorRisks": ["..."],
  "prioritizedIssues": [
    { "findingId": "...", "priority": 1, "reason": "...", "likelyRootCause": "...", "recommendation": "...", "impact": "low|medium|high", "effort": "low|medium|high" }
  ],
  "crossBrowserSummary": "...",
  "accessibilitySummary": "...",
  "performanceSummary": "...",
  "quickWins": ["..."],
  "recommendations": ["..."]
}
```

`AiAnalysisSchema` (Zod, in `schemas.js`) validates every field of the response; a non-conforming response is either leniently coerced or discarded wholesale in favor of a deterministic fallback — the report is never lost. `reportBuilder.js` joins `prioritizedIssues` back onto `normalizedFindings` by `findingId` (each issue's factual fields stay analyzer-authored; only the nested `ai` object is LLM-authored) and copies `executiveSummary`/`majorRisks`/`crossBrowserSummary`/`accessibilitySummary`/`performanceSummary`/`quickWins`/`recommendations` verbatim onto the report.

The system prompt enforces: use only supplied evidence; never invent browser failures, WCAG violations, load-test metrics, network requests, or DOM elements; never change the deterministic scores; distinguish confirmed evidence from inferred root cause; say so explicitly when evidence is insufficient; every recommendation must name a concrete, actionable change. If OpenAI is unconfigured, fails, times out, or returns invalid JSON, `aiReasoningNode` returns a deterministic fallback built directly from `state.scores`/`state.normalizedFindings` (flagged via `_mocked`/`_fallbackReason`, surfaced in the report's `metadata.aiAnalysis` and `metadata.warnings`) — the deterministic validation report itself is always returned, never lost.

## Mocked vs Live (MVP)

| Component                  | Status   | Notes                                                   |
|-----------------------------|----------|------------------------------------------------------------|
| Auth (register/login/logout/profile) | ✅ Live | Real bcrypt-hashed passwords, real JWT session cookie — see [Authentication](#authentication) |
| LangGraph workflow          | ✅ Live  | Full graph wired and executed                             |
| validateInputNode           | ✅ Live  | URL validation + SSRF checks via urlSecurity util          |
| browserCollectorNode        | ✅ Live  | Real Playwright collection (desktop/tablet/mobile)         |
| performanceAnalyzerNode     | ✅ Live  | Real Lighthouse audit                                      |
| networkAnalyzerNode         | ✅ Live  | Deterministic analysis of the real network log             |
| designAnalyzerNode          | ✅ Live  | Deterministic typography/color/spacing/overflow analysis   |
| accessibilityAnalyzerNode   | ✅ Live  | Real axe-core WCAG audit                                   |
| applicationProfilerNode     | ✅ Live  | Deterministic standard-web/powerbi/unknown classification |
| ruleProfileNode             | ✅ Live  | Loads + validates `rule-profiles/*.json`; drives which checks run; editable via the Rule Profiles page |
| validationPlannerNode       | ✅ Live  | Agentic plan (checks/browsers/viewports); optional OpenAI-suggested execution order, strictly sandboxed |
| pythonValidationNode        | ✅ Live  | `functional/*`, `accessibility/wcag_validator.py`, `responsive/cross_browser_validator.py`, `responsive/responsive_validator.py`, `design/ui_consistency.py`, and `performance/load_benchmark.py` (opt-in, disabled by default) are all real — every module does real work whenever a real browser session is available (see [python-validation/README.md](python-validation/README.md)) |
| normalizeFindingsNode       | ✅ Live  | Normalizes + merges Node and Python findings into one schema |
| scoringNode                 | ✅ Live  | Six category scores + overall from `normalizedFindings` (both engines); see [Scoring](#scoring) |
| aiReasoningNode             | ✅ Live  | Calls OpenAI via LangChain with summarized cross-engine evidence; advisory only, schema-validated, deterministic fallback on any failure — see [AI reasoning](#ai-reasoning) |
| reportBuilderNode           | ✅ Live  | Assembles final structured report                           |

Every Python validator does real work — there is no permanently-mocked placeholder module. Frontend browser performance (LCP/CLS/etc.) is deliberately not duplicated in Python at all, since it's already covered for real by Node's Lighthouse analyzer (`performanceAnalyzerNode`); the Python engine's `performance` check group is just the opt-in load benchmark. `scoringNode` factors in findings from both Node's own analyzers and the Python engine. Run history (Reports & History) and rule-profile edits are local to this machine — there's no shared/multi-device backend store for either.
