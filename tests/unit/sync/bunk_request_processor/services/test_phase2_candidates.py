"""Tests for Phase2ResolutionService._generate_disambiguation_candidates.

Tests the expanded candidate generation that handles three name patterns:
1. Single-word names (first name lookup + nickname expansion)
2. Multi-word names (extract first name for lookup)
3. Family/household references (last name lookup)
"""

from __future__ import annotations

from unittest.mock import Mock, patch

from bunking.sync.bunk_request_processor.core.models import (
    AgePreference,
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
    Phase2ResolutionService,
    ResolutionCase,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _person(cm_id: int, first_name: str = "Test", last_name: str = "Person") -> Person:
    return Person(cm_id=cm_id, first_name=first_name, last_name=last_name)


def _parse_request(year: int = 2025, session_cm_id: int = 1000002) -> ParseRequest:
    return ParseRequest(
        request_text="placeholder",
        field_name="share_bunk_with",
        requester_name="Test Requester",
        requester_cm_id=11111,
        requester_grade="5",
        session_cm_id=session_cm_id,
        session_name="Session 2",
        year=year,
        row_data={},
    )


def _parsed_request(
    target_name: str = "Lily",
    request_type: RequestType = RequestType.BUNK_WITH,
    age_preference: AgePreference | None = None,
) -> ParsedRequest:
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}",
        request_type=request_type,
        target_name=target_name,
        age_preference=age_preference,
        source_field="bunk_with",
        source=RequestSource.FAMILY,
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


def _unresolved_result() -> ResolutionResult:
    """An unresolved, non-ambiguous result (no person, no candidates)."""
    return ResolutionResult(person=None, confidence=0.0, method="unknown")


def _resolved_result(cm_id: int = 99999) -> ResolutionResult:
    """A resolved result (has person)."""
    return ResolutionResult(
        person=_person(cm_id),
        confidence=0.95,
        method="exact_match",
    )


def _age_preference_result() -> ResolutionResult:
    """An age_preference result that should be skipped."""
    return ResolutionResult(person=None, confidence=0.5, method="age_preference")


def _ambiguous_result() -> ResolutionResult:
    """An already-ambiguous result."""
    return ResolutionResult(
        person=None,
        confidence=0.3,
        method="fuzzy",
        candidates=[_person(1), _person(2)],
    )


def _make_case(
    target_names: list[str],
    results: list[ResolutionResult] | None = None,
    year: int = 2025,
    request_types: list[RequestType] | None = None,
) -> ResolutionCase:
    """Build a ResolutionCase with the given targets and pre-set resolution results."""
    if request_types is None:
        request_types = [RequestType.BUNK_WITH] * len(target_names)

    parsed_requests = [
        _parsed_request(target_name=name, request_type=rt) for name, rt in zip(target_names, request_types, strict=True)
    ]
    parse_result = ParseResult(
        parsed_requests=parsed_requests,
        is_valid=True,
        parse_request=_parse_request(year=year),
    )
    case = ResolutionCase(parse_result)

    # Override resolution_results (normally populated by resolve_cases)
    if results is not None:
        case.resolution_results = list(results)
    else:
        case.resolution_results = [_unresolved_result() for _ in target_names]

    return case


def _service(person_repo: Mock | None = None) -> Phase2ResolutionService:
    """Build a minimal Phase2ResolutionService with a mocked pipeline."""
    pipeline = Mock()
    return Phase2ResolutionService(
        resolution_pipeline=pipeline,
        person_repository=person_repo,
    )


# ---------------------------------------------------------------------------
# Tests: Single-word name — first name lookup
# ---------------------------------------------------------------------------


