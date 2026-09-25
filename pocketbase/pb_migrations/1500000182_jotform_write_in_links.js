/// <reference path="../pb_data/types.d.ts" />
/**
 * Adult-weekend Jotform: cancelled registrations and write-in links
 * (kindred#2759, #2828 follow-up).
 *
 * jotform_submissions
 *   match_status         gains two values:
 *                          cancelled  the pull matched the filer to a
 *                                     registration of this weekend that is not
 *                                     enrolled (status_id != 2). Re-decided
 *                                     every pull, like auto.
 *                          write_in   staff linked the filing to a board
 *                                     write-in. A staff decision: the pull
 *                                     never re-decides it while the write-in
 *                                     exists.
 *   registration_status  the matched registration's status text (cancelled,
 *                        incomplete, applied, ...) for a `cancelled` row, so the
 *                        queue can say which. Blank otherwise.
 *   write_in_key         the write-in a `write_in` row is linked to.
 *
 * lodging_write_ins, lodging_write_ins_draft
 *   write_in_key         a stable identity for one logical write-in, minted the
 *                        first time a filing is linked to it. A write-in is
 *                        addressed by (unit, occupant_name) and copied between
 *                        the live board and scenarios under new record ids, so
 *                        neither the record id nor the name survives a rename
 *                        or a fork; this column is carried by every copy path
 *                        (scenario seed, push, unpush) and a rename's PATCH
 *                        leaves it alone. Blank on every row nothing links to,
 *                        which is every Family Camp row.
 *
 * The link lives on both sides: the submission names the key (so a filing
 * links to at most one write-in by construction), and each write-in row that
 * carries the key is that write-in wherever it appears. A key no row carries
 * any more (the write-in was removed everywhere) is a dropped link: the queue
 * lists the filing as needing a guest again and the next pull re-decides it.
 *
 * Additive only. Field properties are direct (never inside an options
 * wrapper, which v0.23 ignores silently); `new Field({...})` because a bare
 * object passed to fields.add does nothing.
 */

const MATCH_VALUES_BEFORE = ["auto", "staff", "unmatched", "ignored"];
const MATCH_VALUES_AFTER = ["auto", "staff", "unmatched", "ignored", "cancelled", "write_in"];

/**
 * @param {core.Collection} collection
 * @param {core.Field} field
 */
function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field);
  }
}

migrate((app) => {
  const subs = app.findCollectionByNameOrId("jotform_submissions");
  const status = subs.fields.getByName("match_status");
  status.values = MATCH_VALUES_AFTER;
  addField(subs, new Field({ type: "text", name: "registration_status", required: false, presentable: false, min: 0, max: 64, pattern: "" }));
  addField(subs, new Field({ type: "text", name: "write_in_key", required: false, presentable: false, min: 0, max: 64, pattern: "" }));
  subs.indexes.push("CREATE INDEX `idx_jotform_submissions_write_in_key` ON `jotform_submissions` (`write_in_key`)");
  app.save(subs);

  for (const name of ["lodging_write_ins", "lodging_write_ins_draft"]) {
    const collection = app.findCollectionByNameOrId(name);
    addField(collection, new Field({ type: "text", name: "write_in_key", required: false, presentable: false, min: 0, max: 64, pattern: "" }));
    app.save(collection);
  }
}, (app) => {
  const subs = app.findCollectionByNameOrId("jotform_submissions");
  subs.fields.getByName("match_status").values = MATCH_VALUES_BEFORE;
  subs.fields.removeByName("registration_status");
  subs.fields.removeByName("write_in_key");
  subs.indexes = subs.indexes.filter((idx) => idx.indexOf("idx_jotform_submissions_write_in_key") === -1);
  app.save(subs);

  for (const name of ["lodging_write_ins", "lodging_write_ins_draft"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.fields.removeByName("write_in_key");
    app.save(collection);
  }
});
