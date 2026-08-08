package lodging

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"
)

// registryFileName is the private registry data file, carried in the
// kindred-local repo and symlinked into config/ by
// scripts/setup/setup-local-config.sh.
const registryFileName = "lodging_registry.json"

// registryBasePath is the base for the relative candidate paths below.
// Overridden in tests.
var registryBasePath = "."

// registryAbsoluteRoots are the absolute directories searched before the
// working-directory-relative candidates. Overridden in tests.
//
// `/config` is where docker-compose.yml mounts the private config directory.
// The relative `./config` candidate below happens to resolve to the same place
// today, because the runtime image sets no WORKDIR and so runs from `/` — but
// relying on that coincidence means any future WORKDIR silently breaks the only
// candidate that fires, and main.go only warns. Naming it absolutely removes
// the dependency on the working directory entirely.
var registryAbsoluteRoots = []string{"/config", "/app/config"}

// registryDoc is the on-disk shape of config/lodging_registry.json.
//
// Areas, units and aliases reference each other by CODE, never by PocketBase
// id — the same durable-key discipline the rest of this codebase uses, and the
// only thing that lets the file survive a database rebuild.
type registryDoc struct {
	// Notes is camp-specific prose about the registry (naming history, units
	// that look missing but are not). It travels with the data rather than
	// with the code, because it names units and the repo is public. Unused by
	// the loader; present so the file can carry its own documentation.
	Notes   []string        `json:"_notes"`
	Areas   []registryArea  `json:"areas"`
	Units   []registryUnit  `json:"units"`
	Aliases []registryAlias `json:"aliases"`
}

type registryArea struct {
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	MapX      *float64 `json:"map_x"`
	MapY      *float64 `json:"map_y"`
	SortOrder *int     `json:"sort_order"`
}

type registryUnit struct {
	Area string   `json:"area"` // area code
	Code string   `json:"code"`
	Name string   `json:"name"`
	MapX *float64 `json:"map_x"`
	MapY *float64 `json:"map_y"`
	// Sleeps is null when never observed. PocketBase number columns are
	// `NUMERIC DEFAULT 0 NOT NULL`, so an unset value stores as 0 and
	// consumers read 0 as UNKNOWN, not "zero capacity".
	Sleeps         *int   `json:"sleeps"`
	Bathroom       string `json:"bathroom"`
	BathroomGroup  string `json:"bathroom_group"`
	ParentUnit     string `json:"parent_unit"` // unit code, or "" for a top-level row
	NearBathhouse  bool   `json:"near_bathhouse"`
	InventoryClass string `json:"inventory_class"`
	IsContainer    bool   `json:"is_container"`
	// DefaultCombined is the registry default draw level, meaningful on
	// CONTAINER rows only: true means "draw the board's card at this node and
	// stop descending" — the whole-house let.
	//
	// This is the ONLY route by which it reaches a fresh database. 1500000138's
	// backfill runs before SeedRegistry (main.go), so on a new worktree, a new
	// deployment or a rebuilt CD seed it UPDATEs an empty table and the loader
	// supplies the value instead. Absent means false, the pre-feature "draw the
	// children".
	DefaultCombined bool   `json:"default_combined"`
	Notes           string `json:"notes"`

	// Amenities. Absent in JSON means false, which for these is the same claim
	// the column made before the 2026 inventory: unknown, recorded as false.
	HasPower         bool `json:"has_power"`
	HasAC            bool `json:"has_ac"`
	HasFridge        bool `json:"has_fridge"`
	IsAccessible     bool `json:"is_accessible"`
	HasHeat          bool `json:"has_heat"`
	IsWeatherized    bool `json:"is_weatherized"`
	HasPlumbing      bool `json:"has_plumbing"`
	HasSpaceHeater   bool `json:"has_space_heater"`
	HasPackPlaySpace bool `json:"has_pack_play_space"`
	HasLivingRoom    bool `json:"has_living_room"`
	HasKitchen       bool `json:"has_kitchen"`
	HasLights        bool `json:"has_lights"`

	// These five refine an amenity above rather than restating it: HasTub
	// narrows the Bathroom select, HasKitchenette narrows HasKitchen,
	// HasSharedFridge narrows HasFridge. None can contradict its parent, so a
	// consumer reading only the parent stays correct. HasCrib is distinct from
	// HasPackPlaySpace — a camp-provided crib is not floor space for a family's
	// own pack-and-play, and families with babies ask about both.
	HasTub           bool `json:"has_tub"`
	HasKitchenette   bool `json:"has_kitchenette"`
	HasCrib          bool `json:"has_crib"`
	HasChangingTable bool `json:"has_changing_table"`
	HasSharedFridge  bool `json:"has_shared_fridge"`

	// HasRamp is "yes" | "no" | "partial", or "" for NOT ASSESSED. Deliberately
	// not a bool: most cabins were never checked, and a bool would record them
	// all as step-free-inaccessible.
	HasRamp string `json:"has_ramp"`

	// MaxBeds is total sleeping spots, NOT Sleeps. Sleeps is the staff
	// judgement for the session type and the two disagree on most units.
	MaxBeds *int `json:"max_beds"`

	// Beds is the bed inventory behind Sleeps, in the shape
	// frontend/src/types/beds.ts ships: [{"type": "queen", "count": 1}]. Nil
	// means UNKNOWN and is left unset rather than written as an empty list —
	// 11 units have a Master Housing row that names rooms without naming beds,
	// and [] would claim those rooms have none. Never a substitute for Sleeps:
	// real capacity depends on who can share a bed, which staff judge.
	Beds []registryBed `json:"beds"`
}

