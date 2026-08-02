/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed: intermediate containers + two bathroom-group fixes — DATA REMOVED,
 * see 1500000120's header.
 *
 * This migration inserted a middle level into the unit tree so that PARTIAL
 * merges (two rooms of a four-room building) are describable, and backfilled
 * the bathroom_group that one of each pair was missing — without which merging
 * that pair left the slot scored `shared`, so a family with a medical
 * private-bathroom need would not be matched to it despite the physical
 * outcome being identical to the pair that did carry a group.
 *
 * Both the container rows and the corrected groups are camp-identifying, so
 * they moved into the private `config/lodging_registry.json` — the containers
 * as ordinary `units` entries with `is_container: true`, the corrected groups
 * as the affected rooms' `bathroom_group` values. The staff-confirmed floorplan
 * that justifies the split is recorded in that file's `_notes`.
 *
 * A fresh database therefore gets these rows already shaped correctly from the
 * boot loader, in one pass, rather than created flat and then repaired.
 *
 * Emptied rather than deleted, and the down() emptied with it, for the reasons
 * in 1500000120.
 */

migrate(
  () => {
    // no-op: containers load from config/lodging_registry.json on boot.
  },
  () => {
    // no-op: this migration no longer creates anything to revert.
  }
);
