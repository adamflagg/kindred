package sync

import (
	"context"
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// newExportWithFakeWriter builds a MultiWorkbookExport on the package's existing
// MockSheetsWriter/MockWorkbookManager fakes (google_sheets_test.go,
// multi_workbook_export_test.go) plus a throwaway PocketBase app carrying just enough
// schema to reach WriteToSheet: "divisions" for one global export (its ExportConfig.Filter
// is "", so an unfiltered query against a fieldless collection succeeds) and "bunks" for one
// year export (SyncYearData filters on "year = N", so it needs a year field). Every other
// configured collection is absent, which is fine -- queryCollection's error on a missing
// collection is caught and skipped, exactly like a real deploy skipping a collection that
// legitimately had no rows.
//
// CAMPMINDER_SEASON_ID is set to 2025 so Sync()'s season resolution (see Sync's doc comment)
// always succeeds, and the export is constructed at year 2025 to match -- a caller that wants
// a non-current year calls SetYear itself.
func newExportWithFakeWriter(t *testing.T) *MultiWorkbookExport {
	t.Helper()
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	divisions := core.NewBaseCollection("divisions")
	if saveErr := app.Save(divisions); saveErr != nil {
		t.Fatalf("save divisions: %v", saveErr)
	}

	bunks := core.NewBaseCollection("bunks")
	bunks.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(bunks); saveErr != nil {
		t.Fatalf("save bunks: %v", saveErr)
	}

	writer := NewMockSheetsWriter()
	manager := NewMockWorkbookManager()

	export, err := NewMultiWorkbookExport(app, writer, manager, 2025)
	if err != nil {
		t.Fatalf("NewMultiWorkbookExport: %v", err)
	}
	return export
}

// fakeWriterSheetsWritten counts the distinct sheet tabs the fake writer received a
// WriteToSheet call for. Global and year sheet names never collide (GetReadableGlobalExports
// vs GetReadableYearExports), so a flat count is a safe total across whichever workbook(s) a
// run touched -- the fake doesn't track which spreadsheet ID a write targeted.
func fakeWriterSheetsWritten(export *MultiWorkbookExport) int {
	mock, ok := export.sheetsWriter.(*MockSheetsWriter)
	if !ok {
		return -1
	}
	return len(mock.WrittenData)
}

// fakeWriterGlobalsWritten reports whether any of the four global-export sheet names were
// written. Same "no spreadsheet ID tracked" caveat as fakeWriterSheetsWritten -- name
// membership stands in for it because the two sheet-name sets are disjoint.
func fakeWriterGlobalsWritten(export *MultiWorkbookExport) bool {
	mock, ok := export.sheetsWriter.(*MockSheetsWriter)
	if !ok {
		return false
	}
	for _, cfg := range GetReadableGlobalExports() {
		if _, wrote := mock.WrittenData[cfg.SheetName]; wrote {
			return true
		}
	}
	return false
}

// TestExportFilterNilVersusEmpty pins the sharpest edge in this change. SyncGlobalsOnly and
// SyncYearData skip on `changed != nil && !changed[c]`, so:
//
//	nil       -> export everything   (what a standalone Run button means)
//	empty map -> export NOTHING      (a real, different answer: "this batch changed nothing")
//
// GetChangedCollections() returns make(map[string]bool) and is never nil, so getting this
// backwards silently writes zero sheets and still reports success.
func TestExportFilterNilVersusEmpty(t *testing.T) {
	all := newExportWithFakeWriter(t)
	all.SetChangedCollections(nil)
	if err := all.Sync(context.Background()); err != nil {
		t.Fatalf("nil filter: %v", err)
	}
	if got := fakeWriterSheetsWritten(all); got == 0 {
		t.Error("a nil filter must export everything, wrote 0 sheets")
	}

	none := newExportWithFakeWriter(t)
	none.SetChangedCollections(map[string]bool{})
	if err := none.Sync(context.Background()); err != nil {
		t.Fatalf("empty filter: %v", err)
	}
	if got := fakeWriterSheetsWritten(none); got != 0 {
		t.Errorf("an empty filter must export nothing, wrote %d sheets", got)
	}
}

// TestExportGlobalsOnCurrentYearOnly pins one of the two behaviors the deleted epilogue
// carried: a historical replay writes its year's workbook and leaves the shared globals
// workbook alone.
func TestExportGlobalsOnCurrentYearOnly(t *testing.T) {
	historical := newExportWithFakeWriter(t)
	historical.SetYear(2024) // CAMPMINDER_SEASON_ID is 2025 -- historical.year now differs
	if err := historical.Sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if fakeWriterGlobalsWritten(historical) {
		t.Error("a historical year must not export globals")
	}
}

// TestSyncGlobalsFailureIsSoftYearDataFailureIsHard pins the asymmetry Sync() must keep even
// though it looks like it could just delegate to SyncForYears (which has no such asymmetry --
// it logs and continues on both a globals and a year-data failure, and always returns nil).
// Sync() does NOT delegate, on purpose: a globals failure is soft (logged, the run continues
// to year data -- the shared globals workbook lagging by one run is tolerable), but a
// year-data failure is hard (returned -- this run's own year workbook did not get written,
// and once this job is queued with a sync_runs row and a completion toast (task 13), that has
// to surface as a failure rather than report green).
//
// Forces each independently via MockWorkbookManager's GetOrCreateGlobalsErr /
// GetOrCreateYearErr -- SyncGlobalsOnly's and SyncYearData's only non-nil return paths.
func TestSyncGlobalsFailureIsSoftYearDataFailureIsHard(t *testing.T) {
	globalsFails := newExportWithFakeWriter(t)
	globalsManager, ok := globalsFails.workbookManager.(*MockWorkbookManager)
	if !ok {
		t.Fatal("expected *MockWorkbookManager")
	}
	globalsManager.GetOrCreateGlobalsErr = errors.New("globals workbook unavailable")
	if err := globalsFails.Sync(context.Background()); err != nil {
		t.Errorf("a globals failure must not fail Sync(), got: %v", err)
	}
	if !globalsFails.SyncSuccessful {
		t.Error("a globals failure must still leave SyncSuccessful true")
	}

	yearFails := newExportWithFakeWriter(t)
	yearManager, ok := yearFails.workbookManager.(*MockWorkbookManager)
	if !ok {
		t.Fatal("expected *MockWorkbookManager")
	}
	yearManager.GetOrCreateYearErr = errors.New("year workbook unavailable")
	if err := yearFails.Sync(context.Background()); err == nil {
		t.Error("a year-data failure must fail Sync(), got nil error")
	}
	if yearFails.SyncSuccessful {
		t.Error("a year-data failure must leave SyncSuccessful false")
	}
}
