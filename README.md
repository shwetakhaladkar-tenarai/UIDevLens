# Smart UI Auditor — AI-Powered Frontend Quality Analyzer

A LangGraph-orchestrated AI agent that analyzes any public URL for frontend quality,
performance, design, and accessibility issues — behind a real login, as a multi-page
app with editable validation rules and local run history.

---

## The Business Problem

Frontend quality reviews are slow, inconsistent, and siloed. A developer checking
accessibility, a QA engineer testing responsiveness, and a performance engineer running
Lighthouse are three separate people, three separate tools, and three separate reports —
none of which talk to each other. For embedded dashboards (Power BI, Tableau), the
problem is worse because standard web tools don't understand the embed context.

**Smart UI Auditor solves this in one run:**
- Any public URL → full quality report in ~30 seconds
- Six quality dimensions checked simultaneously: Functional, Accessibility/WCAG,
  Responsiveness, Cross-Browser, Performance, UI Consistency
- Deterministic scores (no AI hallucinating numbers) + GPT-4o narrative (root cause,
  fixes, quick wins)
- Supports both standard web apps and Power BI embedded dashboards with separate rule profiles

---

## Team

| Name | Role |
|---|---|
| Shweta Khaladkar | Full-stack development, LangGraph pipeline, Python validation engine, UI/UX |

---

## Promised vs. Built

| Feature | Status |
|---|---|
| LangGraph multi-node pipeline | ✅ Built |
| Real browser collection (Playwright) | ✅ Built |
| Lighthouse performance audit | ✅ Built |
| axe-core accessibility audit | ✅ Built |
| Python validation engine (functional, WCAG, responsive, cross-browser, UI consistency) | ✅ Built |
| Opt-in load benchmarking | ✅ Built (requires explicit approval in rule profile) |
| GPT-4o AI narrative layer | ✅ Built |
| Deterministic scoring (6 categories + overall) | ✅ Built |
| Application type profiling (standard-web vs Power BI) | ✅ Built |
| Configurable rule profiles (editable in UI) | ✅ Built |
| Real authentication (bcrypt + JWT) | ✅ Built |
| Run history with PDF export | ✅ Built |
| Fixture site with 30+ deliberate issues | ✅ Built |
| Graceful degradation (partial reports on failure) | ✅ Built |

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + React Router + Vite + Tailwind CSS + Recharts |
| Backend | Node.js + Express |
| Auth | bcryptjs (password hashing) + jsonwebtoken (session cookie) |
| AI | LangGraph.js + LangChain.js + OpenAI GPT-4o |
| Browser Automation | Playwright (Node + Python) |
| Performance | Lighthouse 13 |
| Accessibility | axe-core 4.13 |
| Validation Engine | Custom Python subprocess engine |

---

## Quick Start

### 1. Configure environment

```bash
cp .env.example backend/.env
# Edit backend/.env:
#  - add your OPENAI_API_KEY
#  - set JWT_SECRET to a real random value (required — server refuses to start without it outside dev):
#      node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Install Node dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Install Playwright browsers (required for analysis to work)

This step is mandatory. On a clean machine the analysis will fail without it.

```bash
cd backend
npx playwright install --with-deps chromium firefox webkit
```

> On Linux, `--with-deps` also installs the required system libraries
> (libnss, libatk, libgbm, etc.). On Windows/macOS you can omit `--with-deps`.

### 4. Start the backend

```bash
cd backend
npm run dev
```

### 5. Start the frontend

```bash
cd frontend
npm run dev
```

### 6. Open the app

Visit [http://localhost:5173](http://localhost:5173) — you'll land on `/login`.
There's no seeded account: click **Create one** to register, which logs you in immediately.

### 7. One-command sample run

For a quick end-to-end test using the included fixture site:

```bash
# From the repo root — installs browsers, starts servers, runs one analysis
bash run_sample.sh
```

See [run_sample.sh](run_sample.sh) for what it does.

### 8. (Optional) Analyze the local fixture site manually

The SSRF validator blocks `localhost` targets by default. To analyze `fixture-site/`:

```bash
cd backend
ALLOW_LOCAL_TARGETS=true npm run dev
```

Then start the fixture site and analyze `http://localhost:4173` from the dashboard
(see [fixture-site/README.md](fixture-site/README.md)).

### 9. (Optional) Useful dev scripts

