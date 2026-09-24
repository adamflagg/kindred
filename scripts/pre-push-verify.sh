#!/usr/bin/env bash
# pre-push-verify.sh — Detect changed files and run the checks the push hook does not.
#
# Usage:
#   bash scripts/pre-push-verify.sh          # Auto-detect changes, run relevant checks
#   bash scripts/pre-push-verify.sh --all    # Run all checks regardless of changes
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed
#
# Why this exists: .lefthook.yml moved `golangci-lint`, `eslint`, `hadolint` and
# `caddy-validate` to CI-only for push speed. The pre-push hook therefore builds Go and
# type-checks the frontend but never lints either — a clean push is not evidence of a clean
# lint, and the failure surfaces in CI minutes later. Running this first turns that
# round-trip into a local failure.
#
# It is a SUPERSET of the hook, not a mirror of it. Checks run sequentially within each
# area and ALL failures are reported, not just the first.

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
# but this scoped list stays .ts/.tsx: those are what frontend/src holds that
# eslint has anything to say about. (It used to cite `--ext ts,tsx` in
# package.json as the reason. That flag was a measured no-op -- 1193 files and
# 452 messages with and without it, and the file list included 7 .js files
# either way -- so it read as a scope restriction while restricting nothing.
# Removed in kindred#2669.)
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
HAS_LODGING=false

if [[ "$RUN_ALL" == true ]]; then
    HAS_PYTHON=true
    HAS_GO=true
    HAS_FRONTEND=true
    HAS_MIGRATIONS=true
    HAS_SHELL=true
    HAS_PB_JS=true
    HAS_LODGING=true