class TestSingleWordCandidates:
    """Single-word target → first-name + nickname-expanded lookup."""

    def test_generates_candidates_via_first_name(self):
        """Single word 'Lily' generates candidates from find_by_first_name."""
        repo = Mock()
        lily1 = _person(101, "Lily", "Adams")
        lily2 = _person(102, "Lily", "Baker")
        repo.find_by_first_name.return_value = [lily1, lily2]
        repo.find_by_last_name.return_value = []

        case = _make_case(["Lily"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        assert result.method == "disambiguation_candidates"
        assert result.candidates is not None
        assert len(result.candidates) == 2
        candidate_ids = {c.cm_id for c in result.candidates}
        assert candidate_ids == {101, 102}

    def test_nickname_expansion_adds_candidates(self):
        """Single word 'Liz' expands via nicknames to find Elizabeth etc."""
        repo = Mock()
        liz = _person(201, "Liz", "Chen")
        elizabeth = _person(202, "Elizabeth", "Davis")

        def first_name_side_effect(name, year=None):
            lookup = {
                "Liz": [liz],
                "elizabeth": [elizabeth],
                "beth": [],
                "lizzie": [],
            }
            return lookup.get(name, [])

        repo.find_by_first_name.side_effect = first_name_side_effect
        repo.find_by_last_name.return_value = []

        case = _make_case(["Liz"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=["elizabeth", "beth", "lizzie"],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        assert result.method == "disambiguation_candidates"
        assert result.candidates is not None
        candidate_ids = {c.cm_id for c in result.candidates}
        assert candidate_ids == {201, 202}


# ---------------------------------------------------------------------------
# Tests: Multi-word name — extract first name
# ---------------------------------------------------------------------------


class TestMultiWordCandidates:
    """Multi-word target (no family markers) → extract first word for lookup."""

    def test_multi_word_extracts_first_name(self):
        """'Lizzy Diamond' extracts 'Lizzy' for first-name lookup."""
        repo = Mock()
        lizzy1 = _person(301, "Lizzy", "Diamond")
        lizzy2 = _person(302, "Lizzy", "Fox")

        repo.find_by_first_name.return_value = [lizzy1, lizzy2]
        repo.find_by_last_name.return_value = []

        case = _make_case(["Lizzy Diamond"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        assert result.method == "disambiguation_candidates"
        assert result.candidates is not None
        candidate_ids = {c.cm_id for c in result.candidates}
        assert candidate_ids == {301, 302}


# ---------------------------------------------------------------------------
# Tests: Family/household references — last name lookup
# ---------------------------------------------------------------------------


class TestFamilyReferenceCandidates:
    """Family references → extract last name tokens → find_by_last_name."""

    def test_slash_separated_families(self):
        """'Burke/Kurlaender families' → last-name lookup for Burke and Kurlaender."""
        repo = Mock()
        burke1 = _person(401, "Anna", "Burke")
        kurl1 = _person(402, "Max", "Kurlaender")

        def last_name_side_effect(name, year=None):
            lookup = {"Burke": [burke1], "Kurlaender": [kurl1]}
            return lookup.get(name, [])

        repo.find_by_last_name.side_effect = last_name_side_effect
        repo.find_by_first_name.return_value = []

        case = _make_case(["Burke/Kurlaender families"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        assert result.method == "disambiguation_candidates"
        assert result.candidates is not None
        candidate_ids = {c.cm_id for c in result.candidates}
        assert candidate_ids == {401, 402}

    def test_and_separated_names(self):
        """'Lizzy Diamond and Harper' → last word of each part → last name lookup."""
        repo = Mock()
        diamond1 = _person(501, "Lizzy", "Diamond")
        harper1 = _person(502, "Sam", "Harper")

        def last_name_side_effect(name, year=None):
            lookup = {"Diamond": [diamond1], "Harper": [harper1]}
            return lookup.get(name, [])

        repo.find_by_last_name.side_effect = last_name_side_effect
        repo.find_by_first_name.return_value = []

        case = _make_case(["Lizzy Diamond and Harper"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        assert result.method == "disambiguation_candidates"
        assert result.candidates is not None
        candidate_ids = {c.cm_id for c in result.candidates}
        assert candidate_ids == {501, 502}


# ---------------------------------------------------------------------------
# Tests: Candidate cap and filtering
# ---------------------------------------------------------------------------


class TestCandidateCapAndFiltering:
    """Deduplication, cap at 10, skip resolved/age_preference."""

    def test_caps_at_10_candidates(self):
        """More than 10 candidates should be capped to 10."""
        repo = Mock()
        many_persons = [_person(600 + i, "Lily", f"Last{i}") for i in range(15)]
        repo.find_by_first_name.return_value = many_persons
        repo.find_by_last_name.return_value = []

        case = _make_case(["Lily"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        assert result.candidates is not None
        assert len(result.candidates) == 10

    def test_skips_already_resolved(self):
        """Already-resolved results should not be overwritten."""
        repo = Mock()
        repo.find_by_first_name.return_value = [_person(701, "Sarah", "Jones")]
        repo.find_by_last_name.return_value = []

        resolved = _resolved_result(cm_id=999)
        case = _make_case(["Sarah"], results=[resolved])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        # Should remain unchanged
        assert case.resolution_results[0] is not None
        assert case.resolution_results[0].is_resolved
        assert case.resolution_results[0].person is not None
        assert case.resolution_results[0].person.cm_id == 999

    def test_skips_already_ambiguous(self):
        """Already-ambiguous results should not be overwritten."""
        repo = Mock()
        repo.find_by_first_name.return_value = [_person(801)]
        repo.find_by_last_name.return_value = []

        ambiguous = _ambiguous_result()
        case = _make_case(["Test"], results=[ambiguous])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        assert case.resolution_results[0] is not None
        assert case.resolution_results[0].method == "fuzzy"

    def test_skips_age_preference_results(self):
        """Results with method='age_preference' should be skipped."""
        repo = Mock()
        repo.find_by_first_name.return_value = [_person(901)]
        repo.find_by_last_name.return_value = []

        age_result = _age_preference_result()
        case = _make_case(["Older"], results=[age_result])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        # Should remain unchanged — age_preference result not overwritten
        assert case.resolution_results[0] is not None
        assert case.resolution_results[0].method == "age_preference"

    def test_skips_staff_filtered_results(self):
        """Results with method='staff_filtered' should be skipped — not overwritten by candidate generation."""
        repo = Mock()
        repo.find_by_first_name.return_value = [_person(901)]
        repo.find_by_last_name.return_value = []

        staff_result = ResolutionResult(person=None, confidence=0.0, method="staff_filtered")
        case = _make_case(["Coach"], results=[staff_result])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        # Should remain unchanged — staff_filtered result not overwritten
        assert case.resolution_results[0] is not None
        assert case.resolution_results[0].method == "staff_filtered"

    def test_no_session_filter_attendee_repo_not_called(self):
        """Candidate generation must NOT use attendee_repository for session filtering."""
        person_repo = Mock()
        person_repo.find_by_first_name.return_value = [_person(1001, "Lily", "Test")]
        person_repo.find_by_last_name.return_value = []

        attendee_repo = Mock()

        pipeline = Mock()
        svc = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            person_repository=person_repo,
            attendee_repository=attendee_repo,
        )

        case = _make_case(["Lily"])

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=[],
        ):
            svc._generate_disambiguation_candidates([case])

        # attendee_repository should NOT be called at all
        attendee_repo.bulk_get_sessions_for_persons.assert_not_called()

    def test_deduplicates_candidates_by_cm_id(self):
        """Same person found by first name and nickname should appear once."""
        repo = Mock()
        lily = _person(1101, "Lily", "Adams")

        # Both direct and nickname lookup return the same person
        repo.find_by_first_name.return_value = [lily]
        repo.find_by_last_name.return_value = []

        case = _make_case(["Lily"])
        svc = _service(person_repo=repo)

        with patch(
            "bunking.sync.bunk_request_processor.services.phase2_resolution_service.find_nickname_variations",
            return_value=["lillian"],
        ):
            svc._generate_disambiguation_candidates([case])

        result = case.resolution_results[0]
        assert result is not None
        # Even though find_by_first_name is called twice (Lily + lillian),
        # same cm_id should only appear once
        assert result.candidates is not None
        cm_ids = [c.cm_id for c in result.candidates]
        assert cm_ids.count(1101) == 1

    def test_no_person_repository_returns_early(self):
        """Without a person_repository, nothing happens."""
        case = _make_case(["Lily"])
        svc = _service(person_repo=None)
        svc._generate_disambiguation_candidates([case])

        # Result should remain the original unresolved result
        assert case.resolution_results[0] is not None
        assert case.resolution_results[0].method == "unknown"
