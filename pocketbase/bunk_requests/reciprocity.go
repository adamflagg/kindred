// Package bunkrequests provides reciprocity-correctness hooks for the
// bunk_requests PocketBase collection.
package bunkrequests

import (
	"github.com/pocketbase/pocketbase/core"
)

// RecomputePairReciprocity recomputes is_reciprocal on both rows of a
// (personA, personB, request_type) pair in the same year + session.
// Idempotent: writes only if the new value differs from the stored one.
func RecomputePairReciprocity(
	app core.App,
	year int,
	sessionID int,
	personA int,
	personB int,
	requestType string,
) error {
	// TODO: implement in Task 3
	return nil
}
