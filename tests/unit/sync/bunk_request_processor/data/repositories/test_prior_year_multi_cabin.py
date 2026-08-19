"""``find_prior_year_bunkmates`` must search EVERY prior-year cabin (#2456).

#2445 scoped the peer query to the requester's own ``(bunk, session)`` pair,
which was right, and made this pre-existing limitation visible: the method
queries all of the requester's eligible prior-year assignments and then keeps
exactly one of them (``assignments[0]``). Every cabin but that one is
unreachable, and ``sort: "id"`` only makes the pick *stable* — PocketBase
record ids are random, so which cabin wins is arbitrary.

A multi-session camper therefore has one of their three or four prior cabins
searched, and the ``last_year_bunk`` metadata names whichever cabin won rather
than the cabin the matched peer was actually in.
"""

import inspect
import logging
from collections.abc import Callable
from typing import Any
from unittest.mock import Mock

import pytest

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


def _repo(
    captured: list[dict[str, Any]],
    responder: Callable[[dict[str, Any]], list[Any]],
    returning: dict[int, Any] | None = None,
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
    repo.bulk_get_sessions_for_persons = Mock(  # type: ignore[method-assign]
        return_value=returning if returning is not None else {}
    )
    return repo


def _two_cabin_responder(
    requester_rows: list[Mock], peers_by_bunk: dict[str, list[Mock]]
) -> Callable[[dict[str, Any]], list[Mock]]:
    """Answer the requester query, then each per-cabin peer query."""

    def responder(query_params: dict[str, Any]) -> list[Mock]:
        filter_str = query_params["filter"]
        if "person.cm_id" in filter_str:
            return requester_rows
        for bunk_id, rows in peers_by_bunk.items():
            if f'bunk = "{bunk_id}"' in filter_str:
                return rows
        return []

    return responder


class TestEveryPriorCabinIsSearched:
    @pytest.fixture
    def captured(self) -> list[dict[str, Any]]:
        return []

    def test_peers_from_all_prior_cabins_are_returned(self, captured):
        """One cabin searched is the defect; the union is the fix."""
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
        ]
        peers = {
            "bunk_A": [
                _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
                _assignment(2002, "bunk_A", "Cabin 7", "sess_1"),
            ],
            "bunk_B": [
                _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
                _assignment(3003, "bunk_B", "Cabin 3", "sess_2"),
            ],
        }
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={2002: 1, 3003: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result["cm_ids"] == [2002, 3003]
        assert result["total_in_bunk"] == 2
        assert result["returning_count"] == 2

    def test_each_cabin_gets_its_own_session_scoped_query(self, captured):
        """#2445's scoping is per cabin, not abandoned — one query per pair."""
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
        ]
        peers = {
            "bunk_A": [_assignment(2002, "bunk_A", "Cabin 7", "sess_1")],
            "bunk_B": [_assignment(3003, "bunk_B", "Cabin 3", "sess_2")],
        }
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={2002: 1, 3003: 1})

        repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        peer_filters = [q["filter"] for q in captured[1:]]
        assert len(peer_filters) == 2
        assert any('bunk = "bunk_A"' in f and 'session = "sess_1"' in f for f in peer_filters)
        assert any('bunk = "bunk_B"' in f and 'session = "sess_2"' in f for f in peer_filters)
        assert all("year = 2025" in f for f in peer_filters)
        assert all(q.get("sort") == "id" for q in captured[1:])

    def test_the_same_building_in_two_sessions_is_two_cabins(self, captured):
        """A bunk is a building. Same bunk, different session = different children."""
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_A", "Cabin 7", "sess_2"),
        ]

        def responder(query_params):
            if "person.cm_id" in query_params["filter"]:
                return requester_rows
            if 'session = "sess_1"' in query_params["filter"]:
                return [_assignment(2002, "bunk_A", "Cabin 7", "sess_1")]
            return [_assignment(3003, "bunk_A", "Cabin 7", "sess_2")]

        repo = _repo(captured, responder, returning={2002: 1, 3003: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result["cm_ids"] == [2002, 3003]

    def test_a_peer_shared_by_two_cabins_appears_once(self, captured):
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
        ]
        peers = {
            "bunk_A": [_assignment(2002, "bunk_A", "Cabin 7", "sess_1")],
            "bunk_B": [_assignment(2002, "bunk_B", "Cabin 3", "sess_2")],
        }
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={2002: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result["cm_ids"] == [2002]
        assert result["total_in_bunk"] == 1

    def test_a_cabin_with_no_session_is_skipped_not_fatal(self, captured):
        """An unscopable row must not cost the requester their other cabins.

        Returning the whole building was #2445's defect; dropping the lookup
        entirely because one row lacks a session is a different way to lose it.
        """
        unscopable = _assignment(1001, "bunk_A", "Cabin 7", "sess_1")
        unscopable.expand = {
            "person": unscopable.expand["person"],
            "bunk": unscopable.expand["bunk"],
        }
        requester_rows = [unscopable, _assignment(1001, "bunk_B", "Cabin 3", "sess_2")]
        peers = {"bunk_B": [_assignment(3003, "bunk_B", "Cabin 3", "sess_2")]}
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={3003: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result["cm_ids"] == [3003]
        peer_filters = [q["filter"] for q in captured[1:]]
        assert len(peer_filters) == 1, "the unscopable cabin must not be queried"
        assert 'bunk = "bunk_B"' in peer_filters[0]


class TestMatchedPeerCarriesItsOwnCabin:
    @pytest.fixture
    def captured(self) -> list[dict[str, Any]]:
        return []

    def test_each_peer_maps_to_the_cabin_they_actually_shared(self, captured):
        """``last_year_bunk`` named whichever cabin won the pick, for every peer."""
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
        ]
        peers = {
            "bunk_A": [_assignment(2002, "bunk_A", "Cabin 7", "sess_1")],
            "bunk_B": [_assignment(3003, "bunk_B", "Cabin 3", "sess_2")],
        }
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={2002: 1, 3003: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result["prior_bunk_by_cm_id"] == {2002: "Cabin 7", 3003: "Cabin 3"}
        assert set(result["prior_bunk_by_cm_id"]) == set(result["cm_ids"])

    def test_prior_bunks_lists_every_cabin_searched(self, captured):
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
        ]
        peers = {"bunk_A": [_assignment(2002, "bunk_A", "Cabin 7", "sess_1")]}
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={2002: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result["prior_bunks"] == ["Cabin 7", "Cabin 3"]

    def test_no_single_top_level_prior_bunk_is_returned(self, captured):
        """A singular key would still name an arbitrary cabin for every peer."""
        requester_rows = [
            _assignment(1001, "bunk_A", "Cabin 7", "sess_1"),
            _assignment(1001, "bunk_B", "Cabin 3", "sess_2"),
        ]
        peers = {"bunk_A": [_assignment(2002, "bunk_A", "Cabin 7", "sess_1")]}
        repo = _repo(captured, _two_cabin_responder(requester_rows, peers), returning={2002: 1})

        result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert "prior_bunk" not in result


class TestUnusedSessionParameterIsGone:
    def test_signature_does_not_take_session_cm_id(self):
        """It was documented as narrowing the pool and never read.

        That it does not narrow is deliberate — a camper in a late session this
        year must still reach friends from an early session last year — so the
        parameter goes rather than the behaviour.
        """
        params = inspect.signature(AttendeeRepository.find_prior_year_bunkmates).parameters

        assert "session_cm_id" not in params
        assert list(params) == ["self", "requester_cm_id", "year"]


class TestSkippedSeasonIsDiagnosable:
    @pytest.fixture
    def captured(self) -> list[dict[str, Any]]:
        return []

    def test_no_prior_year_assignment_logs_a_debug_line(self, captured, caplog):
        """The path only ever looks at ``year - 1`` (#2457).

        A camper who skipped a season resolves nothing here by construction, and
        a bare ``return {}`` makes that indistinguishable from a bug in a sync
        log.
        """
        repo = _repo(captured, lambda _query_params: [])

        with caplog.at_level(logging.DEBUG):
            result = repo.find_prior_year_bunkmates(requester_cm_id=1001, year=2026)

        assert result == {}
        assert any("1001" in record.getMessage() and "2025" in record.getMessage() for record in caplog.records), (
            f"expected a debug line naming the requester and the year searched; got {[r.getMessage() for r in caplog.records]}"
        )
