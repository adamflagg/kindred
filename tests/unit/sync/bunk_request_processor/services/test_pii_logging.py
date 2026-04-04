"""Tests for PII logging levels — camper names/IDs must only appear at DEBUG, not INFO.

Verifies fix for #787: Individual camper names and CampMinder IDs were logged at INFO level.
After the fix, INFO gets aggregate counts only; DEBUG gets the detailed PII.

Affected modules:
- group_resolvers.py (sibling, bunkmate, peer resolvers)
- placeholder_expander.py (requester cm_id, member names)
- phase2_resolution_service.py (staff name filter log)
- staff_name_detector.py (detected staff/parent names)
- orchestrator.py (detected staff/parent names)
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    GroupKind,
    ParsedRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.services.group_resolvers import (
    BunkmateResolver,
    SiblingResolver,
)
from bunking.sync.bunk_request_processor.services.placeholder_expander import PlaceholderExpander
from bunking.sync.bunk_request_processor.services.staff_name_detector import StaffNameDetector


def _make_person(cm_id: int, first_name: str, last_name: str) -> Person:
    """Create a minimal Person for testing."""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
    )


def _make_parsed_req(
    raw_text: str = "test request",
    request_type: RequestType = RequestType.BUNK_WITH,
    target_name: str | None = None,
    group_kind: GroupKind | None = None,
) -> ParsedRequest:
    """Create a ParsedRequest with all required fields."""
    return ParsedRequest(
        raw_text=raw_text,
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="bunking_notes",
        source=RequestSource.FAMILY,
        confidence=1.0,
        csv_position=0,
        metadata={},
        group_kind=group_kind,
    )


class TestSiblingResolverPiiLogging:
    """Sibling resolver must log names/IDs at DEBUG only, counts at INFO."""

    def test_info_log_contains_count_only(self, caplog):
        """INFO log should contain sibling count but NOT names."""
        person_repo = MagicMock()
        siblings = [
            _make_person(2001, "Emma", "Johnson"),
            _make_person(2002, "Liam", "Johnson"),
        ]
        person_repo.find_siblings.return_value = siblings

        resolver = SiblingResolver(person_repo=person_repo, year=2025)
        parsed_req = _make_parsed_req(raw_text="bunk with siblings")

        with caplog.at_level(logging.DEBUG):
            resolver.resolve(requester_cm_id=1001, parsed_request=parsed_req, session_cm_id=5001)

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should mention count but NOT individual names
        assert any("2" in msg and "sibling" in msg.lower() for msg in info_messages)
        assert not any("Emma Johnson" in msg for msg in info_messages)
        assert not any("Liam Johnson" in msg for msg in info_messages)
        assert not any("1001" in msg for msg in info_messages)

        # DEBUG should contain the detailed names
        assert any("Emma Johnson" in msg for msg in debug_messages)

    def test_no_siblings_no_resolved_info_log(self, caplog):
        """When no siblings found, no 'Resolved' INFO log about siblings."""
        person_repo = MagicMock()
        person_repo.find_siblings.return_value = []

        resolver = SiblingResolver(person_repo=person_repo, year=2025)
        parsed_req = _make_parsed_req(raw_text="bunk with siblings")

        with caplog.at_level(logging.DEBUG):
            resolver.resolve(requester_cm_id=1001, parsed_request=parsed_req, session_cm_id=5001)

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        assert not any("Resolved" in msg and "sibling" in msg.lower() for msg in info_messages)


class TestBunkmateResolverPiiLogging:
    """Bunkmate resolver must log names/IDs at DEBUG only, counts at INFO."""

    def test_info_log_contains_count_only(self, caplog):
        """INFO log should contain bunkmate count but NOT names."""
        person_repo = MagicMock()
        attendee_repo = MagicMock()

        # Mock prior bunkmates data structure matching what the resolver expects
        attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [3001],
            "prior_bunk": "Cabin A",
            "prior_year": 2024,
        }
        person_repo.bulk_find_by_cm_ids.return_value = {
            3001: _make_person(3001, "Olivia", "Chen"),
        }

        resolver = BunkmateResolver(
            person_repo=person_repo,
            attendee_repo=attendee_repo,
            year=2025,
        )
        parsed_req = _make_parsed_req(raw_text="bunk with last year bunkmates")

        with caplog.at_level(logging.DEBUG):
            resolver.resolve(requester_cm_id=1001, parsed_request=parsed_req, session_cm_id=5001)

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should mention count but NOT individual names
        assert any("1" in msg and "bunkmate" in msg.lower() for msg in info_messages)
        assert not any("Olivia Chen" in msg for msg in info_messages)
        assert not any("1001" in msg for msg in info_messages)

        # DEBUG should contain the detailed names
        assert any("Olivia Chen" in msg for msg in debug_messages)


class TestPlaceholderExpanderPiiLogging:
    """PlaceholderExpander must not log requester cm_ids or member names at INFO."""

    @pytest.mark.asyncio
    async def test_expand_via_resolver_logs_cm_id_at_debug(self, caplog):
        """Expanding group should NOT log requester_cm_id at INFO."""
        expander = PlaceholderExpander(year=2025)

        member = MagicMock()
        member.person = _make_person(3001, "Noah", "Williams")
        member.request_type = RequestType.BUNK_WITH
        member.confidence = 0.9
        member.metadata = {"expanded_from": "sibling"}

        resolver = MagicMock()
        resolver.resolve.return_value = [member]

        parsed_req = _make_parsed_req(
            raw_text="bunk with siblings",
            group_kind=GroupKind.SIBLING,
        )

        parse_request = MagicMock()
        parse_request.requester_cm_id = 1001
        parse_request.session_cm_id = 5001
        parse_request.requester_name = "Test Camper"

        parse_result = ParseResult(
            parsed_requests=[parsed_req],
            needs_historical_context=False,
            is_valid=True,
            parse_request=parse_request,
        )

        resolution = ResolutionResult(person=None, confidence=0.0, method="pending")

        with caplog.at_level(logging.DEBUG):
            await expander.expand(
                resolution_results=[(parse_result, [resolution])],
                resolver_registry={GroupKind.SIBLING: resolver},
            )

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should NOT contain requester cm_id or member names
        assert not any("1001" in msg for msg in info_messages)
        assert not any("Noah Williams" in msg for msg in info_messages)
        assert not any("3001" in msg for msg in info_messages)

        # DEBUG should contain the detailed info
        assert any("1001" in msg for msg in debug_messages)


class TestStaffNameDetectorPiiLogging:
    """StaffNameDetector.build_global_set must log names at DEBUG only."""

    def test_info_log_contains_count_only(self, caplog):
        """INFO log should contain count of detected names, not the names themselves."""
        detector = StaffNameDetector(staff_list_path=None)

        notes = [
            "Sarah Smith called to discuss bunking preferences",
            "Mom spoke with us about cabin assignment",
        ]

        with caplog.at_level(logging.DEBUG):
            result = detector.build_global_set(notes)

        if not result:
            pytest.skip("No staff names detected from test notes")

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should mention count, NOT individual names
        detected_names = list(result)
        for name in detected_names:
            assert not any(name in msg for msg in info_messages), f"Name '{name}' found in INFO log"

        # DEBUG should contain the detailed names
        assert any(any(name in msg for name in detected_names) for msg in debug_messages)


class TestPhase2ResolutionStaffFilterPiiLogging:
    """Phase 2 resolution service should log filtered staff names at DEBUG only."""

    @pytest.mark.asyncio
    async def test_staff_name_filter_log_is_debug(self, caplog):
        """Filtered staff name should appear in DEBUG, not INFO."""
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = MagicMock()
        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            staff_name_filter=lambda name: name == "Jordan",
        )

        parsed_req = _make_parsed_req(
            raw_text="bunk with Jordan",
            target_name="Jordan",
        )

        parse_request = MagicMock()
        parse_request.requester_cm_id = 1001
        parse_request.session_cm_id = 5001
        parse_request.year = 2025

        parse_result = ParseResult(
            parsed_requests=[parsed_req],
            needs_historical_context=False,
            is_valid=True,
            parse_request=parse_request,
        )

        with caplog.at_level(logging.DEBUG):
            await service.batch_resolve([parse_result])

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]

        # INFO should NOT contain the filtered staff name
        assert not any("Jordan" in msg for msg in info_messages)

        # DEBUG should contain the filtered staff name
        assert any("Jordan" in msg for msg in debug_messages)
