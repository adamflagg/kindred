// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"math/rand/v2"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// statusFailed indicates a sync job has failed
	statusFailed = "failed"
	// statusRunning indicates a sync job is currently running
	statusRunning = "running"
	// statusPending indicates a sync job is queued
	statusPending = "pending"
	// statusSuccess indicates a sync job finished successfully
	statusSuccess = "success"
	// statusCompleted indicates a sync job has completed successfully
	statusCompleted = "completed"

	// Run type constants for GetCurrentRunProgress
	runTypeDaily        = "daily"
	runTypeHistorical   = "historical"
	runTypeWeekly       = "weekly"
	runTypeCustomValues = "custom_values"
)

// Trigger constants label how a run was started. They are persisted verbatim to
// sync_runs.trigger, which is a select field — its allowed values in
// pb_migrations/1500000152_sync_runs.js must match this list exactly or the write is
// rejected.
//
// Four of the six coincide with the run types above and are aliased rather than repeated, so
// that a rename cannot make GetCurrentRunProgress and the persisted trigger disagree. The
// other two have no run-type equivalent: `hourly` because the hourly cron drives a single
// service rather than a tracked queue, and `manual` because an operator-initiated run has no
// queue around it at all.
//
// Trigger is stored because it cannot be reconstructed. Everything else about a finished run
// can be re-derived from `service`, but nothing in the row says whether it came from the 3am
// cron or from someone pressing a button.
const (
	triggerHourly       = "hourly"
	triggerDaily        = runTypeDaily
	triggerWeekly       = runTypeWeekly
	triggerCustomValues = runTypeCustomValues
	triggerHistorical   = runTypeHistorical
	triggerManual       = "manual"
)

// Phase represents a category of sync jobs
type Phase string

const (
	// PhaseSource - CampMinder API → PocketBase
	PhaseSource Phase = "source"
	// PhaseExpensive - CampMinder API (1 call/entity, rate limited)
	PhaseExpensive Phase = "expensive"
	// PhaseTransform - PocketBase → PocketBase (no API)
	PhaseTransform Phase = "transform"
	// PhaseProcess - CSV import + AI processing
	PhaseProcess Phase = "process"
	// PhaseExport - PocketBase → Google Sheets
	PhaseExport Phase = "export"
	// PhaseGlobal is a classification, NOT an execution phase: see GetAllPhases. Cross-year
	// definition tables, refreshed by the Sunday-2am cron (CadenceWeeklyGlobal).
	PhaseGlobal Phase = "global"
)

// JobMeta contains metadata about a sync job
type JobMeta struct {
	ID          string
	Phase       Phase
	Description string
	// Base names the unscoped job a scoped variant narrows; "" for a base job. Two rows
	// sharing a Base write the same PocketBase collections under different registered
	// names, which is what the mutual-exclusion check keys on (kindred#2491).
	Base string
	// Scope marks this row as a SCOPED VARIANT: a narrower-cohort instance of the job
	// named by Base, registered under scopedID(Base, Scope). It is structural, not
	// topical -- a row that merely concerns family camp (family_camp_derived,
	// lodging_assignments) is its own job and leaves this empty. Setting it drags the row
	// into TestScopedVariantContract, which would then fail on wiring that row never
	// needed. "" (ScopeAll) for every job that is not a variant of another. See the Scope
	// type.
	Scope Scope
	// Cadences is the set of crons that queue this job. See the Cadence type.
	Cadences Cadence
	// Triggers is the set of operator-facing entry points that may start this job. See the
	// Trigger type.
	Triggers Trigger
	// CurrentYearOnly marks a job that only makes sense against the live season -- a
	// historical replay must exclude it. Must match the frontend's `currentYearOnly` flag
	// (frontend/src/components/admin/syncTypes.ts) exactly; Stage 3 adds the test that pins
	// the two together.
	CurrentYearOnly bool
	// Gate is an environment check a job must pass before a derived queue includes it --
	// IS_DOCKER for process_requests, google.IsEnabled for multi_workbook_export. nil means
	// unconditionally available. This is a RUNTIME check, distinct from Cadences/Triggers,
	// which are static declarations of what a job is eligible for.
	Gate func() bool
}

