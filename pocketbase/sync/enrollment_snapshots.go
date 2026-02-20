package sync

import (
	"context"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameEnrollmentSnapshots is the canonical name for this sync service
const serviceNameEnrollmentSnapshots = "enrollment_snapshots"

// EnrollmentSnapshotsSync captures daily enrollment counts per session.
// This is a Transform phase job: reads PocketBase, writes PocketBase, no CampMinder API calls.
type EnrollmentSnapshotsSync struct {
	App    core.App
	Year   int
	DryRun bool
	Debug  bool
	Stats  Stats
}

// NewEnrollmentSnapshotsSync creates a new enrollment snapshots sync service
func NewEnrollmentSnapshotsSync(app core.App) *EnrollmentSnapshotsSync {
	return &EnrollmentSnapshotsSync{
		App: app,
	}
}

// Name returns the service name
func (s *EnrollmentSnapshotsSync) Name() string {
	return serviceNameEnrollmentSnapshots
}

// GetStats returns the current stats
func (s *EnrollmentSnapshotsSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *EnrollmentSnapshotsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetYear sets the year for this sync service
func (s *EnrollmentSnapshotsSync) SetYear(year int) {
	s.Year = year
}

// Sync executes the enrollment snapshot capture
func (s *EnrollmentSnapshotsSync) Sync(_ context.Context) error {
	// TODO: implement in next commit
	return nil
}
