package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/campminder"
)

// TestAttendeesLogStatusChangeDryRunWritesNothing proves logStatusChange's own
// App.Save call -- the one write site AttendeesSync has outside
// BaseSyncService.ProcessCompositeRecord -- is gated by DryRun (kindred#2351).
func TestAttendeesLogStatusChangeDryRunWritesNothing(t *testing.T) {
	// Not t.Parallel(): t.Setenv below panics if the test may run in parallel.
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("attendee_status_history")
	col.Fields.Add(&core.NumberField{Name: "person_id"})
	col.Fields.Add(&core.TextField{Name: "old_status"})
	col.Fields.Add(&core.TextField{Name: "new_status"})
	col.Fields.Add(&core.TextField{Name: "detected_at"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("create attendee_status_history: %v", saveErr)
	}

	// GetSeasonID is a pure getter -- no network call -- so a real *campminder.Client built
	// from a fake key is sufficient here.
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")
	client, err := campminder.NewClient(&campminder.Config{APIKey: "test-key", ClientID: "test-client", SeasonID: 2026})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}

	s := NewAttendeesSync(app, client)
	s.SetDryRun(true)

	if callErr := s.logStatusChange(5001, 6001, "waitlisted", "enrolled", map[string]any{}); callErr != nil {
		t.Fatalf("logStatusChange: %v", callErr)
	}

	rows, err := app.FindRecordsByFilter("attendee_status_history", "", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("dry run wrote %d rows to attendee_status_history; want 0", len(rows))
	}
}
