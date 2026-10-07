/// <reference path="../pb_data/types.d.ts" />
/**
 * Camperships Scenarios addendum §S11.1, §S11.2 (PR 10).
 *
 *   aid_scenario_options.name     a kept option's staff-given name. The API trims it and holds it to 1-80
 *                                 characters (RenameIn, KeepIn). Optional, with no backfill: an empty name reads
 *                                 as the option's generated label, so every option kept before this loads as is.
 *   aid_scenario_trail.from_code  also takes the built-in starts "rules", "rules_draft" and "last_rules": a draft
 *                                 started from one writes no kept option. max stays 12 ("rules_draft" is 11).
 *                                 aid_scenario_options.from_code is unchanged: an option kept from a built-in
 *                                 stores "".
 *
 * No API rule changes: all five stay null on both collections (spec 14.3; FastAPI's superuser client behind
 * financial_aid.rules is the only reader and writer). No relation and no CampMinder or PocketBase id is added, so
 * the CampMinder-ID cross-table rule has nothing to apply to. v0.23 syntax: a new field is `new Field()` with
 * direct properties; an existing field is changed in place so it keeps its id (as 1500000231 does).
 */
migrate((app) => {
  const options = app.findCollectionByNameOrId("aid_scenario_options");
  options.fields.add(new Field({ type: "text", name: "name", required: false, presentable: false, min: 0, max: 80, pattern: "" }));
  app.save(options);

  const trail = app.findCollectionByNameOrId("aid_scenario_trail");
  const fromCode = trail.fields.getByName("from_code");
  if (!fromCode) {
    throw new Error('aid_scenario_trail: expected an existing "from_code" text field');
  }
  fromCode.pattern = "^([A-Z]+[0-9]*|rules|rules_draft|last_rules)$";
  app.save(trail);
}, (app) => {
  const trail = app.findCollectionByNameOrId("aid_scenario_trail");
  const fromCode = trail.fields.getByName("from_code");
  if (!fromCode) {
    throw new Error('aid_scenario_trail: expected an existing "from_code" text field');
  }
  // Restores 1500000218's pattern. A row recorded from a built-in start since the up path would fail its next save;
  // PocketBase checks a pattern when a record saves, not when the schema saves, so this cannot itself fail.
  fromCode.pattern = "^[A-Z]+[0-9]*$";
  app.save(trail);

  const options = app.findCollectionByNameOrId("aid_scenario_options");
  options.fields.removeByName("name");
  app.save(options);
});
