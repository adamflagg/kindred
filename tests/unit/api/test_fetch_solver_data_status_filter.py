"""fetch_solver_data must use the canonical status_id filter (#1790).

The attendees table carries both `status` (select string) and `status_id`
(number). Everywhere else keys enrollment on `status_id = 2` (CLAUDE.md
invariant #8, shared constant ACTIVE_ENROLLED_FILTER) — the solver input
fetch was the lone `status = "enrolled"` string read, so a string/numeric
divergence during sync would silently give the solver a different enrolled
set than the rest of the system. This test pins the attendees filter to the
canonical constant.
"""

import asyncio
from unittest.mock import Mock

from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.services import data_fetcher


def test_attendee_fetch_uses_canonical_status_id_filter(monkeypatch):
    captured: dict[str, dict[str, str]] = {}

    def make_collection(name: str) -> Mock:
        collection = Mock()

        def get_full_list(query_params=None):
            captured[name] = query_params or {}
            return []

        collection.get_full_list = get_full_list
        return collection

    client = Mock()
    client.collection.side_effect = make_collection

    ctx = Mock()
    ctx.session_cm_id = 1000001
    ctx.year = 2026
    ctx.related_session_ids = [1000001]
    ctx.session_relation_filter = "session.cm_id = 1000001"
    ctx.session_id_filter = "session_id = 1000001"

    async def fake_build_session_context(session_cm_id, year, pb_client):
        return ctx

    monkeypatch.setattr(data_fetcher, "build_session_context", fake_build_session_context)

    asyncio.run(data_fetcher.fetch_session_data_v2(1000001, year=2026, pb_client=client))

    attendees_filter = captured["attendees"]["filter"]
    assert ACTIVE_ENROLLED_FILTER in attendees_filter
    assert 'status = "enrolled"' not in attendees_filter
