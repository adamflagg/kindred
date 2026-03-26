"""Tests for GroupResolver protocol, ResolvedGroupMember, and resolver implementations.

Tests define the expected behavior for expanding group references
(siblings, bunkmates, classmates, congregation) into individual requests."""

from unittest.mock import MagicMock

from bunking.sync.bunk_request_processor.core.models import (
    Camper,
    Gender,
    GroupKind,
    ParsedRequest,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.group_resolvers import (
    BunkmateResolver,
    ClassmateResolver,
    CongregationResolver,
    ResolvedGroupMember,
    SiblingResolver,
    build_resolver_registry,
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


def _make_camper(
    cm_id: int,
    first_name: str = "Emma",
    last_name: str = "Johnson",
    gender: Gender = Gender.FEMALE,
    grade: int = 5,
    school: str | None = "Riverside Elementary",
    session_cm_id: int | None = None,
    **kwargs,
) -> Camper:
    """Helper to create a Camper with sensible defaults."""
    return Camper(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        grade=grade,
        school=school,
        session_cm_id=session_cm_id,
        **kwargs,
    )


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


class TestBunkmateResolver:
    """Test the BunkmateResolver."""

    def test_base_confidence(self):
        """BunkmateResolver.base_confidence should be 0.90."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        assert resolver.base_confidence == 0.90

    def test_resolve_finds_bunkmates(self):
        """BunkmateResolver should return prior year bunkmates who are resolved persons."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()

        # find_prior_year_bunkmates returns dict with cm_ids, prior_bunk, prior_year
        attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [3001, 3002],
            "prior_bunk": "Cabin 7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 2,
        }

        bunkmate1 = _make_person(3001, "Ava", "Williams")
        bunkmate2 = _make_person(3002, "Sophia", "Martinez")
        person_repo.find_by_cm_id.side_effect = lambda cm_id: {3001: bunkmate1, 3002: bunkmate2}.get(cm_id)

        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 2
        assert result[0].person == bunkmate1
        assert result[1].person == bunkmate2
        attendee_repo.find_prior_year_bunkmates.assert_called_once_with(1001, 5000, 2025)

    def test_resolve_empty_when_no_prior_bunkmates(self):
        """BunkmateResolver should return empty list when no prior year data."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        attendee_repo.find_prior_year_bunkmates.return_value = {}

        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result == []

    def test_resolve_skips_unresolvable_bunkmates(self):
        """BunkmateResolver should skip cm_ids that don't resolve to a Person."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()

        attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [3001, 3002, 3003],
            "prior_bunk": "Cabin 7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 3,
        }

        bunkmate1 = _make_person(3001, "Ava", "Williams")
        # 3002 returns None (unresolvable)
        bunkmate3 = _make_person(3003, "Isabella", "Brown")
        person_repo.find_by_cm_id.side_effect = lambda cm_id: {3001: bunkmate1, 3003: bunkmate3}.get(cm_id)

        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 2
        assert result[0].person == bunkmate1
        assert result[1].person == bunkmate3

    def test_resolve_sets_bunkmate_metadata(self):
        """BunkmateResolver should set metadata with expanded_from, prior_bunk, prior_year."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()

        attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [3001],
            "prior_bunk": "Cabin 7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 1,
        }

        bunkmate = _make_person(3001, "Ava", "Williams")
        person_repo.find_by_cm_id.return_value = bunkmate

        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 1
        assert result[0].metadata["expanded_from"] == "last_year_bunkmates"
        assert result[0].metadata["prior_bunk"] == "Cabin 7"
        assert result[0].metadata["prior_year"] == 2024

    def test_resolve_always_bunk_with(self):
        """BunkmateResolver should always produce BUNK_WITH requests."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()

        attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [3001],
            "prior_bunk": "Cabin 7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 1,
        }

        bunkmate = _make_person(3001, "Ava", "Williams")
        person_repo.find_by_cm_id.return_value = bunkmate

        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result[0].request_type == RequestType.BUNK_WITH

    def test_resolve_uses_base_confidence(self):
        """BunkmateResolver should use base_confidence of 0.90."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()

        attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [3001],
            "prior_bunk": "Cabin 7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 1,
        }

        bunkmate = _make_person(3001, "Ava", "Williams")
        person_repo.find_by_cm_id.return_value = bunkmate

        resolver = BunkmateResolver(attendee_repo, person_repo, year=2025)
        parsed = _make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result[0].confidence == 0.90


class TestClassmateResolver:
    """Test the ClassmateResolver.

    ClassmateResolver finds campers at the same school, in the same session,
    within +-1 grade, matching gender, excluding self.
    """

    def _setup_resolver(self, requester, session_peers):
        """Set up mocked repos and resolver.

        Args:
            requester: The Camper making the request
            session_peers: List of Camper objects in the session

        Returns:
            (resolver, person_repo, attendee_repo)
        """
        person_repo = MagicMock()
        attendee_repo = MagicMock()

        # person_repo.find_by_cm_id returns the requester
        person_repo.find_by_cm_id.side_effect = lambda cm_id: (
            requester if cm_id == requester.cm_id else next((p for p in session_peers if p.cm_id == cm_id), None)
        )

        # attendee_repo.get_session_attendees returns dicts for all session members
        all_members = [requester] + session_peers
        attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": m.cm_id, "session_cm_id": 5000} for m in all_members
        ]

        # person_repo.bulk_find_by_cm_ids returns all members as dict
        persons_dict = {m.cm_id: m for m in all_members}
        person_repo.bulk_find_by_cm_ids.return_value = persons_dict

        resolver = ClassmateResolver(person_repo, attendee_repo, year=2025)
        return resolver, person_repo, attendee_repo

    def test_base_confidence(self):
        """ClassmateResolver.base_confidence should be 0.85."""
        person_repo = MagicMock()
        attendee_repo = MagicMock()
        resolver = ClassmateResolver(person_repo, attendee_repo, year=2025)
        assert resolver.base_confidence == 0.85

    def test_finds_same_school_session_grade_gender(self):
        """Should find campers with same school, session, similar grade, same gender."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")
        peer = _make_camper(2001, "Olivia", "Chen", Gender.FEMALE, grade=5, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 1
        assert result[0].person.cm_id == 2001

    def test_excludes_different_school(self):
        """Should exclude campers from a different school."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")
        peer = _make_camper(2001, "Olivia", "Chen", Gender.FEMALE, grade=5, school="Oak Valley Middle")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_excludes_different_gender(self):
        """Should exclude campers of different gender."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")
        peer = _make_camper(2001, "Liam", "Garcia", Gender.MALE, grade=5, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_excludes_grade_difference_of_2(self):
        """Should exclude campers with grade difference >= 2."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")
        peer = _make_camper(2001, "Olivia", "Chen", Gender.FEMALE, grade=7, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_includes_adjacent_grade(self):
        """Should include campers with grade difference of exactly 1."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")
        peer = _make_camper(2001, "Olivia", "Chen", Gender.FEMALE, grade=6, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 1
        assert result[0].person.cm_id == 2001

    def test_excludes_self(self):
        """Should never include the requester themselves."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_empty_when_no_school_data(self):
        """Should return empty list when requester has no school."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school=None)
        peer = _make_camper(2001, "Olivia", "Chen", Gender.FEMALE, grade=5, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_sets_classmate_metadata(self):
        """Should set metadata with expanded_from=classmates."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5, school="Riverside Elementary")
        peer = _make_camper(2001, "Olivia", "Chen", Gender.FEMALE, grade=5, school="Riverside Elementary")

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CLASSMATES)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result[0].metadata["expanded_from"] == "classmates"


class TestCongregationResolver:
    """Test the CongregationResolver.

    CongregationResolver finds campers in the same congregation, in the same session,
    within +-1 grade, matching gender, excluding self. Congregation data comes from
    person.metadata['normalized_congregation'].
    """

    def _setup_resolver(self, requester, session_peers):
        """Set up mocked repos and resolver."""
        person_repo = MagicMock()
        attendee_repo = MagicMock()

        person_repo.find_by_cm_id.side_effect = lambda cm_id: (
            requester if cm_id == requester.cm_id else next((p for p in session_peers if p.cm_id == cm_id), None)
        )

        all_members = [requester] + session_peers
        attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": m.cm_id, "session_cm_id": 5000} for m in all_members
        ]

        persons_dict = {m.cm_id: m for m in all_members}
        person_repo.bulk_find_by_cm_ids.return_value = persons_dict

        resolver = CongregationResolver(person_repo, attendee_repo, year=2025)
        return resolver, person_repo, attendee_repo

    def test_base_confidence(self):
        """CongregationResolver.base_confidence should be 0.85."""
        person_repo = MagicMock()
        attendee_repo = MagicMock()
        resolver = CongregationResolver(person_repo, attendee_repo, year=2025)
        assert resolver.base_confidence == 0.85

    def test_finds_same_congregation(self):
        """Should find campers with same congregation, session, similar grade, same gender."""
        requester = _make_camper(
            1001,
            "Emma",
            "Johnson",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )
        peer = _make_camper(
            2001,
            "Olivia",
            "Chen",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CONGREGATION)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 1
        assert result[0].person.cm_id == 2001

    def test_excludes_different_congregation(self):
        """Should exclude campers from a different congregation."""
        requester = _make_camper(
            1001,
            "Emma",
            "Johnson",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )
        peer = _make_camper(
            2001,
            "Olivia",
            "Chen",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Congregation Shalom"},
        )

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CONGREGATION)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_empty_when_no_congregation_data(self):
        """Should return empty list when requester has no congregation."""
        requester = _make_camper(1001, "Emma", "Johnson", Gender.FEMALE, grade=5)
        peer = _make_camper(
            2001,
            "Olivia",
            "Chen",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CONGREGATION)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_excludes_different_gender(self):
        """Should exclude campers of different gender."""
        requester = _make_camper(
            1001,
            "Emma",
            "Johnson",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )
        peer = _make_camper(
            2001,
            "Liam",
            "Garcia",
            Gender.MALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CONGREGATION)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_excludes_grade_difference_of_2(self):
        """Should exclude campers with grade difference >= 2."""
        requester = _make_camper(
            1001,
            "Emma",
            "Johnson",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )
        peer = _make_camper(
            2001,
            "Olivia",
            "Chen",
            Gender.FEMALE,
            grade=7,
            metadata={"normalized_congregation": "Temple Beth El"},
        )

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CONGREGATION)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert len(result) == 0

    def test_sets_congregation_metadata(self):
        """Should set metadata with expanded_from=congregation."""
        requester = _make_camper(
            1001,
            "Emma",
            "Johnson",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )
        peer = _make_camper(
            2001,
            "Olivia",
            "Chen",
            Gender.FEMALE,
            grade=5,
            metadata={"normalized_congregation": "Temple Beth El"},
        )

        resolver, _, _ = self._setup_resolver(requester, [peer])
        parsed = _make_parsed_request(group_kind=GroupKind.CONGREGATION)
        result = resolver.resolve(requester_cm_id=1001, parsed_request=parsed, session_cm_id=5000)

        assert result[0].metadata["expanded_from"] == "congregation"


class TestBuildResolverRegistry:
    """Test the build_resolver_registry factory function."""

    def test_returns_all_four_group_kinds(self):
        """Registry should contain all four GroupKind keys."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        registry = build_resolver_registry(attendee_repo, person_repo, year=2025)

        assert set(registry.keys()) == {
            GroupKind.SIBLING,
            GroupKind.LAST_YEAR_BUNKMATES,
            GroupKind.CLASSMATES,
            GroupKind.CONGREGATION,
        }

    def test_sibling_resolver_type(self):
        """SIBLING key should map to SiblingResolver."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        registry = build_resolver_registry(attendee_repo, person_repo, year=2025)
        assert isinstance(registry[GroupKind.SIBLING], SiblingResolver)

    def test_bunkmate_resolver_type(self):
        """LAST_YEAR_BUNKMATES key should map to BunkmateResolver."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        registry = build_resolver_registry(attendee_repo, person_repo, year=2025)
        assert isinstance(registry[GroupKind.LAST_YEAR_BUNKMATES], BunkmateResolver)

    def test_classmate_resolver_type(self):
        """CLASSMATES key should map to ClassmateResolver."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        registry = build_resolver_registry(attendee_repo, person_repo, year=2025)
        assert isinstance(registry[GroupKind.CLASSMATES], ClassmateResolver)

    def test_congregation_resolver_type(self):
        """CONGREGATION key should map to CongregationResolver."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        registry = build_resolver_registry(attendee_repo, person_repo, year=2025)
        assert isinstance(registry[GroupKind.CONGREGATION], CongregationResolver)

    def test_registry_has_exactly_four_entries(self):
        """Registry should have exactly 4 entries (one per GroupKind)."""
        attendee_repo = MagicMock()
        person_repo = MagicMock()
        registry = build_resolver_registry(attendee_repo, person_repo, year=2025)
        assert len(registry) == 4