// syncJobMeta defines the phase and metadata for all sync jobs
// Jobs are listed in execution order within their phase
var syncJobMeta = []JobMeta{
	// Global phase -- cross-year definition tables, refreshed by the Sunday-2am cron.
	// PhaseGlobal is a classification, NOT an execution phase: see GetAllPhases. These carry
	// only CadenceWeeklyGlobal and TriggerIndividualRoute, so they appear in no daily,
	// phase-run or full-run queue and cannot perturb any derived ordering below.
	{ID: "person_tag_defs", Phase: PhaseGlobal, Description: "Tag definitions",
		Cadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute},
	{ID: "custom_field_defs", Phase: PhaseGlobal, Description: "Custom field definitions",
		Cadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute},
	{ID: "staff_lookups", Phase: PhaseGlobal, Description: "Positions, org categories, program areas",
		Cadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute},
	{ID: "financial_lookups", Phase: PhaseGlobal, Description: "Financial categories, payment methods",
		Cadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute},
	{ID: "divisions", Phase: PhaseGlobal, Description: "Division definitions (no year field)",
		Cadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute},

	// Source phase - CampMinder API calls
	//
	// The daily ordering below (getDailySyncJobs = cadenceQueue(CadenceDaily)) walks these
	// rows in declaration order, so each row's dependency comment doubles as the reason it
	// sits where it does relative to its neighbors. person_tag_defs, custom_field_defs and
	// divisions are NOT among them -- those are PhaseGlobal rows above that run on the
	// weekly cron (GetWeeklySyncJobs) instead, since they rarely change.
	//
	// No dependencies -- sync first so its session_group relation exists for sessions.
	{ID: "session_groups", Phase: PhaseSource,
		Description: "Session groups from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Depends on session_groups (for the session_group relation).
	{ID: "sessions", Phase: PhaseSource,
		Description: "Sessions from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Depends on sessions.
	{ID: "attendees", Phase: PhaseSource,
		Description: "Attendees from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Depends on attendees and divisions. Combined sync: a single CampMinder API call
	// populates both the persons and households tables (tags are stored as a multi-select
	// relation on persons).
	{ID: "persons", Phase: PhaseSource,
		Description: "Persons + households from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// No dependencies.
	{ID: "bunks", Phase: PhaseSource,
		Description: "Bunks from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Depends on sessions and bunks.
	{ID: "bunk_plans", Phase: PhaseSource,
		Description: "Bunk plans from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// bunk_assignments is the ONLY job on two crons: the hourly refresh (RunHourlySync)
	// as well as the daily sweep, which is what CadenceHourly's bitset exists to express
	// without listing this row twice. Depends on sessions, persons, bunks.
	{ID: "bunk_assignments", Phase: PhaseSource,
		Description: "Bunk assignments from CampMinder",
		Cadences:    CadenceHourly | CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Staff sync: depends on divisions, bunks, persons.
	{ID: "staff", Phase: PhaseSource,
		Description: "Staff from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Source data: depends on sessions, persons, households, divisions.
	{ID: "financial_transactions", Phase: PhaseSource,
		Description: "Financial transactions from CampMinder",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},

	// Expensive phase - Custom values (on-demand, rate limited)
	// The unrestricted pair runs on the weekly custom-values cron ("0 4 * * 0"), not the
	// daily one -- getDailySyncJobs runs the bounded family-camp variants below instead.
	{ID: "person_custom_values", Phase: PhaseExpensive,
		Description: "Person custom field values",
		Cadences:    CadenceWeeklyCustomValues, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "household_custom_values", Phase: PhaseExpensive,
		Description: "Household custom field values",
		Cadences:    CadenceWeeklyCustomValues, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Bounded daily family-camp pass (kindred#2482), scheduled here in the registry's own
	// declaration order -- between the source jobs above and the transform jobs below -- so
	// the transform phase (below) sees today's cabin answers instead of up to 7 days stale
	// ones. Same API cost per entity as the two rows above; scoped to family-camp attendees
	// (any status, via SessionResolver's attendees-backed cohort) so it stays cheap: ~11.5
	// min for ~450 households against the weekly sweep's ~43 min for everyone. The weekly
	// unrestricted sweep (Scheduler, cron "0 4 * * 0", the two rows above) is UNCHANGED and
	// still refreshes every other custom-values consumer -- dietary, transportation,
	// financial aid, staff skills, and so on. No Triggers: neither has an individual POST
	// route (they run only inside the daily cron), and phaseExecutionJobs deliberately
	// excludes them from an admin-triggered PhaseExpensive run, and they must never join a
	// full run (#2489) -- so all three trigger bits stay unset, matching the frontend's
	// manualTrigger: false.
	{ID: "person_custom_values_family_camp", Phase: PhaseExpensive,
		Description: "Person custom field values -- bounded daily pass, family-camp attendees, any status",
		Base:        "person_custom_values", Scope: ScopeFamilyCamp,
		Cadences: CadenceDaily, CurrentYearOnly: true},
	{ID: "household_custom_values_family_camp", Phase: PhaseExpensive,
		Description: "Household custom field values -- bounded daily pass, family-camp attendees, any status",
		Base:        "household_custom_values", Scope: ScopeFamilyCamp,
		Cadences: CadenceDaily, CurrentYearOnly: true},

	// Transform phase - PocketBase → PocketBase. On the daily cron, these run using the
	// freshest source data above, plus today's family-camp custom values (the bounded pass
	// immediately above) and every other custom value from the most recent weekly sync. New
	// enrollments, session changes, etc. are reflected immediately.
	{ID: "family_camp_derived", Phase: PhaseTransform,
		Description: "Compute family camp tables from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	// Also records lodging_value_history alongside the current-state table.
	{ID: "lodging_assignments", Phase: PhaseTransform,
		Description: "Derive lodging assignments from CampMinder cabin fields",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "staff_skills", Phase: PhaseTransform,
		Description: "Extract staff skills from person_custom_values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "financial_aid_applications", Phase: PhaseTransform,
		Description: "Extract FA applications from person_custom_values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "household_demographics", Phase: PhaseTransform,
		Description: "Compute household demographics from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "camper_dietary", Phase: PhaseTransform,
		Description: "Extract camper dietary/allergy info from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "camper_transportation", Phase: PhaseTransform,
		Description: "Extract camper transportation info from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "quest_registrations", Phase: PhaseTransform,
		Description: "Extract Quest program registration info from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "staff_applications", Phase: PhaseTransform,
		Description: "Extract staff application info from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "staff_vehicle_info", Phase: PhaseTransform,
		Description: "Extract staff vehicle info from custom values",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "normalize_geographic", Phase: PhaseTransform,
		Description: "Normalize geographic data (cities, schools, congregations)",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "enrollment_snapshots", Phase: PhaseTransform,
		Description: "Capture daily enrollment counts per session",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},
	{ID: "stranded_assignment_cleanup", Phase: PhaseTransform,
		Description: "Auto-unassign scenario drafts stranded by bunk or cancellation",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun},

	// Process phase - CSV + AI
	// reconcile_request_lifecycle has no individual POST route (it runs only inside the
	// daily cron and a current-year unified run, via its CurrentYearOnly bit), but a Run
	// Phase button on the Process phase really does start it, so TriggerPhaseRun stays set
	// even though TriggerIndividualRoute does not.
	//
	// The bit is now what decides that. phaseExecutionJobs is inPhaseWithTrigger(phase,
	// TriggerPhaseRun), which reads the Triggers field for EVERY phase -- it no longer
	// special-cases PhaseExpensive, as it did when it filtered a scope-derived exclusion
	// set by hand.
	{ID: "reconcile_request_lifecycle", Phase: PhaseProcess,
		Description: "Mark moved-requester OBRs for reprocessing",
		Cadences:    CadenceDaily, Triggers: TriggerPhaseRun | TriggerFullRun, CurrentYearOnly: true},
	// Depends on persons.
	{ID: "bunk_requests", Phase: PhaseProcess,
		Description: "Import bunk request CSV",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun,
		CurrentYearOnly: true},
	// process_requests only runs in Docker (Gate) -- development skips AI processing to
	// avoid unnecessary API costs, matching getDailySyncJobs' IS_DOCKER check.
	{ID: "process_requests", Phase: PhaseProcess,
		Description: "AI processing of bunk requests",
		Cadences:    CadenceDaily, Triggers: TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun,
		CurrentYearOnly: true,
		Gate:            func() bool { return os.Getenv("IS_DOCKER") == boolTrueStr }},

	// Export phase - Google Sheets
	// TriggerFullRun (Stage 4/Task 13): a full or historical run now queues this job like any
	// other instead of going through RunSyncWithOptions' old hardcoded epilogue (deleted this
	// task), so it finally produces a sync_runs row, a status transition and a completion
	// toast. CadenceWeeklyGlobal is new too: the Sunday-2am global cron now exports the four
	// global tables it just refreshed, which nothing did before. Both were deliberately
	// withheld until this task -- setting TriggerFullRun earlier would have double-exported on
	// every unified run while the epilogue still fired (TestExportRunsExactlyOnceInAFullRun is
	// the regression guard).
	{ID: "multi_workbook_export", Phase: PhaseExport,
		Description: "Export to Google Sheets",
		Cadences:    CadenceDaily | CadenceWeeklyGlobal,
		Triggers:    TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun,
		Gate:        google.IsEnabled},
}

// GetJobMeta returns the sync job metadata array
func GetJobMeta() []JobMeta {
	return syncJobMeta
}

// GetJobsForPhase returns job IDs for a specific phase
func GetJobsForPhase(phase Phase) []string {
	var jobs []string
	for _, meta := range syncJobMeta {
		if meta.Phase == phase {
			jobs = append(jobs, meta.ID)
		}
	}
	return jobs
}

// GetAllPhases returns all phases in execution order
func GetAllPhases() []Phase {
	return []Phase{
		PhaseSource,
		PhaseExpensive,
		PhaseTransform,
		PhaseProcess,
		PhaseExport,
	}
}

// GetPhaseForJob returns the phase for a given job ID
func GetPhaseForJob(jobID string) Phase {
	for _, meta := range syncJobMeta {
		if meta.ID == jobID {
			return meta.Phase
		}
	}
	return ""
}

// GetDefaultUnifiedSyncJobs returns the jobs a unified ("all services") sync runs.
//
// Derived from the registry: every job carrying TriggerFullRun, minus CurrentYearOnly jobs on
// a historical replay (isCurrentYear must mean what RunSyncWithOptions's opts.Year == 0 means),
// minus the whole Expensive phase unless includeCustomValues (the flag has always gated the
// phase, not per-job opinions), minus closed environment gates (process_requests' IS_DOCKER
// check runs here via its Gate), ordered by orderQueue -- so stranded_assignment_cleanup now
// runs dead-last, matching the daily cron, instead of mid-Transform (#1416, #1417).
func GetDefaultUnifiedSyncJobs(includeCustomValues, isCurrentYear bool) []string {
	var ids []string
	for _, m := range syncJobMeta {
		if m.Triggers&TriggerFullRun == 0 {
			continue
		}
		if m.CurrentYearOnly && !isCurrentYear {
			continue
		}
		if m.Phase == PhaseExpensive && !includeCustomValues {
			continue
		}
		ids = append(ids, m.ID)
	}
	return orderQueue(available(ids))
}

// ResolveUnifiedSyncServices returns the concrete service names a unified sync with these
// parameters will run, or nil if the named service may not be started individually.
// handleUnifiedSync calls this to validate dry_run support *before* responding, and
// RunSyncWithOptions calls it to decide what to actually run -- one function so the two can
// never quietly drift apart (kindred#2334: a validator that resolves a different list than the
// one that actually runs is worse than no validator). For DefaultService it delegates straight
// to GetDefaultUnifiedSyncJobs, so the two can never resolve different lists either.
//
// A named service is whitelisted against the registry (spec §4: a job may be named
// individually only if it declares a route). Before this, any ?service= string was passed
// straight through, so POST /api/custom/sync/run?service=reconcile_request_lifecycle started a
// real sync from an endpoint that never advertised it, and a typo started a run of one
// nonexistent service. The whitelist waited for Stage 3 because the five PhaseGlobal jobs are
// routed and runnable but had no registry row until Task 9 -- deriving it any earlier would
// have rejected all five (Stage 2 ledger, ruling F5).
//
// nil, not an empty slice: an unresolvable service is a 400 in handleUnifiedSync, never a run
// of nothing. Callers that distinguish must check for nil explicitly.
func ResolveUnifiedSyncServices(service string, includeCustomValues, isCurrentYear bool) []string {
	if service != DefaultService {
		if !hasTrigger(service, TriggerIndividualRoute) {
			return nil
		}
		return []string{service}
	}
	return GetDefaultUnifiedSyncJobs(includeCustomValues, isCurrentYear)
}

// Service defines the interface for sync services
type Service interface {
	Sync(ctx context.Context) error
	GetStats() Stats
}

// Debuggable is an optional interface for services that support debug logging
type Debuggable interface {
	SetDebug(debug bool)
}

// DryRunnable is an optional interface for services that can compute their result without
// writing it. dry_run=true against a service that does not implement this must be rejected
// (see UnsupportedDryRunServices) rather than silently running wet (kindred#2334).
type DryRunnable interface {
	SetDryRun(dryRun bool)
}

// YearSetter is an optional interface for services that need year configuration.
// Services that query year-scoped data should implement this to receive the
// correct year from handleRunPhase before execution.
type YearSetter interface {
	SetYear(year int)
}

// ChangedCollectionsAware is an optional interface for services that can skip work for
// collections a run did not touch. The orchestrator calls it before Sync(), the same way it
// calls SetDryRun and SetYear -- a Service cannot reach back into the orchestrator itself.
//
// The filter belongs to the QUEUE that owns the run, never to the job:
//
//	daily / full / historical / weekly-global queue -> that batch's changed set
//	standalone Run button, Run Phase -> Export      -> nil, meaning "export everything"
//	unified run resolving to ONE service            -> nil, for the same reason: a batch of
//	                                                   one is not a queue, so nothing ran
//	                                                   before it that could have changed
//
// nil and an empty map are DIFFERENT answers: SyncGlobalsOnly and SyncYearData skip on
// `changed != nil && !changed[c]`, so an empty-but-non-nil map exports NOTHING while nil
// exports everything. batchChangedCollections returns a non-nil map for any REGISTERED batch
// (see its own doc comment), so a caller that hands that through unconditionally -- instead of
// clearing it for a standalone run -- silently writes zero sheets and still reports success.
// See TestExportFilterNilVersusEmpty (multi_workbook_export_changed_test.go).
type ChangedCollectionsAware interface {
	SetChangedCollections(changed map[string]bool)
}

// Status represents the status of a sync operation
type Status struct {
	Type      string     `json:"type"`
	Status    string     `json:"status"`
	StartTime time.Time  `json:"start_time"`
	EndTime   *time.Time `json:"end_time,omitempty"`
	Error     string     `json:"error,omitempty"`
	Summary   Stats      `json:"summary"`
	Year      int        `json:"year,omitempty"`      // Year being synced (0 = current year)
	RunToken  string     `json:"run_token,omitempty"` // Unique token per run to prevent cross-run confusion
	// Session is the weekend this run was started FOR, empty when it covers everything
	// (kindred#2601). It is what lets a weekend surface ask "is the run I can see mine?" --
	// before scoping, every Refresh Housing press covered every family-camp weekend, so job
	// NAME was a sufficient identity and nothing needed this.
	//
	// EMPTY MEANS EVERYBODY, not "unknown": the nightly cron genuinely refreshes every
	// weekend, so a consumer must treat an absent session as matching, or the cron would stop
	// driving any weekend's UI.
	//
	// PERSISTED to sync_runs since kindred#2617, and it was in-memory only before that. One
	// slot per job is enough to answer "is the run I can see mine?" about a LIVE run, and not
	// enough afterwards: a press scoped to weekend A overwrites the nightly cron run that
	// covered weekend B, so B's freshness became unanswerable rather than merely old. The
	// column turns "the last run of this job" into "the last run that COVERED this weekend",
	// which is a query over history rather than a read of one slot.
	//
	// CANONICALLY EMPTY FOR AN UNSCOPED RUN, never "all" -- see runOrigin.forSession, which
	// collapses the two so the stored vocabulary is total.
	Session string `json:"session,omitempty"`
	// Trigger records how the run was started (see the trigger constants). Persisted to
	// sync_runs; unreconstructable after the fact.
	Trigger string `json:"trigger,omitempty"`
	// BatchID groups every service execution of one queue — a whole nightly run — under one
	// id. Minted when the queue starts.
	//
	// It is NOT RunToken and must never be merged with it. RunToken is minted per service
	// execution and its one consumer (runSyncAndWait) uses it as a staleness guard: "is this
	// completion my run of this service, or a leftover?". A batch-scoped token would appear
	// to work, because a service normally runs once per batch — right up until a retry puts
	// it in twice, at which point the guard silently stops disambiguating and a waiter
	// accepts the wrong completion.
	BatchID string `json:"batch_id,omitempty"`
}

// QueuedSync represents a sync request waiting in the queue
type QueuedSync struct {
	ID                  string         `json:"id"`
	Year                int            `json:"year"`
	Type                string         `json:"type"`    // "unified", "phase", "individual"
	Service             string         `json:"service"` // unified: "all"; phase: phase name; individual: job name
	IncludeCustomValues bool           `json:"include_custom_values"`
	Debug               bool           `json:"debug"`
	DryRun              bool           `json:"dry_run"`
	Options             map[string]any `json:"options,omitempty"`
	QueuedAt            time.Time      `json:"queued_at"`
	RequestedBy         string         `json:"requested_by"`
}

// MaxQueueSize is the maximum number of syncs that can be queued (0 = unlimited)
const MaxQueueSize = 0

// Stats holds statistics for a sync operation
type Stats struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
	Deleted int `json:"deleted,omitempty"` // For tracking deletions (e.g., removed bunk requests)
	Skipped int `json:"skipped"`
	// SkippedValues counts discarded custom-field VALUES, not records (kindred#2356).
	// camper_transportation.go, staff_applications.go, staff_vehicle_info.go,
	// quest_registrations.go, and household_demographics.go all discard individual
	// unmapped BUS-*/App-*/SVI-*/Quest-*/Q-*/HH-* answers while still creating the
	// record they belong to (see the routed-field cases in their own
	// loadPersonCustomValues / aggregateToRows tests) -- before this counter existed,
	// those discards were folded into Skipped, so a toast reading "274 created, 557
	// skipped" looked like 557 records were dropped when it was really 557 individual
	// answers across some subset of the 274 rows that WERE created.
	//
	// staff_applications.go also has a second flavor (kindred#2277): the answers
	// belonging to a person gated out entirely by the staff-row requirement, whose
	// record was NEVER created. Those land here too, alongside that person's single
	// Skipped increment for the dropped record itself -- SkippedValues is a count of
	// discarded answers regardless of whether the record they'd have populated was
	// created or not; Skipped is what counts the row.
	//
	// Nothing but those five services increments this (kindred#2257 adopted the
	// mechanism at the last two, closing out its mechanism-C sweep); every other
	// Skipped site in this package counts a whole record, and must keep doing so.
	SkippedValues int `json:"skipped_values,omitempty"`
	// Errors counts INFRASTRUCTURE failures only — local SQLite operations that did not
	// complete (App.Save, App.Delete, App.Create, FindRecordsByFilter). There is no healthy
	// run in which this is non-zero, so its tolerance is zero: any non-zero count fails the
	// run. Do not use it for a rejected upstream record — that is Rejected (kindred#2284).
	//
	// The reclassification has shipped (kindred#2295, PR #2299): per-record transform
	// failures now increment Rejected instead, and base_sync.go's skipSweepForRejections
	// stops the orphan sweep for any service that rejected a record, so a rejection no
	// longer costs that record its existing row.
	//
	// Some sites deliberately stay here, because the function they call returns both
	// classes of error through one return value and the call site cannot tell them apart.
	// attendees.go's processEnrollment is the type case: it returns `invalid or missing
	// SessionID` (a rejected record) and also the result of ProcessCompositeRecord's
	// App.Save. Note this is processEnrollment, NOT its caller processAttendee —
	// processAttendee returns only `invalid or missing PersonID` or nil, counting and
	// swallowing processEnrollment's errors itself, so the outer site in attendees.go is
	// unambiguously a rejection. processAssignment, processRow, processPerson and
	// ProcessSimpleRecord are mixed the same way; rejection_sites_test.go names all five.
	//
	// Splitting the genuinely mixed ones needs typed errors from the wrappers — kindred#2292.
	Errors int `json:"errors"`
	// Rejected counts per-record transform failures: one upstream record could not be
	// turned into a PocketBase row, so it was counted and skipped. This is upstream data
	// quality, not a local fault, and it is WARN-ONLY for its first season — surfaced on the
	// Sync tab, never failing a run.
	//
	// The sites that write it shipped in PR #2299 (kindred#2295) alongside the orphan-sweep
	// guard that made rejecting safe, and the duplicate custom-field-value check added four
	// more in PR #2320 (kindred#2270). Deliberately not hand-counted here:
	// rejection_sites_test.go enumerates every site and fails in both directions when one
	// moves, so that census is the list which stays true — a number in this comment would
	// not.
	//
	// Every completed run is now persisted to sync_runs, including this counter, which is
	// what makes warn-only a plan rather than a shrug: a threshold picked today would be a
	// guess, and the season exists to accumulate the distribution to set one from
	// (kindred#2284).
	Rejected int `json:"rejected,omitempty"`
	// DuplicateStaffStatus counts staff records dropped because the same person appeared
	// under more than one CampMinder status in one sync run (kindred#2267). staff.go's
	// allStaffStatuses is iterated in a fixed order and the first status seen for a
	// person-year wins that collapse; this counts every later duplicate it drops. Nothing
	// but staff.go increments this.
	//
	// Deliberately its own field rather than folded into Skipped: base_sync.go's
	// ProcessSimpleRecord no-change branch already increments Skipped for every unchanged
	// row, so on a steady-state run Skipped is roughly the whole roster and a duplicate
	// drop would be invisible inside it. Not persisted to the sync_runs table (sync_runs.go)
	// -- that would need a new migration column, which is out of scope here; the counter
	// still reaches the live Sync tab via this JSON field.
	DuplicateStaffStatus int `json:"duplicate_staff_status,omitempty"`
	// UnresolvedSession counts bunk_assignments the run fetched from CampMinder but could
	// not attach to a session (kindred#2465) -- either the (bunkPlan, bunk) pair named more
	// than one candidate session for a staff member, or no step of the resolution ladder
	// matched at all. Nothing but bunk_assignments.go increments it.
	//
	// Its own field for the reason Stats.DuplicateStaffStatus is: base_sync.go's
	// ProcessCompositeRecord increments Skipped for every unchanged row, so on a
	// steady-state run Skipped is roughly the whole table and an unresolved assignment is
	// invisible inside it. That is not hypothetical -- kindred#2465 deleted 262 staff rows
	// an hour for 119 consecutive runs, every one of them reporting status='success' with a
	// flat skipped_count, because the rows only moved from the no-change bucket into the
	// ambiguous one and both buckets were this same counter.
	//
	// Unlike DuplicateStaffStatus, the branches that write this ALSO increment Skipped, and
	// deliberately: no row was written, which is what Skipped has always counted at these
	// sites, so this is a named subset rather than a replacement and skipped_count keeps its
	// existing meaning. Not persisted to the sync_runs table (sync_runs.go) -- that would need
	// a new migration column.
	//
	// It rides along in the sync-status JSON this struct serializes to, but nothing DISPLAYS
	// it: SyncTab.tsx picks its badges from a hardcoded list (created / updated / skipped /
	// skipped_values / errors) in two places and unresolved_session is in neither -- zero hits
	// for it anywhere in frontend/src. The acceptance surface kindred#2465 names is the
	// bunk_assignments completion log line, which does print it; a badge is frontend work and
	// outside that issue.
	UnresolvedSession int `json:"unresolved_session,omitempty"`
	// Expanded tracks many-to-many expansions (e.g., bunk plans)
	Expanded int `json:"expanded,omitempty"`
	// AlreadyProcessed tracks records already processed (for process_requests)
	AlreadyProcessed int `json:"already_processed,omitempty"`
	// ProdAuditWarnings counts bunk_assignments rows found stranded but not cleared (observe-only).
	ProdAuditWarnings int `json:"prod_audit_warnings,omitempty"`
	// LodgingProdAuditWarnings counts lodging_assignments rows found enrollment-orphaned
	// but not cleared (observe-only; deletion is LodgingAssignmentsSync's job, #2028).
	LodgingProdAuditWarnings int `json:"lodging_prod_audit_warnings,omitempty"`
	// Duration in seconds
	Duration int `json:"duration"`
	// SubStats for combined syncs (e.g., persons includes households)
	SubStats map[string]Stats `json:"sub_stats,omitempty"`
}

// IsNoOp returns true if the sync made no changes to the database.
// A sync is a no-op when Created, Updated, Deleted, and Errors are all zero.
// Skipped records don't affect the data, so they're not considered changes.
func (s *Stats) IsNoOp() bool {
	return s.Created == 0 && s.Updated == 0 && s.Deleted == 0 && s.Errors == 0
}

// applyCompletionStatus decides a finished sync's Status and Error from what the service
// returned and what it counted. All three paths that complete a run normally —
// runSingleSyncInternal, RunSingleSyncWithService and FinalizeSyncStatus — must route
// through it.
//
// "Normally" is load-bearing. The two panic-recovery blocks in runSingleSyncInternal and
// RunSingleSyncWithService set statusFailed directly and deliberately do not call this:
// a panic has no stats to weigh and only one possible verdict. So this is the single place
// that WEIGHS a run, not the only place that ever sets Status.
//
// That routing is the point of the function existing rather than the branch being inlined.
// Before kindred#2284 the three paths each carried their own copy of this decision, so a fix
// applied to one of them left services reached through the other two still reporting green.
//
// The precedence is deliberate:
//
//   - A returned error wins. It carries a real diagnosis; replacing it with a generic count
//     would hide why the run failed.
//   - Otherwise any Stats.Errors fails the run. These are local SQLite operations that did
//     not complete, and there is no healthy run in which that count is non-zero. Before this,
//     PocketBase could refuse to delete a row, the sync would count it, and the operator got
//     a green checkmark.
//   - Stats.Rejected is deliberately absent. Rejected records are upstream data quality and
//     are warn-only for their first season; they are surfaced, never fatal.
func applyCompletionStatus(completed *Status, stats *Stats, err error) {
	dbFailures := totalInfrastructureErrors(stats)

	switch {
	case err != nil:
		completed.Status = statusFailed
		completed.Error = err.Error()
	case dbFailures > 0:
		completed.Status = statusFailed
		completed.Error = fmt.Sprintf("%d database operations failed", dbFailures)
	default:
		completed.Status = statusSuccess
		completed.Error = ""
	}
}

// totalInfrastructureErrors sums a run's Errors count across the service and every
// sub-entity it reports.
//
// Sub-entities are not decorative. `persons` is a combined sync that also populates
// households, and it reports the household half through SubStats (persons.go GetStats).
// Nothing folds that nested count into the parent's, so an escalation that read only
// stats.Errors would let households fail every write it attempted while the run reported
// success — kindred#2284's own bug, reintroduced one layer down.
//
// Summing here rather than inside GetStats keeps the reported stats honest about which layer
// counted what, and keeps the "did this run pass" decision in one place.
func totalInfrastructureErrors(stats *Stats) int {
	total := stats.Errors
	for _, sub := range stats.SubStats {
		// One level deep: SubStats is populated by combined syncs and is not nested further.
		total += sub.Errors
	}
	return total
}

// Options configures how syncs are executed
type Options struct {
	Year                int      // Override year (0 = use default from env)
	Services            []string // Specific services to run (empty = all)
	Concurrent          bool     // Run services in parallel
	IncludeCustomValues bool     // Include custom field values in historical sync
	Debug               bool     // Enable debug logging for custom values sync
	// DryRun computes but does not write, for every service in the run. RunSyncWithOptions
	// refuses to run at all (see UnsupportedDryRunServices) rather than silently write through
	// a service that does not implement DryRunnable (kindred#2334).
	DryRun bool
}

// Orchestrator manages sync service execution
type Orchestrator struct {
	app                 core.App
	services            map[string]Service
	mu                  sync.RWMutex
	runningJobs         map[string]*Status
	lastCompletedStatus map[string]*Status // Store last completed status for each job
	// batchChanged accumulates each in-flight batch's own changed-collections set, keyed by
	// BatchID -- the batch-scoped counterpart to lastCompletedStatus's process-lifetime view.
	// See recordBatchChange and batchChangedCollections.
	batchChanged            map[string]map[string]bool
	jobSpacing              time.Duration
	baseClient              *campminder.Client // Base client for year overrides
	currentSyncYear         int                // Year being synced (0 = current year from env)
	dailySyncRunning        bool               // Track if daily sync sequence is in progress
	dailySyncQueue          []string           // Services queued for daily sync
	historicalSyncRunning   bool               // Track if historical sync sequence is in progress
	historicalSyncQueue     []string           // Services queued for historical sync
	historicalSyncYear      int                // Year being synced in historical sync
	weeklySyncRunning       bool               // Track if weekly sync sequence is in progress
	weeklySyncQueue         []string           // Services queued for weekly sync
	customValuesSyncRunning bool               // Track if custom values sync sequence is in progress
	customValuesSyncQueue   []string           // Services queued for custom values sync
	pendingUnifiedSyncs     []QueuedSync       // Queue of pending unified sync requests (FIFO)
	activeSyncCancel        context.CancelFunc // Cancel function for the currently running sync
	currentRunIndex         int                // 0-based index of currently running job in active queue
}

// NewOrchestrator creates a new orchestrator
func NewOrchestrator(app core.App) *Orchestrator {
	return &Orchestrator{
		app:                 app,
		services:            make(map[string]Service),
		runningJobs:         make(map[string]*Status),
		lastCompletedStatus: make(map[string]*Status),
		batchChanged:        make(map[string]map[string]bool),
		jobSpacing:          2 * time.Second, // Default 2 seconds between jobs
	}
}

// runOrigin says which grouped run a Status belongs to: the trigger that started it, the
// batch id that groups every service execution of that one queue, and the year the run is
// for. It is passed down from whatever started the run.
//
// It is a parameter and not orchestrator state because concurrent runs are guaranteed, not
// merely possible. robfig/cron runs each entry on its own goroutine and the four schedules
// overlap by construction: "0 * * * *" fires alongside "0 3 * * *" every day, and alongside
// both "0 2 * * 0" and "0 4 * * 0" on Sunday. A single shared slot saved and restored around
// each run has those runs overwrite each other — the queue that ends first restores the value
// it captured before the other queue started, so the survivor's remaining jobs are filed as
// unrelated manual runs, and the queue that ends second writes back a trigger that is by then
// stale and leaves it stuck there permanently.
//
// A previous revision justified restore-over-clear by citing two nesting sites. Neither
// nests: RunDailySync calls runGlobalTableBootstrap *before* opening its own batch, and
// RunSyncWithOptions does the same (both called RunWeeklySync directly for this at the time --
// see runGlobalTableBootstrap's own doc comment for why that changed). No beginBatch nesting
// existed anywhere in the tree, so the only thing the shared slot ever did was let concurrent
// runs corrupt each other.
type runOrigin struct {
	// trigger is one of the trigger constants above. Persisted verbatim to
	// sync_runs.trigger, whose select values must match that list exactly.
	trigger string
	// batchID groups every service execution of one queue under one id.
	batchID string
	// year is the year the run is for; 0 means the current season. A historical backfill
	// names its year here so a run started by an unrelated queue while it is in flight
	// cannot be filed under it.
	year int
	// session is the weekend the run was started for, empty when it covers everything.
	// See Status.Session.
	session string
}

// newBatch mints the origin for one grouped run. Every run gets a batch id, a batch of one
// included, so grouping queries over the table stay uniform.
func newBatch(trigger string) runOrigin {
	return runOrigin{trigger: trigger, batchID: generateBatchID()}
}

// forYear returns a copy of the origin filed under an explicit year, for the queues that name
// one — a historical backfill, or a phase sync run against a chosen year.
func (r runOrigin) forYear(year int) runOrigin {
	r.year = year
	return r
}

// forSession returns a copy of the origin filed under one weekend, for a run that covers only
// that weekend rather than the whole cohort (kindred#2601). An empty session is the unscoped
// default and is what every other caller leaves it as.
//
// DefaultSession ("all") COLLAPSES TO EMPTY, and that is load-bearing rather than tidiness.
// The sync-service vocabulary normalises the other way -- normalizeSession turns "" into
// "all" -- so handleRefreshFamilyCamp hands this whichever spelling the caller used, and both
// mean the whole cohort (TestRefreshFamilyCampOverridesEmptyForWholeCohort). Since
// kindred#2617 the value is STORED and then queried as `session = "" || session = <weekend>`,
// so an "all" reaching the column would read as a run scoped to a weekend named "all": it
// would match no weekend at all, and an unscoped press would take every weekend's freshness
// readout silent instead of refreshing all of them.
//
// A NUMERIC SESSION IS STORED CANONICALLY, for the same reason. The stored value is queried
// by exact match against `strconv.Itoa(cm_id)`, so "0100001" would match no weekend and take
// that weekend's readout silent -- the very silence kindred#2617 removes. IsValidSession
// accepts it because it parses; no UI path produces one (frontend/src/services/sync.ts builds
// the parameter from a JS number), so this is a guard on the hand-crafted request. The
// round-trip is deliberately conditional on parsing: summer's identifiers are "2a", "toc" and
// friends, and must pass through untouched even though no caller passes one today.
func (r runOrigin) forSession(session string) runOrigin {
	if session == DefaultSession {
		session = ""
	}
	if n, err := strconv.Atoi(session); err == nil {
		session = strconv.Itoa(n)
	}
	r.session = session
	return r
}

// storeCompletedRun publishes a finished run from a caller holding no lock: it takes o.mu,
// swaps the status maps, releases, and persists the run to sync_runs.
//
// Four of the five places that produce a completed status use it — two normal completions and
// the two panic recoveries. The fifth, FinalizeSyncStatus, does the same two steps inline,
// because it is already inside the critical section that found the run and cannot call this
// without releasing and re-taking o.mu; that gap is exactly the bug publishCompletedLocked
// exists to prevent. So the invariant to hold is one step down, not here: every completion
// path publishes through publishCompletedLocked and then calls recordSyncRun. Adding a sixth
// path means wiring both, in that order.
//
// Note the membership differs from applyCompletionStatus's on purpose: that function WEIGHS a
// run and the panic blocks skip it, having nothing to weigh. A panicked run is still a run
// that happened, so it is still recorded.
//
// Before kindred#2284 the completion decision was copied into three functions, and a fix
// applied to one left the other two reporting green; a persistence call copied into three
// functions would fail the same way, silently omitting whichever path nobody remembered.
func (o *Orchestrator) storeCompletedRun(completed *Status) {
	o.mu.Lock()
	snapshot := o.publishCompletedLocked(completed)
	o.mu.Unlock()

	o.recordSyncRun(&snapshot)
}

// publishCompletedLocked moves a finished run from runningJobs to lastCompletedStatus and
// returns the snapshot the sync_runs write needs. The caller must hold o.mu for writing, and
// must do the DB write after releasing it — a write is far too long to hold a mutex every
// status read contends on.
//
// The swap and the delete are ONE critical section on purpose. Split apart, there is a window
// in which the service is neither running nor completed; MarkSyncRunning succeeds in it,
// because IsRunning is already false, and installs a new Status that the delete then erases.
// That run goes on to find no entry in FinalizeSyncStatus, return early, and produce no
// sync_runs row at all.
func (o *Orchestrator) publishCompletedLocked(completed *Status) Status {
	// Two independent deep copies, and neither is the caller's own Status. The published one
	// is what every GetStatus caller reads (as `statusCopy := *status`, which re-shares a map
	// and a pointer), and the returned one travels to the sync_runs write. Storing the
	// caller's pointer left both of those aliasing whatever produced Summary — a Service that
	// kept a reference to the map it returned from GetStats could rewrite a finished run's
	// counters. That was safe only because every GetStats happens to allocate a fresh map,
	// which nothing states and nothing tests.
	published := snapshotStatus(completed)
	o.lastCompletedStatus[completed.Type] = &published
	delete(o.runningJobs, completed.Type)
	return snapshotStatus(completed)
}

// snapshotStatus copies s deeply enough that the result shares no mutable memory with it.
//
// A plain struct copy is not enough: Summary.SubStats is a map and EndTime is a pointer, so a
// copy still reaches back into whatever produced them. Both of the copies publishCompletedLocked
// makes go somewhere a later mutation must not be able to follow — one into
// lastCompletedStatus, one into the sync_runs write.
func snapshotStatus(s *Status) Status {
	out := *s
	if s.EndTime != nil {
		end := *s.EndTime
		out.EndTime = &end
	}
	if s.Summary.SubStats != nil {
		subs := make(map[string]Stats, len(s.Summary.SubStats))
		maps.Copy(subs, s.Summary.SubStats)
		out.Summary.SubStats = subs
	}
	return out
}

// RegisterService registers a sync service
func (o *Orchestrator) RegisterService(name string, service Service) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.services[name] = service
	slog.Info("Registered sync service", "name", name)
}

// GetService returns a registered sync service by name
func (o *Orchestrator) GetService(name string) Service {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.services[name]
}

// UnsupportedDryRunServices returns, in the given order, the names in services that are
// registered but do not implement DryRunnable. dry_run=true must be rejected rather than run
// wet against any of them (kindred#2334). A name that is not registered at all is left for the
// caller's existing "unknown service" handling -- it is not this helper's job to report it.
func (o *Orchestrator) UnsupportedDryRunServices(services []string) []string {
	var unsupported []string
	for _, name := range services {
		svc := o.GetService(name)
		if svc == nil {
			continue
		}
		if _, ok := svc.(DryRunnable); !ok {
			unsupported = append(unsupported, name)
		}
	}
	return unsupported
}

// BaseClient returns the orchestrator's base CampMinder client (set by InitializeSyncServices).
//
// This exists so on-demand handlers can build a private, request-scoped service instance
// (e.g. NewPersonCustomFieldValuesSync(e.App, orchestrator.BaseClient())) instead of fetching
// and mutating the registered singleton returned by GetService (#2105). baseClient itself
// stays unexported to keep year-override cloning (CloneWithYear) as the orchestrator's own
// concern.
func (o *Orchestrator) BaseClient() *campminder.Client {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.baseClient
}

// IsRunning checks if a sync type is currently running
func (o *Orchestrator) IsRunning(syncType string) bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	status, exists := o.runningJobs[syncType]
	return exists && status.Status == statusRunning
}

// customValuesCollectionGroup maps each job that writes to a shared custom-values PocketBase
// collection to a group key for that collection. The bounded daily family-camp jobs
// ("person_custom_values_family_camp", "household_custom_values_family_camp" -- kindred#2489)
// are registered under distinct service names but write the exact same person_custom_values /
// household_custom_values collections as their unrestricted counterparts (the weekly sweep and
// on-demand runs), so a mutual-exclusion check keyed on the literal job name does not see them
// as the same writer. That gap is kindred#2491: the daily cron's bounded pass and the weekly
// unrestricted sweep (or an operator's on-demand run) could interleave against the same
// collection, racing a concurrent write against deleteOrphans's own read.
//
// person_custom_values and household_custom_values are deliberately in separate groups --
// RunCustomValuesSync documents running them in parallel as safe because they write
// independent collections via independent CampMinder endpoints, and this map must not widen
// the lock across that boundary.
var customValuesCollectionGroup = buildCustomValuesCollectionGroups()

// buildCustomValuesCollectionGroups derives the group map from syncJobMeta: every
// custom-values job maps to its Base (itself, for a base job), so a scoped variant shares a
// group with the unrestricted job it narrows without either name being typed here.
func buildCustomValuesCollectionGroups() map[string]string {
	groups := make(map[string]string)
	for _, m := range syncJobMeta {
		// Phase == PhaseExpensive is today's proxy for "writes a shared custom-values
		// collection" -- every row in that phase is one of the two custom-values jobs or a
		// scoped variant of one. A future PhaseExpensive job that is NOT a custom-values
		// writer would still land here and map to itself (JobBase falls back to m.ID for an
		// unscoped row), but that is inert: customValuesGroupRunningLocked's
		// `name == syncType` branch already covers a job self-excluding, so the entry adds
		// no cross-job exclusion that was not already true.
		if m.Phase != PhaseExpensive {
			continue
		}
		groups[m.ID] = JobBase(m.ID)
	}
	return groups
}

// customValuesGroupRunningLocked reports whether any currently running job shares syncType's
// custom-values collection group (see customValuesCollectionGroup) -- including syncType
// itself. For a syncType outside that map this is exactly the same check IsRunning(syncType)
// makes. Callers must already hold o.mu (read or write lock) -- this function takes no lock of
// its own so it can be composed into an existing check-and-mark critical section.
func (o *Orchestrator) customValuesGroupRunningLocked(syncType string) bool {
	group, tracked := customValuesCollectionGroup[syncType]
	for name, status := range o.runningJobs {
		if status.Status != statusRunning {
			continue
		}
		if name == syncType || (tracked && customValuesCollectionGroup[name] == group) {
			return true
		}
	}
	return false
}

// IsCustomValuesCollectionRunning is the exported, self-locking form of
// customValuesGroupRunningLocked for callers outside the orchestrator (api.go's on-demand
// handlers) that need to check before starting a run rather than as part of one atomic
// check-and-mark critical section.
func (o *Orchestrator) IsCustomValuesCollectionRunning(syncType string) bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.customValuesGroupRunningLocked(syncType)
}

// GetRunningJobs returns all currently running jobs
func (o *Orchestrator) GetRunningJobs() []string {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var running []string
	for name, status := range o.runningJobs {
		if status.Status == statusRunning {
			running = append(running, name)
		}
	}
	return running
}

// IsDailySyncRunning returns whether a daily sync sequence is in progress
func (o *Orchestrator) IsDailySyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.dailySyncRunning
}

// IsHistoricalSyncRunning returns whether a historical sync sequence is in progress
func (o *Orchestrator) IsHistoricalSyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.historicalSyncRunning
}

// GetHistoricalSyncYear returns the year being synced in historical sync
func (o *Orchestrator) GetHistoricalSyncYear() int {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.historicalSyncYear
}

// IsWeeklySyncRunning returns whether a weekly sync sequence is in progress
func (o *Orchestrator) IsWeeklySyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.weeklySyncRunning
}

// registerBatch marks batchID as a live queue batch, initializing its changed-collections set
// to a non-nil, empty map. A queue must call this before any of its jobs can complete, or
// recordBatchChange has nothing to write into and silently drops that job's changes.
//
// This is the fix-round-1 correction to the original design: recordBatchChange used to write
// into ANY batchID unconditionally, including the fresh one-off batches RunSingleSync,
// RunSingleSyncWithService and RunSyncSequence each mint per call and never clean up --
// exactly the unbounded-leak bug this task exists to fix, reintroduced through the paths
// nothing was cleaning up. Gating on registration closes the whole class at once: a batch
// nobody registered gets no entry, so there is nothing for a caller to forget to delete.
//
// registerBatch is deliberately NOT called by RunSingleSync/RunSingleSyncWithService/
// RunSyncSequence, nor by a unified run that resolves to a SINGLE service. None of those is a
// queue: nothing ran before the job that could have changed anything, so there is no set worth
// accumulating and the job correctly receives nil -- "export everything". Registering one
// would be worse than useless: the export would receive a non-nil EMPTY filter and write zero
// sheets while reporting success (final-review Critical C1).
func (o *Orchestrator) registerBatch(batchID string) {
	if batchID == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.batchChanged[batchID] = make(map[string]bool)
}

// recordBatchChange unions service's collections (via SyncJobToCollections) into batchID's
// own changed set, but only when the completion made a real change AND batchID was registered
// by registerBatch. Called from the single completion path every queue routes through --
// applyCompletionStatus's three callers (runSingleSyncInternal, RunSingleSyncWithService,
// FinalizeSyncStatus) -- so it sees every job's completion exactly once, scoped to the batch
// it actually ran in. An unregistered batchID (a batch of one: RunSingleSync,
// RunSingleSyncWithService, RunSyncSequence, or a unified run resolving to a single service) is
// a no-op here, not an error -- see registerBatch.
//
// This is the fix for the process-lifetime approach's limitation (the deleted
// GetChangedCollections, which read lastCompletedStatus -- keyed by service name and
// overwritten on every completion, not scoped to any one run -- so a collection stayed
// "changed" until its job completed again as a no-op). batchChangedCollections reads this map
// instead and answers only for the batch asked about (spec
// 2026-08-29-sync-job-registry-design.md §5, "Batch-scoping the filter").
//
// A no-op completion (stats.IsNoOp()) must not mark its collections changed.
//
//nolint:gocritic // hugeParam: Stats grew past 80B with ProdAuditWarnings; signature refactor out of scope for #1439
func (o *Orchestrator) recordBatchChange(batchID, service string, stats Stats) {
	if batchID == "" || stats.IsNoOp() {
		return
	}
	collections, ok := SyncJobToCollections[service]
	if !ok {
		return
	}

	o.mu.Lock()
	defer o.mu.Unlock()
	if _, registered := o.batchChanged[batchID]; !registered {
		// Not a queue batch -- nothing is waiting on this filter, and nothing will ever
		// delete an entry created here, so creating one would be exactly the leak this
		// registration gate exists to prevent.
		return
	}
	for _, col := range collections {
		o.batchChanged[batchID][col] = true
	}
}

// batchChangedCollections returns the collections changed so far within batchID -- the
// changed-collections filter scoped to one queue's own run rather than the process's whole
// history (the deleted GetChangedCollections' approach).
//
// The nil-versus-empty distinction is load-bearing and mirrors ChangedCollectionsAware's own
// (Task 11): an UNREGISTERED batchID returns nil, meaning "export everything" -- correct for a
// batch nothing ever set up tracking for, such as a bug that somehow reached here with a
// one-off batch id. A REGISTERED batchID that has recorded no real change yet returns a
// non-nil, empty map, meaning "export nothing" -- the ordinary case of asking early in a
// queue's run, or after every job in it turned out to be a no-op.
func (o *Orchestrator) batchChangedCollections(batchID string) map[string]bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	existing, registered := o.batchChanged[batchID]
	if !registered {
		return nil
	}
	result := make(map[string]bool, len(existing))
	for col := range existing {
		result[col] = true
	}
	return result
}

// IsCustomValuesSyncRunning returns whether a custom values sync sequence is in progress
func (o *Orchestrator) IsCustomValuesSyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.customValuesSyncRunning
}

// GetCurrentRunProgress returns progress information for the currently running sync sequence.
// Returns:
//   - runType: "daily", "historical", "weekly", "custom_values", or "" if nothing running
//   - remaining: slice of job IDs that will run after the current job
//   - total: total number of jobs in the current sequence
//   - completed: number of jobs completed so far (currentRunIndex)
func (o *Orchestrator) GetCurrentRunProgress() (runType string, remaining []string, total, completed int) {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// Determine which queue is active and return its remaining jobs
	var queue []string
	switch {
	case o.dailySyncRunning:
		runType = runTypeDaily
		queue = o.dailySyncQueue
	case o.historicalSyncRunning:
		runType = runTypeHistorical
		queue = o.historicalSyncQueue
	case o.weeklySyncRunning:
		runType = runTypeWeekly
		queue = o.weeklySyncQueue
	case o.customValuesSyncRunning:
		runType = runTypeCustomValues
		queue = o.customValuesSyncQueue
	default:
		return "", nil, 0, 0
	}

	total = len(queue)
	completed = o.currentRunIndex
	// Jobs after current one (currentRunIndex points to currently running job)
	if completed+1 < total {
		remaining = queue[completed+1:]
	} else {
		remaining = []string{} // Ensure JSON serializes as [] not null
	}
	return runType, remaining, total, completed
}

// IsAnyJobRunning returns true if any sync job is currently running.
// This is used to queue individual sync requests when another job is already active.
func (o *Orchestrator) IsAnyJobRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	for _, status := range o.runningJobs {
		if status.Status == statusRunning {
			return true
		}
	}
	return false
}

// GetWeeklySyncJobs returns the list of services that run in the weekly sync: the five
// PhaseGlobal rows (definition tables that rarely change and don't need daily updates) plus,
// since Task 13, multi_workbook_export -- CadenceWeeklyGlobal means the Sunday-2am cron now
// also exports the four global tables it just refreshed.
//
// cadenceQueue, not jobsWithCadence directly, so this shares available()'s Gate filtering with
// every other derived queue. That was a no-op for the five PhaseGlobal rows (none carries a
// Gate) but is load-bearing now: multi_workbook_export's Gate is google.IsEnabled, and without
// it a google-disabled environment would have this list name a service that was never
// registered, and RunWeeklySync would log "sync service not found" every week.
func GetWeeklySyncJobs() []string {
	return cadenceQueue(CadenceWeeklyGlobal)
}

// GetRefreshBunkingJobs returns the services needed for a full bunking refresh.
// Runs in order: bunks (fetch latest bunk list), bunk_plans (update plans),
// bunk_assignments (update assignments), then stranded_assignment_cleanup — the bunk_plans
// rewrite is exactly what strands scenario drafts, so they must be swept in the
// same run rather than left until the next daily sync.
func GetRefreshBunkingJobs() []string {
	return []string{
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"stranded_assignment_cleanup",
	}
}

// GetRefreshFamilyCampJobs returns the services needed for a full family-camp
// housing refresh. Runs in order: attendees (roster membership) -> persons
// (household relations) -> person_custom_values_family_camp and
// household_custom_values_family_camp (the raw cabin-preference answers) ->
// family_camp_derived (the roster tables the board reads) -> lodging_assignments
// (the board's mirror of CampMinder's cabin placements).
//
// Two things about this list are deliberate, not oversights:
//
//   - The custom-values jobs are the "_family_camp" BOUNDED variants
//     (kindred#2482), not "person_custom_values" / "household_custom_values".
//     The unrestricted pair costs 42.9 min + 29.0 min; the bounded pair costs
//     8.9 min + 4.0 min for the same freshness an operator-triggered refresh
//     needs.
//   - lodging_assignments runs LAST and is easy to omit. family_camp_derived
//     does NOT write it — LodgingAssignmentsSync is a separate transform job
//     that derives lodging_assignments from CampMinder's cabin custom fields,
//     and it is the table the weekend board's mirror is read from. Ending the
//     chain at family_camp_derived refreshes the roster and leaves the board's
//     mirror at yesterday's cabins.
//
// "sessions" and "session_groups" are deliberately excluded, on
// GetRefreshBunkingJobs' own precedent: a targeted refresh re-runs what must be
// FRESH, not what must merely EXIST.
func GetRefreshFamilyCampJobs() []string {
	return []string{
		"attendees",
		"persons",
		scopedID(serviceNamePersonCustomValues, ScopeFamilyCamp),
		scopedID(serviceNameHouseholdCustomValues, ScopeFamilyCamp),
		"family_camp_derived",
		"lodging_assignments",
	}
}

// GetCustomValuesSyncJobs returns the services the Sunday-4am custom-values cron runs.
// Derived from the registry: these are the unrestricted (ScopeAll) custom-values jobs. The
// bounded family-camp variants carry CadenceDaily instead and are deliberately absent.
//
// cadenceQueue, not jobsWithCadence directly, so this shares available()'s Gate filtering and
// orderQueue's ordering rule with every other derived queue -- a no-op today (neither
// custom-values job carries a Gate, and stranded_assignment_cleanup is not one of them), but a
// future Gate on a custom-values row would otherwise be silently ignored here.
func GetCustomValuesSyncJobs() []string { return cadenceQueue(CadenceWeeklyCustomValues) }

// RunSyncSequence runs multiple sync services sequentially, waiting for each
// to complete before starting the next. Unlike RunSyncWithOptions, this is
// lightweight — no global table checks, no year override, no daily/historical
// tracking. Used for targeted refreshes like bunking (bunks -> bunk_plans ->
// bunk_assignments).
func (o *Orchestrator) RunSyncSequence(ctx context.Context, services []string) error {
	return o.RunSyncSequenceWithServices(ctx, services, nil, "")
}

// RunSyncSequenceWithServices is RunSyncSequence with per-job REQUEST-SCOPED instances.
//
// `overrides` maps a job id to an instance the caller built and configured itself; any job
// absent from the map runs the registered singleton exactly as before, so a nil map is
// RunSyncSequence unchanged. That is the whole compatibility contract -- the crons, Refresh
// Bunking and Run Phase all pass nil and are untouched.
//
// Why this exists rather than a setter the orchestrator applies to the registered instance
// (kindred#2601): configuring the shared singleton per request is what kindred#2105 already
// fixed on the single-job handlers. A rejected (409) request's SetSession stuck before
// MarkSyncRunning ran, silently narrowing whichever request was actually in flight. A queue
// reopens that same gap one level up -- its conflict check happens in the handler, before the
// first job starts -- so the fix has to be the same one: never mutate the registry, hand the
// run its own object. See api.go's handleIndividualSync comments for the original.
//
// The jobs still share ONE batch, which is why this is a variant of the sequence rather than
// a loop of RunSingleSyncWithService calls: batch identity is what groups the six-job refresh
// for the export filter and for the client's completion detection (kindred#2591).
func (o *Orchestrator) RunSyncSequenceWithServices(
	ctx context.Context, services []string, overrides map[string]Service, session string,
) error {
	// A targeted refresh is still a queue, so its jobs are grouped as one batch. It carries
	// no run-type flag and is only ever reached from an operator action, hence manual.
	//
	// The session travels on the ORIGIN rather than on the overridden services, so every job
	// in the batch is attributable -- including the four year-wide ones. The claim it makes
	// is "this run was started for weekend X", which is what a surface needs to know, not
	// "every job in it was narrowed".
	batch := newBatch(triggerManual).forSession(session)

	for _, svc := range services {
		if err := o.runSyncAndWaitWithService(ctx, svc, batch, overrides[svc]); err != nil {
			return fmt.Errorf("sync sequence failed on %s: %w", svc, err)
		}
	}
	return nil
}

// RunSingleSync runs a single sync service.
//
// Every caller is an operator action against one service — an API handler, or a test — so the
// run is manual and forms a batch of one. A queue that wants its jobs grouped calls
// runSyncAndWait with its own batch instead. Its batch id is never registered (see
// registerBatch), so completions routed through it never write into batchChanged -- a
// standalone run has no export waiting on the filter, and nothing would ever clean the entry
// up if it did.
//
// The registered service is a long-lived singleton, and two optional interfaces let earlier
// runs leave state on it that a standalone run must not inherit: a ChangedCollectionsAware
// service (see MultiWorkbookExport) may still hold a queue's changed-collections filter, and a
// YearSetter service (task 11's fix round 2, kindred#2606-series) may still hold a historical
// year from a prior "Run Phase -> Export". Both are cleared explicitly, before the run starts
// -- not-setting is not enough for either, because the batch id this function mints below is
// fresh and would otherwise leave the field exactly as some earlier caller left it.
//
// Fails closed, before starting anything, if the current season can't be resolved for a
// YearSetter service: proceeding would leave the singleton pinned to whatever year a prior
// queue set it to, silently reproducing the exact stale-year hazard this function exists to
// fix (kindred#2606-series task 11). MultiWorkbookExport.Sync() itself takes the same position
// -- "exporting globals against an unknown year is worse than refusing to run at all" -- and
// every other caller in this file that resolves the season (handleIndividualSync, the
// "unified" queue branch) fails closed on it too; swallowing the error here would be the one
// exception, not a neutral default.
func (o *Orchestrator) RunSingleSync(parentCtx context.Context, syncType string) error {
	if svc := o.GetService(syncType); svc != nil {
		if yearSetter, ok := svc.(YearSetter); ok {
			year, err := ParseSeasonYear()
			if err != nil {
				return fmt.Errorf("resolving current season for %s: %w", syncType, err)
			}
			yearSetter.SetYear(year)
		}
		if changedAware, ok := svc.(ChangedCollectionsAware); ok {
			changedAware.SetChangedCollections(nil)
		}
	}

	_, err := o.runSingleSyncInternal(parentCtx, syncType, newBatch(triggerManual), nil)
	return err
}

// runSingleSyncInternal runs a single sync service and returns the run token. `origin` names
// the grouped run this execution belongs to; see runOrigin for why it is a parameter.
// override, when non-nil, is a request-scoped instance the caller configured itself; the
// registry is then consulted only to confirm the job id is real. See
// RunSyncSequenceWithServices for why a caller would rather not configure the singleton.
func (o *Orchestrator) runSingleSyncInternal(
	parentCtx context.Context, syncType string, origin runOrigin, override Service,
) (string, error) {
	// Check if service exists
	o.mu.RLock()
	service, exists := o.services[syncType]
	existingStatus := o.runningJobs[syncType]
	o.mu.RUnlock()

	if !exists {
		return "", fmt.Errorf("sync service not found: %s", syncType)
	}
	if override != nil {
		service = override
	}

	// Generate a unique token for this run
	runToken := generateRunToken()

	// Check if status was pre-marked by MarkSyncRunning
	// If so, reuse it; otherwise create a new status
	var status *Status
	if existingStatus != nil {
		// Reuse pre-marked status (set by MarkSyncRunning before goroutine started)
		status = existingStatus
		// Overwrite the token so runSyncAndWait can track this specific execution, and take
		// the origin from the caller that is actually starting the work — the pre-mark only
		// reserved the slot.
		o.mu.Lock()
		status.RunToken = runToken
		status.Trigger, status.BatchID, status.Year = origin.trigger, origin.batchID, origin.year
		// Session comes from the starting caller too, not the pre-mark: a reserved slot says
		// nothing about which weekend the work turned out to be for (kindred#2601).
		status.Session = origin.session
		o.mu.Unlock()
	} else {
		// No pre-marked status - check if something else is running. Uses the collection-
		// group-aware check (not the plain IsRunning(syncType)) so the daily cron's bounded
		// family-camp pass and the weekly unrestricted sweep exclude each other even though
		// they run under different registered names (kindred#2491 Face B) -- this is the path
		// both getDailySyncJobs (via runSyncAndWait) and RunCustomValuesSync take.
		o.mu.RLock()
		blocked := o.customValuesGroupRunningLocked(syncType)
		o.mu.RUnlock()
		if blocked {
			return "", fmt.Errorf("sync already in progress: %s", syncType)
		}

		// Create status entry
		status = &Status{
			Type:      syncType,
			Status:    statusRunning,
			StartTime: time.Now(),
			Summary:   Stats{},
			Year:      origin.year,
			RunToken:  runToken,
			Trigger:   origin.trigger,
			BatchID:   origin.batchID,
			Session:   origin.session,
		}

		o.mu.Lock()
		o.runningJobs[syncType] = status
		o.mu.Unlock()
	}

	// Run sync with panic recovery
	// G118 is a false positive here: detaching from the request context is the point.
	// A handler-scoped ctx is cancelled when the handler returns, which would kill the
	// sync mid-run -- the cascade the comment inside this goroutine describes.
	//nolint:gosec // G118: context.Background() is deliberate, see above
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("Sync panicked", "syncType", syncType, "panic", r)
				endTime := time.Now()
				panicStatus := *status
				panicStatus.Status = statusFailed
				panicStatus.Error = fmt.Sprintf("panic: %v", r)
				panicStatus.EndTime = &endTime

				o.storeCompletedRun(&panicStatus)
			}
		}()

		// Create sync context with independent timeout (NOT derived from parent).
		// This fixes the "context canceled" race condition where:
		// 1. API handler spawns goroutine with ctx + defer cancel()
		// 2. RunSingleSync spawns THIS goroutine and returns immediately
		// 3. Handler goroutine exits -> defer cancel() fires -> cascades to derived ctx
		// Solution: Always use context.Background() to avoid parent cancellation cascade.
		// Use the longer of parent's remaining time or 2 hours for adequate timeout.
		var syncCtx context.Context
		var cancel context.CancelFunc

		timeout := 2 * time.Hour
		if parentDeadline, hasDeadline := parentCtx.Deadline(); hasDeadline {
			remaining := time.Until(parentDeadline)
			timeout = max(timeout, remaining)
		}
		syncCtx, cancel = context.WithTimeout(context.Background(), timeout)
		defer cancel()

		// Execute sync with the appropriately-configured context
		err := service.Sync(syncCtx)

		// Build completed status as a copy — never mutate the shared pointer
		endTime := time.Now()
		completed := *status
		completed.EndTime = &endTime

		duration := int(endTime.Sub(completed.StartTime).Seconds())
		stats := service.GetStats()
		stats.Duration = duration
		completed.Summary = stats

		applyCompletionStatus(&completed, &stats, err)
		o.recordBatchChange(completed.BatchID, syncType, stats)

		if completed.Year == 0 {
			if completed.Status == statusFailed {
				slog.Error("Sync failed", "syncType", syncType, "error", completed.Error)
			} else {
				slog.Info("Sync completed successfully", "syncType", syncType)
			}
		}

		o.storeCompletedRun(&completed)
	}()

	return runToken, nil
}

