"""build(year): read -> plan -> commit through sub-project 4a's helper (campership sub-project 5)."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal

import pytest

from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import (
    INTAKE_ACTOR,
    SHARE_SOURCE_INTAKE,
    ApplicationRecord,
    AttendeeRow,
    BillingLine,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from bunking.financial_aid.change_log import AidOperationPartiallyCommittedError
from bunking.financial_aid.rules.schema import AidRules
from bunking.pocketbase_batch import BatchRequestFailedError
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, intake_rules, seeded_store
from tests.unit.bunking.financial_aid.fixtures import with_lever, with_levers


@pytest.mark.asyncio
async def test_a_first_build_creates_one_application_per_family_and_one_request_per_answer() -> None:
    store = seeded_store()
    report = await FinancialAidIntakeService(store).build(YEAR)

    assert sorted(a.household_cm_id for a in store.applications.values()) == [1000001, 1000002]
    summer = store.request_for(person=1000011, program="summer")
    assert (summer.session_cm_id, summer.status, summer.ask) == (1000101, "active", 1500.0)
    family = store.request_for(household=1000001, program="family_camp")
    assert (family.person_cm_id, family.session_cm_id, family.headcount_non_infant, family.headcount_source) == (
        0,
        1000202,
        2 + 1,
        "billed",
    )
    # Waitlisted only: registration first (owner ruling 2026-09-27) sets no session until enrolled.
    taste = store.request_for(person=1000021, program="summer")
    assert (taste.session_cm_id, taste.session_resolution, taste.status) == (0, "unmatched", "unmatched_session")
    assert {"code": "unmatched_session", "detail": {"candidates": []}} in [dict(f) for f in taste.flags]
    assert (report.households, report.requests_created, report.rows_without_household, report.rows_without_request) == (
        2,
        3,
        1,
        1,
    )


@pytest.mark.asyncio
async def test_a_build_is_one_operation_and_every_write_is_logged_with_it() -> None:  # spec 14.4
    store = seeded_store()
    report = await FinancialAidIntakeService(store).build(YEAR)
    assert len(store.operations) == 1
    assert len(store.change_log) == len(store.writes) == 2 + 3 + 3  # applications, requests, default shares
    assert {row["operation_id"] for row in store.change_log} == {report.operation_id}
    assert {row["actor"] for row in store.change_log} == {"system:intake"}
    assert store.operations[0]["allow_chunking"] is True  # deliberate: see the task text


@pytest.mark.asyncio
async def test_a_second_build_on_unchanged_data_writes_nothing() -> None:
    store = seeded_store()
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    writes, rows = len(store.writes), len(store.change_log)
    report = await service.build(YEAR)
    assert (len(store.writes), len(store.change_log), len(store.operations)) == (writes, rows, 1)
    assert (
        report.applications_created,
        report.applications_updated,
        report.requests_created,
        report.requests_updated,
        report.operation_id,
    ) == (0, 0, 0, 0, "")


@pytest.mark.asyncio
async def test_staff_work_survives_a_rebuild_after_the_family_edits_its_answer() -> None:  # Review Focus 5
    store = seeded_store()
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    old = store.request_for(person=1000011, program="summer")
    store.requests[old.id] = replace(old, session_resolution="staff")
    correction = CorrectionRecord(
        "cor000000000001",
        YEAR,
        old.application_id,
        old.id,
        "ask",
        "1200.00",
        "1500.00",
        "Family confirmed a lower ask.",
        "registrar@example.com",
        "2027-01-05 10:00:00Z",
    )
    store.corrections.append(correction)
    store.fa_rows[0] = fa_row(1000011, 1000001, summer="Session 2a", summer_ask=1500.0, total_gross_income=85000.0)
    store.attendees.append(AttendeeRow(1000011, 1000001, 1000102, 2))

    await service.build(YEAR)

    assert store.requests[old.id].status == "withdrawn"
    assert store.requests[old.id].session_resolution == "staff"
    assert store.corrections == [correction]
    new = store.request_for(person=1000011, program="summer", status="active")
    assert new.session_cm_id == 1000102
    (withdrawn,) = [row for row in store.change_log if row["entity_id"] == old.id and row["action"] == "status"]
    assert (withdrawn["entity"], withdrawn["year"], withdrawn["actor"], withdrawn["reason"]) == (
        "aid_requests",
        YEAR,
        "system:intake",
        "intake rebuild",
    )
    assert (withdrawn["before"], withdrawn["after"]) == ({"status": "active"}, {"status": "withdrawn"})


@pytest.mark.asyncio
async def test_concurrent_builds_for_one_season_run_one_at_a_time() -> None:
    store = seeded_store()
    service = FinancialAidIntakeService(store)
    await asyncio.gather(service.build(YEAR), service.build(YEAR))
    assert len(store.applications) == 2
    assert len(store.requests) == 3
    assert len(store.payer_shares) == 3


@pytest.mark.asyncio
async def test_every_new_request_gets_one_default_payer_share_and_it_is_logged() -> None:
    store = seeded_store()
    report = await FinancialAidIntakeService(store).build(YEAR)
    by_request = {s.request_id: s for s in store.payer_shares.values()}
    assert set(by_request) == set(store.requests)
    assert report.payer_shares_created == 3
    summer = store.request_for(person=1000011, program="summer")
    share = by_request[summer.id]
    assert (share.household_cm_id, share.share_pct, share.source) == (1000001, Decimal(100), "intake_default")
    (logged,) = [row for row in store.change_log if row["entity_id"] == f"{summer.id}:1000001"]
    assert (logged["entity"], logged["action"], logged["actor"], logged["before"], logged["reason"]) == (
        "aid_payer_shares",
        "create",
        "system:intake",
        None,
        "intake default: one share of 100% for the application's household",
    )
    assert logged["after"] == {
        "year": YEAR,
        "request": summer.id,
        "household_cm_id": 1000001,
        "share_pct": 100,
        "source": "intake_default",
        "actor": "system:intake",
        "note": "",
    }
    await FinancialAidIntakeService(store).build(YEAR)
    assert len(store.payer_shares) == 3  # a rebuild adds none


@pytest.mark.asyncio
async def test_a_request_and_its_default_share_commit_together_or_not_at_all() -> None:
    store = seeded_store()
    store.fail_on = ("aid_payer_shares", "POST")  # PocketBase refuses the share: the whole batch rolls back
    with pytest.raises(BatchRequestFailedError):
        await FinancialAidIntakeService(store).build(YEAR)
    assert (store.applications, store.requests, store.payer_shares, store.change_log) == ({}, {}, {}, [])
    store.fail_on = None
    await FinancialAidIntakeService(store).build(YEAR)
    assert len(store.requests) == len(store.payer_shares) == 3


@pytest.mark.asyncio
async def test_a_build_too_big_for_one_batch_is_chunked_under_one_operation() -> None:
    store = seeded_store()
    store.max_batch_requests = 4  # two writes and their two log rows per batch (the server allows 2000)
    report = await FinancialAidIntakeService(store).build(YEAR)
    assert store.results[-1].batches == 4  # eight writes, two per batch
    assert {row["operation_id"] for row in store.change_log} == {report.operation_id}
    assert (len(store.applications), len(store.requests), len(store.payer_shares)) == (2, 3, 3)


@pytest.mark.asyncio
async def test_a_chunked_build_that_fails_part_way_is_finished_by_the_next_run() -> None:
    store = seeded_store()
    store.max_batch_requests = 4
    store.fail_on = ("aid_payer_shares", "POST")  # chunks 1-2 (applications, two requests) commit; chunk 3 fails
    with pytest.raises(AidOperationPartiallyCommittedError):
        await FinancialAidIntakeService(store).build(YEAR)
    assert (len(store.applications), len(store.requests), len(store.payer_shares)) == (2, 2, 0)
    store.fail_on = None
    await FinancialAidIntakeService(store).build(YEAR)
    assert (len(store.requests), len(store.payer_shares)) == (3, 3)
    assert {s.request_id for s in store.payer_shares.values()} == set(store.requests)


@pytest.mark.asyncio
async def test_every_read_is_scoped_to_the_build_year() -> None:
    store = seeded_store()
    await FinancialAidIntakeService(store).build(YEAR + 1)
    assert store.years_read == {YEAR + 1}  # a season N+1 build never reads season N (#2844)


@pytest.mark.asyncio
async def test_before_the_rules_are_approved_every_request_is_still_recorded_and_waits_visibly() -> None:
    store = seeded_store()
    store.rules = None  # mid-November: finance has not approved the programs and cost sections yet
    report = await FinancialAidIntakeService(store).build(YEAR)
    assert sorted(a.household_cm_id for a in store.applications.values()) == [1000001, 1000002]
    assert (report.requests_created, report.payer_shares_created, report.awaiting_approved_rules) == (3, 3, 2)
    waiting = {"code": "awaiting_approved_rules", "detail": {"sections": ["programs", "cost"]}}
    resolved = [r for r in store.requests.values() if r.session_cm_id]
    assert len(resolved) == 2  # the third, a waitlisted camper's, is unmatched until they enroll
    assert all(waiting in [dict(f) for f in r.flags] for r in resolved)
    assert all(r.status == "active" for r in resolved)  # recorded, holding its slot


@pytest.mark.asyncio
async def test_the_first_run_after_approval_resolves_waiting_requests_in_place() -> None:
    store = seeded_store()
    store.rules = None
    store.billing.append(
        BillingLine(1000001, 1000014, 0, 17006, "Family Camp 6", "Family Camp 6 - Infant", 1, 300.0, False)
    )
    store.birthdates = {1000014: "2025-06-01"}  # 26 months old on Family Camp 6's first day
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    first_ids = set(store.requests)
    family = store.request_for(household=1000001, program="family_camp")
    # Under 2 on the first day is a fixed fact (owner 2026-10-08), not a rules setting: it holds before approval too.
    assert (family.headcount_non_infant, family.headcount_infant) == (4, 0)
    store.rules = intake_rules()  # finance approves
    report = await service.build(YEAR)
    assert set(store.requests) == first_ids  # the same requests: created dates untouched
    assert (report.requests_created, report.awaiting_approved_rules) == (0, 0)
    assert all(f.get("code") != "awaiting_approved_rules" for r in store.requests.values() for f in r.flags)
    family = store.request_for(household=1000001, program="family_camp")
    assert (family.headcount_non_infant, family.headcount_infant) == (4, 0)  # unchanged by the approval


@pytest.mark.asyncio
async def test_a_session_the_approved_programs_do_not_claim_is_flagged() -> None:
    store = seeded_store()
    store.fa_rows.append(fa_row(1000032, 1000003, interest=True, registration_ask=300.0))
    store.attendees.append(AttendeeRow(1000032, 1000003, 1000402, 2))  # Adult Weekend B: no program claims it
    await FinancialAidIntakeService(store).build(YEAR)
    adult = store.request_for(person=1000032, program="adult_weekend")
    assert {"code": "no_program_for_session", "detail": {"session_cm_id": 1000402}} in [dict(f) for f in adult.flags]


@pytest.mark.asyncio
async def test_an_ag_session_no_program_claims_is_not_flagged_when_its_parent_is_claimed() -> None:
    """Review M7: intake's no-program flag follows the same parent rule as pricing."""
    store = seeded_store()
    store.rules = with_lever(intake_rules(), "programs.summer.session_types", ["main", "embedded"])
    store.sessions.append(SessionRow(1000199, "AG Session 2", "ag", "2027-06-20", parent_cm_id=1000101))
    store.fa_rows.append(fa_row(1000033, 1000003, summer="AG Session 2", summer_ask=300.0))
    store.attendees.append(AttendeeRow(1000033, 1000003, 1000199, 2))
    await FinancialAidIntakeService(store).build(YEAR)
    request = next(r for r in store.requests.values() if r.person_cm_id == 1000033)
    assert all(f.get("code") != "no_program_for_session" for f in request.flags)


