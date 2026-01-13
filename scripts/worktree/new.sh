#!/bin/bash
# Create a new git worktree for parallel feature development
#
# Usage:
#   ./scripts/worktree/new.sh <feature-name>
#   ./scripts/worktree/new.sh fix-auth-bug
#   ./scripts/worktree/new.sh social-graph-perf
#
# Creates:
#   <repo-parent>/<repo-name>-worktrees/<feature-name>/
#   Branch: feature/<feature-name>
#   Ports: auto-assigned based on feature name hash
#   Database: seeded from main

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Dynamic path detection
MAIN_REPO="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$MAIN_REPO")"
REPO_PARENT="$(dirname "$MAIN_REPO")"
WORKTREES_DIR="$REPO_PARENT/${REPO_NAME}-worktrees"

# Parse arguments
FEATURE_NAME="${1:-}"

if [ -z "$FEATURE_NAME" ]; then
    echo -e "${RED}Usage: $0 <feature-name>${NC}"
    echo -e ""
    echo -e "Examples:"
    echo -e "  $0 fix-auth-bug"
    echo -e "  $0 social-graph-perf"
    echo -e "  $0 solver-constraints"
    exit 1
fi

# Sanitize feature name (lowercase, hyphens only)
FEATURE_NAME=$(echo "$FEATURE_NAME" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | tr -cd 'a-z0-9-')
BRANCH_NAME="feature/$FEATURE_NAME"
WORKTREE_DIR="$WORKTREES_DIR/$FEATURE_NAME"

