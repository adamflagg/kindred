#!/usr/bin/env bash
# verify.sh — Detect changed files and run relevant pre-push checks.
#
# Usage:
#   bash verify.sh          # Auto-detect changes, run relevant checks
#   bash verify.sh --all    # Run all checks regardless of changes
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed
#
# This script mirrors the lefthook pre-push configuration in .lefthook.yml.
# It runs checks sequentially within each area but reports ALL failures.

set -euo pipefail

# Associative arrays (declare -A) below require bash 4+. macOS ships 3.2 by
# default — recommend `brew install bash` for contributors on that platform.
if ((BASH_VERSINFO[0] < 4)); then
    echo "Error: bash 4+ required (you have $BASH_VERSION)." >&2
    echo "On macOS, install via Homebrew: brew install bash" >&2
    exit 1
fi

# ── Find repo root ──────────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── Color helpers ───────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; }
skip() { echo -e "  ${YELLOW}SKIP${NC} $1"; }
header() { echo -e "\n${BLUE}${BOLD}── $1 ──${NC}"; }

# ── Parse args ──────────────────────────────────────────────────────────
RUN_ALL=false
if [[ "${1:-}" == "--all" ]]; then
    RUN_ALL=true
fi

# ── Detect changed files ───────────────────────────────────────────────
# Prefer @{push} — the upstream-tracked branch tip — so subsequent pushes
# only verify *new* unpushed commits, not the whole PR diff. Falls back to
# merge-base with origin/main for the first push (no upstream yet) or to
# HEAD~1 outside any remote-tracking branch.
if BASE=$(git rev-parse --verify --quiet '@{push}' 2>/dev/null); then
    :  # @{push} found
elif git rev-parse --verify origin/main &>/dev/null; then
    BASE=$(git merge-base HEAD origin/main 2>/dev/null || echo "HEAD~1")
else
    BASE="HEAD~1"
fi

# --diff-filter=ACMRT excludes Deletions (and Unmerged/X) so per-file loops
# below don't try to head/grep paths that no longer exist on disk.
CHANGED_FILES=$(git diff --diff-filter=ACMRT --name-only "$BASE" HEAD 2>/dev/null || true)
# Also include staged but uncommitted changes and unstaged modifications
CHANGED_FILES="$CHANGED_FILES"$'\n'$(git diff --diff-filter=ACMRT --name-only --cached 2>/dev/null || true)
CHANGED_FILES="$CHANGED_FILES"$'\n'$(git diff --diff-filter=ACMRT --name-only 2>/dev/null || true)
# Deduplicate
CHANGED_FILES=$(echo "$CHANGED_FILES" | sort -u | grep -v '^$' || true)

# Pre-extract frontend/src changed files (relative to frontend/) for the
# per-check file filter. Two lists because prettier covers .css/.json too
# but eslint is configured only for .ts/.tsx (--ext ts,tsx in package.json).
# Empty list → that check is skipped (tsc + vitest still cover the area).
CHANGED_FRONTEND_PRETTIER=$(echo "$CHANGED_FILES" \
    | grep -E '^frontend/src/.*\.(ts|tsx|js|jsx|css|json)$' \
    | sed 's|^frontend/||' \
    | grep -v '^$' || true)
CHANGED_FRONTEND_ESLINT=$(echo "$CHANGED_FILES" \
    | grep -E '^frontend/src/.*\.(ts|tsx)$' \
    | sed 's|^frontend/||' \
    | grep -v '^$' || true)

if [[ -z "$CHANGED_FILES" ]] && [[ "$RUN_ALL" == false ]]; then
    echo -e "${GREEN}No changed files detected. Nothing to verify.${NC}"
    echo "Use --all to run all checks regardless."
    exit 0
fi

# ── Detect areas ────────────────────────────────────────────────────────
HAS_PYTHON=false
HAS_GO=false
HAS_FRONTEND=false
HAS_MIGRATIONS=false
HAS_SHELL=false
HAS_PB_JS=false

if [[ "$RUN_ALL" == true ]]; then
    HAS_PYTHON=true
    HAS_GO=true
    HAS_FRONTEND=true
    HAS_MIGRATIONS=true
    HAS_SHELL=true
    HAS_PB_JS=true
