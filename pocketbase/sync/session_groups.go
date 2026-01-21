package sync

import (
	"context"
	"fmt"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// Service name constant
const serviceNameSessionGroups = "session_groups"

// SessionGroupsSync handles syncing session group data from CampMinder
type SessionGroupsSync struct {
	BaseSyncService
}

// NewSessionGroupsSync creates a new session groups sync service
func NewSessionGroupsSync(app core.App, client *campminder.Client) *SessionGroupsSync {
	return &SessionGroupsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *SessionGroupsSync) Name() string {
	return serviceNameSessionGroups
}

// Sync performs the session groups sync
func (s *SessionGroupsSync) Sync(_ context.Context) error {
	// TODO: Implement - currently a stub for TDD
	return fmt.Errorf("not implemented")
}

// transformSessionGroupToPB transforms CampMinder session group data to PocketBase format
func (s *SessionGroupsSync) transformSessionGroupToPB(data map[string]interface{}, year int) (map[string]interface{}, error) {
	// TODO: Implement - currently a stub for TDD
	// This stub returns an error to make tests fail (red phase)
	_, ok := data["ID"].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid session group ID type")
	}

	return nil, fmt.Errorf("not implemented")
}
