/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: re-grain household_demographics to one row per (household, person,
 * year). Resolves kindred#2260; part of kindred#2257.
 *
 * WHAT WAS WRONG. The table held one row per (household, year), and the
 * summer-side columns were filled from the `HH-` custom fields that each CAMPER
 * in the household answered. `mapPersonFieldToRecord` folded them together
 * first-non-empty-wins, so a household where two campers answered the same
 * question differently kept one answer and discarded the rest: 7,781 answers
 * across ten years, 627 in 2026, in 7,593 household-year-column cells. The
 * survivor was not even chosen -- the loader paged with no ORDER BY, so it was
 * whichever row the SQLite planner's index yielded first.
 *
 * WHY THE GRAIN MOVES RATHER THAN A COLLAPSE RULE BEING PICKED. These values
 * are pipe-delimited multi-selects. Measured over all 7,593 colliding cells,
 * the newest answer contains every token its siblings carry in only 1,098
 * (14%); in the other 6,495 (86%) a newest-wins rule still loses tokens. A
 * union is not available either -- real data pairs "Prefer not to answer" with
 * a named affiliation for the same household, which cannot be merged into one
 * string that means anything. The answers are given per camper, so they are now
 * stored per camper. Nothing has to be invented.
 *
 * THE GRAIN TRIPLE. kindred#2257: the write key, the orphan key and the unique
 * index must move together. This file is the third leg only. The other two are
 * `MakeCompositeKey`/`upsertRecords` and `deleteOrphans` in
 * pocketbase/sync/household_demographics.go, changed in the same commit.
 * Shipping this index alone would be worse than shipping nothing: a
 * household-grain write key never presents two rows for one household-year, so
 * a widened index never fires and looks safe right up until the write key
 * moves under it.
 *
 * NO DATA MIGRATION, AND NONE IS NEEDED. Every row is recomputed from
 * person_custom_values on each sync run, and that source is intact -- it holds
 * the raw answers under UNIQUE(year, person, field_definition) with zero
 * duplicate key groups. The 17,646 existing rows arrive here with person_id 0,
 * which is exactly the household-level row's key, so nothing collides under the
 * new unique index. The first run after this migration rewrites them: the
 * household-level rows keep their _family columns and have their _summer
 * columns cleared, and the per-camper rows are created alongside. Rows for
 * households whose answers were all person-level are swept as orphans and
 * re-created at the right grain. Expected shape for 2026: 2,181 camper rows +
 * 29 household rows, against 1,612 today.
 *
 * person_id 0 IS LOAD-BEARING. Household-level answers come from
 * household_custom_values, which is already one row per household per field.
 * They are not copied onto every camper -- they land on a person-less row.
 * SQLite treats 0 as a value, not a NULL, so the unique index keeps exactly one
 * such row per household-year rather than silently allowing many.
 *
 * WHY person_id KEYS THE INDEX AND `person` DOES NOT. CLAUDE.md section 1: all
 * cross-table relationships use CampMinder ids, never PocketBase ids. The
 * person-keyed derived tables all follow it -- attendees, camper_dietary and
 * quest_registrations are unique on `person_id` while carrying a relation
 * beside it -- and 1500000147 re-keyed four lodging tables off their relations
 * for exactly this reason. The `person` relation is added too, because it is
 * what an expand-based read and the table exporter join through; it is a
 * handle, not the identity. Verified against the production snapshot: zero
 * persons rows carry cm_id <= 0, and grouping the source answers by person PB
 * id and by person CampMinder id both give 24,288 rows, so the two keys select
 * the same grain.
 *
 * API RULES ARE DELIBERATELY UNCHANGED, and this is a decision rather than an
 * oversight. This table holds sensitive-category data (Jewish identity and
 * affiliation, LGBTQ and interfaith family description, custody arrangements),
 * and the re-grain does raise its granularity: a row used to say "this family",
 * and now says "this camper answered this". But that exact attribution, at that
 * exact grain, already sits one table over in person_custom_values -- which is
 * this table's source and is itself `@request.auth.is_admin = true` on all five
 * rules, as are camper_dietary, family_camp_medical, financial_aid_applications
 * and household_custom_values. Tightening this one table below its own source
 * would deny an admin a fact they can read next door, which is theatre rather
 * than protection. Superuser-only writes were considered on the grounds that
 * every row is computed and a hand-edit would be silently reverted by the next
 * sync; rejected because the Go sync writes through core.App and bypasses these
 * rules either way, so the change would buy nothing and make one table diverge
 * from ten identical siblings for no stated reason. It is not PHI, so no
 * lodging.phi gate applies.
 */

const OLD_INDEX =
  "CREATE UNIQUE INDEX `idx_household_demographics_hh_year` " +
  "ON `household_demographics` (`household`, `year`)";

const NEW_INDEX =
  "CREATE UNIQUE INDEX `idx_household_demographics_hh_person_year` " +
  "ON `household_demographics` (`household`, `person_id`, `year`)";

/**
 * Drop the named indexes, then add the replacements.
 *
 * Matched on NAME rather than on the columns, so the down path -- which
 * replaces an index that no longer mentions person_id -- removes the right one.
 * Idempotent by construction: editing an already-applied migration silently
 * skips it (`_migrations` keys on filename), so a re-run must not push a second
 * index under the same name. Lifted from 1500000147.
 */
function replaceIndex(col, dropName, addSQL) {
  col.indexes = col.indexes.filter(function (sql) {
    return sql.indexOf("`" + dropName + "`") === -1;
  });
  col.indexes.push(addSQL);
}

migrate(
  (app) => {
    const personsCol = app.findCollectionByNameOrId("persons");
    const collection = app.findCollectionByNameOrId("household_demographics");

    // The camper who gave the answer. Empty on the household-level row.
    // cascadeDelete matches the `household` relation this table already
    // carries: a person leaving takes their own demographics row with them,
    // and the next sync recomputes whatever should still be there.
    collection.fields.add(
      new Field({
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1,
      })
    );

    // The durable identity, and the column the unique index keys on.
    // 0 = the household-level row. onlyInt because CampMinder ids are integers
    // and a fractional value here would key a row nothing could look up.
    collection.fields.add(
      new Field({
        type: "number",
        name: "person_id",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true,
      })
    );

    replaceIndex(collection, "idx_household_demographics_hh_year", NEW_INDEX);

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("household_demographics");

    // Narrow the index BEFORE dropping the columns it names, and be honest
    // about what going back means: the old index is unique on
    // (household, year), so it cannot be created while the per-camper rows
    // exist. Delete them first -- they are recomputed on the next sync run
    // either way, and the answers themselves live in person_custom_values, not
    // here.
    app
      .db()
      .newQuery("DELETE FROM household_demographics WHERE person_id > 0")
      .execute();

    replaceIndex(
      collection,
      "idx_household_demographics_hh_person_year",
      OLD_INDEX
    );
    collection.fields.removeByName("person");
    collection.fields.removeByName("person_id");

    app.save(collection);
  }
);
