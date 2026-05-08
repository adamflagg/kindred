#!/usr/bin/env bash
# Diff PocketBase _collections schemas between two pb_data dirs.
# Used by the consolidate-migrations skill (and verify-consolidation.sh) to
# prove a merged migration set produces an identical schema to the current
# set. Excludes `created` and `updated` timestamps which always differ
# between independently-applied scratch DBs.
#
# Usage: migration-schema-diff.sh <pb_data_dir_a> <pb_data_dir_b>
# Exits 0 if schemas match, 1 if they differ, 2 on harness error.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <pb_data_dir_a> <pb_data_dir_b>" >&2
  exit 2
fi

# Normalize harness errors (missing tools, jq < 1.6, dump failures) to exit 2.
for cmd in sqlite3 jq diff; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: $cmd" >&2
    exit 2
  fi
done

# walk/1 was added in jq 1.6 (2019). Older jq either lacks it or silently
# emits wrong output, so fail loudly with the documented harness exit code.
if ! echo '{}' | jq -e 'walk(.)' >/dev/null 2>&1; then
  echo "error: jq lacks walk/1 (need jq >= 1.6); found: $(jq --version 2>&1)" >&2
  exit 2
fi

DB_A="$1/data.db"
DB_B="$2/data.db"

for f in "$DB_A" "$DB_B"; do
  if [[ ! -f "$f" ]]; then
    echo "error: $f not found" >&2
    exit 2
  fi
done

# Canonical schema dump: order by id, exclude created/updated, JSON-normalize
# the JSON columns so semantically-equal JSON formatted differently by SQLite
# still compares equal after jq -S sorts keys. Note: SQLite treats "x" as an
# identifier reference when it matches a column name; json_object labels must
# use single quotes to be interpreted as string literals.
DUMP_SQL="
SELECT json_object(
  'id', id,
  'system', system,
  'type', type,
  'name', name,
  'fields', json(fields),
  'indexes', json(indexes),
  'listRule', listRule,
  'viewRule', viewRule,
  'createRule', createRule,
  'updateRule', updateRule,
  'deleteRule', deleteRule,
  'options', json(options)
)
FROM _collections
ORDER BY id;
"

DUMP_A=$(mktemp -t pb-dump-a-XXXX.json)
DUMP_B=$(mktemp -t pb-dump-b-XXXX.json)
trap 'rm -f "$DUMP_A" "$DUMP_B"' EXIT INT TERM

# Strip auto-generated secret fields (per-DB-random token signing keys
# nested inside collection options like authToken.secret, fileToken.secret,
# verificationToken.secret, etc.). Our migrations don't intentionally set
# any field named "secret", so this is safe and eliminates a major drift
# source between independently-applied scratch DBs.
SCRUB_FILTER='walk(if type == "object" and has("secret") then .secret = "<scrubbed>" else . end)'

# PIPESTATUS captures the per-stage exit code for each pipeline. Any non-zero
# stage (sqlite3 dump failure, jq filter error) is a harness error → exit 2.
dump() {
  local label="$1" db="$2" out="$3"
  sqlite3 "$db" "$DUMP_SQL" | jq -S "$SCRUB_FILTER" > "$out"
  local pipe=("${PIPESTATUS[@]}")
  if [[ "${pipe[0]}" -ne 0 || "${pipe[1]}" -ne 0 ]]; then
    echo "error: failed to dump/normalize schema for $label (sqlite3=${pipe[0]} jq=${pipe[1]})" >&2
    return 2
  fi
}
dump A "$DB_A" "$DUMP_A" || exit 2
dump B "$DB_B" "$DUMP_B" || exit 2

# diff exits 0 (match), 1 (differ), or >=2 (trouble — e.g. unreadable file).
# Map only 0/1 to the documented contract; anything else → 2.
set +e
diff -u "$DUMP_A" "$DUMP_B"
diff_rc=$?
set -e
case "$diff_rc" in
  0) echo "schemas match"; exit 0 ;;
  1) echo "schemas differ (above is unified diff: < a / > b)"; exit 1 ;;
  *) echo "error: diff exited $diff_rc" >&2; exit 2 ;;
esac
