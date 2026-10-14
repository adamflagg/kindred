/// <reference path="../pb_data/types.d.ts" />
/**
 * camp_sessions.session_type gains "family_adult" (kindred#3213).
 *
 * From 2027 CampMinder files an "Adult Reg: …" session beside each Family Camp
 * weekend, in the Adult Programs group. Adults beyond a family's first two, and
 * adults who come without children, register there. They are adult-only Family
 * Camp attendees (owner, 2026-10-14), so the sessions sync types them
 * family_adult and points parent_id at their weekend, rather than `adult`, which
 * put them on the Jotform tab and every adult-weekend surface.
 *
 * Additive: the select gains one value and no row changes. No earlier season
 * holds an Adult Reg session, and the next sessions sync retypes the 2027 rows.
 */
migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("camp_sessions");
    sessions.fields.getByName("session_type").values = [
      "main",
      "embedded",
      "ag",
      "family",
      "family_adult",
      "quest",
      "scit",
      "bmitzvah",
      "tli",
      "adult",
      "school",
      "hebrew",
      "teen",
      "other",
    ];
    app.save(sessions);
  },
  (app) => {
    // Rows first, raw SQL, so none is stranded under a select that no longer
    // accepts its value. `adult` is what the code before kindred#3213 assigned
    // these sessions, and rolling back rolls that code back with it.
    app
      .db()
      .newQuery(
        `UPDATE camp_sessions SET session_type = 'adult' WHERE session_type = 'family_adult'`,
      )
      .execute();

    const sessions = app.findCollectionByNameOrId("camp_sessions");
    sessions.fields.getByName("session_type").values = [
      "main",
      "embedded",
      "ag",
      "family",
      "quest",
      "scit",
      "bmitzvah",
      "tli",
      "adult",
      "school",
      "hebrew",
      "teen",
      "other",
    ];
    app.save(sessions);
  },
);