else
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        case "$file" in
            *.py|pyproject.toml|ruff.toml)
                HAS_PYTHON=true ;;
            pocketbase/*.go|pocketbase/**/*.go|.golangci.yml|pocketbase/go.mod|pocketbase/go.sum)
                HAS_GO=true ;;
            frontend/src/*.ts|frontend/src/*.tsx|frontend/src/**/*.ts|frontend/src/**/*.tsx|frontend/src/**/*.css|frontend/eslint.config.js|frontend/tsconfig.json|frontend/tsconfig.node.json|frontend/vitest.config.ts)
                HAS_FRONTEND=true ;;
            pocketbase/pb_migrations/*.js)
                HAS_MIGRATIONS=true
                HAS_PB_JS=true ;;
            pocketbase/pb_hooks/*.js)
                HAS_PB_JS=true ;;
            *.sh)
                HAS_SHELL=true ;;
        esac
    done <<< "$CHANGED_FILES"

    # Broader pattern matching for paths that don't match simple globs
    if echo "$CHANGED_FILES" | grep -qE '\.py$|pyproject\.toml|ruff\.toml'; then
        HAS_PYTHON=true
    fi
    if echo "$CHANGED_FILES" | grep -qE 'pocketbase/.*\.go$|\.golangci\.yml|pocketbase/go\.(mod|sum)'; then
        HAS_GO=true
    fi
    if echo "$CHANGED_FILES" | grep -qE 'frontend/.*\.(ts|tsx|js|jsx|css)$|frontend/eslint\.config|frontend/tsconfig|frontend/vitest\.config'; then
        HAS_FRONTEND=true
    fi
    if echo "$CHANGED_FILES" | grep -qE 'pocketbase/pb_migrations/.*\.js$'; then
        HAS_MIGRATIONS=true
        HAS_PB_JS=true
    fi
    if echo "$CHANGED_FILES" | grep -qE 'pocketbase/pb_hooks/.*\.js$'; then
        HAS_PB_JS=true
    fi
    if echo "$CHANGED_FILES" | grep -qE '\.sh$'; then
        HAS_SHELL=true
    fi
fi

# ── Summary of what will run ───────────────────────────────────────────
echo -e "${BOLD}Pre-push verification${NC}"
echo -e "Mode: $( [[ "$RUN_ALL" == true ]] && echo '--all (everything)' || echo 'auto-detect' )"
echo ""
echo "Areas to check:"
$HAS_PYTHON     && echo "  - Python (ruff format, ruff check, mypy, pytest)" || true
$HAS_GO         && echo "  - Go (build, golangci-lint, tests)" || true
$HAS_FRONTEND   && echo "  - Frontend (prettier, eslint, tsc, vitest)" || true
$HAS_MIGRATIONS && echo "  - Migrations (header, options anti-pattern, build)" || true
$HAS_PB_JS      && echo "  - PocketBase JS (eslint)" || true
$HAS_SHELL      && echo "  - Shell (shellcheck)" || true
echo ""

# ── Track failures ─────────────────────────────────────────────────────
FAILURES=()

run_check() {
    local name="$1"
    shift
    if "$@" 2>&1; then
        pass "$name"
    else
        fail "$name"
        FAILURES+=("$name")
    fi
}

# ── Python checks ──────────────────────────────────────────────────────
if $HAS_PYTHON; then
    header "Python"

    # Format first (modifies files)
    run_check "ruff format" uv run ruff format .

    # Lint (with auto-fix for safe issues)
    run_check "ruff check" uv run ruff check --fix .

    # Type check
    run_check "mypy" uv run mypy . --explicit-package-bases

    # Unit tests
    run_check "pytest (unit)" uv run pytest tests/unit/ -v --tb=short
fi

# ── Go checks ──────────────────────────────────────────────────────────
if $HAS_GO; then
    header "Go"

    # Build first
    run_check "go build" bash -c "cd pocketbase && go build ."

    # Lint
    if command -v golangci-lint &>/dev/null; then
        run_check "golangci-lint" bash -c "cd pocketbase && golangci-lint run --config ../.golangci.yml"
    else
        skip "golangci-lint (not installed)"
    fi

    # Tests
    run_check "go test" bash -c "cd pocketbase && go test -race ./... -v"
fi

# ── Frontend checks (parallel, file-scoped) ────────────────────────────
# All four tools run concurrently; stdout+stderr captured per-tool and
# replayed in stable order so output stays readable. prettier + eslint are
# scoped to CHANGED_FRONTEND_REL (the files actually touched since BASE);
# tsc keeps full-project scope (signature changes propagate); vitest uses
# --changed BASE to run only test files whose dependency graph saw a
# change. Mirrors the lefthook `pre-push` philosophy.
if $HAS_FRONTEND; then
    header "Frontend (parallel)"

    LOGDIR=$(mktemp -d)
    trap 'rm -rf "$LOGDIR"' EXIT

    declare -A PIDS=()

    if [[ "$RUN_ALL" == true ]]; then
        ( cd frontend && npx prettier --check 'src/**/*.{ts,tsx,js,jsx,css,json}' ) \
            >"$LOGDIR/prettier.log" 2>&1 &
        PIDS[prettier]=$!
    elif [[ -n "$CHANGED_FRONTEND_PRETTIER" ]]; then
        # shellcheck disable=SC2086  # word-split is the intent: pass each path
        ( cd frontend && npx prettier --check $CHANGED_FRONTEND_PRETTIER ) \
            >"$LOGDIR/prettier.log" 2>&1 &
        PIDS[prettier]=$!
    else
        echo "  (no prettier-eligible frontend/src files changed — skipping prettier)"
    fi

    if [[ "$RUN_ALL" == true ]]; then
        ( cd frontend && npm run lint ) >"$LOGDIR/eslint.log" 2>&1 &
        PIDS[eslint]=$!
    elif [[ -n "$CHANGED_FRONTEND_ESLINT" ]]; then
        # shellcheck disable=SC2086
        ( cd frontend && npx eslint --report-unused-disable-directives $CHANGED_FRONTEND_ESLINT ) \
            >"$LOGDIR/eslint.log" 2>&1 &
        PIDS[eslint]=$!
    else
        echo "  (no .ts/.tsx files changed — skipping eslint)"
    fi

    ( cd frontend && npm run type-check ) >"$LOGDIR/tsc.log" 2>&1 &
    PIDS[tsc]=$!

    if [[ "$RUN_ALL" == true ]]; then
        ( cd frontend && npx vitest run ) >"$LOGDIR/vitest.log" 2>&1 &
    else
        ( cd frontend && npx vitest run --changed "$BASE" ) >"$LOGDIR/vitest.log" 2>&1 &
    fi
    PIDS[vitest]=$!

    for name in prettier eslint tsc vitest; do
        pid="${PIDS[$name]:-}"
        [[ -z "$pid" ]] && continue
        if wait "$pid"; then
            pass "$name"
        else
            fail "$name"
            FAILURES+=("$name")
            echo "── $name output ──"
            cat "$LOGDIR/$name.log"
        fi
    done
