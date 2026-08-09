package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// statusCollection is the staff-owned weekend cancellation flag created by
// pb_migrations/1500000142_lodging_session_status.js (kindred#2092).
const statusCollection = "lodging_session_status"

// TestSyncNeverWritesTheStaffOwnedWeekendStatus is the whole point of the
// table, asserted rather than commented.
//
// CampMinder's Sessions API exposes twenty properties and none of them is a
// status or a registration-availability concept, so "this weekend is
// cancelled" cannot be derived from anything that syncs. Two derived rules
// were tried and retracted on measured production data: "attendee rows exist
// but none are enrolled" misses a weekend cancelled before anyone registered
// (indistinguishable from one that has not opened yet), and `is_active` is a
// passthrough of CampMinder's own field measuring 25% precise for this.
//
// So the value is typed by a staff member and there is no upstream to
// reconcile against. The failure mode this guards is silent and expensive: a
// later sync job that "tidies up" by writing or clearing a row here would
// un-cancel a weekend nobody re-cancelled, and the only evidence would be a
// board quietly reappearing on the lander.
//
// A source scan rather than a behavioral assertion, because the property is
// an ABSENCE — there is no call to intercept and no mock that can observe a
// write that was never coded. Same shape as the export-registry guards in
// lodging_phi_test.go: cheap, and it fails at the moment someone adds the
// reference rather than in production.
func TestSyncNeverWritesTheStaffOwnedWeekendStatus(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("reading the sync package directory: %v", err)
	}

	scanned := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") {
			continue
		}
		// This file names the collection in order to look for it.
		if name == "lodging_session_status_test.go" {
			continue
		}

		body, err := os.ReadFile(filepath.Clean(name))
		if err != nil {
			t.Fatalf("reading %s: %v", name, err)
		}
		scanned++

		if strings.Contains(string(body), statusCollection) {
			t.Errorf("%s references %q; the weekend cancellation flag is staff-owned and "+
				"nothing in the sync layer may write or clear it (kindred#2092)", name, statusCollection)
		}
	}

	// Without this the test passes by looking at nothing — a package move or a
	// working-directory change would make every assertion above unreachable and
	// the test would still be green.
	if scanned == 0 {
		t.Fatal("scanned no Go files; this test cannot prove anything about the sync layer")
	}
}
