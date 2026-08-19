package sync

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The export orchestration: resolving the weekend's workbook in Drive, appending
// a dated tab, and recording the result. kindred#2433.
//
// Google is behind two seams -- MockSheetsWriter for Sheets and mockRosterDrive
// for Drive -- so every path here is asserted without a network call.

// mockRosterDrive records what the exporter asked Drive to do.
type mockRosterDrive struct {
	folderID string

	folders     map[string]string // "parent/name" -> folder id
	spreadsheet map[string]string // "folder/title" -> spreadsheet id

	CreatedFolders     []string
	CreatedSpreadsheet []string
	Searched           []string
	nextID             int

	CreateErr error
}

func newMockRosterDrive() *mockRosterDrive {
	return &mockRosterDrive{
		folderID:    "roster-folder",
		folders:     map[string]string{},
		spreadsheet: map[string]string{},
	}
}

func (d *mockRosterDrive) RosterFolderID() string { return d.folderID }

func (d *mockRosterDrive) FindOrCreateFolder(_ context.Context, parentID, name string) (string, error) {
	key := parentID + "/" + name
	if id, ok := d.folders[key]; ok {
		return id, nil
	}
	d.nextID++
	id := fmt.Sprintf("folder-%d", d.nextID)
	d.folders[key] = id
	d.CreatedFolders = append(d.CreatedFolders, key)
	return id, nil
}

func (d *mockRosterDrive) FindSpreadsheetInFolder(_ context.Context, folderID, name string) (string, error) {
	key := folderID + "/" + name
	d.Searched = append(d.Searched, key)
	return d.spreadsheet[key], nil
}

func (d *mockRosterDrive) CreateSpreadsheetInFolder(_ context.Context, folderID, title string) (string, error) {
	if d.CreateErr != nil {
		return "", d.CreateErr
	}
	d.nextID++
	id := fmt.Sprintf("sheet-%d", d.nextID)
	d.spreadsheet[folderID+"/"+title] = id
	d.CreatedSpreadsheet = append(d.CreatedSpreadsheet, title)
	return id, nil
}

// testRosterTab is the tab name the harness's fixed instant renders to.
const testRosterTab = "Aug 19, 2026 3:04 PM"

// exportHarness wires a roster fixture to the two mocked Google seams.
type exportHarness struct {
	t      *testing.T
	app    core.App
	writer *MockSheetsWriter
	drive  *mockRosterDrive
	at     time.Time
}

func newExportHarness(t *testing.T) *exportHarness {
	t.Helper()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{
		CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02", NormalizedCity: "Berkeley, CA",
	})
	f.addAdult(household, &rosterTestAdult{Number: 1, Name: "Sarah Johnson", Email: "sarah@example.com"})

	// sheets_workbooks does not exist on the sync fixture app, so the harness
	// adds it here, mirroring migration 1500000165.
	workbooks := core.NewBaseCollection("sheets_workbooks")
	workbooks.Fields.Add(&core.TextField{Name: "spreadsheet_id"})
	workbooks.Fields.Add(&core.SelectField{
		Name: "workbook_type", MaxSelect: 1, Values: []string{"globals", "year", "fc_roster"},
	})
	workbooks.Fields.Add(&core.NumberField{Name: "year", OnlyInt: true})
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
	workbooks.AddIndex("idx_sheets_workbooks_type_year", true,
		"workbook_type, year, session_cm_id", "")
	if err := f.app.Save(workbooks); err != nil {
		t.Fatalf("save sheets_workbooks: %v", err)
	}

	return &exportHarness{
		t: t, app: f.app,
		writer: NewMockSheetsWriter(),
		drive:  newMockRosterDrive(),
		// Stated in CAMP-LOCAL time, because that is what the tab name renders
		// in. Writing this as a UTC wall clock would make every tab-name
		// assertion below depend on the offset, which is the bug the export's
		// campLocation() conversion exists to prevent.
		at: time.Date(2026, time.August, 19, 15, 4, 0, 0, testCampLocation(t)),
	}
}

// testCampLocation is Pacific, loaded explicitly rather than through
// campLocation(), so these tests do not depend on the machine's TZ.
func testCampLocation(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load America/Los_Angeles: %v", err)
	}
	return loc
}

func (h *exportHarness) exporter() *RosterExporter {
	return NewRosterExporter(h.app, h.writer, h.drive, func() time.Time { return h.at })
}

func (h *exportHarness) export() (*RosterExportResult, error) {
	h.t.Helper()
	return h.exporter().Export(context.Background(), rosterYear, cmIDFamilyCamp1)
}

func (h *exportHarness) mustExport() *RosterExportResult {
	h.t.Helper()
	result, err := h.export()
	if err != nil {
		h.t.Fatalf("Export: %v", err)
	}
	return result
}

