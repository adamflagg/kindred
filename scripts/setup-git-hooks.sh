#!/bin/bash
# Setup script to install and configure lefthook for git hooks
# Run once after cloning or to update hooks configuration

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$PROJECT_ROOT"

# shellcheck source=./colors.sh
source "$SCRIPT_DIR/colors.sh"

echo -e "${YELLOW}Setting up git hooks via lefthook...${NC}"

# Install lefthook if not available
if ! command -v lefthook &> /dev/null; then
    echo -e "${YELLOW}Installing lefthook...${NC}"
    if command -v go &> /dev/null; then
        go install github.com/evilmartians/lefthook/v2@latest
    else
        echo -e "${RED}Error: Go is required to install lefthook${NC}"
        echo "Install Go first: https://go.dev/dl/"
        exit 1
    fi
fi

# Unset core.hooksPath if set (legacy — lefthook manages .git/hooks/ directly)
if git config --get core.hooksPath &> /dev/null; then
    git config --unset core.hooksPath
    echo -e "${YELLOW}Cleared legacy core.hooksPath setting${NC}"
fi

# Remove stale hook files in .git/hooks/ from old setup
for hook in pre-commit pre-push commit-msg post-merge; do
    if [ -f ".git/hooks/$hook" ] && [ ! -L ".git/hooks/$hook" ]; then
        rm -f ".git/hooks/$hook"
    fi
done

# Install lefthook hooks
lefthook install

echo -e "${GREEN}✓ Lefthook installed and configured${NC}"
echo ""
echo "Hook stages (configured in .lefthook.yml):"
echo "  • pre-commit:  formatters + validators on staged files (<1s)"
echo "  • commit-msg:  conventional commit validation"
echo "  • pre-push:    linters + tests, parallel (~1 min)"
echo "  • post-merge:  worktree cleanup notifications"
echo ""
echo "Escape hatches:"
echo "  LEFTHOOK=0 git commit   — bypass all hooks"
echo "  git commit --no-verify  — bypass all hooks (git-native)"