// RunSingleSyncWithService atomically checks that syncType is not already running and, if
// free, marks it running and executes the given service instance in the background. Unlike
// RunSingleSync, it never looks the service up from the orchestrator's registry — it runs
// exactly the instance the caller passed in, and never registers it.
//
// This exists for handlers whose parameters (year, dry_run) are per-request: they build a
// private instance — e.g. NewFamilyCampDerivedSync(app) — configured for just this request, and
// hand it here instead of writing those fields onto the shared singleton returned by
// GetService. That older pattern (see #1881) let DryRun stick on the singleton after a run
// with nothing to reset it, and let two concurrent requests race on Year, because the
// IsRunning check a handler did up front was never atomic with the field writes that followed
// it. Here the "already running" check and the "mark running" write happen under a single
// lock, so two concurrent callers for the same syncType can never both pass.
//
// Returns an error immediately, before starting anything, if syncType is already running.
//
// `origin` names the run: every caller is an API handler, so the trigger is manual and the
// batch is one of one, but most of these endpoints take a ?year= and configure the service
// for it. That year has to arrive here too — the service reading 2019 while the row says
// 2026 makes the run unfindable from the year it belongs to, and `year` is what this table is
// grouped and filtered by.
//
// None of the 12+ call sites register origin.batchID (see registerBatch), so a completion
// routed through here never writes into batchChanged -- a request-scoped run has no export
// waiting on the filter, and there is no queue defer here to ever clean an entry up.
func (o *Orchestrator) RunSingleSyncWithService(
	parentCtx context.Context, syncType string, service Service, origin runOrigin,
) error {
	o.mu.Lock()
	// Collection-group-aware check (kindred#2491 Face A): a plain runningJobs[syncType] lookup
	// missed that the bounded family-camp jobs write the same collection under a different
	// registered name, so an operator's on-demand person_custom_values / household_custom_values
	// run could start while the daily cron's bounded pass was still in flight. Checked under the
	// same lock as the mark below, so the atomicity #1881/#2105 rely on is unchanged.
	if o.customValuesGroupRunningLocked(syncType) {
		o.mu.Unlock()
		return fmt.Errorf("sync already in progress: %s", syncType)
	}

	status := &Status{
		Type:      syncType,
		Status:    statusRunning,
		StartTime: time.Now(),
		Summary:   Stats{},
		Year:      origin.year,
		RunToken:  generateRunToken(),
		Session:   origin.session,
		Trigger:   origin.trigger,
		BatchID:   origin.batchID,
	}
	o.runningJobs[syncType] = status
	o.mu.Unlock()

	// Run sync with panic recovery — mirrors runSingleSyncInternal's goroutine below, but
	// against the caller-supplied `service` rather than a registry lookup.
	// G118 is a false positive here: detaching from the request context is the point.
	// A handler-scoped ctx is cancelled when the handler returns, which would kill the
	// sync mid-run -- the cascade the comment inside this goroutine describes.
	//nolint:gosec // G118: context.Background() is deliberate, see above
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("Sync panicked", "syncType", syncType, "panic", r)
				endTime := time.Now()
				panicStatus := *status
				panicStatus.Status = statusFailed
				panicStatus.Error = fmt.Sprintf("panic: %v", r)
				panicStatus.EndTime = &endTime

				o.storeCompletedRun(&panicStatus)
			}
		}()

		// Independent timeout, not derived from parentCtx — see the identical comment in
		// runSingleSyncInternal for why: a handler's own deferred cancel() must never cascade
		// into this goroutine once the handler has responded.
		timeout := 2 * time.Hour
		if parentDeadline, hasDeadline := parentCtx.Deadline(); hasDeadline {
			timeout = max(timeout, time.Until(parentDeadline))
		}
		syncCtx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		err := service.Sync(syncCtx)

		// Build completed status as a copy — never mutate the shared pointer
		endTime := time.Now()
		completed := *status
		completed.EndTime = &endTime

		duration := int(endTime.Sub(completed.StartTime).Seconds())
		stats := service.GetStats()
		stats.Duration = duration
		completed.Summary = stats

		applyCompletionStatus(&completed, &stats, err)
		o.recordBatchChange(completed.BatchID, syncType, stats)

		if completed.Status == statusFailed {
			slog.Error("Sync failed", "syncType", syncType, "error", completed.Error)
		} else {
			slog.Info("Sync completed successfully", "syncType", syncType,
				"created", stats.Created, "updated", stats.Updated,
				"deleted", stats.Deleted, "errors", stats.Errors,
				"rejected", stats.Rejected)
		}

		o.storeCompletedRun(&completed)
	}()

	return nil
}

