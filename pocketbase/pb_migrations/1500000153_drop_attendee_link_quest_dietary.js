/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the `attendee` relation from `quest_registrations` and
 * `camper_dietary`, and widen `quest_registrations` to `bunking.manage`.
 * Resolves kindred#2261 and kindred#2265; part of kindred#2257.
 *
 * WHAT THE COLUMN WAS. Both tables are person x year -- unique on
 * (person_id, year) already, so the relation was never part of the key. The
 * sync walked every `attendees` row for the year and kept the first one it
 * encountered per person, with no status filter and an EMPTY sort argument.
 * PocketBase omits ORDER BY entirely when sort is "" (core/record_query.go),
 * so "first" was a query-plan artifact, not a rule -- this is a genuinely
 * unordered site, unlike the family_camp_derived ones which sort by id.
 *
 * WHY IT CANNOT BE FIXED IN PLACE. kindred#2159 ruled that a reader must
 * establish enrollment by joining (person_id, year) on status_id = 2, never by
 * traversing a stored link. So the relation could not answer the only question
 * anyone would ask it, however it was chosen. Making the pick deterministic
 * would have produced a stably-wrong link, which is a subtler trap than an
 * absent one: it stops looking suspicious. Measured on the production snapshot:
 *   quest_registrations  679 rows, 125 pointed at a non-enrolled attendee,
 *                        71 of those discarded an enrolled candidate
 *   camper_dietary     9,531 rows, 2,641 non-enrolled, 530 discarded an
 *                        enrolled candidate
 *
 * cascadeDelete: true MADE IT A DATA-LOSS VECTOR, NOT JUST A BAD POINTER.
 * The relation carried cascadeDelete, and `AttendeesSync.deleteOrphans` really
 * does delete attendee rows. So when CampMinder dropped the particular attendee
 * row this table happened to have picked, PocketBase deleted the camper's whole
 * questionnaire with it -- 50+ columns of Quest answers, or a dietary and
 * allergy record. Which campers lost data depended on which of their attendee
 * rows the unordered query yielded first. That is the strongest reason to
 * remove the column rather than re-point it.
 *
 * WHY NOT A SESSION DIMENSION INSTEAD. The questionnaires are person x year AT
 * THE SOURCE: `person_custom_values` is UNIQUE(year, person, field_definition)
 * with zero duplicate key groups, so a camper's second enrollment could not
 * carry a second set of answers even in principle. Adding session grain would
 * fan one questionnaire across N rows -- inventing answers rather than
 * recovering them. Nobody has held two active Quest enrollments in any year from
 * 2021 to 2026 (max 1, every year), and a tripwire now warns if that changes:
 * `countMultiQuestEnrollments` in quest_registrations.go.
 *
 * THE ADMISSION FILTER IS PRESERVED, AND THAT IS DELIBERATE. The dropped map
 * did two jobs; only the relation is going. A person with values but no
 * attendees row for the year is still excluded, because widening these tables
 * is a different decision from un-breaking their links. It matters most for
 * dietary: 19-35 people per year (2024-2026) hold Family Medical-* values with
 * no attendees row, and whether they belong here is kindred#2306's question.
 * For Quest the filter currently admits everyone (0 such people 2024-2026).
 *
 * NO DATA MIGRATION. Both tables are rebuilt from person_custom_values on every
 * run and are sync-owned: no staff_touched column, no GUI write path.
 *
 * RULES: quest_registrations moves from admin-only to the same rule
 * original_bunk_requests already carries. Owner ruling 2026-08-13: keep the
 * data, gate it on bunking.manage. This is a WIDENING -- it opens the table to
 * the Bunking Staff role -- and it is intentional, because the GUI for these
 * normalized tables is pending and admin-only would make it unusable.
 * camper_dietary is deliberately NOT widened here: it has no GUI either, and
 * the convention is that a table's rule moves when its surface ships.
 */
migrate((app) => {
  const bunkingManage =
    '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  const targets = ["quest_registrations", "camper_dietary"]

  for (let t = 0; t < targets.length; t++) {
    const col = app.findCollectionByNameOrId(targets[t])

    // Index first: dropping the field leaves an index over a column that is
    // gone, which PocketBase will not rebuild for you.
    col.indexes = col.indexes.filter(function (sql) {
      return sql.indexOf("_attendee`") === -1
    })

    const field = col.fields.getByName("attendee")
    if (field) {
      col.fields.removeById(field.id)
    }

    app.save(col)
  }

  const quest = app.findCollectionByNameOrId("quest_registrations")
  quest.listRule = bunkingManage
  quest.viewRule = bunkingManage
  app.save(quest)
}, (app) => {
  const adminOnly = '@request.auth.is_admin = true'

  const quest = app.findCollectionByNameOrId("quest_registrations")
  quest.listRule = adminOnly
  quest.viewRule = adminOnly
  app.save(quest)

  const targets = ["quest_registrations", "camper_dietary"]
  for (let t = 0; t < targets.length; t++) {
    const name = targets[t]
    const col = app.findCollectionByNameOrId(name)

    if (!col.fields.getByName("attendee")) {
      col.fields.add(new Field({
        type: "relation",
        name: "attendee",
        collectionId: "col_attendees",
        cascadeDelete: true,
        maxSelect: 1,
        minSelect: 0,
        // required: FALSE on the way back, deliberately, and this is not a
        // slip. The column was `required: true` going out, but a rollback
        // cannot repopulate it: the values are gone and the reverted sync no
        // longer computes them. Re-adding it as required would make every
        // subsequent save fail validation on rows that legitimately hold no
        // attendee -- turning a rollback into an outage. A re-sync after the
        // rollback repopulates nothing either, because the reverted code is
        // what stopped writing it. Restoring the data needs the pre-#2261 sync
        // AND a full re-run; the schema is all this `down` can honestly give
        // back.
        required: false,
        presentable: false,
        hidden: false,
        system: false,
      }))
    }

    const idx = "CREATE INDEX `idx_" + name + "_attendee` ON `" + name + "` (`attendee`)"
    if (col.indexes.indexOf(idx) === -1) {
      col.indexes = col.indexes.concat([idx])
    }

    app.save(col)
  }
})
