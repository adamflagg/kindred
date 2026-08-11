#!/usr/bin/env bash
# Detect a renumbered PocketBase migration before the server fails to boot.
#
# kindred#2245. PocketBase's isMigrationApplied keys on the EXACT filename
# (core/migrations_runner.go:265-272), so renaming a migration a dev database
# has already applied makes PB treat it as brand new. An ALTER silently
# re-runs; a CREATE dies with "Collection name must be unique (case
# insensitive)", which names neither the cause nor anything searchable.
#
# Renumbering is routine here, not exotic: pocketbase/CLAUDE.md tells you to
# bump above HEAD when a competing PR takes your number, and two lodging PRs
# open at once is the normal state of this repo.
#
# Usage:
#   verify-migration-history.sh [--db PATH] [--migrations-dir PATH]
#
#   --db              defaults to $PB_DATA_DIR/data.db, else
#                     <repo>/pocketbase/pb_data/data.db
#   --migrations-dir  defaults to <repo>/pocketbase/pb_migrations
#
# Exit codes:
#   0  history is consistent, or there is no database yet (a fresh clone)
#   1  a diagnosed problem, with the recovery cited
#   2  harness error (missing tool, unreadable DB, missing migrations dir)
#
# WHY THIS RUNS BEFORE THE SERVER STARTS, NOT AFTER
#
# Our OnServe hook runs PB's history-sync, whose RemoveMissingAppliedMigrations
# is `DELETE FROM _migrations WHERE file NOT IN (on-disk names)`. Every
# SUCCESSFUL boot therefore erases the stale row that proves a renumber
# happened. In the incident that motivated this script the row was already
# gone: it was eaten during the ~13h window when `main` carried no
# friend-groups migration at all. So CHECK 2 below, which reads the collection
# side, is the load-bearing one — CHECK 1 is a bonus when the evidence lives.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)

DB=""
MIGRATIONS_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB="${2:-}"; shift 2 ;;
    --migrations-dir) MIGRATIONS_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "error: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

if [[ -z "$DB" ]]; then
  if [[ -n "${PB_DATA_DIR:-}" ]]; then
    DB="$PB_DATA_DIR/data.db"
  else
    DB="$REPO_ROOT/pocketbase/pb_data/data.db"
  fi
fi
[[ -n "$MIGRATIONS_DIR" ]] || MIGRATIONS_DIR="$REPO_ROOT/pocketbase/pb_migrations"

for tool in sqlite3 python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not on PATH" >&2; exit 2; }
done

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "error: migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 2
fi

# A checkout that has never booted has no database. That is not a fault, and
# failing here would stop start_dev.sh on a first run.
if [[ ! -f "$DB" ]]; then
  exit 0
fi

query() {
  sqlite3 "file:${DB}?mode=ro" "$1" 2>/dev/null || {
    echo "error: could not read $DB" >&2
    exit 2
  }
}

APPLIED=$(query "SELECT file FROM _migrations;" | sort)
ON_DISK=$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.js' | sed 's|.*/||' | sort)

UNAPPLIED=$(comm -23 <(printf '%s\n' "$ON_DISK" | grep -v '^$' || true) \
                     <(printf '%s\n' "$APPLIED"  | grep -v '^$' || true))

# STALE: applied JS migrations with no file on disk.
#   - .go rows are PB's own compiled-in system migrations. They are never on
#     disk, and pocketbase/main.go warns that deleting them breaks the next boot.
#   - *_updated_users.js is a documented gitignored outlier (pocketbase/CLAUDE.md).
STALE=$(comm -13 <(printf '%s\n' "$ON_DISK" | grep -v '^$' || true) \
                 <(printf '%s\n' "$APPLIED"  | grep -v '^$' || true) \
        | grep '\.js$' | grep -v '_updated_users\.js$' || true)

PROBLEMS=0
report() { PROBLEMS=$((PROBLEMS + 1)); printf '%s\n' "$@"; }

# ── CHECK 1 ── renumber fingerprint, when the stale row survived ────────────
# Same slug, different number: NNN_slug.js unapplied while MMM_slug.js is
# recorded as applied.
while IFS= read -r new_file; do
  [[ -n "$new_file" ]] || continue
  new_slug="${new_file#*_}"
  new_num="${new_file%%_*}"
  while IFS= read -r old_file; do
    [[ -n "$old_file" ]] || continue
    old_slug="${old_file#*_}"
    old_num="${old_file%%_*}"
    if [[ "$new_slug" == "$old_slug" && "$new_num" != "$old_num" ]]; then
      report "" \
        "RENUMBERED MIGRATION — this database applied it under its old name." \
        "" \
        "  applied as: $old_file" \
        "  now on disk: $new_file" \
        "" \
        "PocketBase matches applied migrations on the exact filename, so it will" \
        "try to run $new_file from scratch."
    fi
  done <<<"$STALE"
done <<<"$UNAPPLIED"

# ── CHECK 2 ── collision predictor, which survives history-sync ─────────────
# For every unapplied migration, the collections it CREATEs. If one already
# exists, the boot is going to fail on it.
#
# Both quote styles are required: 1500000139_lodging_slot_merges.js writes
# name: 'lodging_slot_merges', and a double-quote-only pattern misses it
# silently. This repo has already shipped one scanner that passed because it
# only looked for a sampled set of needles; do not add a second.
extract_created_collections() {
  python3 - "$1" <<'PY'
import re, sys

src = open(sys.argv[1], encoding="utf-8").read()
# Each `new Collection({ ... })` literal: the collection's own name is the
# first `name:` appearing before the `fields:` array, since every field also
# carries a `name:` of its own.
for block in re.split(r"new\s+Collection\s*\(\s*\{", src)[1:]:
    head = re.split(r"(?<![A-Za-z_])fields\s*:", block)[0]
    m = re.search(r"""(?<![A-Za-z_])name\s*:\s*["']([A-Za-z0-9_]+)["']""", head)
    if m:
        print(m.group(1))
PY
}

EXISTING=$(query "SELECT name FROM _collections;" | sort -u)

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  while IFS= read -r coll; do
    [[ -n "$coll" ]] || continue
    if grep -Fxq "$coll" <<<"$EXISTING"; then
      report "" \
        "COLLECTION ALREADY EXISTS — an unapplied migration would re-create it." \
        "" \
        "  migration: $file" \
        "  collection: $coll" \
        "" \
        "PocketBase will fail to boot with:" \
        "  \"Collection name must be unique (case insensitive)\"" \
        "" \
        "Usually this means the migration was renumbered after this database" \
        "applied it. The old _migrations row is gone because history-sync" \
        "removes rows for files that are no longer on disk, on every" \
        "successful boot."
    fi
  done < <(extract_created_collections "$MIGRATIONS_DIR/$file")
done <<<"$UNAPPLIED"

if [[ $PROBLEMS -gt 0 ]]; then
  cat >&2 <<EOF

────────────────────────────────────────────────────────────────────────────
Recovery: docs/reference/pocketbase-migrations.md
          § "Renumbering a migration you have already applied locally"

Read it before dropping anything. Which fix is correct depends on whether the
file's CONTENT changed along with its number, and the obvious fix — drop the
collection and re-run — DESTROYS LOCAL DATA when the table is not empty.
Database: $DB
────────────────────────────────────────────────────────────────────────────
EOF
  exit 1
fi

exit 0