// MarkSyncRunning sets a sync's status to "running" without starting it.
// Used by API handlers to ensure status is visible before the goroutine executes.
// This prevents the race condition where the frontend polls before the status is set.
func (o *Orchestrator) MarkSyncRunning(syncType string) error {
	// Check if service exists
	o.mu.RLock()
	_, exists := o.services[syncType]
	o.mu.RUnlock()
	if !exists {
		return fmt.Errorf("sync service not found: %s", syncType)
	}

	// Check if already running
	if o.IsRunning(syncType) {
		return fmt.Errorf("sync already in progress: %s", syncType)
	}

	// Both production callers are the process_requests API handlers, which run the service
	// themselves and finish through FinalizeSyncStatus: an operator's run, for the current
	// season. Taking the year from o.currentSyncYear instead would let a historical backfill
	// that happens to be in flight stamp its year onto this run.
	origin := newBatch(triggerManual)

	// Create status entry with a unique run token
	status := &Status{
		Type:      syncType,
		Status:    statusRunning,
		StartTime: time.Now(),
		Summary:   Stats{},
		Year:      origin.year,
		RunToken:  generateRunToken(),
		Session:   origin.session,
		Trigger:   origin.trigger,
		BatchID:   origin.batchID,
	}

	o.mu.Lock()
	o.runningJobs[syncType] = status
	o.mu.Unlock()

	return nil
}

