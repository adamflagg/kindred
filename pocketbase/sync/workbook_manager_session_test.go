package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The workbook registry's SESSION dimension. kindred#2433.
//
// Every other test in workbook_manager_test.go skips, because tests.NewTestApp()
// carries no sheets_workbooks collection -- which is why the collapse this file
// pins was reachable in the first place. The fixture below mirrors migration
// 1500000165, unique index included, so a save that the database would reject
// fails here rather than in production.

// newWorkbookTestApp returns an app carrying sheets_workbooks as
// 1500000165 leaves it.
func newWorkbookTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	workbooks := core.NewBaseCollection("sheets_workbooks")
	workbooks.Fields.Add(&core.TextField{Name: "spreadsheet_id"})
	workbooks.Fields.Add(&core.SelectField{
		Name: "workbook_type", MaxSelect: 1,
		Values: []string{"globals", "year", "fc_roster"},
	})
	workbooks.Fields.Add(&core.NumberField{Name: "year", OnlyInt: true})
	// Optional and defaulting to 0, which reads as "not session-scoped" -- the
	// same convention year = 0 already uses for the globals workbook.
	workbooks.Fields.Add(&core.NumberField{Name: "session_cm_id", OnlyInt: true})
	workbooks.Fields.Add(&core.TextField{Name: "title"})
	workbooks.Fields.Add(&core.TextField{Name: "url"})
	workbooks.Fields.Add(&core.NumberField{Name: "tab_count", OnlyInt: true})
	workbooks.Fields.Add(&core.NumberField{Name: "total_records", OnlyInt: true})
	workbooks.Fields.Add(&core.SelectField{
		Name: "status", MaxSelect: 1, Values: []string{"ok", "error", "syncing"},
	})
	workbooks.Fields.Add(&core.TextField{Name: "error_message"})
	workbooks.Fields.Add(&core.TextField{Name: "last_sync"})
	// The re-keyed index from 1500000165. Without it this file would only prove
	// the ORM lookup agrees with itself, and a divergence between the existence
	// check and the real constraint would pass here and fail in production.
	workbooks.AddIndex("idx_sheets_workbooks_type_year", true,
		"workbook_type, year, session_cm_id", "")
	if err := app.Save(workbooks); err != nil {
		t.Fatalf("save sheets_workbooks: %v", err)
	}
	return app
}

func rosterWorkbook(sessionCMID int, spreadsheetID string) *WorkbookRecord {
	return &WorkbookRecord{
		SpreadsheetID: spreadsheetID,
		WorkbookType:  workbookTypeFCRoster,
		Year:          2026,
		SessionCMID:   sessionCMID,
		Title:         "Weekend Roster",
		URL:           "https://docs.google.com/spreadsheets/d/" + spreadsheetID + "/edit",
		Status:        "ok",
	}
}