@pytest.mark.asyncio
async def test_an_unclaimed_ag_session_follows_a_parent_the_programs_claim_by_type() -> None:
    """Regression guard. The parent's own type (not just its id) reaches the program lookup."""
    store = seeded_store()
    store.rules = with_lever(intake_rules(), "programs.summer.session_types", ["main", "embedded"])
    store.sessions.append(SessionRow(1000998, "Session 9", "main", "2027-06-20"))  # claimed by type, not by id
    store.sessions.append(SessionRow(1000199, "AG Session 2", "ag", "2027-06-20", parent_cm_id=1000998))
    store.fa_rows.append(fa_row(1000033, 1000003, summer="AG Session 2", summer_ask=300.0))
    store.attendees.append(AttendeeRow(1000033, 1000003, 1000199, 2))
    await FinancialAidIntakeService(store).build(YEAR)
    request = next(r for r in store.requests.values() if r.person_cm_id == 1000033)
    assert all(f.get("code") != "no_program_for_session" for f in request.flags)


@pytest.mark.asyncio
async def test_a_billed_infant_two_or_older_on_the_first_day_counts_as_non_infant_and_is_flagged() -> None:
    store = seeded_store()  # intake_rules(): infant cutoff 24 months
    store.billing.append(
        BillingLine(1000001, 1000014, 0, 17006, "Family Camp 6", "Family Camp 6 - Infant", 1, 300.0, False)
    )
    store.birthdates = {1000014: "2025-06-01"}  # 26 months old on Family Camp 6's first day, 2027-08-20
    await FinancialAidIntakeService(store).build(YEAR)
    family = store.request_for(household=1000001, program="family_camp")
    assert (family.headcount_non_infant, family.headcount_infant, family.headcount_source) == (4, 0, "billed")
    assert {"code": "infant_age_reclassified", "detail": {"count": 1}} in [dict(f) for f in family.flags]


