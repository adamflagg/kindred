package sync

// This file is kindred#2627: every sync service declares what shape it writes.
//
// The audit behind that issue found 118 grain-reduction sites in the transform
// layer, 19 of which silently discarded values. The individual instances were
// fixed one at a time (kindred#2450, #2326, #2520, #2280, #2266); this is the
// class-level prevention. A silent grain reduction is undetectable by
// construction as long as nothing writes down what the grain is SUPPOSED to be,
// so each service writes it down here and grain_test.go fails a service that
// does not.
//
// Deliberately a SIBLING table keyed by service name rather than fields on
// JobMeta (ruled 2026-08-30). JobMeta answers "when does this run and what
// triggers it" -- scheduling. This answers "what shape does it write" -- data.
// Two concerns with two lifecycles; merging them gives every reader of either a
// struct half of which they must ignore.
//
// # What "full grain" means, and why only six services carry it
//
// A guarded sync writes rows keyed by a composite key it tracks in
// ProcessedKeys, and then sweeps the rows it did NOT track. The sweep rebuilds
// that same key from a STORED row (DeleteOrphansGuarded's getIDFunc). Those two
// key builders live in different functions, are written months apart, and
// nothing makes them move together -- and when they disagree the sweep deletes
// the rows the run just wrote. WriteKey and OrphanKey are those two builders,
// written down side by side so a disagreement is legible.
//
// Only the six BaseSyncService.DeleteOrphansGuarded callers carry that shape,
// because they are the only services where both halves are readable from a
// single call site (ruled 2026-08-31). Deriving a key for the other 29
// collection-writers was considered and rejected: nine of them carry their own
// deleteOrphans without embedding BaseSyncService at all (see OrphanSweepGuard's
// doc comment), so a key declared for those would be asserted here and read
// nowhere -- it would drift from the real write path with nothing to catch it,
// which is the exact failure class this file exists to prevent.
//
// Every OTHER service still declares its collections, plus a per-collection
// NoGrain reason or a service-level WritesNothing reason. That is what makes
// grain_test.go's fail-an-undeclared-service rule mean anything: an entry only
// the guarded six carried would leave 29 names silently exempt. The reason
// travels with the service rather than sitting in a central exemption list,
// because a central list is where the reason rots.

// ReducePolicy names what happens when two upstream inputs in ONE run land on
// the same write key -- the collapse the issue's audit was counting. A site that
// reduces without declaring how is a test failure rather than a discovery.
//
// New policies get added when a service declares one. The set is deliberately
// not speculative: an unused constant here is a policy nobody has checked
// against real code.
type ReducePolicy string

const (
	// ReduceNone means nothing collapses, because the declared key IS the upstream
	// entity's own identity. Two inputs sharing it is not a shape the upstream
	// feed produces.
	ReduceNone ReducePolicy = "none"

	// ReduceLastWriteWins means several inputs can share the key in one run, and
	// whichever is processed last wins the upsert. Arrival order, not a
	// timestamp -- nothing here compares recency.
	ReduceLastWriteWins ReducePolicy = "last_write_wins"

	// ReduceRejectDuplicate means a second input for a key this run already
	// tracked is discarded and counted Stats.Rejected, with a warning naming it
	// (kindred#2270). The storage grain is unchanged; the collapse is made loud.
	ReduceRejectDuplicate ReducePolicy = "reject_duplicate"
)

