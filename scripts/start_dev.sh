#!/bin/bash
# Development startup script for Kindred with full CampMinder mirror
# Architecture: Caddy serves static files and proxies, PocketBase serves API, Solver handles business logic

set -e

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Colors for output
# shellcheck source=./colors.sh
source "$SCRIPT_DIR/colors.sh"

# Load environment from best available provider (Infisical → Doppler → .env)
# shellcheck source=./env-provider.sh
source "$SCRIPT_DIR/env-provider.sh"
if ! load_env "$PROJECT_ROOT"; then
    exit 1
fi

if [ -n "${WORKTREE_NAME:-}" ]; then
    echo -e "${GREEN}Starting Kindred Development Environment${NC} (worktree: ${YELLOW}${WORKTREE_NAME}${NC})"
else
    echo -e "${GREEN}Starting Kindred Development Environment${NC}"
fi

# Port configuration (can be overridden via .env for worktrees)
POCKETBASE_PORT="${POCKETBASE_PORT:-8090}"
VITE_PORT="${VITE_PORT:-3000}"
FASTAPI_PORT="${FASTAPI_PORT:-8000}"
CADDY_PORT="${CADDY_PORT:-8080}"

# Always rebuild PocketBase in development
echo -e "${YELLOW}Building PocketBase...${NC}"
cd "$PROJECT_ROOT/pocketbase"
if go build -o pocketbase .; then
    echo -e "${GREEN}PocketBase built successfully${NC}"
else
    echo -e "${RED}Failed to build PocketBase${NC}"
    exit 1
fi
cd "$PROJECT_ROOT"

# Kill any existing processes on our ports
echo -e "${YELLOW}Cleaning up existing processes...${NC}"
lsof -ti:"$POCKETBASE_PORT" | xargs kill -9 2>/dev/null || true
lsof -ti:"$VITE_PORT" | xargs kill -9 2>/dev/null || true
lsof -ti:"$FASTAPI_PORT" | xargs kill -9 2>/dev/null || true
lsof -ti:"$CADDY_PORT" | xargs kill -9 2>/dev/null || true

# Start PocketBase
echo -e "${BLUE}Starting PocketBase on port ${POCKETBASE_PORT:-8090}...${NC}"
cd "$PROJECT_ROOT/pocketbase"
./pocketbase serve --http=0.0.0.0:$POCKETBASE_PORT &
POCKETBASE_PID=$!

# Wait for PocketBase to be ready
echo "Waiting for PocketBase to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:$POCKETBASE_PORT/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}PocketBase is ready${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}ERROR: PocketBase failed to start${NC}"
        kill "$POCKETBASE_PID" 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Check if this is the first run (no .initialized marker)
INITIALIZED_MARKER="$PROJECT_ROOT/pocketbase/pb_data/.initialized"
if [ ! -f "$INITIALIZED_MARKER" ]; then
    echo -e "${BLUE}First run detected. Creating admin user...${NC}"

    # Ensure required environment variables are set with defaults
    POCKETBASE_ADMIN_EMAIL="${POCKETBASE_ADMIN_EMAIL:-admin@camp.local}"

    # Security: Require password from .env or use a generated one
    if [ -z "$POCKETBASE_ADMIN_PASSWORD" ]; then
        # Generate a random password for first-time setup
        POCKETBASE_ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
        echo -e "${RED}SECURITY WARNING: No POCKETBASE_ADMIN_PASSWORD set in .env${NC}"
        echo -e "${YELLOW}Generated temporary password: $POCKETBASE_ADMIN_PASSWORD${NC}"
        echo -e "${YELLOW}Add to your .env file: POCKETBASE_ADMIN_PASSWORD=$POCKETBASE_ADMIN_PASSWORD${NC}"
    fi

    echo -e "${YELLOW}Using admin credentials: $POCKETBASE_ADMIN_EMAIL${NC}"

    # Create admin user using superuser upsert command
    echo -e "${BLUE}Creating admin user...${NC}"
    cd "$PROJECT_ROOT/pocketbase"
    if ./pocketbase superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD"; then
        echo -e "${GREEN}Admin user created successfully${NC}"
        # Mark as initialized only on success
        touch "$INITIALIZED_MARKER"
    else
        echo -e "${RED}Warning: Failed to create admin user automatically${NC}"
        echo -e "${YELLOW}You may need to create it manually through the UI${NC}"
    fi
    cd "$PROJECT_ROOT"
