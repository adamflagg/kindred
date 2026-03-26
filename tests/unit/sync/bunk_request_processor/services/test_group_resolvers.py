"""Tests for GroupResolver protocol, ResolvedGroupMember, and resolver implementations.

Tests define the expected behavior for expanding group references
(siblings, bunkmates, classmates, congregation) into individual requests."""

from unittest.mock import MagicMock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    GroupKind,
    ParsedRequest,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.group_resolvers import (
    ResolvedGroupMember,
    SiblingResolver,
)


def _make_parsed_request(**overrides) -> ParsedRequest:
    """Helper to create a ParsedRequest with sensible defaults."""
    defaults = {
        "raw_text": "bunk with sibling",
        "request_type": RequestType.BUNK_WITH,
        "target_name": None,
        "age_preference": None,
        "source_field": "share_bunk_with",
        "source": RequestSource.FAMILY,
        "confidence": 0.95,
        "csv_position": 0,
        "metadata": {},
        "notes": None,
        "group_kind": GroupKind.SIBLING,
    }
    defaults.update(overrides)
    return ParsedRequest(**defaults)


def _make_person(cm_id: int, first_name: str = "Emma", last_name: str = "Johnson", **kwargs) -> Person:
    """Helper to create a Person with sensible defaults."""
    return Person(cm_id=cm_id, first_name=first_name, last_name=last_name, **kwargs)


class TestResolvedGroupMember:
    """Test the ResolvedGroupMember dataclass."""

    def test_resolved_group_member_creation(self):
        """ResolvedGroupMember should store person, confidence, request_type, metadata."""
        person = _make_person(1001, "Liam", "Garcia")
        member = ResolvedGroupMember(
            person=person,
            confidence=0.95,
            request_type=RequestType.BUNK_WITH,
            metadata={"expanded_from": "sibling"},
        )
        assert member.person == person
        assert member.confidence == 0.95
        assert member.request_type == RequestType.BUNK_WITH
        assert member.metadata == {"expanded_from": "sibling"}


class TestSiblingResolver:
    """Test the SiblingResolver."""

    def test_base_confidence(self):
        """SiblingResolver.base_confidence should be 0.95."""
        person_repo = MagicMock()
        resolver = SiblingResolver(person_repo, year=2025)
        assert resolver.base_confidence == 0.95

    def test_resolve_finds_siblings(self):
        """SiblingResolver should return siblings from person_repo.find_siblings."""
        person_repo = MagicMock()
        sibling1 = _make_person(2001, "Olivia", "Chen")
        sibling2 = _make_person(2002, "Noah", "Chen")
        person_repo.find_siblings.return_value = [sibling1, sibling2]

        resolver = SiblingResolver(person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.SIBLING)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 2
        assert result[0].person == sibling1
        assert result[1].person == sibling2
        person_repo.find_siblings.assert_called_once_with(1001, 2025)

    def test_resolve_empty_when_no_siblings(self):
        """SiblingResolver should return empty list when no siblings found."""
        person_repo = MagicMock()
        person_repo.find_siblings.return_value = []

        resolver = SiblingResolver(person_repo, year=2025)
        parsed = _make_parsed_request()
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result == []

    def test_resolve_preserves_not_bunk_with_type(self):
        """SiblingResolver should preserve the original request_type from parsed_request."""
        person_repo = MagicMock()
        sibling = _make_person(2001, "Olivia", "Chen")
        person_repo.find_siblings.return_value = [sibling]

        resolver = SiblingResolver(person_repo, year=2025)
        parsed = _make_parsed_request(request_type=RequestType.NOT_BUNK_WITH)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 1
        assert result[0].request_type == RequestType.NOT_BUNK_WITH

    def test_resolve_sets_metadata(self):
        """SiblingResolver should set metadata with expanded_from=sibling."""
        person_repo = MagicMock()
        sibling = _make_person(2001, "Olivia", "Chen")
        person_repo.find_siblings.return_value = [sibling]

        resolver = SiblingResolver(person_repo, year=2025)
        parsed = _make_parsed_request()
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result[0].metadata["expanded_from"] == "sibling"

    def test_resolve_uses_base_confidence(self):
        """SiblingResolver should set confidence to base_confidence (0.95)."""
        person_repo = MagicMock()
        sibling = _make_person(2001, "Olivia", "Chen")
        person_repo.find_siblings.return_value = [sibling]

        resolver = SiblingResolver(person_repo, year=2025)
        parsed = _make_parsed_request()
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result[0].confidence == 0.95
