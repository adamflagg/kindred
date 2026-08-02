#!/usr/bin/env bash
# Asserts the lodging registry loads. Applies migrations to a throwaway DB via
# scripts/dev/lib/pb-harness.sh (see that file for the serve-and-kill technique
# and why it's needed), shared with scripts/dev/verify-consolidation.sh and
# scripts/dev/verify-lodging-schema.sh.
#
# The registry is PRIVATE DATA, not source: it lives in
# config/lodging_registry.json (kindred-local) and is loaded on boot by the Go
# loader in pocketbase/lodging/registry.go. See
# docs/reference/lodging-registry.md.
#
# So this script no longer hardcodes what the registry contains — doing that
# would reproduce in a public repo exactly the strings the private file exists
# to keep out of it. Instead it asserts the DATABASE MATCHES THE FILE, field by
# field, which is both leak-free and stricter than the counts it replaces: it
# catches a unit the loader dropped, a coordinate it mangled, and an alias
# whose member set came out short.
#
# The invariants that do not name anything are still asserted directly.
#
# Exit codes: 0 = all assertions passed. 1 = one or more assertions FAILED.
# 2 = could not run the check at all (missing tool, missing binary, or no
# private registry file — a clone without kindred-local cannot run this).
# Assertions aggregate rather than short-circuit; see verify-lodging-schema.sh.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/pb-harness.sh
source "$HERE/lib/pb-harness.sh"

# Missing tool must exit 2 (cannot run), not 127 midway. Runs BEFORE the
# first git call.
pb_harness_require_tools

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"
REGISTRY="$REPO_ROOT/config/lodging_registry.json"

[[ -x "$PB_BIN" ]] || { echo "error: $PB_BIN missing; run: cd pocketbase && go build -o pocketbase ." >&2; exit 2; }

if [[ ! -f "$REGISTRY" ]]; then
  echo "error: $REGISTRY missing — the private registry lives in kindred-local." >&2
  echo "       Run scripts/setup/setup-local-config.sh, or skip this check." >&2
  exit 2
fi

# The loader resolves ./config/ relative to the working directory, so the
# harness's `pocketbase serve` has to be started from the repo root.
cd "$REPO_ROOT"

SCRATCH=$(mktemp -d)
# shellcheck disable=SC2016  # deliberate: $SCRATCH expands when the trap fires, not here
pb_harness_install_trap 'rm -rf "$SCRATCH"'

DB_DIR="$SCRATCH/data/pb_data"
LOG="$SCRATCH/boot.log"
pb_harness_boot "$PB_BIN" "$DB_DIR" "$MIG_DIR" "$LOG"

DB="$DB_DIR/data.db"
fail=0; note() { echo "FAIL: $*" >&2; fail=1; }
q() { sqlite3 "$DB" "$1"; }

# --- the registry loaded at all ---
# A structural floor, so an empty database fails here with a clear message
# rather than as a wall of per-row diffs below.
n=$(q "SELECT COUNT(*) FROM lodging_units")
if [[ "$n" -eq 0 ]]; then
  note "no lodging_units rows — the boot loader did not run (see $LOG)"
fi

# --- the database matches the private registry file, field by field ---
if ! python3 "$HERE/lib/diff_lodging_registry.py" "$REGISTRY" "$DB"; then
  note "database does not match $REGISTRY (differences above)"
fi

# --- invariants that name nothing ---

# Every unit needs a map position, or the map view and adjacency are impossible.
n=$(q "SELECT COUNT(*) FROM lodging_units WHERE map_x IS NULL OR map_x = 0")
[[ "$n" -eq 0 ]] || note "$n units have no map_x"

# Every sleeps value is a guess -> nothing the loader writes may claim to be confirmed.
n=$(q "SELECT COUNT(*) FROM lodging_units WHERE is_confirmed = 1")
[[ "$n" -eq 0 ]] || note "$n units marked is_confirmed, expected 0 (all seeds are guesses)"

# Container rows (buildings) are never bookable rooms, and every unit with a
# parent must hang off one.
n=$(q "SELECT COUNT(*) FROM lodging_units c JOIN lodging_units p ON c.parent_unit = p.id WHERE p.is_container = 0")
[[ "$n" -eq 0 ]] || note "$n units have a non-container parent"

n=$(q "SELECT COUNT(*) FROM lodging_units WHERE is_container = 1")
[[ "$n" -ge 1 ]] || note "expected at least one container unit, got $n"

n=$(q "SELECT COUNT(*) FROM lodging_units WHERE allocation_default = 'staff_default'")
[[ "$n" -ge 1 ]] || note "expected at least one staff_default unit"

# Every alias must resolve to at least one unit. A member set that came out
# empty is a silently broken alias: the ingest reads it as unresolvable and
# the placement it described never lands.
n=$(q "SELECT COUNT(*) FROM lodging_unit_aliases WHERE member_units IS NULL OR json_array_length(member_units) = 0")
[[ "$n" -eq 0 ]] || note "$n aliases have no member units"

if [[ "$fail" -ne 0 ]]; then echo "verify-lodging-seed: FAILED" >&2; exit 1; fi
echo "verify-lodging-seed: OK ($(q "SELECT COUNT(*) FROM lodging_units") units, $(q "SELECT COUNT(*) FROM lodging_unit_aliases") aliases)"