// FinalizeSyncStatus updates a sync's status after completion.
// Sets end time, stats, and status (success/failed), then moves from
// runningJobs to lastCompletedStatus. No-ops if syncType is not tracked.
// Used by handlers that manage their own Service instances (e.g., process_requests)
// rather than routing through RunSingleSync.
//
//nolint:gocritic // hugeParam: Stats grew past 80B with ProdAuditWarnings; signature refactor out of scope for #1439
func (o *Orchestrator) FinalizeSyncStatus(syncType string, stats Stats, err error) {
	endTime := time.Now()

	o.mu.Lock()
	status, exists := o.runningJobs[syncType]
	if !exists {
		o.mu.Unlock()
		return
	}

	// Copy struct so readers of the old pointer see a consistent snapshot
	completed := *status

	completed.EndTime = &endTime
	stats.Duration = int(endTime.Sub(completed.StartTime).Seconds())
	completed.Summary = stats
	applyCompletionStatus(&completed, &stats, err)

	// The lookup above, the map swap and the delete are one critical section. That is what
	// makes a second call for the same syncType a no-op — api.go's process_requests handlers
	// call this both normally and from a deferred panic recovery, and two rows for one run
	// would corrupt the very counts sync_runs exists to collect. It is also what stops a run
	// started in between from being erased; see publishCompletedLocked.
	//
	// Everything above is arithmetic on a local copy, so the section stays short. The
	// sync_runs write is the one slow part and it happens below, outside the lock, from the
	// snapshot.
	snapshot := o.publishCompletedLocked(&completed)
	o.mu.Unlock()

	// recordBatchChange takes o.mu itself, so it must run after the unlock above -- calling it
	// while the lock from the critical section is still held would deadlock. completed and
	// stats are both local copies by this point, so reading them here is safe.
	o.recordBatchChange(completed.BatchID, syncType, stats)

	o.recordSyncRun(&snapshot)

	// Read the outcome off snapshot, not completed: reading completed directly would still
	// be safe (it is a local copy, per the comment above recordBatchChange), but snapshot is
	// the exact Status this run's sync_runs row is about to be written from, so reading it
	// from anywhere else risks drifting from what actually got recorded.
	finalStatus, finalError := snapshot.Status, snapshot.Error

	if finalStatus == statusFailed {
		slog.Error("Sync failed", "syncType", syncType, "error", finalError)
	} else {
		slog.Info("Sync completed successfully", "syncType", syncType)
	}
}

// checkGlobalTablesEmpty checks if essential global tables have been synced.
// Returns true if global tables are empty and the global-table bootstrap should run first.
//
// Its callers run runGlobalTableBootstrap, NOT RunWeeklySync: since the Sheets export joined
// the weekly-global cadence, running the whole weekly queue here would export as well as
// repair, and a fresh-DB run would then export twice. The bootstrap is a repair path, not a
// membership question.
func (o *Orchestrator) checkGlobalTablesEmpty() bool {
	// Quick check on person_tag_defs - if empty, globals haven't run
	records, _ := o.app.FindRecordsByFilter("person_tag_defs", "", "", 1, 0)
	return len(records) == 0
}

// getDailySyncJobs returns the ordered list of jobs the daily sync runs.
//
// Derived from the registry: every job carrying CadenceDaily, in phase order then declaration
// order, minus any whose environment gate is closed, with stranded_assignment_cleanup moved
// last (see orderQueue). Extracted from RunDailySync so the ordering can be asserted in tests.
func getDailySyncJobs() []string { return cadenceQueue(CadenceDaily) }

// RunHourlySync runs the hourly refresh — cadenceQueue(CadenceHourly), which today is the
// single service bunk_assignments — and waits for each to finish.
//
// It exists so the hourly cron has an origin the orchestrator can see. Every other queue is
// identifiable from a *SyncRunning flag, but the hourly job drove RunSingleSync directly and
// so was indistinguishable from an operator refreshing bunk_assignments by hand. That matters
// more than it sounds: the hourly cron is by far the highest-volume producer of sync_runs
// rows, so filing it as "manual" would bury the operator-initiated runs it needs to be told
// apart from.
//
// Unlike RunSingleSync this blocks until the run completes, matching every other Run*Sync
// method here. Both callers already run it on their own goroutine.
func (o *Orchestrator) RunHourlySync(ctx context.Context) error {
	batch := newBatch(triggerHourly)
	o.registerBatch(batch.batchID)
	// Unlike the other queues below, this one has no *SyncRunning flag/defer of its own to
	// piggyback on -- but it accumulates into batchChanged exactly like they do (bunk_assignments
	// is CadenceHourly's one job, and it does map to a collection in SyncJobToCollections), so
	// without this the map leaks one entry every hour, forever, in a long-lived container. Same
	// reasoning as RunDailySync's identical cleanup.
	defer func() {
		o.mu.Lock()
		delete(o.batchChanged, batch.batchID)
		o.mu.Unlock()
	}()
	for _, job := range cadenceQueue(CadenceHourly) {
		if err := o.runSyncAndWait(ctx, job, batch); err != nil {
			return err
		}
	}
	return nil
}

