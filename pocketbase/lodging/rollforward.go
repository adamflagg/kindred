package lodging

import (
	"database/sql"
	"errors"
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
//	is_confirmed           — asserts a human physically walked THIS season's
//	                         cabin (docs/reference/lodging-registry.md:377), not
//	                         a fact that outlives the season it was checked in.
//	                         Carrying it would let a roll-forward -- including a
//	                         BACKWARD one onto a season nobody has walked -- stamp
//	                         is_confirmed = true on a row nobody confirmed
//	                         (kindred#2392).
var notCarried = map[string]bool{
	"id": true, "created": true, "updated": true,
	"year": true, "area": true, "parent_unit": true,
	"is_confirmed": true,
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

// newRollForwardPlan initializes both slice fields to empty (non-nil) slices,
// not just FromYear/ToYear. UnitCodes and SkippedCodes are only ever grown by
// append, so a source year that copies or skips nothing never runs either
// append, and a zero-value `[]string` field stays nil. encoding/json marshals
// a nil slice as `null`, not `[]`, which crashes the frontend's RollForwardPlan
// type -- it declares both fields as non-nullable string[]. Every construction
// site must go through here, including the early error returns, so nothing on
// this type can ever reach json.Marshal holding a nil slice.
func newRollForwardPlan(from, to int) RollForwardPlan {
	return RollForwardPlan{
		FromYear:     from,
		ToYear:       to,
		UnitCodes:    []string{},
		SkippedCodes: []string{},
	}
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
//
// ATOMIC, and idempotency is NOT a substitute for it. The tempting reading is
// that a mid-run failure needs only a second click, since the second run
// creates whatever is missing — but the two properties interact badly, in the
// one direction that matters:
//
//	relinkParents wires only the codes copyUnits created THIS run
//	(plan.UnitCodes), because a row already in the target year is a hand-added
//	one whose cleared parent must be respected. A unit committed by a FAILED
//	run is indistinguishable from that: the retry finds it, counts it into
//	UnitsPresent, reports it in SkippedCodes, and therefore never puts it in
//	plan.UnitCodes. Its parent is never wired, by that run or any later one.
//
// So a partial apply is permanent, silent, and unfixable by the control that
// exists to fix it — the containers simply have nothing in them. Loosening the
// relink filter would trade this for the hand-added-row bug the filter exists
// to prevent (TestApplyRollForwardDoesNotRelinkAHandAddedStandaloneUnit); the
// transaction is what lets both hold at once.
//
// The plan is accumulated inside the closure and published only on commit, so
// a rolled-back attempt cannot return counts for rows that no longer exist.
func rollForward(app core.App, from, to int, write bool) (RollForwardPlan, error) {
	if from == to {
		return newRollForwardPlan(from, to),
			fmt.Errorf("cannot roll year %d onto itself", from)
	}

	// A preview writes nothing, so it has nothing to roll back. The passes fill
	// `plan` through the pointer, so the call is sequenced before the return
	// rather than sharing a return statement with the value it mutates.
	if !write {
		plan := newRollForwardPlan(from, to)
		err := rollForwardPasses(app, from, to, false, &plan)
		return plan, err
	}

	var committed RollForwardPlan
	if err := app.RunInTransaction(func(txApp core.App) error {
		plan := newRollForwardPlan(from, to)
		if err := rollForwardPasses(txApp, from, to, true, &plan); err != nil {
			return err
		}
		committed = plan
		return nil
	}); err != nil {
		return newRollForwardPlan(from, to),
			fmt.Errorf("rolling %d forward to %d: %w", from, to, err)
	}
	return committed, nil
}

// rollForwardPasses runs the three passes against whichever app it is handed —
// the transaction's inside ApplyRollForward, the plain one for a preview.
func rollForwardPasses(app core.App, from, to int, write bool, plan *RollForwardPlan) error {
	areaIDs, err := copyAreas(app, from, to, write, plan)
	if err != nil {
		return err
	}
	if err := copyUnits(app, from, to, write, areaIDs, plan); err != nil {
		return err
	}
	if write {
		return relinkParents(app, from, to, plan.UnitCodes)
	}
	return nil
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

		// Resolve the area into the TARGET year, never borrowing last year's row.
		//
		// An unresolvable area — the source row's area is gone, or its code has
		// no row in the target year — leaves `area` unset, and `area` is a
		// REQUIRED relation (1500000116). So this does not ship a unit without
		// an area; the app.Save below fails validation and, now that the passes
		// run in one transaction, aborts the roll-forward having written
		// nothing. That save error is wrapped with the unit code, which is the
		// only thing that makes the offending row findable.
		//
		// A REAL lookup failure (a locked database, say) must still not read the
		// same way as "absent", or a transient fault becomes a silent data
		// decision rather than a loud stop.
		srcArea, err := app.FindRecordById("lodging_areas", src.GetString("area"))
		switch {
		case err == nil:
			if id, ok := areaIDs[srcArea.GetString("code")]; ok {
				rec.Set("area", id)
			}
		case errors.Is(err, sql.ErrNoRows):
			// Absent source area; `area` stays unset and the save below refuses it.
		default:
			return fmt.Errorf("resolving area for unit %q: %w", code, err)
		}
		if err := app.Save(rec); err != nil {
			return fmt.Errorf("creating unit %q for %d: %w", code, to, err)
		}
	}
	return nil
}

// relinkParents runs after every unit exists, because a parent may sort after
// its child and cannot be resolved during the creation pass.
//
// createdCodes is the set copyUnits actually created THIS run (plan.UnitCodes)
// — not every code in the source year. A code copyUnits skipped is a row
// someone hand-added to the target year already, reported in SkippedCodes and
// left untouched as the authority; relinking it would silently attach last
// year's parent to a row that may have been split out as standalone on
// purpose. Without this filter, "left untouched" was true for every OTHER
// field but not for parent_unit, which this pass would set regardless of who
// created the row.
func relinkParents(app core.App, from, to int, createdCodes []string) error {
	created := make(map[string]bool, len(createdCodes))
	for _, code := range createdCodes {
		created[code] = true
	}

	source, err := app.FindRecordsByFilter("lodging_units", "year = {:y}", "", 0, 0,
		map[string]any{"y": from})
	if err != nil {
		return fmt.Errorf("loading %d units to relink: %w", from, err)
	}
	for _, src := range source {
		code := src.GetString("code")
		if !created[code] {
			continue
		}
		parentID := src.GetString("parent_unit")
		if parentID == "" {
			continue
		}
		srcParent, err := app.FindRecordById("lodging_units", parentID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue // stale parent reference on the source row; nothing to relink
			}
			return fmt.Errorf("resolving parent %q of %q: %w", parentID, code, err)
		}
		child, err := findByCodeAndYear(app, "lodging_units", code, to)
		if err != nil {
			return fmt.Errorf("resolving %q in %d for relink: %w", code, to, err)
		}
		if child == nil || child.GetString("parent_unit") != "" {
			continue
		}
		newParentCode := srcParent.GetString("code")
		newParent, err := findByCodeAndYear(app, "lodging_units", newParentCode, to)
		if err != nil {
			return fmt.Errorf("resolving parent %q in %d for relink: %w", newParentCode, to, err)
		}
		if newParent == nil {
			continue
		}
		child.Set("parent_unit", newParent.Id)
		if err := app.Save(child); err != nil {
			return fmt.Errorf("linking parent of %q: %w", code, err)
		}
	}
	return nil
}
