#!/usr/bin/env bash
# The backfill in 1500000138 must set default_combined on exactly the
# containers carrying a measured `sleeps`. A FRESH database proves nothing —
# the migration runs before the registry loader (SeedRegistry is on OnServe,
# main.go:154), so it updates an empty table. Run this against a SEEDED db.
#
# No unit names here: verify-no-hardcoded-lodging.sh scans this tree.
set -euo pipefail
DB="${1:-pocketbase/pb_data/data.db}"
[ -f "$DB" ] || { echo "error: no database at $DB" >&2; exit 2; }

combined=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_units WHERE default_combined = 1;")
expected=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_units WHERE is_container = 1 AND sleeps > 0;")
leaked=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_units WHERE default_combined = 1 AND (is_container = 0 OR sleeps IS NULL OR sleeps = 0);")

echo "combined=$combined expected=$expected leaked=$leaked"
[ "$combined" = "$expected" ] || { echo "FAIL: backfill count mismatch" >&2; exit 1; }
[ "$expected" -gt 0 ] || { echo "FAIL: no measured containers — is the db seeded?" >&2; exit 1; }
[ "$leaked" = "0" ] || { echo "FAIL: default_combined set on a leaf or unmeasured row" >&2; exit 1; }
echo "OK"
