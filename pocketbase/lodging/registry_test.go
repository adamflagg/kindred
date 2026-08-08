package lodging

import (
	"bytes"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// setupRegistryCollections builds lodging_areas, lodging_units and
// lodging_unit_aliases with the fields the loader writes, shaped like
// production's (1500000116, 1500000117).
//
// The select fields carry their real value lists and the unique indexes are
// real: a loader that wrote an invalid `bathroom`, or that re-inserted an alias
// on a second run, must fail here rather than only in production.
func setupRegistryCollections(t *testing.T, app core.App) {
	t.Helper()

	areas := core.NewBaseCollection("lodging_areas")
	areas.Fields.Add(&core.TextField{Name: "name", Required: true})
	areas.Fields.Add(&core.TextField{Name: "code", Required: true})
	areas.Fields.Add(&core.NumberField{Name: "map_x"})
	areas.Fields.Add(&core.NumberField{Name: "map_y"})
	areas.Fields.Add(&core.NumberField{Name: "sort_order", OnlyInt: true})
	// Required, mirroring migration 1500000141 (and the sync package's own
	// tightened twin, lodging_testsupport_test.go:114): PocketBase's Set on a
	// column that does not exist is a silent no-op, so a fixture that forgot
	// this column would resolve every season against a row stored at year 0
	// instead of failing loudly here. Min/Max mirror the same migration's
	// `min: 2010, max: 2100`.
	areas.Fields.Add(&core.NumberField{
		Name: "year", Required: true, OnlyInt: true,
		Min: types.Pointer(2010.0), Max: types.Pointer(2100.0),
	})
	// Composite (code, year), matching production's 1500000141: code alone is
	// no longer unique once a row exists per season.
	areas.AddIndex("idx_lodging_areas_code", true, "code, year", "")
	saveRegistryCollection(t, app, areas)

	units := core.NewBaseCollection("lodging_units")
	units.Fields.Add(&core.RelationField{
		Name: "area", CollectionId: areas.Id, MaxSelect: 1, Required: true,
	})
	units.Fields.Add(&core.TextField{Name: "name", Required: true})
	units.Fields.Add(&core.TextField{Name: "code", Required: true})
	units.Fields.Add(&core.NumberField{Name: "map_x"})
	units.Fields.Add(&core.NumberField{Name: "map_y"})
	units.Fields.Add(&core.NumberField{Name: "sleeps", OnlyInt: true})
	units.Fields.Add(&core.SelectField{
		Name: "bathroom", Values: []string{"none", "private", "shared"}, MaxSelect: 1,
	})
	units.Fields.Add(&core.TextField{Name: "bathroom_group"})
	units.Fields.Add(&core.BoolField{Name: "near_bathhouse"})
	units.Fields.Add(&core.SelectField{
		Name: "inventory_class", Values: []string{"family_pool", "staff_default"}, MaxSelect: 1,
	})
	units.Fields.Add(&core.BoolField{Name: "is_confirmed"})
	units.Fields.Add(&core.BoolField{Name: "is_active"})
	units.Fields.Add(&core.BoolField{Name: "is_container"})
	// 1500000138. Declared here or `rec.Set("default_combined", …)` is a silent
	// no-op and the assertion below passes against a loader that never wrote it
	// — the fixture trap this file has hit before.
	units.Fields.Add(&core.BoolField{Name: "default_combined"})
	units.Fields.Add(&core.TextField{Name: "notes"})
	// Amenity columns from 1500000131. has_ramp is a select, not a bool, so an
	// unassessed cabin stays blank instead of claiming "no ramp".
	// has_fridge and is_accessible predate 1500000131 (they come from
	// 1500000116) but the loader writes them too, so the fixture has to declare
	// them or those two writes go unasserted.
	for _, name := range []string{
		"has_power", "has_ac", "has_fridge", "is_accessible",
		"has_heat", "is_weatherized", "has_plumbing",
		"has_space_heater", "has_pack_play_space", "has_living_room",
		"has_kitchen", "has_lights",
	} {
		units.Fields.Add(&core.BoolField{Name: name})
	}
	units.Fields.Add(&core.SelectField{
		Name: "has_ramp", Values: []string{"yes", "no", "partial"}, MaxSelect: 1,
	})
	units.Fields.Add(&core.NumberField{Name: "max_beds", OnlyInt: true})
	// Required, same reason as lodging_areas' year field above.
	units.Fields.Add(&core.NumberField{
		Name: "year", Required: true, OnlyInt: true,
		Min: types.Pointer(2010.0), Max: types.Pointer(2100.0),
	})
	// Composite (code, year), matching production's 1500000141.
	units.AddIndex("idx_lodging_units_code", true, "code, year", "")
	saveRegistryCollection(t, app, units)

	// Self-relation: needs the collection's own id, so it lands after the
	// first save — same as production (1500000116).
	units.Fields.Add(&core.RelationField{Name: "parent_unit", CollectionId: units.Id, MaxSelect: 1})
	saveRegistryCollection(t, app, units)

	aliases := core.NewBaseCollection("lodging_unit_aliases")
	aliases.Fields.Add(&core.TextField{Name: "alias_string", Required: true})
	aliases.Fields.Add(&core.RelationField{Name: "member_units", CollectionId: units.Id, MaxSelect: 20})
	aliases.Fields.Add(&core.NumberField{Name: "valid_from_year", OnlyInt: true})
	aliases.Fields.Add(&core.NumberField{Name: "valid_to_year", OnlyInt: true})
	aliases.AddIndex("idx_lodging_alias_string_from", true, "alias_string, valid_from_year", "")
	saveRegistryCollection(t, app, aliases)
}

func saveRegistryCollection(t *testing.T, app core.App, col *core.Collection) {
	t.Helper()
	if err := app.Save(col); err != nil {
		t.Fatalf("save collection %s: %v", col.Name, err)
	}
}

func newRegistryTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupRegistryCollections(t, app)
	return app
}

