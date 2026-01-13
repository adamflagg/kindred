#!/bin/bash
# Start PocketBase with OAuth2 auto-configuration

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "🚀 Starting PocketBase with OAuth2 auto-configuration"
echo "=================================================="

# Check if PocketBase executable exists
if [ ! -f "$PROJECT_ROOT/pocketbase/pocketbase" ]; then
    echo "❌ PocketBase executable not found at $PROJECT_ROOT/pocketbase/pocketbase"
    echo "Please ensure PocketBase is installed in the pocketbase directory"
    exit 1
fi

# Check if .env file exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "❌ .env file not found at $PROJECT_ROOT/.env"
    echo "Please create .env file with required OAuth2 configuration"
    exit 1
fi

# Change to PocketBase directory
cd "$PROJECT_ROOT/pocketbase"

# Start PocketBase in the background
echo "📦 Starting PocketBase..."
./pocketbase serve &
PB_PID=$!

# Give PocketBase time to initialize
echo "⏳ Waiting for PocketBase to initialize..."
sleep 3

# Configure OAuth2
echo ""
echo "🔧 Configuring OAuth2 provider..."
cd "$PROJECT_ROOT"

if python3 scripts/setup/configure_pocketbase_oauth.py; then
    echo ""
    echo "✅ OAuth2 configuration complete!"
    echo ""
    echo "🌐 PocketBase is running at http://localhost:8090"
    echo "🔐 Login with Pocket ID at http://localhost:8090"
    echo "📊 Admin dashboard at http://localhost:8090/_/"
    echo ""
    echo "Press Ctrl+C to stop PocketBase"
    echo ""
    
    # Keep PocketBase running in foreground
    wait $PB_PID
else
    echo ""
    echo "❌ OAuth2 configuration failed!"
    echo "Stopping PocketBase..."
    kill $PB_PID 2>/dev/null || true
    exit 1
fi