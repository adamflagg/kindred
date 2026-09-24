"""Which PocketBase tables each Go sync job writes (kindred#2803).

One entry per job in `pocketbase/sync/orchestrator.go`'s `syncJobMeta` -- the
same ids the sync-status payload publishes and the frontend's
`SYNC_DISPLAY_NAMES` lists. `tests/unit/api/services/test_lodging_cache_warm.py`
parses that registry and fails if a job is missing here, so a new job has to
be classified before it ships; until then `sync_invalidates_lodging_cache`
treats an unknown job as a writer of everything.

Read off the Go code, job by job, at the write sites: the `ProcessSimpleRecord`
/ `ProcessCompositeRecord` / `DeleteOrphans*` calls on `BaseSyncService`, and
every `FindCollectionByNameOrId` that feeds an `App.Save` or `App.Delete`.
A collection a job only READS is not listed -- `bunk_assignments` reads
`persons` and `attendees` to resolve its rows, but writes only its own table.

The one writer that is not Go: `process_requests` hands the batch to the Python
processor, which marks `original_bunk_requests.processed`
(`bunking/sync/bunk_request_processor/integration/original_requests_loader.py`).

Table-level on purpose, never column-level. `normalize_geographic` writes only
the `normalized_*` columns of `persons`, which no weekend read uses, and it is
still a writer here: the rule "clear when a sync writes a table the cache
reads" has to survive the next column somebody adds to a read.
"""

from __future__ import annotations

from collections.abc import Iterable

from api.constants.collections import (
    ATTENDEE_STATUS_HISTORY,
    ATTENDEES,
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNK_PLANS,
    BUNK_REQUESTS,
    BUNKS,
    CAMP_SESSIONS,
    CUSTOM_FIELD_DEFS,
    ENROLLMENT_SNAPSHOTS,
    FAMILY_CAMP_ADULTS,
    FAMILY_CAMP_MEDICAL,
    FAMILY_CAMP_REGISTRATIONS,
    HOUSEHOLD_CUSTOM_VALUES,
    HOUSEHOLDS,
    LODGING_ASSIGNMENT_HISTORY,
    LODGING_ASSIGNMENTS,
    LODGING_ASSIGNMENTS_DRAFT,
    NORMALIZED_MAPPINGS,
    ORIGINAL_BUNK_REQUESTS,
    PERSON_CUSTOM_VALUES,
    PERSONS,
)

SYNC_JOB_WRITES: dict[str, frozenset[str]] = {
    # Global phase (weekly) -- cross-year definition tables.
    "person_tag_defs": frozenset({"person_tag_defs"}),
    "custom_field_defs": frozenset({CUSTOM_FIELD_DEFS}),
    "staff_lookups": frozenset({"staff_program_areas", "staff_org_categories", "staff_positions"}),
    "financial_lookups": frozenset({"financial_categories", "payment_methods"}),
    "divisions": frozenset({"divisions"}),
    # Source phase.
    "session_groups": frozenset({"session_groups"}),
    "sessions": frozenset({CAMP_SESSIONS}),
    "attendees": frozenset({ATTENDEES, ATTENDEE_STATUS_HISTORY}),
    # One CampMinder call populates both (persons.go writes `persons` and
    # `households`), and the job then back-fills `attendees.person` for rows
    # the attendees sync could not link yet (`updateAttendeeRelations`).
    "persons": frozenset({PERSONS, HOUSEHOLDS, ATTENDEES}),
    "bunks": frozenset({BUNKS}),
    "bunk_plans": frozenset({BUNK_PLANS}),
    # The HOURLY job (`0 * * * *`). Writes its own table and nothing else.
    "bunk_assignments": frozenset({BUNK_ASSIGNMENTS}),
    "staff": frozenset({"staff"}),
    "financial_transactions": frozenset({"financial_transactions"}),
    # Expensive phase -- custom values, and their bounded daily variants,
    # which write the same collections under a different registered name. All
    # four also append `lodging_value_history` (`logLodgingValueChange`, called
    # from person_custom_field_values.go and household_custom_field_values.go).
    "person_custom_values": frozenset({PERSON_CUSTOM_VALUES, "lodging_value_history"}),
    "household_custom_values": frozenset({HOUSEHOLD_CUSTOM_VALUES, "lodging_value_history"}),
    "person_custom_values_family_camp": frozenset({PERSON_CUSTOM_VALUES, "lodging_value_history"}),
    "household_custom_values_family_camp": frozenset({HOUSEHOLD_CUSTOM_VALUES, "lodging_value_history"}),
    # Transform phase.
    "family_camp_derived": frozenset({FAMILY_CAMP_ADULTS, FAMILY_CAMP_REGISTRATIONS, FAMILY_CAMP_MEDICAL}),
    "lodging_assignments": frozenset(
        {
            LODGING_ASSIGNMENTS,
            LODGING_ASSIGNMENT_HISTORY,
            "lodging_ingest_issues",
            "lodging_field_mappings",
        }
    ),
    "staff_skills": frozenset({"staff_skills"}),
    "financial_aid_applications": frozenset({"financial_aid_applications"}),
    "household_demographics": frozenset({"household_demographics"}),
    "camper_dietary": frozenset({"camper_dietary"}),
    "camper_transportation": frozenset({"camper_transportation"}),
    "quest_registrations": frozenset({"quest_registrations"}),
    "staff_applications": frozenset({"staff_applications"}),
    "staff_vehicle_info": frozenset({"staff_vehicle_info"}),
    "normalize_geographic": frozenset({NORMALIZED_MAPPINGS, PERSONS}),
    "enrollment_snapshots": frozenset({ENROLLMENT_SNAPSHOTS}),
    # Clears `bunk`/`bunk_plan` on summer drafts and `units` on lodging drafts;
    # never touches the live `lodging_assignments` rows.
    "stranded_assignment_cleanup": frozenset({BUNK_ASSIGNMENTS_DRAFT, LODGING_ASSIGNMENTS_DRAFT}),
    # Process phase.
    "reconcile_request_lifecycle": frozenset({ORIGINAL_BUNK_REQUESTS}),
    "bunk_requests": frozenset({ORIGINAL_BUNK_REQUESTS}),
    "process_requests": frozenset({ORIGINAL_BUNK_REQUESTS, BUNK_REQUESTS}),
    # Export phase -- Google Sheets, plus its own workbook bookkeeping.
    "multi_workbook_export": frozenset({"sheets_workbooks"}),
}


def sync_writes_any(sync_type: str | None, tables: Iterable[str]) -> bool:
    """Whether a completed `sync_type` writes any of `tables`.

    The one question every server cache asks of a finished sync: the lodging
    year cache with the tables its `@cached_by_year` reads declare, the social
    graph cache with `SocialGraphBuilder.READ_TABLES`.

    Fails safe. True when no sync is named (the endpoint's non-sync callers --
    the registration-config hook, the registration-dates panel -- clear
    everything, as they always did) and when the sync is not in
    `SYNC_JOB_WRITES` at all, since a job nobody has classified may write
    anything.
    """
    if sync_type is None:
        return True
    writes = SYNC_JOB_WRITES.get(sync_type)
    if writes is None:
        return True
    return not writes.isdisjoint(tables)