// TestRosterExportCreatesTheWorkbookOnFirstRun pins the whole first-export path:
// the {year} folder beneath the configured roster folder, a workbook named for
// the weekend, one dated tab, values, formatting, and a registry row.
func TestRosterExportCreatesTheWorkbookOnFirstRun(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	result := h.mustExport()

	if got := h.drive.CreatedFolders; len(got) != 1 || got[0] != "roster-folder/2026" {
		t.Errorf("created folders = %v, want exactly [roster-folder/2026]", got)
	}
	wantTitle := "(DEV) Family Camp 2: Keshet LGBTQ Weekend 2026 Roster"
	if got := h.drive.CreatedSpreadsheet; len(got) != 1 || got[0] != wantTitle {
		t.Errorf("created spreadsheets = %v, want exactly [%q]", got, wantTitle)
	}

	if result.TabName != testRosterTab {
		t.Errorf("tab name = %q", result.TabName)
	}
	if result.SpreadsheetID == "" || result.URL == "" {
		t.Errorf("result = %+v, want a spreadsheet id and url", result)
	}
	if result.HouseholdCount != 1 || result.CamperCount != 1 || result.AdultCount != 1 {
		t.Errorf("counts = %+v, want 1 household, 1 camper, 1 adult", result)
	}

	rows := h.writer.WrittenData[result.TabName]
	if len(rows) != rosterFirstDataRow+2 {
		t.Fatalf("wrote %d rows, want %d", len(rows), rosterFirstDataRow+2)
	}
	if h.writer.ApplyFormattingCalls != 1 {
		t.Errorf("ApplyFormatting called %d times, want exactly 1 -- one batch per tab",
			h.writer.ApplyFormattingCalls)
	}

	// The registry row is what stops the next export creating a second workbook.
	manager := NewWorkbookManager(h.app, h.writer)
	stored, err := manager.GetWorkbookForSession(
		context.Background(), workbookTypeFCRoster, rosterYear, cmIDFamilyCamp1)
	if err != nil {
		t.Fatalf("GetWorkbookForSession: %v", err)
	}
	if stored == nil || stored.SpreadsheetID != result.SpreadsheetID {
		t.Fatalf("stored workbook = %+v, want spreadsheet %s", stored, result.SpreadsheetID)
	}
}

// TestRosterExportAppendsToTheSameWorkbook pins the append contract: a second
// export reuses the weekend's workbook, adds a tab, and NEVER prunes or
// overwrites the earlier one -- staff hand-edit every tab.
func TestRosterExportAppendsToTheSameWorkbook(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	first := h.mustExport()

	h.at = h.at.Add(24 * time.Hour)
	second := h.mustExport()

	if first.SpreadsheetID != second.SpreadsheetID {
		t.Errorf("second export used workbook %s, want %s", second.SpreadsheetID, first.SpreadsheetID)
	}
	if len(h.drive.CreatedSpreadsheet) != 1 {
		t.Errorf("created %d workbooks, want 1", len(h.drive.CreatedSpreadsheet))
	}
	if first.TabName == second.TabName {
		t.Fatalf("both exports wrote tab %q", first.TabName)
	}
	if !h.writer.ExistingTabs[first.TabName] {
		t.Errorf("first tab %q no longer exists -- tabs are never pruned", first.TabName)
	}
	if len(h.writer.ClearedTabs) != 0 {
		t.Errorf("cleared %v -- an appended tab is new, and clearing would erase hand edits",
			h.writer.ClearedTabs)
	}
	if len(h.writer.DeletedSheets) > 0 && slices.Contains(h.writer.DeletedSheets, first.TabName) {
		t.Errorf("deleted the earlier tab %q", first.TabName)
	}
}

// TestRosterExportSuffixesATabNameCollision covers two exports inside one minute.
func TestRosterExportSuffixesATabNameCollision(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	first := h.mustExport()
	second := h.mustExport()

	if second.TabName != first.TabName+" (2)" {
		t.Errorf("second tab = %q, want %q", second.TabName, first.TabName+" (2)")
	}
	if len(h.writer.WrittenData[second.TabName]) == 0 {
		t.Errorf("nothing written to %q", second.TabName)
	}
}

// TestRosterExportRefusesWithoutTheRosterFolder pins the loudest rule in the
// design: a blank GOOGLE_DRIVE_ROSTER_FOLDER_ID REFUSES, naming the variable.
//
// It must never fall back to GOOGLE_DRIVE_FOLDER_ID -- that folder's audience is
// the data export's, and these workbooks carry family contact details. Nor may
// it degrade to a silent no-op, which is indistinguishable from a weekend with
// no enrolled campers.
func TestRosterExportRefusesWithoutTheRosterFolder(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	h.drive.folderID = ""

	_, err := h.export()
	if !errors.Is(err, ErrRosterFolderNotConfigured) {
		t.Fatalf("err = %v, want ErrRosterFolderNotConfigured", err)
	}
	if !strings.Contains(err.Error(), "GOOGLE_DRIVE_ROSTER_FOLDER_ID") {
		t.Errorf("err = %q, want it to name the environment variable", err)
	}
	if len(h.drive.CreatedFolders) != 0 || len(h.drive.CreatedSpreadsheet) != 0 {
		t.Errorf("created %v / %v in Drive, want nothing",
			h.drive.CreatedFolders, h.drive.CreatedSpreadsheet)
	}
	if len(h.writer.EnsuredTabs) != 0 {
		t.Errorf("ensured %v, want no tab written", h.writer.EnsuredTabs)
	}
}