type registryBed struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type registryAlias struct {
	AliasString string   `json:"alias_string"`
	MemberUnits []string `json:"member_units"` // unit codes; 2+ denotes a merge
	// Null means unbounded. PocketBase stores that as 0, never NULL, which is
	// also what the (alias_string, valid_from_year) unique index sees.
	ValidFromYear *int `json:"valid_from_year"`
	ValidToYear   *int `json:"valid_to_year"`
}

// ErrRegistryRowCheck tags the one SeedRegistry failure that means "the
// loader could not tell whether there is anything at risk" rather than "the
// registry is broken": RegistryHasRows itself erroring out.
//
// main.go's boot gate keys on this to split SeedRegistry's two error sources
// into opposite boot treatments (issue #2141). A row-check failure fails OPEN
// — warn and boot — because taking the app down over a failure to READ the
// state compounds one problem with a second, less legible one, and it is the
// same call the season branch already makes. Every other error means a
// registry file that is present and genuinely unloadable, which fails the
// boot rather than coming up with an empty registry behind a warn line.
//
// A sentinel rather than error-string matching so the split survives any
// rewording of the messages below.
var ErrRegistryRowCheck = errors.New("lodging registry row check failed")

// SeedRegistry loads the private lodging registry into the database for one
// season.
//
// The year is a PARAMETER, not an environment read: registry.go stays free of
// ambient config, a test seeds any year directly, and the boot path has exactly
// one place where a bad season is handled.
//
// It is deliberately NOT a migration. `_migrations` keys on filename and
// applies once, so a migration that read an absent kindred-local file in CI
// would be recorded as applied and never re-run when the file later appeared —
// a silently empty registry. Running on every boot instead means the file
// appearing later still takes effect.
//
// Absent file is not an error: a clone without kindred-local boots with an
// empty registry and a log line, the same graceful degradation branding has.
//
// This is a BOOTSTRAP, not a per-season populator (design doc §4.2). It seeds
// only when the registry is empty across EVERY year; once any season has
// rows, it is a no-op regardless of the year it is called with. The
// create-if-absent key downstream is (code, year), so a loader that seeded
// "whatever season is current" would, on the first restart after a season
// flip, silently recreate the whole registry for the new year out of the
// stale bootstrap file: unconfirmed, with is_active forced true, and with
// every amenity correction, coordinate, rename and deactivation gone. It
// would also make the roll-forward (rollforward.go) permanently unreachable,
// since its preview would find every code already present and report
// nothing to carry forward. The deliberate file-to-database path for a
// season that already exists is apply_lodging_inventory.py --apply --year N,
// run by hand.
func SeedRegistry(app core.App, year int) error {
	hasRows, err := RegistryHasRows(app)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrRegistryRowCheck, err)
	}
	if hasRows {
		slog.Info("lodging registry already has rows for another season; "+
			"boot loader is a bootstrap and only seeds an empty registry, skipping",
			"year", year)
		return nil
	}

	for _, path := range registryCandidatePaths() {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		return seedRegistryFromFile(app, path, year)
	}

	slog.Info("lodging registry file not found; registry left as-is",
		"looked_for", registryFileName)
	return nil
}