// testYear is the season used by every test below that is not itself
// exercising year-scoping (see the season-scoped seeding tests further down,
// which vary the year deliberately).
const testYear = 2026

// writeRegistry drops a registry file into a temp dir and returns its path.
func writeRegistry(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "lodging_registry.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	return path
}

func countRecords(t *testing.T, app core.App, collection string) int {
	t.Helper()
	recs, err := app.FindAllRecords(collection)
	if err != nil {
		t.Fatalf("FindAllRecords(%s): %v", collection, err)
	}
	return len(recs)
}

// findByCode looks up a row by (code, year). Since migration 1500000141, code
// is unique only per (code, year), so a code-only filter can silently return
// another season's row -- the year parameter is required, not optional, so
// there is exactly one lookup shape in this file and it is the correct one.
func findByCode(t *testing.T, app core.App, collection, code string, year int) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter(collection,
		"code = {:c} && year = {:y}", map[string]any{"c": code, "y": year})
	if err != nil {
		t.Fatalf("find %s code=%s year=%d: %v", collection, code, year, err)
	}
	return rec
}

// captureLogs redirects slog to a buffer for the duration of the test.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// A minimal but structurally complete registry: one area, a container with two
// children (the second declared BEFORE its parent, so two-pass wiring is
// exercised), and one single-member plus one multi-member alias.
const fixtureRegistry = `{
  "areas": [
    {"code": "AREA1", "name": "First Area", "map_x": 0.5, "map_y": 0.25, "sort_order": 1}
  ],
  "units": [
    {"area": "AREA1", "code": "child-a", "name": "Child A", "map_x": 0.51, "map_y": 0.26,
     "sleeps": 4, "bathroom": "shared", "bathroom_group": "grp-1", "parent_unit": "building-1",
     "near_bathhouse": true, "inventory_class": "family_pool", "is_container": false,
     "notes": "a note"},
    {"area": "AREA1", "code": "building-1", "name": "Building One", "map_x": 0.5, "map_y": 0.25,
     "sleeps": null, "bathroom": "none", "bathroom_group": "", "parent_unit": "",
     "near_bathhouse": false, "inventory_class": "family_pool", "is_container": true,
     "notes": ""},
    {"area": "AREA1", "code": "child-b", "name": "Child B", "map_x": 0.52, "map_y": 0.27,
     "sleeps": 2, "bathroom": "shared", "bathroom_group": "grp-1", "parent_unit": "building-1",
     "near_bathhouse": false, "inventory_class": "staff_default", "is_container": false,
     "notes": ""}
  ],
  "aliases": [
    {"alias_string": "Child A", "member_units": ["child-a"],
     "valid_from_year": null, "valid_to_year": null},
    {"alias_string": "Building One", "member_units": ["child-a", "child-b"],
     "valid_from_year": 2025, "valid_to_year": null}
  ]
}`

// withRegistryBasePath points the path resolution at a temp tree for one test.
func withRegistryBasePath(t *testing.T, base string) {
	t.Helper()
	prev := registryBasePath
	registryBasePath = base
	t.Cleanup(func() { registryBasePath = prev })
}

// withRegistryAbsoluteRoots swaps the absolute candidate directories, which are
// otherwise unreachable from a test that cannot write to / or /app.
func withRegistryAbsoluteRoots(t *testing.T, roots []string) {
	t.Helper()
	prev := registryAbsoluteRoots
	registryAbsoluteRoots = roots
	t.Cleanup(func() { registryAbsoluteRoots = prev })
}

// SeedRegistry is what main.go actually calls, so its path resolution needs
// covering too: the loader finding nothing because it looked in the wrong place
// is indistinguishable, from the outside, from a clone with no private config.
func TestSeedRegistryResolvesConfigUnderTheWorkingDirectory(t *testing.T) {
	app := newRegistryTestApp(t)

	base := t.TempDir()
	if err := os.Mkdir(filepath.Join(base, "config"), 0o750); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(base, "config", "lodging_registry.json"), []byte(fixtureRegistry), 0o600,
	); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	withRegistryBasePath(t, base)

	if err := SeedRegistry(app, testYear); err != nil {
		t.Fatalf("SeedRegistry: %v", err)
	}
	if n := countRecords(t, app, "lodging_units"); n != 3 {
		t.Errorf("got %d units, want 3 — the file under ./config was not found", n)
	}
}

// A clone without kindred-local: nothing on any candidate path.
func TestSeedRegistryWithNoConfigAnywhereIsANoOp(t *testing.T) {
	app := newRegistryTestApp(t)
	logs := captureLogs(t)
	withRegistryBasePath(t, t.TempDir())

	if err := SeedRegistry(app, testYear); err != nil {
		t.Fatalf("no config anywhere should not be an error, got: %v", err)
	}
	if n := countRecords(t, app, "lodging_units"); n != 0 {
		t.Errorf("created %d units with no registry file, want 0", n)
	}
	if !bytes.Contains(logs.Bytes(), []byte("lodging registry")) {
		t.Errorf("no registry file logged nothing; got:\n%s", logs.String())
	}
}

func TestSeedRegistryAbsentFileIsANoOp(t *testing.T) {
	app := newRegistryTestApp(t)
	logs := captureLogs(t)

	missing := filepath.Join(t.TempDir(), "does_not_exist.json")
	if err := seedRegistryFromFile(app, missing, testYear); err != nil {
		t.Fatalf("absent file should not be an error, got: %v", err)
	}

	if n := countRecords(t, app, "lodging_units"); n != 0 {
		t.Errorf("absent file created %d units, want 0", n)
	}
	if n := countRecords(t, app, "lodging_areas"); n != 0 {
		t.Errorf("absent file created %d areas, want 0", n)
	}
	// Graceful degradation has to be visible, or an empty registry looks like
	// a working one. Same contract branding already has.
	if !bytes.Contains(logs.Bytes(), []byte("lodging registry")) {
		t.Errorf("absent file logged nothing about the registry; got:\n%s", logs.String())
	}
}

