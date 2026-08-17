/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add `attribute_conflicts` to family_camp_adults. kindred#2275.
 *
 * ONE ADDITIVE JSON COLUMN. The row grain is UNCHANGED and stays
 * (household, year, adult_number) -- see "what this is not" below.
 *
 * Shape: {column: [other values]} -- the family_camp_adults column that
 * received more than one answer, mapped to the answers the merge DISCARDED.
 * The answer that won is still in the column itself, so a reader shows the
 * column value and this map's values side by side. NULL when the slot's
 * answers agreed. Measured by replaying processAdults over data-prod.db:
 * 1,240 of 9,789 slots carry a map all years (12.7%), 92 of 834 in 2026
 * (11.0%) -- so ~87% of rows are NULL, not the ~94% an earlier draft of this
 * comment carried. That 94% was the residual of the two NORMALISED columns
 * only; this column records every person-sourced attribute that merges, which
 * is a larger population.
 *
 *   {"date_of_birth":["1981-09-02"],"relationship_to_camper":["Mother"]}
 *
 * WHY ONE ADULT SLOT RECEIVES TWO ANSWERS -- read this before proposing a
 * re-grain, because the obvious reading is wrong. It is NOT two children
 * reporting on their parents. CampMinder asks the family-camp questions on a
 * per-CAMPER form that covers all of a household's summer and family sessions,
 * so one parent fills the same family-camp section once per child, on a form
 * where that section should have been skipped after the first. A divergence is
 * therefore one person being less careful the second or third time -- a
 * data-entry artifact of form design, not two independent observers disagreeing
 * about a fact, and not evidence that the row is keyed at the wrong grain.
 *
 * WHAT THIS IS NOT: the camper re-grain. It was proposed (a 2026-08-15 ruling),
 * then DECLINED by the owner on 2026-08-17 in favour of this column, on the
 * reading above. So NOTHING here touches the grain triple -- not the write key
 * in pocketbase/sync/family_camp_derived.go, not TrackProcessedCompositeKey,
 * not idx_fc_adults_unique. The merge policy is also unchanged:
 * first-non-empty-wins still decides which answer is stored, and preferEmail
 * (kindred#1945) still breaks the email tie on well-formedness.
 *
 * ONLY THE RESIDUAL LIGHTS UP. The kindred#2405 normalisers run first, so the
 * 583 date_of_birth and 146 relationship_to_camper divergences that were only
 * ever two spellings of one answer (`09-02-1979` vs `9/2/1979`; `mother` vs
 * `Mom`) collapse before the comparison and record nothing. The free-text
 * columns have no normaliser, so sameAnswer() in family_camp_derived.go folds
 * case and whitespace at the COMPARISON only -- `Amy Johnson` vs
 * `amy johnson` is one answer. Without it 189 of 1,429 lit slots, and 32 of
 * 2026's 124, were nothing but capitalisation.
 *
 * NO DATA BACKFILL. The column is written by the family_camp_derived sync,
 * which recomputes every row it touches; until that runs the column is NULL,
 * which reads correctly as "not yet computed".
 *
 * maxSize 50000: the map holds at most the seven person-sourced columns, each
 * with at most four discarded answers (five campers is the observed maximum on
 * one household form), each bounded by its own column's width -- the widest is
 * `email` at 500 characters. Roughly 14 KB worst case, and PocketBase REJECTS
 * an over-cap write rather than truncating it, so the headroom is deliberate.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) with properties
 * DIRECT, not inside an options{} wrapper -- a plain object, or a wrapped
 * property, is silently ignored. The add is guarded so a re-run (or a
 * re-applied migration after consolidation) is a no-op.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('family_camp_adults');

    if (!col.fields.getByName('attribute_conflicts')) {
      col.fields.add(
        new Field({
          type: 'json',
          name: 'attribute_conflicts',
          required: false,
          presentable: false,
          maxSize: 50000,
        })
      );
    }

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('family_camp_adults');

    col.fields.removeByName('attribute_conflicts');

    app.save(col);
  }
);
