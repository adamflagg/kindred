#!/bin/bash
# Quick pre-commit checks - should complete in ~15 seconds
#
# Philosophy: Fast local checks catch 90% of issues.
# CI handles comprehensive linting, security scanning, and tests.
#
# To skip (for WIP commits): git commit --no-verify

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# Verify uv is available (manages Python environment)
if ! command -v uv &> /dev/null; then
    echo -e "${RED}Error: uv not found!${NC}"
    echo "Please install uv first: https://docs.astral.sh/uv/getting-started/installation/"
    exit 1
fi

echo "🔍 Running quick pre-commit checks..."
echo "=================================="

# Track if any checks fail
FAILED=0

# 1. Python formatting with ruff
echo -n "Python formatting (ruff format)... "
if uv run ruff format --check . --exclude="docs/,drive/" > /tmp/ruff_format_output.txt 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Files need formatting:"
    head -20 /tmp/ruff_format_output.txt
    echo ""
    echo "Tip: Run 'uv run ruff format .' to auto-format"
    FAILED=1
fi

# 2. Python linting with ruff (includes import sorting via 'I' in ruff.toml)
echo -n "Python linting (ruff)... "
if uv run ruff check . --exclude="docs/,drive/" > /tmp/ruff_output.txt 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Ruff found issues:"
    cat /tmp/ruff_output.txt
    echo ""
    echo "Tip: Run 'uv run ruff check . --fix' to auto-fix some issues"
    FAILED=1
fi

# 3. Python type checking with mypy (catches async/sync mismatches, type errors)
echo -n "Python types (mypy)... "
if uv run mypy . --explicit-package-bases --no-error-summary > /tmp/mypy_output.txt 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "mypy found type errors:"
    head -30 /tmp/mypy_output.txt
    echo ""
    echo "Full output: cat /tmp/mypy_output.txt"
    FAILED=1
fi

# 4. TypeScript type checking
echo -n "TypeScript types... "
if (cd frontend && npm run type-check > /tmp/ts_check.txt 2>&1); then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "TypeScript errors:"
    cat /tmp/ts_check.txt
    FAILED=1
fi

# 4b. Frontend ESLint (catches React hooks issues, now with errors not warnings)
echo -n "Frontend linting (ESLint)... "
if (cd frontend && npm run lint > /tmp/eslint_output.txt 2>&1); then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "ESLint errors:"
    head -30 /tmp/eslint_output.txt
    FAILED=1
fi

# 5. Check for large files in git (>5MB)
echo -n "Large files check... "
LARGE_FILES=$(git ls-files | while read -r file; do
    if [ -f "$file" ]; then
        size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null)
        if [ "$size" -gt 5242880 ]; then
            echo "$file"
        fi
    fi
done | head -5)

if [ -z "$LARGE_FILES" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Large files tracked by git (>5MB):"
    echo "$LARGE_FILES"
    FAILED=1
fi

# 6. Go checks (if Go code exists)
if [ -d "pocketbase" ] && [ -n "$(find pocketbase -name '*.go' -type f 2>/dev/null | head -1)" ]; then
    if command -v go &> /dev/null; then
        # Go format check (fast, catches most style issues)
        echo -n "Go formatting (gofmt)... "
        UNFORMATTED=$(gofmt -l pocketbase 2>/dev/null)
        if [ -z "$UNFORMATTED" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗${NC}"
            echo "Files need formatting:"
            echo "$UNFORMATTED"
            echo "Run: gofmt -w pocketbase"
            FAILED=1
        fi

        # Go vet (catches real bugs, fast)
        echo -n "Go static analysis (go vet)... "
        if (cd pocketbase && go vet ./... > /tmp/govet_output.txt 2>&1); then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗${NC}"
            echo "Go vet found issues:"
            cat /tmp/govet_output.txt
            FAILED=1
        fi

        # Note: golangci-lint runs in CI for comprehensive linting
        # Run locally with: cd pocketbase && golangci-lint run
    else
        echo -e "${YELLOW}⚠ Go not installed - skipping Go checks${NC}"
    fi
fi

# 7. Shell script linting (if shellcheck installed)
if command -v shellcheck &> /dev/null; then
    echo -n "Shell scripts (shellcheck)... "
    if shellcheck --severity=warning scripts/*.sh scripts/**/*.sh .githooks/* docker/*.sh frontend/*.sh tests/shell/*.sh > /tmp/shellcheck_output.txt 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        echo "shellcheck found issues:"
        head -30 /tmp/shellcheck_output.txt
        echo ""
        echo "Full output: cat /tmp/shellcheck_output.txt"
        FAILED=1
    fi
else
    echo -e "${YELLOW}⚠ shellcheck not installed - skipping shell script checks${NC}"
fi

# 8. JSON config validation
echo -n "JSON config files... "
JSON_ERRORS=""
for f in config/*.json bunking/*.json; do
    if [ -f "$f" ]; then
        if ! python3 -m json.tool "$f" > /dev/null 2>&1; then
            JSON_ERRORS="${JSON_ERRORS}  $f\n"
        fi
    fi
done
if [ -z "$JSON_ERRORS" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Invalid JSON files:"
    echo -e "$JSON_ERRORS"
    FAILED=1
fi

# 9. Caddyfile validation (if caddy installed)
if command -v caddy &> /dev/null; then
    echo -n "Caddyfile validation... "
    CADDY_ERRORS=""
    for f in docker/Caddyfile frontend/Caddyfile; do
        if [ -f "$f" ]; then
            if ! caddy validate --config "$f" > /tmp/caddy_output.txt 2>&1; then
                CADDY_ERRORS="${CADDY_ERRORS}  $f\n"
            fi
        fi
    done
    if [ -z "$CADDY_ERRORS" ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        echo "Invalid Caddyfiles:"
        echo -e "$CADDY_ERRORS"
        cat /tmp/caddy_output.txt
        FAILED=1
    fi
else
    echo -e "${YELLOW}⚠ caddy not installed - skipping Caddyfile checks${NC}"
fi

# 10. Dockerfile linting (if docker available)
if command -v docker &> /dev/null && [ -f "Dockerfile" ]; then
    echo -n "Dockerfile linting (hadolint)... "
    if docker run --rm -i -v "$PWD/.hadolint.yaml:/.hadolint.yaml" hadolint/hadolint < Dockerfile > /tmp/hadolint_output.txt 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        echo "Hadolint errors:"
        cat /tmp/hadolint_output.txt
        FAILED=1
    fi
fi

# Summary
echo "=================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All quick checks passed!${NC}"
    echo "Ready to commit."
    exit 0
else
    echo -e "${RED}❌ Some checks failed!${NC}"
    echo "Please fix the issues above before committing."
    echo ""
    echo "To skip pre-commit checks (for WIP): git commit --no-verify"
    exit 1
fi
