/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add `needs_step_free` to family_camp_registrations. kindred#2438.
 *
 * ONE ADDITIVE BOOLEAN, the exact shape 1500000164 added for `needs_fridge`.
 * The row grain is unchanged and stays (household, year).
 *
 * WHY IT EXISTS. The registry has recorded step-free access since 1500000131 --
 * `has_ramp`, a THREE-VALUE select (`yes`/`no`/`partial`, blank = not assessed)
 * -- and nothing in the product ever read it. The demand side had never been
 * measured at all. Measured now on the production snapshot, 2026, at the
 * household grain and across BOTH narrative fields: of the 86 households
 * carrying any narrative, 14 describe a mobility or step-free need, against 6
 * naming cold storage. The mobility signal is more than TWICE the fridge signal
 * that justified shipping a whole need dimension in 1500000164.
 *
 * Supply, over all 118 units: 104 blank, 4 `no`, 5 `partial`, 5 `yes` -- 14
 * staff assessments. Reading that select as a BOOL reports 0 of 118 and erases
 * every one of them, which is how the column came to look empty.
 *
 * ⚠️ NOT GATED ON needs_accommodation. All 6 fridge households are
 * accommodation-gated; only 11 of the 14 mobility households are. The other 3
 * narrate the need through the bathroom question and answer no gate at all, so
 * this flag joins the has-some-data guard in processRegistrations rather than
 * sitting behind the gate -- otherwise those rows are dropped before they are
 * written.
 *
 * WHAT THIS COLUMN IS NOT: the narrative. It is a DERIVED BOOLEAN, and that is
 * the split migration 1500000126 drew -- family_camp_medical is admin-gated on
 * all five rules and holds the sentence; this table holds only flags, because
 * the sentences name individuals' conditions. `bathroom_explain` and
 * `accommodation_explain` stay where they are and nothing here duplicates them.
 *
 * ADVISORY, NEVER A REFUSAL. Keyword resolution over family-authored prose is
 * wrong sometimes, so the flag hatches a unit card and never dims one. The
 * derivation prefers RECALL over precision for the same reason 1500000164
 * states: a false positive costs a mark staff overrule at a glance, a false
 * negative returns the household to prose nobody parses.
 *
 * BACKFILL: none, deliberately, and there is nothing to recover. The narrative
 * columns this derives from carry text for 2026 ONLY (86 households; every
 * prior year is empty), so this is a 2026-forward signal with no history --
 * and a prior-year `false` is the absence of an input, never a measured "did
 * not ask". A migration could not compute it either: the input is a
 * person-partition custom value that needs the household collapse.
 * family_camp_derived must be RE-RUN for 2026 after this ships or the column
 * stays empty everywhere.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{}. A bare
 * add({...}) silently does nothing. addField() is a no-op when the column
 * already exists, because PB records an applied migration by FILENAME -- a
 * later edit to this file would never re-run on a database that has already
 * seen it, and `Set` on a missing column is a silent no-op that simply never
 * persists. `has_infant` hit exactly that.
 */

/**
 * Adds a field unless the collection already has one by that name.
 * @param {core.Collection} collection
 * @param {core.Field} field
 */
function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field);
  }
}

migrate((app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");

  addField(regs, new Field({
    type: "bool", name: "needs_step_free", required: false, presentable: false
  }));

  app.save(regs);
}, (app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");
  regs.fields.removeByName("needs_step_free");
  app.save(regs);
});
