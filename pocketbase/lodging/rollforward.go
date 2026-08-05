package lodging

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// Columns copied verbatim onto the new season's row. `code` is here and is
// NEVER regenerated: a building renamed next season keeps its code, and the
// code is the only thing linking its years together.
//
// `id`, `created` and `updated` are excluded — the new row is a new record.
// `area` and `parent_unit` are excluded because they are relations that must be
// re-resolved into the target year, which the two later passes do.
// A DENY-LIST, deliberately, not an allow-list of carried columns.
//
// An allow-list silently drops any column added after it was written — the
// container work adds `default_combined`, and the next amenity someone adds
// would vanish from every season after the first with nothing to notice it.
// The failure is invisible: the new season's rows exist and simply hold the
// zero value. Enumerate what must NOT travel instead, which is a closed set.
//
//	id / created / updated — the new row is a new record
//	year                   — set explicitly to the target
//	area / parent_unit     — relations, re-resolved into the target year by the
//	                         two later passes
var notCarried = map[string]bool{
	"id": true, "created": true, "updated": true,
	"year": true, "area": true, "parent_unit": true,
}

// carriedFields returns every field on the collection that should travel to the
// next season, so a column added tomorrow rides along without editing this file.
func carriedFields(col *core.Collection) []string {
	out := make([]string, 0, len(col.Fields))
	for _, f := range col.Fields {
		if !notCarried[f.GetName()] {
			out = append(out, f.GetName())
		}
	}
	return out
}

// RollForwardPlan is what both the preview and the apply return, so the UI
// renders one shape and a dry run is indistinguishable from a real one except
// in its effect.
type RollForwardPlan struct {
	FromYear      int      `json:"from_year"`
	ToYear        int      `json:"to_year"`
	AreasToCreate int      `json:"areas_to_create"`
	UnitsToCreate int      `json:"units_to_create"`
	AreasPresent  int      `json:"areas_present"`
	UnitsPresent  int      `json:"units_present"`
	UnitCodes     []string `json:"unit_codes"`
	SkippedCodes  []string `json:"skipped_codes"`
}

// PreviewRollForward reports what ApplyRollForward would do, without writing.
func PreviewRollForward(app core.App, from, to int) (RollForwardPlan, error) {
	return rollForward(app, from, to, false)
}

// ApplyRollForward copies one season's lodging registry onto the next.
func ApplyRollForward(app core.App, from, to int) (RollForwardPlan, error) {
	return rollForward(app, from, to, true)
}

// rollForward copies one season's registry onto the next.
//
// THREE PASSES, and the order is load-bearing: areas, then units, then parent
// links. A unit's `area` must point at its own year's area row and its
// `parent_unit` at its own year's parent, so each pass needs the previous
// pass's records to already exist.
//
// IDEMPOTENT on (code, year). A code already present in the target year is left
// exactly as it is and reported in SkippedCodes — somebody added that building
// by hand before rolling forward, and their row is the authority.
func rollForward(app core.App, from, to int, write bool) (RollForwardPlan, error) {
	plan := RollForwardPlan{FromYear: from, ToYear: to}
	if from == to {
		return plan, fmt.Errorf("cannot roll year %d onto itself", from)
	}

	areaIDs, err := copyAreas(app, from, to, write, &plan)
	if err != nil {
		return plan, err
	}
	if err := copyUnits(app, from, to, write, areaIDs, &plan); err != nil {
		return plan, err
	}
	if write {
		if err := relinkParents(app, from, to); err != nil {
			return plan, err
		}
	}
	return plan, nil
}