// CollectionGrain is one collection a service writes.
//
// Exactly one of two shapes is legal, and grain_test.go pins that:
//   - FULL: WriteKey, OrphanKey, UniqueIndex and Reduce all set, NoGrain empty.
//   - NO GRAIN: NoGrain carries a one-line reason, the other four empty.
type CollectionGrain struct {
	// Collection is the PocketBase collection name, exactly as it appears in
	// sqlite_master.
	Collection string

	// WriteKey is the composite key the WRITE path tracks in ProcessedKeys,
	// written in field terms rather than as a format string -- e.g.
	// "person_cm_id:session_cm_id|year". TrackProcessedCompositeKey appends the
	// "|year" suffix, so it is part of the key even where the call site does not
	// spell it.
	WriteKey string

	// OrphanKey is the same key as the SWEEP rebuilds it from a stored row --
	// DeleteOrphansGuarded's getIDFunc. It must describe the same key as
	// WriteKey; where the two texts differ, the two code paths disagree and a
	// sweep deletes rows the run just wrote.
	OrphanKey string

	// UniqueIndex names the UNIQUE index that enforces this grain in SQLite.
	// grain_test.go asserts it against a booted PocketBase's sqlite_master --
	// never a regex over pb_migrations, which passes on a migration that never
	// applied.
	UniqueIndex string

	// Reduce names the collapse policy for two inputs sharing WriteKey.
	Reduce ReducePolicy

	// NoGrain is a one-line reason this collection carries no declarable
	// write/orphan key pair. Set iff the four fields above are empty.
	NoGrain string
}

// HasFullGrain reports whether this collection carries the full declaration
// rather than a NoGrain reason.
func (c *CollectionGrain) HasFullGrain() bool {
	return c.WriteKey != "" && c.OrphanKey != "" && c.UniqueIndex != "" && c.Reduce != ""
}

// ServiceGrain is one registered sync service's declaration.
//
// Exactly one of Writes, WritesNothing and SameGrainAs is set.
type ServiceGrain struct {
	// Service is the registered service name -- the same string a
	// syncJobMeta row's ID carries and o.RegisterService is called with.
	Service string

	// Writes is every PocketBase collection this service writes, one entry
	// each. Empty iff WritesNothing or SameGrainAs is set.
	Writes []CollectionGrain

	// WritesNothing is a one-line reason this service writes no PocketBase
	// collection at all. Only two of the thirty-five qualify.
	WritesNothing string

	// SameGrainAs names another declared service whose Writes this one shares
	// verbatim -- the scoped variants (scope.go's scopedServiceRegistrations)
	// are the same Go type under a narrower cohort, so restating their keys
	// would put a second copy of each in the tree, which is what this file
	// exists to avoid.
	SameGrainAs string
}

