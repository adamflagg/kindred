/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add `enrollment_status` to all three family_camp_* tables. kindred#2305.
 *
 * ONE ADDITIVE TEXT COLUMN PER TABLE. Every row grain is unchanged --
 * (household, year, adult_number) for adults, (household, year) for the other
 * two -- and so are `idx_fc_adults_unique`, `idx_fc_reg_unique` and
 * `idx_fc_med_unique`. `enrollment_status` is an ATTRIBUTE, not a key, so the
 * "grain is a triple" trap in docs/reference/family-camp-grain-collapse.md
 * does not apply and nothing about the orphan sweep moves with it.
 *
 * WHY IT EXISTS. These three tables are derived from CUSTOM VALUES -- a form a
 * family filled in -- and filling the form is not attending. Between 46 and 89
 * households a year hold family-camp rows with nobody enrolled, and until now
 * nothing downstream could tell them from a household that came. A family
 * waitlisted for a weekend, whose child went to summer camp instead, renders in
 * the household journey as an ordinary family-camp year.
 *
 * THE VOCABULARY, and the one entry that is not a CampMinder status:
 *
 *   enrolled       -- at least one member actively enrolled (status_id = 2) on
 *                     a FAMILY OR ADULT weekend that year.
 *   <status slug>  -- nobody enrolled: the single best non-enrolled status by
 *                     the ordering in frontend/src/utils/enrollmentFilter.ts
 *                     (waitlisted > applied > cancelled > ... > none).
 *   none_on_file   -- no family/adult attendee row at all for the year.
 *
 * `none_on_file` is deliberately NOT spelled `none`. CampMinder has an occupied
 * status of that name -- 409 weekend attendee rows carry it -- so reusing it
 * would collapse "we hold a row and it says none" into "we hold no row", which
 * are different facts about a household.
 *
 * ADULT WEEKENDS COUNT. An adult weekend is a family-camp weekend; it differs
 * only in enrolling the parent directly rather than their children. Measured on
 * the production snapshot for 2026, 89 of 480 household-journey rows are badged
 * "No enrollment" today and 33 of those households DID enroll -- on a session
 * typed `adult`. A derivation filtering `session_type = "family"` alone would
 * carry that error into the column.
 *
 * NOT REQUIRED, on purpose. The column populates from family_camp_derived, one
 * year per run, and the standing ruling (D12) is FORWARD-ONLY: no replay of any
 * family_camp_* table until kindred#2255 and kindred#2275 have shipped. Rows for
 * 2017-2025 therefore keep "" until that replay, and a `required: true` field
 * would make every one of them unsaveable in the meantime. The sync writes the
 * column on every row it touches -- it is part of the change comparison, so a
 * pre-existing row is UPDATED rather than skipped as unchanged -- which is what
 * keeps "" from surviving in any year the derivation has run.
 *
 * NO BACKFILL HERE, for the reason 1500000133 and 1500000164 both state: a
 * migration cannot compute this. The input is an attendees x camp_sessions join
 * the JS migration runtime has no business replicating, and a second
 * implementation of the rule is exactly how the stored column and the sync
 * would come to disagree.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{}. A bare
 * add({...}) silently does nothing. addField() is a no-op when the column
 * already exists, because PB records an applied migration by FILENAME -- a
 * later edit to this file would never re-run on a database that has already
 * seen it, and `Set` on a missing column is a silent no-op that simply never
 * persists. `has_infant` hit exactly that.
 */

/**
 * Adds a field unless the collection already has one by that name.
 * @param {core.Collection} collection
 * @param {core.Field} field
 */
function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field);
  }
}

const TABLES = [
  "family_camp_adults",
  "family_camp_registrations",
  "family_camp_medical",
];

migrate((app) => {
  for (const name of TABLES) {
    const collection = app.findCollectionByNameOrId(name);
    // 64 is generous for a status slug (the longest today is `waitlisted`, and
    // the longest possible is `none_on_file`) and leaves room for a CampMinder
    // status nobody has seen yet, which the sync stores verbatim rather than
    // discarding.
    addField(collection, new Field({
      type: "text", name: "enrollment_status", required: false, presentable: false,
      min: 0, max: 64, pattern: ""
    }));
    app.save(collection);
  }
}, (app) => {
  for (const name of TABLES) {
    const collection = app.findCollectionByNameOrId(name);
    collection.fields.removeByName("enrollment_status");
    app.save(collection);
  }
});