// registryCandidatePaths lists every path SeedRegistry searches, in order.
// Shared with RegistryFilePresent so the two never drift: SeedRegistry decides
// whether to load, RegistryFilePresent decides whether an unreadable season
// is a misconfiguration worth failing boot over (main.go, issue #2054).
func registryCandidatePaths() []string {
	candidates := make([]string, 0, len(registryAbsoluteRoots)+2)
	for _, root := range registryAbsoluteRoots {
		candidates = append(candidates, filepath.Join(root, registryFileName)) // Docker
	}
	candidates = append(candidates,
		filepath.Join(registryBasePath, "config", registryFileName),       // from the repo root
		filepath.Join(registryBasePath, "..", "config", registryFileName), // from pocketbase/
	)
	return candidates
}

// RegistryFilePresent reports whether a private lodging registry file exists
// on any of the candidate paths SeedRegistry searches. It is presence-only —
// it does not read, parse, or validate the file — so main.go can tell "no
// private config, nothing to load" (must still boot) apart from "config is
// here and unreadable without a season" (a misconfigured deployment that
// would otherwise silently come up with an empty registry behind a single
// warn-level log line). See issue #2054.
func RegistryFilePresent() bool {
	for _, path := range registryCandidatePaths() {
		if _, err := os.Stat(path); err == nil {
			return true
		}
	}
	return false
}

// seedRegistryFromFile is CREATE-IF-ABSENT, not a full upsert.
//
// The registry is staff-editable in /manage/lodging — coordinates get
// corrected, cabins get confirmed. A loader that rewrote every field on boot
// would silently undo that on the next restart. Skipping rows that already
// exist also makes this an exact no-op on every database the seed migrations
// already populated, which is every database that exists today.
func seedRegistryFromFile(app core.App, path string, year int) error {
	data, err := os.ReadFile(path) //nolint:gosec // G304: path is from trusted local config
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			slog.Info("lodging registry file not found; registry left as-is", "path", path)
			return nil
		}
		return fmt.Errorf("reading lodging registry %s: %w", path, err)
	}

	var doc registryDoc
	if parseErr := json.Unmarshal(data, &doc); parseErr != nil {
		return fmt.Errorf("parsing lodging registry %s: %w", path, parseErr)
	}

	// Whole-file checks first, so a bad file is rejected having written
	// nothing. Doing this per-row mid-load would leave the registry half
	// applied, and the codes are also what the passes below assume are unique.
	if validErr := validateRegistry(&doc); validErr != nil {
		return fmt.Errorf("invalid lodging registry %s: %w", path, validErr)
	}

	// ALL FOUR PASSES IN ONE TRANSACTION, because the bootstrap gate above
	// makes a partial seed permanent rather than merely untidy.
	//
	// Create-if-absent used to make this self-healing: a seed that died halfway
	// was finished by the next boot, which created whatever was still missing.
	// SeedRegistry's any-season check ended that. The areas a failed run
	// committed are enough to make RegistryHasRows report true forever, so
	// every later boot logs "skipping" and the registry stays half-built with
	// nothing anywhere reporting it.
	//
	// The gate is right and is not what to loosen (design doc §4.2). Landing
	// all-or-nothing is what restores the retry: a failed bootstrap leaves an
	// empty registry, which is exactly the state the next boot will seed.
	var areasAdded, unitsAdded, aliasesAdded int
	if txErr := app.RunInTransaction(func(txApp core.App) error {
		areaIDs, areas, err := seedAreas(txApp, doc.Areas, year)
		if err != nil {
			return err
		}

		units, createdCodes, err := seedUnits(txApp, doc.Units, areaIDs, year)
		if err != nil {
			return err
		}

		// Second pass: wire parents now that every code has an id. Only rows
		// this run created are wired — a parent staff cleared deliberately must
		// stay cleared, same reason the field values above are left alone.
		if wireErr := wireUnitParents(txApp, doc.Units, createdCodes, year); wireErr != nil {
			return wireErr
		}

		aliases, err := seedAliases(txApp, doc.Aliases, year)
		if err != nil {
			return err
		}

		areasAdded, unitsAdded, aliasesAdded = areas, units, aliases
		return nil
	}); txErr != nil {
		return fmt.Errorf("seeding the lodging registry for %d: %w", year, txErr)
	}

	slog.Info("lodging registry loaded", "path", path,
		"areas_added", areasAdded, "units_added", unitsAdded, "aliases_added", aliasesAdded)
	return nil
}

