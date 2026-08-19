"""``last_year_bunk`` must name the cabin the MATCHED peer was in (#2456).

``_try_prior_bunkmate_resolution`` read a single top-level ``prior_bunk`` off
the repository result and stamped it on every match. Once all of the
requester's prior cabins are searched, that key names an arbitrary one of them,
so a peer from Cabin 3 was reported as having been in Cabin 7. The metadata is
the evidence a staff reviewer reads, so it has to be the peer's own cabin.
"""

import inspect
from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
    Phase2ResolutionService,
)


def _person(cm_id: int, first_name: str, last_name: str) -> Person:
    return Person(cm_id=cm_id, first_name=first_name, last_name=last_name, grade=5)


PEERS = {
    2002: _person(2002, "Emma", "Johnson"),
    3003: _person(3003, "Liam", "Garcia"),
}


@pytest.fixture
def service() -> Phase2ResolutionService:
    attendee_repository = Mock()
    attendee_repository.find_prior_year_bunkmates.return_value = {
        "cm_ids": [2002, 3003],
        "prior_bunk_by_cm_id": {2002: "Cabin 7", 3003: "Cabin 3"},
        "prior_bunks": ["Cabin 7", "Cabin 3"],
        "prior_year": 2025,
        "total_in_bunk": 2,
        "returning_count": 2,
    }
    person_repository = Mock()
    person_repository.find_by_cm_id.side_effect = PEERS.get
    return Phase2ResolutionService(
        resolution_pipeline=Mock(),
        attendee_repository=attendee_repository,
        person_repository=person_repository,
    )


class TestMatchedPeerCabinInMetadata:
    def test_full_name_match_reports_the_peers_own_cabin(self, service):
        result = service._try_prior_bunkmate_resolution(
            target_name="Liam Garcia",
            requester_cm_id=1001,
            year=2026,
        )

        assert result is not None
        assert result.confidence == 0.95
        assert result.method == "prior_bunkmate_exact"
        assert result.metadata["last_year_bunk"] == "Cabin 3"

    def test_first_name_match_reports_the_peers_own_cabin(self, service):
        result = service._try_prior_bunkmate_resolution(
            target_name="Liam",
            requester_cm_id=1001,
            year=2026,
        )

        assert result is not None
        assert result.confidence == 0.90
        assert result.method == "prior_bunkmate_first_name"
        assert result.metadata["last_year_bunk"] == "Cabin 3"

    def test_the_first_cabins_peer_still_reports_its_own_cabin(self, service):
        result = service._try_prior_bunkmate_resolution(
            target_name="Emma Johnson",
            requester_cm_id=1001,
            year=2026,
        )

        assert result is not None
        assert result.metadata["last_year_bunk"] == "Cabin 7"


class TestUnusedSessionParameterIsGone:
    def test_signature_does_not_take_session_cm_id(self):
        """It existed only to pass to a repository call that ignored it."""
        params = inspect.signature(Phase2ResolutionService._try_prior_bunkmate_resolution).parameters

        assert "session_cm_id" not in params
        assert list(params) == ["self", "target_name", "requester_cm_id", "year"]

    def test_repository_is_called_without_a_session(self, service):
        service._try_prior_bunkmate_resolution(target_name="Emma Johnson", requester_cm_id=1001, year=2026)

        service.attendee_repository.find_prior_year_bunkmates.assert_called_once_with(1001, 2026)
