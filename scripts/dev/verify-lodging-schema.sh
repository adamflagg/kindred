#!/usr/bin/env bash
# Applies pocketbase/pb_migrations to a throwaway DB and asserts the lodging
# schema. Exits non-zero with a specific message on the first failure.
#
# Why serve-and-kill: `pocketbase migrate up` silently skips JS migrations.
# jsvm captures MigrationsDir at plugin-registration time (before flag parsing),
# so --migrationsDir is a no-op; jsvm always resolves
# filepath.Join(app.DataDir(), "../pb_migrations"). We symlink that path to the
# repo's migrations dir. Same technique as scripts/dev/verify-consolidation.sh.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"

[[ -x "$PB_BIN" ]] || { echo "error: $PB_BIN missing; run: cd pocketbase && go build -o pocketbase ." >&2; exit 2; }

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

DB_DIR="$SCRATCH/data/pb_data"
mkdir -p "$DB_DIR"
HOOKS_DIR=$(mktemp -d "$SCRATCH/empty-hooks-XXXX")
# jsvm default resolution: <dataDir>/../pb_migrations
ln -sfn "$MIG_DIR" "$SCRATCH/data/pb_migrations"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
LOG="$SCRATCH/boot.log"

"$PB_BIN" serve --http="127.0.0.1:$PORT" --dir "$DB_DIR" \
  --hooksDir "$HOOKS_DIR" --automigrate=true > "$LOG" 2>&1 &
PID=$!

ok=0
for _ in $(seq 1 200); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 0.2
done
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true

if [[ "$ok" -ne 1 ]]; then
  echo "error: pocketbase serve never came up; log:" >&2; cat "$LOG" >&2; exit 2
fi

DB="$DB_DIR/data.db"
js_migs=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _migrations WHERE file LIKE '%.js'")
if [[ "$js_migs" -lt 1 ]]; then
  echo "error: 0 .js migrations applied — jsvm loading broke" >&2; cat "$LOG" >&2; exit 2
fi

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

for c in lodging_areas lodging_units lodging_unit_aliases lodging_merges \
         lodging_availability lodging_assignments lodging_assignment_history; do
  n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM _collections WHERE name = '$c'")
  [[ "$n" -eq 1 ]] || note "collection $c missing"
done

# field_limit <collection> <field> <json-path> <expected>
field_prop() {
  sqlite3 "$DB" "SELECT json_extract(value, '\$.$3') FROM _collections, json_each(_collections.fields) WHERE _collections.name = '$1' AND json_extract(value, '\$.name') = '$2'"
}

# Guard against the options:{} trap — a silently-ignored max shows up as 5000.
for f in name code notes; do
  v=$(field_prop lodging_units "$f" max || true)
  [[ -n "$v" && "$v" != "5000" ]] || note "lodging_units.$f max is '$v' (expected an explicit non-default limit; 5000 means options:{} was ignored)"
done

bt=$(field_prop lodging_units bathroom values || true)
[[ "$bt" == '["none","private","shared"]' ]] || note "lodging_units.bathroom values are $bt (expected [\"none\",\"private\",\"shared\"])"

ad=$(field_prop lodging_units allocation_default values || true)
[[ "$ad" == '["family_pool","staff_default"]' ]] || note "lodging_units.allocation_default values are $ad"

st=$(field_prop lodging_availability state values || true)
[[ "$st" == '["reserved_staff","reserved_other","released_to_family"]' ]] || note "lodging_availability.state values are $st"

# Unbounded numbers must be null, not 0 (0 would reject positive values).
for spec in "lodging_units:sleeps" "lodging_merges:capacity_override"; do
  col=${spec%%:*}; fld=${spec##*:}
  mx=$(field_prop "$col" "$fld" max || true)
  [[ -z "$mx" || "$mx" == "null" ]] || note "$col.$fld max is '$mx' (expected null for unbounded)"
done

# Merges bind 2+ units, so member_units must be multi-select.
ms=$(field_prop lodging_merges member_units maxSelect || true)
[[ -n "$ms" && "$ms" != "1" ]] || note "lodging_merges.member_units maxSelect is '$ms' (expected >1 or null)"
ms=$(field_prop lodging_unit_aliases member_units maxSelect || true)
[[ -n "$ms" && "$ms" != "1" ]] || note "lodging_unit_aliases.member_units maxSelect is '$ms' (expected >1 or null)"

# Dual-grain uniqueness: the live-row partial indexes must gate on `> 0`, never
# on `!= ''`. PocketBase numbers are `NUMERIC DEFAULT 0 NOT NULL` and SQLite
# evaluates `0 != ''` as TRUE, so `!= ''` would capture every person-grain row
# (household_cm_id = 0), collide them, and permit only ONE adult assignment per
# session. This assertion exists because that bug was caught in review.
for idx in idx_lodging_assign_hh_live idx_lodging_assign_person_live; do
  sql=$(sqlite3 "$DB" "SELECT COALESCE(sql,'') FROM sqlite_master WHERE type='index' AND name='$idx'")
  if [[ -z "$sql" ]]; then
    note "index $idx missing"
  elif [[ "$sql" == *"!= ''"* ]]; then
    note "index $idx uses \"!= ''\" — must be \"> 0\" (0 != '' is TRUE in SQLite; see plan Task 5)"
  elif [[ "$sql" != *"> 0"* ]]; then
    note "index $idx predicate lacks \"> 0\": $sql"
  fi
done

if [[ "$fail" -ne 0 ]]; then echo "verify-lodging-schema: FAILED" >&2; exit 1; fi
echo "verify-lodging-schema: OK ($js_migs js migrations applied)"