// RunDailySync runs all base data syncs in the correct order
func (o *Orchestrator) RunDailySync(ctx context.Context) error {
	// Check if global tables are empty - if so, repair them first (the five PhaseGlobal
	// tables only -- never the export; see runGlobalTableBootstrap).
	// This ensures fresh DB setups have required global definitions before daily sync
	if o.checkGlobalTablesEmpty() {
		slog.Info("Global tables empty - running the bootstrap repair first")
		if err := o.runGlobalTableBootstrap(ctx); err != nil {
			slog.Error("Global table bootstrap failed, continuing with daily", "error", err)
		}
	}

	orderedJobs := getDailySyncJobs()

	// Minted here, after the weekly prologue above: the two are sequential queues, not
	// nested ones, and each files its own jobs under its own trigger.
	batch := newBatch(triggerDaily)
	o.registerBatch(batch.batchID)

	// Set daily sync flag and queue
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = orderedJobs
	o.currentRunIndex = 0 // Reset index at start
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit. delete(o.batchChanged, batch.batchID) here
	// is what keeps that map from growing without bound in a long-lived container -- the
	// same shape of bug recordBatchChange itself exists to fix, one level up.
	defer func() {
		o.mu.Lock()
		o.dailySyncRunning = false
		o.dailySyncQueue = nil
		o.currentRunIndex = 0
		delete(o.batchChanged, batch.batchID)
		o.mu.Unlock()
	}()

	slog.Info("Starting daily sync sequence")

	for i, jobName := range orderedJobs {
		// Update current run index
		o.mu.Lock()
		o.currentRunIndex = i
		o.mu.Unlock()

		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Add spacing between jobs (except for the first one)
		if i > 0 {
			slog.Info("Waiting before next sync", "duration", o.jobSpacing)
			time.Sleep(o.jobSpacing)
		}

		slog.Info("Daily sync: Starting service", "service", jobName, "current", i+1, "total", len(orderedJobs))

		// Run sync and wait for completion
		if err := o.runSyncAndWait(ctx, jobName, batch); err != nil {
			slog.Error("Daily sync: service failed", "service", jobName, "error", err)
			// Continue with other syncs even if one fails
		} else {
			slog.Info("Daily sync: service completed", "service", jobName)
		}
	}

	slog.Info("Daily sync sequence completed")
	return nil
}

// RunWeeklySync runs global data syncs that are too expensive for daily sync.
// These services require N API calls (one per entity) and run once per week.
//
// This is the REAL Sunday-2am cron path (scheduler.go): GetWeeklySyncJobs() is every
// CadenceWeeklyGlobal row, multi_workbook_export included since this task. Do not call this
// from checkGlobalTablesEmpty's bootstrap -- see runGlobalTableBootstrap, which is that path's
// job list instead, deliberately excluding the export (spec §3: "a repair path, not a
// membership question").
//
//nolint:dupl // Similar pattern to RunCustomValuesSync, intentional for sync orchestration
func (o *Orchestrator) RunWeeklySync(ctx context.Context) error {
	return o.runWeeklyJobs(ctx, GetWeeklySyncJobs())
}

// runGlobalTableBootstrap is checkGlobalTablesEmpty's repair path, called by RunDailySync and
// RunSyncWithOptions when a fresh or freshly-reset database has no person_tag_defs rows. It
// refills exactly the five PhaseGlobal tables (GetJobsForPhase(PhaseGlobal), gated the same
// way every derived queue is) and nothing else.
//
// Deliberately NOT GetWeeklySyncJobs(): that list also carries multi_workbook_export
// (CadenceWeeklyGlobal, since this task), and this bootstrap is a repair path, not a
// membership question (spec §3) -- it must refill the definition tables a database is missing,
// and must never trigger an export as a side effect of doing so. Before this function existed,
// both callers ran RunWeeklySync directly, so a fresh-DB full run exported once from the
// bootstrap and once from its own service list (TestExportRunsExactlyOnceInAFullRun is the
// regression guard).
//
// Uses the SAME triggerWeekly batch trigger and the SAME weeklySyncRunning/weeklySyncQueue UI
// flags as RunWeeklySync -- this is still, semantically, "the weekly sync ran early because the
// globals were missing," just scoped to the five tables that repair path actually owns.
func (o *Orchestrator) runGlobalTableBootstrap(ctx context.Context) error {
	return o.runWeeklyJobs(ctx, available(GetJobsForPhase(PhaseGlobal)))
}

// runWeeklyJobs is RunWeeklySync's and runGlobalTableBootstrap's shared body, parameterized on
// the job list so the two can differ only in which jobs run, never in how the batch is tracked.
func (o *Orchestrator) runWeeklyJobs(ctx context.Context, weeklyJobs []string) error {
	batch := newBatch(triggerWeekly)
	o.registerBatch(batch.batchID)

	// Set weekly sync flag and queue
	o.mu.Lock()
	o.weeklySyncRunning = true
	o.weeklySyncQueue = weeklyJobs
	o.currentRunIndex = 0 // Reset index at start
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit. See RunDailySync's identical defer for why
	// batchChanged is cleaned up here too.
	defer func() {
		o.mu.Lock()
		o.weeklySyncRunning = false
		o.weeklySyncQueue = nil
		o.currentRunIndex = 0
		delete(o.batchChanged, batch.batchID)
		o.mu.Unlock()
	}()

	slog.Info("Starting weekly sync sequence", "services", weeklyJobs)

	for i, jobName := range weeklyJobs {
		// Update current run index
		o.mu.Lock()
		o.currentRunIndex = i
		o.mu.Unlock()

		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Add spacing between jobs (except for the first one)
		if i > 0 {
			slog.Info("Waiting before next sync", "duration", o.jobSpacing)
			time.Sleep(o.jobSpacing)
		}

		slog.Info("Weekly sync: Starting service", "service", jobName, "current", i+1, "total", len(weeklyJobs))

		// Run sync and wait for completion
		if err := o.runSyncAndWait(ctx, jobName, batch); err != nil {
			slog.Error("Weekly sync: service failed", "service", jobName, "error", err)
			// Continue with other syncs even if one fails
		} else {
			slog.Info("Weekly sync: service completed", "service", jobName)
		}
	}

	slog.Info("Weekly sync sequence completed")
	return nil
}

// RunCustomValuesSync runs custom field values syncs for person and household entities in parallel.
// These are expensive syncs (1 API call per entity) that run weekly after the main weekly sync.
// Running in parallel is safe because they sync independent tables (person_custom_values vs
// household_custom_values) using different CampMinder API endpoints.
func (o *Orchestrator) RunCustomValuesSync(ctx context.Context) error {
	// Get the custom values sync jobs
	customValuesJobs := GetCustomValuesSyncJobs()

	batch := newBatch(triggerCustomValues)
	o.registerBatch(batch.batchID)

	// Set custom values sync flag and queue
	// Note: currentRunIndex is 0 for parallel syncs (all jobs run simultaneously)
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = customValuesJobs
	o.currentRunIndex = 0
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit. See RunDailySync's identical defer for why
	// batchChanged is cleaned up here too.
	defer func() {
		o.mu.Lock()
		o.customValuesSyncRunning = false
		o.customValuesSyncQueue = nil
		o.currentRunIndex = 0
		delete(o.batchChanged, batch.batchID)
		o.mu.Unlock()
	}()

	slog.Info("Starting custom values sync sequence (parallel)", "services", customValuesJobs)

	var wg sync.WaitGroup
	errChan := make(chan error, len(customValuesJobs))

	for _, jobName := range customValuesJobs {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()

			// Check if context is canceled before starting
			select {
			case <-ctx.Done():
				errChan <- ctx.Err()
				return
			default:
			}

			slog.Info("Custom values sync: Starting service", "service", name)

			if err := o.runSyncAndWait(ctx, name, batch); err != nil {
				slog.Error("Custom values sync: service failed", "service", name, "error", err)
				errChan <- err
			} else {
				slog.Info("Custom values sync: service completed", "service", name)
			}
		}(jobName)
	}

	wg.Wait()
	close(errChan)

	// Collect any errors
	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	slog.Info("Custom values sync sequence completed")
	return errors.Join(errs...)
}

// runSyncAndWait runs a sync as part of `origin`'s batch and waits for it to complete.
//
// A ChangedCollectionsAware service (see MultiWorkbookExport) receives the batch's own
// changed-collections set so far -- batchChangedCollections(origin.batchID). This is nil,
// meaning "export everything", whenever origin.batchID was never registered with
// registerBatch: RunSingleSync's explicit standalone case, an operator-named single-service
// RunSyncWithOptions run (final-review Critical C1 -- a batch of one has nothing that could
// have changed anything before it), the synchronous phase-run handler (api.go's
// handleRunPhase), and both of api.go's queued-run handlers, none of which register a batch
// of their own. Every REGISTERED queue in this file (RunHourlySync, RunDailySync,
// RunWeeklySync, RunCustomValuesSync, a multi-service RunSyncWithOptions run) routes through
// this one function too, so wiring it here is what makes it "the queue" rather than any one
// caller, for both the nil and the real-filter case.
//
// A YearSetter service gets origin.year the same way, for the identical reason: it too is a
// per-run parameter the queue owns, not the job. origin.year == 0 means "the current season"
// (runOrigin's own doc comment) and resolves via ParseSeasonYear(); a non-zero origin.year (a
// historical replay, or an explicit-year phase/individual run) sets that exact year directly.
//
// This replaces two narrower fixes that used to live in RunSyncWithOptions alone (an explicit
// SetYear(opts.Year) in its historical branch, and a mirrored current-year branch added right
// after it): both were per-call-site patches for a problem that is actually structural --
// MultiWorkbookExport is a long-lived singleton whose year has to be set by whichever queue is
// about to read it, every time, or it silently carries the last queue's value into this one.
// Putting it here instead covers every queue uniformly, including RunWeeklySync and
// RunDailySync (which had the identical exposure and no fix at all -- the weekly one matters
// most, since CadenceWeeklyGlobal is what makes the export reachable from that queue at all),
// and any future queue that never gets its own copy of this logic to forget.
//
// An unresolvable season for the current-season case is NOT treated as fatal to the whole
// batch: the year is simply left unset on this one service (its own internal resolution, if
// it has one, hits the identical ParseSeasonYear() call and fails the identical way -- see
// e.g. MultiWorkbookExport.Sync() and FamilyCampDerivedSync.Sync()), and every other job in
// the batch runs normally. Aborting an entire ~27-service run because one job's year can't be
// resolved would be the wrong blast radius (fix round 2, Important #4) -- that ruling was
// right for RunSingleSync, where the one service IS the whole run, but does not transfer here.
func (o *Orchestrator) runSyncAndWait(ctx context.Context, syncType string, origin runOrigin) error {
	return o.runSyncAndWaitWithService(ctx, syncType, origin, nil)
}

// runSyncAndWaitWithService is runSyncAndWait against an optional caller-supplied instance.
// A nil `override` means "use the registered service", which is every pre-existing caller.
//
// The optional-interface setters below are applied to whichever instance will actually RUN --
// the override when there is one. Applying them to the registry while running the override
// would configure one object and execute another, which is a silent no-op rather than an
// error.
func (o *Orchestrator) runSyncAndWaitWithService(
	ctx context.Context, syncType string, origin runOrigin, override Service,
) error {
	svc := override
	if svc == nil {
		svc = o.GetService(syncType)
	}
	if svc != nil {
		if changedAware, ok := svc.(ChangedCollectionsAware); ok {
			changedAware.SetChangedCollections(o.batchChangedCollections(origin.batchID))
		}
		if yearSetter, ok := svc.(YearSetter); ok {
			if origin.year != 0 {
				yearSetter.SetYear(origin.year)
			} else if resolved, err := ParseSeasonYear(); err == nil {
				yearSetter.SetYear(resolved)
			} else {
				slog.Warn("runSyncAndWait: could not resolve current season, leaving year unset",
					"syncType", syncType, "error", err)
			}
		}
	}

	// Start the sync and capture the token directly from the return value.
	// This eliminates the race where the goroutine completes before we can
	// read the token from runningJobs (issue #789).
	expectedToken, err := o.runSingleSyncInternal(ctx, syncType, origin, override)
	if err != nil {
		return err
	}

	// Wait for completion
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !o.IsRunning(syncType) {
				// Check final status — only accept if the token matches this run
				o.mu.RLock()
				status := o.lastCompletedStatus[syncType]
				o.mu.RUnlock()

				if status != nil && status.RunToken == expectedToken {
					if status.Status == statusFailed {
						return fmt.Errorf("%s", status.Error)
					}
					return nil
				}
				// Token doesn't match — a stale completion; keep waiting
			}
		}
	}
}

// GetStatus returns the status of a sync job
func (o *Orchestrator) GetStatus(syncType string) *Status {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// Check running jobs first
	if status, exists := o.runningJobs[syncType]; exists {
		// Return a copy to avoid race conditions
		statusCopy := *status
		return &statusCopy
	}

	// If daily sync is running and this service is queued, return pending status
	if o.dailySyncRunning {
		for _, queuedService := range o.dailySyncQueue {
			if queuedService == syncType {
				// This service is part of the daily sync sequence
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If the status is from the current year (Year == 0), it might be from this sequence
					// Check if it was completed very recently (within the last hour)
					if status.Year == 0 && status.EndTime != nil {
						if time.Since(*status.EndTime) < time.Hour {
							statusCopy := *status
							return &statusCopy
						}
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   0, // Current year
				}
			}
		}
	}

	// If historical sync is running and this service is queued, return pending status
	if o.historicalSyncRunning {
		for _, queuedService := range o.historicalSyncQueue {
			if queuedService == syncType {
				// This service is part of the historical sync sequence
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If the status year matches the historical sync year, it's from this sequence
					if status.Year == o.historicalSyncYear {
						statusCopy := *status
						return &statusCopy
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   o.historicalSyncYear,
				}
			}
		}
	}

	// If weekly sync is running and this service is queued, return pending status
	if o.weeklySyncRunning {
		for _, queuedService := range o.weeklySyncQueue {
			if queuedService == syncType {
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If completed very recently (within the last hour), show that status
					if status.EndTime != nil && time.Since(*status.EndTime) < time.Hour {
						statusCopy := *status
						return &statusCopy
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   0, // Global sync (no year)
				}
			}
		}
	}

	// If custom values sync is running and this service is queued, return pending status
	if o.customValuesSyncRunning {
		for _, queuedService := range o.customValuesSyncQueue {
			if queuedService == syncType {
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If completed very recently (within the last hour), show that status
					if status.EndTime != nil && time.Since(*status.EndTime) < time.Hour {
						statusCopy := *status
						return &statusCopy
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   o.currentSyncYear, // Custom values sync uses current sync year
				}
			}
		}
	}

	// Check last completed status
	if status, exists := o.lastCompletedStatus[syncType]; exists {
		// Return a copy to avoid race conditions
		statusCopy := *status
		return &statusCopy
	}

	return nil
}

// SetJobSpacing sets the time to wait between jobs in a sequence
func (o *Orchestrator) SetJobSpacing(duration time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.jobSpacing = duration
}

