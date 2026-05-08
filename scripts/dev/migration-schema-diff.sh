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
trap 'rm -f "$DUMP_A" "$DUMP_B"' EXIT

# Strip auto-generated secret fields (per-DB-random token signing keys
# nested inside collection options like authToken.secret, fileToken.secret,
# verificationToken.secret, etc.). Our migrations don't intentionally set
# any field named "secret", so this is safe and eliminates a major drift
# source between independently-applied scratch DBs.
SCRUB_FILTER='walk(if type == "object" and has("secret") then .secret = "<scrubbed>" else . end)'

sqlite3 "$DB_A" "$DUMP_SQL" | jq -S "$SCRUB_FILTER" > "$DUMP_A"
sqlite3 "$DB_B" "$DUMP_SQL" | jq -S "$SCRUB_FILTER" > "$DUMP_B"

if diff -u "$DUMP_A" "$DUMP_B"; then
  echo "schemas match"
  exit 0
else
  echo "schemas differ (above is unified diff: < a / > b)"
  exit 1
fi