// validateRegistry checks the file against itself: no duplicate keys, and every
// cross-reference resolvable within the file.
//
// The reference checks live here rather than mid-load because the loader's
// "row already exists -> skip" is how idempotency works, which leaves it unable
// to tell a re-run from a code duplicated inside one file. A duplicate would
// otherwise be dropped in silence — the one malformed input that did not fail
// loudly — while its parent_unit could still be applied to the row the first
// entry created, merging two entries into one row.
func validateRegistry(doc *registryDoc) error {
	areaCodes, err := validateAreaCodes(doc.Areas)
	if err != nil {
		return err
	}
	unitCodes, err := validateUnitCodes(doc.Units)
	if err != nil {
		return err
	}
	if err := validateUnitReferences(doc.Units, areaCodes, unitCodes); err != nil {
		return err
	}
	return validateAliases(doc.Aliases, unitCodes)
}

func validateAreaCodes(areas []registryArea) (map[string]bool, error) {
	codes := make(map[string]bool, len(areas))
	for _, a := range areas {
		if a.Code == "" {
			return nil, errors.New("an area has an empty code")
		}
		if codes[a.Code] {
			return nil, fmt.Errorf("area code %q appears more than once", a.Code)
		}
		codes[a.Code] = true
	}
	return codes, nil
}

func validateUnitCodes(units []registryUnit) (map[string]bool, error) {
	codes := make(map[string]bool, len(units))
	for i := range units {
		u := &units[i]
		if u.Code == "" {
			return nil, errors.New("a unit has an empty code")
		}
		if codes[u.Code] {
			return nil, fmt.Errorf("unit code %q appears more than once", u.Code)
		}
		codes[u.Code] = true
	}
	return codes, nil
}

// validateUnitReferences runs after the full code set is known, so a unit may
// name a parent declared later in the file.
func validateUnitReferences(units []registryUnit, areaCodes, unitCodes map[string]bool) error {
	for i := range units {
		u := &units[i]
		if !areaCodes[u.Area] {
			return fmt.Errorf("unit %q names area %q, which the registry file does not define", u.Code, u.Area)
		}
		if u.ParentUnit == u.Code {
			return fmt.Errorf("unit %q names itself as its parent", u.Code)
		}
		if u.ParentUnit != "" && !unitCodes[u.ParentUnit] {
			return fmt.Errorf("unit %q names parent %q, which the registry file does not define", u.Code, u.ParentUnit)
		}
	}
	return nil
}