// serviceGrainDeclarations is the table. One entry per registered service; the
// registered set is the union of orchestrator.go's RegisterService literals and
// scope.go's scopedServiceRegistrations, and grain_test.go asserts that union
// both ways.
var serviceGrainDeclarations = []ServiceGrain{
	// ---------------------------------------------------------------- Global
	// Cross-year definition tables, refreshed by the Sunday-2am cron. Every one
	// of them writes through ProcessSimpleRecordGlobal and sweeps through the
	// UNGUARDED DeleteOrphans, so none has a DeleteOrphansGuarded call site to
	// read a key pair off.

	{Service: "person_tag_defs", Writes: []CollectionGrain{{
		Collection: "person_tag_defs",
		NoGrain: "ProcessSimpleRecordGlobal + unguarded DeleteOrphans " +
			"(person_tag_definitions.go); no guarded sweep, so a key declared here " +
			"would be read by nothing and drift unnoticed",
	}}},

	{Service: "custom_field_defs", Writes: []CollectionGrain{{
		Collection: "custom_field_defs",
		NoGrain: "ProcessSimpleRecordGlobal + unguarded DeleteOrphans " +
			"(custom_field_definitions.go); no guarded sweep",
	}}},

	{Service: "staff_lookups", Writes: []CollectionGrain{
		{
			Collection: "staff_positions",
			NoGrain: "one of three lookup tables staff_lookups.go syncs from a single " +
				"Stats; ProcessSimpleRecordGlobal + unguarded DeleteOrphans",
		},
		{
			Collection: "staff_org_categories",
			NoGrain:    "second of staff_lookups.go's three tables; same unguarded sweep",
		},
		{
			Collection: "staff_program_areas",
			NoGrain:    "third of staff_lookups.go's three tables; same unguarded sweep",
		},
	}},

	{Service: "financial_lookups", Writes: []CollectionGrain{
		{
			Collection: "financial_categories",
			NoGrain: "one of two lookup tables financial_lookups.go syncs from a single " +
				"Stats; ProcessSimpleRecordGlobal + unguarded DeleteOrphans",
		},
		{
			Collection: "payment_methods",
			NoGrain:    "second of financial_lookups.go's two tables; same unguarded sweep",
		},
	}},

	{Service: "divisions", Writes: []CollectionGrain{{
		Collection: "divisions",
		NoGrain: "ProcessSimpleRecordGlobal + unguarded DeleteOrphans (divisions.go); " +
			"the only year-less CampMinder table in the source set",
	}}},

	// ---------------------------------------------------------------- Source

	{Service: "session_groups", Writes: []CollectionGrain{{
		Collection: "session_groups",
		NoGrain: "ProcessSimpleRecord + unguarded DeleteOrphans (session_groups.go); " +
			"no guarded sweep",
	}}},

	{Service: "sessions", Writes: []CollectionGrain{{
		Collection: "camp_sessions",
		NoGrain:    "ProcessSimpleRecord + unguarded DeleteOrphans (sessions.go)",
	}}},

	{Service: "attendees", Writes: []CollectionGrain{
		{
			Collection: "attendees",
			// attendees.go:317 builds "person_cm_id:session_cm_id" and
			// TrackProcessedCompositeKey appends "|year"; attendees.go:479's
			// getIDFunc rebuilds "person_cm_id:session_cm_id|year" from the stored
			// row's person_id, its session relation's cm_id, and its year.
			WriteKey:    "person_cm_id:session_cm_id|year",
			OrphanKey:   "person_cm_id:session_cm_id|year",
			UniqueIndex: "idx_attendees_unique",
			// ProgramID is deliberately NOT in the key (kindred#2263), so one
			// person's two SessionProgramStatus entries for the same session
			// collapse onto one row: "whichever is processed last wins the upsert",
			// as duplicateSessionEnrollments' doc comment states. That function
			// counts and logs the collapse; it does not prevent it.
			Reduce: ReduceLastWriteWins,
		},
		{
			Collection: "attendee_status_history",
			NoGrain: "append-only audit trail written by logStatusChange; nothing ever " +
				"sweeps it, so there is no orphan key for a write key to agree with",
		},
	}},

	{Service: "persons", Writes: []CollectionGrain{
		{
			Collection: "persons",
			// TrackProcessedKey -> CompositeKey(cm_id, year) = "cm_id|year";
			// persons.go:1213's getIDFunc rebuilds CompositeKey(cm_id, year) from
			// the stored row. Both call the SAME helper, which is why this pair
			// cannot drift the way the composite-key services can.
			WriteKey:    "person_cm_id|year",
			OrphanKey:   "person_cm_id|year",
			UniqueIndex: "idx_persons_campminder",
			// cm_id IS CampMinder's identity for a person, so two feed entries
			// sharing it is not a shape this sync sees.
			Reduce: ReduceNone,
		},
		{
			Collection: "households",
			NoGrain: "swept by PersonsSync.deleteHouseholdOrphans, hand-rolled rather " +
				"than routed through DeleteOrphansGuarded because it builds its key set " +
				"upstream of the transform that rejects (see skipSweepForRejections)",
		},
	}},

	{Service: "bunks", Writes: []CollectionGrain{{
		Collection: "bunks",
		NoGrain:    "ProcessSimpleRecord + unguarded DeleteOrphans (bunks.go)",
	}}},

	{Service: "bunk_plans", Writes: []CollectionGrain{{
		Collection: "bunk_plans",
		// bunk_plans.go:417 builds "plan_cm_id:bunk_cm_id:session_cm_id" and
		// TrackProcessedCompositeKey appends "|year"; bunk_plans.go:496's
		// getIDFunc rebuilds the same string from the stored row's cm_id and its
		// bunk/session relations.
		WriteKey:    "plan_cm_id:bunk_cm_id:session_cm_id|year",
		OrphanKey:   "plan_cm_id:bunk_cm_id:session_cm_id|year",
		UniqueIndex: "idx_bunk_plans_bunk_session_year",
		// The plan's own CampMinder id is IN the key, deliberately, "to handle
		// multiple plans per session" -- so the key is the upstream row's own
		// identity and nothing collapses onto it.
		Reduce: ReduceNone,
	}}},

	{Service: "bunk_assignments", Writes: []CollectionGrain{{
		Collection: "bunk_assignments",
		// bunk_assignments.go:797 builds "person_cm_id:session_cm_id:bunk_cm_id"
		// and TrackProcessedCompositeKey appends "|year"; :1039's getIDFunc
		// rebuilds it from the stored row. FOUR sites build this format -- those
		// two plus protectNonActiveStaffAssignments (:986) and the values
		// preloadExistingAssignments indexes (:459) -- and that call site's own
		// comment says all four must move together.
		WriteKey:    "person_cm_id:session_cm_id:bunk_cm_id|year",
		OrphanKey:   "person_cm_id:session_cm_id:bunk_cm_id|year",
		UniqueIndex: "idx_bunk_assignments_person_session_bunk_year",
		// BunkPlanID is not in the key, and there is no in-run duplicate guard:
		// two feed entries differing only by bunk plan reach
		// ProcessCompositeRecord under one key and the second updates the first.
		Reduce: ReduceLastWriteWins,
	}}},

	{Service: "staff", Writes: []CollectionGrain{{
		Collection: "staff",
		NoGrain:    "ProcessSimpleRecord + unguarded DeleteOrphans (staff.go)",
	}}},

	{Service: "financial_transactions", Writes: []CollectionGrain{{
		Collection: "financial_transactions",
		NoGrain: "ProcessSimpleRecord + the UNGUARDED DeleteOrphansFromPreloaded " +
			"(financial_transactions.go:162); the sweep reuses the keys of the map " +
			"PreloadRecords already built rather than rebuilding one from a stored " +
			"row, so there is no second key builder for a WriteKey to disagree with",
	}}},

	// ------------------------------------------------------------- Expensive

	{Service: "person_custom_values", Writes: []CollectionGrain{
		{
			Collection: "person_custom_values",
			// person_custom_field_values.go:461 builds
			// "person_pb_id:field_definition_pb_id" and
			// TrackProcessedCompositeKey appends "|year"; :627's getIDFunc rebuilds
			// the same string from the stored row's relations. Note the identity
			// half is PocketBase ids, not CampMinder ids -- the sweep reads
			// relations, not cm_ids.
			WriteKey:    "person_pb_id:field_definition_pb_id|year",
			OrphanKey:   "person_pb_id:field_definition_pb_id|year",
			UniqueIndex: "idx_person_cf_vals_unique",
			// kindred#2270: a second entry for a key this run already tracked is
			// discarded, counted Stats.Rejected and logged, rather than silently
			// collapsing onto the first.
			Reduce: ReduceRejectDuplicate,
		},
		{
			Collection: "lodging_value_history",
			NoGrain: "append-only capture appended by logLodgingValueChange, deduped by " +
				"a filter query rather than a tracked key and never swept " +
				"(lodging_value_history.go)",
		},
	}},

	{Service: "household_custom_values", Writes: []CollectionGrain{
		{
			Collection: "household_custom_values",
			// household_custom_field_values.go:451 builds
			// "household_pb_id:field_definition_pb_id"; :615's getIDFunc rebuilds
			// it. Same shape as the person pair above.
			WriteKey:    "household_pb_id:field_definition_pb_id|year",
			OrphanKey:   "household_pb_id:field_definition_pb_id|year",
			UniqueIndex: "idx_household_cf_vals_unique",
			Reduce:      ReduceRejectDuplicate,
		},
		{
			Collection: "lodging_value_history",
			NoGrain: "append-only capture appended by logLodgingValueChange, deduped by " +
				"a filter query rather than a tracked key and never swept " +
				"(lodging_value_history.go)",
		},
	}},

	// The two bounded family-camp passes (kindred#2482) are separate registry
	// rows but the SAME Go types as the pair above, constructed by
	// scopedServiceRegistrations under ScopeFamilyCamp. Restating their keys
	// would put a second copy of each in the tree, which is the duplication this
	// file exists to remove.
	{Service: "person_custom_values_family_camp", SameGrainAs: "person_custom_values"},
	{Service: "household_custom_values_family_camp", SameGrainAs: "household_custom_values"},

	// ------------------------------------------------------------- Transform
	// Nine of the services below carry their own deleteOrphans without embedding
	// BaseSyncService at all -- OrphanSweepGuard's doc comment names them. They
	// build the collapse guard themselves, but the key pair is not readable from
	// one call site, so declaring one here would assert something nothing reads.

	{Service: "family_camp_derived", Writes: []CollectionGrain{
		{
			Collection: "family_camp_adults",
			NoGrain: "one of family_camp_derived's THREE hand-rolled sweeps (one guard " +
				"per derived table); it does not embed BaseSyncService, so there is no " +
				"single DeleteOrphansGuarded call site to read a key pair off",
		},
		{
			Collection: "family_camp_registrations",
			NoGrain:    "second of family_camp_derived's three hand-rolled sweeps",
		},
		{
			Collection: "family_camp_medical",
			NoGrain:    "third of family_camp_derived's three hand-rolled sweeps",
		},
	}},

	{Service: "lodging_assignments", Writes: []CollectionGrain{
		{
			Collection: "lodging_assignments",
			NoGrain: "current-state table upserted row by row in lodging_assignments_sync.go; " +
				"no DeleteOrphansGuarded call site and no BaseSyncService sweep",
		},
		{
			Collection: "lodging_assignment_history",
			NoGrain:    "append-only history written alongside the current-state row; never swept",
		},
		{
			Collection: "lodging_ingest_issues",
			NoGrain: "operator queue rows recorded and flushed by the issue queue " +
				"(lodging_issues.go) and reopened by lodging_replay.go; resolution state, " +
				"not a synced grain",
		},
		{
			Collection: "lodging_field_mappings",
			NoGrain: "per-source-field observation snapshot written once a run by " +
				"UpsertFieldMappingStatus (lodging_fields.go); never swept",
		},
	}},

	{Service: "staff_skills", Writes: []CollectionGrain{{
		Collection: "staff_skills",
		NoGrain: "StaffSkillsSync.deleteOrphans is hand-rolled -- one of the nine " +
			"services OrphanSweepGuard's doc names as not embedding BaseSyncService",
	}}},

	{Service: "financial_aid_applications", Writes: []CollectionGrain{{
		Collection: "financial_aid_applications",
		NoGrain: "financial_aid_applications.go performs no orphan sweep at all, so " +
			"there is no orphan key for a write key to agree with",
	}}},

	{Service: "household_demographics", Writes: []CollectionGrain{{
		Collection: "household_demographics",
		NoGrain: "HouseholdDemographicsSync.deleteOrphans is hand-rolled -- one of the " +
			"nine services that do not embed BaseSyncService",
	}}},

	{Service: "camper_dietary", Writes: []CollectionGrain{{
		Collection: "camper_dietary",
		NoGrain: "CamperDietarySync.deleteOrphans is hand-rolled -- one of the nine " +
			"services that do not embed BaseSyncService",
	}}},

	{Service: "camper_transportation", Writes: []CollectionGrain{{
		Collection: "camper_transportation",
		NoGrain: "CamperTransportationSync.deleteOrphans is hand-rolled -- one of the " +
			"nine services that do not embed BaseSyncService",
	}}},

	{Service: "quest_registrations", Writes: []CollectionGrain{{
		Collection: "quest_registrations",
		NoGrain: "QuestRegistrationsSync.deleteOrphans is hand-rolled -- one of the " +
			"nine services that do not embed BaseSyncService",
	}}},

	{Service: "staff_applications", Writes: []CollectionGrain{{
		Collection: "staff_applications",
		NoGrain: "StaffApplicationsSync.deleteOrphans is hand-rolled -- one of the nine " +
			"services that do not embed BaseSyncService (it shipped one of the two " +
			"hand-written guard copies OrphanSweepGuard replaced)",
	}}},

	{Service: "staff_vehicle_info", Writes: []CollectionGrain{{
		Collection: "staff_vehicle_info",
		NoGrain: "StaffVehicleInfoSync.deleteOrphans is hand-rolled -- one of the nine " +
			"services that do not embed BaseSyncService (it shipped the other " +
			"hand-written guard copy)",
	}}},

	{Service: "normalize_geographic", Writes: []CollectionGrain{{
		Collection: "normalized_mappings",
		NoGrain: "NormalizeGeographicSync.deleteOrphans is hand-rolled -- one of the " +
			"nine services that do not embed BaseSyncService",
	}}},

	{Service: "enrollment_snapshots", Writes: []CollectionGrain{{
		Collection: "enrollment_snapshots",
		NoGrain: "append-only daily capture -- one row per session per day, never " +
			"swept, so there is no orphan key",
	}}},

	{Service: "stranded_assignment_cleanup", Writes: []CollectionGrain{
		{
			Collection: "bunk_assignments_draft",
			NoGrain: "clears bunk and bunk_plan on existing draft rows in place; creates " +
				"and deletes nothing, so there is no write key and no sweep",
		},
		{
			Collection: "lodging_assignments_draft",
			NoGrain: "clears units on existing draft rows in place; creates and deletes " +
				"nothing",
		},
	}},

	// --------------------------------------------------------------- Process

	{Service: "reconcile_request_lifecycle", Writes: []CollectionGrain{{
		Collection: "original_bunk_requests",
		NoGrain: "clears `processed` on existing OBR rows so the Python processor " +
			"reprocesses them; creates and deletes nothing",
	}}},

	{Service: "bunk_requests", Writes: []CollectionGrain{
		{
			Collection: "original_bunk_requests",
			NoGrain: "CSV-driven upsert keyed by a FILTER query on " +
				"(requester, year, field) rather than a tracked ProcessedKeys entry, " +
				"with orphan purging by person rather than a DeleteOrphans sweep",
		},
		{
			Collection: "bunk_requests",
			NoGrain: "delete-only from this service -- the rows are created by the " +
				"Python processor; bunk_requests.go removes orphaned and zombie ones " +
				"by requester, not by a swept key",
		},
	}},

	{Service: "process_requests",
		WritesNothing: "POSTs to the FastAPI processing endpoint " +
			"(process_requests.go:164); every row it causes is written by the Python side"},

	// ---------------------------------------------------------------- Export

	{Service: "multi_workbook_export",
		WritesNothing: "writes Google Sheets, not PocketBase"},
}

// GrainForService returns the declaration for a registered sync service,
// following SameGrainAs to the declaration that actually carries the keys.
//
// Exported so a test that needs a service's write key reads it from here rather
// than repeating the literal (kindred#2643's five orphan-replay wirings are the
// first callers).
func GrainForService(service string) (ServiceGrain, bool) {
	d, ok := declaredGrain(service)
	if !ok {
		return ServiceGrain{}, false
	}
	if d.SameGrainAs == "" {
		return d, true
	}
	// One hop only, never a loop: grain_test.go pins that a SameGrainAs target
	// is a declaration carrying Writes of its own, so a chain cannot exist.
	base, ok := declaredGrain(d.SameGrainAs)
	if !ok || base.SameGrainAs != "" {
		return ServiceGrain{}, false
	}
	return ServiceGrain{Service: service, Writes: base.Writes}, true
}

// declaredGrain returns the literal table entry for a service, without
// following SameGrainAs.
func declaredGrain(service string) (ServiceGrain, bool) {
	for _, d := range serviceGrainDeclarations {
		if d.Service == service {
			return d, true
		}
	}
	return ServiceGrain{}, false
}
