"""A done season's grid row (CLOSED-SEASONS-DONE; owner ruling NG-01, CSD-1, CSD-5): nothing pending and nothing to
do. A request still waiting at close reads Closed; a finished stage keeps its word. The money, the rounds, the status
and Included are history and are never touched. Fictional only."""

from __future__ import annotations

from typing import Any

import pytest

from api.schemas.financial_aid_decisions import (
    CancellationOut,
    GridRowOut,
    RowStageOut,
    TodoOut,
    UntickedMoneyOut,
)
from api.schemas.financial_aid_intake import IssueOut
from api.services.financial_aid_queues import STAGE_CLOSED_WORDS, close_row, row_queues, row_stage
from tests.unit.api.services.test_financial_aid_queues import _round, _row


def _live(row: GridRowOut) -> GridRowOut:
    """The row as row_of finishes it: its queues and its stage."""
    return row.model_copy(update={"queues": row_queues(row), "stage": row_stage(row)})


def _held(**over: Any) -> GridRowOut:
    hold = IssueOut(code="no_approved_rules", severity="error", message="No approved rules for this season")
    return _live(_row(_round(1, "held", ask=3100.0), holds=[hold], **over))


def test_the_closed_word_is_closed() -> None:
    assert STAGE_CLOSED_WORDS == "Closed"


@pytest.mark.parametrize("status", ["held", "not_decided", "needs_offer", "pending_approval"])
def test_a_round_still_waiting_at_close_reads_closed(status: str) -> None:
    row = _live(_row(_round(1, status, ask=2600.0, decided=2000.0 if status != "held" else None)))
    closed = close_row(row)
    assert closed.stage == RowStageOut(round=1, code="closed", label="Closed")


@pytest.mark.parametrize("status", ["unmatched_session", "duplicate_pending", "active"])
def test_a_live_request_with_no_round_yet_reads_closed(status: str) -> None:
    row = _live(_row(request_status=status))
    assert row.stage is None
    assert close_row(row).stage == RowStageOut(round=None, code="closed", label="Closed")


@pytest.mark.parametrize("status", ["withdrawn", "duplicate"])
def test_a_request_that_was_never_live_has_no_stage_to_close(status: str) -> None:
    """A withdrawn request or a confirmed duplicate waited on no one: no stage before, none after."""
    row = _live(_row(request_status=status))
    assert close_row(row).stage is None


def test_posted_accepted_refused_and_cancelled_keep_their_words() -> None:
    posted = _live(_row(_round(1, "posted", decided=1500.0, posted=1500.0)))
    accepted = _live(_row(_round(1, "posted", decided=1500.0, posted=1500.0, accepted=True)))
    refused = _live(_row(_round(1, "posted", decided=1500.0, posted=1500.0, accepted=True), _round(3, "refused")))
    cancelled = _live(
        _row(
            _round(1, "posted", decided=1500.0, posted=1500.0),
            cancellation=CancellationOut(by="campminder", on=None, reason=None, note=""),
        )
    )
    for row in (posted, accepted, refused, cancelled):
        assert close_row(row).stage == row.stage
        assert close_row(row).closed is True
    assert close_row(posted).stage == RowStageOut(round=1, code="posted", label="R1 · Posted")
    assert close_row(refused).stage is not None and close_row(refused).stage.code == "refused"  # type: ignore[union-attr]


def test_a_closed_row_needs_nothing() -> None:
    """CSD-5: the Needs attention column is empty, every queue too (Today and the strip count 0)."""
    row = _held(
        unticked=[
            UntickedMoneyOut(
                round=1, code="on_hold", message="CampMinder holds money", mark_posted=False, label="On hold"
            )
        ],
        todos=[TodoOut(code="cancel_reason", message="No reason recorded")],
        to_reverse=True,
        notes=[IssueOut(code="family_level", severity="warn", message="Money to place")],
    )
    assert row.queues  # it was in Holds, at least
    assert row.closed is False
    closed = close_row(row)
    # The row says it is a closed season's, so every screen that words a row's needs (the grid's Needs attention,
    # its group headings, the opened line, the household card) draws none.
    assert closed.closed is True
    assert closed.queues == []
    assert closed.holds == []
    assert closed.unticked == []
    assert closed.todos == []
    assert closed.notes == []
    assert closed.to_reverse is False


def test_closing_never_touches_the_history() -> None:
    """Status, rounds, Included and every money figure stand as they were (no total moves)."""
    row = _held(total_decided=1200.0, total_posted=800.0, included=True, cost=3100.0, tier=3)
    closed = close_row(row)
    for name in ("request_status", "rounds", "included", "total_decided", "total_posted", "cost", "tier", "pool"):
        assert getattr(closed, name) == getattr(row, name), name
    assert closed.released_holds == row.released_holds


def test_a_past_reads_not_rebuilt_figures_stay_not_rebuilt() -> None:
    """A past-date read leaves queues and unticked None (not rebuilt for that date); closing does not invent them."""
    row = _held().model_copy(update={"queues": None, "unticked": None, "to_reverse": None, "todos": None})
    closed = close_row(row)
    assert closed.queues is None
    assert closed.unticked is None
    assert closed.to_reverse is None
    assert closed.todos is None
    assert closed.stage is not None and closed.stage.code == "closed"
