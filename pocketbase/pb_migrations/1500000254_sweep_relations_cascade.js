/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: three relations cascade instead of blanking into a unique index.
 *
 *   normalized_mappings.person   -> persons        (UNIQUE person, session, category)
 *   normalized_mappings.session  -> camp_sessions  (same index)
 *   household_custom_values.household -> households (UNIQUE year, household, field_definition)
 *
 * The failure (10-29 nightly). Two attendees of one adult weekend left CampMinder, and each had a
 * city row in normalized_mappings for that session. The persons sweep deleted the first person;
 * since `person` was cascadeDelete: false, PocketBase BLANKED that row's person and re-saved it as
 * ('', session, city). Deleting the second person blanked a second row to the same
 * ('', session, city), the unique index rejected the re-save, and the DELETE failed with
 * `category: Value must be unique; person: Value must be unique; session: Value must be unique.`
 * The run counted one error and the 2026 persons season pass went red. Later in the same pass
 * normalize_geographic removed both rows as orphans of the season, which is why no row pointed at
 * the surviving person by morning.
 *
 * It is the class 1500000158 fixed for person_custom_values.person, and that migration's comment
 * listed normalized_mappings as left alone for two reasons. Neither holds here:
 *
 *  - "Deleting the row is a product decision." normalized_mappings is a derived cache, not a
 *    record anyone made: normalize_geographic rebuilds it each run from attendees and persons and
 *    deletes every row this run did not compute -- a blanked row included. Corrections live in
 *    geo_overrides, which this does not touch. A mapping without its person (or session) is
 *    already deleted by the next normalize run; cascading only does it in the same transaction,
 *    before it can collide. A blanked row is worse than none in the meantime: geo metrics read
 *    the table by category and year, so it can be counted toward a city or school for nobody.
 *  - "The collision is the only thing that fails loudly." What it fails is a correct delete of a
 *    person CampMinder no longer returns, and it fails only when a SECOND blank lands on the same
 *    key -- so it is no guard at all, just a red run on the nights two such people share a session.
 *
 * household_custom_values.household is person_custom_values.person's household twin, so it takes
 * 1500000158's verdict for 1500000158's reason: a custom-field answer is meaningless without the
 * household it describes, and the persons run's household sweep collides on it the same way the
 * moment two deleted households in a season answered the same field.
 *
 * The other relations of this shape stay as they are, each for a stated reason, in
 * blankingUniqueRelationsReviewed (pocketbase/sync/sweep_delete_unique_blank_test.go), which fails
 * on any new one.
 *
 * ⛔ No rows are touched. Rows already blanked (production holds two normalized_mappings rows
 * with person = '', season 2023, a season no nightly normalizes any more) stay as they are; this
 * repo does not run destructive data migrations, and their cleanup is the owner's call.
 *
 * Idempotent: setting cascadeDelete to a value it already holds is a no-op. A missing field
 * throws rather than shrugging, as 1500000158 does, since changing it is this migration's purpose.
 */

const RELATIONS = [
  ['normalized_mappings', 'person'],
  ['normalized_mappings', 'session'],
  ['household_custom_values', 'household'],
];

function setCascade(app, cascade) {
  const byCollection = {};
  for (let i = 0; i < RELATIONS.length; i++) {
    const [name, field] = RELATIONS[i];
    (byCollection[name] = byCollection[name] || []).push(field);
  }
  const names = Object.keys(byCollection);
  for (let i = 0; i < names.length; i++) {
    const col = app.findCollectionByNameOrId(names[i]);
    const fields = byCollection[names[i]];
    for (let j = 0; j < fields.length; j++) {
      const rel = col.fields.getByName(fields[j]);
      if (!rel) {
        throw new Error(`${names[i]}: expected an existing "${fields[j]}" relation field`);
      }
      rel.cascadeDelete = cascade;
    }
    app.save(col);
  }
}

migrate(
  (app) => {
    setCascade(app, true);
  },
  (app) => {
    setCascade(app, false);
  }
);
