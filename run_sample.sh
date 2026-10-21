#!/usr/bin/env bash
# run_sample.sh
# One-command setup + sample analysis against the included fixture site.
#
# What this script does:
#   1. Checks prerequisites (Node, npm, Python)
#   2. Installs Node dependencies for backend and frontend
#   3. Installs Playwright browsers (chromium, firefox, webkit) + system deps
#   4. Copies .env.example → backend/.env if no .env exists
#   5. Starts the fixture site (port 4173)
#   6. Starts the backend with ALLOW_LOCAL_TARGETS=true (port 3001)
#   7. Waits for both servers to be ready
#   8. Runs one analysis against http://localhost:4173 via the API
#   9. Prints the overall score and finding counts
#  10. Shuts everything down cleanly
#
# Usage:
#   bash run_sample.sh
#
# Requirements:
#   - Node.js >= 18
#   - Python >= 3.9
#   - npm

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[run_sample]${NC} $*"; }
warn()    { echo -e "${YELLOW}[run_sample]${NC} $*"; }
error()   { echo -e "${RED}[run_sample]${NC} $*" >&2; }

# ── Cleanup on exit ──────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  info "Shutting down servers..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { error "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v npm  >/dev/null 2>&1 || { error "npm is required."; exit 1; }
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || {
  error "Python 3.9+ is required. Install from https://python.org"; exit 1
}

PYTHON=$(command -v python3 2>/dev/null || command -v python)
NODE_VERSION=$(node -e "process.stdout.write(process.version)")
info "Node $NODE_VERSION  •  Python $($PYTHON --version 2>&1)"

# ── 2. Install Node dependencies ─────────────────────────────────────────────
info "Installing backend dependencies..."
(cd backend && npm install --silent)

info "Installing frontend dependencies..."
(cd frontend && npm install --silent)

# ── 3. Install Playwright browsers ───────────────────────────────────────────
info "Installing Playwright browsers (this may take a few minutes on first run)..."
(cd backend && npx playwright install --with-deps chromium firefox webkit 2>&1 | tail -5)

info "Installing Python dependencies..."
(cd python-validation && $PYTHON -m pip install -q -r requirements.txt)
$PYTHON -m playwright install chromium firefox webkit 2>&1 | tail -3

# ── 4. Environment file ───────────────────────────────────────────────────────
if [ ! -f backend/.env ]; then
  warn "No backend/.env found — copying from .env.example"
  warn "Note: OPENAI_API_KEY is not set. AI narrative will use a deterministic fallback."
  cp .env.example backend/.env
fi

# ── 5. Start the fixture site ─────────────────────────────────────────────────
info "Starting fixture site on port 4173..."
(cd fixture-site && node server.js) &
PIDS+=($!)
sleep 2

# ── 6. Start the backend ──────────────────────────────────────────────────────
info "Starting backend on port 3001 (ALLOW_LOCAL_TARGETS=true)..."
ALLOW_LOCAL_TARGETS=true node backend/src/server.js &
PIDS+=($!)

# ── 7. Wait for backend to be ready ──────────────────────────────────────────
info "Waiting for backend to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    info "Backend is ready."
    break
  fi
  if [ "$i" -eq 20 ]; then
    error "Backend did not start in time. Check backend logs."
    exit 1
  fi
  sleep 1
done

# ── 8. Register a temp account and run one analysis ──────────────────────────
info "Registering a temporary test account..."
REGISTER=$(curl -sf -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -c /tmp/ua_sample_cookies.txt \
  -d '{"email":"sample@example.com","password":"sample123","name":"Sample User"}' 2>/dev/null || echo "{}")

if echo "$REGISTER" | grep -q '"success":true'; then
  info "Account created."
else
  # Account may already exist from a previous run — try login instead
  warn "Register failed (account may already exist) — trying login..."
  curl -sf -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -c /tmp/ua_sample_cookies.txt \
    -d '{"email":"sample@example.com","password":"sample123"}' >/dev/null 2>&1 || true
fi

info "Running analysis against http://localhost:4173 ..."
info "This may take 20–90 seconds depending on your machine..."

RESULT=$(curl -sf -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -b /tmp/ua_sample_cookies.txt \
  -d '{"url":"http://localhost:4173"}' \
  --max-time 120 2>/dev/null || echo "{}")

# ── 9. Print summary ──────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Analysis Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if echo "$RESULT" | grep -q '"success":true'; then
  OVERALL=$(echo "$RESULT"   | $PYTHON -c "import sys,json; d=json.load(sys.stdin); print(d['data']['scores']['overall'])" 2>/dev/null || echo "n/a")
  LABEL=$(echo "$RESULT"     | $PYTHON -c "import sys,json; d=json.load(sys.stdin); print(d['data']['scores']['label'])" 2>/dev/null || echo "")
  FINDINGS=$(echo "$RESULT"  | $PYTHON -c "import sys,json; d=json.load(sys.stdin); print(len(d['data']['issues']))" 2>/dev/null || echo "n/a")
  DURATION=$(echo "$RESULT"  | $PYTHON -c "import sys,json; d=json.load(sys.stdin); print(round(d['elapsedMs']/1000,1))" 2>/dev/null || echo "n/a")

  echo -e "  Overall Score : ${GREEN}${OVERALL}/100 (${LABEL})${NC}"
  echo    "  Findings      : ${FINDINGS} issues"
  echo    "  Duration      : ${DURATION}s"
  echo    ""
  echo    "  Open http://localhost:5173 to see the full report."
else
  error "Analysis failed or returned no data."
  echo "$RESULT" | head -20
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Keep servers running until user exits
info "Press Ctrl+C to stop."
wait
