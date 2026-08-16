#!/bin/bash
# Create a new git worktree for parallel feature development
#
# Usage:
#   ./scripts/worktree/new.sh <feature-name>
#   ./scripts/worktree/new.sh fix-auth-bug
#   ./scripts/worktree/new.sh social-graph-perf
#
# Creates:
#   <main-repo>/.worktrees/<feature-name>/
#   Branch: feature/<feature-name>
#   Ports: auto-assigned based on feature name hash
#   Database: seeded from main

set -e

# Dynamic path detection.
#
# --git-common-dir, NOT --show-toplevel. Both name the main repo when run
# from it, but --show-toplevel names the *current* worktree when run from
# inside one, and worktrees now nest under it: that spelling turns a
# new.sh invoked from a worktree into .worktrees/<a>/.worktrees/<b>, a
# worktree inside a worktree. --git-common-dir always resolves to the
# shared .git of the main worktree, so this is pinned wherever it runs.
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

# Colors
# shellcheck source=../colors.sh
source "$MAIN_REPO/scripts/colors.sh"
WORKTREES_DIR="$MAIN_REPO/.worktrees"

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

# Calculate a deterministic offset from the feature name. cksum gives a
# 32-bit hash with vastly better distribution than the per-character sum
# we used before. 90 slots per band (offsets 10..99) — the offset doesn't
# have to be a multiple of 10, so we get ~12 active worktrees before
# birthday-paradox collisions become likely (vs. ~3 before).
calculate_port_offset() {
    local name="$1"
    local hash
    hash=$(printf '%s' "$name" | cksum | cut -d' ' -f1)
    echo $(( hash % 90 + 10 ))
}

# Worktree port bands — each service has its own dedicated 100-wide band
# above main's ports (3000, 8000, 8080, 8090). Bands are disjoint from
# each other AND from main, so no worktree port can ever equal any
# main-repo port — even across services (an offset-90 worktree FastAPI
# can't land on main's 8090 PB anymore).
#
# Bands:
#   Vite       3110-3199
#   FastAPI    8210-8299
#   Caddy      8310-8399
#   PocketBase 8410-8499
ports_for_offset() {
    local offset="$1"
    VITE_PORT=$((3100 + offset))
    FASTAPI_PORT=$((8200 + offset))
    CADDY_PORT=$((8300 + offset))
    POCKETBASE_PORT=$((8400 + offset))
}

