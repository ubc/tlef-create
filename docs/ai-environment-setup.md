# AI Environment Setup Skill

This file is written for AI coding assistants (Claude Code, Copilot, Cursor, etc.).
Follow these steps to set up a complete local development environment for TLEF-CREATE
from a fresh clone. Execute each step in order; do not skip steps.

---

## 0. Prerequisites (verify before starting)

Run these checks and stop if any fail — ask the user to install the missing tool:

```bash
docker info          # Docker Desktop must be running
node --version       # Must be 20.x or higher
npm --version        # Comes with Node
git --version        # Standard git
```

---

## 1. Determine the workspace root

The user's workspace is a **single parent directory** that contains all repos as siblings.
The typical structure is:

```
~/tlef-create/              ← workspace root (WORKSPACE_ROOT)
├── tlef-create/            ← this repo (already cloned)
├── docker-simple-saml/     ← required: SAML IdP
├── tlef-mongodb-docker/    ← required: MongoDB
├── tlef-qdrant/            ← required: Vector DB
├── canvas-lms-docker/      ← optional: Canvas LMS
└── start-dev.sh            ← convenience script (lives in WORKSPACE_ROOT)
    start-app.sh
```

Find WORKSPACE_ROOT by going one level up from the tlef-create repo directory.
If the user opened this file from within `tlef-create/`, the root is `../`.

Set a variable for the rest of the steps:
```bash
WORKSPACE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# If running from inside tlef-create/, adjust accordingly.
```

---

## 2. Clone required repos into WORKSPACE_ROOT

Run from WORKSPACE_ROOT. Skip any repo that already exists.

```bash
# SAML Identity Provider
[ ! -d "docker-simple-saml" ] && \
  git clone -b tlef-create-integration https://github.com/ubc/docker-simple-saml.git

# MongoDB + Mongo Express
[ ! -d "tlef-mongodb-docker" ] && \
  git clone -b tlef-create-integration https://github.com/ubc/tlef-mongodb-docker.git

# Qdrant Vector Database
[ ! -d "tlef-qdrant" ] && \
  git clone https://github.com/ubc/tlef-qdrant.git
```

### Optional: Canvas LMS (only clone if the user wants Canvas integration)

```bash
[ ! -d "canvas-lms-docker" ] && \
  git clone https://github.com/ahamana/canvas-lms-docker.git
```

---

## 3. Create .env files

### 3a. tlef-create main app

If `tlef-create/.env` does not exist, create it from the example:

```bash
[ ! -f "tlef-create/.env" ] && cp tlef-create/.env.example tlef-create/.env
```

The `.env.example` has all dev defaults pre-filled. The only values that need
manual intervention are:

| Variable | Action required |
|---|---|
| `OPENAI_API_KEY` | Ask the user for their OpenAI API key (only needed if `LLM_PROVIDER=openai`). If they want to use **Ollama** locally (free), leave `LLM_PROVIDER=ollama` — no key needed. |
| `CANVAS_CLIENT_SECRET` | Only needed if Canvas integration is used. Skip if canvas-lms-docker is not running. |

After copying, if the user wants to use OpenAI:
1. Ask: "Do you want to use OpenAI as the LLM provider, or use local Ollama (free, requires 8GB RAM)?"
2. If OpenAI: ask for their API key, then run:
   ```bash
   sed -i '' "s/sk-your-openai-api-key-here/THEIR_KEY/" tlef-create/.env
   sed -i '' "s/LLM_PROVIDER=ollama/LLM_PROVIDER=openai/" tlef-create/.env
   sed -i '' "s|LLM_API_ENDPOINT=http://localhost:11434/v1|LLM_API_ENDPOINT=https://api.openai.com/v1|" tlef-create/.env
   ```
3. If Ollama: keep defaults as-is. Remind user to install Ollama and pull the model:
   ```bash
   # macOS
   brew install ollama
   ollama pull llama3.1:8b
   ```

### 3b. MongoDB

If `tlef-mongodb-docker/.env` does not exist, create it with the dev defaults that
match what tlef-create expects:

```bash
if [ ! -f "tlef-mongodb-docker/.env" ]; then
  cat > tlef-mongodb-docker/.env << 'EOF'
# MongoDB root user (used internally by Docker, not by the app)
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=tlef-mongo-root-dev

# Mongo Express web UI credentials
# Access at http://localhost:8081
MONGO_EXPRESS_LOGIN=admin
MONGO_EXPRESS_PASSWORD=tlef-express-dev
EOF
fi
```

> The app user (`tlef-app` / `tlef-app-2024`) is created automatically by
> `mongo-init.js` when the container starts for the first time. The URI
> in `tlef-create/.env` already uses these credentials.

### 3c. Qdrant — no .env needed

Qdrant is configured entirely via its `docker-compose.yml` (inline YAML config).
The API key `super-secret-dev-key` is already set there and matches `tlef-create/.env`.
No action required.

### 3d. docker-simple-saml — no .env needed

SAML configuration is in `docker-simple-saml/config/`. The cert is auto-generated
at `docker-simple-saml/cert/server.crt` when the container first starts.
No action required.

---

## 4. Create missing directory for SAML cert sharing

docker-simple-saml mounts `../saml-test-client/cert` as a volume. Create it if absent:

```bash
mkdir -p "$WORKSPACE_ROOT/saml-test-client/cert"
```

---

## 5. Install Node.js dependencies

```bash
cd "$WORKSPACE_ROOT/tlef-create"
[ ! -d "node_modules" ] && npm install
cd "$WORKSPACE_ROOT"
```

---

## 6. Verify start scripts exist in WORKSPACE_ROOT

Check whether `start-dev.sh` and `start-app.sh` exist:

```bash
ls "$WORKSPACE_ROOT/start-dev.sh" "$WORKSPACE_ROOT/start-app.sh" 2>/dev/null
```

If either is missing, create them:

### start-dev.sh (starts all Docker services + LiteLLM)

```bash
cat > "$WORKSPACE_ROOT/start-dev.sh" << 'SCRIPT'
#!/bin/bash
# Start all Docker dependency services (MongoDB, Qdrant, SimpleSAML) and LiteLLM proxy.
# Run start-app.sh separately to start the frontend & backend.

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[start-dev]${NC} $*"; }
warn()  { echo -e "${YELLOW}[start-dev]${NC} $*"; }
error() { echo -e "${RED}[start-dev]${NC} $*"; }

if ! command -v docker &>/dev/null; then
  error "Docker not found. Please install Docker Desktop."
  exit 1
fi

if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Please start Docker Desktop."
  exit 1
fi

SAML_CLIENT_CERT="$ROOT/saml-test-client/cert"
if [ ! -d "$SAML_CLIENT_CERT" ]; then
  warn "Creating missing directory: saml-test-client/cert"
  mkdir -p "$SAML_CLIENT_CERT"
fi

info "Starting MongoDB..."
docker compose -f "$ROOT/tlef-mongodb-docker/docker-compose.yml" \
  --env-file "$ROOT/tlef-mongodb-docker/.env" \
  up -d --remove-orphans

info "Starting Qdrant..."
docker compose -f "$ROOT/tlef-qdrant/docker-compose.yml" \
  up -d --remove-orphans

info "Starting docker-simple-saml (SAML IdP)..."
docker compose -f "$ROOT/docker-simple-saml/docker-compose.yml" \
  up -d --build --remove-orphans

wait_for() {
  local name="$1" host="$2" port="$3" retries=20 delay=3
  info "Waiting for $name on $host:$port..."
  for i in $(seq 1 $retries); do
    if nc -z "$host" "$port" 2>/dev/null; then
      info "$name is ready."
      return 0
    fi
    sleep $delay
  done
  warn "$name did not respond in time — continuing anyway."
}

wait_for "MongoDB"    127.0.0.1 27017
wait_for "Qdrant"     127.0.0.1 6333
wait_for "SimpleSAML" 127.0.0.1 8080

LITELLM_CMD=$(command -v litellm 2>/dev/null || echo "$HOME/Library/Python/3.11/bin/litellm")
if [ -f "$LITELLM_CMD" ] || command -v litellm &>/dev/null; then
  info "Starting LiteLLM proxy on port 4000..."
  nohup "$LITELLM_CMD" --config "$ROOT/litellm_config.yaml" --port 4000 \
    > "$ROOT/litellm.log" 2>&1 &
  echo $! > "$ROOT/litellm.pid"
  info "LiteLLM started (PID $(cat "$ROOT/litellm.pid")). Logs → litellm.log"
else
  warn "LiteLLM not found — skipping. Install with: pip3 install 'litellm[proxy]' --user"
fi

echo ""
info "All services are up:"
echo "  MongoDB        → mongodb://localhost:27017"
echo "  Mongo Express  → http://localhost:8081  (admin / tlef2024express)"
echo "  Qdrant         → http://localhost:6333/dashboard  (api-key: super-secret-dev-key)"
echo "  SAML IdP       → http://localhost:8080/simplesaml"
echo "                   Users: faculty/faculty  student/student"
echo "  LiteLLM        → http://localhost:4000"
echo ""
info "Run ./start-app.sh to start the frontend & backend."
SCRIPT
chmod +x "$WORKSPACE_ROOT/start-dev.sh"
```

