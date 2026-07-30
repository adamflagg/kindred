package sync

import (
	"strings"
	"testing"
)

// TestLodgingCollectionsAreNeverExported guards the claim SyncJobToCollections
// makes about the lodging ingest: its entry exists so the export-skip
// optimisation knows which collections the job writes, NOT because any of them
// is exported.
//
// The distinction matters because the two lists look interchangeable and are
// not. SyncJobToCollections is a write manifest; GetReadableYearExports is a
// publish list that ships rows to Google Sheets. lodging_assignments and
// lodging_assignment_history carry per-household and per-person placement --
// who slept where -- which is exactly the shape of data family_camp_medical is
// deliberately kept out of the publish list for.
//
// Without this test the invariant is a comment, and the failure mode is silent:
// a future lodging-board export lands in GetReadableYearExports, nothing goes
// red, and placement data reaches a spreadsheet.
func TestLodgingCollectionsAreNeverExported(t *testing.T) {
	exported := map[string]string{}
	for _, cfg := range GetReadableYearExports() {
		exported[cfg.Collection] = "GetReadableYearExports"
	}
	for _, cfg := range GetReadableGlobalExports() {
		exported[cfg.Collection] = "GetReadableGlobalExports"
	}

	for collection, where := range exported {
		if strings.HasPrefix(collection, "lodging_") {
			t.Errorf("%s exports %q; lodging collections carry placement data and must not ship to Sheets",
				where, collection)
		}
	}

	// The write manifest is the other half of the claim: every collection the
	// ingest writes has to be listed there, or the export-skip optimisation
	// silently misses it.
	written, ok := SyncJobToCollections[serviceNameLodgingAssignments]
	if !ok {
		t.Fatal("lodging_assignments missing from SyncJobToCollections")
	}
	for _, collection := range written {
		if where, isExported := exported[collection]; isExported {
			t.Errorf("%s is both written by the ingest and exported by %s", collection, where)
		}
	}
}
