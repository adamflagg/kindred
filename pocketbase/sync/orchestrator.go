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

	// hourlySyncJob is the single service the hourly cron refreshes.
	hourlySyncJob = "bunk_assignments"
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
	// Scope is the cohort this row covers. See the Scope type.
	Scope Scope
}

// syncJobMeta defines the phase and metadata for all sync jobs
// Jobs are listed in execution order within their phase
var syncJobMeta = []JobMeta{
	// Source phase - CampMinder API calls
	{ID: "session_groups", Phase: PhaseSource, Description: "Session groups from CampMinder"},
	{ID: "sessions", Phase: PhaseSource, Description: "Sessions from CampMinder"},
	{ID: "attendees", Phase: PhaseSource, Description: "Attendees from CampMinder"},
	{ID: "persons", Phase: PhaseSource, Description: "Persons + households from CampMinder"},
	{ID: "bunks", Phase: PhaseSource, Description: "Bunks from CampMinder"},
	{ID: "bunk_plans", Phase: PhaseSource, Description: "Bunk plans from CampMinder"},
	{ID: "bunk_assignments", Phase: PhaseSource, Description: "Bunk assignments from CampMinder"},
	{ID: "staff", Phase: PhaseSource, Description: "Staff from CampMinder"},
	{ID: "financial_transactions", Phase: PhaseSource, Description: "Financial transactions from CampMinder"},

	// Expensive phase - Custom values (on-demand, rate limited)
	{ID: "person_custom_values", Phase: PhaseExpensive, Description: "Person custom field values"},
	{ID: "household_custom_values", Phase: PhaseExpensive, Description: "Household custom field values"},
	// Bounded daily family-camp pass (kindred#2482): same API cost per entity as the two
	// above, scoped to family-camp attendees (any status) and run as part of the daily
	// cron -- see getDailySyncJobs.
	{ID: "person_custom_values_family_camp", Phase: PhaseExpensive,
		Description: "Person custom field values -- bounded daily pass, family-camp attendees, any status",
		Base:        "person_custom_values", Scope: ScopeFamilyCamp},
	{ID: "household_custom_values_family_camp", Phase: PhaseExpensive,
		Description: "Household custom field values -- bounded daily pass, family-camp attendees, any status",
		Base:        "household_custom_values", Scope: ScopeFamilyCamp},

	// Transform phase - PocketBase → PocketBase
	{ID: "family_camp_derived", Phase: PhaseTransform, Description: "Compute family camp tables from custom values"},
	{ID: "lodging_assignments", Phase: PhaseTransform, Description: "Derive lodging assignments from CampMinder cabin fields"},
	{ID: "staff_skills", Phase: PhaseTransform, Description: "Extract staff skills from person_custom_values"},
	{ID: "financial_aid_applications", Phase: PhaseTransform, Description: "Extract FA applications from person_custom_values"},
	{ID: "household_demographics", Phase: PhaseTransform, Description: "Compute household demographics from custom values"},
	{ID: "camper_dietary", Phase: PhaseTransform, Description: "Extract camper dietary/allergy info from custom values"},
	{ID: "camper_transportation", Phase: PhaseTransform, Description: "Extract camper transportation info from custom values"},
	{ID: "quest_registrations", Phase: PhaseTransform, Description: "Extract Quest program registration info from custom values"},
	{ID: "staff_applications", Phase: PhaseTransform, Description: "Extract staff application info from custom values"},
	{ID: "staff_vehicle_info", Phase: PhaseTransform, Description: "Extract staff vehicle info from custom values"},
	{ID: "normalize_geographic", Phase: PhaseTransform, Description: "Normalize geographic data (cities, schools, congregations)"},
	{ID: "enrollment_snapshots", Phase: PhaseTransform, Description: "Capture daily enrollment counts per session"},
	{ID: "stranded_assignment_cleanup", Phase: PhaseTransform, Description: "Auto-unassign scenario drafts stranded by bunk or cancellation"},

	// Process phase - CSV + AI
	{ID: "reconcile_request_lifecycle", Phase: PhaseProcess, Description: "Mark moved-requester OBRs for reprocessing"},
	{ID: "bunk_requests", Phase: PhaseProcess, Description: "Import bunk request CSV"},
	{ID: "process_requests", Phase: PhaseProcess, Description: "AI processing of bunk requests"},

	// Export phase - Google Sheets
	{ID: "multi_workbook_export", Phase: PhaseExport, Description: "Export to Google Sheets"},
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

// GetDefaultUnifiedSyncJobs returns the default job list for a unified sync
// (when no specific services are requested). The includeCustomValues flag
// controls whether expensive custom values API syncs are included.
// Transform phase jobs always run using existing custom values data.
func GetDefaultUnifiedSyncJobs(includeCustomValues bool) []string {
	// Source phase: CampMinder API syncs
	jobs := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",
		"financial_transactions",
	}

	// Expensive phase: Custom values (1 API call per entity)
	if includeCustomValues {
		jobs = append(jobs,
			"person_custom_values", "household_custom_values")
	}

	// Transform phase: Always run using existing custom values data
	// (same as daily sync behavior)
	jobs = append(jobs,
		"family_camp_derived", "lodging_assignments", "staff_skills",
		"financial_aid_applications", "household_demographics",
		"camper_dietary", "camper_transportation", "quest_registrations",
		"staff_applications", "staff_vehicle_info", "normalize_geographic",
		"enrollment_snapshots", "stranded_assignment_cleanup")

	return jobs
}

