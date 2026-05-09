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

# Apply all migrations in $mig_dir to a fresh DB at $db_dir via serve-and-kill.
# Uses PB's real boot path (automigrate=true) which loads JS migrations through
# the jsvm plugin — this is the only invocation path that actually runs them.
# Plain `migrate up` silently skips JS migrations (PB v0.37 behavior, observed
# 2026-05-08 during first consolidation round).
#
# IMPORTANT: jsvm.MustRegister() reads MigrationsDir before cobra parses CLI
# flags (it runs at plugin registration time, not at serve time). Passing
# --migrationsDir is therefore a no-op for jsvm — jsvm always falls back to
# its default: filepath.Join(app.DataDir(), "../pb_migrations"). We exploit
# this by symlinking $db_dir/../pb_migrations -> $mig_dir so the default
# resolution lands on our scratch copy.
#
# Args: <db_dir> <migrations_dir> <log_path>
# Exits the harness (exit 2) on serve-failure or empty-apply (smoke check).
pb_apply() {
  local db_dir="$1" mig_dir="$2" log="$3"
  local hooks_dir
  hooks_dir=$(mktemp -d -t pb-empty-hooks-XXXX)

  # Symlink pb_migrations next to db_dir so jsvm's default path resolution
  # finds $mig_dir when it computes filepath.Join(app.DataDir(), "../pb_migrations").
  local parent_dir
  parent_dir=$(dirname "$db_dir")
  ln -sfn "$mig_dir" "$parent_dir/pb_migrations"

  local port
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')

  "$SCRATCH/pocketbase" serve --http="127.0.0.1:$port" \
              --dir "$db_dir" \
              --hooksDir "$hooks_dir" \
              --automigrate=true \
              > "$log" 2>&1 &
  local pid=$!

  local ok=0
  for _ in $(seq 1 100); do
    if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 0.1
  done

  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -rf "$hooks_dir"

  if [[ "$ok" -ne 1 ]]; then
    echo "error: pocketbase serve never came up against $mig_dir; log:" >&2
    cat "$log" >&2
    exit 2
  fi

  local coll_count js_mig_count
  coll_count=$(sqlite3 "$db_dir/data.db" "SELECT COUNT(*) FROM _collections")
  js_mig_count=$(sqlite3 "$db_dir/data.db" "SELECT COUNT(*) FROM _migrations WHERE file LIKE '%.js'")
  if [[ "$coll_count" -le 6 ]]; then
    echo "error: smoke check failed — $coll_count collections in $db_dir (expected >6, only PB defaults applied)" >&2
    exit 2
  fi
  if [[ "$js_mig_count" -lt 1 ]]; then
    echo "error: smoke check failed — 0 .js entries in _migrations ($db_dir); jsvm migration loading broke" >&2
    exit 2
  fi
}

echo ">> building pocketbase binary..."
( cd "$REPO_ROOT/pocketbase" && go build -o "$SCRATCH/pocketbase" . ) > "$SCRATCH/build.log" 2>&1 \
  || { echo "pocketbase build failed; log:"; cat "$SCRATCH/build.log"; exit 2; }

mkdir -p "$SCRATCH/db_a" "$SCRATCH/db_b"

echo ">> applying PROPOSED migrations to DB-A..."
pb_apply "$SCRATCH/db_a" "$PROPOSED_DIR" "$SCRATCH/db_a.log"

echo ">> applying CURRENT migrations to DB-B..."
pb_apply "$SCRATCH/db_b" "$CURRENT_DIR" "$SCRATCH/db_b.log"

echo ">> diffing schemas..."
"$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"