// TestSaveWorkbookRecordKeepsRosterWorkbooksApartBySession is the trap this
// dimension exists for.
//
// GetWorkbookByType filters (workbook_type, year) with limit 1, and
// SaveWorkbookRecord uses it as its existence check. Copying that for
// fc_roster makes the SECOND weekend of a season match the FIRST weekend's row,
// take the UPDATE branch, and silently overwrite its spreadsheet_id -- collapsing
// all eight of 2026's enrolled weekends into one workbook. The unique index does
// NOT save you: the ORM check short-circuits ahead of it.
func TestSaveWorkbookRecordKeepsRosterWorkbooksApartBySession(t *testing.T) {
	t.Parallel()
	app := newWorkbookTestApp(t)
	manager := NewWorkbookManager(app, NewMockSheetsWriter())
	ctx := context.Background()

	first, err := manager.SaveWorkbookRecord(ctx, rosterWorkbook(1309515, "sheet-fc2"))
	if err != nil {
		t.Fatalf("save first roster workbook: %v", err)
	}
	second, err := manager.SaveWorkbookRecord(ctx, rosterWorkbook(1309519, "sheet-fc6"))
	if err != nil {
		t.Fatalf("save second roster workbook: %v", err)
	}

	if first.ID == second.ID {
		t.Fatalf("both weekends saved onto record %s -- the session dimension is not in the key", first.ID)
	}

	all, err := manager.ListAllWorkbooks(ctx)
	if err != nil {
		t.Fatalf("ListAllWorkbooks: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("stored %d workbooks, want 2: %+v", len(all), all)
	}

	got, err := manager.GetWorkbookForSession(ctx, workbookTypeFCRoster, 2026, 1309519)
	if err != nil {
		t.Fatalf("GetWorkbookForSession: %v", err)
	}
	if got == nil || got.SpreadsheetID != "sheet-fc6" {
		t.Fatalf("lookup for weekend 1309519 returned %+v, want sheet-fc6", got)
	}
	if got.SessionCMID != 1309519 {
		t.Errorf("SessionCMID = %d, want 1309519 -- the column is not round-tripping", got.SessionCMID)
	}
}

// TestSaveWorkbookRecordUpdatesTheSameSessionInPlace keeps the second export of
// ONE weekend on the row the first export created, rather than colliding with
// the unique index.
func TestSaveWorkbookRecordUpdatesTheSameSessionInPlace(t *testing.T) {
	t.Parallel()
	app := newWorkbookTestApp(t)
	manager := NewWorkbookManager(app, NewMockSheetsWriter())
	ctx := context.Background()

	first, err := manager.SaveWorkbookRecord(ctx, rosterWorkbook(1309515, "sheet-fc2"))
	if err != nil {
		t.Fatalf("first save: %v", err)
	}

	again := rosterWorkbook(1309515, "sheet-fc2")
	again.TabCount = 3
	second, err := manager.SaveWorkbookRecord(ctx, again)
	if err != nil {
		t.Fatalf("second save: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("second export created record %s, want an update of %s", second.ID, first.ID)
	}

	all, err := manager.ListAllWorkbooks(ctx)
	if err != nil {
		t.Fatalf("ListAllWorkbooks: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("stored %d workbooks, want 1", len(all))
	}
	if all[0].TabCount != 3 {
		t.Errorf("TabCount = %d, want 3", all[0].TabCount)
	}
}

// TestGetWorkbookByTypeIgnoresSessionScopedRows keeps the data export's own
// lookups working unchanged once roster rows share their year. Both existing
// callers pass globals/year, whose rows carry session_cm_id 0.
func TestGetWorkbookByTypeIgnoresSessionScopedRows(t *testing.T) {
	t.Parallel()
	app := newWorkbookTestApp(t)
	manager := NewWorkbookManager(app, NewMockSheetsWriter())
	ctx := context.Background()

	if _, err := manager.SaveWorkbookRecord(ctx, rosterWorkbook(1309515, "sheet-fc2")); err != nil {
		t.Fatalf("save roster workbook: %v", err)
	}
	if _, err := manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "sheet-year", WorkbookType: "year", Year: 2026,
		Title: "CM Data - 2026", Status: "ok",
	}); err != nil {
		t.Fatalf("save year workbook: %v", err)
	}

	got, err := manager.GetWorkbookByType(ctx, "year", 2026)
	if err != nil {
		t.Fatalf("GetWorkbookByType: %v", err)
	}
	if got == nil || got.SpreadsheetID != "sheet-year" {
		t.Fatalf("GetWorkbookByType returned %+v, want sheet-year", got)
	}
}

// TestGetWorkbookForSessionReturnsNilWhenAbsent pins the not-found contract the
// export's find-or-create branch depends on.
func TestGetWorkbookForSessionReturnsNilWhenAbsent(t *testing.T) {
	t.Parallel()
	manager := NewWorkbookManager(newWorkbookTestApp(t), NewMockSheetsWriter())

	got, err := manager.GetWorkbookForSession(context.Background(), workbookTypeFCRoster, 2026, 1309515)
	if err != nil {
		t.Fatalf("GetWorkbookForSession: %v", err)
	}
	if got != nil {
		t.Errorf("got %+v, want nil for a session with no workbook", got)
	}
}

// TestBuildIndexSheetDataOmitsRosterWorkbooks keeps family contact workbooks out
// of the Exports folder's index.
//
// The Index sheet lives in the GLOBALS workbook, in the Exports folder, whose
// audience is deliberately wider than the roster folder's -- that per-folder
// split IS the privacy control (design §2). Listing a roster workbook's title
// and a clickable link there would publish the existence, the weekend name and
// the URL of a workbook full of family contact details to that wider audience.
// Every roster row also renders as its year, so eight 2026 weekends would arrive
// as eight rows all labeled 2026.
func TestBuildIndexSheetDataOmitsRosterWorkbooks(t *testing.T) {
	t.Parallel()
	data := BuildIndexSheetData([]WorkbookRecord{
		{WorkbookType: workbookTypeGlobals, Title: "CM Data - Globals", URL: "u1"},
		{WorkbookType: "year", Year: 2026, Title: "CM Data - 2026", URL: "u2"},
		{WorkbookType: workbookTypeFCRoster, Year: 2026, SessionCMID: 1309515,
			Title: "Weekend Roster", URL: "u3"},
	})

	// One header row plus the two data workbooks.
	if len(data) != 3 {
		t.Fatalf("index has %d rows, want 3 (header + globals + year): %v", len(data), data)
	}
	for _, row := range data {
		for _, cell := range row {
			if s, ok := cell.(string); ok && (s == "Weekend Roster" || s == `=HYPERLINK("u3","Open")`) {
				t.Errorf("index carries a roster workbook: %v", row)
			}
		}
	}
}