// ResolveUnifiedSyncServices returns the concrete service names a unified sync with these
// parameters will run. handleUnifiedSync calls this to validate dry_run support *before*
// responding, and RunSyncWithOptions calls it to decide what to actually run -- one function so
// the two can never quietly drift apart (kindred#2334: a validator that resolves a different
// list than the one that actually runs is worse than no validator).
//
// isCurrentYear must mean what RunSyncWithOptions's opts.Year == 0 means: true for the
// live/current-year run (which also picks up reconcile_request_lifecycle, bunk_requests, and,
// in Docker, process_requests), false for a historical replay.
func ResolveUnifiedSyncServices(service string, includeCustomValues, isCurrentYear bool) []string {
	if service != DefaultService {
		return []string{service}
	}

	services := GetDefaultUnifiedSyncJobs(includeCustomValues)
	if isCurrentYear {
		services = append(services, "reconcile_request_lifecycle", "bunk_requests")
		if os.Getenv("IS_DOCKER") == boolTrueStr {
			services = append(services, "process_requests")
		}
	}
	return services
}

// Service defines the interface for sync services
type Service interface {
	Sync(ctx context.Context) error
	Name() string
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
	app                     core.App
	services                map[string]Service
	mu                      sync.RWMutex
	runningJobs             map[string]*Status
	lastCompletedStatus     map[string]*Status // Store last completed status for each job
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
// nests: RunDailySync calls RunWeeklySync *before* opening its own batch, and
// RunSyncWithOptions does the same. No beginBatch nesting existed anywhere in the tree, so
// the only thing the shared slot ever did was let concurrent runs corrupt each other.
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

// GetChangedCollections returns a set of collections that had changes in the last sync run.
// Collections not in the returned map should skip export since their data hasn't changed.
// The mapping uses SyncJobToCollections to translate sync job names to collection names.
func (o *Orchestrator) GetChangedCollections() map[string]bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	changed := make(map[string]bool)
	for syncType, status := range o.lastCompletedStatus {
		if !status.Summary.IsNoOp() {
			if collections, ok := SyncJobToCollections[syncType]; ok {
				for _, col := range collections {
					changed[col] = true
				}
			}
		}
	}
	return changed
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

// GetWeeklySyncJobs returns the list of services that run in the weekly sync.
// These are global definition tables that rarely change and don't need daily updates.
func GetWeeklySyncJobs() []string {
	return []string{
		"person_tag_defs",
		"custom_field_defs",
		"staff_lookups",     // Global: positions, org_categories, program_areas
		"financial_lookups", // Global: financial_categories, payment_methods
		"divisions",         // Global: division definitions (no year field)
	}
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
		scopedID("person_custom_values", ScopeFamilyCamp),
		scopedID("household_custom_values", ScopeFamilyCamp),
		"family_camp_derived",
		"lodging_assignments",
	}
}

// GetCustomValuesSyncJobs returns the list of services that run in the custom values sync.
// These are expensive syncs (1 API call per entity) that run weekly after the main weekly sync.
func GetCustomValuesSyncJobs() []string {
	return []string{
		"person_custom_values",
		"household_custom_values",
	}
}