@pytest.mark.asyncio
async def test_a_new_request_colliding_with_another_new_one_gets_the_real_holder_id() -> None:
    store = seeded_store()
    # A second option text: registration puts it on the same weekend the household is enrolled in.
    store.fa_rows.append(fa_row(1000013, 1000001, fc="FC Six", fc_ask=900.0))
    report = await FinancialAidIntakeService(store).build(YEAR)
    holder = store.request_for(household=1000001, program="family_camp", status="active")
    pending = store.request_for(household=1000001, program="family_camp", status="duplicate_pending")
    assert pending.duplicate_of == holder.id
    assert report.duplicates_pending == 1


@pytest.mark.asyncio
async def test_a_family_correcting_its_answer_to_the_session_staff_resolved_rebuilds_cleanly() -> None:
    # The old request still holds the household x session slot when the corrected answer
    # claims it. PocketBase's partial unique index refuses a second ACTIVE row for the
    # slot, so the withdrawal must land before the create, or the whole season stops.
    store = seeded_store()
    store.fa_rows[1] = fa_row(1000012, 1000001, fc="FC6 weekend", fc_ask=900.0, total_gross_income=85000.0)
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    old = store.request_for(household=1000001, program="family_camp")
    assert (old.status, old.session_cm_id) == ("active", 1000202)  # registration decides, whatever the wording
    casework = FinancialAidCaseworkService(store)
    await casework.resolve_session(old.id, 1000202, "The family means Family Camp 6.", "registrar@example.com")
    assert (store.requests[old.id].status, store.requests[old.id].session_resolution) == ("active", "staff")
    store.fa_rows[1] = fa_row(1000012, 1000001, fc="Family Camp 6", fc_ask=900.0, total_gross_income=85000.0)

    await service.build(YEAR)

    assert (store.requests[old.id].status, store.requests[old.id].session_resolution) == ("withdrawn", "staff")
    new = store.request_for(household=1000001, program="family_camp", status="active")
    assert (new.session_cm_id, new.session_resolution) == (1000202, "enrollment")


