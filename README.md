# AI-Powered Frontend Quality & Performance Analyzer

An MVP that runs a LangGraph-orchestrated AI agent to analyze any public URL for frontend quality, performance, design, and accessibility issues.

## Stack

| Layer    | Tech                                      |
|----------|-------------------------------------------|
| Frontend | React + Vite + Tailwind CSS + Recharts    |
| Backend  | Node.js + Express                         |
| AI       | LangGraph.js + LangChain.js + OpenAI API  |

## Project Structure

```
AI-Powered/
├── frontend/      # React + Vite app  (port 5173)
├── backend/       # Express API       (port 3001)
├── demo-site/     # Static demo target site
├── .env.example   # Environment template
├── .gitignore
└── README.md
```

## Quick Start

### 1. Configure environment

```bash
cp .env.example backend/.env
# Edit backend/.env and add your OPENAI_API_KEY
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

Visit [http://localhost:5173](http://localhost:5173)

## API Endpoints

| Method | Path          | Description                        |
|--------|---------------|------------------------------------|
| GET    | /health       | Health check                       |
| POST   | /api/analyze  | Run the full LangGraph analysis    |

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
  "data": {
    "url": "...",
    "scores": { "overall": 78, "performance": 80, "design": 75, "accessibility": 70 },
    "findings": [...],
    "aiAnalysis": { "summary": "...", "recommendations": [...] },
    "finalReport": { ... }
  }
}
```

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

`applicationProfilerNode` ([`backend/src/profiling/applicationProfiler.js`](backend/src/profiling/applicationProfiler.js)) deterministically classifies the target as `standard-web`, `powerbi`, `tableau`, `databricks`, or `unknown` from URL/domain, page title, DOM/framework signatures, script URLs, and iframe sources — never calling OpenAI. Its output (`targetProfile`) feeds `ruleProfileNode`.

`ruleProfileNode` ([`backend/src/profiling/ruleProfile.service.js`](backend/src/profiling/ruleProfile.service.js)) loads and validates the matching configurable profile from [`rule-profiles/*.json`](rule-profiles/README.md) (falling back to `default.json` if the target is `unknown` or its dedicated profile is missing/invalid — a bad file for one target type never blocks the others). Its output (`ruleProfile`) is **authoritative** for every enable/disable decision made downstream.

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

The rule profile is authoritative: `userConfig` (from the request body) can only **narrow** what it permits (opt a check off, restrict browsers/viewports to a subset) — never widen or re-enable anything. An OpenAI call may optionally suggest `executionOrder`/`notes` for checks that are **already** enabled — its response is strictly validated as an exact permutation of the enabled-check set and discarded wholesale otherwise, so it can never add, remove, or re-enable a check. Load benchmarking is the sharpest edge of this policy: it's only ever `true` when the rule profile's `performance.loadTest` has both `enabled` and `approved` literally `true` — neither `userConfig` nor the LLM can turn it on.

Each analyzer node (`performanceAnalyzerNode`, `designAnalyzerNode`, `accessibilityAnalyzerNode`) and `pythonValidationNode` reads `state.validationPlan.checks.*` and skips its real (expensive) work when disabled — this is the "Conditional Tool Execution" step. Every branch still fires structurally (LangGraph's multi-source fan-in requires every listed source to complete), but does nothing when its check is off, so no Lighthouse/axe-core/Python run is ever paid for when the plan didn't ask for it. The full plan is persisted verbatim in the final report's `metadata.validationPlan`.

`pythonValidationNode` shells out to [`python-validation/runner.py`](python-validation/README.md) via `backend/src/services/pythonValidation.service.js` (stdin/stdout JSON, no shell interpolation), driven entirely by `state.validationPlan` — it does not re-derive checks from the rule profile itself. It manages its own browser session and never calls OpenAI; its findings are merged into `normalizeFindingsNode` alongside the Node-side analyzers. If it fails or times out, the run continues and reports a warning instead of failing.

## Mocked vs Live (MVP)

| Component                  | Status   | Notes                                                   |
|-----------------------------|----------|----------------------------------------------------------|
| LangGraph workflow          | ✅ Live  | Full graph wired and executed                             |
| validateInputNode           | ✅ Live  | URL validation + SSRF checks via urlSecurity util          |
| browserCollectorNode        | ✅ Live  | Real Playwright collection (desktop/tablet/mobile)         |
| performanceAnalyzerNode     | ✅ Live  | Real Lighthouse audit                                      |
| networkAnalyzerNode         | ✅ Live  | Deterministic analysis of the real network log             |
| designAnalyzerNode          | ✅ Live  | Deterministic typography/color/spacing/overflow analysis   |
| accessibilityAnalyzerNode   | ✅ Live  | Real axe-core WCAG audit                                   |
| applicationProfilerNode     | ✅ Live  | Deterministic standard-web/powerbi/tableau/databricks/unknown classification |
| ruleProfileNode             | ✅ Live  | Loads + validates `rule-profiles/*.json`; drives which checks run |
| validationPlannerNode       | ✅ Live  | Agentic plan (checks/browsers/viewports); optional OpenAI-suggested execution order, strictly sandboxed |
| pythonValidationNode        | 🟡 Partial | `functional/*`, `accessibility/wcag_validator.py`, `responsive/cross_browser_validator.py`, `responsive/responsive_validator.py`, `performance/load_benchmark.py` (opt-in, disabled by default), and `design/ui_consistency.py` are real; only `performance/frontend_metrics.py` still returns placeholder findings (frontend performance is already covered for real by Node's Lighthouse analyzer — see [python-validation/README.md](python-validation/README.md)) |
| normalizeFindingsNode       | ✅ Live  | Normalizes + merges Node and Python findings into one schema |
| scoringNode                 | ✅ Live  | Calculates weighted scores (from live Node findings only)  |
| aiReasoningNode             | ✅ Live  | Calls OpenAI via LangChain                                  |
| reportBuilderNode           | ✅ Live  | Assembles final structured report                           |

The remaining Python validators (`responsive`, `cross_browser`, `performance`, `design`) will be implemented for real in a later step — see its README for details. `scoringNode` currently computes scores only from the Node-side analyzers' raw findings (`state.performanceFindings`/`designFindings`/`accessibilityFindings`/`networkFindings`); Python's findings (including the now-real `functional`/`accessibility` ones) are merged into `normalizedFindings`/the report's `issues` but are not yet factored into the deterministic scores.
