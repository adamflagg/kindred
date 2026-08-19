"""Tests for AttendeeRepository.find_prior_year_bunkmates session scoping (#2426).

Three defects are pinned here:

1. the first query had no ``session_type`` predicate, so a Family Camp day
   group was eligible to be returned as a summer ``prior_bunk``;
2. it had no sort, then took ``assignments[0]`` — an arbitrary pick (the
   pick itself is gone in #2456; every eligible cabin is searched, and
   ``test_prior_year_multi_cabin.py`` pins that);
3. the second query filtered on ``bunk`` + ``year`` with no session, and a bunk
   is a building reused by successive sessions, so the returned "bunkmates"
   were largely children the requester never met.
"""

from collections.abc import Callable
from typing import Any
from unittest.mock import Mock

import pytest

from bunking.graph.social_graph_builder import LAST_YEAR_HISTORY_SESSION_TYPES
from bunking.sync.bunk_request_processor.data.repositories.attendee_repository import (
    AttendeeRepository,
)


def _assignment(person_cm_id: int, bunk_id: str, bunk_name: str, session_id: str) -> Mock:
    """Build a bunk_assignments record whose expand looks like PocketBase's."""
    assignment = Mock(spec=["expand", "year"])
    assignment.year = 2025
    person = Mock(spec=["cm_id"])
    person.cm_id = person_cm_id
    bunk = Mock(spec=["id", "name"])
    bunk.id = bunk_id
    bunk.name = bunk_name
    session = Mock(spec=["id"])
    session.id = session_id
    assignment.expand = {"person": person, "bunk": bunk, "session": session}
    return assignment


class TestFindPriorYearBunkmatesSessionScope:
    @pytest.fixture
    def captured(self) -> list[dict[str, Any]]:
        return []

    @staticmethod
    def _repo(
        captured: list[dict[str, Any]],
        responder: Callable[[dict[str, Any]], list[Any]],
    ) -> AttendeeRepository:
        pb = Mock()
        collection = Mock()

        def _get_full_list(**kwargs):
            query_params = kwargs.get("query_params", {})
            captured.append(query_params)
            return responder(query_params)

        collection.get_full_list.side_effect = _get_full_list
        pb.collection = Mock(return_value=collection)
        repo = AttendeeRepository(pb)
        repo.bulk_get_sessions_for_persons = Mock(return_value={})  # type: ignore[method-assign]
        return repo

    def test_first_query_filters_session_type_and_sorts_deterministically(self, captured):
        repo = self._repo(captured, lambda _query_params: [])

        repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert len(captured) == 1
        filter_str = captured[0]["filter"]
        assert "person.cm_id = 1001" in filter_str
        assert "year = 2025" in filter_str
        for session_type in LAST_YEAR_HISTORY_SESSION_TYPES:
            assert f'session.session_type = "{session_type}"' in filter_str
        assert captured[0].get("sort") == "id"
        assert "session" in captured[0]["expand"]

    def test_second_query_is_scoped_to_the_requesters_own_session(self, captured):
        requester_row = _assignment(1001, "bunk_A", "Cabin 7", "sess_1")
        peer_row = _assignment(2002, "bunk_A", "Cabin 7", "sess_1")

        def responder(query_params):
            return [requester_row] if "person.cm_id" in query_params["filter"] else [peer_row]

        repo = self._repo(captured, responder)
        repo.bulk_get_sessions_for_persons = Mock(return_value={2002: 4321})  # type: ignore[method-assign]

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert len(captured) == 2
        bunkmate_filter = captured[1]["filter"]
        assert 'bunk = "bunk_A"' in bunkmate_filter
        assert "year = 2025" in bunkmate_filter
        assert 'session = "sess_1"' in bunkmate_filter

        assert result["prior_bunk_by_cm_id"] == {2002: "Cabin 7"}
        assert result["cm_ids"] == [2002]
        assert result["total_in_bunk"] == 1
        assert result["returning_count"] == 1

    def test_prior_year_row_without_a_session_returns_nothing(self, captured):
        """Unscopable row — returning the whole building would be the old defect."""
        requester_row = _assignment(1001, "bunk_A", "Cabin 7", "sess_1")
        requester_row.expand = {
            "person": requester_row.expand["person"],
            "bunk": requester_row.expand["bunk"],
        }

        repo = self._repo(captured, lambda _query_params: [requester_row])

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result == {}
        assert len(captured) == 1, "must not fall back to an unscoped bunkmate query"

    def test_bunkmate_query_is_sorted_so_the_returned_order_is_stable(self, captured):
        """`cm_ids` order decides a resolution, so it must not vary between runs.

        `_try_prior_bunkmate_resolution` walks `cm_ids` and returns the FIRST
        camper whose name matches, so two cabinmates sharing a first name are
        separated by nothing but the order this query happened to return. The
        sibling query above already carries `sort: "id"` for exactly this
        reason; the bunkmate query needs the same STABLE_SORT convention.
        """
        requester_row = _assignment(1001, "bunk_A", "Cabin 7", "sess_1")
        peer_row = _assignment(2002, "bunk_A", "Cabin 7", "sess_1")

        def responder(query_params):
            return [requester_row] if "person.cm_id" in query_params["filter"] else [peer_row]

        repo = self._repo(captured, responder)

        repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert len(captured) == 2
        assert captured[1].get("sort") == "id"
