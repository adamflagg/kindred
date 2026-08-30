package sync

import "log/slog"

// Cadence is the set of crons that run a job. A bitset rather than one slice per cron
// because a job may be on more than one -- bunk_assignments is both hourly and daily, and a
// slice-per-cadence can only say that by listing it twice.
type Cadence uint8

const (
	// CadenceHourly is scheduler.go's hourly cron, "0 * * * *".
	CadenceHourly Cadence = 1 << iota
	// CadenceDaily is scheduler.go's nightly cron, "0 3 * * *".
	CadenceDaily
	// CadenceWeeklyGlobal is scheduler.go's Sunday global-definitions cron, "0 2 * * 0".
	CadenceWeeklyGlobal
	// CadenceWeeklyCustomValues is scheduler.go's Sunday custom-values cron, "0 4 * * 0".
	CadenceWeeklyCustomValues
)

// Trigger is the set of operator-facing entry points that may start a job. See
// TriggerIndividualRoute's own comment for why it is a declared fact rather than a generator.
type Trigger uint8

const (
	// TriggerIndividualRoute is a DECLARED FACT checked against api.go's route table, not a
	// generator: the handlers genuinely differ (process-requests takes force/session, the CSV
	// upload is multipart, several run their own conflict checks), so generating them would cost
	// more than it saves. The frontend's `manualTrigger` flag is the same fact on the other side
	// and is already pinned to the route table by syncTypes.test.ts (kindred#2593).
	TriggerIndividualRoute Trigger = 1 << iota
	// TriggerPhaseRun is an admin-triggered "Run Phase" button, filtered by phaseExecutionJobs.
	TriggerPhaseRun
	// TriggerFullRun is membership in a unified ("all services") sync run.
	TriggerFullRun
)

func jobsWithCadence(c Cadence) []string {
	var ids []string
	for _, m := range syncJobMeta {
		if m.Cadences&c != 0 {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

func jobsWithTrigger(t Trigger) []string {
	var ids []string
	for _, m := range syncJobMeta {
		if m.Triggers&t != 0 {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

func inPhaseWithTrigger(p Phase, t Trigger) []string {
	var ids []string
	for _, m := range syncJobMeta {
		if m.Phase == p && m.Triggers&t != 0 {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

// hasTrigger reports whether id declares trigger t. An unregistered id has none, which is
// what makes this usable as a whitelist.
func hasTrigger(id string, t Trigger) bool {
	for _, m := range syncJobMeta {
		if m.ID == id {
			return m.Triggers&t != 0
		}
	}
	return false
}

func allJobIDs() []string {
	ids := make([]string, 0, len(syncJobMeta))
	for _, m := range syncJobMeta {
		ids = append(ids, m.ID)
	}
	return ids
}

// available drops jobs whose environment gate is closed (IS_DOCKER, google.IsEnabled), logging
// at Debug level which job and that its gate was the reason. This is what RunDailySync used to
// give one job by name ("Skipping process_requests in development mode..."); dropping the
// hand-spelled special case in favor of the Gate field lost it. Restored here instead, uniform
// across every gated row -- previously a google-disabled multi_workbook_export was dropped with
// no explanation at all.
func available(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if g := jobGate(id); g == nil || g() {
			out = append(out, id)
		} else {
			slog.Debug("sync job skipped: environment gate closed", "job", id)
		}
	}
	return out
}

func jobGate(id string) func() bool {
	for _, m := range syncJobMeta {
		if m.ID == id {
			return m.Gate
		}
	}
	return nil
}

// orderQueue applies the ONE place execution order departs from registry order.
//
// stranded_assignment_cleanup runs LAST, after bunk_plans is final, so it can sweep scenario
// drafts left stranded by bunk-plan reorganizations (#1416, #1417). Normalized 2026-08-29:
// it previously ran dead-last on the daily cron but mid-Transform on a full run. Both
// satisfied its stated reason (bunk_plans is a Source job, final well before either point),
// so one rule replaces two.
//
// Nothing else may be added here. A second exception means the registry ORDER is wrong and
// the rows should move, not this function.
func orderQueue(ids []string) []string {
	const last = "stranded_assignment_cleanup"
	out := make([]string, 0, len(ids))
	found := false
	for _, id := range ids {
		if id == last {
			found = true
			continue
		}
		out = append(out, id)
	}
	if found {
		out = append(out, last)
	}
	return out
}

// cadenceQueue is the runnable, correctly-ordered queue for one cron.
func cadenceQueue(c Cadence) []string { return orderQueue(available(jobsWithCadence(c))) }
