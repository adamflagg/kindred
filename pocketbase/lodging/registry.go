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
	Sleeps            *int   `json:"sleeps"`
	Bathroom          string `json:"bathroom"`
	BathroomGroup     string `json:"bathroom_group"`
	ParentUnit        string `json:"parent_unit"` // unit code, or "" for a top-level row
	NearBathhouse     bool   `json:"near_bathhouse"`
	AllocationDefault string `json:"allocation_default"`
	IsContainer       bool   `json:"is_container"`
	Notes             string `json:"notes"`
}

type registryAlias struct {
	AliasString string   `json:"alias_string"`
	MemberUnits []string `json:"member_units"` // unit codes; 2+ denotes a merge
	// Null means unbounded. PocketBase stores that as 0, never NULL, which is
	// also what the (alias_string, valid_from_year) unique index sees.
	ValidFromYear *int `json:"valid_from_year"`
	ValidToYear   *int `json:"valid_to_year"`
}

// SeedRegistry loads the private lodging registry into the database.
//
// It is deliberately NOT a migration. `_migrations` keys on filename and
// applies once, so a migration that read an absent kindred-local file in CI
// would be recorded as applied and never re-run when the file later appeared —
// a silently empty registry. Running on every boot instead means the file
// appearing later still takes effect.
//
// Absent file is not an error: a clone without kindred-local boots with an
// empty registry and a log line, the same graceful degradation branding has.
func SeedRegistry(app core.App) error {
	candidates := []string{
		"/app/config/" + registryFileName,                                 // Docker production
		filepath.Join(registryBasePath, "config", registryFileName),       // from the repo root
		filepath.Join(registryBasePath, "..", "config", registryFileName), // from pocketbase/
	}

	for _, path := range candidates {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		return seedRegistryFromFile(app, path)
	}

	slog.Info("lodging registry file not found; registry left as-is",
		"looked_for", registryFileName)
	return nil
}

// seedRegistryFromFile is CREATE-IF-ABSENT, not a full upsert.
//
// The registry is staff-editable in /manage/lodging — coordinates get
// corrected, cabins get confirmed. A loader that rewrote every field on boot
// would silently undo that on the next restart. Skipping rows that already
// exist also makes this an exact no-op on every database the seed migrations
// already populated, which is every database that exists today.
func seedRegistryFromFile(app core.App, path string) error {
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

	areaIDs, areasAdded, err := seedAreas(app, doc.Areas)
	if err != nil {
		return err
	}

	unitsAdded, createdCodes, err := seedUnits(app, doc.Units, areaIDs)
	if err != nil {
		return err
	}

	// Second pass: wire parents now that every code has an id. Only rows this
	// run created are wired — a parent staff cleared deliberately must stay
	// cleared, same reason the field values above are left alone.
	if wireErr := wireUnitParents(app, doc.Units, createdCodes); wireErr != nil {
		return wireErr
	}

	aliasesAdded, err := seedAliases(app, doc.Aliases)
	if err != nil {
		return err
	}

	slog.Info("lodging registry loaded", "path", path,
		"areas_added", areasAdded, "units_added", unitsAdded, "aliases_added", aliasesAdded)
	return nil
}

func seedAreas(app core.App, areas []registryArea) (ids map[string]string, added int, err error) {
	col, err := app.FindCollectionByNameOrId("lodging_areas")
	if err != nil {
		return nil, 0, fmt.Errorf("lodging_areas collection: %w", err)
	}

	ids = make(map[string]string, len(areas))
	for _, a := range areas {
		rec, err := findByUniqueCode(app, "lodging_areas", a.Code)
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
	app core.App, units []registryUnit, areaIDs map[string]string,
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
		rec, err := findByUniqueCode(app, "lodging_units", u.Code)
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
		rec.Set("allocation_default", u.AllocationDefault)
		rec.Set("is_container", u.IsContainer)
		rec.Set("notes", u.Notes)
		rec.Set("is_active", true)
		// Every seeded value is a guess until staff confirm it against the
		// actual cabin, so nothing this loader writes may claim otherwise.
		rec.Set("is_confirmed", false)
		if err := app.Save(rec); err != nil {
			return 0, nil, fmt.Errorf("saving lodging unit %q: %w", u.Code, err)
		}
		added++
		createdCodes[u.Code] = true
	}
	return added, createdCodes, nil
}

func wireUnitParents(app core.App, units []registryUnit, createdCodes map[string]bool) error {
	// Indexed for the same reason as seedUnits above.
	for i := range units {
		u := &units[i]
		if u.ParentUnit == "" {
			continue
		}

		parent, err := findByUniqueCode(app, "lodging_units", u.ParentUnit)
		if err != nil {
			return err
		}
		if parent == nil {
			return fmt.Errorf("unit %q names parent %q, which the registry file does not define", u.Code, u.ParentUnit)
		}
		if !createdCodes[u.Code] {
			continue
		}

		rec, err := findByUniqueCode(app, "lodging_units", u.Code)
		if err != nil {
			return err
		}
		if rec == nil || rec.GetString("parent_unit") == parent.Id {
			continue
		}
		rec.Set("parent_unit", parent.Id)
		if err := app.Save(rec); err != nil {
			return fmt.Errorf("wiring parent of lodging unit %q: %w", u.Code, err)
		}
	}
	return nil
}

func seedAliases(app core.App, aliases []registryAlias) (added int, err error) {
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
			unit, err := findByUniqueCode(app, "lodging_units", code)
			if err != nil {
				return 0, err
			}
			// Saving a short member list would quietly turn a merge into a
			// smaller one, so an unknown code stops the load.
			if unit == nil {
				return 0, fmt.Errorf("alias %q names unit %q, which the registry file does not define", a.AliasString, code)
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

func findByUniqueCode(app core.App, collection, code string) (*core.Record, error) {
	return findFirst(app, collection, "code = {:c}", map[string]any{"c": code})
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