else
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        case "$file" in
            *.py|pyproject.toml|ruff.toml)
                HAS_PYTHON=true ;;
            pocketbase/*.go|.golangci.yml|pocketbase/go.mod|pocketbase/go.sum)
                HAS_GO=true ;;
            frontend/src/*.ts|frontend/src/*.tsx|frontend/src/*.css|frontend/eslint.config.js|frontend/tsconfig.json|frontend/tsconfig.node.json|frontend/vitest.config.ts)
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
    # Piping through `echo | grep -q` is unsafe under `set -o pipefail` (this
    # script sets it): grep -q exits as soon as it finds a match, and on a
    # large enough CHANGED_FILES an early match can make echo receive SIGPIPE
    # before it finishes writing. Pipefail then reports the pipeline's status
    # as echo's non-zero SIGPIPE exit rather than grep's successful match,
    # silently taking the "no match" branch on a real match (kindred#2796
    # review). A here-string avoids the pipe entirely.
    if grep -qE '\.py$|pyproject\.toml|ruff\.toml' <<< "$CHANGED_FILES"; then
        HAS_PYTHON=true
    fi
    if grep -qE 'pocketbase/.*\.go$|\.golangci\.yml|pocketbase/go\.(mod|sum)' <<< "$CHANGED_FILES"; then
        HAS_GO=true
    fi
    if grep -qE 'frontend/.*\.(ts|tsx|js|jsx|css)$|frontend/eslint\.config|frontend/tsconfig|frontend/vitest\.config' <<< "$CHANGED_FILES"; then
        HAS_FRONTEND=true
    fi
    if grep -qE 'pocketbase/pb_migrations/.*\.js$' <<< "$CHANGED_FILES"; then
        HAS_MIGRATIONS=true
        HAS_PB_JS=true
    fi
    if grep -qE 'pocketbase/pb_hooks/.*\.js$' <<< "$CHANGED_FILES"; then
        HAS_PB_JS=true
    fi
    if grep -qE '\.sh$' <<< "$CHANGED_FILES"; then
        HAS_SHELL=true
    fi
    # kindred#2778: mirrors CI's lodging-guard job, which scans six fixed
    # roots (pocketbase/ api/ bunking/ frontend/src/ scripts/ tests/) rather
    # than reacting to any one filetype. Keep this pattern's root list and
    # extensions in sync with scripts/dev/verify-no-hardcoded-lodging.sh's
    # SCAN_ROOTS default and its `--include` list -- the guard itself has no
    # per-file mode, so this is only a decision about whether to pay for its
    # sub-second whole-tree scan at all, not about what it scans once run.
    if grep -qE '^(pocketbase|api|bunking|frontend/src|scripts|tests)/.*\.(go|py|ts|tsx|js|sh)$' <<< "$CHANGED_FILES"; then
        HAS_LODGING=true
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
$HAS_LODGING    && echo "  - Lodging Name Guard (no hardcoded unit names)" || true
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

    # A change to the flat config changes every file's result, so the scoped
    # per-file path cannot tell you anything about it. Before this branch existed,
    # editing only frontend/eslint.config.js set HAS_FRONTEND=true (line ~137) but
    # left CHANGED_FRONTEND_ESLINT empty -- so the one edit that moves every lint
    # result in the repo was the one edit never linted locally. kindred#2669.
    if [[ "$RUN_ALL" == true ]] || grep -qE '^frontend/(eslint\.config\.js|package\.json)$' <<< "$CHANGED_FILES"; then
        ( cd frontend && npm run lint ) >"$LOGDIR/eslint.log" 2>&1 &
        PIDS[eslint]=$!
    elif [[ -n "$CHANGED_FRONTEND_ESLINT" ]]; then
        # shellcheck disable=SC2086
        ( cd frontend && ./node_modules/.bin/eslint --report-unused-disable-directives $CHANGED_FRONTEND_ESLINT ) \
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
        # Filter COMMENT lines, in every form a migration header uses:
        # `//`, a JSDoc continuation `*`, and a block opener `/*`. grep -n
        # prefixes each hit with `LINENUM:`, so anchor on that prefix; a bare
        # `^[[:space:]]*//` would never match. Keeps real `options: {` hits
        # that carry an inline comment.
        #
        # The `*` arm is not decoration. Four migrations already state the
        # anti-pattern inside a JSDoc header -- 1500000132, 1500000135,
        # 1500000146 and 1500000161 all carry the sentence "properties are
        # DIRECT, never nested inside `options: {}`, which is silently
        # ignored" -- so a `//`-only filter fails this check on any diff that
        # touches one of them, purely for quoting the rule it is enforcing.
        # 1500000161 had to word the sentence backwards to get past it. A
        # line whose first non-space character is `*` or `/` cannot be
        # executable JS carrying a field wrapper, so nothing real is hidden.
        if grep -n 'options\s*:\s*{' "$file" | grep -vE '^[0-9]+:[[:space:]]*(//|/?\*)' | grep -q .; then
            echo "    Found 'options: {}' field wrapper (v0.23+ anti-pattern): $file"
            grep -n 'options\s*:\s*{' "$file" | grep -vE '^[0-9]+:[[:space:]]*(//|/?\*)' | head -5 | while read -r line; do
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
        run_check "shellcheck" bash scripts/ci/shellcheck-all.sh
    else
        skip "shellcheck (not installed)"
    fi
fi

# ── Lodging Name Guard ──────────────────────────────────────────────────
# kindred#2778: this was previously wired into CI only (ci.yml's
# "No hardcoded lodging unit names" step) -- nothing local ran it, so a PR
# could pass pre-push-verify.sh clean and still go red in CI on a unit name
# in a test docstring. Mirrors that CI step's two gates below rather than
# just calling the guard, because the guard's own exit code alone cannot
# distinguish "clean scan against the real registry" from "clean scan
# because the registry silently wasn't readable" -- see the guard's own
# header comment on why that distinction matters.
#
# DO NOT change what this prints beyond the guard's own output lines: the
# guard's stdout/stderr never contain the registry-derived needle pattern
# itself (only the mode announcement and OK/FAIL lines), so relaying it
# verbatim is safe -- but nothing here may add a needle list of its own.
if $HAS_LODGING; then
    header "Lodging Name Guard"

    lodging_status=0
    LODGING_OUT=$(./scripts/dev/verify-no-hardcoded-lodging.sh 2>&1) || lodging_status=$?
    printf '%s\n' "$LODGING_OUT"

    # Same override the guard itself reads (scripts/dev/verify-no-hardcoded-lodging.sh),
    # so a caller pointing the guard at a different/missing path via this var
    # gets consistent PASS/SKIP reporting here too.
    LODGING_REGISTRY_PATH="${LODGING_REGISTRY_PATH:-config/lodging_registry.json}"

    if [[ "$lodging_status" -eq 2 ]]; then
        fail "lodging name guard (did not run)"
        FAILURES+=("lodging name guard (did not run)")
    elif [[ "$lodging_status" -eq 1 ]]; then
        fail "lodging name guard"
        FAILURES+=("lodging name guard")
    elif [[ "$lodging_status" -eq 0 ]]; then
        if [[ -r "$LODGING_REGISTRY_PATH" ]]; then
            # GATE: the registry is readable, so the guard must have USED it --
            # a clean run on the fallback sample while a real registry sat
            # unread would report OK having checked a fraction of the real
            # unit list. Never printed as a bare PASS if this doesn't hold.
            if printf '%s\n' "$LODGING_OUT" | grep -q 'needle source = registry'; then
                pass "lodging name guard (registry)"
            else
                fail "lodging name guard (registry readable but not used -- would silently run on the fallback sample)"
                FAILURES+=("lodging name guard (registry readable but not used)")
            fi
        else
            # No readable registry: the guard's fallback-sample scan still ran
            # and came back clean, but that only covers ~15 hand-picked terms.
            # SKIP/DEGRADED, never a bare PASS -- and not a failure either,
            # since this is expected for anyone without kindred-local checked
            # out locally.
            skip "lodging name guard (DEGRADED: fallback sample only -- $LODGING_REGISTRY_PATH not readable)"
        fi
    else
        fail "lodging name guard (unexpected exit $lodging_status)"
        FAILURES+=("lodging name guard (unexpected exit $lodging_status)")
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
