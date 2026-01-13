#!/bin/bash
# Setup git-crypt for encrypting private files
# Files to encrypt are defined in .gitattributes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== git-crypt Setup ==="
echo ""

# Check if git-crypt is installed
if ! command -v git-crypt &> /dev/null; then
    echo "git-crypt not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install git-crypt
    elif [[ -f /etc/debian_version ]]; then
        sudo apt-get update -qq && sudo apt-get install -y git-crypt
    else
        echo "Please install git-crypt manually:"
        echo "  https://github.com/AGWA/git-crypt/blob/master/INSTALL.md"
        exit 1
    fi
fi

echo "✓ git-crypt $(git-crypt --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo 'installed')"
echo ""

cd "$REPO_ROOT"

# Check if already initialized
if [[ -d ".git-crypt" ]]; then
    echo "✓ git-crypt already initialized"

    # Check lock status
    if git-crypt status &>/dev/null; then
        echo "✓ Repository is unlocked"
    else
        echo "✗ Repository is locked. Run: git-crypt unlock <keyfile>"
    fi
else
    echo "Initializing git-crypt..."
    git-crypt init
    echo "✓ git-crypt initialized"

    # Export the symmetric key
    KEY_FILE="$HOME/kindred-git-crypt.key"
    echo ""
    echo "Exporting symmetric key to: $KEY_FILE"
    git-crypt export-key "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "✓ Key exported"
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  IMPORTANT: Back up this key file securely!                   ║"
    echo "║  Location: $KEY_FILE"
    echo "║                                                                ║"
    echo "║  Without this key, encrypted files cannot be recovered.       ║"
    echo "║  Store it in your password manager (1Password, etc.)          ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
fi

echo ""

# Show which files will be encrypted
echo "Files configured for encryption (.gitattributes):"
grep "filter=git-crypt" "$REPO_ROOT/.gitattributes" | grep -v "^#" | awk '{print "  - " $1}' || true

echo ""

# Check if files exist
echo "Current status:"
for pattern in "config/branding.local.json" "config/staff_list.json" "local"; do
    if [[ -e "$REPO_ROOT/$pattern" ]]; then
        echo "  ✓ $pattern exists"
    else
        echo "  - $pattern (not found - create when ready)"
    fi
done

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo ""
echo "  1. Create your private files (if they don't exist):"
echo "     cp config/branding.json config/branding.local.json"
echo "     # Edit with camp-specific values"
echo ""
echo "  2. Add and commit the encrypted files:"
echo "     git add config/branding.local.json config/staff_list.json local/"
echo "     git commit -m 'chore(config): add encrypted camp branding'"
echo ""
echo "  3. On a new machine, unlock with:"
echo "     git-crypt unlock ~/kindred-git-crypt.key"
echo ""
echo "  4. For CI/CD, store the base64-encoded key as a GitHub secret:"
echo "     base64 < ~/kindred-git-crypt.key | pbcopy  # macOS"
echo "     # Add as GIT_CRYPT_KEY secret in GitHub"
echo ""