// validateAliases keys duplicates on (alias_string, valid_from_year) — the pair
// the unique index keys on, with an unbounded window stored as 0. Two rows
// sharing a string with different windows is how a rename is recorded, and
// stays legal.
func validateAliases(aliases []registryAlias, unitCodes map[string]bool) error {
	type aliasKey struct {
		s string
		y int
	}
	seen := make(map[aliasKey]bool, len(aliases))
	for _, a := range aliases {
		if a.AliasString == "" {
			return errors.New("an alias has an empty alias_string")
		}
		fromYear := 0
		if a.ValidFromYear != nil {
			fromYear = *a.ValidFromYear
		}
		key := aliasKey{a.AliasString, fromYear}
		if seen[key] {
			return fmt.Errorf("alias %q with valid_from_year %d appears more than once", a.AliasString, fromYear)
		}
		seen[key] = true

		if len(a.MemberUnits) == 0 {
			return fmt.Errorf("alias %q has no member units", a.AliasString)
		}
		for _, code := range a.MemberUnits {
			if !unitCodes[code] {
				return fmt.Errorf("alias %q names unit %q, which the registry file does not define", a.AliasString, code)
			}
		}
	}
	return nil
}

func seedAreas(app core.App, areas []registryArea, year int) (ids map[string]string, added int, err error) {
	col, err := app.FindCollectionByNameOrId("lodging_areas")
	if err != nil {
		return nil, 0, fmt.Errorf("lodging_areas collection: %w", err)
	}

	ids = make(map[string]string, len(areas))
	for _, a := range areas {
		rec, err := findByCodeAndYear(app, "lodging_areas", a.Code, year)
		if err != nil {
			return nil, 0, err
		}
		if rec == nil {
			rec = core.NewRecord(col)
			rec.Set("code", a.Code)
			rec.Set("name", a.Name)
			setIfPresentFloat(rec, "map_x", a.MapX)
			setIfPresentFloat(rec, "map_y", a.MapY)
			setIfPresentInt(rec, "sort_order", a.SortOrder)
			rec.Set("year", year)
			if err := app.Save(rec); err != nil {
				return nil, 0, fmt.Errorf("saving lodging area %q: %w", a.Code, err)
			}
			added++
		}
		ids[a.Code] = rec.Id
	}
	return ids, added, nil
}

func seedUnits(
	app core.App, units []registryUnit, areaIDs map[string]string, year int,
) (added int, createdCodes map[string]bool, err error) {
	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		return 0, nil, fmt.Errorf("lodging_units collection: %w", err)
	}

	createdCodes = make(map[string]bool)
	// Indexed rather than ranged by value: registryUnit is wide enough that
	// copying one per iteration is a gocritic rangeValCopy finding.
	for i := range units {
		u := &units[i]
		rec, err := findByCodeAndYear(app, "lodging_units", u.Code, year)
		if err != nil {
			return 0, nil, err
		}
		if rec != nil {
			continue
		}

		// `area` is a REQUIRED relation, so an unknown code has to fail here
		// with the code in the message rather than as an opaque save error.
		areaID, ok := areaIDs[u.Area]
		if !ok {
			return 0, nil, fmt.Errorf("unit %q names area %q, which the registry file does not define", u.Code, u.Area)
		}

		rec = core.NewRecord(col)
		rec.Set("area", areaID)
		rec.Set("code", u.Code)
		rec.Set("name", u.Name)
		setIfPresentFloat(rec, "map_x", u.MapX)
		setIfPresentFloat(rec, "map_y", u.MapY)
		setIfPresentInt(rec, "sleeps", u.Sleeps)
		rec.Set("bathroom", u.Bathroom)
		rec.Set("bathroom_group", u.BathroomGroup)
		rec.Set("near_bathhouse", u.NearBathhouse)
		rec.Set("inventory_class", u.InventoryClass)
		rec.Set("is_container", u.IsContainer)
		rec.Set("default_combined", u.DefaultCombined)
		rec.Set("notes", u.Notes)
		rec.Set("has_power", u.HasPower)
		rec.Set("has_ac", u.HasAC)
		rec.Set("has_fridge", u.HasFridge)
		rec.Set("is_accessible", u.IsAccessible)
		rec.Set("has_heat", u.HasHeat)
		rec.Set("is_weatherized", u.IsWeatherized)
		rec.Set("has_plumbing", u.HasPlumbing)
		rec.Set("has_space_heater", u.HasSpaceHeater)
		rec.Set("has_pack_play_space", u.HasPackPlaySpace)
		rec.Set("has_living_room", u.HasLivingRoom)
		rec.Set("has_kitchen", u.HasKitchen)
		rec.Set("has_lights", u.HasLights)
		rec.Set("has_tub", u.HasTub)
		rec.Set("has_kitchenette", u.HasKitchenette)
		rec.Set("has_crib", u.HasCrib)
		rec.Set("has_changing_table", u.HasChangingTable)
		rec.Set("has_shared_fridge", u.HasSharedFridge)
		// Left unset when nil, so UNKNOWN reaches the database as null rather
		// than as an empty inventory. Matches has_ramp's blank handling above.
		if u.Beds != nil {
			rec.Set("beds", u.Beds)
		}
		// Left unset when blank, so "not assessed" reaches the database as an
		// empty select rather than a decision.
		if u.HasRamp != "" {
			rec.Set("has_ramp", u.HasRamp)
		}
		setIfPresentInt(rec, "max_beds", u.MaxBeds)
		rec.Set("is_active", true)
		// Every seeded value is a guess until staff confirm it against the
		// actual cabin, so nothing this loader writes may claim otherwise.
		rec.Set("is_confirmed", false)
		rec.Set("year", year)
		if err := app.Save(rec); err != nil {
			return 0, nil, fmt.Errorf("saving lodging unit %q: %w", u.Code, err)
		}
		added++
		createdCodes[u.Code] = true
	}
	return added, createdCodes, nil
}

