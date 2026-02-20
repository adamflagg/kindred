package sync

import "testing"

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
