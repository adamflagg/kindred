/// <reference path="../pb_data/types.d.ts" />
/**
 * Add `shareability` to lodging_units — may more than one party sleep here.
 *
 * `docs/architecture/lodging-occupancy.md` has recorded the staff rule since
 * the surface was built, and nothing could enforce it because no column
 * distinguished the two classes. `inventory_class` (family_pool /
 * staff_default) says who a unit is RESERVED FOR, not how many parties may
 * occupy it, so a bedroom double-booked between two households was possible
 * and undetected. This is that column. See kindred#2026.
 *
 * A SELECT, NOT A BOOL, and that is load-bearing. Three states are real:
 * `shareable`, `single_party`, and the empty string — nobody has classified
 * this. Unrecorded must never read as permission to double-book, and it must
 * also never read as a decision that one family only may go here, which would
 * block legitimate work and teach staff to ignore the warning. The same doc
 * warns about exactly that: "a rule encoded early and wrongly is worse than no
 * rule".
 *
 * ── SUPERSEDED IN PART, kindred#2331 (owner ruling D17, 2026-08-14) ─────────
 *
 * THE LEAF LEG BELOW IS HISTORY, NOT THE LIVE RULE. `sleeps >= 12` on leaves
 * did not reproduce the owner's enumeration after all: no unit in the
 * inventory reaches 12, so every family-pool leaf was stamped `single_party`
 * and the board warned on correct multi-family placements. A LEAF's
 * shareability is now a CURATED per-unit fact carried in the registry file and
 * read straight through by `classifyShareability` (pocketbase/lodging/
 * registry.go); `frontend/.../shareabilityDrift.ts` no longer re-derives it.
 *
 * This header stays as written because it is the accurate record of what
 * production's existing rows were classified from when this migration ran, and
 * the file is already applied. Do not read the leaf line below as current, and
 * do not treat this file as one of the places to change when the leaf rule
 * changes. The CONTAINER and staff_default legs ARE unchanged and still live,
 * so the reasoning below about why a container is never tested against a
 * capacity number remains the canonical explanation.
 *
 * ── THE RULE, AS IT STOOD WHEN THIS MIGRATION RAN ───────────────────────────
 *
 *   family_pool  + leaf      + sleeps >= 12  ->  shareable
 *   family_pool  + leaf      + sleeps 1..11  ->  single_party
 *   family_pool  + container                 ->  shareable
 *   staff_default (either)                   ->  single_party
 *   anything else                            ->  left EMPTY, deliberately
 *
 * `sleeps >= 12` on leaves reproduces the owner's own enumeration of the
 * shared cabins exactly — no member of that set falls below 12, and the two
 * proxies tested when the issue was filed (parentless-leaf, `max_beds`) both
 * failed. `max_beds` is NEVER a seed input here: it disagrees with the unit's
 * own recorded bed inventory on roughly a third of rows, including rows where
 * it sits BELOW the bed count, so a `max_beds >= 12` seed would silently mark
 * a large cabin single-party and start rejecting legitimate placements.
 *
 * CONTAINERS ARE CLASSIFIED, AND AT THEIR OWN LEVEL — owner ruling, 2026-08-07.
 * Shareability is both leaf-level and container-level, and the board check
 * compares at whichever level the assignment was actually made rather than
 * always resolving down to leaves. Two households on one container is a
 * LEGITIMATE SHARE: they occupy different rooms beneath it, CampMinder has no
 * sub-room concept for every building, so staff assign at container level for
 * some buildings and will keep doing so. Measured over 2022-2025, that ruling
 * is what converts 36 apparent leaf-level "violations" into correct data.
 *
 * A container is NOT tested against `sleeps >= 12`, and must not be. A
 * container's `sleeps` is a DELTA over its rooms (kindred#2041), not a
 * whole-house total — 14 of the 15 containers carry none at all. Nor is the
 * whole-house total (`_effective_sleeps`) the right input: the container
 * carrying the MOST historical two-household shares totals 9 across its rooms,
 * so a >= 12 test on the effective figure would re-flag the very placements
 * this ruling settled. What makes a container shareable is having rooms, not
 * having capacity.
 *
 * THE `family_pool` CONJUNCT is how the owner's call on the one residue row
 * lands. Exactly one unit clears `sleeps >= 12` and is not in the owner's set:
 * a staff-housing building sleeping 19, with zero family-camp placements
 * 2022-2025. The ruling on it is NON-SHAREABLE, and it is inert either way —
 * no family has ever been placed there. Rather than name it (this directory is
 * scanned by verify-no-hardcoded-lodging.sh, and a unit list in a migration is
 * a failure), the rule states the reason: staff housing is not family-camp
 * inventory, so "may two FAMILIES share it" is not a question it answers, and
 * single_party is the honest answer at any capacity. This also settles the one
 * staff container, equally inert for the same reason.
 *
 * ── WHY A MIGRATION BACKFILL, AND NOT EITHER SEED PATH ──────────────────────
 *
 * NEITHER named seed path can reach a row that already exists, and in
 * production all 118 registry units already exist and are confirmed:
 *
 *   - `seedUnits` (pocketbase/lodging/registry.go) looks the unit up by code
 *     and year and `continue`s outright when it finds one. It only ever
 *     CREATES.
 *   - `scripts/dev/apply_lodging_inventory.py` withholds every field but
 *     `notes` from a row with `is_confirmed` set.
 *
 * So a seed silently classifies NOTHING in production — it would report
 * success and change no row. The loader still learns the rule, for FRESH
 * databases: migrations run before SeedRegistry (main.go), so on a new
 * worktree or a rebuilt CD seed the UPDATEs below hit an empty table and
 * `classifyShareability` in registry.go supplies the value instead. The two
 * implementations stated the same rule when this ran; since kindred#2331 they
 * agree on containers and staff housing only, and the leaf leg here is frozen
 * history. `registry_shareability_test.go` pins the current Go half.
 *
 * A FRESH DATABASE STILL WILL NOT MATCH PRODUCTION, because its INPUTS do not:
 * the registry file's `sleeps` disagrees with production on 77 of 118 units and
 * no leaf in the file reaches 12, so the loader classifies the family
 * containers and no leaves. Production's capacities came from the 2026 Master
 * Housing import and from staff edits, neither of which writes back to the
 * file. See the long note on `classifyShareability` — this is inherited
 * staleness, not a defect in either implementation of the rule.
 *
 * ── NON-DESTRUCTIVE, AND IDEMPOTENT BY CONSTRUCTION ─────────────────────────
 *
 * Both UPDATEs are gated on `shareability = ''`, so they only ever FILL. A
 * value a staffer has already set in /manage/lodging outranks this migration
 * and is never rewritten; a second run is a no-op returning zero rows. The
 * two predicates are also mutually exclusive, so neither depends on running
 * after the other.
 *
 * The backfill is a PREDICATE, never a list of codes — same reason as
 * 1500000138's. A predicate names nothing, so it cannot leak a unit name and
 * cannot go stale when the registry changes.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');

    // Idempotent: editing an already-applied migration silently skips it
    // (`_migrations` keys on filename), so every add in this codebase is
    // written to tolerate the field already being present.
    if (!col.fields.getByName('shareability')) {
      col.fields.add(
        new Field({
          type: 'select',
          name: 'shareability',
          // NOT `required`. A required select would force every existing row
          // to carry a value before this migration could set one, and would
          // make "nobody has classified this" unrepresentable — which is the
          // state the whole column is shaped around.
          required: false,
          presentable: false,
          values: ['shareable', 'single_party'],
          maxSelect: 1,
        })
      );
      app.save(col);
    }

    // A unit families may be placed into more than one party at a time: a
    // large shared-sleeping cabin, or any family building whose rooms are
    // assigned separately.
    app
      .db()
      .newQuery(
        "UPDATE lodging_units SET shareability = 'shareable' " +
          "WHERE shareability = '' " +
          "AND inventory_class = 'family_pool' " +
          'AND (is_container = true OR sleeps >= 12)'
      )
      .execute();

    // One party only. `sleeps >= 1` and not `> 0` for readability alone; both
    // exclude the stored 0, which is UNKNOWN rather than "zero capacity"
    // (PocketBase number columns are NUMERIC DEFAULT 0 NOT NULL, so an unset
    // value is indistinguishable from a real zero and the codebase reads it as
    // unmeasured everywhere else).
    //
    // An unmeasured family leaf therefore stays EMPTY: it cannot be classified
    // either way, and guessing would be wrong in both directions. A row with
    // no `inventory_class` at all stays empty for the same reason — a
    // role-dependent question cannot be answered without the role.
    app
      .db()
      .newQuery(
        "UPDATE lodging_units SET shareability = 'single_party' " +
          "WHERE shareability = '' " +
          "AND (inventory_class = 'staff_default' " +
          "     OR (inventory_class = 'family_pool' AND is_container = false " +
          '        AND sleeps >= 1 AND sleeps < 12))'
      )
      .execute();
  },
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');
    if (!col.fields.getByName('shareability')) return;
    col.fields.removeByName('shareability');
    app.save(col);
  }
);
