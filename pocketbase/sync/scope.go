package sync

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
// place a scoped job id is spelled; nothing else may concatenate the suffix by hand.
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

// ScopedJobs returns every job registered under scope, in registry order.
func ScopedJobs(scope Scope) []string {
	if scope == ScopeAll {
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
