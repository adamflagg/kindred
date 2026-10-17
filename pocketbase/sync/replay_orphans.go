package sync

import "log/slog"

// A historical replay (POST /api/custom/sync/run for a year outside the synced pair N, N-1)
// keeps every session group, session, person and household it would otherwise sweep: the same
// rule the weekly all-seasons re-sync applies to an older season (all_seasons_resync.go),
// applied to a replay's full job list.
//
// A replay re-fetches one old season from CampMinder, and CampMinder's answer for an old season
// is not what Kindred stored when that season was live: people merged since, records purged,
// staff-only people the feed no longer returns, sessions renamed or removed. Each of those reads
// as an orphan, and the delete cascades into history a replay never rebuilds. A camp_sessions
// row takes that season's bunk_assignments, bunk_plans and lodging rows with it; a persons row
// its bunk_assignments, financial_aid_applications, household_demographics,
// original_bunk_requests and person_custom_values; a households row its family_camp_* rows and
// household_demographics. So on a replay those sweeps delete nothing and log how many rows they
// kept.
//
// Every other sweep runs as normal. The attendees sweep must: a stale enrollment (a person
// CampMinder merged into another) would otherwise count twice. The derived jobs' sweeps judge a
// row by whether this run recomputed it from the stored tables, and the replay rebuilds those
// tables; with persons and households kept, none of them deletes a row only because its person
// or household is gone.
//
// The flag is run-scoped: RunSyncWithOptions sets it on the season instances a replay builds
// (replayOverrides), which are never registered and are dropped when the run ends, so the
// registered instances the nightly and the hourly run use are never touched.

// replayKeepOrphanJobs are the jobs whose sweeps keep every row on a historical replay: the
// all-seasons re-sync's jobs except its one sweeping job (allSeasonsResyncJobs minus
// allSeasonsSweepingJob, pinned by TestReplayKeepSetMatchesTheAllSeasonsResync). persons owns two
// sweeps: the persons one (BaseSyncService) and the households one (deleteHouseholdOrphans).
var replayKeepOrphanJobs = []string{"session_groups", "sessions", "persons"}

// replayOrphanKeeper is a service whose sweeps a historical replay can switch to keep-and-count.
type replayOrphanKeeper interface {
	keepOrphansForReplay()
}

// keepOrphansForReplay makes every sweep this service owns keep its rows for the run, and count
// them: the read-only scan still runs, so the log says how many rows the replay kept.
func (b *BaseSyncService) keepOrphansForReplay() {
	b.keepOrphans = true
	b.countKeptOrphans = true
}

// keepReplayOrphans switches the replay's own instance of each replayKeepOrphanJobs job to keep
// its orphans. overrides are the season instances replayOverrides built for this run; a job with
// no instance there runs its registered one, which is left alone.
func keepReplayOrphans(overrides map[string]Service) {
	for _, job := range replayKeepOrphanJobs {
		if k, ok := overrides[job].(replayOrphanKeeper); ok {
			k.keepOrphansForReplay()
		}
	}
}

// logReplayKeptOrphans logs a sweep a historical replay kept, with the number of rows it would
// have deleted. A failed sync's processed set is incomplete, so its count would overstate; that
// case says it kept the rows without counting them.
func logReplayKeptOrphans(entityName string, syncSuccessful bool, orphans func() (int, error)) {
	if !syncSuccessful {
		slog.Info("Keeping orphans on a historical replay: the sync failed, so they are not counted",
			"entity", entityName)
		return
	}
	n, err := orphans()
	if err != nil {
		slog.Warn("Keeping orphans on a historical replay: they could not be counted",
			"entity", entityName, "error", err)
		return
	}
	slog.Info("Keeping orphans on a historical replay: deleting none",
		"entity", entityName, "kept", n)
}
