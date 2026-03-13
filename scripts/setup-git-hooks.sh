#!/bin/bash
# Setup script to configure git hooks for this repository
# Run once after cloning or to update hooks configuration

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Setting up git hooks...${NC}"

# Configure git to use .githooks directory
git config core.hooksPath .githooks

# Remove stale .git/hooks/pre-commit if it exists (legacy, replaced by .githooks/)
if [ -f "$PROJECT_ROOT/.git/hooks/pre-commit" ] && [ ! -L "$PROJECT_ROOT/.git/hooks/pre-commit" ]; then
    rm -f "$PROJECT_ROOT/.git/hooks/pre-commit"
    echo -e "${YELLOW}Removed stale .git/hooks/pre-commit (replaced by .githooks/pre-commit)${NC}"
fi

echo -e "${GREEN}✓ Git hooks configured${NC}"
echo ""
echo "Active hooks:"
ls -la "$PROJECT_ROOT/.githooks/"
echo ""
echo -e "${GREEN}Done!${NC} Git will now use hooks from .githooks/"
echo ""
echo "Hooks installed:"
echo "  • commit-msg: Validates commit message format (type(scope): description)"
echo "  • pre-commit: Runs linting/formatting (quick_check.sh) + behind-origin warning"
echo "  • pre-push: Blocks pushing main when behind origin"
echo "  • post-merge: Notifies when worktree branches are merged (auto-cleanup reminder)"