// RunSyncSequence runs multiple sync services sequentially, waiting for each
// to complete before starting the next. Unlike RunSyncWithOptions, this is
// lightweight — no global table checks, no year override, no daily/historical
// tracking. Used for targeted refreshes like bunking (bunks -> bunk_plans ->
// bunk_assignments).
func (o *Orchestrator) RunSyncSequence(ctx context.Context, services []string) error {
	// A targeted refresh is still a queue, so its jobs are grouped as one batch. It carries
	// no run-type flag and is only ever reached from an operator action, hence manual.
	batch := newBatch(triggerManual)

	for _, svc := range services {
		if err := o.runSyncAndWait(ctx, svc, batch); err != nil {
			return fmt.Errorf("sync sequence failed on %s: %w", svc, err)
		}
	}
	return nil
}

// RunSingleSync runs a single sync service.
//
// Every caller is an operator action against one service — an API handler, or a test — so the
// run is manual and forms a batch of one. A queue that wants its jobs grouped calls
// runSyncAndWait with its own batch instead.
func (o *Orchestrator) RunSingleSync(parentCtx context.Context, syncType string) error {
	_, err := o.runSingleSyncInternal(parentCtx, syncType, newBatch(triggerManual))
	return err
}

// runSingleSyncInternal runs a single sync service and returns the run token. `origin` names
// the grouped run this execution belongs to; see runOrigin for why it is a parameter.
func (o *Orchestrator) runSingleSyncInternal(
	parentCtx context.Context, syncType string, origin runOrigin,
) (string, error) {
	// Check if service exists
	o.mu.RLock()
	service, exists := o.services[syncType]
	existingStatus := o.runningJobs[syncType]
	o.mu.RUnlock()

	if !exists {
		return "", fmt.Errorf("sync service not found: %s", syncType)
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
		}

		o.mu.Lock()
		o.runningJobs[syncType] = status
		o.mu.Unlock()
	}

	// Run sync with panic recovery
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
		Trigger:   origin.trigger,
		BatchID:   origin.batchID,
	}
	o.runningJobs[syncType] = status
	o.mu.Unlock()

	// Run sync with panic recovery — mirrors runSingleSyncInternal's goroutine below, but
	// against the caller-supplied `service` rather than a registry lookup.
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

	o.recordSyncRun(&snapshot)

	// Read the outcome off the snapshot: &completed is in the map now, so reading its
	// fields would be reading memory other goroutines can reach.
	finalStatus, finalError := snapshot.Status, snapshot.Error

	if finalStatus == statusFailed {
		slog.Error("Sync failed", "syncType", syncType, "error", finalError)
	} else {
		slog.Info("Sync completed successfully", "syncType", syncType)
	}
}

// checkGlobalTablesEmpty checks if essential global tables have been synced.
// Returns true if global tables are empty and weekly sync should run first.
func (o *Orchestrator) checkGlobalTablesEmpty() bool {
	// Quick check on person_tag_defs - if empty, globals haven't run
	records, _ := o.app.FindRecordsByFilter("person_tag_defs", "", "", 1, 0)
	return len(records) == 0
}

