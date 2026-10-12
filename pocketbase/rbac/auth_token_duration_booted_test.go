package rbac

import "testing"

// usersAuthTokenSeconds is how long a staff session token lives (migration
// 1500000241). It is NOT an absolute session cap: AuthContext refreshes the
// token on every app load, and PocketBase mints the new one from the old
// without asking the identity provider. So this bounds the idle gap -- time
// since the last app load -- after which a disabled or removed account stops
// working, and after which an open tab is sent back to sign in.
const usersAuthTokenSeconds = 43200 // 12h

// TestBootedUsersAuthTokenDuration: a fresh PocketBase gives auth collections
// its own default (5 days since v0.39), and a database created on an older
// version keeps whatever that version defaulted to (7 days before v0.39). Only
// the migration makes both the same, so assert it on the migrated database.
func TestBootedUsersAuthTokenDuration(t *testing.T) {
	app := newBootedTestApp(t)
	defer app.Cleanup()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	if got := users.AuthToken.Duration; got != usersAuthTokenSeconds {
		t.Fatalf("users.authToken.duration = %ds, want %ds", got, usersAuthTokenSeconds)
	}
}
