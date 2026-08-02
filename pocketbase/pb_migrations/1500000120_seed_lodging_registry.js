/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed: lodging_areas + lodging_units — DATA REMOVED, see below.
 *
 * This migration originally carried the entire unit registry as literals. The
 * repository is public and the registry is camp-identifying, so the data moved
 * to `config/lodging_registry.json` — private, carried in the kindred-local
 * repo — and is loaded on every boot by `pocketbase/lodging/registry.go`.
 * Format, semantics and the loader's contract: `docs/reference/lodging-registry.md`.
 * The camp-specific notes that used to head this file (naming history, rooms
 * that look missing but are not) travelled with the data, into that file's
 * `_notes` block.
 *
 * WHY A BOOT LOADER AND NOT A FILE-READING MIGRATION. `_migrations` keys on
 * FILENAME and applies once. A migration that read an absent private file in
 * CI would be recorded as applied and never re-run when the file later
 * appeared — a silently empty registry.
 *
 * WHY THIS FILE STAYS, EMPTY. `_migrations` keying on filename cuts both ways:
 * every database that has already applied this row keeps it, and PocketBase
 * will not re-run an edited file. So the rows this migration created on
 * existing databases — including production — are untouched by emptying it.
 * A FRESH database gets its registry from the boot loader instead. Deleting
 * the file would work too (the OnServe history-sync would reconcile it away),
 * but keeping it preserves the numbering record.
 *
 * The down() is empty for the same reason it has to be: it used to truncate
 * both registry tables, which is not this migration's to undo now that it
 * creates nothing.
 */

migrate(
  () => {
    // no-op: the registry loads from config/lodging_registry.json on boot.
  },
  () => {
    // no-op: this migration no longer creates anything to revert.
  }
);