// wireUnitParents runs after every unit exists, so a unit may name a parent
// declared later in the file.
//
// It wires a row when THIS run created either end of the link, and only over an
// empty parent_unit. Both halves matter:
//
//   - Gating on the child alone left a deleted-and-recreated container with
//     nothing in it. Deleting a container in /manage/lodging nulls its
//     children's parent_unit; the next boot recreates the container, having
//     thereby decided the row should exist, but the children were untouched
//     this run and stayed orphaned with no error to say so.
//   - Never overwriting a parent that is already set is what keeps this
//     create-if-absent rather than an upsert. A parent staff cleared while the
//     container still exists is a decision, not damage: neither end was created
//     this run, so nothing here touches it.
func wireUnitParents(app core.App, units []registryUnit, createdCodes map[string]bool, year int) error {
	// Indexed for the same reason as seedUnits above.
	for i := range units {
		u := &units[i]
		if u.ParentUnit == "" || (!createdCodes[u.Code] && !createdCodes[u.ParentUnit]) {
			continue
		}

		rec, err := findByCodeAndYear(app, "lodging_units", u.Code, year)
		if err != nil {
			return err
		}
		// validateRegistry proved both codes are in the file and seedUnits
		// created everything missing, so a nil here is not a bad file.
		if rec == nil || rec.GetString("parent_unit") != "" {
			continue
		}

		parent, err := findByCodeAndYear(app, "lodging_units", u.ParentUnit, year)
		if err != nil {
			return err
		}
		if parent == nil {
			return fmt.Errorf("unit %q names parent %q, which is in the file but missing from the database",
				u.Code, u.ParentUnit)
		}

		rec.Set("parent_unit", parent.Id)
		if err := app.Save(rec); err != nil {
			return fmt.Errorf("wiring parent of lodging unit %q: %w", u.Code, err)
		}
	}
	return nil
}