// RunSyncWithOptions runs syncs with custom options including year override
func (o *Orchestrator) RunSyncWithOptions(ctx context.Context, opts Options) error {
	// Set the current sync year
	o.mu.Lock()
	o.currentSyncYear = opts.Year
	o.mu.Unlock()

	// Reset to 0 when done
	defer func() {
		o.mu.Lock()
		o.currentSyncYear = 0
		o.mu.Unlock()
	}()

	// Check if global tables are empty - if so, run the bootstrap repair first
	// This ensures fresh DB setups have required global definitions before any sync
	// The check is quick (1 DB query) so we do it regardless of year.
	//
	// Never on a dry run. runGlobalTableBootstrap fetches and writes person_tag_defs,
	// custom_field_defs and divisions for real, and it does not go through the
	// DryRunnable plumbing below, so a dry_run=true request that happened to land on an
	// unseeded database would write anyway -- an operator told "dry_run": true while the
	// database changed under them is the whole of kindred#2334. Skipping leaves the run
	// computing against what is actually there, which is the honest answer to "what would
	// this do", and the warning says so rather than leaving it to be inferred.
	if o.checkGlobalTablesEmpty() {
		if opts.DryRun {
			slog.Warn("Dry run: global tables are empty and the weekly-sync bootstrap is " +
				"skipped -- results are computed against an unseeded database")
		} else {
			slog.Info("Global tables empty - running the bootstrap repair first")
			if err := o.runGlobalTableBootstrap(ctx); err != nil {
				slog.Error("Global table bootstrap failed, continuing with sync", "error", err)
			}
		}
	}

	// Determine which services to run. Run all services in dependency order
	// (source → [CV] → transform), same order as RunDailySync, with optional CV phase
	// inserted before transform. opts.Year == 0 means the live/current-year run (see
	// ResolveUnifiedSyncServices); opts.Year > 0 is a historical replay of a specific year.
	servicesToRun := opts.Services
	if len(servicesToRun) == 0 {
		servicesToRun = ResolveUnifiedSyncServices(DefaultService, opts.IncludeCustomValues, opts.Year == 0)
	}

	// A run of exactly one service is not a queue: nothing else in this run could have
	// completed before it to change anything, so a ChangedCollectionsAware job in it must get
	// the same "export everything" answer RunSingleSync's explicit standalone case gets --
	// batchChangedCollections(unregistered) == nil, not the non-nil empty map a registered-
	// but-untouched batch would hand back ("nothing has changed *yet*"). Skipping
	// registerBatch here, rather than special-casing multi_workbook_export, makes this a rule
	// about what a queue *is*: two or more services that can hand each other real state.
	// (Final-review Critical C1: POST .../sync/run?service=multi_workbook_export resolves to
	// exactly this shape and used to write zero sheets while reporting success.)
	isQueueRun := len(servicesToRun) > 1

	// Set up sync tracking based on year mode. The batch carries the year explicitly:
	// o.currentSyncYear below is process-global and stays set for this sync's whole
	// duration, so a run started by any other queue in the meantime would otherwise be
	// filed under a backfill's year.
	var batch runOrigin
	if opts.Year > 0 {
		batch = newBatch(triggerHistorical).forYear(opts.Year)
		if isQueueRun {
			o.registerBatch(batch.batchID)
		}

		// Historical sync tracking
		o.mu.Lock()
		o.historicalSyncRunning = true
		o.historicalSyncQueue = servicesToRun
		o.historicalSyncYear = opts.Year
		o.currentRunIndex = 0 // Reset index at start
		o.mu.Unlock()

		defer func() {
			o.mu.Lock()
			o.historicalSyncRunning = false
			o.historicalSyncQueue = nil
			o.historicalSyncYear = 0
			o.currentRunIndex = 0
			delete(o.batchChanged, batch.batchID)
			o.mu.Unlock()
		}()
	} else {
		batch = newBatch(triggerDaily)
		if isQueueRun {
			o.registerBatch(batch.batchID)
		}

		// Current year sync - use daily sync tracking so UI shows progress
		o.mu.Lock()
		o.dailySyncRunning = true
		o.dailySyncQueue = servicesToRun
		o.currentRunIndex = 0 // Reset index at start
		o.mu.Unlock()

		defer func() {
			o.mu.Lock()
			o.dailySyncRunning = false
			o.dailySyncQueue = nil
			o.currentRunIndex = 0
			delete(o.batchChanged, batch.batchID)
			o.mu.Unlock()
		}()
	}

	// If year override is specified, we need to re-register services with a cloned client
	if opts.Year > 0 {
		if o.baseClient == nil {
			slog.Error("Cannot run historical sync - baseClient is nil")
			return fmt.Errorf("baseClient not initialized")
		}

		// Create a client with the specified year
		yearClient := o.baseClient.CloneWithYear(opts.Year)

		// Temporarily re-register services with year-specific client
		// Store original services
		originalServices := make(map[string]Service)
		o.mu.Lock()
		for name, svc := range o.services {
			originalServices[name] = svc
		}
		o.mu.Unlock()

		// Re-register with year client
		// Note: person_tag_defs, custom_field_defs, and divisions are NOT re-registered
		// because they are global (not year-specific) and shouldn't run in historical syncs
		// Note: "persons" is a combined sync that populates persons and households
		o.RegisterService("session_groups", NewSessionGroupsSync(o.app, yearClient))
		o.RegisterService("sessions", NewSessionsSync(o.app, yearClient))
		// Note: divisions is global (no year field) - not re-registered for historical sync
		o.RegisterService("attendees", NewAttendeesSync(o.app, yearClient))
		o.RegisterService("persons", NewPersonsSync(o.app, yearClient)) // Combined: persons + households
		o.RegisterService("bunks", NewBunksSync(o.app, yearClient))
		o.RegisterService("bunk_plans", NewBunkPlansSync(o.app, yearClient))
		o.RegisterService("bunk_assignments", NewBunkAssignmentsSync(o.app, yearClient))
		yearReconcileSync := NewReconcileLifecycleSync(o.app)
		yearReconcileSync.Year = opts.Year
		o.RegisterService("reconcile_request_lifecycle", yearReconcileSync)
		o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, yearClient))
		yearProcessor := NewRequestProcessor(o.app)
		yearProcessor.CollectTraces = true // Always collect traces for scheduled/automated runs
		yearProcessor.Trigger = "scheduled"
		o.RegisterService("process_requests", yearProcessor)
		o.RegisterService("staff", NewStaffSync(o.app, yearClient))

		o.RegisterService("financial_transactions", NewFinancialTransactionsSync(o.app, yearClient))

		// Family camp derived tables (computed from custom values)
		familyCampDerivedSync := NewFamilyCampDerivedSync(o.app)
		familyCampDerivedSync.Year = opts.Year
		o.RegisterService("family_camp_derived", familyCampDerivedSync)

		// Lodging assignments (derived from the cabin custom fields)
		lodgingAssignmentsSync := NewLodgingAssignmentsSync(o.app)
		lodgingAssignmentsSync.Year = opts.Year
		o.RegisterService("lodging_assignments", lodgingAssignmentsSync)

		// Staff skills (derived from person_custom_values Skills- fields)
		staffSkillsSync := NewStaffSkillsSync(o.app)
		staffSkillsSync.Year = opts.Year
		o.RegisterService("staff_skills", staffSkillsSync)

		// Financial aid applications (derived from person_custom_values FA- fields)
		faApplicationsSync := NewFinancialAidApplicationsSync(o.app)
		faApplicationsSync.Year = opts.Year
		o.RegisterService("financial_aid_applications", faApplicationsSync)

		// Household demographics (computed from HH- fields + household custom values)
		householdDemographicsSync := NewHouseholdDemographicsSync(o.app)
		householdDemographicsSync.Year = opts.Year
		o.RegisterService("household_demographics", householdDemographicsSync)

		// Camper dietary (derived from Family Medical-* fields)
		camperDietarySync := NewCamperDietarySync(o.app)
		camperDietarySync.Year = opts.Year
		o.RegisterService("camper_dietary", camperDietarySync)

		// Camper transportation (derived from BUS-* fields)
		camperTransportationSync := NewCamperTransportationSync(o.app)
		camperTransportationSync.Year = opts.Year
		o.RegisterService("camper_transportation", camperTransportationSync)

		// Quest registrations (derived from Quest-*/Q-* fields)
		questRegistrationsSync := NewQuestRegistrationsSync(o.app)
		questRegistrationsSync.Year = opts.Year
		o.RegisterService("quest_registrations", questRegistrationsSync)

		// Staff applications (derived from App-* fields)
		staffApplicationsSync := NewStaffApplicationsSync(o.app)
		staffApplicationsSync.Year = opts.Year
		o.RegisterService("staff_applications", staffApplicationsSync)

		// Staff vehicle info (derived from SVI-* fields)
		staffVehicleInfoSync := NewStaffVehicleInfoSync(o.app)
		staffVehicleInfoSync.Year = opts.Year
		o.RegisterService("staff_vehicle_info", staffVehicleInfoSync)

		// Geographic normalization (normalizes persons.school/city/congregation)
		normalizeGeographicSync := NewNormalizeGeographicSync(o.app)
		normalizeGeographicSync.Year = opts.Year
		o.RegisterService("normalize_geographic", normalizeGeographicSync)

		// Enrollment snapshots (captures daily enrollment counts per session)
		enrollmentSnapshotsSync := NewEnrollmentSnapshotsSync(o.app)
		enrollmentSnapshotsSync.Year = opts.Year
		o.RegisterService("enrollment_snapshots", enrollmentSnapshotsSync)

		// Stranded assignment cleanup: sweeps scenario drafts stranded by bunk-plan changes.
		// Year-scoped so a historical sync reconciles the correct year's drafts.
		strandedAssignmentCleanupSync := NewStrandedAssignmentCleanupSync(o.app)
		strandedAssignmentCleanupSync.Year = opts.Year
		o.RegisterService("stranded_assignment_cleanup", strandedAssignmentCleanupSync)

		// Custom value services for historical sync support
		// These use GetSeasonID() to determine the year, so they need year-specific client
		personCustomValuesSync := NewPersonCustomFieldValuesSync(o.app, yearClient)
		personCustomValuesSync.SetDebug(opts.Debug)
		personCustomValuesSync.SetSession("all") // Historical syncs all sessions
		o.RegisterService("person_custom_values", personCustomValuesSync)

		householdCustomValuesSync := NewHouseholdCustomFieldValuesSync(o.app, yearClient)
		householdCustomValuesSync.SetDebug(opts.Debug)
		householdCustomValuesSync.SetSession("all") // Historical syncs all sessions
		o.RegisterService("household_custom_values", householdCustomValuesSync)

		// The scoped family-camp variants of the two services above must be re-registered too,
		// or a historical replay of one of them silently keeps running against the boot-time
		// current-season client instead of yearClient (kindred#2608). ScopedJobs -- not a
		// hand-rolled loop over syncJobMeta -- is what keeps this list correct if a third
		// scoped variant of either service is ever added. Session is left at its NewXxx
		// default (DefaultSession) rather than set to "all" explicitly: with Scope ==
		// ScopeFamilyCamp, getPersonIDsToSync/getHouseholdIDsToSync only consult Session when
		// it names one specific weekend, so DefaultSession already spans every family-camp
		// weekend in the year, same as the boot-time singleton the unattended cron runs.
		for _, id := range ScopedJobs(ScopeFamilyCamp) {
			switch JobBase(id) {
			case serviceNamePersonCustomValues:
				scopedPersonSync := NewPersonCustomFieldValuesSync(o.app, yearClient)
				scopedPersonSync.SetScope(ScopeFamilyCamp)
				scopedPersonSync.SetDebug(opts.Debug)
				o.RegisterService(id, scopedPersonSync)
			case serviceNameHouseholdCustomValues:
				scopedHouseholdSync := NewHouseholdCustomFieldValuesSync(o.app, yearClient)
				scopedHouseholdSync.SetScope(ScopeFamilyCamp)
				scopedHouseholdSync.SetDebug(opts.Debug)
				o.RegisterService(id, scopedHouseholdSync)
			}
		}

		// Restore original services after sync completes
		defer func() {
			o.mu.Lock()
			for name, svc := range originalServices {
				o.services[name] = svc
			}
			o.mu.Unlock()
		}()

		slog.Info("Running sync with year override", "year", opts.Year)
	}

	// Run services
	if opts.Concurrent {
		// Run concurrently (for future implementation)
		// For now, fall back to sequential
		slog.Info("Concurrent sync not yet implemented, running sequentially")
	}

	// Apply debug flag to all services if enabled
	if opts.Debug {
		for _, serviceName := range servicesToRun {
			if svc := o.GetService(serviceName); svc != nil {
				if debuggable, ok := svc.(Debuggable); ok {
					debuggable.SetDebug(true)
				}
			}
		}
		// Reset debug flag after sync completes
		defer func() {
			for _, serviceName := range servicesToRun {
				if svc := o.GetService(serviceName); svc != nil {
					if debuggable, ok := svc.(Debuggable); ok {
						debuggable.SetDebug(false)
					}
				}
			}
		}()
	}

	// Apply dry_run to every service about to run. handleUnifiedSync already rejected the
	// request synchronously, before ever calling here, if any resolved service lacked
	// DryRunnable support -- this check is the defense-in-depth backstop for any other caller
	// of RunSyncWithOptions, and it fails closed: if it ever fires, nothing below has run yet
	// (kindred#2334 was exactly a silent-write path with no backstop like this one).
	if opts.DryRun {
		if unsupported := o.UnsupportedDryRunServices(servicesToRun); len(unsupported) > 0 {
			return fmt.Errorf("dry_run requested but not supported by: %s", strings.Join(unsupported, ", "))
		}
		for _, serviceName := range servicesToRun {
			if svc := o.GetService(serviceName); svc != nil {
				if dryRunnable, ok := svc.(DryRunnable); ok {
					dryRunnable.SetDryRun(true)
				}
			}
		}
		// Reset dry_run after sync completes so the registered singleton doesn't leak the
		// flag into the next, unrelated run (same reasoning as the debug reset above).
		defer func() {
			for _, serviceName := range servicesToRun {
				if svc := o.GetService(serviceName); svc != nil {
					if dryRunnable, ok := svc.(DryRunnable); ok {
						dryRunnable.SetDryRun(false)
					}
				}
			}
		}()
	}

	// Run sequentially - custom values syncs run in order to prevent context deadline issues
	// from concurrent API rate limiting during historical syncs
	for i, serviceName := range servicesToRun {
		// Update current run index
		o.mu.Lock()
		o.currentRunIndex = i
		o.mu.Unlock()

		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Add spacing between jobs (except for the first one)
		if i > 0 {
			slog.Info("Waiting before next sync", "duration", o.jobSpacing)
			time.Sleep(o.jobSpacing)
		}

		progress := fmt.Sprintf("%d/%d", i+1, len(servicesToRun))
		if opts.Year > 0 {
			slog.Info("Historical sync: Starting service",
				"year", opts.Year, "service", serviceName, "progress", progress)
		} else {
			slog.Info("Sync with options: Starting service",
				"service", serviceName, "progress", progress)
		}

		// Run sync and wait for completion
		if err := o.runSyncAndWait(ctx, serviceName, batch); err != nil {
			if opts.Year > 0 {
				slog.Error("Historical sync: service failed", "year", opts.Year, "service", serviceName, "error", err)
			} else {
				slog.Error("Sync with options: service failed", "service", serviceName, "error", err)
			}
			// Continue with other syncs even if one fails
		} else {
			if opts.Year > 0 {
				slog.Info("Historical sync: service completed", "year", opts.Year, "service", serviceName)
			} else {
				slog.Info("Sync with options: service completed", "service", serviceName)
			}
		}
	}

	// multi_workbook_export is now an ordinary queued job (Stage 4/Task 13): its registry row
	// carries TriggerFullRun and CadenceWeeklyGlobal, so servicesToRun above already includes
	// it wherever it used to run via this function's two hardcoded epilogues (a full or
	// historical run, current-year and historical alike -- see the runSyncAndWait loop above),
	// and it gets its batch's own changed-collections filter and dry-run rejection the same
	// way every other job in servicesToRun does. Nothing to trigger here anymore.

	return nil
}

// =============================================================================
// Unified Sync Queue Methods
// =============================================================================

