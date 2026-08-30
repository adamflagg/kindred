package sync

import (
	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Scope narrows the cohort a job covers.
//
// ScopeAll is the unrestricted default and never appears in a job id. Every other scope
// produces a DISTINCT registered id, and that is deliberate rather than incidental:
// sync_runs.service, o.runningJobs, o.lastCompletedStatus and the sync-status payload are all
// keyed by the id, so collapsing the variants onto one name would give the nightly bounded
// pass and the Sunday sweep a single status row. That is precisely what kindred#2482, #2489,
// #2491 and #2591 were spent avoiding -- distinguishable logs, per-variant completion
// detection for the Refresh Housing cutover, and per-variant ETAs on the client.
//
// One declaration, two identities.
type Scope string

const (
	// ScopeAll is the unrestricted cohort -- the whole year, or the Session filter.
	ScopeAll Scope = ""
	// ScopeFamilyCamp is the bounded daily family-camp cohort: attendees of every
	// family-camp weekend at ANY status (kindred#2482).
	ScopeFamilyCamp Scope = "family_camp"
)

// scopedID returns the registered service name for a base job at a scope. This is the ONLY
// place the scope suffix is constructed; nothing else may concatenate it by hand. The
// hand-maintained lists elsewhere in the package still spell the full id -- syncJobMeta's own
// rows, orchestrator.go's getDailySyncJobs, api.go's statusSyncTypes and table_exporter.go's
// SyncJobToCollections. Stage 2 of this refactor removes those. InitializeSyncServices'
// registration loop is NOT one of them: it spells only the base, via
// scopedServiceRegistrations, and lets scopedID build the rest.
func scopedID(base string, scope Scope) string {
	if scope == ScopeAll {
		return base
	}
	return base + "_" + string(scope)
}

// JobScope returns the scope a job id was registered under, or ScopeAll for a base job or an
// id absent from the registry.
func JobScope(id string) Scope {
	for _, m := range syncJobMeta {
		if m.ID == id {
			return m.Scope
		}
	}
	return ScopeAll
}

// JobBase returns the unscoped job a scoped variant narrows, or the id itself for a base job.
// This is what makes two variants recognizable as writers of the same PocketBase collection.
func JobBase(id string) string {
	for _, m := range syncJobMeta {
		if m.ID == id {
			if m.Base != "" {
				return m.Base
			}
			return m.ID
		}
	}
	return id
}

// ScopedJobs returns every job registered under scope, in registry order -- with one
// deliberate exception: it returns nil for ScopeAll rather than the ~28 unscoped rows.
// ScopeAll is the ABSENCE of a scope, not a cohort, and every caller wants "the variants",
// so returning the whole registry there would silently widen an exclusion set
// (buildScopedJobSet feeds phaseExecutionJobs) into excluding everything.
//
// It composes badly with JobScope's registry-miss fallback and that is worth knowing before
// writing `for range ScopedJobs(JobScope(id))`: JobScope returns ScopeAll both for a base job
// and for an id absent from syncJobMeta, so such a loop yields an empty body in both cases
// without distinguishing them. Ask JobBase (or look the row up) if the difference matters.
func ScopedJobs(scope Scope) []string {
	if scope == ScopeAll {
		// See the doc comment: ScopeAll is "unscoped", so there are no variants to return.
		return nil
	}
	var ids []string
	for _, m := range syncJobMeta {
		if m.Scope == scope {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

// buildScopedJobSet returns a membership set of every job registered under scope.
func buildScopedJobSet(scope Scope) map[string]bool {
	set := make(map[string]bool)
	for _, id := range ScopedJobs(scope) {
		set[id] = true
	}
	return set
}

// scopedService is a Service whose cohort can be narrowed at registration time.
type scopedService interface {
	Service
	SetScope(Scope)
}

// scopedServiceRegistration pairs the base service name a scoped instance narrows with the
// instance itself.
type scopedServiceRegistration struct {
	base  string
	scope Scope
	svc   scopedService
}

// scopedServiceRegistrations returns every scoped service instance InitializeSyncServices
// registers, in registration order. It is a function rather than an inline literal so that
// the registration list and TestScopedVariantContract's "is registered as a service" clause
// read the SAME table: a syncJobMeta row carrying a Scope that nothing here constructs is a
// queue entry that fails at run time, and no test in the package could otherwise see the gap.
//
// A slice (not a map) keeps registration order -- and so the boot-log line order --
// deterministic across runs. scopedID constructs only the registered name's suffix; the base
// half is spelled with the same serviceName{PersonCustomValues,HouseholdCustomValues}
// constants each Service's own logJobName() builds from, and that is what keeps the two in
// sync, not scopedID.
func scopedServiceRegistrations(app core.App, client *campminder.Client) []scopedServiceRegistration {
	return []scopedServiceRegistration{
		// Bounded daily family-camp custom-values pass (kindred#2482) -- distinct service
		// instances from the unrestricted pair, scoped to family-camp attendees (any
		// status) rather than Session. Part of the daily cron: see getDailySyncJobs.
		{serviceNamePersonCustomValues, ScopeFamilyCamp, NewPersonCustomFieldValuesSync(app, client)},
		{serviceNameHouseholdCustomValues, ScopeFamilyCamp, NewHouseholdCustomFieldValuesSync(app, client)},
	}
}
