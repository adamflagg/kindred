#!/usr/bin/env bash
# Asserts the lodging seed produced the expected rows. Applies migrations to a
# throwaway DB using the same serve-and-kill technique as
# scripts/dev/verify-lodging-schema.sh (see that file for why).
#
# Exit codes: 0 = all assertions passed. 1 = one or more assertions FAILED.
# 2 = could not run the check at all. Assertions aggregate rather than
# short-circuit; see verify-lodging-schema.sh.
set -euo pipefail

# Missing tool must exit 2 (cannot run), not 127 midway. Same contract as
# scripts/dev/migration-schema-diff.sh. Runs BEFORE the first git call.
for cmd in git sqlite3 curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: required command '$cmd' not found" >&2; exit 2; }
done

REPO_ROOT=$(git rev-parse --show-toplevel)
PB_BIN="$REPO_ROOT/pocketbase/pocketbase"
MIG_DIR="$REPO_ROOT/pocketbase/pb_migrations"

[[ -x "$PB_BIN" ]] || { echo "error: $PB_BIN missing; run: cd pocketbase && go build -o pocketbase ." >&2; exit 2; }

SCRATCH=$(mktemp -d)
PB_PID=""
# EXIT INT TERM, with the kill inside the handler — a signal during the health
# poll would otherwise orphan a `pocketbase serve` on the ephemeral port.
cleanup() {
  if [[ -n "$PB_PID" ]]; then
    kill "$PB_PID" 2>/dev/null || true
    wait "$PB_PID" 2>/dev/null || true
  fi
  rm -rf "$SCRATCH"
}
trap cleanup EXIT INT TERM

DB_DIR="$SCRATCH/data/pb_data"; mkdir -p "$DB_DIR"
HOOKS_DIR=$(mktemp -d "$SCRATCH/empty-hooks-XXXX")
ln -sfn "$MIG_DIR" "$SCRATCH/data/pb_migrations"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
"$PB_BIN" serve --http="127.0.0.1:$PORT" --dir "$DB_DIR" --hooksDir "$HOOKS_DIR" --automigrate=true > "$SCRATCH/boot.log" 2>&1 &
PB_PID=$!
ok=0; for _ in $(seq 1 200); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { ok=1; break; }; sleep 0.2; done
kill "$PB_PID" 2>/dev/null || true; wait "$PB_PID" 2>/dev/null || true; PB_PID=""
[[ "$ok" -eq 1 ]] || { echo "error: serve never came up" >&2; cat "$SCRATCH/boot.log" >&2; exit 2; }

DB="$DB_DIR/data.db"
fail=0; note() { echo "FAIL: $*" >&2; fail=1; }
q() { sqlite3 "$DB" "$1"; }

[[ "$(q "SELECT COUNT(*) FROM lodging_areas")" -eq 8 ]] || note "expected 8 areas, got $(q "SELECT COUNT(*) FROM lodging_areas")"

# Per-area unit counts, from the map.
while IFS='|' read -r code want; do
  got=$(q "SELECT COUNT(*) FROM lodging_units u JOIN lodging_areas a ON u.area = a.id WHERE a.code = '$code'")
  [[ "$got" -eq "$want" ]] || note "area $code has $got units, expected $want"
done <<'EOF'
RIDGE|13
RIVER|13
YURT|7
TUOL|7
MANZ|6
TV|7
GT|25
HC|11
EOF

# Every unit needs a map position, or the map view and adjacency are impossible.
n=$(q "SELECT COUNT(*) FROM lodging_units WHERE map_x IS NULL OR map_x = 0")
[[ "$n" -eq 0 ]] || note "$n units have no map_x"

# Every sleeps value is a guess -> nothing may claim to be confirmed.
n=$(q "SELECT COUNT(*) FROM lodging_units WHERE is_confirmed = 1")
[[ "$n" -eq 0 ]] || note "$n units marked is_confirmed, expected 0 (all seeds are guesses)"