// copyAreas returns the target year's area ids keyed by code, which copyUnits
// needs to point each unit at its own season's area.
func copyAreas(app core.App, from, to int, write bool, plan *RollForwardPlan) (map[string]string, error) {
	source, err := app.FindRecordsByFilter("lodging_areas", "year = {:y}", "", 0, 0,
		map[string]any{"y": from})
	if err != nil {
		return nil, fmt.Errorf("loading %d areas: %w", from, err)
	}

	ids := map[string]string{}
	col, err := app.FindCollectionByNameOrId("lodging_areas")
	if err != nil {
		return nil, fmt.Errorf("lodging_areas collection: %w", err)
	}

	for _, src := range source {
		code := src.GetString("code")
		existing, err := findByCodeAndYear(app, "lodging_areas", code, to)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			plan.AreasPresent++
			ids[code] = existing.Id
			continue
		}
		plan.AreasToCreate++
		if !write {
			continue
		}
		rec := core.NewRecord(col)
		for _, f := range carriedFields(col) {
			rec.Set(f, src.Get(f))
		}
		rec.Set("year", to)
		if err := app.Save(rec); err != nil {
			return nil, fmt.Errorf("creating area %q for %d: %w", code, to, err)
		}
		ids[code] = rec.Id
	}
	return ids, nil
}

// copyUnits creates the target year's units, resolving each one's `area` into
// the new year's area row. `parent_unit` is deliberately left unset here — a
// parent may sort after its child in the source year, so it is wired in a
// third pass (relinkParents) once every unit for the target year exists.
func copyUnits(app core.App, from, to int, write bool, areaIDs map[string]string, plan *RollForwardPlan) error {
	source, err := app.FindRecordsByFilter("lodging_units", "year = {:y}", "", 0, 0,
		map[string]any{"y": from})
	if err != nil {
		return fmt.Errorf("loading %d units: %w", from, err)
	}
	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		return fmt.Errorf("lodging_units collection: %w", err)
	}

	for _, src := range source {
		code := src.GetString("code")
		existing, err := findByCodeAndYear(app, "lodging_units", code, to)
		if err != nil {
			return err
		}
		if existing != nil {
			plan.UnitsPresent++
			plan.SkippedCodes = append(plan.SkippedCodes, code)
			continue
		}
		plan.UnitsToCreate++
		plan.UnitCodes = append(plan.UnitCodes, code)
		if !write {
			continue
		}

		rec := core.NewRecord(col)
		for _, f := range carriedFields(col) {
			rec.Set(f, src.Get(f))
		}
		rec.Set("year", to)

		// Resolve the area into the TARGET year. A source unit whose area was
		// somehow absent keeps no area rather than borrowing last year's row.
		if srcArea, err := app.FindRecordById("lodging_areas", src.GetString("area")); err == nil {
			if id, ok := areaIDs[srcArea.GetString("code")]; ok {
				rec.Set("area", id)
			}
		}
		if err := app.Save(rec); err != nil {
			return fmt.Errorf("creating unit %q for %d: %w", code, to, err)
		}
	}
	return nil
}

// relinkParents runs after every unit exists, because a parent may sort after
// its child and cannot be resolved during the creation pass.
func relinkParents(app core.App, from, to int) error {
	source, err := app.FindRecordsByFilter("lodging_units", "year = {:y}", "", 0, 0,
		map[string]any{"y": from})
	if err != nil {
		return fmt.Errorf("loading %d units to relink: %w", from, err)
	}
	for _, src := range source {
		parentID := src.GetString("parent_unit")
		if parentID == "" {
			continue
		}
		srcParent, err := app.FindRecordById("lodging_units", parentID)
		if err != nil {
			continue
		}
		child, err := findByCodeAndYear(app, "lodging_units", src.GetString("code"), to)
		if err != nil || child == nil || child.GetString("parent_unit") != "" {
			continue
		}
		newParent, err := findByCodeAndYear(app, "lodging_units", srcParent.GetString("code"), to)
		if err != nil || newParent == nil {
			continue
		}
		child.Set("parent_unit", newParent.Id)
		if err := app.Save(child); err != nil {
			return fmt.Errorf("linking parent of %q: %w", src.GetString("code"), err)
		}
	}
	return nil
}