@pytest.mark.asyncio
async def test_a_pending_duplicate_takes_the_slot_when_its_holder_is_withdrawn() -> None:  # Review Focus 7
    store = seeded_store()
    # A second household files for the same camper and session: it waits behind the first.
    store.fa_rows.append(fa_row(1000011, 1000002, summer="Session 2", summer_ask=1500.0, total_gross_income=60000.0))
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    holder = store.request_for(person=1000011, household=1000001, program="summer")
    claimant = store.request_for(person=1000011, household=1000002, program="summer")
    assert (claimant.status, claimant.duplicate_of) == ("duplicate_pending", holder.id)
    # The first household drops its summer answer: its request is withdrawn in the same run
    # that promotes the claimant, and the withdrawal has to reach PocketBase first.
    store.fa_rows[0] = fa_row(1000011, 1000001, total_gross_income=85000.0)

    report = await service.build(YEAR)

    assert store.requests[holder.id].status == "withdrawn"
    assert (store.requests[claimant.id].status, store.requests[claimant.id].duplicate_of) == ("active", "")
    assert report.duplicates_pending == 0
    assert [s.household_cm_id for s in store.payer_shares.values() if s.request_id == claimant.id] == [1000002]


@pytest.mark.asyncio
async def test_a_request_moving_onto_a_withdrawn_requests_session_commits_whichever_id_sorts_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Record ids are random; hand them out in DESCENDING order so the mover sorts before the
    # request it replaces: PocketBase checks the one-active-request index on every statement,
    # so the withdrawal must reach it first regardless of id order.
    ids = (f"r{n:014d}" for n in range(999, 0, -1))
    monkeypatch.setattr("api.services.financial_aid_intake_service.new_record_id", lambda: next(ids))
    store = seeded_store()
    # Two households file for one camper; the camper is enrolled in two sessions and each
    # household's option text picks one.
    store.fa_rows.append(fa_row(1000011, 1000002, summer="Taste of Camp", summer_ask=900.0, total_gross_income=60000.0))
    store.attendees.append(AttendeeRow(1000011, 1000001, 1000104, 2))
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    first = store.request_for(person=1000011, household=1000001, program="summer")
    second = store.request_for(person=1000011, household=1000002, program="summer")
    assert (first.session_cm_id, first.status, second.session_cm_id, second.status) == (
        1000101,
        "active",
        1000104,
        "active",
    )
    assert second.id < first.id
    # The first household drops its answer and the camper cancels Taste of Camp 1: the second
    # request re-resolves onto Session 2 in the same run that withdraws the first.
    store.fa_rows[0] = fa_row(1000011, 1000001, total_gross_income=85000.0)
    store.attendees[-1] = AttendeeRow(1000011, 1000001, 1000104, 32)

    await service.build(YEAR)

    assert store.requests[first.id].status == "withdrawn"
    assert (store.requests[second.id].session_cm_id, store.requests[second.id].status) == (1000101, "active")


