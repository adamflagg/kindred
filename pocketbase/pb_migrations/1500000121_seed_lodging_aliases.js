/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed: lodging_unit_aliases — DATA REMOVED, see 1500000120's header.
 *
 * The alias rows were every distinct cabin string observed 2022-2026 in the
 * two CampMinder custom fields the lodging ingest reads. Those strings name
 * the camp's buildings, so they moved with the rest of the registry into the
 * private `config/lodging_registry.json` (`aliases`), loaded on boot by
 * `pocketbase/lodging/registry.go`. See `docs/reference/lodging-registry.md`.
 *
 * The two 2025 renames the year windows encode, the equivalence between the
 * family-side and adult-side field vocabularies, and the warning that the
 * strings are verbatim (one contains a real double space — do not trim) are
 * recorded in that file's `_notes`, beside the data they describe.
 *
 * Emptied rather than deleted, and the down() emptied with it, for the reasons
 * in 1500000120.
 */

migrate(
  () => {
    // no-op: aliases load from config/lodging_registry.json on boot.
  },
  () => {
    // no-op: this migration no longer creates anything to revert.
  }
);