# Known-good spot checks.
[[ "$(q "SELECT bathroom FROM lodging_units WHERE code = 'hc-upstairs-5'")" == "private" ]] || note "hc-upstairs-5 should be private"
[[ "$(q "SELECT bathroom_group FROM lodging_units WHERE code = 'hc-upstairs-3'")" == "hc-upstairs-hall" ]] || note "hc-upstairs-3 should be in hc-upstairs-hall"
[[ "$(q "SELECT bathroom FROM lodging_units WHERE code = 'ridge-a'")" == "none" ]] || note "ridge-a should be none"
[[ "$(q "SELECT COUNT(*) FROM lodging_units WHERE code = 'manzanita-6'")" -eq 0 ]] || note "manzanita-6 must NOT exist (absent from the map)"
[[ "$(q "SELECT COUNT(*) FROM lodging_units WHERE code = 'hc-upstairs-2'")" -eq 1 ]] || note "hc-upstairs-2 must exist (real but unused)"
[[ "$(q "SELECT COUNT(*) FROM lodging_units WHERE code = 'tuolumne-7'")" -eq 1 ]] || note "tuolumne-7 must exist"

# Wawona's children must point at it, and it must be a distinct building from Doctor's House.
[[ "$(q "SELECT COUNT(*) FROM lodging_units c JOIN lodging_units p ON c.parent_unit = p.id WHERE p.code = 'gt-wawona'")" -eq 2 ]] || note "gt-wawona should have 2 children"
[[ "$(q "SELECT COUNT(*) FROM lodging_units WHERE code IN ('gt-wawona','hc-doctors-house')")" -eq 2 ]] || note "gt-wawona and hc-doctors-house must both exist as distinct units"

n=$(q "SELECT COUNT(*) FROM lodging_units WHERE allocation_default = 'staff_default'")
[[ "$n" -ge 1 ]] || note "expected at least one staff_default unit"

# --- aliases ---
[[ "$(q "SELECT COUNT(*) FROM lodging_unit_aliases")" -ge 90 ]] || note "expected >=90 aliases, got $(q "SELECT COUNT(*) FROM lodging_unit_aliases")"

# alias_string -> expected member unit codes (comma-joined, sorted)
alias_members() {
  # Several alias strings contain an apostrophe ("Doctor's House", "Cloud's
  # Rest") — double it for the SQL string literal, or the query is a syntax
  # error rather than a legitimate empty-result failure.
  local esc="${1//\'/\'\'}"
  q "SELECT group_concat(code) FROM (SELECT u.code FROM lodging_unit_aliases al, json_each(al.member_units) je JOIN lodging_units u ON u.id = je.value WHERE al.alias_string = '$esc' ORDER BY u.code)"
}

[[ "$(alias_members "Golden Triangle - Doctor's House")" == "gt-wawona" ]] || note "GT Doctor's House should resolve to gt-wawona, got $(alias_members "Golden Triangle - Doctor's House")"
[[ "$(alias_members "Health Center - Doctor's House")" == "hc-doctors-house" ]] || note "HC Doctor's House should resolve to hc-doctors-house"
[[ "$(alias_members "Doctor's House")" == "hc-doctors-house" ]] || note "bare Doctor's House should resolve to hc-doctors-house"
[[ "$(alias_members "Teen Village 1")" == "tawonga-village-1" ]] || note "Teen Village 1 should alias Tawonga Village 1"
[[ "$(alias_members "Tawonga Village 1")" == "tawonga-village-1" ]] || note "Tawonga Village 1 should alias itself"
# Multi-member aliases denote merges.
[[ "$(alias_members "Golden Triangle - Tenaya 1and2")" == "gt-tenaya-1,gt-tenaya-2" ]] || note "Tenaya 1and2 should have 2 members"
[[ "$(alias_members "Golden Triangle - Tioga 1and2")" == "gt-tioga-1,gt-tioga-2" ]] || note "Tioga 1and2 should have 2 members"
[[ "$(alias_members "Health Center - Downstairs 1and2")" == "hc-downstairs-a,hc-downstairs-b" ]] || note "Downstairs 1and2 should have 2 members"
# The double-space string really is in the data — do not trim it.
[[ "$(alias_members "Health Center Downstairs  - Room A")" == "hc-downstairs-a" ]] || note "double-space Room A alias missing"

# Container rows (buildings) must never be countable/bookable rooms themselves,
# and every leaf room's parent must itself be a container.
n=$(q "SELECT COUNT(*) FROM lodging_units WHERE is_container = 1")
[[ "$n" -eq 7 ]] || note "expected 7 container units, got $n"
n=$(q "SELECT COUNT(*) FROM lodging_units c JOIN lodging_units p ON c.parent_unit = p.id WHERE p.is_container = 0")
[[ "$n" -eq 0 ]] || note "$n units have a non-container parent"

if [[ "$fail" -ne 0 ]]; then echo "verify-lodging-seed: FAILED" >&2; exit 1; fi
echo "verify-lodging-seed: OK"