### start-app.sh (starts the Node.js app)

```bash
cat > "$WORKSPACE_ROOT/start-app.sh" << 'SCRIPT'
#!/bin/bash
# Start tlef-create frontend (Vite :8092) and backend (Node :8051).
# Make sure ./start-dev.sh has been run first to bring up Docker services.

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT/tlef-create"

GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[start-app]${NC} $*"; }

if [ ! -d "$APP_DIR/node_modules" ]; then
  info "node_modules not found — running npm install..."
  (cd "$APP_DIR" && npm install)
fi

info "Starting tlef-create..."
echo "  Backend API  → http://localhost:8051/api/create"
echo "  Frontend Dev → http://localhost:8092"
echo ""
info "Press Ctrl+C to stop."
echo ""

trap 'kill 0' INT TERM
(cd "$APP_DIR" && node server.js) &
(cd "$APP_DIR" && npx vite --port 8092) &
wait
SCRIPT
chmod +x "$WORKSPACE_ROOT/start-app.sh"
```

---

## 7. Verify the setup

Run these quick checks to confirm everything is in place:

```bash
# Check repos exist
ls "$WORKSPACE_ROOT/docker-simple-saml/docker-compose.yml"
ls "$WORKSPACE_ROOT/tlef-mongodb-docker/docker-compose.yml"
ls "$WORKSPACE_ROOT/tlef-qdrant/docker-compose.yml"

# Check .env files exist
ls "$WORKSPACE_ROOT/tlef-create/.env"
ls "$WORKSPACE_ROOT/tlef-mongodb-docker/.env"

# Check node_modules
ls "$WORKSPACE_ROOT/tlef-create/node_modules/.bin/vite"

# Check scripts
ls "$WORKSPACE_ROOT/start-dev.sh"
ls "$WORKSPACE_ROOT/start-app.sh"
```

If all checks pass, report to the user:

> **Setup complete.** Run the following to start everything:
> ```bash
> cd <WORKSPACE_ROOT>
> ./start-dev.sh     # start Docker services (MongoDB, Qdrant, SAML)
> ./start-app.sh     # start frontend + backend in a new terminal
> ```
> Then open http://localhost:8092 in your browser.
> Log in with: `faculty` / `faculty`

---

## 8. Optional: Canvas LMS integration

Skip this section unless the user needs Canvas integration.

1. Ensure `canvas-lms-docker/` was cloned in step 2.
2. Follow the Canvas setup guide: `tlef-create/canvas-lti-local-setup.md`
3. After Canvas is running, update `CANVAS_CLIENT_SECRET` in `tlef-create/.env`
   with the Developer Key secret from Canvas admin panel.

---

## Service Reference

| Service | URL | Credentials |
|---|---|---|
| Frontend | http://localhost:8092 | — |
| Backend API | http://localhost:8051/api/create | — |
| MongoDB | mongodb://localhost:27017 | tlef-app / tlef-app-2024 |
| Mongo Express | http://localhost:8081 | admin / tlef-express-dev |
| Qdrant Dashboard | http://localhost:6333/dashboard | api-key: super-secret-dev-key |
| SAML IdP | http://localhost:8080/simplesaml | faculty/faculty, student/student |
| LiteLLM Proxy | http://localhost:4000 | — |
| Ollama | http://localhost:11434 | — |
