package sync

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// nameMethodPattern matches a Go method named Name returning a string,
// whatever its receiver -- the shape every Service.Name() implementation
// took, and the shape the Service interface itself declared the method in
// (kindred#2607). It requires a word boundary immediately before "Name" so
// it does not fire on an unrelated method whose identifier merely ends in
// "Name", such as logJobName() string.
var nameMethodPattern = regexp.MustCompile(`\bName\(\)\s*string\b`)

// TestNoNameMethodRemainsInSyncPackage guards against Service.Name()
// reappearing (kindred#2607). Name() returned the service TYPE's name, which
// the orchestrator never actually keyed on: two scoped family-camp instances
// share a type with their unrestricted counterparts, so Name() cannot tell
// them apart and everything downstream (sync_runs.service, runningJobs,
// lastCompletedStatus, the sync-status payload) uses the explicitly
// REGISTERED name instead. Nothing had a legitimate reason to call it, and
// nothing should grow one back.
//
// A source scan rather than a behavioral assertion, because the property is
// an ABSENCE -- there is no call to intercept and no mock that can observe a
// method that was never coded. Same shape as
// TestSyncNeverWritesTheStaffOwnedWeekendStatus.
func TestNoNameMethodRemainsInSyncPackage(t *testing.T) {
	t.Parallel()
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
		// This file names the method in order to look for it.
		if name == "service_name_removal_test.go" {
			continue
		}

		body, err := os.ReadFile(filepath.Clean(name))
		if err != nil {
			t.Fatalf("reading %s: %v", name, err)
		}
		scanned++

		if nameMethodPattern.Match(body) {
			t.Errorf("%s still declares a Name() string method; kindred#2607 removed "+
				"Service.Name() and every implementation because the registered service name, "+
				"not the type's Name(), is what everything downstream actually keys on", name)
		}
	}

	// Without this the test passes by looking at nothing -- a package move or a
	// working-directory change would make every assertion above unreachable and
	// the test would still be green.
	if scanned == 0 {
		t.Fatal("scanned no Go files; this test cannot prove anything about the sync layer")
	}
}