func TestSeedRegistryCreatesAreasUnitsAndAliases(t *testing.T) {
	app := newRegistryTestApp(t)

	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	if n := countRecords(t, app, "lodging_areas"); n != 1 {
		t.Errorf("got %d areas, want 1", n)
	}
	if n := countRecords(t, app, "lodging_units"); n != 3 {
		t.Errorf("got %d units, want 3", n)
	}
	if n := countRecords(t, app, "lodging_unit_aliases"); n != 2 {
		t.Errorf("got %d aliases, want 2", n)
	}

	area := findByCode(t, app, "lodging_areas", "AREA1", testYear)
	if got := area.GetString("name"); got != "First Area" {
		t.Errorf("area name = %q, want %q", got, "First Area")
	}
	if got := area.GetFloat("map_x"); got != 0.5 {
		t.Errorf("area map_x = %v, want 0.5", got)
	}
	if got := area.GetInt("sort_order"); got != 1 {
		t.Errorf("area sort_order = %d, want 1", got)
	}

	child := findByCode(t, app, "lodging_units", "child-a", testYear)
	if got := child.GetString("name"); got != "Child A" {
		t.Errorf("unit name = %q, want %q", got, "Child A")
	}
	if got := child.GetString("area"); got != area.Id {
		t.Errorf("unit area = %q, want the area record id %q", got, area.Id)
	}
	if got := child.GetInt("sleeps"); got != 4 {
		t.Errorf("unit sleeps = %d, want 4", got)
	}
	if got := child.GetString("bathroom"); got != "shared" {
		t.Errorf("unit bathroom = %q, want shared", got)
	}
	if got := child.GetString("bathroom_group"); got != "grp-1" {
		t.Errorf("unit bathroom_group = %q, want grp-1", got)
	}
	if !child.GetBool("near_bathhouse") {
		t.Error("unit near_bathhouse = false, want true")
	}
	if got := child.GetString("inventory_class"); got != "family_pool" {
		t.Errorf("unit inventory_class = %q, want family_pool", got)
	}
	if got := child.GetString("notes"); got != "a note" {
		t.Errorf("unit notes = %q, want %q", got, "a note")
	}
	if !child.GetBool("is_active") {
		t.Error("seeded unit is_active = false, want true")
	}
	// Every seeded value is a guess until staff say otherwise (1500000120).
	if child.GetBool("is_confirmed") {
		t.Error("seeded unit is_confirmed = true, want false")
	}
	if child.GetBool("is_container") {
		t.Error("child-a is_container = true, want false")
	}
	if !findByCode(t, app, "lodging_units", "building-1", testYear).GetBool("is_container") {
		t.Error("building-1 is_container = false, want true")
	}
}

// The 2026 inventory's whole point. Before it, has_power/has_ac/has_fridge/
// is_accessible were false on all 93 units — not because the cabins lacked
// them but because nobody filled the columns in, which is why the fit check
// has never been meaningful. A loader that ignored these fields would carry
// the sheet's answers into the file and drop them on the way to the database.
func TestSeedRegistryWritesAmenities(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "warm", "name": "Warm", "bathroom": "none",
	   "inventory_class": "family_pool",
	   "has_power": true, "has_ac": true, "has_fridge": true, "is_accessible": true,
	   "has_heat": true, "is_weatherized": true,
	   "has_plumbing": true, "has_space_heater": true, "has_pack_play_space": true,
	   "has_living_room": true, "has_kitchen": true, "has_lights": true,
	   "has_ramp": "partial", "max_beds": 14}
	], "aliases": []}`

	if err := seedRegistryFromFile(app, writeRegistry(t, body), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	unit := findByCode(t, app, "lodging_units", "warm", testYear)
	for _, field := range []string{
		"has_power", "has_ac", "has_fridge", "is_accessible",
		"has_heat", "is_weatherized", "has_plumbing",
		"has_space_heater", "has_pack_play_space", "has_living_room",
		"has_kitchen", "has_lights",
	} {
		if !unit.GetBool(field) {
			t.Errorf("%s = false, want true", field)
		}
	}
	if got := unit.GetString("has_ramp"); got != "partial" {
		t.Errorf("has_ramp = %q, want %q", got, "partial")
	}
	// max_beds is total sleeping spots and must never be confused with sleeps,
	// the staff judgement for the session type. A 14-bunk camper cabin holds
	// one family.
	if got := unit.GetInt("max_beds"); got != 14 {
		t.Errorf("max_beds = %d, want 14", got)
	}
	if got := unit.GetInt("sleeps"); got != 0 {
		t.Errorf("sleeps = %d, want 0 — max_beds must not leak into sleeps", got)
	}
}

// The registry file is the ONLY way `default_combined` reaches a FRESH
// database, so the loader has to carry it.
//
// 1500000138's backfill runs before SeedRegistry (main.go), which on a new
// worktree, a new deployment or a rebuilt CD seed means it UPDATEs an empty
// table. If the loader then drops the key, every whole-let building is created
// with `default_combined = false` and the board silently draws each one as its
// rooms — no error, just more cards than there are buildings.
//
// Go's json decoder ignores an unknown key in silence, so this failure mode is
// invisible on both sides: the file says `true`, the column says false, and
// nothing anywhere complains.
func TestSeedRegistryWritesDefaultCombined(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "whole-let", "name": "Whole Let", "bathroom": "none",
	   "inventory_class": "family_pool", "is_container": true, "sleeps": 7,
	   "default_combined": true},
	  {"area": "AREA1", "code": "grouping", "name": "Grouping", "bathroom": "none",
	   "inventory_class": "family_pool", "is_container": true}
	], "aliases": []}`

	if err := seedRegistryFromFile(app, writeRegistry(t, body), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	if got := findByCode(t, app, "lodging_units", "whole-let", testYear).GetBool("default_combined"); !got {
		t.Errorf("default_combined = %v for a unit the file marks true, want true", got)
	}
	// Absent means false — "draw the children", the behavior before the
	// column existed. A container used purely for grouping carries no let.
	if got := findByCode(t, app, "lodging_units", "grouping", testYear).GetBool("default_combined"); got {
		t.Errorf("default_combined = %v for a unit with no key, want false", got)
	}
}

