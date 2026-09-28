/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_postings.attribution_method: add "household_single_session" (R1a).
 *
 * campership-data/rule7-vs-sheet-2026.md §2: when every active candidate enrollment in a
 * posting's working set sits in exactly one shared session (two or more distinct persons,
 * one session), the session is certain whichever sibling it was for even though the person
 * is not. Placed before rule 7 (byFAApplication) in aid_attribution.go's infer(); see
 * aidSingleSessionAttribution.
 *
 * NEVER edit 1500000198_aid_postings.js -- it is applied. A select field's values are
 * extended in place (getByName + push), not by recreating the field, so the column and its
 * existing data survive untouched.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("aid_postings")
  const field = collection.fields.getByName("attribution_method")
  field.values.push("household_single_session")
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("aid_postings")
  const field = collection.fields.getByName("attribution_method")
  field.values = field.values.filter((v) => v !== "household_single_session")
  app.save(collection)
})
