"""A line a person split across requests (campership SP11-rest; clean spec §8.1; D12, D81), and the
placement's own tick never waiting for tonight's sync. Fictional throughout: households 10000xx, people
10000xx1, sessions 10001xx (summer) and 1000201 (a Family Camp weekend)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

from api.services.financial_aid_reconciliation import (
    PlaceableRequest,
    SplitPart,
    _awaiting,
    build_ledger,
    live_net,
    locked_total,
    override_split,
)
from bunking.financial_aid.decisions import RoundState
from tests.unit.api.services.test_financial_aid_reconciliation import JUN1, POSTED_R1, R1, line, request

EMMA_PART = SplitPart(1000011, 1000101, "summer", Decimal(1500))
SAMUEL_PART = SplitPart(1000012, 1000102, "summer", Decimal(900))


def _two() -> list[PlaceableRequest]:
    return [request("emma"), request("samuel", person=1000012, session=1000102)]


def test_a_split_line_puts_each_part_on_its_own_request() -> None:
    ledger = build_ledger([line(1, "2400")], {}, _two(), None, splits={1: (EMMA_PART, SAMUEL_PART)})
    assert [(ln.transaction_cm_id, ln.amount) for ln in ledger.lines("emma")] == [(1, Decimal(1500))]
    assert [(ln.transaction_cm_id, ln.amount) for ln in ledger.lines("samuel")] == [(1, Decimal(900))]
    assert ledger.family_unplaced([1000001]) == 0


def test_a_split_that_does_not_add_up_to_the_line_places_nothing() -> None:
    """CampMinder never changes a posted amount, so a mismatch is a bad record: the line waits at family level."""
    ledger = build_ledger([line(1, "2500")], {}, _two(), None, splits={1: (EMMA_PART, SAMUEL_PART)})
    assert ledger.lines("emma") == ()
    assert ledger.lines("samuel") == ()
    assert ledger.family_unplaced([1000001]) == Decimal(2500)


def test_a_part_whose_request_is_gone_waits_at_family_level_alone() -> None:
    ledger = build_ledger([line(1, "2400")], {}, [request("emma")], None, splits={1: (EMMA_PART, SAMUEL_PART)})
    assert [ln.amount for ln in ledger.lines("emma")] == [Decimal(1500)]
    assert ledger.family_unplaced([1000001]) == Decimal(900)
    assert [(ln.transaction_cm_id, ln.amount) for ln in ledger.family_lines([1000001])] == [(1, Decimal(900))]


def test_a_reversed_split_line_reverses_every_part() -> None:
    ledger = build_ledger([line(1, "2400", reversed_at=JUN1)], {}, _two(), None, splits={1: (EMMA_PART, SAMUEL_PART)})
    assert [ln.is_reversed for ln in (*ledger.lines("emma"), *ledger.lines("samuel"))] == [True, True]


def test_a_split_part_naming_a_family_camp_session_lands_on_the_households_request() -> None:
    weekend = request("fam", person=0, session=1000201, family="family_camp")
    part = SplitPart(0, 1000201, "family_camp", Decimal(700))
    ledger = build_ledger([line(1, "2200")], {}, [request("emma"), weekend], None, splits={1: (EMMA_PART, part)})
    assert [ln.amount for ln in ledger.lines("fam")] == [Decimal(700)]
    assert [ln.amount for ln in ledger.lines("emma")] == [Decimal(1500)]


def test_an_override_split_reads_back_its_parts_and_nothing_from_a_plain_placement() -> None:
    fields = {
        "transaction_cm_id": 1,
        "split": [
            {"person_cm_id": 1000011, "session_cm_id": 1000101, "program_family": "summer", "amount": "1500"},
            {"person_cm_id": 1000012, "session_cm_id": 1000102, "program_family": "summer", "amount": "900.50"},
        ],
    }
    assert override_split(fields) == (EMMA_PART, SplitPart(1000012, 1000102, "summer", Decimal("900.50")))
    assert override_split({"transaction_cm_id": 1, "attributed_person_cm_id": 1000011}) == ()
    assert override_split({"split": None}) == ()
    assert override_split({"split": '[{"person_cm_id": 0, "session_cm_id": 1000201, "amount": 700}]'}) == (
        SplitPart(0, 1000201, "", Decimal(700)),
    )
    assert EMMA_PART.fields() == {
        "person_cm_id": 1000011,
        "session_cm_id": 1000101,
        "program_family": "summer",
        "amount": "1500",
    }


def test_a_tick_a_placement_made_never_waits_for_tonights_sync() -> None:
    """The money was already in CampMinder when the registrar placed it (D81), as for the ledger's own tick."""
    late = datetime(2027, 3, 10, 18, 0, tzinfo=UTC)
    synced = datetime(2027, 3, 9, 9, 0, tzinfo=UTC)
    placed = RoundState(round=1, posted=True, locked_amount=Decimal(1500), locked_at=late, lock_source="placement")
    ticked = RoundState(round=1, posted=True, locked_amount=Decimal(1500), locked_at=late, lock_source="tick")
    assert _awaiting(placed, synced) is False
    assert _awaiting(ticked, synced) is True


def test_the_public_totals_are_what_reconciliation_compares() -> None:
    """To place reads a request's locked total and placed live net through these (SP11-rest)."""
    assert locked_total(R1) == Decimal(1800)  # R1: Round 1 posted, locked at 1,800
    assert locked_total(replace(R1, rounds=(replace(R1.rounds[0], clawed_back=True),))) == 0
    assert live_net([line(1, "1500"), line(2, "300", reversed_at=JUN1)]) == Decimal(1500)
    assert POSTED_R1[1].posted_on == date(2027, 3, 9)