// A blank has_ramp is "not assessed", and it must reach the database blank
// rather than as a confident "no".
func TestSeedRegistryUnassessedRampStaysBlank(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "unknown-ramp", "name": "Unknown", "bathroom": "none",
	   "inventory_class": "family_pool"}
	], "aliases": []}`

	if err := seedRegistryFromFile(app, writeRegistry(t, body), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	if got := findByCode(t, app, "lodging_units", "unknown-ramp", testYear).GetString("has_ramp"); got != "" {
		t.Errorf("has_ramp = %q for an unassessed unit, want empty (not assessed)", got)
	}
}

func TestSeedRegistryWiresParentDeclaredAfterChild(t *testing.T) {
	app := newRegistryTestApp(t)

	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	building := findByCode(t, app, "lodging_units", "building-1", testYear)
	// child-a is listed BEFORE building-1 in the file: a single-pass loader
	// would have no id to point at and would leave the relation empty.
	for _, code := range []string{"child-a", "child-b"} {
		if got := findByCode(t, app, "lodging_units", code, testYear).GetString("parent_unit"); got != building.Id {
			t.Errorf("%s parent_unit = %q, want %q", code, got, building.Id)
		}
	}
	if got := building.GetString("parent_unit"); got != "" {
		t.Errorf("building-1 parent_unit = %q, want empty", got)
	}
}

// An unset `sleeps` must land as PocketBase's 0, which consumers read as
// UNKNOWN. The JSON carries null; a loader that coerced null to a real 0
// through some other path would be indistinguishable here, but a loader that
// rejected null or wrote garbage would not.
func TestSeedRegistryNullSleepsStoresZero(t *testing.T) {
	app := newRegistryTestApp(t)

	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	if got := findByCode(t, app, "lodging_units", "building-1", testYear).GetInt("sleeps"); got != 0 {
		t.Errorf("null sleeps stored as %d, want 0 (unknown)", got)
	}
}

// PocketBase stores an unset number as 0, never NULL. An alias whose window is
// unbounded must therefore be written and re-found as 0 — the trap 1500000121
// documents, and the reason a re-run would otherwise die on the unique index.
func TestSeedRegistryUnboundedAliasYearsStoreZero(t *testing.T) {
	app := newRegistryTestApp(t)

	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	unbounded, err := app.FindFirstRecordByFilter(
		"lodging_unit_aliases", "alias_string = {:s}", map[string]any{"s": "Child A"},
	)
	if err != nil {
		t.Fatalf("find alias: %v", err)
	}
	if got := unbounded.GetInt("valid_from_year"); got != 0 {
		t.Errorf("unbounded valid_from_year = %d, want 0", got)
	}
	if got := unbounded.GetInt("valid_to_year"); got != 0 {
		t.Errorf("unbounded valid_to_year = %d, want 0", got)
	}

	bounded, err := app.FindFirstRecordByFilter(
		"lodging_unit_aliases", "alias_string = {:s}", map[string]any{"s": "Building One"},
	)
	if err != nil {
		t.Fatalf("find bounded alias: %v", err)
	}
	if got := bounded.GetInt("valid_from_year"); got != 2025 {
		t.Errorf("bounded valid_from_year = %d, want 2025", got)
	}
}

func TestSeedRegistryAliasMembersResolveToUnitIDs(t *testing.T) {
	app := newRegistryTestApp(t)

	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}

	merge, err := app.FindFirstRecordByFilter(
		"lodging_unit_aliases", "alias_string = {:s}", map[string]any{"s": "Building One"},
	)
	if err != nil {
		t.Fatalf("find alias: %v", err)
	}

	want := []string{
		findByCode(t, app, "lodging_units", "child-a", testYear).Id,
		findByCode(t, app, "lodging_units", "child-b", testYear).Id,
	}
	got := merge.GetStringSlice("member_units")
	if len(got) != len(want) {
		t.Fatalf("member_units = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("member_units[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestSeedRegistryIsIdempotent(t *testing.T) {
	app := newRegistryTestApp(t)
	path := writeRegistry(t, fixtureRegistry)

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("second run: %v", err)
	}

	if n := countRecords(t, app, "lodging_areas"); n != 1 {
		t.Errorf("after two runs: %d areas, want 1", n)
	}
	if n := countRecords(t, app, "lodging_units"); n != 3 {
		t.Errorf("after two runs: %d units, want 3", n)
	}
	if n := countRecords(t, app, "lodging_unit_aliases"); n != 2 {
		t.Errorf("after two runs: %d aliases, want 2", n)
	}
}

// The registry is staff-editable in /manage/lodging. A loader that rewrote
// every field on boot would silently undo a confirmation or a corrected
// coordinate on the next restart, which is why this is create-if-absent and
// not a full upsert.
func TestSeedRegistryPreservesStaffEdits(t *testing.T) {
	app := newRegistryTestApp(t)
	path := writeRegistry(t, fixtureRegistry)

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("first run: %v", err)
	}

	edited := findByCode(t, app, "lodging_units", "child-a", testYear)
	edited.Set("sleeps", 9)
	edited.Set("is_confirmed", true)
	edited.Set("map_x", 0.9)
	edited.Set("notes", "staff corrected this")
	if err := app.Save(edited); err != nil {
		t.Fatalf("save staff edit: %v", err)
	}

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("second run: %v", err)
	}

	after := findByCode(t, app, "lodging_units", "child-a", testYear)
	if got := after.GetInt("sleeps"); got != 9 {
		t.Errorf("sleeps = %d after re-seed, want the staff value 9", got)
	}
	if !after.GetBool("is_confirmed") {
		t.Error("is_confirmed reverted to false, want the staff value true")
	}
	if got := after.GetFloat("map_x"); got != 0.9 {
		t.Errorf("map_x = %v after re-seed, want the staff value 0.9", got)
	}
	if got := after.GetString("notes"); got != "staff corrected this" {
		t.Errorf("notes = %q after re-seed, want the staff value", got)
	}
}

// A parent_unit staff cleared deliberately must not be silently re-wired on the
// next boot, for the same reason as the field edits above.
func TestSeedRegistryDoesNotRewireAnExistingParent(t *testing.T) {
	app := newRegistryTestApp(t)
	path := writeRegistry(t, fixtureRegistry)

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("first run: %v", err)
	}

	detached := findByCode(t, app, "lodging_units", "child-b", testYear)
	detached.Set("parent_unit", "")
	if err := app.Save(detached); err != nil {
		t.Fatalf("clear parent: %v", err)
	}

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("second run: %v", err)
	}

	if got := findByCode(t, app, "lodging_units", "child-b", testYear).GetString("parent_unit"); got != "" {
		t.Errorf("parent_unit = %q after re-seed, want it left cleared", got)
	}
}

func TestSeedRegistryMalformedJSONErrorsWithoutWriting(t *testing.T) {
	app := newRegistryTestApp(t)

	err := seedRegistryFromFile(app, writeRegistry(t, `{"areas": [ NOT JSON`), testYear)
	if err == nil {
		t.Fatal("malformed JSON returned nil, want an error")
	}
	if n := countRecords(t, app, "lodging_areas"); n != 0 {
		t.Errorf("malformed JSON created %d areas, want 0", n)
	}
}

// A unit naming an area that is not in the file is a broken registry, not a
// unit to create area-less: `area` is a REQUIRED relation, so the alternative
// is a save that fails deep in the loop with no useful message.
func TestSeedRegistryUnknownAreaCodeIsAnError(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [], "units": [
	  {"area": "NOPE", "code": "orphan", "name": "Orphan", "bathroom": "none",
	   "inventory_class": "family_pool"}
	], "aliases": []}`

	err := seedRegistryFromFile(app, writeRegistry(t, body), testYear)
	if err == nil {
		t.Fatal("unknown area code returned nil, want an error")
	}
	if n := countRecords(t, app, "lodging_units"); n != 0 {
		t.Errorf("unknown area code created %d units, want 0", n)
	}
}

func TestSeedRegistryUnknownParentCodeIsAnError(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "orphan", "name": "Orphan", "parent_unit": "nope",
	   "bathroom": "none", "inventory_class": "family_pool"}
	], "aliases": []}`

	if err := seedRegistryFromFile(app, writeRegistry(t, body), testYear); err == nil {
		t.Fatal("unknown parent code returned nil, want an error")
	}
}

// An alias pointing at a unit code the file does not define would otherwise
// save with a short member list — a merge quietly missing a room.
func TestSeedRegistryUnknownAliasMemberIsAnError(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "real", "name": "Real", "bathroom": "none",
	   "inventory_class": "family_pool"}
	], "aliases": [
	  {"alias_string": "Broken", "member_units": ["real", "ghost"]}
	]}`

	if err := seedRegistryFromFile(app, writeRegistry(t, body), testYear); err == nil {
		t.Fatal("unknown alias member returned nil, want an error")
	}
	if n := countRecords(t, app, "lodging_unit_aliases"); n != 0 {
		t.Errorf("unknown alias member created %d aliases, want 0", n)
	}
}