# Calculate deterministic port offset from feature name (10-90 range, step 10)
calculate_port_offset() {
    local name="$1"
    local hash=0
    for ((i=0; i<${#name}; i++)); do
        hash=$((hash + $(printf '%d' "'${name:$i:1}")))
    done
    # Range 1-9, multiply by 10 for offset
    echo $(( (hash % 9 + 1) * 10 ))
}

PORT_OFFSET=$(calculate_port_offset "$FEATURE_NAME")
VITE_PORT=$((3000 + PORT_OFFSET))
FASTAPI_PORT=$((8000 + PORT_OFFSET))
CADDY_PORT=$((8080 + PORT_OFFSET))
POCKETBASE_PORT=$((8090 + PORT_OFFSET))

echo -e "${GREEN}=== Creating Worktree: $FEATURE_NAME ===${NC}"
echo -e "Branch:    ${YELLOW}$BRANCH_NAME${NC}"
echo -e "Directory: ${YELLOW}$WORKTREE_DIR${NC}"
echo -e "Ports:     Vite=$VITE_PORT, API=$FASTAPI_PORT, Caddy=$CADDY_PORT, PB=$POCKETBASE_PORT"
echo -e ""

# Check if worktree already exists
if [ -d "$WORKTREE_DIR" ]; then
    echo -e "${RED}Error: Worktree already exists: $WORKTREE_DIR${NC}"
    echo -e "To remove: ./scripts/worktree/cleanup.sh $FEATURE_NAME"
    exit 1
fi

# Create worktrees directory if needed (with README so it persists)
mkdir -p "$WORKTREES_DIR"
if [ ! -f "$WORKTREES_DIR/README.md" ]; then
    cat > "$WORKTREES_DIR/README.md" << 'EOF'
# Git Worktrees

This directory contains git worktrees for parallel development.

Each subdirectory is an isolated working copy with its own:
- Branch (feature/<feature-name>)
- Dependencies (.venv, node_modules)
- Database (pocketbase/pb_data)
- Ports (auto-assigned)

**Commands** (run from main repo):
- `./scripts/worktree/new.sh <name>` - Create worktree
- `./scripts/worktree/list.sh` - List active worktrees
- `./scripts/worktree/cleanup.sh <name>` - Remove worktree

**This directory is local only** - not tracked by git.
EOF
fi

# Create branch if it doesn't exist
cd "$MAIN_REPO"
if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    echo -e "${BLUE}Using existing branch: $BRANCH_NAME${NC}"
else
    echo -e "${BLUE}Creating branch: $BRANCH_NAME${NC}"
    git branch "$BRANCH_NAME"
fi

# Stash any uncommitted changes in main (worktree gets committed state only)
STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${BLUE}Stashing uncommitted changes in main...${NC}"
    git stash push -m "worktree-setup: $FEATURE_NAME" --quiet
    STASHED=true
fi

# Create worktree WITHOUT checkout first (need to setup git-crypt symlink)
echo -e "${BLUE}Creating worktree...${NC}"
git worktree add --no-checkout "$WORKTREE_DIR" "$BRANCH_NAME"

# Symlink git-crypt keys so worktree can decrypt files
# Worktrees look in .git/worktrees/<name>/git-crypt/ but keys are in .git/git-crypt/
WORKTREE_GIT_DIR="$MAIN_REPO/.git/worktrees/$FEATURE_NAME"
if [ -d "$MAIN_REPO/.git/git-crypt" ]; then
    echo -e "${BLUE}Linking git-crypt keys...${NC}"
    ln -sf "$MAIN_REPO/.git/git-crypt" "$WORKTREE_GIT_DIR/git-crypt"
fi

# Now checkout (smudge filter can find keys via symlink)
cd "$WORKTREE_DIR"
echo -e "${BLUE}Checking out files...${NC}"
git checkout "$BRANCH_NAME"

# Restore stashed changes in main
cd "$MAIN_REPO"
if [ "$STASHED" = true ]; then
    echo -e "${BLUE}Restoring uncommitted changes in main...${NC}"
    git stash pop --quiet
fi

cd "$WORKTREE_DIR"

# Copy .env with port overrides
echo -e "${BLUE}Configuring environment...${NC}"
if [ -f "$MAIN_REPO/.env" ]; then
    cp "$MAIN_REPO/.env" "$WORKTREE_DIR/.env"
    cat >> "$WORKTREE_DIR/.env" << EOF

# === Worktree Configuration ===
# Feature: $FEATURE_NAME
# Branch: $BRANCH_NAME
VITE_PORT=$VITE_PORT
FASTAPI_PORT=$FASTAPI_PORT
CADDY_PORT=$CADDY_PORT
POCKETBASE_PORT=$POCKETBASE_PORT
WORKTREE_NAME=$FEATURE_NAME
EOF
fi

# Install dependencies (fast with caching)
echo -e "${BLUE}Installing dependencies...${NC}"
uv sync --frozen &
(cd frontend && npm install --prefer-offline) &
wait

# Build PocketBase
echo -e "${BLUE}Building PocketBase...${NC}"
(cd pocketbase && go build -o pocketbase .)

# Seed database from main
echo -e "${BLUE}Seeding database from main...${NC}"
if [ -f "$MAIN_REPO/pocketbase/pb_data/data.db" ]; then
    mkdir -p "$WORKTREE_DIR/pocketbase/pb_data"
    cp "$MAIN_REPO/pocketbase/pb_data/data.db" "$WORKTREE_DIR/pocketbase/pb_data/"
    # Copy WAL files if they exist (for consistency)
    cp "$MAIN_REPO/pocketbase/pb_data/data.db-shm" "$WORKTREE_DIR/pocketbase/pb_data/" 2>/dev/null || true
    cp "$MAIN_REPO/pocketbase/pb_data/data.db-wal" "$WORKTREE_DIR/pocketbase/pb_data/" 2>/dev/null || true
    echo -e "${GREEN}Database seeded from main${NC}"
else
    echo -e "${YELLOW}No database in main to seed (will start fresh)${NC}"
fi

# Create start script
cat > "$WORKTREE_DIR/start.sh" << 'SCRIPT'
#!/bin/bash
set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load environment
[ -f .env ] && { set -a; source .env; set +a; }

VITE_PORT="${VITE_PORT:-3000}"
FASTAPI_PORT="${FASTAPI_PORT:-8000}"
CADDY_PORT="${CADDY_PORT:-8080}"
POCKETBASE_PORT="${POCKETBASE_PORT:-8090}"

echo -e "${GREEN}Starting: ${WORKTREE_NAME:-worktree}${NC}"

# Kill existing on our ports
for port in $POCKETBASE_PORT $VITE_PORT $FASTAPI_PORT $CADDY_PORT; do
    lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
done

# Start PocketBase
cd pocketbase && ./pocketbase serve --http=0.0.0.0:$POCKETBASE_PORT &
PB_PID=$!
cd ..
sleep 3

# Start FastAPI
uv run uvicorn api.main:app --host 0.0.0.0 --port $FASTAPI_PORT &
API_PID=$!
sleep 2

# Build frontend
cd frontend
VITE_DISABLE_AUTH=true npm run build
cd ..
mkdir -p pocketbase/pb_public
rm -rf pocketbase/pb_public/*
cp -r frontend/dist/* pocketbase/pb_public/
[ -d local ] && cp -r local pocketbase/pb_public/

# Start Caddy (inline config with our ports)
cat > /tmp/Caddyfile.$$ << EOF
:$CADDY_PORT {
    @pocketbase path /api/collections /api/collections/* /api/files/* /api/realtime /api/custom/* /api/oauth2-redirect
    handle @pocketbase { reverse_proxy 127.0.0.1:$POCKETBASE_PORT }
    handle /_/* { reverse_proxy 127.0.0.1:$POCKETBASE_PORT }
    handle /health { reverse_proxy 127.0.0.1:$FASTAPI_PORT }
    handle /api/* { reverse_proxy 127.0.0.1:$FASTAPI_PORT }
    handle {
        root * $(pwd)/pocketbase/pb_public
        try_files {path} /index.html
        file_server
    }
}
EOF
caddy run --config /tmp/Caddyfile.$$ --adapter caddyfile &
CADDY_PID=$!

# Start Vite
cd frontend
VITE_DISABLE_AUTH=true npm run dev -- --host --port $VITE_PORT --clearScreen false &
VITE_PID=$!
cd ..

cleanup() {
    echo -e "\n${YELLOW}Stopping...${NC}"
    kill $PB_PID $API_PID $CADDY_PID $VITE_PID 2>/dev/null || true
    rm -f /tmp/Caddyfile.$$
}
trap cleanup EXIT INT TERM

echo -e "\n${GREEN}=== Running ===${NC}"
echo -e "Vite:       http://localhost:$VITE_PORT"
echo -e "Caddy:      http://localhost:$CADDY_PORT"
echo -e "PocketBase: http://localhost:$POCKETBASE_PORT/_/"
echo -e "API Docs:   http://localhost:$FASTAPI_PORT/docs"
echo -e "\nCtrl+C to stop"
wait
SCRIPT
chmod +x "$WORKTREE_DIR/start.sh"

# Ensure worktree-specific files are gitignored
if ! grep -q "^start.sh$" "$WORKTREE_DIR/.gitignore" 2>/dev/null; then
    echo -e "\n# Worktree-specific files" >> "$WORKTREE_DIR/.gitignore"
    echo "start.sh" >> "$WORKTREE_DIR/.gitignore"
fi

# Create logs directory for local dev
mkdir -p "$WORKTREE_DIR/logs"

# Summary
echo -e ""
echo -e "${GREEN}=== Worktree Ready ===${NC}"
echo -e ""
echo -e "  cd $WORKTREE_DIR"
echo -e "  ./start.sh"
echo -e ""
echo -e "Ports:"
echo -e "  Vite:       http://localhost:$VITE_PORT"
echo -e "  Caddy:      http://localhost:$CADDY_PORT"
echo -e "  PocketBase: http://localhost:$POCKETBASE_PORT/_/"
echo -e "  API:        http://localhost:$FASTAPI_PORT/docs"
echo -e ""
echo -e "When done: ${YELLOW}./scripts/worktree/cleanup.sh $FEATURE_NAME${NC}"
