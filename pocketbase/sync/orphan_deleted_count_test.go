package sync

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The orphan sweeps' deletions reach Stats.Deleted, which recordSyncRun saves as
// sync_runs.deleted_count. Campership To place (D16 option b) reads that column as its
// tripwire for "CampMinder records were removed since the posting day": a sweep that
// deletes rows but reports 0 lets a cleared equity answer or a cancelled registration
// read as "unchanged". A dry run deletes nothing and so counts nothing (see the
// family_camp_derived note on why a completed run row must never assert deletions that
// did not happen).

func seedOrphanRows(t *testing.T, app core.App, collection string, cmIDs ...string) []*core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", err)
	}
	rows := make([]*core.Record, 0, len(cmIDs))
	for _, cmID := range cmIDs {
		row := core.NewRecord(col)
		row.Set("cm_id", cmID)
		row.Set("year", 2027)
		if saveErr := app.Save(row); saveErr != nil {
			t.Fatalf("seed %s: %v", cmID, saveErr)
		}
		rows = append(rows, row)
	}
	return rows
}

func cmIDKey(r *core.Record) (string, bool) { return r.GetString("cm_id"), true }

func TestDeleteOrphansCountsItsDeletionsInStats(t *testing.T) {
	t.Parallel()
	for _, dryRun := range []bool{false, true} {
		app := newBaseSyncDryRunTestApp(t, "counted_orphans")
		seedOrphanRows(t, app, "counted_orphans", "1", "2", "3")
		b := &BaseSyncService{
			App:            app,
			Stats:          Stats{Deleted: 4}, // a deletion counted earlier in the run is kept
			DryRun:         dryRun,
			SyncSuccessful: true,
			ProcessedKeys:  map[string]bool{"1": true},
		}
		if err := b.DeleteOrphans("counted_orphans", cmIDKey, "counted_orphan", ""); err != nil {
			t.Fatalf("DeleteOrphans: %v", err)
		}
		want := 6
		if dryRun {
			want = 4
		}
		if b.Stats.Deleted != want {
			t.Errorf("dryRun=%v: Stats.Deleted = %d, want %d", dryRun, b.Stats.Deleted, want)
		}
	}
}

func TestDeleteOrphansFromPreloadedCountsItsDeletionsInStats(t *testing.T) {
	t.Parallel()
	for _, dryRun := range []bool{false, true} {
		app := newBaseSyncDryRunTestApp(t, "counted_preloaded")
		rows := seedOrphanRows(t, app, "counted_preloaded", "1", "2")
		b := &BaseSyncService{
			App:            app,
			Stats:          Stats{},
			DryRun:         dryRun,
			SyncSuccessful: true,
			ProcessedKeys:  map[string]bool{"1|2027": true},
		}
		preloaded := map[any]*core.Record{"1|2027": rows[0], "2|2027": rows[1]}
		if err := b.DeleteOrphansFromPreloaded(preloaded, "counted_preloaded"); err != nil {
			t.Fatalf("DeleteOrphansFromPreloaded: %v", err)
		}
		want := 1
		if dryRun {
			want = 0
		}
		if b.Stats.Deleted != want {
			t.Errorf("dryRun=%v: Stats.Deleted = %d, want %d", dryRun, b.Stats.Deleted, want)
		}
	}
}

func TestPersonsHouseholdSweepCountsItsDeletionsInStats(t *testing.T) {
	t.Parallel()
	for _, dryRun := range []bool{false, true} {
		app := newHouseholdsTestApp(t)
		seedHousehold(t, app, 100, 2027)
		seedHousehold(t, app, 900, 2027) // an orphan
		s := &PersonsSync{BaseSyncService: BaseSyncService{
			App:            app,
			DryRun:         dryRun,
			ProcessedKeys:  map[string]bool{},
			FieldDiffStats: map[string]int{},
		}}
		if err := s.deleteHouseholdOrphans(2027, map[int]bool{100: true}); err != nil {
			t.Fatalf("deleteHouseholdOrphans: %v", err)
		}
		want := 1
		if dryRun {
			want = 0
		}
		if s.Stats.Deleted != want {
			t.Errorf("dryRun=%v: Stats.Deleted = %d, want %d", dryRun, s.Stats.Deleted, want)
		}
	}
}

func TestDeleteOrphansFailedDeleteIsAnErrorNotADeletion(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "failing_orphans")
	seedOrphanRows(t, app, "failing_orphans", "1", "2", "3")
	app.OnRecordDelete("failing_orphans").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("cm_id") == "2" {
			return errors.New("forced delete failure")
		}
		return e.Next()
	})
	b := &BaseSyncService{
		App:            app,
		Stats:          Stats{Deleted: 4},
		SyncSuccessful: true,
		ProcessedKeys:  map[string]bool{"1": true},
	}
	if err := b.DeleteOrphans("failing_orphans", cmIDKey, "failing_orphan", ""); err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}
	if b.Stats.Deleted != 5 { // only the row 3 delete landed
		t.Errorf("Stats.Deleted = %d, want 5", b.Stats.Deleted)
	}
	if b.Stats.Errors != 1 {
		t.Errorf("Stats.Errors = %d, want 1", b.Stats.Errors)
	}
	left, err := app.FindAllRecords("failing_orphans")
	if err != nil {
		t.Fatalf("FindAllRecords: %v", err)
	}
	kept := map[string]bool{}
	for _, r := range left {
		kept[r.GetString("cm_id")] = true
	}
	if len(left) != 2 || !kept["1"] || !kept["2"] {
		t.Errorf("rows left = %v, want the processed row 1 and the undeletable row 2", kept)
	}
}

func TestDeleteOrphansDryRunLeavesEveryRow(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "dry_orphans")
	seedOrphanRows(t, app, "dry_orphans", "1", "2", "3")
	b := &BaseSyncService{App: app, DryRun: true, SyncSuccessful: true, ProcessedKeys: map[string]bool{"1": true}}
	if err := b.DeleteOrphans("dry_orphans", cmIDKey, "dry_orphan", ""); err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}
	left, err := app.FindAllRecords("dry_orphans")
	if err != nil {
		t.Fatalf("FindAllRecords: %v", err)
	}
	if len(left) != 3 {
		t.Errorf("a dry run left %d rows, want 3", len(left))
	}
}