# Collect offsets already claimed by sibling worktrees, running or not.
# Each .env declares VITE_PORT and the four service ports share one
# offset — so VITE_PORT alone identifies the claim. Old-scheme worktrees
# (VITE_PORT < 3100) are correctly ignored: their bands don't overlap
# with the new bands so they can't collide.
collect_claimed_offsets() {
    local env_file vite_port offset
    for env_file in "$WORKTREES_DIR"/*/.env; do
        [ -f "$env_file" ] || continue
        [ "$env_file" = "$WORKTREE_DIR/.env" ] && continue
        vite_port=$(grep -E '^VITE_PORT=' "$env_file" | tail -1 | cut -d= -f2 | tr -dc '0-9')
        [ -n "$vite_port" ] || continue
        offset=$((vite_port - 3100))
        if [ "$offset" -ge 10 ] && [ "$offset" -le 99 ]; then
            echo "$offset"
        fi
    done
}

INITIAL_OFFSET=$(calculate_port_offset "$FEATURE_NAME")
CLAIMED_OFFSETS=$(collect_claimed_offsets | sort -u)

# Walk forward cyclically through 10..99 from the hash-derived offset.
# First slot not in CLAIMED_OFFSETS wins. The first allocation of any
# feature name is fully deterministic; on collision we slide forward
# deterministically and persist the chosen offset in .env, so subsequent
# runs of the same worktree keep their ports.
PORT_OFFSET=""
for step in $(seq 0 89); do
    candidate=$(( (INITIAL_OFFSET - 10 + step) % 90 + 10 ))
    if ! echo "$CLAIMED_OFFSETS" | grep -qxF "$candidate"; then
        PORT_OFFSET=$candidate
        break
    fi
done
if [ -z "$PORT_OFFSET" ]; then
    echo -e "${RED}Error: every worktree port slot (10..99) is claimed.${NC}"
    echo -e "Run ${YELLOW}./scripts/worktree/list.sh${NC} and clean up unused worktrees."
    exit 1
fi
if [ "$PORT_OFFSET" != "$INITIAL_OFFSET" ]; then
    echo -e "${YELLOW}Note: hash-derived offset $INITIAL_OFFSET claimed by another worktree; using $PORT_OFFSET.${NC}"
fi
ports_for_offset "$PORT_OFFSET"

# Belt-and-suspenders: even after the sibling-.env scan, refuse to proceed
# if any allocated port is in use by something outside the worktree pool
# (an unrelated dev process, leftover services from a deleted worktree).
PORT_IN_USE=()
for port in "$VITE_PORT" "$FASTAPI_PORT" "$CADDY_PORT" "$POCKETBASE_PORT"; do
    if lsof -ti:"$port" >/dev/null 2>&1; then
        PORT_IN_USE+=("$port")
    fi
done
if [ ${#PORT_IN_USE[@]} -gt 0 ]; then
    echo -e "${RED}Error: port(s) in use by a non-worktree process: ${PORT_IN_USE[*]}${NC}"
    echo -e "Run ${YELLOW}lsof -i :${PORT_IN_USE[0]}${NC} to identify the holder."
    exit 1
fi

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

# Fetch latest origin/main (safe — never touches working tree or other branches)
cd "$MAIN_REPO"
echo -e "${BLUE}Fetching origin/main...${NC}"
git fetch origin main

# Create branch if it doesn't exist (based on origin/main, not local HEAD)
if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    echo -e "${BLUE}Using existing branch: $BRANCH_NAME${NC}"
else
    echo -e "${BLUE}Creating branch: $BRANCH_NAME (from origin/main)${NC}"
    git branch "$BRANCH_NAME" origin/main
fi

# Create worktree WITHOUT checkout first (need to setup git-crypt symlink)
# Note: --no-checkout is safe with dirty working trees — no stash needed
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

# Configure environment — .env with port overrides (also serves as fallback
# if the developer doesn't have Infisical/Doppler; the env-provider.sh in the
# worktree's scripts/ will prefer a secrets manager if available, then .env)
echo -e "${BLUE}Configuring environment...${NC}"
if [ -f "$MAIN_REPO/.env" ]; then
    cp "$MAIN_REPO/.env" "$WORKTREE_DIR/.env"
fi
# Always write worktree port overrides (even without .env, a secrets manager
# won't know the worktree-specific ports)
cat >> "$WORKTREE_DIR/.env" << EOF

# === Worktree Configuration ===
# Feature: $FEATURE_NAME
# Branch: $BRANCH_NAME
VITE_PORT=$VITE_PORT
FASTAPI_PORT=$FASTAPI_PORT
CADDY_PORT=$CADDY_PORT
POCKETBASE_PORT=$POCKETBASE_PORT
POCKETBASE_URL=http://127.0.0.1:$POCKETBASE_PORT
API_URL=http://127.0.0.1:$FASTAPI_PORT
API_PORT=$FASTAPI_PORT
WORKTREE_NAME=$FEATURE_NAME
EOF

# Install lefthook hooks in the worktree.
# --force overwrites stale .old backups: worktrees share the main repo's .git/hooks, and
# lefthook backs up existing hooks to <hook>.old on install. A leftover .old from a prior
# worktree makes the backup-rename fail ("can't rename pre-push to pre-push.old"), and with
# set -e that aborts new.sh mid-setup (before deps/local-config/DB-seed). --force skips that.
if command -v lefthook &> /dev/null; then
    lefthook install --reset-hooks-path --force
else
    echo -e "${YELLOW}Warning: lefthook not installed — run 'go install github.com/evilmartians/lefthook/v2@latest'${NC}"
fi

# Install dependencies (fast with caching)
echo -e "${BLUE}Installing dependencies...${NC}"
PIDS=()
uv sync --frozen &
PIDS+=($!)
npm ci --prefer-offline &  # Root deps (commitlint)
PIDS+=($!)
(cd frontend && npm ci --prefer-offline) &
PIDS+=($!)
(cd pocketbase && npm ci --prefer-offline) &  # PB migration/hook linting
PIDS+=($!)
INSTALL_FAILED=false
for pid in "${PIDS[@]}"; do
    if ! wait "$pid"; then
        INSTALL_FAILED=true
    fi
done
if [ "$INSTALL_FAILED" = true ]; then
    echo -e "${RED}Dependency installation failed${NC}"
    exit 1
fi

# Copy/link local config (branding, logos) if kindred-local exists
# Files needed by Docker builds are COPIED (symlinks break Docker build context).
# Dev-only files are symlinked to stay in sync with kindred-local.
LOCAL_REPO="${KINDRED_LOCAL_PATH:-$HOME/kindred-local}"
if [ -d "$LOCAL_REPO" ]; then
    echo -e "${BLUE}Setting up local config from kindred-local...${NC}"
    # Copied: files that Docker builds reference (COPY in Dockerfiles)
    rm -rf "$WORKTREE_DIR/local"
    cp -r "$LOCAL_REPO/local" "$WORKTREE_DIR/local"
    cp -f "$LOCAL_REPO/config/branding.local.json" "$WORKTREE_DIR/config/branding.local.json"
    cp -f "$LOCAL_REPO/config/staff_list.json" "$WORKTREE_DIR/config/staff_list.json"
    cp -f "$LOCAL_REPO/config/nicknames_override.json" "$WORKTREE_DIR/config/nicknames_override.json" 2>/dev/null || true
    # Symlinked: dev-only files (not in Docker build context)
    ln -sfr "$LOCAL_REPO/CLAUDE.local.md" "$WORKTREE_DIR/CLAUDE.local.md"
    ln -sfr "$LOCAL_REPO/config/sheets_sharing.local.json" "$WORKTREE_DIR/config/sheets_sharing.local.json"
    # The weekend-lodging unit registry, read at boot by PocketBase. Symlinked
    # rather than copied so a worktree tracks kindred-local as the registry
    # grows. See docs/reference/lodging-registry.md.
    ln -sfr "$LOCAL_REPO/config/lodging_registry.json" "$WORKTREE_DIR/config/lodging_registry.json"
    ln -sfr "$LOCAL_REPO/frontend/vite.config.local.ts" "$WORKTREE_DIR/frontend/vite.config.local.ts"
    ln -sfr "$LOCAL_REPO/scripts/vault.config" "$WORKTREE_DIR/scripts/vault.config"
    rm -rf "$WORKTREE_DIR/docs/camp"
    ln -sfrn "$LOCAL_REPO/docs/camp" "$WORKTREE_DIR/docs/camp"
    echo -e "${GREEN}Local config set up (Docker files copied, dev files linked)${NC}"
else
    echo -e "${YELLOW}kindred-local not found at $LOCAL_REPO, skipping local config${NC}"
fi

# Build PocketBase
echo -e "${BLUE}Building PocketBase...${NC}"
(cd pocketbase && go build -o pocketbase .)

# Seed database from main.
#
# Use sqlite3 .backup (online backup API), NOT cp. Plain cp of a live SQLite
# file can capture an inconsistent snapshot when WAL pages are mid-flight,
# producing a copy that opens fine but reports "database disk image is
# malformed" the first time PB queries the affected page. The online backup
# API holds a shared lock on the source while streaming pages, so it is safe
# to run against a database another process is reading/writing.
echo -e "${BLUE}Seeding database from main...${NC}"
if [ -f "$MAIN_REPO/pocketbase/pb_data/data.db" ]; then
    if ! command -v sqlite3 &> /dev/null; then
        echo -e "${RED}Error: sqlite3 CLI not found — required for safe DB seeding${NC}"
        exit 1
    fi
    mkdir -p "$WORKTREE_DIR/pocketbase/pb_data"
    # Online backup is safe even if main's PB is running. Do NOT copy *-shm /
    # *-wal — the destination .db produced by .backup is already self-consistent
    # in rollback-journal mode and stale WAL files from main would override it.
    sqlite3 "$MAIN_REPO/pocketbase/pb_data/data.db" \
        ".backup '$WORKTREE_DIR/pocketbase/pb_data/data.db'"
    # Mark as initialized so start_dev.sh skips admin bootstrap (DB already has credentials)
    touch "$WORKTREE_DIR/pocketbase/pb_data/.initialized"
    echo -e "${GREEN}Database seeded from main${NC}"
else
    echo -e "${YELLOW}No database in main to seed (will start fresh)${NC}"
fi

# Create logs directory for local dev
mkdir -p "$WORKTREE_DIR/logs"

# Summary
echo -e ""
echo -e "${GREEN}=== Worktree Ready ===${NC}"
echo -e ""
echo -e "  cd $WORKTREE_DIR"
echo -e "  ./scripts/start_dev.sh"
echo -e ""
echo -e "Ports:"
echo -e "  Vite:       http://localhost:$VITE_PORT"
echo -e "  Caddy:      http://localhost:$CADDY_PORT"
echo -e "  PocketBase: http://localhost:$POCKETBASE_PORT/_/"
echo -e "  API:        http://localhost:$FASTAPI_PORT/docs"
echo -e ""
echo -e "When done: ${YELLOW}./scripts/worktree/cleanup.sh $FEATURE_NAME${NC}"
