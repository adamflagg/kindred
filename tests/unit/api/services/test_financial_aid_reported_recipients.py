"""Loading a past season's Campership sheet as "as reported" recipients (owner ruling 2026-10-16, CS-AGES25), the way
finance's typed history loads: all or nothing, by natural key, every write with its aid_change_log row (4a), a dry
run that writes nothing. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

from api.constants.collections import AID_REPORTED_RECIPIENTS
from api.services.financial_aid_reported_recipients_service import (
    ReportedRecipientNotFoundError,
    ReportedRecipientsService,
)
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.financial_aid.reports.recipients import ReportedRecipient
from tests.unit.api.services.development_fakes import FakeDevelopmentStore, went

pytestmark = pytest.mark.asyncio

EMMA, LIAM, OLIVIA, STRANGER = 1000011, 1000021, 1000012, 1000099
ACTOR = "finance@example.com"


def _recipient(person: int = EMMA, household: int = 1000001, **change: object) -> ReportedRecipient:
    found = ReportedRecipient(
        year=2025,
        person_cm_id=person,
        household_cm_id=household,
        program="summer",
        source="camp",
        funder="",
        amount=Decimal("1500.00"),
        sheet_tab="Aid calculator",
        sheet_row=12,
        match="personal_id",
    )
    return replace(found, **change)  # type: ignore[arg-type]


def _grant(person: int = LIAM, household: int = 1000002) -> ReportedRecipient:
    return _recipient(person, household, source="outside", funder="Regional Camp Fund", sheet_tab="Grants")


def _store() -> FakeDevelopmentStore:
    """2025: Emma and Liam enrolled, Olivia cancelled (still a registrant that season); nobody else."""
    return FakeDevelopmentStore(
        registrations=[
            went(EMMA, 1000001, year=2025, start=date(2025, 6, 20)),
            went(LIAM, 1000002, year=2025, start=date(2025, 6, 20)),
            went(OLIVIA, 1000001, year=2025, start=date(2025, 6, 20), status=32),
        ]
    )


async def test_a_first_load_creates_every_recipient_in_one_logged_operation() -> None:
    store = _store()
    out = await ReportedRecipientsService(store).load([_recipient(), _grant()], actor=ACTOR)
    assert (out.created, out.updated, out.unchanged, out.dry_run) == (2, 0, 0, False)
    assert len(store.operations) == 1
    assert {row["entity"] for row in store.log} == {AID_REPORTED_RECIPIENTS}
    assert len(store.log) == 2
    listed = await ReportedRecipientsService(store).listed(2025)
    assert sorted(r.person_cm_id for r in listed.recipients) == [EMMA, LIAM]
    assert {r.source for r in listed.recipients} == {"camp", "outside"}


async def test_a_second_load_corrects_by_natural_key_and_skips_the_unchanged() -> None:
    store = _store()
    service = ReportedRecipientsService(store)
    await service.load([_recipient(), _grant()], actor=ACTOR)
    out = await service.load([_recipient(amount=Decimal(900), sheet_row=40), _grant()], actor=ACTOR)
    assert (out.created, out.updated, out.unchanged) == (0, 1, 1)
    [emma] = [r for r in store.recipient_rows if r.recipient.person_cm_id == EMMA]
    assert (emma.recipient.amount, emma.recipient.sheet_row) == (Decimal("900.00"), 40)
    assert len(store.recipient_rows) == 2


async def test_a_load_with_nothing_to_write_writes_nothing() -> None:
    store = _store()
    service = ReportedRecipientsService(store)
    await service.load([_recipient()], actor=ACTOR)
    out = await service.load([_recipient()], actor=ACTOR)
    assert (out.created, out.updated, out.unchanged) == (0, 0, 1)
    assert len(store.operations) == 1


async def test_a_dry_run_counts_what_it_would_write_and_writes_nothing() -> None:
    store = _store()
    out = await ReportedRecipientsService(store).load([_recipient(), _grant()], actor=ACTOR, dry_run=True)
    assert (out.created, out.updated, out.unchanged, out.dry_run) == (2, 0, 0, True)
    assert store.operations == []
    assert store.recipient_rows == []


async def test_a_cancelled_registrant_is_accepted_and_simply_not_counted_later() -> None:
    """Olivia's 2025 registration was cancelled: she was a camper that season, so the sheet's row loads."""
    store = _store()
    out = await ReportedRecipientsService(store).load([_recipient(OLIVIA)], actor=ACTOR)
    assert out.created == 1


async def test_a_registrant_who_left_early_or_was_waitlisted_is_accepted() -> None:
    """Any status counts as a registration that season (CampMinder 16 = left early, 8 = waitlisted): a camper who
    left early had the aid, so the sheet's row loads rather than refusing the whole sheet."""
    store = _store()
    store.registrations += [
        went(1000031, 1000003, year=2025, start=date(2025, 6, 20), status=16),
        went(1000041, 1000004, year=2025, start=date(2025, 6, 20), status=8),
    ]
    out = await ReportedRecipientsService(store).load(
        [_recipient(1000031, 1000003), _recipient(1000041, 1000004)], actor=ACTOR
    )
    assert out.created == 2


