/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed: lodging_unit_aliases
 *
 * Every distinct cabin string observed 2022-2026 in:
 *   - "Family Camp Cabin"            (partition ["Family"],  household_custom_values)
 *   - "Reportable Family Camp Cabin" (partition ["Camper","Adult"], person_custom_values)
 *
 * Temporal windows record two renames that happened in 2025:
 *   "Golden Triangle - Doctor's House" (<=2024) -> "Golden Triangle - Wawona" (2025+)
 *   "Health Center - Doctor's House"   (<=2024) -> "Doctor's House"           (2025+)
 * Both buildings existed simultaneously in 2022-2024, so they are distinct units.
 *
 * "Teen Village N" (family field) and "Tawonga Village N" (adult field) are the
 * SAME six units: identical numbering including the unusual 5a/5b split, and they
 * never appear in the same field. Tawonga Village is canonical (matches the map).
 *
 * Multi-member aliases denote merges, materialised as lodging_merges rows by the
 * Plan 2 backfill. Strings are verbatim — the double space in
 * "Health Center Downstairs  - Room A" is real. Do not trim.
 *
 * Idempotent: skips any (alias_string, valid_from_year) that already exists.
 */

migrate((app) => {
  // Idempotency lookup. findFirstRecordByFilter returns sql.ErrNoRows verbatim
  // when nothing matches (core/record_query.go:454, v0.39.9), which surfaces here
  // as "sql: no rows in result set" — that is the "not seeded yet" signal.
  //
  // ANY other error (malformed filter, DB lock, closed connection) is real. A bare
  // `catch { return null }` would treat it as "not seeded", insert a duplicate, and
  // die on the unique index with validation_not_unique — hiding the actual cause.
  // So: rethrow anything that is not the not-found case.
  const findSeeded = (collection, filter, params) => {
    try {
      return app.findFirstRecordByFilter(collection, filter, params);
    } catch (e) {
      if (String(e).indexOf("no rows in result set") === -1) throw e;
      return null;
    }
  };

  // [alias_string, [unit_codes], valid_from_year, valid_to_year]
  // null year = no bound.
  const ALIASES = [
    // --- straightforward one-to-one, all years ---
    ["Ridge A", ["ridge-a"], null, null],
    ["Ridge B", ["ridge-b"], null, null],
    ["Ridge C", ["ridge-c"], null, null],
    ["Ridge D", ["ridge-d"], null, null],
    ["Ridge E", ["ridge-e"], null, null],
    ["Ridge F", ["ridge-f"], null, null],
    ["Ridge G", ["ridge-g"], null, null],
    ["Ridge H", ["ridge-h"], null, null],
    ["Ridge I", ["ridge-i"], null, null],
    ["Ridge J", ["ridge-j"], null, null],
    ["Ridge K", ["ridge-k"], null, null],
    ["Ridge L", ["ridge-l"], null, null],
    ["Ridge M", ["ridge-m"], null, null],
    ["River A", ["river-a"], null, null],
    ["River B", ["river-b"], null, null],
    ["River C", ["river-c"], null, null],
    ["River D", ["river-d"], null, null],
    ["River E", ["river-e"], null, null],
    ["River F", ["river-f"], null, null],
    ["River G", ["river-g"], null, null],
    ["River H", ["river-h"], null, null],
    ["River I", ["river-i"], null, null],
    ["River J", ["river-j"], null, null],
    ["River K", ["river-k"], null, null],
    ["River L", ["river-l"], null, null],
    ["River M", ["river-m"], null, null],
    ["Ridge Yurt 1", ["ridge-yurt-1"], null, null],
    ["Ridge Yurt 2", ["ridge-yurt-2"], null, null],
    ["Ridge Yurt 3", ["ridge-yurt-3"], null, null],
    ["Ridge Yurt 4", ["ridge-yurt-4"], null, null],
    ["Ridge Yurt 5", ["ridge-yurt-5"], null, null],
    ["Ridge Yurt 6", ["ridge-yurt-6"], null, null],
    ["Ridge Yurt 7", ["ridge-yurt-7"], null, null],
    ["Tuolumne 1", ["tuolumne-1"], null, null],
    ["Tuolumne 2", ["tuolumne-2"], null, null],
    ["Tuolumne 3", ["tuolumne-3"], null, null],
    ["Tuolumne 4", ["tuolumne-4"], null, null],
    ["Tuolumne 5", ["tuolumne-5"], null, null],
    ["Tuolumne 6", ["tuolumne-6"], null, null],
    ["Manzanita 1", ["manzanita-1"], null, null],
    ["Manzanita 2", ["manzanita-2"], null, null],
    ["Manzanita 3", ["manzanita-3"], null, null],
    ["Manzanita 4", ["manzanita-4"], null, null],
    ["Manzanita 5", ["manzanita-5"], null, null],
    ["Manzanita 7", ["manzanita-7"], null, null],
    ["New Trailer (Manzanitas)", ["manzanita-7"], null, null],
    // --- Teen Village (family field) == Tawonga Village (adult field) ---
    ["Teen Village 1", ["tawonga-village-1"], null, null],
    ["Teen Village 2", ["tawonga-village-2"], null, null],
    ["Teen Village 3", ["tawonga-village-3"], null, null],
    ["Teen Village 4", ["tawonga-village-4"], null, null],
    ["Teen Village 5a", ["tawonga-village-5a"], null, null],
    ["Teen Village 5b", ["tawonga-village-5b"], null, null],
    ["Tawonga Village 1", ["tawonga-village-1"], null, null],
    ["Tawonga Village 2", ["tawonga-village-2"], null, null],
    ["Tawonga Village 3", ["tawonga-village-3"], null, null],
    ["Tawonga Village 4", ["tawonga-village-4"], null, null],
    ["Tawonga Village 5a", ["tawonga-village-5a"], null, null],
    ["Tawonga Village 5b", ["tawonga-village-5b"], null, null],
    // --- Golden Triangle ---
    ["Golden Triangle - El Cap", ["gt-el-cap"], null, null],
    ["Golden Triangle - Half Dome", ["gt-half-dome"], null, null],
    ["Golden Triangle - Kitty 2", ["gt-kitty-2"], null, null],
    ["Golden Triangle - Kitty 3", ["gt-kitty-3"], null, null],
    ["Golden Triangle - Tenaya 1", ["gt-tenaya-1"], null, null],
    ["Golden Triangle - Tenaya 2", ["gt-tenaya-2"], null, null],
    ["Golden Triangle - Tenaya 3", ["gt-tenaya-3"], null, null],
    ["Golden Triangle - Tenaya 4", ["gt-tenaya-4"], null, null],
    ["Golden Triangle - Tioga 1", ["gt-tioga-1"], null, null],
    ["Golden Triangle - Tioga 2", ["gt-tioga-2"], null, null],
    ["Golden Triangle - Tioga 3", ["gt-tioga-3"], null, null],
    ["Golden Triangle - Tioga 4", ["gt-tioga-4"], null, null],
    ["Golden Triangle - Cloud's Rest", ["gt-clouds-rest"], null, null],
    ["Golden Triangle - Cloud's Rest (Loft)", ["gt-clouds-rest-loft"], null, null],
    ["Golden Triangle - Cloud's Rest (Side room)", ["gt-clouds-rest-side"], null, null],
    ["Golden Triangle - Cloud's Rest (Back room)", ["gt-clouds-rest-back"], null, null],
    ["Golden Triangle - Cloud's Rest (Laundry room)", ["gt-clouds-rest-laundry"], null, null],
    // --- merges (2+ members) ---
    ["Golden Triangle - Tenaya 1and2", ["gt-tenaya-1", "gt-tenaya-2"], null, null],
    ["Golden Triangle - Tioga 1and2", ["gt-tioga-1", "gt-tioga-2"], null, null],
    ["Health Center - Downstairs 1and2", ["hc-downstairs-a", "hc-downstairs-b"], null, null],
    ["Health Center Downstairs", ["hc-downstairs-a", "hc-downstairs-b"], null, null],
    // --- Wawona: the old GT Doctor's House, renamed 2025 ---
    ["Golden Triangle - Doctor's House", ["gt-wawona"], null, 2024],
    ["Golden Triangle - Wawona", ["gt-wawona-front", "gt-wawona-back"], 2025, null],
    ["Golden Triangle - Wawona Front", ["gt-wawona-front"], null, null],
    ["Golden Triangle - Wawona Back", ["gt-wawona-back"], null, null],
    ["Golden Triangle - Wawona (Front)", ["gt-wawona-front"], null, null],
    ["Golden Triangle - Wawona (Back)", ["gt-wawona-back"], null, null],
    // --- Doctor's House: the newer HC building ---
    ["Health Center - Doctor's House", ["hc-doctors-house"], null, 2024],
    ["Doctor's House", ["hc-doctors-house"], 2025, null],
    // --- Health Center rooms; A/B replaced 1/2 ---
    ["Health Center - Upstairs 1", ["hc-upstairs-1"], null, null],
    ["Health Center - Upstairs 2", ["hc-upstairs-2"], null, null],
    ["Health Center - Upstairs 3", ["hc-upstairs-3"], null, null],
    ["Health Center - Upstairs 4", ["hc-upstairs-4"], null, null],
    ["Health Center - Upstairs 5", ["hc-upstairs-5"], null, null],
    ["Health Center - Upstairs 6", ["hc-upstairs-6"], null, null],
    ["Health Center - Downstairs 1", ["hc-downstairs-a"], null, 2024],
    ["Health Center - Downstairs 2", ["hc-downstairs-b"], null, 2024],
    ["Health Center - Downstairs A", ["hc-downstairs-a"], null, null],
    ["Health Center - Downstairs B", ["hc-downstairs-b"], null, null],
    // Verbatim double space, as stored in CampMinder. Do not trim.
    ["Health Center Downstairs  - Room A", ["hc-downstairs-a"], null, null],
    ["Health Center Downstairs  - Room B", ["hc-downstairs-b"], null, null],
    ["Tawonga Village 5", ["tawonga-village-5a", "tawonga-village-5b"], null, null]
  ];

  const aliasCol = app.findCollectionByNameOrId("lodging_unit_aliases");

  for (let i = 0; i < ALIASES.length; i++) {
    const a = ALIASES[i];

    // An unbounded window is stored as 0, NOT null. PocketBase declares number
    // columns `NUMERIC DEFAULT 0 NOT NULL`, and `min: 2000` does NOT reject an
    // unset optional field — both verified empirically against this collection:
    // POSTing an alias with no valid_from_year returns `"valid_from_year": 0`.
    // Filtering on `= null` would therefore never match, so a re-run would
    // re-insert and die on the unique index with validation_not_unique.
    const wantYear = a[2] === null ? 0 : a[2];
    const existing = findSeeded(
      "lodging_unit_aliases",
      "alias_string = {:s} && valid_from_year = {:y}",
      { s: a[0], y: wantYear }
    );
    if (existing) continue;

    const memberIds = [];
    for (let j = 0; j < a[1].length; j++) {
      const u = app.findFirstRecordByFilter("lodging_units", "code = {:c}", { c: a[1][j] });
      memberIds.push(u.id);
    }

    const rec = new Record(aliasCol);
    rec.set("alias_string", a[0]);
    rec.set("member_units", memberIds);
    if (a[2] !== null) rec.set("valid_from_year", a[2]);
    if (a[3] !== null) rec.set("valid_to_year", a[3]);
    app.save(rec);
  }
}, (app) => {
  // Explicit large limit — a 0 limit is version-dependent in the JSVM binding
  // and can return nothing, silently making the down a no-op.
  const rows = app.findRecordsByFilter("lodging_unit_aliases", "id != ''", "", 100000, 0);
  for (let i = 0; i < rows.length; i++) {
    app.delete(rows[i]);
  }
});