@pytest.mark.asyncio
async def test_two_active_requests_swap_sessions_through_a_real_commit() -> None:
    # Each household's own answer text is permanently tied to the session it names -- household
    # 1000001's "Session 2" always means 1000101, household 1000002's "Session 2a" always means
    # 1000102, for as long as the camper stays enrolled in both -- so a same-identity swap
    # between them can't come from a family editing an answer or from registration alone (that
    # is exactly why the withdrawal test above changes ids instead). What DOES put two rows out
    # of step with today's registration is a stale starting state, e.g. the two sessions traded
    # CampMinder ids after these requests were written. The stored rows below hold each other's
    # target session on purpose, to prove the correction still commits through PocketBase's real
    # per-statement index checks.
    store = FakeAidStore()
    store.rules = intake_rules()
    store.attendees = [AttendeeRow(1000011, 1000001, 1000101, 2), AttendeeRow(1000011, 1000001, 1000102, 2)]
    store.fa_rows = [
        fa_row(1000011, 1000001, summer="Session 2", summer_ask=1500.0, total_gross_income=85000.0),
        fa_row(1000011, 1000002, summer="Session 2a", summer_ask=900.0, total_gross_income=60000.0),
    ]
    store.applications["app000000000001"] = ApplicationRecord(
        "app000000000001", YEAR, 1000001, "active", {"total_gross_income": 85000.0}, (1000011,), ()
    )
    store.applications["app000000000002"] = ApplicationRecord(
        "app000000000002", YEAR, 1000002, "active", {"total_gross_income": 60000.0}, (1000011,), ()
    )
    store.requests["req000000000001"] = RequestRecord(
        id="req000000000001",
        year=YEAR,
        application_id="app000000000001",
        household_cm_id=1000001,
        person_cm_id=1000011,
        session_cm_id=1000102,  # holds household 1000002's target session
        program_key="summer",
        program_option_text="Session 2",
        program_option_key="session 2",
        session_resolution="enrollment_text",
        ask=1500.0,
        headcount_non_infant=0,
        headcount_infant=0,
        headcount_source="",
        status="active",
        duplicate_of="",
        flags=(),
    )
    store.requests["req000000000002"] = RequestRecord(
        id="req000000000002",
        year=YEAR,
        application_id="app000000000002",
        household_cm_id=1000002,
        person_cm_id=1000011,
        session_cm_id=1000101,  # holds household 1000001's target session
        program_key="summer",
        program_option_text="Session 2a",
        program_option_key="session 2a",
        session_resolution="enrollment_text",
        ask=900.0,
        headcount_non_infant=0,
        headcount_infant=0,
        headcount_source="",
        status="active",
        duplicate_of="",
        flags=(),
    )
    store.payer_shares["share00000001"] = PayerShareRecord(
        "share00000001", YEAR, "req000000000001", 1000001, Decimal(100), SHARE_SOURCE_INTAKE, INTAKE_ACTOR, ""
    )
    store.payer_shares["share00000002"] = PayerShareRecord(
        "share00000002", YEAR, "req000000000002", 1000002, Decimal(100), SHARE_SOURCE_INTAKE, INTAKE_ACTOR, ""
    )

    report = await FinancialAidIntakeService(store).build(YEAR)

    assert (store.requests["req000000000001"].session_cm_id, store.requests["req000000000001"].status) == (
        1000101,
        "active",
    )
    assert (store.requests["req000000000002"].session_cm_id, store.requests["req000000000002"].status) == (
        1000102,
        "active",
    )
    assert report.operation_id != ""

    second = await FinancialAidIntakeService(store).build(YEAR)  # a re-run on the swapped state is a no-op
    assert second.operation_id == ""