async def test_a_person_who_was_not_a_camper_that_season_refuses_the_whole_load_and_is_named() -> None:
    """All or nothing: the stranger (no 2025 registration at all) and Liam (registered 2025, listed as 2024) are
    both named, and Emma's good row is not written either."""
    store = _store()
    with pytest.raises(ReportsRefusedError) as refused:
        await ReportedRecipientsService(store).load(
            [_recipient(), _recipient(STRANGER, 1000009), replace(_grant(), year=2024)],
            actor=ACTOR,
        )
    words = str(refused.value)
    assert f"recipient 2: {STRANGER} has no registration in 2025" in words
    assert f"recipient 3: {LIAM} has no registration in 2024" in words
    assert store.operations == []


@pytest.mark.parametrize(
    "bad",
    [
        _recipient(year=2021),
        _recipient(source="outside", funder=""),
        _recipient(amount=Decimal(0)),
    ],
)
async def test_one_malformed_recipient_refuses_the_load(bad: ReportedRecipient) -> None:
    store = _store()
    with pytest.raises(ReportsRefusedError, match="recipient 2"):
        await ReportedRecipientsService(store).load([_grant(), bad], actor=ACTOR)
    assert store.operations == []


async def test_the_same_recipient_twice_in_one_load_is_refused() -> None:
    store = _store()
    with pytest.raises(ReportsRefusedError, match="the same recipient twice"):
        await ReportedRecipientsService(store).load([_recipient(), _recipient(amount=Decimal(5))], actor=ACTOR)
    assert store.operations == []


async def test_a_delete_removes_one_recipient_with_its_reason_logged() -> None:
    store = _store()
    service = ReportedRecipientsService(store)
    await service.load([_recipient(), _grant()], actor=ACTOR)
    [emma] = [r for r in store.recipient_rows if r.recipient.person_cm_id == EMMA]
    await service.delete(emma.id, reason="matched the wrong camper", actor=ACTOR)
    assert [r.recipient.person_cm_id for r in store.recipient_rows] == [LIAM]
    assert store.operations[-1][0].action == "delete"
    assert store.log[-1]["reason"] == "matched the wrong camper"
    with pytest.raises(ReportedRecipientNotFoundError):
        await service.delete(emma.id, reason="again", actor=ACTOR)


async def test_the_list_is_one_seasons() -> None:
    store = _store()
    store.registrations.append(went(EMMA, 1000001, year=2024, start=date(2024, 6, 20)))
    service = ReportedRecipientsService(store)
    await service.load([_recipient(), _recipient(year=2024)], actor=ACTOR)
    listed = await service.listed(2024)
    assert listed.year == 2024
    assert [(r.year, r.person_cm_id) for r in listed.recipients] == [(2024, EMMA)]
    assert listed.recipients[0].id
