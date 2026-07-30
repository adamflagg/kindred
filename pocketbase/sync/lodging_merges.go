package sync

import (
	"fmt"
	"slices"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// mergeCreatedBySync labels merge rows this ingest materializes, so the Plan 3
// board can tell them apart from ones staff created by dropping a party.
const mergeCreatedBySync = "campminder_sync"

// maxMergeMembers mirrors lodging_merges.member_units maxSelect (migration
// 1500000118). Kept in step by scripts/dev/verify-lodging-schema.sh.
const maxMergeMembers = 20

// unitSetKey gives a member set an order-independent identity. PocketBase
// returns relation ids in storage order, which is not a guaranteed ordering, so
// comparing slices directly would treat {a,b} and {b,a} as different merges.
func unitSetKey(unitIDs []string) string {
	sorted := slices.Clone(unitIDs)
	slices.Sort(sorted)
	return strings.Join(sorted, "\x00")
}

// EnsureMerge returns the id of the lodging_merges row binding exactly unitIDs
// for (session, year, scenario), creating it if absent.
//
// Deduplication lives here rather than in an index because a merge's identity is
// a SET of member units, which SQLite cannot express as a unique index. Without
// it, each backfill run would create a fresh merge row for the same two rooms
// and the board would show duplicate slots.
//
// An empty scenario means the session's live plan, matching how PocketBase
// stores an unset relation: TEXT, NOT NULL, defaulting to the empty string.
//
// sessionCMID is the session's CampMinder id and is REQUIRED by
// lodging_merges.session_cm_id (migration 1500000124). It is passed in rather
// than looked up so it comes from the same attribution that chose sessionID;
// deriving it here would let the relation and the durable key disagree.
func EnsureMerge(
	app core.App, sessionID string, sessionCMID, year int,
	scenario string, unitIDs []string, displayName string,
) (string, error) {
	// member_units is minSelect 2, maxSelect 20 (migration 1500000118). Checking
	// both here gives a call-site error naming the member count, instead of a
	// PocketBase validation failure surfacing from app.Save deep in a backfill.
	if len(unitIDs) < 2 || len(unitIDs) > maxMergeMembers {
		return "", fmt.Errorf("merge needs between 2 and %d member units, got %d", maxMergeMembers, len(unitIDs))
	}

	// eqOrEmpty, not a bound parameter: a bound "" matches NOTHING in PocketBase,
	// so the live plan (an empty scenario) would never find its own merge row and
	// every run would create another one. Verified against a live PocketBase.
	params := dbx.Params{"session": sessionID, "year": year}
	filter := "session = {:session} && year = {:year} && " +
		eqOrEmpty("scenario", "scenario", scenario, params)

	existing, err := app.FindRecordsByFilter("lodging_merges", filter, "", 0, 0, params)
	if err != nil {
		return "", fmt.Errorf("loading merges for session %s: %w", sessionID, err)
	}

	want := unitSetKey(unitIDs)
	for _, m := range existing {
		if unitSetKey(m.GetStringSlice("member_units")) == want {
			return m.Id, nil
		}
	}

	col, err := app.FindCollectionByNameOrId("lodging_merges")
	if err != nil {
		return "", fmt.Errorf("finding lodging_merges: %w", err)
	}
	rec := core.NewRecord(col)
	rec.Set("session", sessionID)
	rec.Set("session_cm_id", sessionCMID)
	rec.Set("year", year)
	rec.Set("scenario", scenario)
	rec.Set("member_units", unitIDs)
	rec.Set("display_name", displayName)
	rec.Set("created_by", mergeCreatedBySync)
	if err := app.Save(rec); err != nil {
		return "", fmt.Errorf("creating merge for session %s: %w", sessionID, err)
	}
	return rec.Id, nil
}
