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

// TestSuperuserDoorIsOnlyOnThePullRoute pins the narrowed bypass FastAPI's Pull now relies on.
// FastAPI calls the pull route as PocketBase's superuser after gating the person on
// financial_aid.casework; a superuser has neither is_admin nor cached_permissions. Only
// requirePermissionOrSuperuser admits it; RequirePermission (every other gated route) refuses
// it exactly as on main. Non-superuser behaviour is the same on both.
func TestSuperuserDoorIsOnlyOnThePullRoute(t *testing.T) {
	t.Parallel()
	newEvent := func(collection string) *core.RequestEvent {
		e := &core.RequestEvent{}
		e.Auth = core.NewRecord(core.NewAuthCollection(collection))
		return e
	}
	admin := newEvent("users")
	admin.Auth.Set("is_admin", true)
	withPerm := newEvent("users")
	withPerm.Auth.Set("cached_permissions", []string{"bunking.manage"})

	cases := []struct {
		name    string
		wrap    func(string, func(*core.RequestEvent) error) func(*core.RequestEvent) error
		event   *core.RequestEvent
		wantRun bool
	}{
		{"pull route: superuser runs", requirePermissionOrSuperuser, newEvent(core.CollectionNameSuperusers), true},
		{"other route: superuser refused", RequirePermission, newEvent(core.CollectionNameSuperusers), false},
		{"pull route: user without permission refused", requirePermissionOrSuperuser, newEvent("users"), false},
		{"pull route: no auth refused", requirePermissionOrSuperuser, &core.RequestEvent{}, false},
		{"pull route: admin runs", requirePermissionOrSuperuser, admin, true},
		{"pull route: permitted user runs", requirePermissionOrSuperuser, withPerm, true},
		{"other route: admin runs", RequirePermission, admin, true},
		{"other route: permitted user runs", RequirePermission, withPerm, true},
		{"other route: user without permission refused", RequirePermission, newEvent("users"), false},
		{"other route: no auth refused", RequirePermission, &core.RequestEvent{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ran := false
			err := tc.wrap("bunking.manage", func(*core.RequestEvent) error { ran = true; return nil })(tc.event)
			if ran != tc.wantRun || (err == nil) != tc.wantRun {
				t.Fatalf("ran=%v err=%v, want run=%v", ran, err, tc.wantRun)
			}
		})
	}
}
