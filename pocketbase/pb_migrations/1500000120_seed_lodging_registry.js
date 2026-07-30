/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed: lodging_areas + lodging_units
 *
 * Coordinates are label positions from the 2026 camp map, normalised to 0-1 on
 * its 792x612 canvas. `sleeps` is seeded from observed PEAK occupancy across
 * 2024-2025 assignments and is a GUESS — every row is written with
 * is_confirmed: false so the UI can flag unverified values.
 *
 * Map notes worth preserving:
 *  - Ridge Side cabins are bare letters A-M on the map; River Side are v-prefixed
 *    vA-vM. The "v" is shorthand added when boys'/girls' side were renamed to
 *    Ridge/River (both start with R). 13 cabins per side.
 *  - Manzanita 6 does NOT exist — the map shows M1-M5 and M7.
 *  - Health Center Upstairs is 1-6; 2 is real but unused in 2024-25, so sleeps is null.
 *  - Tawonga Village is the canonical name (matches the map). "Teen Village" is
 *    an alias used by the family-camp field. TV5 subdivides into 5a/5b.
 *  - Wawona is the OLD Doctor's House (Golden Triangle), renamed in 2025, and
 *    splits Front(1)/Back(2). The bare "Doctor's House" is the NEWER building at
 *    the Health Center. They are distinct and were occupied simultaneously in
 *    2022, 2023 and 2024.
 *
 * This seed is idempotent: it skips any unit whose code already exists, so it is
 * safe on a database where an earlier partial run happened.
 */