func seedAliases(app core.App, aliases []registryAlias, year int) (added int, err error) {
	col, err := app.FindCollectionByNameOrId("lodging_unit_aliases")
	if err != nil {
		return 0, fmt.Errorf("lodging_unit_aliases collection: %w", err)
	}

	for _, a := range aliases {
		// The unique index is (alias_string, valid_from_year), and an
		// unbounded window is stored as 0 rather than NULL — so idempotency
		// has to look for 0, not for null, or a re-run re-inserts and dies on
		// the index.
		fromYear := 0
		if a.ValidFromYear != nil {
			fromYear = *a.ValidFromYear
		}

		existing, err := findFirst(app, "lodging_unit_aliases",
			"alias_string = {:s} && valid_from_year = {:y}",
			map[string]any{"s": a.AliasString, "y": fromYear})
		if err != nil {
			return 0, err
		}
		if existing != nil {
			continue
		}

		memberIDs := make([]string, 0, len(a.MemberUnits))
		for _, code := range a.MemberUnits {
			unit, err := findByCodeAndYear(app, "lodging_units", code, year)
			if err != nil {
				return 0, err
			}
			// Saving a short member list would quietly turn a merge into a
			// smaller one, so a missing member stops the load. validateRegistry
			// already proved the code is in the file, so this is a database
			// that lost a row seedUnits created moments ago.
			if unit == nil {
				return 0, fmt.Errorf("alias %q names unit %q, which is in the file but missing from the database",
					a.AliasString, code)
			}
			memberIDs = append(memberIDs, unit.Id)
		}

		rec := core.NewRecord(col)
		rec.Set("alias_string", a.AliasString)
		rec.Set("member_units", memberIDs)
		setIfPresentInt(rec, "valid_from_year", a.ValidFromYear)
		setIfPresentInt(rec, "valid_to_year", a.ValidToYear)
		if err := app.Save(rec); err != nil {
			return 0, fmt.Errorf("saving lodging alias %q: %w", a.AliasString, err)
		}
		added++
	}
	return added, nil
}

// RegistryHasRows reports whether lodging_areas or lodging_units holds a row
// for ANY season. SeedRegistry uses this to decide whether it is a bootstrap
// or a no-op — a year-scoped check would miss the case this exists to catch,
// which is a season flip landing on a registry another season already
// populated.
//
// Exported so main.go's boot-decision gate (issue #2054, Half 2) can check
// it too: a deployment whose database already has rows has nothing at risk
// from an unresolvable season, since SeedRegistry would no-op regardless.
func RegistryHasRows(app core.App) (bool, error) {
	for _, collection := range []string{"lodging_areas", "lodging_units"} {
		recs, err := app.FindRecordsByFilter(collection, "", "", 1, 0)
		if err != nil {
			return false, fmt.Errorf("checking %s for existing rows: %w", collection, err)
		}
		if len(recs) > 0 {
			return true, nil
		}
	}
	return false, nil
}

// findByCodeAndYear looks up a row by its cross-year identity (code) scoped to
// one season. lodging_units and lodging_areas both carry (code, year) unique
// indexes (1500000141), so a code-only lookup could return another season's
// row.
func findByCodeAndYear(app core.App, collection, code string, year int) (*core.Record, error) {
	return findFirst(app, collection, "code = {:c} && year = {:y}",
		map[string]any{"c": code, "y": year})
}

// findFirst returns (nil, nil) when nothing matches, and a real error
// otherwise. PocketBase returns sql.ErrNoRows verbatim for "no match", so a
// bare `err != nil -> not found` would read a malformed filter or a locked
// database as "not seeded yet", insert a duplicate, and die on the unique
// index with the actual cause hidden.
func findFirst(
	app core.App, collection, filter string, params map[string]any,
) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter(collection, filter, params)
	if err == nil {
		return rec, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return nil, fmt.Errorf("querying %s: %w", collection, err)
}

func setIfPresentFloat(rec *core.Record, field string, v *float64) {
	if v != nil {
		rec.Set(field, *v)
	}
}

// setIfPresentInt leaves the field unset when v is nil, so PocketBase's
// `NUMERIC DEFAULT 0 NOT NULL` stores 0 — which is what "unknown" looks like
// in this schema.
func setIfPresentInt(rec *core.Record, field string, v *int) {
	if v != nil {
		rec.Set(field, *v)
	}
}