fi

# ── Migration checks ───────────────────────────────────────────────────
if $HAS_MIGRATIONS; then
    header "Migrations"

    # Check for /// <reference path header
    MIGRATION_HEADER_OK=true
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        [[ "$file" != pocketbase/pb_migrations/*.js ]] && continue
        if ! head -1 "$file" | grep -q '/// <reference path='; then
            echo "    Missing type reference header: $file"
            MIGRATION_HEADER_OK=false
        fi
    done <<< "$CHANGED_FILES"
    if $MIGRATION_HEADER_OK; then
        pass "migration headers"
    else
        fail "migration headers"
        FAILURES+=("migration headers")
    fi

    # Check for options: {} anti-pattern
    OPTIONS_OK=true
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        [[ "$file" != pocketbase/pb_migrations/*.js ]] && continue
        # Match only the object-form field wrapper `options: {`. Seed-data
        # `options: [ ... ]` arrays (e.g. select-option values in config.js) are
        # legitimate and must NOT be flagged — same object-vs-array distinction
        # the eslint no-restricted-syntax rule makes.
        if grep -n 'options\s*:\s*{' "$file" | grep -v '//.*options' | grep -q .; then
            echo "    Found 'options: {}' field wrapper (v0.23+ anti-pattern): $file"
            grep -n 'options\s*:\s*{' "$file" | grep -v '//.*options' | head -5 | while read -r line; do
                echo "      $line"
            done
            OPTIONS_OK=false
        fi
    done <<< "$CHANGED_FILES"
    if $OPTIONS_OK; then
        pass "no options:{} anti-pattern"
    else
        fail "no options:{} anti-pattern"
        FAILURES+=("options:{} anti-pattern found")
    fi

    # Go build covers migration parsing
    if ! $HAS_GO; then
        run_check "go build (migrations)" bash -c "cd pocketbase && go build ."
    fi
fi

# ── PocketBase JS lint ─────────────────────────────────────────────────
if $HAS_PB_JS; then
    header "PocketBase JS"
    run_check "pb-js-lint" bash -c "cd pocketbase && npm run lint"
fi

# ── Shell checks ───────────────────────────────────────────────────────
if $HAS_SHELL; then
    header "Shell"
    if command -v shellcheck &>/dev/null; then
        run_check "shellcheck" bash -c "find scripts/ docker/ frontend/ tests/shell/ -maxdepth 3 -name '*.sh' 2>/dev/null | xargs shellcheck --severity=warning"
    else
        skip "shellcheck (not installed)"
    fi
fi

# ── Summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
if [[ ${#FAILURES[@]} -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}ALL CHECKS PASSED${NC}"
    echo -e "${BOLD}═══════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}${BOLD}${#FAILURES[@]} CHECK(S) FAILED:${NC}"
    for f in "${FAILURES[@]}"; do
        echo -e "  ${RED}- $f${NC}"
    done
    echo -e "${BOLD}═══════════════════════════════════════${NC}"
    exit 1
fi