migrate((app) => {
  const AREAS = [
    { code: "RIDGE", name: "Ridge Side", x: 0.5000, y: 0.2900, sort: 1 },
    { code: "RIVER", name: "River Side", x: 0.4900, y: 0.7000, sort: 2 },
    { code: "YURT",  name: "Ridge Yurts", x: 0.2900, y: 0.3100, sort: 3 },
    { code: "GT",    name: "Golden Triangle", x: 0.7800, y: 0.6300, sort: 4 },
    { code: "HC",    name: "Health Center", x: 0.7294, y: 0.5747, sort: 5 },
    { code: "TV",    name: "Tawonga Village", x: 0.6900, y: 0.2200, sort: 6 },
    { code: "MANZ",  name: "Manzanitas", x: 0.4700, y: 0.1900, sort: 7 },
    { code: "TUOL",  name: "Tuolumne Heights", x: 0.1000, y: 0.6400, sort: 8 }
  ];

  const areasCol = app.findCollectionByNameOrId("lodging_areas");
  const areaIds = {};
  for (let i = 0; i < AREAS.length; i++) {
    const a = AREAS[i];
    let rec;
    try {
      rec = app.findFirstRecordByFilter("lodging_areas", "code = {:c}", { c: a.code });
    } catch (_e) {
      rec = null;
    }
    if (!rec) {
      rec = new Record(areasCol);
      rec.set("code", a.code);
      rec.set("name", a.name);
      rec.set("map_x", a.x);
      rec.set("map_y", a.y);
      rec.set("sort_order", a.sort);
      app.save(rec);
    }
    areaIds[a.code] = rec.id;
  }

  // Bathhouse label positions from the map, used to seed near_bathhouse.
  const BATHHOUSES = [
    [0.4992, 0.3266], // Ridgeside
    [0.5374, 0.6811], // Central
    [0.1509, 0.6427], // Staff
    [0.6500, 0.2379]  // Tawonga Village
  ];
  const NEAR_BH = 0.09; // normalised-canvas radius; tune later against actuals

  function nearBathhouse(x, y) {
    for (let i = 0; i < BATHHOUSES.length; i++) {
      const dx = x - BATHHOUSES[i][0];
      const dy = y - BATHHOUSES[i][1];
      if (Math.sqrt(dx * dx + dy * dy) <= NEAR_BH) return true;
    }
    return false;
  }

  // [area, name, code, x, y, sleeps, bathroom, bathroom_group, parent_code, allocation]
  // sleeps = observed peak people 2024-2025; null = never observed.
  const UNITS = [
    // --- Ridge Side (bare letters on the map) ---
    ["RIDGE", "Ridge A", "ridge-a", 0.4389, 0.3311, 5, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge B", "ridge-b", 0.4151, 0.3462, 5, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge C", "ridge-c", 0.3960, 0.3177, 5, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge D", "ridge-d", 0.3823, 0.2872, 8, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge E", "ridge-e", 0.4138, 0.2591, 8, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge F", "ridge-f", 0.4395, 0.2695, 8, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge G", "ridge-g", 0.4645, 0.2773, 9, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge H", "ridge-h", 0.5199, 0.2911, 9, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge I", "ridge-i", 0.5481, 0.2856, 9, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge J", "ridge-j", 0.5692, 0.2869, 5, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge K", "ridge-k", 0.5949, 0.2880, 5, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge L", "ridge-l", 0.6218, 0.2894, 8, "none", "", "", "family_pool"],
    ["RIDGE", "Ridge M", "ridge-m", 0.6505, 0.2982, 5, "none", "", "", "family_pool"],
    // --- River Side (vA-vM on the map) ---
    ["RIVER", "River A", "river-a", 0.5924, 0.7035, 6, "none", "", "", "family_pool"],
    ["RIVER", "River B", "river-b", 0.5665, 0.7133, 5, "none", "", "", "family_pool"],
    ["RIVER", "River C", "river-c", 0.5317, 0.7078, 5, "none", "", "", "family_pool"],
    ["RIVER", "River D", "river-d", 0.5070, 0.6734, 9, "none", "", "", "family_pool"],
    ["RIVER", "River E", "river-e", 0.4819, 0.6459, 8, "none", "", "", "family_pool"],
    ["RIVER", "River F", "river-f", 0.4525, 0.6404, 6, "none", "", "", "family_pool"],
    ["RIVER", "River G", "river-g", 0.4216, 0.6455, 7, "none", "", "", "family_pool"],
    ["RIVER", "River H", "river-h", 0.4116, 0.6785, 8, "none", "", "", "family_pool"],
    ["RIVER", "River I", "river-i", 0.4357, 0.6898, 4, "none", "", "", "family_pool"],
    ["RIVER", "River J", "river-j", 0.4865, 0.7029, 8, "none", "", "", "family_pool"],
    ["RIVER", "River K", "river-k", 0.5006, 0.7382, 6, "none", "", "", "family_pool"],
    ["RIVER", "River L", "river-l", 0.5339, 0.7576, 4, "none", "", "", "family_pool"],
    ["RIVER", "River M", "river-m", 0.5702, 0.7605, 5, "none", "", "", "family_pool"],
    // --- Ridge Yurts ---
    ["YURT", "Ridge Yurt 1", "ridge-yurt-1", 0.3374, 0.2951, 4, "none", "", "", "family_pool"],
    ["YURT", "Ridge Yurt 2", "ridge-yurt-2", 0.3186, 0.3186, 4, "none", "", "", "family_pool"],
    ["YURT", "Ridge Yurt 3", "ridge-yurt-3", 0.2977, 0.3442, 4, "none", "", "", "family_pool"],
    ["YURT", "Ridge Yurt 4", "ridge-yurt-4", 0.2684, 0.3575, 4, "none", "", "", "family_pool"],
    ["YURT", "Ridge Yurt 5", "ridge-yurt-5", 0.2483, 0.2986, 3, "none", "", "", "family_pool"],
    ["YURT", "Ridge Yurt 6", "ridge-yurt-6", 0.2691, 0.2693, 4, "none", "", "", "family_pool"],
    ["YURT", "Ridge Yurt 7", "ridge-yurt-7", 0.2833, 0.2987, 4, "none", "", "", "family_pool"],
    // --- Tuolumne Heights ---
    ["TUOL", "Tuolumne 1", "tuolumne-1", 0.1046, 0.6029, 4, "none", "", "", "family_pool"],
    ["TUOL", "Tuolumne 2", "tuolumne-2", 0.1081, 0.6705, 3, "none", "", "", "family_pool"],
    ["TUOL", "Tuolumne 3", "tuolumne-3", 0.0784, 0.6724, 2, "none", "", "", "family_pool"],
    ["TUOL", "Tuolumne 4", "tuolumne-4", 0.0741, 0.6411, 4, "none", "", "", "family_pool"],
    ["TUOL", "Tuolumne 5", "tuolumne-5", 0.0801, 0.5926, 4, "none", "", "", "family_pool"],
    ["TUOL", "Tuolumne 6", "tuolumne-6", 0.1023, 0.5700, 3, "none", "", "", "family_pool"],
    ["TUOL", "Tuolumne 7", "tuolumne-7", 0.1338, 0.7324, null, "none", "", "", "family_pool"],
    // --- Manzanitas (no 6 — absent from the map) ---
    ["MANZ", "Manzanita 1", "manzanita-1", 0.4632, 0.2234, 4, "none", "", "", "family_pool"],
    ["MANZ", "Manzanita 2", "manzanita-2", 0.4694, 0.1974, 5, "none", "", "", "family_pool"],
    ["MANZ", "Manzanita 3", "manzanita-3", 0.4339, 0.1806, 5, "none", "", "", "family_pool"],
    ["MANZ", "Manzanita 4", "manzanita-4", 0.4562, 0.1543, 4, "none", "", "", "family_pool"],
    ["MANZ", "Manzanita 5", "manzanita-5", 0.4808, 0.1717, 4, "none", "", "", "family_pool"],
    ["MANZ", "Manzanita 7", "manzanita-7", 0.5389, 0.1765, 4, "none", "", "", "family_pool"],
    // --- Tawonga Village (TV5 subdivides into 5a/5b) ---
    ["TV", "Tawonga Village 1", "tawonga-village-1", 0.6835, 0.2575, 8, "none", "", "", "family_pool"],
    ["TV", "Tawonga Village 2", "tawonga-village-2", 0.7252, 0.2458, 9, "none", "", "", "family_pool"],
    ["TV", "Tawonga Village 3", "tawonga-village-3", 0.7012, 0.2251, 7, "none", "", "", "family_pool"],
    ["TV", "Tawonga Village 4", "tawonga-village-4", 0.6948, 0.1916, 8, "none", "", "", "family_pool"],
    ["TV", "Tawonga Village 5", "tawonga-village-5", 0.6510, 0.1782, null, "none", "", "", "family_pool"],
    ["TV", "Tawonga Village 5a", "tawonga-village-5a", 0.6480, 0.1760, 4, "none", "tv-5", "tawonga-village-5", "family_pool"],
    ["TV", "Tawonga Village 5b", "tawonga-village-5b", 0.6540, 0.1805, 4, "none", "tv-5", "tawonga-village-5", "family_pool"],
    // --- Golden Triangle ---
    ["GT", "El Cap", "gt-el-cap", 0.8735, 0.5879, 6, "none", "", "", "family_pool"],
    ["GT", "Half Dome", "gt-half-dome", 0.8790, 0.5940, 7, "none", "", "", "family_pool"],
    ["GT", "Kitty", "gt-kitty", 0.6381, 0.6327, null, "none", "", "", "family_pool"],
    ["GT", "Kitty 2", "gt-kitty-2", 0.6350, 0.6300, 4, "none", "", "gt-kitty", "family_pool"],
    ["GT", "Kitty 3", "gt-kitty-3", 0.6412, 0.6355, 4, "none", "", "gt-kitty", "family_pool"],
    ["GT", "Tenaya", "gt-tenaya", 0.8813, 0.6274, null, "none", "", "", "family_pool"],
    ["GT", "Tenaya 1", "gt-tenaya-1", 0.8760, 0.6230, 5, "shared", "gt-tenaya-12", "gt-tenaya", "family_pool"],
    ["GT", "Tenaya 2", "gt-tenaya-2", 0.8800, 0.6260, 5, "shared", "gt-tenaya-12", "gt-tenaya", "family_pool"],
    ["GT", "Tenaya 3", "gt-tenaya-3", 0.8840, 0.6295, 5, "shared", "", "gt-tenaya", "family_pool"],
    ["GT", "Tenaya 4", "gt-tenaya-4", 0.8880, 0.6330, 4, "shared", "", "gt-tenaya", "family_pool"],
    ["GT", "Tioga", "gt-tioga", 0.8206, 0.7127, null, "none", "", "", "family_pool"],
    ["GT", "Tioga 1", "gt-tioga-1", 0.8150, 0.7080, 5, "shared", "gt-tioga-12", "gt-tioga", "family_pool"],
    ["GT", "Tioga 2", "gt-tioga-2", 0.8190, 0.7110, 4, "shared", "gt-tioga-12", "gt-tioga", "family_pool"],
    ["GT", "Tioga 3", "gt-tioga-3", 0.8230, 0.7145, 4, "shared", "", "gt-tioga", "family_pool"],
    ["GT", "Tioga 4", "gt-tioga-4", 0.8270, 0.7180, 5, "shared", "", "gt-tioga", "family_pool"],
    ["GT", "Clouds Rest", "gt-clouds-rest", 0.7087, 0.6620, 7, "none", "", "", "family_pool"],
    ["GT", "Clouds Rest Loft", "gt-clouds-rest-loft", 0.7060, 0.6590, 2, "shared", "gt-clouds-rest", "gt-clouds-rest", "family_pool"],
    ["GT", "Clouds Rest Side Room", "gt-clouds-rest-side", 0.7100, 0.6640, 2, "shared", "gt-clouds-rest", "gt-clouds-rest", "family_pool"],
    ["GT", "Clouds Rest Back Room", "gt-clouds-rest-back", 0.7120, 0.6660, 1, "shared", "gt-clouds-rest", "gt-clouds-rest", "family_pool"],
    ["GT", "Clouds Rest Laundry Room", "gt-clouds-rest-laundry", 0.7140, 0.6680, 1, "shared", "gt-clouds-rest", "gt-clouds-rest", "family_pool"],
    // Wawona = the OLD Doctor's House, renamed 2025. Front(1)/Back(2).
    ["GT", "Wawona", "gt-wawona", 0.7591, 0.6007, 7, "none", "", "", "family_pool"],
    ["GT", "Wawona Front", "gt-wawona-front", 0.7560, 0.5980, 3, "shared", "gt-wawona", "gt-wawona", "family_pool"],
    ["GT", "Wawona Back", "gt-wawona-back", 0.7620, 0.6035, 3, "shared", "gt-wawona", "gt-wawona", "family_pool"],
    ["GT", "Lofty", "gt-lofty", 0.6724, 0.6322, null, "none", "", "", "staff_default"],
    ["GT", "Le Shack", "gt-le-shack", 0.8554, 0.6791, null, "none", "", "", "staff_default"],
    // --- Health Center ---
    ["HC", "Health Center Upstairs 1", "hc-upstairs-1", 0.7270, 0.5700, 4, "shared", "hc-upstairs-hall", "", "family_pool"],
    ["HC", "Health Center Upstairs 2", "hc-upstairs-2", 0.7280, 0.5715, null, "shared", "hc-upstairs-hall", "", "family_pool"],
    ["HC", "Health Center Upstairs 3", "hc-upstairs-3", 0.7290, 0.5730, 8, "shared", "hc-upstairs-hall", "", "family_pool"],
    ["HC", "Health Center Upstairs 4", "hc-upstairs-4", 0.7300, 0.5745, 4, "shared", "hc-upstairs-hall", "", "family_pool"],
    ["HC", "Health Center Upstairs 5", "hc-upstairs-5", 0.7310, 0.5760, 4, "private", "", "", "family_pool"],
    ["HC", "Health Center Upstairs 6", "hc-upstairs-6", 0.7320, 0.5775, 6, "shared", "hc-upstairs-hall", "", "family_pool"],
    ["HC", "Health Center Downstairs", "hc-downstairs", 0.7294, 0.5820, 5, "none", "", "", "family_pool"],
    ["HC", "Health Center Downstairs A", "hc-downstairs-a", 0.7280, 0.5810, 2, "shared", "hc-downstairs", "hc-downstairs", "family_pool"],
    ["HC", "Health Center Downstairs B", "hc-downstairs-b", 0.7310, 0.5835, 2, "shared", "hc-downstairs", "hc-downstairs", "family_pool"],
    // The NEWER Doctor's House. Reaches 2 households in one weekend, so it has
    // >=2 rooms — room list unknown, see spec open item 4.
    ["HC", "Doctor's House", "hc-doctors-house", 0.7350, 0.5700, 6, "private", "", "", "family_pool"],
    ["HC", "Bayit", "hc-bayit", 0.7072, 0.5500, null, "none", "", "", "staff_default"]
  ];

  const unitsCol = app.findCollectionByNameOrId("lodging_units");
  const unitIds = {};

  // Pass 1: create every unit without parent_unit (parents may appear later).
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i];
    let rec;
    try {
      rec = app.findFirstRecordByFilter("lodging_units", "code = {:c}", { c: u[2] });
    } catch (_e) {
      rec = null;
    }
    if (!rec) {
      rec = new Record(unitsCol);
      rec.set("area", areaIds[u[0]]);
      rec.set("name", u[1]);
      rec.set("code", u[2]);
      rec.set("map_x", u[3]);
      rec.set("map_y", u[4]);
      if (u[5] !== null) rec.set("sleeps", u[5]);
      rec.set("bathroom", u[6]);
      rec.set("bathroom_group", u[7]);
      rec.set("near_bathhouse", nearBathhouse(u[3], u[4]));
      rec.set("allocation_default", u[9]);
      rec.set("is_confirmed", false);
      rec.set("is_active", true);
      app.save(rec);
    }
    unitIds[u[2]] = rec.id;
  }

  // Pass 2: wire parent_unit now that every code has an id.
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i];
    if (!u[8]) continue;
    const rec = app.findFirstRecordByFilter("lodging_units", "code = {:c}", { c: u[2] });
    if (!rec.get("parent_unit")) {
      rec.set("parent_unit", unitIds[u[8]]);
      app.save(rec);
    }
  }
}, (app) => {
  // Truncates both registry tables. That is correct for a revert of THIS
  // migration, because it is the only thing that populates them — but note it
  // also removes any rows staff added by hand afterwards. Use an explicit large
  // limit: a 0 limit is version-dependent in the JSVM binding and can return
  // nothing, silently making the down a no-op.
  //
  // Delete units before areas: units hold a required relation to areas.
  const units = app.findRecordsByFilter("lodging_units", "id != ''", "", 100000, 0);
  for (let i = 0; i < units.length; i++) {
    app.delete(units[i]);
  }
  const areas = app.findRecordsByFilter("lodging_areas", "id != ''", "", 100000, 0);
  for (let i = 0; i < areas.length; i++) {
    app.delete(areas[i]);
  }
});