// generateRunToken generates a unique token for tracking a sync run.
// Used by runSingleSyncInternal and MarkSyncRunning.
func generateRunToken() string {
	return fmt.Sprintf("%d-%04x", time.Now().UnixNano(), rand.IntN(0xFFFF)) //nolint:gosec // uniqueness, not crypto
}

// generateBatchID generates a unique ID grouping every service execution of one queue.
// Same shape as generateRunToken, deliberately a separate id space: a run token identifies
// one execution of one service and a batch id identifies the queue it ran inside.
func generateBatchID() string {
	return fmt.Sprintf("%d-%04x", time.Now().UnixNano(), rand.IntN(0xFFFF)) //nolint:gosec // uniqueness, not crypto
}

// generateQueueID generates a unique ID for a queued sync.
// Uses random suffix for collision resistance (same pattern as generateRunToken, see #853).
func generateQueueID() string {
	return fmt.Sprintf("%d-%04x", time.Now().UnixNano(), rand.IntN(0xFFFF)) //nolint:gosec // uniqueness, not crypto
}

// EnqueueUnifiedSync adds a unified sync request to the queue.
// If a sync with the same year+type+service is already queued, returns the existing item.
func (o *Orchestrator) EnqueueUnifiedSync(
	year int, service string, includeCustomValues, debug, dryRun bool, requestedBy string,
) (*QueuedSync, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Check for duplicate (same year + type + service + includeCustomValues + dry_run already
	// queued). DryRun is part of the match deliberately: without it, a dry_run=true request
	// for the same year/service as an already-queued wet request would silently merge into
	// that wet item and inherit its DryRun=false -- the caller would be handed a queue
	// position for what they asked to be a dry run, and it would run wet anyway (kindred#2334).
	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year &&
			o.pendingUnifiedSyncs[i].Type == "unified" &&
			o.pendingUnifiedSyncs[i].Service == service &&
			o.pendingUnifiedSyncs[i].IncludeCustomValues == includeCustomValues &&
			o.pendingUnifiedSyncs[i].DryRun == dryRun {
			// Return existing item instead of creating duplicate
			return &o.pendingUnifiedSyncs[i], nil
		}
	}

	// Create new queued sync
	qs := QueuedSync{
		ID:                  generateQueueID(),
		Year:                year,
		Type:                "unified",
		Service:             service,
		IncludeCustomValues: includeCustomValues,
		Debug:               debug,
		DryRun:              dryRun,
		QueuedAt:            time.Now(),
		RequestedBy:         requestedBy,
	}

	// Append to queue (FIFO)
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, qs)

	slog.Info("Enqueued unified sync",
		"id", qs.ID, "year", year, "service", service, "position", len(o.pendingUnifiedSyncs))

	return &qs, nil
}

// EnqueuePhaseSync adds a phase sync request to the queue.
// If a sync with the same year+phase is already queued, returns the existing item.
func (o *Orchestrator) EnqueuePhaseSync(year int, phase Phase, debug bool, requestedBy string) (*QueuedSync, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Check for duplicate (same year + type + service already queued)
	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year &&
			o.pendingUnifiedSyncs[i].Type == "phase" &&
			o.pendingUnifiedSyncs[i].Service == string(phase) {
			// Return existing item instead of creating duplicate
			return &o.pendingUnifiedSyncs[i], nil
		}
	}

	// Create new queued sync
	qs := QueuedSync{
		ID:          generateQueueID(),
		Year:        year,
		Type:        "phase",
		Service:     string(phase),
		Debug:       debug,
		QueuedAt:    time.Now(),
		RequestedBy: requestedBy,
	}

	// Append to queue (FIFO)
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, qs)

	slog.Info("Enqueued phase sync",
		"id", qs.ID, "year", year, "phase", phase, "debug", debug, "position", len(o.pendingUnifiedSyncs))

	return &qs, nil
}

// EnqueueIndividualSync adds an individual job sync request to the queue.
// If a sync with the same year+job is already queued, returns the existing item.
func (o *Orchestrator) EnqueueIndividualSync(
	year int, jobID string, options map[string]any, debug bool, requestedBy string,
) (*QueuedSync, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Check for duplicate (same year + type + service already queued)
	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year &&
			o.pendingUnifiedSyncs[i].Type == "individual" &&
			o.pendingUnifiedSyncs[i].Service == jobID {
			// Return existing item instead of creating duplicate
			return &o.pendingUnifiedSyncs[i], nil
		}
	}

	// Create new queued sync
	qs := QueuedSync{
		ID:          generateQueueID(),
		Year:        year,
		Type:        "individual",
		Service:     jobID,
		Options:     options,
		Debug:       debug,
		QueuedAt:    time.Now(),
		RequestedBy: requestedBy,
	}

	// Append to queue (FIFO)
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, qs)

	slog.Info("Enqueued individual sync",
		"id", qs.ID, "year", year, "job", jobID, "debug", debug, "position", len(o.pendingUnifiedSyncs))

	return &qs, nil
}

// DequeueUnifiedSync removes and returns the first item from the queue.
// Returns nil if the queue is empty.
func (o *Orchestrator) DequeueUnifiedSync() *QueuedSync {
	o.mu.Lock()
	defer o.mu.Unlock()

	if len(o.pendingUnifiedSyncs) == 0 {
		return nil
	}

	// Get first item (FIFO)
	qs := o.pendingUnifiedSyncs[0]

	// Remove from queue
	o.pendingUnifiedSyncs = o.pendingUnifiedSyncs[1:]

	slog.Info("Dequeued unified sync", "id", qs.ID, "year", qs.Year, "service", qs.Service)

	return &qs
}

// CancelQueuedSync removes a queued sync by ID.
// Returns true if the item was found and removed, false otherwise.
func (o *Orchestrator) CancelQueuedSync(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()

	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].ID == id {
			// Remove item
			o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs[:i], o.pendingUnifiedSyncs[i+1:]...)
			slog.Info("Canceled queued sync", "id", id)
			return true
		}
	}

	return false
}

// GetQueuedSyncs returns a copy of the pending unified syncs queue.
func (o *Orchestrator) GetQueuedSyncs() []QueuedSync {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// Return a copy to avoid race conditions
	result := make([]QueuedSync, len(o.pendingUnifiedSyncs))
	copy(result, o.pendingUnifiedSyncs)
	return result
}

// GetQueuePositionByID returns the 1-based position of a queued sync.
// Returns 0 if the ID is not found.
func (o *Orchestrator) GetQueuePositionByID(id string) int {
	o.mu.RLock()
	defer o.mu.RUnlock()

	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].ID == id {
			return i + 1 // 1-based position
		}
	}

	return 0
}

// GetQueueLength returns the number of items in the queue.
func (o *Orchestrator) GetQueueLength() int {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return len(o.pendingUnifiedSyncs)
}

// SetActiveSyncCancel stores the cancel function for the currently running sync.
func (o *Orchestrator) SetActiveSyncCancel(cancel context.CancelFunc) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.activeSyncCancel = cancel
}

// ClearActiveSyncCancel clears the stored cancel function.
func (o *Orchestrator) ClearActiveSyncCancel() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.activeSyncCancel = nil
}

// CancelRunningSync cancels the currently running sync if one exists.
// Returns true if a sync was canceled, false if no sync was running.
func (o *Orchestrator) CancelRunningSync() bool {
	o.mu.Lock()
	defer o.mu.Unlock()

	if o.activeSyncCancel != nil {
		o.activeSyncCancel()
		o.activeSyncCancel = nil
		slog.Info("Canceled running sync")
		return true
	}
	return false
}

// ClearSyncFlags resets all sync running flags.
// Used for panic recovery to ensure stuck syncs don't block future syncs.
func (o *Orchestrator) ClearSyncFlags() {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.dailySyncRunning = false
	o.dailySyncQueue = nil
	o.historicalSyncRunning = false
	o.historicalSyncQueue = nil
	o.historicalSyncYear = 0
	o.weeklySyncRunning = false
	o.weeklySyncQueue = nil
	o.customValuesSyncRunning = false
	o.customValuesSyncQueue = nil
	o.activeSyncCancel = nil

	slog.Warn("Cleared all sync flags (panic recovery)")
}

// IsUnifiedSyncQueued checks if a sync with the given year and service is already queued.
func (o *Orchestrator) IsUnifiedSyncQueued(year int, service string) bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year && o.pendingUnifiedSyncs[i].Service == service {
			return true
		}
	}

	return false
}

// InitializeSyncServices creates and registers all sync services
func (o *Orchestrator) InitializeSyncServices() error {
	// Create CampMinder client from environment
	cfg := &campminder.Config{
		APIKey:   os.Getenv("CAMPMINDER_API_KEY"),
		ClientID: os.Getenv("CAMPMINDER_CLIENT_ID"),
		SeasonID: 0, // Will be parsed below
	}

	// Parse season ID
	if seasonStr := os.Getenv("CAMPMINDER_SEASON_ID"); seasonStr != "" {
		if seasonID, err := strconv.Atoi(seasonStr); err == nil {
			cfg.SeasonID = seasonID
		} else {
			slog.Error("Failed to parse CAMPMINDER_SEASON_ID", "value", seasonStr, "error", err)
		}
	}

	// Validate configuration with detailed errors
	if cfg.APIKey == "" || cfg.ClientID == "" || cfg.SeasonID == 0 {
		missingVars := []string{}
		if cfg.APIKey == "" {
			missingVars = append(missingVars, "CAMPMINDER_API_KEY")
		}
		if cfg.ClientID == "" {
			missingVars = append(missingVars, "CAMPMINDER_CLIENT_ID")
		}
		if cfg.SeasonID == 0 {
			missingVars = append(missingVars, "CAMPMINDER_SEASON_ID")
		}
		return fmt.Errorf("missing required CampMinder configuration: %v", missingVars)
	}

	// Create CampMinder client
	client, err := campminder.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("creating CampMinder client: %w", err)
	}

	// Store base client for year overrides
	o.baseClient = client

	// Register sync services in dependency order
	o.RegisterService("session_groups", NewSessionGroupsSync(o.app, client))
	o.RegisterService("sessions", NewSessionsSync(o.app, client))
	o.RegisterService("attendees", NewAttendeesSync(o.app, client))
	o.RegisterService("person_tag_defs", NewPersonTagDefinitionsSync(o.app, client))
	o.RegisterService("custom_field_defs", NewCustomFieldDefinitionsSync(o.app, client))
	// Global lookups: positions, org_categories, program_areas
	o.RegisterService("staff_lookups", NewStaffLookupsSync(o.app, client))
	// Global lookups: financial_categories, payment_methods
	o.RegisterService("financial_lookups", NewFinancialLookupsSync(o.app, client))
	o.RegisterService("divisions", NewDivisionsSync(o.app, client)) // Division definitions
	// "persons" is a combined sync that populates persons and households tables
	// from a single API call (tags are stored as multi-select relation on persons)
	// Division relation on persons is set during persons sync (derived from persons API)
	o.RegisterService("persons", NewPersonsSync(o.app, client))
	o.RegisterService("bunks", NewBunksSync(o.app, client))
	o.RegisterService("bunk_plans", NewBunkPlansSync(o.app, client))
	o.RegisterService("bunk_assignments", NewBunkAssignmentsSync(o.app, client))
	o.RegisterService("reconcile_request_lifecycle", NewReconcileLifecycleSync(o.app))
	o.RegisterService("stranded_assignment_cleanup", NewStrandedAssignmentCleanupSync(o.app))
	o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, client))
	// Register the request processor (no CampMinder client needed)
	processor := NewRequestProcessor(o.app)
	processor.CollectTraces = true // Always collect traces for scheduled/automated runs
	processor.Trigger = "scheduled"
	o.RegisterService("process_requests", processor)
	// Staff sync: year-scoped staff records (depends on staff_lookups running in weekly sync)
	o.RegisterService("staff", NewStaffSync(o.app, client))
	// Financial transactions: year-scoped transaction data (depends on financial_lookups running in weekly sync)
	o.RegisterService("financial_transactions", NewFinancialTransactionsSync(o.app, client))

	// Register Google Sheets multi-workbook export (optional, requires configuration)
	if google.IsEnabled() {
		ctx := context.Background()
		sheetsClient, err := google.NewSheetsClient(ctx)
		if err != nil {
			slog.Warn("Google Sheets disabled due to client error", "error", err)
		} else if sheetsClient != nil {
			sheetsWriter := NewRateLimitedSheetsWriter(NewRealSheetsWriter(sheetsClient), nil)
			// Use DefaultDriveSearcher to enable automatic recovery of existing workbooks
			// when the database is cleared but sheets still exist in Drive
			driveSearcher := &DefaultDriveSearcher{}
			workbookManager := NewWorkbookManagerWithSearcher(o.app, sheetsWriter, driveSearcher)
			exporter, err := NewMultiWorkbookExport(o.app, sheetsWriter, workbookManager, 0)
			if err != nil {
				slog.Warn("Multi-workbook export disabled: year resolution failed", "error", err)
			} else {
				o.RegisterService("multi_workbook_export", exporter)
				slog.Info("Multi-workbook export service registered")
			}
		}
	}

	// Register on-demand sync services (NOT part of daily sync)
	// These require N API calls (one per entity) so are triggered manually
	o.RegisterService("person_custom_values", NewPersonCustomFieldValuesSync(o.app, client))
	o.RegisterService("household_custom_values", NewHouseholdCustomFieldValuesSync(o.app, client))

	// Scoped variants of the two services above -- see scopedServiceRegistrations.
	for _, reg := range scopedServiceRegistrations(o.app, client) {
		reg.svc.SetScope(reg.scope)
		o.RegisterService(scopedID(reg.base, reg.scope), reg.svc)
	}

	// Family camp derived tables (computes from custom values - on-demand)
	o.RegisterService("family_camp_derived", NewFamilyCampDerivedSync(o.app))

	// Lodging assignments (derived from the cabin custom fields - on-demand)
	o.RegisterService("lodging_assignments", NewLodgingAssignmentsSync(o.app))

	// Staff skills (derived from person_custom_values Skills- fields)
	o.RegisterService("staff_skills", NewStaffSkillsSync(o.app))

	// Financial aid applications (derived from person_custom_values FA- fields)
	o.RegisterService("financial_aid_applications", NewFinancialAidApplicationsSync(o.app))

	// Household demographics (computes from HH- fields + household custom values - on-demand)
	o.RegisterService("household_demographics", NewHouseholdDemographicsSync(o.app))

	// Camper dietary (computes from Family Medical-* fields)
	o.RegisterService("camper_dietary", NewCamperDietarySync(o.app))

	// Camper transportation (computes from BUS-* fields)
	o.RegisterService("camper_transportation", NewCamperTransportationSync(o.app))

	// Quest registrations (computes from Quest-*/Q-* fields)
	o.RegisterService("quest_registrations", NewQuestRegistrationsSync(o.app))

	// Staff applications (computes from App-* fields)
	o.RegisterService("staff_applications", NewStaffApplicationsSync(o.app))

	// Staff vehicle info (computes from SVI-* fields)
	o.RegisterService("staff_vehicle_info", NewStaffVehicleInfoSync(o.app))

	// Geographic normalization (normalizes persons.school/city/congregation)
	o.RegisterService("normalize_geographic", NewNormalizeGeographicSync(o.app))

	// Enrollment snapshots (captures daily enrollment counts per session)
	o.RegisterService("enrollment_snapshots", NewEnrollmentSnapshotsSync(o.app))

	slog.Info("All sync services registered")
	return nil
}
