package sync

import (
	"context"
	"testing"
)

// Behavioral half of the kindred#3195 Go follow-up: a value that carries filter
// syntax must be compared as data, never parsed as part of the filter. The
// structural half -- no Go filter pastes a value in -- is
// pb_filter_param_guard_test.go.
//
// Each payload closes the quote it is pasted into and ORs in a clause that is
// true for every row, so a filter that pastes the value matches everything
// while a bound one matches nothing.
var filterInjectionPayloads = []string{
	`x' || id != '`,
	`x" || id != "`,
}

// TestLookupCMIDByPBIDTreatsQuotesAsData covers the `id = {:id}` shape, the
// commonest of the converted sites.
func TestLookupCMIDByPBIDTreatsQuotesAsData(t *testing.T) {
	app := newSyncTestApp(t)
	realID := saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 4101, "year": 2026})
	b := &BaseSyncService{App: app}

	if cmID, ok := b.LookupCMIDByPBID("camp_sessions", realID); !ok || cmID != 4101 {
		t.Fatalf("real id: got (%d, %v), want (4101, true)", cmID, ok)
	}
	for _, payload := range filterInjectionPayloads {
		if cmID, ok := b.LookupCMIDByPBID("camp_sessions", payload); ok {
			t.Errorf("LookupCMIDByPBID(%q) matched a row (cm_id %d); the value rewrote the filter", payload, cmID)
		}
	}
}

// TestSessionCMIDsOfTypeTreatsQuotesAsData covers a free-text value beside a
// numeric one.
func TestSessionCMIDsOfTypeTreatsQuotesAsData(t *testing.T) {
	app := newSyncTestApp(t)
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 4201, "year": 2026, "session_type": sessionTypeMain})
	r := NewSessionResolver(app)

	got, err := r.sessionCMIDsOfType(2026, sessionTypeMain)
	if err != nil || len(got) != 1 || got[0] != 4201 {
		t.Fatalf("real type: got (%v, %v), want ([4201], nil)", got, err)
	}
	for _, payload := range filterInjectionPayloads {
		got, err := r.sessionCMIDsOfType(2026, payload)
		if err != nil {
			t.Errorf("sessionCMIDsOfType(%q): unexpected error %v", payload, err)
			continue
		}
		if len(got) != 0 {
			t.Errorf("sessionCMIDsOfType(%q) = %v, want none; the value rewrote the filter", payload, got)
		}
	}
}

// TestLoadSessionWindowsTreatsQuotesAsData covers the OR-of-values shape built
// by concatenation.
func TestLoadSessionWindowsTreatsQuotesAsData(t *testing.T) {
	app := newSyncTestApp(t)
	saveRecord(t, app, "camp_sessions", map[string]any{
		"cm_id": 4301, "year": 2026, "session_type": sessionTypeMain,
		"start_date": testSessionStart, "end_date": testSessionEnd,
	})

	got, err := LoadSessionWindows(app, 2026, []string{sessionTypeMain})
	if err != nil || len(got) != 1 {
		t.Fatalf("real type: got %d windows (err %v), want 1", len(got), err)
	}
	for _, payload := range filterInjectionPayloads {
		got, err := LoadSessionWindows(app, 2026, []string{sessionTypeFamily, payload})
		if err != nil {
			t.Errorf("LoadSessionWindows(%q): unexpected error %v", payload, err)
			continue
		}
		if len(got) != 0 {
			t.Errorf("LoadSessionWindows(%q) = %d windows, want none; the value rewrote the filter", payload, len(got))
		}
	}
}

// TestGetWorkbookForSessionTreatsQuotesAsData covers a select-field value.
func TestGetWorkbookForSessionTreatsQuotesAsData(t *testing.T) {
	app := newWorkbookTestApp(t)
	m := NewWorkbookManager(app, nil)
	ctx := context.Background()
	if _, err := m.SaveWorkbookRecord(ctx, rosterWorkbook(cmIDTestWeekendA, "sheet-a")); err != nil {
		t.Fatalf("save workbook: %v", err)
	}

	if wb, err := m.GetWorkbookForSession(ctx, workbookTypeFCRoster, 2026, cmIDTestWeekendA); err != nil || wb == nil {
		t.Fatalf("real type: got (%v, %v), want the saved workbook", wb, err)
	}
	for _, payload := range filterInjectionPayloads {
		wb, err := m.GetWorkbookForSession(ctx, workbookTypeGlobals+payload, 2026, cmIDTestWeekendA)
		if err != nil {
			t.Errorf("GetWorkbookForSession(%q): unexpected error %v", payload, err)
			continue
		}
		if wb != nil {
			t.Errorf("GetWorkbookForSession(%q) found workbook %q; the value rewrote the filter", payload, wb.SpreadsheetID)
		}
	}
}

// TestEqualsAnyFilterTreatsQuotesAsData covers the batched `a = x || a = y`
// shape, and pins that a real id among hostile ones still matches.
func TestEqualsAnyFilterTreatsQuotesAsData(t *testing.T) {
	app := newSyncTestApp(t)
	realID := saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 4401, "year": 2026})
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 4402, "year": 2026})

	values := append([]string{realID}, filterInjectionPayloads...)
	filter, params := equalsAnyFilter("id", values)
	records, err := app.FindRecordsByFilter("camp_sessions", filter, "", 0, 0, params)
	if err != nil {
		t.Fatalf("FindRecordsByFilter(%q): %v", filter, err)
	}
	if len(records) != 1 || records[0].Id != realID {
		ids := make([]string, 0, len(records))
		for _, r := range records {
			ids = append(ids, r.Id)
		}
		t.Errorf("filter %q matched %v, want only %s", filter, ids, realID)
	}
}