# PocketBase refuses a value outside a field's limits (pocketbase/pb_migrations/1500000201),
# and one refused value would roll back the whole season's batch. Intake keeps every value
# it writes inside them, and shows the family's figure as the data-quality state it is.


@pytest.mark.asyncio
async def test_a_negative_ask_is_recorded_as_a_missing_ask() -> None:
    store = seeded_store()
    store.fa_rows[0] = fa_row(1000011, 1000001, summer="Session 2", summer_ask=-500.0, total_gross_income=85000.0)
    store.fa_rows[4] = fa_row(1000041, 1000004, interest=True, registration_ask=-500.0)
    store.attendees.append(AttendeeRow(1000041, 1000004, 1000401, 2))

    await FinancialAidIntakeService(store).build(YEAR)

    for request in (
        store.request_for(person=1000011, program="summer"),
        store.request_for(person=1000041, program="adult_weekend"),
    ):
        assert request.ask == 0.0
        assert {"code": "ask_missing", "detail": {}} in [dict(f) for f in request.flags]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "line",
    [
        BillingLine(1000001, 0, 0, 17006, "Family Camp 6", "Family Camp 6 - Adult", 60, 600.0, False),
        BillingLine(1000001, 1000013, 0, 17006, "Family Camp 6", "Family Camp 6 - Infant", 21, 0.0, False),
    ],
    ids=["non_infant_over_50", "infant_over_20"],
)
async def test_a_billed_headcount_beyond_the_field_limit_is_left_missing(line: BillingLine) -> None:
    store = seeded_store()
    store.billing.append(line)

    await FinancialAidIntakeService(store).build(YEAR)

    family = store.request_for(household=1000001, program="family_camp")
    assert (family.headcount_non_infant, family.headcount_infant, family.headcount_source) == (0, 0, "")
    assert "family_camp_headcount_missing" in [f["code"] for f in family.flags]


@pytest.mark.asyncio
async def test_option_text_longer_than_the_field_is_clipped_to_it() -> None:
    store = seeded_store()
    long_text = "Session 2 " + "and a very long note " * 40
    store.fa_rows[0] = fa_row(1000011, 1000001, summer=long_text, summer_ask=1500.0, total_gross_income=85000.0)

    await FinancialAidIntakeService(store).build(YEAR)

    request = store.request_for(person=1000011, program="summer")
    assert request.program_option_text == long_text.strip()[:500]
    assert len(request.program_option_key) <= 500


# --- a yes/no answer no applicant ever gave (spec 18 U-C7: warn when no one answered) ----


