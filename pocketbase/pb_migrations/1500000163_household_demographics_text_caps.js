/// <reference path="../pb_data/types.d.ts" />
/**
 * Widen household_demographics' short free-text columns to 1000 characters.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * One household's answer turned a transform-phase job red in production:
 *
 *   ERROR Error saving household_demographics record ... year=2026
 *         error=away_from_date: Must be no more than 100 character(s).;
 *               away_return_date: Must be no more than 100 character(s)..
 *   ERROR Phase job failed phase=transform job=household_demographics
 *         error=1 database operations failed
 *
 * A parent answered `HH-Away From (mm/dd/yy)` with a 130-character sentence
 * saying their dates were not settled yet. That is not malformed input -- it
 * is what a free-text box on a registration form collects, and CampMinder
 * enforces no length on it. The job wrote every other record and still exited
 * `failed`, so a single sentence reddens the phase every run until someone
 * edits that family's answer in CampMinder.
 *
 * ── WHY ALL ELEVEN, NOT THE TWO THAT FAILED ─────────────────────────────────
 *
 * Every column below is the same kind of column: free text a parent types into
 * a CampMinder custom field, mirrored here. The two date fields are simply the
 * ones a long answer reached first. `form_filler` at 200, the two
 * `congregation_*` and two `jcc_*` at 300, `away_phone` at 400, and
 * `away_location` and the two `jewish_affiliation*` at 500 are the same red
 * job waiting for a longer answer, and each would have to be found from a
 * production log the same way.
 *
 * The caps were never a data-quality control -- nothing downstream reads a
 * length, and there is no validation these numbers back. 1000 is not a new
 * number either: `family_description_other` and `parent_immigrant_origin`
 * already carry it on this same table, so this is the table's own existing
 * answer for "a paragraph of free text".
 *
 * Nothing here costs storage. SQLite TEXT is variable-length; `max` is a
 * PocketBase record-save validation, not a column width, so a widened field
 * that stays short occupies exactly what it occupied before.
 *
 * ── WHAT IS DELIBERATELY LEFT ALONE ─────────────────────────────────────────
 *
 * `custody_summer` / `custody_family` (5000), `family_description` /
 * `jewish_identities` (2000), and the two fields already at 1000 keep their
 * caps: none of them is below the target, so widening them would be a change
 * with no failure behind it. This migration only raises floors.
 *
 * The job's own behaviour is NOT changed here. It still reports the whole run
 * failed when one record refuses to save, which is worth revisiting on its own
 * -- but that is a Go change with its own blast radius, and a schema migration
 * is not where it belongs.
 *
 * ── DOWN ────────────────────────────────────────────────────────────────────
 *
 * Restores each column's original cap. It does NOT touch stored rows, and must
 * not: PocketBase applies `max` when a RECORD is saved, not when the schema is,
 * so narrowing the field cannot fail on existing data. A row that used the
 * extra room keeps its text and refuses its next save -- which is exactly the
 * state this migration found, and is recoverable. Truncating those rows to make
 * the down path "clean" would destroy the answer instead, which the standing
 * no-destructive-migrations rule forbids.
 */

// name -> the cap 1500000041 gave it, which the down path restores.
const ORIGINAL_CAPS = {
  'jewish_affiliation': 500,
  'jewish_affiliation_other': 500,
  'congregation_summer': 300,
  'congregation_family': 300,
  'jcc_summer': 300,
  'jcc_family': 300,
  'away_location': 500,
  'away_phone': 400,
  'away_from_date': 100,
  'away_return_date': 100,
  'form_filler': 200,
};

const WIDENED_CAP = 1000;

/**
 * Set every named field's `max`, resolving each name through the collection.
 *
 * A missing field THROWS rather than being skipped. This migration exists
 * because a cap silently refused a write; a rename that silently skipped a
 * column would leave exactly the failure it is meant to remove, and report
 * success. `fields.getByName` is the same accessor 1500000140 uses to modify a
 * field in place.
 */
function setCaps(app, caps) {
  const col = app.findCollectionByNameOrId('household_demographics');

  for (const [name, max] of Object.entries(caps)) {
    const field = col.fields.getByName(name);
    if (!field) {
      throw new Error(`household_demographics: expected an existing "${name}" text field`);
    }
    field.max = max;
  }

  app.save(col);
}

migrate(
  (app) => {
    const widened = {};
    for (const name of Object.keys(ORIGINAL_CAPS)) {
      widened[name] = WIDENED_CAP;
    }
    setCaps(app, widened);
  },
  (app) => {
    setCaps(app, ORIGINAL_CAPS);
  }
);
