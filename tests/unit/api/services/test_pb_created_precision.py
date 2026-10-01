"""Replay keeps millisecond order. The PocketBase SDK parses `created` without its milliseconds, so two
events on one request in the same second replayed in record-id order, not time order (a hold lifted 9 ms
after it was placed still read held). Each test builds REAL SDK records whose ids sort the other way from
their times, 10 ms apart in one second. Fictional only."""

from __future__ import annotations

from typing import Any

from pocketbase.models.record import Record

from api.services.financial_aid_cancellations import fold_cancellations
from api.services.financial_aid_change_log_reads import log_row
from api.services.financial_aid_corrections import REVERT, FieldKind, effective_values
from api.services.financial_aid_decisions_repository import cancel_event, decision_event, hold_event
from api.services.financial_aid_grant_placements import newest, placement_record
from api.services.financial_aid_intake_repository import _correction
from api.services.financial_aid_intake_types import CorrectionRecord
from bunking.financial_aid.decisions.holds import fold_holds
from bunking.financial_aid.decisions.rounds import fold_rounds

FIRST = "2027-02-01 18:00:00.001Z"
SECOND = "2027-02-01 18:00:00.011Z"
EARLY_ID, LATE_ID = "zzzzzzzzzzzzzzz", "aaaaaaaaaaaaaaa"  # the id order is the WRONG order


def rec(**fields: Any) -> Record:
    return Record({"collectionName": "x", **fields})


def test_a_hold_lifted_10ms_after_it_was_placed_reads_lifted() -> None:
    placed = hold_event(rec(id=EARLY_ID, created=FIRST, request="r1", event="place", code="manual_hold", note="n"))
    lifted = hold_event(rec(id=LATE_ID, created=SECOND, request="r1", event="lift", code="manual_hold"))
    assert fold_holds([placed, lifted])["r1"].manual is None


def test_a_round_unposted_10ms_after_it_was_posted_reads_unposted() -> None:
    post = decision_event(rec(id=EARLY_ID, created=FIRST, request="r1", round=1, event="post", amount=100))
    unpost = decision_event(rec(id=LATE_ID, created=SECOND, request="r1", round=1, event="unpost"))
    assert fold_rounds([post, unpost])["r1"][1].posted is False


def test_a_request_reopened_10ms_after_it_was_cancelled_reads_reopened() -> None:
    cancel = cancel_event(rec(id=EARLY_ID, created=FIRST, request="r1", event="cancel", in_kindred=True))
    reopen = cancel_event(rec(id=LATE_ID, created=SECOND, request="r1", event="reopen"))
    assert fold_cancellations([cancel, reopen])["r1"].in_kindred is False


def test_a_placement_removed_10ms_after_it_was_placed_reads_removed() -> None:
    place = placement_record(rec(id=EARLY_ID, created=FIRST, grant="g1", event="place", placement={"a": 1}))
    remove = placement_record(rec(id=LATE_ID, created=SECOND, grant="g1", event="remove"))
    assert newest([place, remove])["g1"].event == "remove"


def test_a_log_row_keeps_its_milliseconds() -> None:
    row = log_row(rec(id=EARLY_ID, created=FIRST, entity="aid_requests", entity_id="r1"))
    assert row.created.microsecond == 1000


def test_a_correction_reverted_10ms_after_it_was_made_reads_reverted() -> None:
    def make(id_: str, at: str, value: str) -> CorrectionRecord:
        return _correction(
            rec(
                id=id_,
                created=at,
                year=2027,
                application="a1",
                request="",
                field="ask",
                new_value=value,
                reason="why",
                actor="x",
            )
        )

    corrections = [make(EARLY_ID, FIRST, "500.00"), make(LATE_ID, SECOND, REVERT)]
    value = effective_values({"ask": "100"}, {"ask": FieldKind.MONEY}, corrections)["ask"]
    assert value.corrected is False