// TestRosterExportRelinksAWorkbookFoundInDrive covers a cleared database: the
// workbook is still in Drive, so a second one under the same name would leave
// staff with two and no way to tell which carries their edits.
func TestRosterExportRelinksAWorkbookFoundInDrive(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	title := "(DEV) Family Camp 2: Keshet LGBTQ Weekend 2026 Roster"
	h.drive.folders["roster-folder/2026"] = "existing-year-folder"
	h.drive.spreadsheet["existing-year-folder/"+title] = "already-there"

	result := h.mustExport()

	if result.SpreadsheetID != "already-there" {
		t.Errorf("spreadsheet = %q, want the one already in Drive", result.SpreadsheetID)
	}
	if len(h.drive.CreatedSpreadsheet) != 0 {
		t.Errorf("created %v, want none -- the workbook was already there", h.drive.CreatedSpreadsheet)
	}
}

// TestRosterExportRemovesTheDefaultSheet1 keeps Google's empty default tab out
// of a workbook whose tabs are the audit trail.
func TestRosterExportRemovesTheDefaultSheet1(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	h.writer.ExistingTabs["Sheet1"] = true

	h.mustExport()

	if !slices.Contains(h.writer.DeletedSheets, "Sheet1") {
		t.Errorf("deleted %v, want Sheet1 removed", h.writer.DeletedSheets)
	}
}

// TestRosterExportFormatsTheTabItJustCreated guards the id the formatting is
// aimed at. A GridRange with the wrong sheet id silently formats another tab --
// and every earlier tab in this workbook is hand-edited staff work.
func TestRosterExportFormatsTheTabItJustCreated(t *testing.T) {
	t.Parallel()
	h := newExportHarness(t)
	h.writer.SheetIDsByName[testRosterTab] = 987

	result := h.mustExport()

	if len(h.writer.AppliedFormats) != 1 {
		t.Fatalf("applied %d formats, want 1", len(h.writer.AppliedFormats))
	}
	if got := h.writer.AppliedFormats[0].SheetID; got != 987 {
		t.Errorf("formatted sheet id %d, want 987 (the tab %q)", got, result.TabName)
	}
}

// TestRosterExportPropagatesBuilderRefusals keeps a refused weekend from
// touching Drive at all -- no empty workbook, no empty tab.
func TestRosterExportPropagatesBuilderRefusals(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t) // a family session with no enrolled campers
	writer := NewMockSheetsWriter()
	drive := newMockRosterDrive()
	exporter := NewRosterExporter(f.app, writer, drive, time.Now)

	_, err := exporter.Export(context.Background(), rosterYear, cmIDFamilyCamp1)
	if !errors.Is(err, ErrRosterNoEnrolledCampers) {
		t.Fatalf("err = %v, want ErrRosterNoEnrolledCampers", err)
	}
	if len(drive.CreatedFolders) != 0 || len(drive.CreatedSpreadsheet) != 0 {
		t.Errorf("touched Drive: %v / %v", drive.CreatedFolders, drive.CreatedSpreadsheet)
	}
	if len(writer.EnsuredTabs) != 0 {
		t.Errorf("ensured %v, want no tab", writer.EnsuredTabs)
	}
}

// TestRosterExportStampsAgesInCampLocalTime pins the clock the export reads.
// PocketBase's container leaves time.Local at UTC unless TZ is set, so an export
// made at 5pm Pacific would otherwise be stamped with the next day's date.
func TestRosterExportStampsAgesInCampLocalTime(t *testing.T) {
	t.Setenv("TZ", "America/Los_Angeles")
	h := newExportHarness(t)
	// 2026-08-20 05:04 UTC is 2026-08-19 22:04 Pacific.
	h.at = time.Date(2026, time.August, 20, 5, 4, 0, 0, time.UTC)

	result := h.mustExport()
	if !strings.HasPrefix(result.TabName, "Aug 19, 2026") {
		t.Errorf("tab name = %q, want it stamped Aug 19 in camp-local time", result.TabName)
	}
}

// TestNewRosterExporterForAppRefusesWhenSheetsIsDisabled pins the other
// misconfiguration. With GOOGLE_SHEETS_ENABLED unset, NewSheetsClient returns
// nil, nil -- the graceful degradation the sync path wants, and exactly wrong
// for a staff-triggered export, where a nil writer would panic on the first
// call instead of telling anyone what is switched off.
func TestNewRosterExporterForAppRefusesWhenSheetsIsDisabled(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	_, err := NewRosterExporterForApp(context.Background(), newSyncTestApp(t))
	if !errors.Is(err, ErrRosterSheetsDisabled) {
		t.Fatalf("err = %v, want ErrRosterSheetsDisabled", err)
	}
	if !strings.Contains(err.Error(), "GOOGLE_SHEETS_ENABLED") {
		t.Errorf("err = %q, want it to name the environment variable", err)
	}
}
