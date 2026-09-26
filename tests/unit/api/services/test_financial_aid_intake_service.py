"""build(year): read -> plan -> commit through sub-project 4a's helper (campership sub-project 5)."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal

import pytest

from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AliasRow, AttendeeRow, BillingLine, CorrectionRecord
from bunking.financial_aid.change_log import AidOperationPartiallyCommittedError
from bunking.pocketbase_batch import BatchRequestFailedError
from tests.unit.api.services.financial_aid_fakes import YEAR, fa_row, intake_rules, seeded_store


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
    taste = store.request_for(person=1000021, program="summer")
    assert (taste.session_cm_id, taste.session_resolution) == (1000105, "enrollment")
    assert {"code": "not_enrolled", "detail": {"session_cm_id": 1000105}} in [dict(f) for f in taste.flags]
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
    assert (report.requests_created, report.payer_shares_created, report.awaiting_approved_rules) == (3, 3, 3)
    waiting = {"code": "awaiting_approved_rules", "detail": {"sections": ["programs", "cost"]}}
    assert all(waiting in [dict(f) for f in r.flags] for r in store.requests.values())
    assert all(r.status == "active" for r in store.requests.values())  # recorded, holding its slot


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
    assert (family.headcount_non_infant, family.headcount_infant) == (3, 1)  # billing's labels, for now
    store.rules = intake_rules()  # finance approves
    report = await service.build(YEAR)
    assert set(store.requests) == first_ids  # the same requests: created dates untouched
    assert (report.requests_created, report.awaiting_approved_rules) == (0, 0)
    assert all(f.get("code") != "awaiting_approved_rules" for r in store.requests.values() for f in r.flags)
    family = store.request_for(household=1000001, program="family_camp")
    assert (family.headcount_non_infant, family.headcount_infant) == (4, 0)  # the infant rule, now approved


@pytest.mark.asyncio
async def test_a_session_the_approved_programs_do_not_claim_is_flagged() -> None:
    store = seeded_store()
    store.fa_rows.append(fa_row(1000032, 1000003, interest=True, registration_ask=300.0))
    store.attendees.append(AttendeeRow(1000032, 1000003, 1000402, 2))  # Adult Weekend B: no program claims it
    await FinancialAidIntakeService(store).build(YEAR)
    adult = store.request_for(person=1000032, program="adult_weekend")
    assert {"code": "no_program_for_session", "detail": {"session_cm_id": 1000402}} in [dict(f) for f in adult.flags]


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
    # A second option text that staff had already aliased to the same weekend.
    store.aliases.append(AliasRow("family_camp", "fc six", 1000202))
    store.fa_rows.append(fa_row(1000013, 1000001, fc="FC Six", fc_ask=900.0))
    report = await FinancialAidIntakeService(store).build(YEAR)
    holder = store.request_for(household=1000001, program="family_camp", status="active")
    pending = store.request_for(household=1000001, program="family_camp", status="duplicate_pending")
    assert pending.duplicate_of == holder.id
    assert report.duplicates_pending == 1
