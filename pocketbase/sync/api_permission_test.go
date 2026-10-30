package sync

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestPermissionCheckExactMatch(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		perms     any
		check     string
		wantFound bool
	}{
		{
			name:      "exact match found",
			perms:     []any{"sync.run", "bunking.view"},
			check:     "sync.run",
			wantFound: true,
		},
		{
			name:      "no substring false positive",
			perms:     []any{"sync.run_extended"},
			check:     "sync.run",
			wantFound: false,
		},
		{
			name:      "empty permissions",
			perms:     []any{},
			check:     "sync.run",
			wantFound: false,
		},
		{
			name:      "nil permissions",
			perms:     nil,
			check:     "sync.run",
			wantFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, _ := json.Marshal(tt.perms)
			var permSlice []string
			_ = json.Unmarshal(data, &permSlice)
			got := slices.Contains(permSlice, tt.check)
			if got != tt.wantFound {
				t.Errorf("slices.Contains() = %v, want %v", got, tt.wantFound)
			}
		})
	}
}

// TestRequirePermissionLetsTheSuperuserThrough pins the bypass FastAPI's Pull now relies on
// (adult-aid form design PR 2): FastAPI calls a sync route as PocketBase's superuser after
// gating the person on financial_aid.casework, and a superuser has neither is_admin nor
// cached_permissions, so without the bypass every such call would be 403. A superuser can
// already read and write every collection, and no person's token is a superuser's, so this
// widens nothing for a person. An app user with no permission is still refused, and a
// missing auth is still 401.
func TestRequirePermissionLetsTheSuperuserThrough(t *testing.T) {
	t.Parallel()
	ran := false
	handler := RequirePermission("bunking.manage", func(*core.RequestEvent) error {
		ran = true
		return nil
	})

	superuser := &core.RequestEvent{}
	superuser.Auth = core.NewRecord(core.NewAuthCollection(core.CollectionNameSuperusers))
	if err := handler(superuser); err != nil || !ran {
		t.Fatalf("superuser: err=%v ran=%v, want the handler to run", err, ran)
	}

	ran = false
	user := &core.RequestEvent{}
	user.Auth = core.NewRecord(core.NewAuthCollection("users"))
	if err := handler(user); err == nil || ran {
		t.Fatalf("user without the permission: err=%v ran=%v, want a refusal", err, ran)
	}

	ran = false
	if err := handler(&core.RequestEvent{}); err == nil || ran {
		t.Fatalf("no auth: err=%v ran=%v, want a refusal", err, ran)
	}
}
