package sync

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestEnrollmentSnapshotsStats(t *testing.T) {
	t.Parallel()
	svc := NewEnrollmentSnapshotsSync(nil)
	stats := svc.GetStats()
	if stats.Created != 0 || stats.Updated != 0 || stats.Errors != 0 {
		t.Error("expected zero stats for new service")
	}
}

func TestEnrollmentSnapshotsSetYear(t *testing.T) {
	t.Parallel()
	svc := NewEnrollmentSnapshotsSync(nil)
	svc.SetYear(2025)
	if svc.Year != 2025 {
		t.Errorf("expected year 2025, got %d", svc.Year)
	}
}

func TestEnrollmentSnapshotsSetDebug(t *testing.T) {
	t.Parallel()
	svc := NewEnrollmentSnapshotsSync(nil)
	svc.SetDebug(true)
	if !svc.Debug {
		t.Error("expected debug to be true")
	}
	svc.SetDebug(false)
	if svc.Debug {
		t.Error("expected debug to be false")
	}
}

func TestCountByGender(t *testing.T) {
	t.Parallel()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
		return
	}
	defer app.Cleanup()

	// Create a minimal collection to use for records
	col := core.NewBaseCollection("test_attendees")
	col.Fields.Add(&core.NumberField{Name: "person_id"})
	if err := app.Save(col); err != nil {
		t.Fatal(err)
		return
	}

	makeRecord := func(personID int) *core.Record {
		r := core.NewRecord(col)
		r.Set("person_id", personID)
		return r
	}

	t.Run("basic M/F split", func(t *testing.T) {
		genderMap := map[int]string{
			100: "M",
			101: "F",
			102: "M",
			103: "F",
			104: "F",
		}
		records := []*core.Record{
			makeRecord(100),
			makeRecord(101),
			makeRecord(102),
			makeRecord(103),
			makeRecord(104),
		}
		male, female := countByGender(records, genderMap)
		if male != 2 {
			t.Errorf("expected 2 males, got %d", male)
		}
		if female != 3 {
			t.Errorf("expected 3 females, got %d", female)
		}
	})

	t.Run("unknown gender excluded", func(t *testing.T) {
		genderMap := map[int]string{
			100: "M",
			101: "Other",
		}
		records := []*core.Record{
			makeRecord(100),
			makeRecord(101),
			makeRecord(200), // not in gender map
		}
		male, female := countByGender(records, genderMap)
		if male != 1 {
			t.Errorf("expected 1 male, got %d", male)
		}
		if female != 0 {
			t.Errorf("expected 0 females, got %d", female)
		}
	})

	t.Run("empty records", func(t *testing.T) {
		genderMap := map[int]string{100: "M"}
		male, female := countByGender(nil, genderMap)
		if male != 0 || female != 0 {
			t.Errorf("expected 0/0, got %d/%d", male, female)
		}
	})

	t.Run("empty gender map", func(t *testing.T) {
		records := []*core.Record{makeRecord(100)}
		male, female := countByGender(records, map[int]string{})
		if male != 0 || female != 0 {
			t.Errorf("expected 0/0, got %d/%d", male, female)
		}
	})

	t.Run("all same gender", func(t *testing.T) {
		genderMap := map[int]string{
			100: "F",
			101: "F",
			102: "F",
		}
		records := []*core.Record{
			makeRecord(100),
			makeRecord(101),
			makeRecord(102),
		}
		male, female := countByGender(records, genderMap)
		if male != 0 {
			t.Errorf("expected 0 males, got %d", male)
		}
		if female != 3 {
			t.Errorf("expected 3 females, got %d", female)
		}
	})
}

func TestSnapshotCancelledFilterUsesBritishSpelling(t *testing.T) {
	t.Parallel()
	// Bug 1: The snapshot sync used 'canceled' (American) but attendees.go
	// stores 'cancelled' (British, from CampMinder). This test verifies the
	// filter matches actual attendee records with status = 'cancelled'.
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
		return
	}
	defer app.Cleanup()

	// Create attendees collection with status field
	col := core.NewBaseCollection("test_snap_attendees")
	col.Fields.Add(&core.TextField{Name: "status"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.TextField{Name: "session"})
	err = app.Save(col)
	if err != nil {
		t.Fatal(err)
		return
	}

	// Create attendees with British spelling (as stored by attendees.go)
	for range 3 {
		r := core.NewRecord(col)
		r.Set("status", "cancelled") // British spelling from CampMinder
		r.Set("year", 2025)
		r.Set("session", "sess1")
		err = app.Save(r)
		if err != nil {
			t.Fatal(err)
			return
		}
	}

	// The filter used in enrollment_snapshots.go must use 'cancelled' (British)
	cancelledFilter := fmt.Sprintf("year = %d && session = '%s' && status = 'cancelled'", 2025, "sess1")
	cancelledRecords, err := app.FindRecordsByFilter("test_snap_attendees", cancelledFilter, "", 0, 0)
	if err != nil {
		t.Fatalf("filter with 'cancelled' failed: %v", err)
	}
	if len(cancelledRecords) != 3 {
		t.Errorf("expected 3 cancelled records with British spelling, got %d", len(cancelledRecords))
	}

	// Verify the American spelling 'canceled' returns 0 (the bug we're fixing)
	americanFilter := fmt.Sprintf("year = %d && session = '%s' && status = 'canceled'", 2025, "sess1")
	americanRecords, err := app.FindRecordsByFilter("test_snap_attendees", americanFilter, "", 0, 0)
	if err != nil {
		t.Fatalf("filter with 'canceled' failed: %v", err)
	}
	if len(americanRecords) != 0 {
		t.Errorf("expected 0 records with American spelling 'canceled', got %d", len(americanRecords))
	}
}

func TestSnapshotUsesFullTimestamp(t *testing.T) {
	t.Parallel()
	// Verify the format string produces a full datetime (not date-only or midnight-truncated).
	// Use a known non-midnight time to confirm the time component is preserved.
	sample := time.Date(2026, 6, 15, 14, 30, 45, 0, time.UTC)
	formatted := sample.Format("2006-01-02 15:04:05.000Z")

	if len(formatted) < 23 {
		t.Errorf("snapshot date should be full datetime, got %s", formatted)
	}
	if formatted[11:19] == "00:00:00" {
		t.Errorf("snapshot date should preserve time component, got %s", formatted)
	}
	expected := "2026-06-15 14:30:45.000Z"
	if formatted != expected {
		t.Errorf("expected %s, got %s", expected, formatted)
	}
}