// getDailySyncJobs returns the ordered list of jobs the daily sync runs,
// respecting inter-job dependencies. stranded_assignment_cleanup is always appended last:
// it must run after bunk_plans is final so it can sweep scenario drafts left
// stranded by bunk-plan reorganizations (#1416, #1417). Extracted from
// RunDailySync so the ordering can be asserted in tests.
func getDailySyncJobs() []string {
	// Define sync order (respecting dependencies)
	// Note: person_tag_defs, custom_field_defs, and divisions run in weekly sync
	// since they're global definitions that rarely change
	// Note: "persons" is a combined sync that populates persons and households
	// tables from a single API call (tags are stored as multi-select relation on persons)
	orderedJobs := []string{
		"session_groups",         // No dependencies - sync first for group data
		"sessions",               // Depends on session_groups (for session_group relation)
		"attendees",              // Depends on sessions
		"persons",                // Depends on attendees and divisions (combined sync: persons + households)
		"bunks",                  // No dependencies
		"bunk_plans",             // Depends on sessions and bunks
		"bunk_assignments",       // Depends on sessions, persons, bunks
		"staff",                  // Staff sync: depends on divisions, bunks, persons
		"financial_transactions", // Source data: depends on sessions, persons, households, divisions
		// Bounded daily family-camp custom-values pass (kindred#2482), inserted here --
		// between the source jobs above and the transform jobs below -- so the transform
		// phase sees today's cabin answers instead of up to 7 days stale ones. Scoped to
		// family-camp attendees (any status, via SessionResolver's attendees-backed
		// cohort) so it stays cheap: ~11.5 min for ~450 households against the weekly
		// sweep's ~43 min for everyone. The weekly unrestricted sweep (Scheduler, cron
		// "0 4 * * 0") is UNCHANGED and still refreshes every other custom-values
		// consumer -- dietary, transportation, financial aid, staff skills, and so on.
		"person_custom_values_family_camp",
		"household_custom_values_family_camp",
		// Transform phase: derived tables run daily using the freshest source data, plus
		// today's family-camp custom values (the bounded pass immediately above) and every
		// other custom value from the most recent weekly sync. New enrollments, session
		// changes, etc. are reflected immediately.
		"family_camp_derived",
		"lodging_assignments", // Derived: cabin custom fields -> lodging_assignments (+ history)
		"staff_skills",
		"financial_aid_applications",
		"household_demographics",
		"camper_dietary",
		"camper_transportation",
		"quest_registrations",
		"staff_applications",
		"staff_vehicle_info",
		"normalize_geographic",
		"enrollment_snapshots",
		"reconcile_request_lifecycle", // Detect session moves; marks OBRs for reprocessing
		"bunk_requests",               // CSV import, depends on persons
	}

	// Only include process_requests in production (Docker) mode
	// In development, skip AI processing to avoid unnecessary API costs
	// Process requests can be triggered manually when needed
	if os.Getenv("IS_DOCKER") == boolTrueStr {
		orderedJobs = append(orderedJobs, "process_requests")
	} else {
		slog.Info("Skipping process_requests in development mode (set IS_DOCKER=true to enable)")
	}

	// Add Google Sheets multi-workbook export if enabled (runs after all data syncs complete)
	if google.IsEnabled() {
		orderedJobs = append(orderedJobs, "multi_workbook_export")
	}

	// Stranded assignment cleanup runs last — after bunk_plans is final, it
	// sweeps scenario drafts left stranded by bunk-plan reorganizations
	// (#1416, #1417).
	orderedJobs = append(orderedJobs, "stranded_assignment_cleanup")

	return orderedJobs
}

// RunHourlySync runs the hourly refresh — a single service, bunk_assignments — and waits for
// it to finish.
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
	return o.runSyncAndWait(ctx, hourlySyncJob, newBatch(triggerHourly))
}

