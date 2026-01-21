package sync

import (
	"context"
	"fmt"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// Service name constant
const serviceNameSessionPrograms = "session_programs"

// SessionProgramsSync handles syncing session program data from CampMinder
type SessionProgramsSync struct {
	BaseSyncService
}

// NewSessionProgramsSync creates a new session programs sync service
func NewSessionProgramsSync(app core.App, client *campminder.Client) *SessionProgramsSync {
	return &SessionProgramsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *SessionProgramsSync) Name() string {
	return serviceNameSessionPrograms
}

// Sync performs the session programs sync
func (s *SessionProgramsSync) Sync(_ context.Context) error {
	// TODO: Implement - currently a stub for TDD
	return fmt.Errorf("not implemented")
}

// transformSessionProgramToPB transforms CampMinder session program data to PocketBase format
func (s *SessionProgramsSync) transformSessionProgramToPB(data map[string]interface{}, year int) (map[string]interface{}, error) {
	// TODO: Implement - currently a stub for TDD
	// This stub returns an error to make tests fail (red phase)
	_, ok := data["ID"].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid session program ID type")
	}

	return nil, fmt.Errorf("not implemented")
}
