/// <reference path="../pb_data/types.d.ts" />

// Adds `illegal_merge` to lodging_ingest_issues.kind.
//
// The select list -- not the Go constants -- is the constraint. Recording a
// kind the list does not carry fails at write time in production while every
// Go test passes.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('lodging_ingest_issues')
    const field = collection.fields.getByName('kind')

    // values is a plain JS array on a select field, not a json column, so it
    // does not hit the byte-slice trap that bites record.get() on json.
    if (!field.values.includes('illegal_merge')) {
      field.values = [...field.values, 'illegal_merge']
    }
    app.save(collection)
  },
  (app) => {
    // Rows carrying a kind this migration introduced would fail validation
    // against the narrowed list, so they go first. Deleting them is correct
    // rather than lossy: down-migrating means reverting to an ingest that
    // never produced them.
    const doomed = app.findRecordsByFilter(
      'lodging_ingest_issues',
      'kind = "illegal_merge"',
      '', 0, 0
    )
    for (const rec of doomed) {
      app.delete(rec)
    }

    const collection = app.findCollectionByNameOrId('lodging_ingest_issues')
    const field = collection.fields.getByName('kind')
    field.values = field.values.filter((v) => v !== 'illegal_merge')
    app.save(collection)
  }
)