// RunDailySync runs all base data syncs in the correct order
func (o *Orchestrator) RunDailySync(ctx context.Context) error {
	// Check if global tables are empty - if so, run weekly sync first
	// This ensures fresh DB setups have required global definitions before daily sync
	if o.checkGlobalTablesEmpty() {
		slog.Info("Global tables empty - running weekly sync first")
		if err := o.RunWeeklySync(ctx); err != nil {
			slog.Error("Weekly sync failed, continuing with daily", "error", err)
		}
	}

	orderedJobs := getDailySyncJobs()

	// Minted here, after the weekly prologue above: the two are sequential queues, not
	// nested ones, and each files its own jobs under its own trigger.
	batch := newBatch(triggerDaily)

	// Set daily sync flag and queue
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = orderedJobs
	o.currentRunIndex = 0 // Reset index at start
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.dailySyncRunning = false
		o.dailySyncQueue = nil
		o.currentRunIndex = 0
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
//nolint:dupl // Similar pattern to RunCustomValuesSync, intentional for sync orchestration
func (o *Orchestrator) RunWeeklySync(ctx context.Context) error {
	// Get the weekly sync jobs
	weeklyJobs := GetWeeklySyncJobs()

	batch := newBatch(triggerWeekly)

	// Set weekly sync flag and queue
	o.mu.Lock()
	o.weeklySyncRunning = true
	o.weeklySyncQueue = weeklyJobs
	o.currentRunIndex = 0 // Reset index at start
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.weeklySyncRunning = false
		o.weeklySyncQueue = nil
		o.currentRunIndex = 0
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

	// Set custom values sync flag and queue
	// Note: currentRunIndex is 0 for parallel syncs (all jobs run simultaneously)
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = customValuesJobs
	o.currentRunIndex = 0
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.customValuesSyncRunning = false
		o.customValuesSyncQueue = nil
		o.currentRunIndex = 0
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
func (o *Orchestrator) runSyncAndWait(ctx context.Context, syncType string, origin runOrigin) error {
	// Start the sync and capture the token directly from the return value.
	// This eliminates the race where the goroutine completes before we can
	// read the token from runningJobs (issue #789).
	expectedToken, err := o.runSingleSyncInternal(ctx, syncType, origin)
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

	// Check if global tables are empty - if so, run weekly sync first
	// This ensures fresh DB setups have required global definitions before any sync
	// The check is quick (1 DB query) so we do it regardless of year.
	//
	// Never on a dry run. RunWeeklySync fetches and writes person_tag_defs,
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
			slog.Info("Global tables empty - running weekly sync first")
			if err := o.RunWeeklySync(ctx); err != nil {
				slog.Error("Weekly sync failed, continuing with sync", "error", err)
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

	// Set up sync tracking based on year mode. The batch carries the year explicitly:
	// o.currentSyncYear below is process-global and stays set for this sync's whole
	// duration, so a run started by any other queue in the meantime would otherwise be
	// filed under a backfill's year.
	var batch runOrigin
	if opts.Year > 0 {
		batch = newBatch(triggerHistorical).forYear(opts.Year)

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
			o.mu.Unlock()
		}()
	} else {
		batch = newBatch(triggerDaily)

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

	// After historical sync completes, trigger Google Sheets export for that year only (no globals).
	//
	// Not on a dry run: SyncForYears writes spreadsheets and the master index for real, and
	// GetChangedCollections would happily nominate collections a dry run only *computed*
	// (the dry-run branches still populate Stats.Created, so IsNoOp() is false). "dry_run
	// writes nothing" has to mean the Google side too (kindred#2334).
	if opts.Year > 0 && !opts.DryRun && google.IsEnabled() {
		o.mu.RLock()
		sheetsService := o.services["multi_workbook_export"]
		o.mu.RUnlock()

		if sheetsService != nil {
			if exporter, ok := sheetsService.(*MultiWorkbookExport); ok {
				// Get collections that had changes to skip unchanged exports
				changedCollections := o.GetChangedCollections()
				slog.Info("Historical sync: Exporting to Google Sheets",
					"year", opts.Year,
					"changed_collections", len(changedCollections))
				if err := exporter.SyncForYears(ctx, []int{opts.Year}, false, changedCollections); err != nil {
					slog.Error("Historical sync: Google Sheets export failed", "year", opts.Year, "error", err)
				} else {
					slog.Info("Historical sync: Google Sheets export completed", "year", opts.Year)
				}
			}
		}
	}

	// After current year sync completes, trigger Google Sheets export (globals + current year).
	// Skipped on a dry run for the same reason as the historical export above.
	if opts.Year == 0 && !opts.DryRun && google.IsEnabled() {
		o.mu.RLock()
		sheetsService := o.services["multi_workbook_export"]
		o.mu.RUnlock()

		if sheetsService != nil {
			if exporter, ok := sheetsService.(*MultiWorkbookExport); ok {
				// Get collections that had changes to skip unchanged exports
				changedCollections := o.GetChangedCollections()
				slog.Info("Sync with options: Exporting to Google Sheets",
					"changed_collections", len(changedCollections))
				// Use SyncForYears with exporter's year to benefit from skip optimization
				// exporter.year is already resolved from CAMPMINDER_SEASON_ID env var
				if err := exporter.SyncForYears(ctx, []int{exporter.year}, true, changedCollections); err != nil {
					slog.Error("Sync with options: Google Sheets export failed", "error", err)
				} else {
					slog.Info("Sync with options: Google Sheets export completed")
				}
			}
		}
	}

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

	// Bounded daily family-camp custom-values pass (kindred#2482) -- distinct service
	// instances from the two above, scoped to family-camp attendees (any status) rather
	// than Session. Part of the daily cron: see getDailySyncJobs. The registered names come
	// from scopedID so they cannot drift from syncJobMeta's rows.
	for base, svc := range map[string]scopedService{
		"person_custom_values":    NewPersonCustomFieldValuesSync(o.app, client),
		"household_custom_values": NewHouseholdCustomFieldValuesSync(o.app, client),
	} {
		svc.SetScope(ScopeFamilyCamp)
		o.RegisterService(scopedID(base, ScopeFamilyCamp), svc)
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
