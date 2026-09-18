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