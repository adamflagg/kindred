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

for d in "$PROPOSED_DIR" "$CURRENT_DIR"; do
  if [[ ! -d "$d" ]]; then
    echo "error: $d not a directory" >&2
    exit 2
  fi
done

if [[ ! -x "$DIFF_SCRIPT" ]]; then
  echo "error: $DIFF_SCRIPT missing or not executable" >&2
  exit 2
fi

# Build pocketbase binary once and reuse for both scratch DBs to avoid
# paying go-build cost twice. Built in scratch dir so it's auto-cleaned.
SCRATCH=$(mktemp -d -t pb-verify-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

echo ">> building pocketbase binary..."
( cd "$REPO_ROOT/pocketbase" && go build -o "$SCRATCH/pocketbase" . ) > "$SCRATCH/build.log" 2>&1 \
  || { echo "pocketbase build failed; log:"; cat "$SCRATCH/build.log"; exit 2; }

mkdir -p "$SCRATCH/db_a" "$SCRATCH/db_b"

echo ">> applying PROPOSED migrations to DB-A..."
"$SCRATCH/pocketbase" migrate up \
    --dir "$SCRATCH/db_a" \
    --migrationsDir "$PROPOSED_DIR" > "$SCRATCH/db_a.log" 2>&1 \
  || { echo "DB-A migrate failed; log:"; cat "$SCRATCH/db_a.log"; exit 2; }

echo ">> applying CURRENT migrations to DB-B..."
"$SCRATCH/pocketbase" migrate up \
    --dir "$SCRATCH/db_b" \
    --migrationsDir "$CURRENT_DIR" > "$SCRATCH/db_b.log" 2>&1 \
  || { echo "DB-B migrate failed; log:"; cat "$SCRATCH/db_b.log"; exit 2; }

echo ">> diffing schemas..."
"$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"
