#!/usr/bin/env bash
# Spec 6.2: "every historical value must resolve to a unit or appear in an
# unresolved-alias report. Zero silent drops."
#
# Reconciles, per year, the distinct cabin strings observed in the two source
# fields against what the ingest accounted for -- either an assignment row or a
# lodging_ingest_issues row. Anything in neither set is a silent drop.
#
# Usage: verify-lodging-backfill.sh <db-path> [year ...]     (default: 2024 2025)
set -euo pipefail

DB=${1:?usage: verify-lodging-backfill.sh <db-path> [year ...]}
shift || true
YEARS=("$@")
[[ ${#YEARS[@]} -gt 0 ]] || YEARS=(2024 2025)

[[ -f "$DB" ]] || { echo "error: no database at $DB" >&2; exit 2; }

fail=0
note() { echo "FAIL: $*" >&2; fail=1; }

for year in "${YEARS[@]}"; do
  observed=$(sqlite3 "$DB" "
    SELECT COUNT(DISTINCT v.value) FROM household_custom_values v
      JOIN custom_field_defs d ON d.id = v.field_definition
      WHERE d.cm_id = 218072 AND v.year = $year AND v.value <> ''
    ")
  observed_person=$(sqlite3 "$DB" "
    SELECT COUNT(DISTINCT v.value) FROM person_custom_values v
      JOIN custom_field_defs d ON d.id = v.field_definition
      WHERE d.cm_id = 223823 AND v.year = $year AND v.value <> ''
    ")

  # Strings that produced neither an assignment nor a queue item.
  unaccounted=$(sqlite3 "$DB" "
    WITH obs AS (
      SELECT DISTINCT v.value AS raw FROM household_custom_values v
        JOIN custom_field_defs d ON d.id = v.field_definition
        WHERE d.cm_id = 218072 AND v.year = $year AND v.value <> ''
      UNION
      SELECT DISTINCT v.value FROM person_custom_values v
        JOIN custom_field_defs d ON d.id = v.field_definition
        WHERE d.cm_id = 223823 AND v.year = $year AND v.value <> ''
    ),
    queued AS (
      SELECT DISTINCT raw_value AS raw FROM lodging_ingest_issues WHERE year = $year
    ),
    resolved AS (
      SELECT DISTINCT a.alias_string AS raw
        FROM lodging_unit_aliases a
        WHERE (a.valid_from_year = 0 OR a.valid_from_year <= $year)
          AND (a.valid_to_year   = 0 OR a.valid_to_year   >= $year)
    )
    SELECT group_concat('[' || obs.raw || ']', ' ')
      FROM obs
      LEFT JOIN queued   ON queued.raw   = obs.raw
      LEFT JOIN resolved ON resolved.raw = obs.raw
      WHERE queued.raw IS NULL AND resolved.raw IS NULL
    ")

  assigned=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_assignments WHERE year = $year")
  issues=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_ingest_issues WHERE year = $year")
  hist=$(sqlite3 "$DB" "SELECT COUNT(*) FROM lodging_assignment_history WHERE year = $year")

  echo "$year: ${observed} distinct household strings, ${observed_person} person, " \
       "${assigned} assignments, ${issues} queue items, ${hist} history rows"

  if [[ -n "$unaccounted" ]]; then
    note "$year: strings accounted for by neither an assignment nor the work queue: $unaccounted"
  fi

  # Did the ingest actually run? The check above asks whether each observed
  # string COULD resolve, which an alias row alone satisfies -- so a year whose
  # strings are all mapped passes it even with the ingest never run and every
  # value dropped. That is the exact false-green this gate exists to catch, so
  # assert the output side too: observed values and nothing written at all means
  # no run, not a clean one. A real run producing no assignments still queues
  # its reasons, so only the both-zero case is unreachable when it has run.
  if [[ $((observed + observed_person)) -gt 0 && "$assigned" -eq 0 && "$issues" -eq 0 ]]; then
    note "$year: cabin values observed but no assignments AND no queue items -- the ingest has not run"
  fi

  # An assignment must never point at nothing. Optional relations orphan
  # silently in PocketBase (spec 9a.1), so check rather than assume.
  orphans=$(sqlite3 "$DB" "
    SELECT COUNT(*) FROM lodging_assignments a
      WHERE a.year = $year
        AND (a.unit = '' OR a.unit IS NULL)
        AND (a.merge = '' OR a.merge IS NULL)
    ")
  [[ "$orphans" -eq 0 ]] || note "$year: $orphans assignments point at neither a unit nor a merge"

  # The dual-grain XOR has no database backing (spec 9a.2).
  bad_grain=$(sqlite3 "$DB" "
    SELECT COUNT(*) FROM lodging_assignments
      WHERE year = $year
        AND ((household_cm_id > 0 AND person_cm_id > 0)
          OR (household_cm_id = 0 AND person_cm_id = 0))
    ")
  [[ "$bad_grain" -eq 0 ]] || note "$year: $bad_grain assignments violate the household/person XOR"
done

[[ "$fail" -eq 0 ]] || exit 1
echo "verify-lodging-backfill: OK"