```bash
cd backend
npm test                                          # unit tests: applicationProfiler, scoring, pythonValidation.service
node src/ai/testConnection.js                     # verify OPENAI_API_KEY works
node src/tools/testBrowserCollector.js [url]      # standalone Playwright collection check
```

---

## Project Structure

```
UIDevLens/
├── frontend/              # React + Vite SPA (port 5173)
├── backend/               # Express API (port 3001)
│   └── data/users.json    # Local user store (gitignored)
├── rule-profiles/         # Editable validation profiles (*.json)
├── python-validation/     # Custom Python validation engine
├── fixture-site/          # Static test-target site with deliberate issues
├── run_sample.sh          # One-command setup + sample analysis
├── VALUE.md               # Business value, timing benchmarks, cost per run
├── .env.example           # Environment template
└── README.md
```

---

## Frontend Pages

| Route | Page | Description |
|---|---|---|
| `/login`, `/register` | Login / Register | Real bcrypt + JWT auth |
| `/dashboard` | Dashboard | Enter URL, run analysis, view results |
| `/reports-and-history` | Reports & History | Local run history, PDF export, bulk JSON export |
| `/rule-manager` | Rule Manager | View and edit validation rule profiles |
| `/profile` | Profile | Update name / email / password |

---

## Authentication

- Passwords hashed with bcrypt (10 salt rounds) — never stored in plaintext
- Sessions: JWT in an `httpOnly`, `SameSite=Lax` cookie (`qa_session`, 7-day TTL)
- Every `/api/*` route except `/api/auth/*` requires a valid session
- `JWT_SECRET` **must** be set to a real value outside development — the server logs a hard warning and refuses a safe default in production mode
- Login failures always return the same generic message (prevents email enumeration)

---

## LangGraph Pipeline

```
START
  → validateInputNode          URL validation + SSRF check
  → browserCollectorNode       Playwright: DOM, meta, network, app signatures
  → applicationProfilerNode    Deterministic: standard-web | powerbi | unknown
  → ruleProfileNode            Loads rule-profiles/<type>.json
  → validationPlannerNode      Builds checks/browsers/viewports plan (GPT-4o for ordering only)
       ┌──────────┬──────────────┬──────────────────────┐
  performance   design      accessibility        pythonValidationNode
       │                                         (functional, WCAG, responsive,
    network                                       cross-browser, UI, load-test)
       └──────────┴──────────────┴──────────────────────┘
  → normalizeFindingsNode      Dedupe + merge findings from all engines
  → scoringNode                Deterministic arithmetic scoring
  → aiReasoningNode            GPT-4o narrative (advisory only, never changes scores)
  → reportBuilderNode          Assembles final JSON report
  → END
```

Fatal short-circuit at every node → partial report always returned.

---

## Scoring

Six category scores + overall. **Purely deterministic — GPT-4o never touches a number.**

| Category | Source | Weight |
|---|---|---|
| Functional | Python functional findings | 25% |
| Accessibility | axe-core (60%) + findings (40%) | 20% |
| Performance | Lighthouse (60%) + findings (40%) | 20% |
| Responsive | Design-analyzer + Python responsive findings | 15% |
| Cross-Browser | Python cross-browser findings | 10% |
| UI Consistency | Design-analyzer + Python UI findings | 10% |

Disabled categories are excluded (not zero-weighted) from the overall score.
Score labels: **Excellent** ≥90 · **Good** ≥75 · **Needs Improvement** ≥60 · **Poor** ≥40 · **Critical** <40

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |
| POST | `/api/analyze` | Yes | Run the full LangGraph analysis |
| GET | `/api/rule-profiles` | Yes | List all rule profiles |
| PATCH | `/api/rule-profiles/:filename` | Yes | Edit a profile (checks / browsers / WCAG level) |
| POST | `/api/auth/register` | No | Register + immediate login |
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/logout` | No | Logout |
| GET | `/api/auth/me` | Yes | Current user |
| PATCH | `/api/auth/me` | Yes | Update profile (current password required for email/password changes) |

---

## See Also

- [VALUE.md](VALUE.md) — business value, timing benchmarks, cost per run
- [fixture-site/README.md](fixture-site/README.md) — the deliberate-issue test site
- [python-validation/README.md](python-validation/README.md) — Python engine details
- [rule-profiles/README.md](rule-profiles/README.md) — rule profile schema and editing