def _equity_rules(weights: dict[str, str], **criterion_changes: object) -> AidRules:
    """intake_rules() with the household yes/no criteria weighted as given (camp class)."""
    rules = intake_rules()
    criteria = [c.model_dump(mode="json") for c in rules.equity.criteria]
    for c in criteria:
        if c["key"] in criterion_changes:
            c.update(criterion_changes[c["key"]])  # type: ignore[call-overload]
    return with_levers(rules, {"equity.criteria": criteria, "equity.weights.camp": {"bipoc": "0.5", **weights}})


@pytest.mark.asyncio
async def test_a_weighted_yes_no_answer_no_applicant_gave_is_a_season_warning() -> None:
    store = seeded_store()  # five applicant rows, none answering gov_subsidies or unemployment
    store.equity_rules = _equity_rules({"gov_subsidies": "1"})
    report = await FinancialAidIntakeService(store).build(YEAR)
    assert report.warnings == ("equity_field_never_true: gov_subsidies (0 of 5 applicants)",)


@pytest.mark.asyncio
async def test_the_season_warning_holds_nothing() -> None:
    control = seeded_store()
    await FinancialAidIntakeService(control).build(YEAR)
    store = seeded_store()
    store.equity_rules = _equity_rules({"gov_subsidies": "1"})
    await FinancialAidIntakeService(store).build(YEAR)
    shape = sorted(
        (r.person_cm_id, r.status, tuple(tuple(sorted(f.items())) for f in r.flags)) for r in store.requests.values()
    )
    expected = sorted(
        (r.person_cm_id, r.status, tuple(tuple(sorted(f.items())) for f in r.flags)) for r in control.requests.values()
    )
    assert shape == expected
    assert [a.flags for a in store.applications.values()] == [a.flags for a in control.applications.values()]


@pytest.mark.asyncio
async def test_one_applicant_answering_yes_clears_the_warning() -> None:
    store = seeded_store()
    store.fa_rows[2] = replace(store.fa_rows[2], answers={**store.fa_rows[2].answers, "gov_subsidies": True})
    store.equity_rules = _equity_rules({"gov_subsidies": "1"})
    assert (await FinancialAidIntakeService(store).build(YEAR)).warnings == ()


@pytest.mark.asyncio
async def test_an_also_field_no_applicant_gave_is_warned_on_its_own() -> None:
    store = seeded_store()
    store.fa_rows[0] = replace(store.fa_rows[0], answers={**store.fa_rows[0].answers, "unemployment": True})
    store.equity_rules = _equity_rules({"unemployment": "0.5"}, unemployment={"also_fields": ["gov_subsidies"]})
    report = await FinancialAidIntakeService(store).build(YEAR)
    assert report.warnings == ("equity_field_never_true: gov_subsidies (0 of 5 applicants)",)


@pytest.mark.parametrize(
    "case",
    ["unweighted", "zero_weight", "no_equity_approved", "no_applicants"],
)
@pytest.mark.asyncio
async def test_no_season_warning_without_a_weight_approved_rules_or_applicants(case: str) -> None:
    store = seeded_store()
    store.equity_rules = {
        "unweighted": _equity_rules({}),
        "zero_weight": _equity_rules({"gov_subsidies": "0"}),
        "no_equity_approved": None,
        "no_applicants": _equity_rules({"gov_subsidies": "1"}),
    }[case]
    if case == "no_applicants":
        store.fa_rows = []
    assert (await FinancialAidIntakeService(store).build(YEAR)).warnings == ()


@pytest.mark.asyncio
async def test_a_build_records_each_campers_equity_answers_on_their_request_and_a_rebuild_writes_nothing() -> None:
    """3c-2: the copy a past date prices from, logged like every intake field."""
    store = seeded_store()
    store.equity[1000011] = EquityAnswers(bipoc=True, gender_identity="", pronouns="she/her")
    service = FinancialAidIntakeService(store)
    await service.build(YEAR)
    by_person = {r.person_cm_id: r for r in store.requests.values()}
    assert by_person[1000011].equity == EquityAnswers(bipoc=True, gender_identity="", pronouns="she/her")
    assert by_person[1000021].equity == EquityAnswers(bipoc=None, gender_identity="", pronouns="")  # answered nothing
    assert by_person[0].equity is None  # the Family Camp request is the household's
    writes = len(store.writes)
    await service.build(YEAR)
    assert len(store.writes) == writes
