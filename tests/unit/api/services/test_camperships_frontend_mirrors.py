"""Camperships: the words and lists the frontend mirrors from the server (slice 1 screens plan review I5).

The frontend can't import Python, so it keeps a copy of a few server-owned words and lists. Both sides read
`tests/fixtures/camperships_frontend_mirrors.json`: this file holds the server to it, and the frontend's
vitest tests hold the frontend to it. A change on either side fails on its own PR.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from api.services.financial_aid_decisions_service import CANCELLED_IN_KINDRED, _ask_refusal
from api.services.financial_aid_queues import ROUND_STATUS_LABELS
from bunking.financial_aid.decisions.rounds import RoundState

FIXTURE = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "camperships_frontend_mirrors.json"
MIRRORS: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_round_status_words_are_the_servers() -> None:
    assert MIRRORS["round_status_labels"] == dict(ROUND_STATUS_LABELS)


def test_the_appeal_refusals_are_the_writes_own() -> None:
    """The grid's editor row says why an appeal can't be keyed, in the write's own words."""
    words = MIRRORS["ask_refusals"]
    posted = RoundState(round=1, posted=True)
    assert _ask_refusal({1: posted, 2: RoundState(round=2, posted=True)}, 2) == words["round2_posted"]
    assert _ask_refusal({1: RoundState(round=1)}, 2) == words["round1_not_posted"]
    assert _ask_refusal({1: posted, 3: RoundState(round=3, posted=True)}, 2) == words["round3_posted"]
    assert CANCELLED_IN_KINDRED == words["cancelled_in_kindred"]


def test_the_live_request_statuses_and_their_refusal_are_the_writes_own() -> None:
    """A request not in a live status takes no ask; the grid's editor row says so in the write's words."""
    import asyncio
    from types import SimpleNamespace

    from api.services.financial_aid_decisions_service import (
        LIVE_STATUSES,
        DecisionRefusedError,
        FinancialAidDecisionsService,
    )

    assert sorted(MIRRORS["live_request_statuses"]) == sorted(LIVE_STATUSES)

    async def fetch_request(_request_id: str) -> Any:
        return SimpleNamespace(status="withdrawn")

    service = object.__new__(FinancialAidDecisionsService)
    service._store = SimpleNamespace(fetch_request=fetch_request)  # type: ignore[assignment]
    try:
        asyncio.run(service._live("reqx"))
    except DecisionRefusedError as refusal:
        assert str(refusal) == MIRRORS["ask_refusals"]["not_live"].replace("{status}", "withdrawn")
    else:
        raise AssertionError("a withdrawn request must be refused")