// Two alias rows may share a string when their windows differ (a rename), so
// idempotency has to key on the pair the unique index keys on.
func TestSeedRegistrySameAliasStringDifferentWindowsBothLand(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "old", "name": "Old", "bathroom": "none",
	   "inventory_class": "family_pool"},
	  {"area": "AREA1", "code": "new", "name": "New", "bathroom": "none",
	   "inventory_class": "family_pool"}
	], "aliases": [
	  {"alias_string": "Renamed", "member_units": ["old"],
	   "valid_from_year": null, "valid_to_year": 2024},
	  {"alias_string": "Renamed", "member_units": ["new"],
	   "valid_from_year": 2025, "valid_to_year": null}
	]}`
	path := writeRegistry(t, body)

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if n := countRecords(t, app, "lodging_unit_aliases"); n != 2 {
		t.Fatalf("got %d aliases, want 2 (one per window)", n)
	}
	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if n := countRecords(t, app, "lodging_unit_aliases"); n != 2 {
		t.Errorf("after two runs: %d aliases, want 2", n)
	}
}

// --- file-level validation -------------------------------------------------
//
// The loader's "row already exists -> skip" is how idempotency works across
// runs. That makes it structurally unable to tell a re-run from a code
// duplicated INSIDE one file, so a duplicate is dropped with no error and no
// log line -- while an unknown area, parent or alias member all hard-fail.
// The file is hand-maintained, so the slip is realistic and the silence is the
// bug. Validation runs before any write, so a bad file changes nothing.

func TestSeedRegistryDuplicateUnitCodeIsAnError(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "twin", "name": "First", "bathroom": "none",
	   "inventory_class": "family_pool"},
	  {"area": "AREA1", "code": "twin", "name": "Second", "bathroom": "none",
	   "inventory_class": "family_pool"}
	], "aliases": []}`

	err := seedRegistryFromFile(app, writeRegistry(t, body), testYear)
	if err == nil {
		t.Fatal("duplicate unit code returned nil, want an error")
	}
	if n := countRecords(t, app, "lodging_units"); n != 0 {
		t.Errorf("duplicate unit code created %d units, want 0 (validation precedes writes)", n)
	}
}

