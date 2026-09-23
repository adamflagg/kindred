/// <reference path="../pb_data/types.d.ts" />
/**
 * persons.grade_name — CampMinder's CampGradeName, kindred#2779.
 *
 * `grade` is a NOT NULL number, so kindergarten and "no grade at all" both
 * read 0 — and until kindred#2779 so did Pre-K, Nursery, Toddler and Infant.
 * The sync now stores `grade` as CampGradeID - 1 for every id (Pre-K -1 down
 * to Infant -4), and this column carries the name CampMinder shows ("Pre-K",
 * "K", "1st", "12th+"). It is EMPTY exactly when CampMinder has no grade,
 * including its "Unknown".
 *
 * The number stays the value for ordering, the solver, metrics and every
 * `grade > 0` check. This is what is DISPLAYED.
 *
 * ── BACKFILL ────────────────────────────────────────────────────────────────
 *
 * Every display now reads this column, so an empty one on an existing row
 * would blank a grade that shows today. Grades 1..13 map back to exactly one
 * name — "1st" .. "12th", and 13 is "12th+" — and are filled here. Grade 0 is
 * NOT: it is K or no grade at all, which only CampMinder can tell apart, so
 * those rows stay empty until the persons sync writes them (the current
 * season daily, historical years on re-sync). Nothing below 0 exists yet.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons");
  collection.fields.add(new Field({
    type: "text",
    name: "grade_name",
    required: false,
    presentable: false,
    min: 0,
    max: 50,
    pattern: ""
  }));
  app.save(collection);

  // Inside the callback: JSVM migration callbacks do not reliably see
  // file-scope declarations.
  const GRADE_NAMES = {
    1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th",
    7: "7th", 8: "8th", 9: "9th", 10: "10th", 11: "11th", 12: "12th", 13: "12th+",
  };
  for (const [grade, name] of Object.entries(GRADE_NAMES)) {
    app.db()
      .newQuery("UPDATE persons SET grade_name = {:name} WHERE grade = {:grade} AND grade_name = ''")
      .bind({ name: name, grade: Number(grade) })
      .execute();
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");
  collection.fields.removeByName("grade_name");
  app.save(collection);
});