else
    echo -e "${GREEN}PocketBase already initialized, skipping admin creation${NC}"
fi

# Install frontend dependencies if needed (missing or outdated)
cd "$PROJECT_ROOT/frontend"
if [ ! -d "node_modules" ] || [ "package-lock.json" -nt "node_modules/.package-lock.json" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
else
    echo -e "${GREEN}Frontend dependencies up to date${NC}"
fi

# Install Python dependencies using uv (creates .venv automatically, smart caching)
echo -e "${YELLOW}Installing Python dependencies with uv...${NC}"
cd "$PROJECT_ROOT"
uv sync --frozen || {
    echo -e "${RED}Failed to install requirements${NC}"
    exit 1
}
echo -e "${GREEN}Python dependencies installed${NC}"

# Configure OAuth2 if environment variables are set
echo -e "${BLUE}Configuring OAuth2 provider...${NC}"
if [ -n "$OIDC_CLIENT_ID" ] && [ -n "$OIDC_CLIENT_SECRET" ]; then
    if uv run python "$PROJECT_ROOT/scripts/setup/configure_pocketbase_oauth.py"; then
        echo -e "${GREEN}OAuth2 provider configured successfully${NC}"
    else
        echo -e "${YELLOW}Warning: OAuth2 configuration failed${NC}"
        echo -e "${YELLOW}You may need to configure it manually in PocketBase admin${NC}"
    fi
else
    echo -e "${YELLOW}OAuth2 environment variables not found, skipping configuration${NC}"
fi

# Start the API service (using new modular api/ package)
echo -e "${BLUE}Starting API Service on port ${FASTAPI_PORT:-8000}...${NC}"
cd "$PROJECT_ROOT"
# Create a log file for API service
API_LOG="$PROJECT_ROOT/solver_service.log"  # Keep same log name for compatibility
echo "Starting API service at $(date)" > "$API_LOG"
uv run uvicorn api.main:app --host 0.0.0.0 --port $FASTAPI_PORT > >(tee -a "$API_LOG") 2>&1 &
API_PID=$!
echo -e "${GREEN}API service started with PID: $API_PID${NC}"
echo -e "${YELLOW}API logs: $API_LOG${NC}"

# Wait for API service to be ready
echo "Waiting for API Service to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:$FASTAPI_PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}API service is healthy${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}Warning: API service may not have started properly${NC}"
        echo -e "${YELLOW}Check logs at: $API_LOG${NC}"
    fi
    sleep 1
done

# Generate API TypeScript types from the FastAPI OpenAPI schema.
# Runs AFTER the API is started so that any schema changes since the last
# dev session are captured before the frontend build.
echo -e "${BLUE}Generating API TypeScript types...${NC}"
cd "$PROJECT_ROOT/frontend"
if npm run generate:api-types; then
    echo -e "${GREEN}API types generated${NC}"
else
    echo -e "${YELLOW}Warning: API type generation failed — using previously generated types${NC}"
    echo -e "${YELLOW}Run 'npm run generate:api-types' from frontend/ to retry${NC}"
fi

# Build frontend for nginx (development mode)
# Set VITE_DISABLE_AUTH=true so the build includes admin credentials for bypass mode
echo -e "${BLUE}Building frontend for nginx...${NC}"
cd "$PROJECT_ROOT/frontend"
VITE_DISABLE_AUTH=true npm run build

# Copy frontend build to PocketBase
echo -e "${BLUE}Copying frontend build to PocketBase...${NC}"
mkdir -p "$PROJECT_ROOT/pocketbase/pb_public"
rm -rf "$PROJECT_ROOT/pocketbase/pb_public"/*
cp -r "$PROJECT_ROOT/frontend/dist"/* "$PROJECT_ROOT/pocketbase/pb_public/"

# Copy local assets if they exist (camp-specific logos, etc.)
if [ -d "$PROJECT_ROOT/local" ]; then
    echo -e "${BLUE}Copying local assets to pb_public...${NC}"
    cp -r "$PROJECT_ROOT/local" "$PROJECT_ROOT/pocketbase/pb_public/"
    echo -e "${GREEN}Local assets copied${NC}"
fi

echo -e "${GREEN}Frontend copied to PocketBase${NC}"

# Start Caddy on port 8080
echo -e "${BLUE}Starting Caddy on port ${CADDY_PORT:-8080}...${NC}"
# Set environment variables for Caddy
# Use pb_public since it has both frontend build AND local assets
export FRONTEND_BUILD_PATH="$PROJECT_ROOT/pocketbase/pb_public"
export CADDY_PORT POCKETBASE_PORT FASTAPI_PORT ADMIN_ALLOWLIST
cd "$PROJECT_ROOT/frontend"
caddy run --config Caddyfile --adapter caddyfile &
CADDY_PID=$!
echo -e "${GREEN}Caddy started with PID: $CADDY_PID${NC}"

# Wait for Caddy to be ready
for i in {1..15}; do
    if curl -s http://127.0.0.1:$CADDY_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}Caddy is ready${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}Warning: Caddy may not have started properly${NC}"
    fi
    sleep 1
done

# Clear Vite cache to prevent stale module HMR errors
echo -e "${BLUE}Clearing Vite cache...${NC}"
rm -rf "$PROJECT_ROOT/frontend/node_modules/.vite"

# Start the React frontend in dev mode
echo -e "${BLUE}Starting React Frontend on port ${VITE_PORT:-3000}...${NC}"
cd "$PROJECT_ROOT/frontend"
# Set VITE_DISABLE_AUTH=true so Vite injects admin credentials for bypass mode
# Add --clearScreen false to prevent Vite from clearing the terminal
VITE_DISABLE_AUTH=true npm run dev -- --host --port $VITE_PORT --clearScreen false &
FRONTEND_PID=$!

# All services are now started

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    [ -n "$POCKETBASE_PID" ] && kill "$POCKETBASE_PID" 2>/dev/null || true
    [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
    [ -n "$CADDY_PID" ] && kill "$CADDY_PID" 2>/dev/null || true

    # Wait for processes to terminate
    sleep 2

    echo -e "${GREEN}All services stopped${NC}"
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

echo -e "\n${GREEN}=== All services started! ===${NC}"
echo -e "${GREEN}React Frontend: ${YELLOW}http://localhost:${VITE_PORT:-3000}${NC} (Vite dev server with HMR)"
echo -e "${GREEN}Caddy: ${YELLOW}http://localhost:${CADDY_PORT:-8080}${NC} (serves production build and proxies APIs)"
echo -e "${GREEN}PocketBase Admin: ${YELLOW}http://localhost:${CADDY_PORT:-8080}/_/${NC} (via Caddy)"
echo -e "${GREEN}PocketBase API: ${YELLOW}http://localhost:${POCKETBASE_PORT:-8090}/api${NC} (direct access)"
echo -e "${GREEN}Bunking API: ${YELLOW}http://localhost:${FASTAPI_PORT:-8000}${NC} (direct access)"
echo -e "\n${YELLOW}Admin credentials: ${POCKETBASE_ADMIN_EMAIL:-admin@camp.local}${NC}"
if [ -n "$POCKETBASE_ADMIN_PASSWORD" ]; then
    echo -e "${YELLOW}Password is set in .env (not shown for security)${NC}"
else
    echo -e "${RED}WARNING: No password set - check .env file${NC}"
fi

# Show process status
echo -e "\n${BLUE}Service Status:${NC}"
echo -e "PocketBase PID: $POCKETBASE_PID - $(ps -p $POCKETBASE_PID > /dev/null 2>&1 && echo -e "${GREEN}Running${NC}" || echo -e "${RED}Not Running${NC}")"
echo -e "API PID: $API_PID - $(ps -p $API_PID > /dev/null 2>&1 && echo -e "${GREEN}Running${NC}" || echo -e "${RED}Not Running${NC}")"
echo -e "Caddy PID: $CADDY_PID - $(ps -p $CADDY_PID > /dev/null 2>&1 && echo -e "${GREEN}Running${NC}" || echo -e "${RED}Not Running${NC}")"
echo -e "Frontend PID: $FRONTEND_PID - $(ps -p $FRONTEND_PID > /dev/null 2>&1 && echo -e "${GREEN}Running${NC}" || echo -e "${RED}Not Running${NC}")"

echo -e "\n${YELLOW}Logs:${NC}"
echo -e "API logs: $API_LOG"
echo -e "\nPress Ctrl+C to stop all services"

# Keep script running
wait
