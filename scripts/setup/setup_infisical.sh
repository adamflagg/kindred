#!/bin/bash
# Install Infisical CLI and verify vault.config
# The ./scripts/vault wrapper handles all authentication

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$REPO_ROOT/scripts/vault.config"

echo "=== Infisical Setup ==="
echo ""

# Check if CLI is installed
if command -v infisical &> /dev/null; then
    VERSION=$(infisical --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    echo "✓ Infisical CLI v$VERSION installed"
else
    echo "Installing Infisical CLI..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install infisical/get-cli/infisical
    elif [[ -f /etc/debian_version ]]; then
        curl -1sLf 'https://artifacts-cli.infisical.com/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/infisical-archive-keyring.gpg 2>/dev/null || true
        echo "deb [signed-by=/usr/share/keyrings/infisical-archive-keyring.gpg] https://artifacts-cli.infisical.com/deb stable main" | sudo tee /etc/apt/sources.list.d/infisical-infisical-cli.list > /dev/null
        sudo apt-get update -qq && sudo apt-get install -y infisical
    else
        echo "Please install manually: https://infisical.com/docs/cli/overview"
        exit 1
    fi
    echo "✓ Infisical CLI installed"
fi

echo ""

# Check vault.config
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "✗ vault.config not found"
    echo ""
    echo "Create it:"
    echo "  cp scripts/vault.config.example scripts/vault.config"
    echo ""
    echo "Then set these values:"
    echo "  INFISICAL_DOMAIN      - Your Infisical URL"
    echo "  INFISICAL_PROJECT_ID  - From Project Settings → General"
    echo "  INFISICAL_CLIENT_ID   - From Machine Identity → Universal Auth"
    echo "  INFISICAL_CLIENT_SECRET"
    exit 1
fi

source "$CONFIG_FILE"

# Validate config
MISSING=""
[[ -z "$INFISICAL_DOMAIN" ]] && MISSING="$MISSING INFISICAL_DOMAIN"
[[ -z "$INFISICAL_PROJECT_ID" ]] && MISSING="$MISSING INFISICAL_PROJECT_ID"
[[ -z "$INFISICAL_CLIENT_ID" ]] && MISSING="$MISSING INFISICAL_CLIENT_ID"
[[ -z "$INFISICAL_CLIENT_SECRET" ]] && MISSING="$MISSING INFISICAL_CLIENT_SECRET"

if [[ -n "$MISSING" ]]; then
    echo "✗ Missing config values:$MISSING"
    exit 1
fi

echo "✓ vault.config is valid"
echo ""

# Test connection
echo "Testing connection to $INFISICAL_DOMAIN..."
if "$REPO_ROOT/scripts/vault" secrets &>/dev/null; then
    echo "✓ Connection successful"
else
    echo "✗ Connection failed - check your credentials"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Usage:"
echo "  ./scripts/vault run -- ./scripts/start_dev.sh"
echo "  ./scripts/vault secrets"
echo "  ./scripts/vault export --format=dotenv > .env"
echo ""