func TestSeedRegistryDuplicateAreaCodeIsAnError(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [
	  {"code": "AREA1", "name": "First"},
	  {"code": "AREA1", "name": "Second"}
	], "units": [], "aliases": []}`

	err := seedRegistryFromFile(app, writeRegistry(t, body), testYear)
	if err == nil {
		t.Fatal("duplicate area code returned nil, want an error")
	}
	if n := countRecords(t, app, "lodging_areas"); n != 0 {
		t.Errorf("duplicate area code created %d areas, want 0", n)
	}
}

// Two alias rows may legitimately share a string when their windows differ,
// so the duplicate check has to key on the pair the unique index keys on --
// the same pair TestSeedRegistrySameAliasStringDifferentWindowsBothLand
// requires to stay legal.
func TestSeedRegistryDuplicateAliasWindowIsAnError(t *testing.T) {
	app := newRegistryTestApp(t)

	body := `{"areas": [{"code": "AREA1", "name": "First Area"}], "units": [
	  {"area": "AREA1", "code": "real", "name": "Real", "bathroom": "none",
	   "inventory_class": "family_pool"}
	], "aliases": [
	  {"alias_string": "Same", "member_units": ["real"], "valid_from_year": 2025},
	  {"alias_string": "Same", "member_units": ["real"], "valid_from_year": 2025}
	]}`

	err := seedRegistryFromFile(app, writeRegistry(t, body), testYear)
	if err == nil {
		t.Fatal("duplicate (alias_string, valid_from_year) returned nil, want an error")
	}
	if n := countRecords(t, app, "lodging_unit_aliases"); n != 0 {
		t.Errorf("duplicate alias created %d aliases, want 0", n)
	}
}

// --- parent wiring ---------------------------------------------------------

// Deleting a container in /manage/lodging nulls its children's parent_unit as
// a side effect. The loader then recreates the container -- so it has already
// decided the row should exist -- but wiring gated only on "the CHILD was
// created this run" left those children permanently orphaned: a restored
// building with nothing in it, and no error to say so.
//
// This is distinct from TestSeedRegistryDoesNotRewireAnExistingParent, where
// the container was never deleted and the cleared parent is a staff decision
// the loader must respect.
func TestSeedRegistryRewiresChildrenOfARecreatedContainer(t *testing.T) {
	app := newRegistryTestApp(t)
	path := writeRegistry(t, fixtureRegistry)

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("first run: %v", err)
	}

	container := findByCode(t, app, "lodging_units", "building-1", testYear)
	if err := app.Delete(container); err != nil {
		t.Fatalf("delete container: %v", err)
	}

	if err := seedRegistryFromFile(app, path, testYear); err != nil {
		t.Fatalf("second run: %v", err)
	}

	recreated := findByCode(t, app, "lodging_units", "building-1", testYear)
	for _, code := range []string{"child-a", "child-b"} {
		if got := findByCode(t, app, "lodging_units", code, testYear).GetString("parent_unit"); got != recreated.Id {
			t.Errorf("%s.parent_unit = %q after the container was recreated, want %q",
				code, got, recreated.Id)
		}
	}
}

// --- path resolution -------------------------------------------------------

// The absolute candidates must be found on their own merit. In the production
// image the container's working directory is "/", which makes the RELATIVE
// "./config" candidate coincidentally equal the real "/config" mount -- so a
// future WORKDIR would silently break the only candidate that actually fires.
func TestSeedRegistryResolvesAbsoluteConfigRoot(t *testing.T) {
	app := newRegistryTestApp(t)

	absRoot := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(absRoot, registryFileName), []byte(fixtureRegistry), 0o600,
	); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	withRegistryAbsoluteRoots(t, []string{absRoot})
	// Point the relative candidates at an empty tree, so only the absolute
	// root can satisfy this.
	withRegistryBasePath(t, t.TempDir())

	if err := SeedRegistry(app, testYear); err != nil {
		t.Fatalf("SeedRegistry: %v", err)
	}
	if n := countRecords(t, app, "lodging_units"); n != 3 {
		t.Errorf("got %d units, want 3 — the absolute config root was not searched", n)
	}
}

// --- RegistryFilePresent -----------------------------------------------------
//
// main.go (issue #2054, Half 2) needs to tell "no private config, nothing to
// load" apart from "config is here and unreadable without a season" so a
// season-less boot can warn-and-continue in the first case but fail in the
// second. RegistryFilePresent is presence-only — it must not read, parse, or
// validate the file, so it shares the same candidate-path search SeedRegistry
// uses without duplicating any of the loading behavior.
func TestRegistryFilePresentTrueWhenFileExistsUnderWorkingDirectory(t *testing.T) {
	base := t.TempDir()
	if err := os.Mkdir(filepath.Join(base, "config"), 0o750); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(base, "config", registryFileName), []byte(fixtureRegistry), 0o600,
	); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	withRegistryBasePath(t, base)
	withRegistryAbsoluteRoots(t, []string{filepath.Join(t.TempDir(), "unused")})

	if !RegistryFilePresent() {
		t.Error("expected RegistryFilePresent() true when config/lodging_registry.json exists under the working directory")
	}
}

func TestRegistryFilePresentTrueViaAbsoluteRoot(t *testing.T) {
	absRoot := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(absRoot, registryFileName), []byte(fixtureRegistry), 0o600,
	); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	withRegistryAbsoluteRoots(t, []string{absRoot})
	withRegistryBasePath(t, t.TempDir())

	if !RegistryFilePresent() {
		t.Error("expected RegistryFilePresent() true when the file exists under an absolute root")
	}
}

func TestRegistryFilePresentFalseWhenNoConfigAnywhere(t *testing.T) {
	withRegistryBasePath(t, t.TempDir())
	withRegistryAbsoluteRoots(t, []string{filepath.Join(t.TempDir(), "unused")})

	if RegistryFilePresent() {
		t.Error("expected RegistryFilePresent() false with no registry file on any candidate path")
	}
}

// --- season-scoped seeding --------------------------------------------------
//
// yearFixtureRegistry is a container with one child, keyed off the codes
// task 2's tests assert on. SeedRegistry only takes a filesystem path to a
// registry file — pointing it at a temp config dir via withYearFixtureRegistry
// is how these tests hand it fixture content while still exercising the real
// SeedRegistry entrypoint (not seedRegistryFromFile) the way main.go calls it.
const yearFixtureRegistry = `{
  "areas": [
    {"code": "AREA1", "name": "First Area"}
  ],
  "units": [
    {"area": "AREA1", "code": "test-unit-a", "name": "Test Building A",
     "bathroom": "none", "inventory_class": "family_pool", "is_container": true},
    {"area": "AREA1", "code": "test-unit-a-room-1", "name": "Test Building A Room 1",
     "bathroom": "none", "inventory_class": "family_pool", "parent_unit": "test-unit-a"}
  ],
  "aliases": []
}`

// withYearFixtureRegistry points SeedRegistry's default config-file lookup at
// a temp tree containing yearFixtureRegistry, the same way
// TestSeedRegistryResolvesConfigUnderTheWorkingDirectory does for the other
// fixture.
func withYearFixtureRegistry(t *testing.T) {
	t.Helper()
	base := t.TempDir()
	if err := os.Mkdir(filepath.Join(base, "config"), 0o750); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(base, "config", registryFileName), []byte(yearFixtureRegistry), 0o600,
	); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	withRegistryBasePath(t, base)
}

func TestSeedRegistryStampsTheSeason(t *testing.T) {
	app := newRegistryTestApp(t)
	withYearFixtureRegistry(t)

	if err := SeedRegistry(app, 2027); err != nil {
		t.Fatalf("SeedRegistry: %v", err)
	}
	rec, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil || rec == nil {
		t.Fatalf("unit not seeded for 2027: rec=%v err=%v", rec, err)
	}
	if got := rec.GetInt("year"); got != 2027 {
		t.Errorf("year = %d, want 2027", got)
	}
}

func TestFindByCodeAndYearIgnoresOtherYears(t *testing.T) {
	app := newRegistryTestApp(t)
	withYearFixtureRegistry(t)

	if err := SeedRegistry(app, 2026); err != nil {
		t.Fatalf("SeedRegistry: %v", err)
	}
	rec, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil {
		t.Fatalf("findByCodeAndYear: %v", err)
	}
	if rec != nil {
		t.Errorf("found a 2026 row when asking for 2027: %s", rec.Id)
	}
}

// TestFindByCodeIsScopedToItsYear guards the findByCode test helper itself.
// Since migration 1500000141, code is unique only per (code, year), so a
// lookup that ignores year can return another season's row instead of the
// caller's. Both seasons share the code here so a regression to a code-only
// filter would not just occasionally pick the wrong row -- FindFirstRecordByFilter
// has no defined tie-break order, so the two assertions below would either both
// read the SAME row (failing the id-distinctness check) or read one correctly
// and one wrong, unpredictably. Asserting each year's row by its own "year"
// field, rather than by id equality with something seeded once, is what makes
// a regression here fail loudly instead of flaking.
func TestFindByCodeIsScopedToItsYear(t *testing.T) {
	app := newRegistryTestApp(t)

	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), 2026); err != nil {
		t.Fatalf("seed 2026: %v", err)
	}
	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), 2027); err != nil {
		t.Fatalf("seed 2027: %v", err)
	}

	rec2026 := findByCode(t, app, "lodging_units", "child-a", 2026)
	rec2027 := findByCode(t, app, "lodging_units", "child-a", 2027)

	if rec2026.Id == rec2027.Id {
		t.Fatalf("the same row was returned for both years: %s", rec2026.Id)
	}
	if got := rec2026.GetInt("year"); got != 2026 {
		t.Errorf("row fetched for 2026 has year = %d, want 2026", got)
	}
	if got := rec2027.GetInt("year"); got != 2027 {
		t.Errorf("row fetched for 2027 has year = %d, want 2027", got)
	}
}

// TestRegistryFixtureRejectsYearOutsideProductionRange guards the fixture's
// own year fields against production (migration 1500000141: min 2010, max
// 2100). Both lodging_units and lodging_areas already carry Required and
// OnlyInt here; without Min/Max too, a test could store year: 1 and pass on
// data the real database would reject.
func TestRegistryFixtureRejectsYearOutsideProductionRange(t *testing.T) {
	app := newRegistryTestApp(t)

	area, err := app.FindCollectionByNameOrId("lodging_areas")
	if err != nil {
		t.Fatalf("find collection lodging_areas: %v", err)
	}
	unit, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find collection lodging_units: %v", err)
	}

	// The unit case needs an area to point at.
	if err := seedRegistryFromFile(app, writeRegistry(t, fixtureRegistry), testYear); err != nil {
		t.Fatalf("seedRegistryFromFile: %v", err)
	}
	areaID := findByCode(t, app, "lodging_areas", "AREA1", testYear).Id

	cases := []struct {
		label      string
		collection *core.Collection
		values     map[string]any
	}{
		{"area below min (2010)", area, map[string]any{"code": "range-check", "name": "range-check", "year": 2009}},
		{"area above max (2100)", area, map[string]any{"code": "range-check", "name": "range-check", "year": 2101}},
		{"unit below min (2010)", unit, map[string]any{
			"code": "range-check", "name": "range-check", "area": areaID, "year": 2009,
		}},
	}

	for _, c := range cases {
		rec := core.NewRecord(c.collection)
		for k, v := range c.values {
			rec.Set(k, v)
		}
		if err := app.Save(rec); err == nil {
			t.Errorf("%s: saved; want the fixture to refuse it like production does", c.label)
		}
	}
}

// TestSeedRegistrySecondSeasonIsANoOpOnceOneSeasonHasRows pins the bootstrap
// contract design doc §4.2 requires: SeedRegistry seeds only when the
// registry is empty across EVERY year. Once 2026 has rows, calling it again
// for 2027 must be a no-op, not a second creation pass.
//
// Before this was the rule, SeedRegistry created (code, year) rows for
// whatever season it was called with, so a season flip's first boot silently
// recreated the entire registry for the new year out of the stale bootstrap
// file — unconfirmed, is_active forced true, every staff correction gone —
// and then PreviewRollForward found every code already present and reported
// nothing to carry forward, permanently disabling the one control meant to
// carry a season forward. This test used to seed 2026 then 2027 from one
// file and assert both landed; that pinned the bug as correct. It now asserts
// the opposite: the second call must change nothing.
func TestSeedRegistrySecondSeasonIsANoOpOnceOneSeasonHasRows(t *testing.T) {
	app := newRegistryTestApp(t)
	withYearFixtureRegistry(t)
	logs := captureLogs(t)

	if err := SeedRegistry(app, 2026); err != nil {
		t.Fatalf("seed 2026: %v", err)
	}
	if n := countRecords(t, app, "lodging_units"); n != 2 {
		t.Fatalf("after seeding 2026: %d units, want 2", n)
	}

	if err := SeedRegistry(app, 2027); err != nil {
		t.Fatalf("seed 2027: %v", err)
	}

	if rec, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027); err != nil || rec != nil {
		t.Errorf("2027 unit test-unit-a exists after a bootstrap-only seed: rec=%v err=%v", rec, err)
	}
	if rec, err := findByCodeAndYear(app, "lodging_areas", "AREA1", 2027); err != nil || rec != nil {
		t.Errorf("2027 area AREA1 exists after a bootstrap-only seed: rec=%v err=%v", rec, err)
	}
	// 2026's rows must be untouched, not just 2027's absence.
	if n := countRecords(t, app, "lodging_units"); n != 2 {
		t.Errorf("after the skipped second seed: %d units, want the original 2", n)
	}
	if !bytes.Contains(logs.Bytes(), []byte("skip")) {
		t.Errorf("skipping the second season logged nothing; got:\n%s", logs.String())
	}
}

// TestSeedRegistryLeavesNothingBehindWhenAPassFails pins that the bootstrap is
// ATOMIC, which the bootstrap-only gate makes load-bearing rather than tidy.
//
// SeedRegistry now refuses to run once ANY season has rows (design doc §4.2,
// and the right rule — roll-forward owns every subsequent season). The
// consequence is that the create-if-absent behavior no longer finishes a job
// a previous run started: before the gate, a seed that died halfway was
// completed by the next boot; now the areas it committed make
// RegistryHasRows report true forever, so the loader logs "skipping" and
// the registry stays permanently half-built, with no error anywhere to say so.
//
// The gate is not the bug and must not be loosened to fix this. The seed has
// to land all-or-nothing instead, so a failed bootstrap leaves an empty
// registry the next boot will retry from scratch.
func TestSeedRegistryLeavesNothingBehindWhenAPassFails(t *testing.T) {
	app := newRegistryTestApp(t)
	withYearFixtureRegistry(t)
	lift := failUnitCreate(app, "test-unit-a-room-1") // the second of two units

	if err := SeedRegistry(app, 2026); err == nil {
		t.Fatal("SeedRegistry succeeded; want the injected failure to surface")
	}

	if n := countRecords(t, app, "lodging_units"); n != 0 {
		t.Errorf("%d units survived a failed bootstrap; want 0", n)
	}
	if n := countRecords(t, app, "lodging_areas"); n != 0 {
		t.Errorf("%d areas survived a failed bootstrap; want 0 -- a committed area "+
			"makes RegistryHasRows true, so the bootstrap never runs again", n)
	}

	// The point of atomicity here: the next boot must still be able to seed.
	lift()
	if err := SeedRegistry(app, 2026); err != nil {
		t.Fatalf("second SeedRegistry after a failed one: %v", err)
	}
	if n := countRecords(t, app, "lodging_units"); n != 2 {
		t.Errorf("%d units after the retry; want 2 -- a transient failure must not "+
			"permanently disable the bootstrap", n)
	}
}

// TestSeedRegistryRowCheckFailureIsTaggedAsSuch pins the sentinel main.go's
// boot gate keys on (issue #2141).
//
// SeedRegistry has exactly two error sources, and they warrant opposite boot
// treatments: a RegistryHasRows failure means the loader could not even
// determine whether there is anything at risk, so the boot must fail OPEN
// (warn and continue) rather than compound one failure with a second, less
// legible one -- the same call main.go already makes for the season branch.
// Everything else is a genuinely bad registry file and must take the boot
// down. Tagging only the row-check failure is what lets main.go tell them
// apart without inspecting error strings.
func TestSeedRegistryRowCheckFailureIsTaggedAsSuch(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	// Deliberately NO setupRegistryCollections: with lodging_areas absent,
	// RegistryHasRows cannot answer and SeedRegistry fails on its first step.

	seedErr := SeedRegistry(app, testYear)
	if seedErr == nil {
		t.Fatal("SeedRegistry returned nil with no lodging collections, want a row-check error")
	}
	if !errors.Is(seedErr, ErrRegistryRowCheck) {
		t.Errorf("row-check failure is not tagged ErrRegistryRowCheck, so main.go "+
			"cannot fail open on it; got: %v", seedErr)
	}
}

// The other half of the same contract: a bad registry FILE must not be
// mistaken for a row-check failure, or #2141's whole point is lost and the
// malformed-file case keeps the warn-and-boot treatment it has today.
func TestSeedRegistryFileErrorIsNotTaggedAsARowCheckFailure(t *testing.T) {
	app := newRegistryTestApp(t)

	base := t.TempDir()
	if err := os.Mkdir(filepath.Join(base, "config"), 0o750); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(base, "config", "lodging_registry.json"),
		[]byte(`{"areas": [ NOT JSON`), 0o600,
	); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	withRegistryBasePath(t, base)
	withRegistryAbsoluteRoots(t, nil)

	seedErr := SeedRegistry(app, testYear)
	if seedErr == nil {
		t.Fatal("malformed registry file returned nil, want an error")
	}
	if errors.Is(seedErr, ErrRegistryRowCheck) {
		t.Errorf("a malformed registry file was tagged as a row-check failure, so "+
			"main.go would fail open on the very case #2141 exists to catch; got: %v", seedErr)
	}
}
