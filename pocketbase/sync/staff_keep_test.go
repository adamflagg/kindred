package sync

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// The tests in this file pin owner ruling OD-05 = B (PM-7 = A): "we want to prevent staff from
// being removed after they're fired even during current season so we have the record and can
// look back at metrics." The staff, staff_applications, staff_vehicle_info and staff_skills syncs
// never delete a row, in any season or run: a row CampMinder stops returning keeps its last
// values.

// TestStaffSyncsHaveNoDeletePath reads the four staff sync files and fails on any call that can
// delete a row -- App.Delete, or any of the orphan sweeps. A structural pin, because staff.go's
// sweep sits behind a CampMinder fetch no test can fake, and because the point is that no later
// change brings a sweep back to these files.
func TestStaffSyncsHaveNoDeletePath(t *testing.T) {
	t.Parallel()
	banned := map[string]bool{
		"Delete": true, "DeleteOrphans": true, "DeleteOrphansGuarded": true,
		"DeleteOrphansFromPreloaded": true, "deleteOrphans": true,
	}
	for _, file := range []string{"staff.go", "staff_applications.go", "staff_vehicle_info.go", "staff_skills.go"} {
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, file, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", file, err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if call, ok := n.(*ast.CallExpr); ok {
				if sel, ok := call.Fun.(*ast.SelectorExpr); ok && banned[sel.Sel.Name] {
					t.Errorf("%s: %s calls %s -- the staff syncs must never delete a row (OD-05 = B)",
						file, fset.Position(call.Pos()), sel.Sel.Name)
				}
			}
			if fn, ok := n.(*ast.FuncDecl); ok && strings.Contains(strings.ToLower(fn.Name.Name), "orphan") {
				t.Errorf("%s: %s declares %s -- a staff sync has no orphan sweep (OD-05 = B)",
					file, fset.Position(fn.Pos()), fn.Name.Name)
			}
			return true
		})
	}
}

// TestStaffVehicleInfoKeepsARowCampMinderStoppedReturning: a staff member's vehicle info that
// this run no longer finds stays, with its last values.
func TestStaffVehicleInfoKeepsARowCampMinderStoppedReturning(t *testing.T) {
	t.Parallel()
	app := newStaffVehicleTestApp(t)
	seedSVI(t, app, 2101, 2026, true, map[string]string{"SVI-make of vehicle": "Toyota"})
	seedSVI(t, app, 2102, 2026, true, nil) // fired: no answers this run
	saveRecord(t, app, "staff_vehicle_info", map[string]any{
		"person_id": 2102, "year": 2026, "vehicle_make": "Honda"})

	s := NewStaffVehicleInfoSync(app)
	s.Year = 2026
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if s.Stats.Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0", s.Stats.Deleted)
	}
	kept, err := app.FindFirstRecordByFilter("staff_vehicle_info", "person_id = 2102 && year = 2026")
	if err != nil {
		t.Fatalf("the fired staff member's vehicle info is gone: %v", err)
	}
	if got := kept.GetString("vehicle_make"); got != "Honda" {
		t.Errorf("vehicle_make = %q, want the last value %q", got, "Honda")
	}
}

// TestStaffApplicationsKeepsARowCampMinderStoppedReturning: a staff member's application that
// this run no longer finds stays, with its last values.
func TestStaffApplicationsKeepsARowCampMinderStoppedReturning(t *testing.T) {
	t.Parallel()
	app := newStaffApplicationsSyncTestApp(t)
	seedStaffApp(t, app, 4101, 2026, true, map[string]string{"App-Why work at camp again?": "friends"})
	seedStaffApp(t, app, 4102, 2026, true, nil) // fired: no answers this run
	saveRecord(t, app, "staff_applications", map[string]any{
		"person_id": 4102, "year": 2026, "why_work_again": "the lake"})

	s := NewStaffApplicationsSync(app)
	s.Year = 2026
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if s.Stats.Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0", s.Stats.Deleted)
	}
	kept, err := app.FindFirstRecordByFilter("staff_applications", "person_id = 4102 && year = 2026")
	if err != nil {
		t.Fatalf("the fired staff member's application is gone: %v", err)
	}
	if got := kept.GetString("why_work_again"); got != "the lake" {
		t.Errorf("why_work_again = %q, want the last value %q", got, "the lake")
	}
}
