#!/usr/bin/env bash
# Test for migration-schema-diff.sh
# Verifies: identical schemas → exit 0; differing schemas → exit 1;
# created/updated drift does NOT cause a false positive.

set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIFF_SCRIPT="$HERE/migration-schema-diff.sh"

if [[ ! -x "$DIFF_SCRIPT" ]]; then
  echo "FAIL: $DIFF_SCRIPT not executable or missing" >&2
  exit 1
fi

SCRATCH=$(mktemp -d -t pb-diff-test-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$SCRATCH/db_a" "$SCRATCH/db_b"
sqlite3 "$SCRATCH/db_a/data.db" <<'SQL'
CREATE TABLE `_collections` (
  `id` TEXT PRIMARY KEY,
  `system` BOOLEAN,
  `type` TEXT,
  `name` TEXT UNIQUE,
  `fields` JSON,
  `indexes` JSON,
  `listRule` TEXT,
  `viewRule` TEXT,
  `createRule` TEXT,
  `updateRule` TEXT,
  `deleteRule` TEXT,
  `options` JSON,
  `created` TEXT,
  `updated` TEXT
);
INSERT INTO _collections (id, system, type, name, fields, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated)
  VALUES ('r1', 0, 'base', 'foo', '[{"name":"x","type":"text"}]', '[]', '@request.auth.id != ""', NULL, NULL, NULL, NULL, '{}', '2026-01-01', '2026-01-01');
SQL
cp "$SCRATCH/db_a/data.db" "$SCRATCH/db_b/data.db"

echo "=== TEST 1: identical DBs should exit 0 ==="
if "$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"; then
  echo "PASS: identical DBs returned 0"
else
  echo "FAIL: identical DBs returned non-zero"
  exit 1
fi

echo
echo "=== TEST 2: differing DBs should exit 1 ==="
sqlite3 "$SCRATCH/db_b/data.db" "UPDATE _collections SET fields = '[{\"name\":\"x\",\"type\":\"number\"}]' WHERE name = 'foo';"
if "$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"; then
  echo "FAIL: differing DBs returned 0"
  exit 1
else
  echo "PASS: differing DBs returned non-zero"
fi

echo
echo "=== TEST 3: created/updated drift should NOT cause false positive ==="
cp "$SCRATCH/db_a/data.db" "$SCRATCH/db_b/data.db"
sqlite3 "$SCRATCH/db_b/data.db" "UPDATE _collections SET created = '2099-12-31', updated = '2099-12-31' WHERE name = 'foo';"
if "$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"; then
  echo "PASS: created/updated drift ignored"
else
  echo "FAIL: created/updated drift caused false positive"
  exit 1
fi

echo
echo "=== TEST 4: per-DB-random secrets in options.* should NOT cause false positive ==="
# Reset to identical DBs, then drift only the auto-generated token secrets
cp "$SCRATCH/db_a/data.db" "$SCRATCH/db_b/data.db"
sqlite3 "$SCRATCH/db_a/data.db" "UPDATE _collections SET options = '{\"authToken\":{\"duration\":86400,\"secret\":\"AAAAAAAAAA\"},\"verificationToken\":{\"duration\":259200,\"secret\":\"BBBBBBBBBB\"}}' WHERE name = 'foo';"
sqlite3 "$SCRATCH/db_b/data.db" "UPDATE _collections SET options = '{\"authToken\":{\"duration\":86400,\"secret\":\"ZZZZZZZZZZ\"},\"verificationToken\":{\"duration\":259200,\"secret\":\"YYYYYYYYYY\"}}' WHERE name = 'foo';"
if "$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"; then
  echo "PASS: per-DB-random secret drift ignored"
else
  echo "FAIL: per-DB-random secret drift caused false positive"
  exit 1
fi

echo
echo "=== TEST 5: real options drift (e.g. duration change) SHOULD cause failure ==="
cp "$SCRATCH/db_a/data.db" "$SCRATCH/db_b/data.db"
sqlite3 "$SCRATCH/db_a/data.db" "UPDATE _collections SET options = '{\"authToken\":{\"duration\":86400,\"secret\":\"X\"}}' WHERE name = 'foo';"
sqlite3 "$SCRATCH/db_b/data.db" "UPDATE _collections SET options = '{\"authToken\":{\"duration\":99999,\"secret\":\"X\"}}' WHERE name = 'foo';"
if "$DIFF_SCRIPT" "$SCRATCH/db_a" "$SCRATCH/db_b"; then
  echo "FAIL: real options drift NOT detected"
  exit 1
else
  echo "PASS: real options drift detected even with secret-stripping"
fi

echo
echo "All tests passed."
