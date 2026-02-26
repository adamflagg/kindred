package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestEnrollmentSnapshotsName(t *testing.T) {
	svc := NewEnrollmentSnapshotsSync(nil)
	if svc.Name() != "enrollment_snapshots" {
		t.Errorf("expected name enrollment_snapshots, got %s", svc.Name())
	}
}

func TestEnrollmentSnapshotsStats(t *testing.T) {
	svc := NewEnrollmentSnapshotsSync(nil)
	stats := svc.GetStats()
	if stats.Created != 0 || stats.Updated != 0 || stats.Errors != 0 {
		t.Error("expected zero stats for new service")
	}
}

func TestEnrollmentSnapshotsSetYear(t *testing.T) {
	svc := NewEnrollmentSnapshotsSync(nil)
	svc.SetYear(2025)
	if svc.Year != 2025 {
		t.Errorf("expected year 2025, got %d", svc.Year)
	}
}

func TestEnrollmentSnapshotsSetDebug(t *testing.T) {
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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	// Create a minimal collection to use for records
	col := core.NewBaseCollection("test_attendees")
	col.Fields.Add(&core.NumberField{Name: "person_id"})
	if err := app.Save(col); err != nil {
		t.Fatal(err)
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
