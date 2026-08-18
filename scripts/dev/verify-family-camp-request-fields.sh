#!/usr/bin/env bash
# Asserts the Phase C columns exist with their declared limits, and that the
# narrative columns live ONLY on the admin-gated family_camp_medical collection.
set -euo pipefail

DB=${1:?usage: verify-family-camp-request-fields.sh <db-path>}
[[ -f "$DB" ]] || { echo "error: no database at $DB" >&2; exit 2; }

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

has_field() {
  sqlite3 "$DB" "SELECT COUNT(*) FROM _collections, json_each(_collections.fields)
    WHERE _collections.name = '$1' AND json_extract(value, '\$.name') = '$2'"
}

# All ten columns 1500000126 adds. request_last_updated was missing from this
# list, so the one column spec 4.1's precedence logic reads was the one the gate
# could not have caught going away.
for f in share_cabin_gate wants_near wants_with request_text request_source_field \
         request_last_updated needs_private_bathroom needs_power \
         accommodation_is_mandatory has_infant; do
  [[ "$(has_field family_camp_registrations "$f")" -eq 1 ]] \
    || note "family_camp_registrations.$f missing"
done

for f in bathroom_explain accommodation_explain; do
  [[ "$(has_field family_camp_medical "$f")" -eq 1 ]] || note "family_camp_medical.$f missing"
  # Spec 5: narrative stays in the admin-gated collection, never beside the roster data.
  [[ "$(has_field family_camp_registrations "$f")" -eq 0 ]] \
    || note "narrative column $f leaked onto family_camp_registrations"
done

gate=$(sqlite3 "$DB" "SELECT json_extract(value, '\$.values') FROM _collections, json_each(_collections.fields)
  WHERE _collections.name = 'family_camp_registrations' AND json_extract(value, '\$.name') = 'share_cabin_gate'")
[[ "$gate" == '["no_share","maybe_mutual","yes_share"]' ]] || note "share_cabin_gate values are $gate"

# The misleading name must be gone and the honest one present.
[[ "$(has_field family_camp_registrations shared_cabin_modes_raw)" -eq 1 ]] \
  || note "family_camp_registrations.shared_cabin_modes_raw missing (rename did not run)"
[[ "$(has_field family_camp_registrations shared_cabin_with)" -eq 0 ]] \
  || note "family_camp_registrations.shared_cabin_with still exists; it holds NEAR/WITH modes, not names"
# share_cabin_preference keeps its name ON PURPOSE -- it is accurate. Assert it
# survives, so a later "symmetry" rename fails this gate rather than shipping.
[[ "$(has_field family_camp_registrations share_cabin_preference)" -eq 1 ]] \
  || note "share_cabin_preference was renamed; its name is accurate and must stay"

for c in family_camp_medical family_camp_registrations family_camp_adults; do
  rules=$(sqlite3 "$DB" "SELECT listRule || '|' || viewRule FROM _collections WHERE name = '$c'")
  [[ "$rules" == '@request.auth.is_admin = true|@request.auth.is_admin = true' ]] \
    || note "$c access rules are '$rules', expected admin-only on both list and view"
done

[[ "$fail" -eq 0 ]] || exit 1
echo "verify-family-camp-request-fields: OK"
