"""Season › History's Round column reads (owner 2026-10-10, option B): only an opened operation with grant placements
pays for them. Fictional only."""

from __future__ import annotations

from collections.abc import Collection
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_history_reads import SeasonHistoryReads, fetch_decision_events
from api.services.financial_aid_rules_service import PRICING_SECTIONS
from tests.unit.bunking.financial_aid.fixtures import fictional_rules


@pytest.mark.asyncio
async def test_the_round_reads_take_the_posted_ticks_of_some_requests_a_chunk_at_a_time() -> None:
    """Season › History's Round column (owner 2026-10-10): only an opened operation's placement shares' requests, only
    their Posted and undo ticks, no snapshot JSON, chunked under PocketBase's filter limit (a first log run places
    every grant of the season at once)."""
    pb = MagicMock()
    tick = SimpleNamespace(
        id="dec000000000001", request="reqemma00000001", round=1, event="post", created="2027-03-09 17:00:00.000Z",
        amount=1000, effective_on="2027-03-09",
    )  # fmt: skip
    pb.collection.return_value.get_full_list.return_value = [tick]
    ids = [f"req{i:012d}" for i in range(300)]
    found = await fetch_decision_events(pb, 2027, ids)
    pb.collection.assert_called_with("aid_decisions")
    queries = [c.kwargs["query_params"] for c in pb.collection.return_value.get_full_list.call_args_list]
    assert 1 < len(queries) < len(ids)
    assert all(len(q["filter"]) <= 3500 for q in queries)
    assert all(q["filter"].startswith('year = 2027 && (event = "post" || event = "unpost") && (') for q in queries)
    assert sum(q["filter"].count("request =") for q in queries) == 300
    assert "snapshot" not in queries[0]["fields"]
    assert {(e.request_id, e.round, e.kind) for e in found} == {("reqemma00000001", 1, "post")}  # merged by id
    pb.reset_mock()
    assert await fetch_decision_events(pb, 2027, []) == []
    pb.collection.assert_not_called()
    with pytest.raises(ValueError, match="record id"):
        await fetch_decision_events(pb, 2027, ['x" || year > 0 || "'])


@pytest.mark.asyncio
async def test_the_round_reads_take_the_rules_that_priced_the_season_at_each_placement() -> None:
    """The rules service's own as-of replay (approved_as_of_each, one read of the versions and the log) for the pricing
    sections; an instant whose rules history can't be replayed has no rules, never an older version's."""

    early, late = datetime(2027, 3, 1, tzinfo=UTC), datetime(2027, 3, 2, tzinfo=UTC)
    rules = fictional_rules()
    calls: list[tuple[int, tuple[str, ...], frozenset[datetime]]] = []

    class _Rules:
        async def approved_as_of_each(
            self, year: int, sections: Collection[str], ats: Collection[datetime]
        ) -> tuple[dict[datetime, Any], frozenset[datetime]]:
            calls.append((year, tuple(sections), frozenset(ats)))
            return {early: SimpleNamespace(document=rules)}, frozenset({late})

    reads = SeasonHistoryReads(MagicMock(), rules=_Rules())
    assert await reads.fetch_pricing_rules_at(2027, [early, late]) == {early: rules, late: None}
    assert calls == [(2027, tuple(PRICING_SECTIONS), frozenset({early, late}))]
    assert await reads.fetch_pricing_rules_at(2027, []) == {}
    assert len(calls) == 1  # nothing to replay, nothing read
