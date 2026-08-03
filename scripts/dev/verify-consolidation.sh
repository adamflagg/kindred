#!/usr/bin/env bash
# Verify a proposed PocketBase migration set produces the same schema as the
# current set. Used by the consolidate-migrations skill before letting the
# user commit a merged CREATE migration: spins up two scratch DBs (one with
# the proposed migration directory, one with the current one), then calls
# migration-schema-diff.sh on the resulting _collections schemas.
#
# Usage: verify-consolidation.sh <proposed_migrations_dir> <current_migrations_dir>
# Exits 0 if schemas match, 1 if drift, 2 on harness error.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <proposed_migrations_dir> <current_migrations_dir>" >&2
  exit 2
fi

PROPOSED_DIR="$1"
CURRENT_DIR="$2"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
DIFF_SCRIPT="$HERE/migration-schema-diff.sh"

# shellcheck source=lib/pb-harness.sh
source "$HERE/lib/pb-harness.sh"
pb_harness_require_tools

for d in "$PROPOSED_DIR" "$CURRENT_DIR"; do
  if [[ ! -d "$d" ]]; then
    echo "error: $d not a directory" >&2
    exit 2
  fi
done

# Canonicalize to absolute paths so the symlink pb_harness_boot creates
# resolves correctly regardless of whether the caller passed relative or
# absolute paths.
PROPOSED_DIR=$(cd "$PROPOSED_DIR" && pwd)
CURRENT_DIR=$(cd "$CURRENT_DIR" && pwd)

# PB v0.37 ships 6 default collections (_authOrigins, _externalAuths, _mfas,
# _otps, _superusers, users). Smoke check uses this as a lower bound — if a
# future PB version ships more or fewer defaults, update this constant.
PB_DEFAULT_COLLECTIONS=6

if [[ ! -x "$DIFF_SCRIPT" ]]; then
  echo "error: $DIFF_SCRIPT missing or not executable" >&2
  exit 2
fi

# Build pocketbase binary once and reuse for both scratch DBs to avoid
# paying go-build cost twice. Built in scratch dir so it's auto-cleaned.
SCRATCH=$(mktemp -d -t pb-verify-XXXX)
# shellcheck disable=SC2016  # deliberate: $SCRATCH expands when the trap fires, not here
pb_harness_install_trap 'rm -rf "$SCRATCH"'

# Apply all migrations in $mig_dir to a fresh DB at $db_dir via
# pb_harness_boot, then assert more than just the PB defaults landed.
# pb_harness_boot's own smoke check only guarantees >=1 .js migration
# applied; this is a belt-and-suspenders check specific to comparing a
# "proposed" migration set against reality.
#
# Args: <db_dir> <migrations_dir> <log_path>
pb_apply() {
  local db_dir="$1" mig_dir="$2" log="$3"

  # This harness's own historical timeout (10s) rather than the shared
  # default (40s) — scoped to just this call, reverts once it returns.
  PB_HARNESS_HEALTH_ATTEMPTS=100 PB_HARNESS_HEALTH_INTERVAL=0.1 \
    pb_harness_boot "$SCRATCH/pocketbase" "$db_dir" "$mig_dir" "$log"

  local coll_count
  coll_count=$(sqlite3 "$db_dir/data.db" "SELECT COUNT(*) FROM _collections")
  if [[ "$coll_count" -le "$PB_DEFAULT_COLLECTIONS" ]]; then
    echo "error: smoke check failed — $coll_count collections in $db_dir (expected >$PB_DEFAULT_COLLECTIONS, only PB defaults applied)" >&2
    exit 2
  fi
}

echo ">> building pocketbase binary..."
pb_harness_build_binary "$REPO_ROOT/pocketbase" "$SCRATCH/pocketbase"

# Each DB lives under its own slot directory so pb_harness_boot's symlink
# target ($parent_dir/pb_migrations) is unique per call. Without this, both
# calls would target $SCRATCH/pb_migrations and the second invocation would
# clobber the first's symlink. Sequential execution masks the bug today, but
# the isolation costs nothing and makes the harness robust to future
# parallelism or PB internals changes.
mkdir -p "$SCRATCH/slot_a/db_a" "$SCRATCH/slot_b/db_b"

echo ">> applying PROPOSED migrations to DB-A..."
pb_apply "$SCRATCH/slot_a/db_a" "$PROPOSED_DIR" "$SCRATCH/db_a.log"

echo ">> applying CURRENT migrations to DB-B..."
pb_apply "$SCRATCH/slot_b/db_b" "$CURRENT_DIR" "$SCRATCH/db_b.log"

echo ">> diffing schemas..."
"$DIFF_SCRIPT" "$SCRATCH/slot_a/db_a" "$SCRATCH/slot_b/db_b"
