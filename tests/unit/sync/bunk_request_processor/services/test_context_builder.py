"""Tests for ContextBuilder

Tests cover:
1. Parse context (Phase 1)
2. Disambiguation context (Phase 3)
3. Historical context
4. Helper methods"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.integration.ai_service import AIRequestContext
from bunking.sync.bunk_request_processor.services.context_builder import ContextBuilder


def _create_person(
    cm_id: int = 12345,
    first_name: str = "Sarah",
    last_name: str = "Smith",
    grade: int | None = 5,
    school: str = "Lincoln Elementary",
    preferred_name: str | None = None,
    birth_date: datetime | None = None,
    parent_names: str | None = None,
) -> Person:
    """Helper to create Person objects"""
    # Default birth date if not provided
    if birth_date is None:
        birth_date = datetime(2015, 6, 15)
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=grade,
        school=school,
        preferred_name=preferred_name,
        birth_date=birth_date,
        parent_names=parent_names,
    )


class TestContextBuilderParseOnlyContext:
    """Tests for build_parse_only_context method (Phase 1)"""

    def test_build_parse_only_context_sets_parse_only_flag(self):
        """Context should have parse_only=True for Phase 1"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        assert context.parse_only is True
        assert context.additional_context.get("parse_only") is True

    def test_build_parse_only_context_includes_requester_info(self):
        """Context should include requester information"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        assert context.requester_name == "John Doe"
        assert context.requester_cm_id == 11111
        assert context.additional_context.get("requester_grade") == "5"

    def test_build_parse_only_context_includes_session(self):
        """Context should include session information"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        assert context.session_cm_id == 1000002
        assert context.additional_context.get("session_name") == "Session 2"
        assert context.year == 2025

    def test_build_parse_only_context_includes_field_name(self):
        """Context should include the field being processed"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        assert context.additional_context.get("field_type") == "share_bunk_with"
        assert context.additional_context.get("csv_source_field") == "share_bunk_with"

    def test_build_parse_only_context_prevents_self_reference(self):
        """Context should include requester ID to prevent self-reference"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        # V1: NEVER_USE_AS_TARGET prevents matching requester to themselves
        assert context.additional_context.get("NEVER_USE_AS_TARGET") == 11111

    def test_build_parse_only_context_with_additional_data(self):
        """Additional data should be merged into context"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
            additional_data={"custom_flag": True, "extra_info": "test"},
        )

        assert context.additional_context.get("custom_flag") is True
        assert context.additional_context.get("extra_info") == "test"

    def test_build_parse_only_context_returns_ai_request_context(self):
        """Should return AIRequestContext instance"""
        builder = ContextBuilder()
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        assert isinstance(context, AIRequestContext)


class TestContextBuilderDisambiguationContext:
    """Tests for build_disambiguation_context method (Phase 3)"""

    def test_build_disambiguation_context_sets_disambiguation_mode(self):
        """Context should have disambiguation_mode=True for Phase 3"""
        builder = ContextBuilder()
        candidates = [_create_person(cm_id=111), _create_person(cm_id=222)]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school="Lincoln Elementary",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        assert context.additional_context.get("disambiguation_mode") is True
        assert context.additional_context.get("parse_only") is False

    def test_build_disambiguation_context_limits_candidates(self):
        """Context should limit to top 5 candidates"""
        builder = ContextBuilder()
        # Create 7 candidates
        candidates = [_create_person(cm_id=100 + i) for i in range(7)]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school="Lincoln Elementary",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        assert len(candidates_data) == 5

    def test_build_disambiguation_context_includes_candidate_details(self):
        """Candidate data should include relevant details"""
        builder = ContextBuilder()
        candidate = _create_person(
            cm_id=111,
            first_name="Sarah",
            last_name="Smith",
            grade=5,
            school="Lincoln Elementary",
        )

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=[candidate],
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school="Lincoln Elementary",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        assert len(candidates_data) == 1
        assert candidates_data[0]["person_id"] == 111
        assert candidates_data[0]["name"] == "Sarah Smith"
        assert candidates_data[0]["grade"] == 5
        assert candidates_data[0]["school"] == "Lincoln Elementary"

    def test_build_disambiguation_context_includes_ambiguity_reason(self):
        """Context should include reason for ambiguity"""
        builder = ContextBuilder()
        candidates = [_create_person()]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school="Lincoln Elementary",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Same name, different schools",
            local_confidence=0.5,
        )

        assert context.additional_context.get("ambiguity_reason") == "Same name, different schools"
        assert context.additional_context.get("local_confidence") == 0.5

    def test_build_disambiguation_context_includes_social_hints(self):
        """Context includes social signals if present in candidate metadata"""
        builder = ContextBuilder()
        candidate = _create_person(cm_id=111)
        # Add social metadata
        candidate.metadata = {
            "social_distance": 2,
            "mutual_connections": 3,
            "found_by": "exact_match",
            "in_same_session": True,
        }

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=[candidate],
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        assert candidates_data[0].get("social_distance") == 2
        assert candidates_data[0].get("mutual_connections") == 3
        assert candidates_data[0].get("found_by") == "exact_match"
        assert candidates_data[0].get("in_same_session") is True

    def test_build_disambiguation_context_handles_needs_historical(self):
        """Context includes historical flag when needed"""
        builder = ContextBuilder()
        candidates = [_create_person()]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Historical reference",
            local_confidence=0.5,
            needs_historical=True,
        )

        assert context.additional_context.get("needs_historical_context") is True


class TestContextBuilderHistoricalContext:
    """Tests for build_historical_context method"""

    def test_build_historical_context_includes_previous_year(self):
        """Historical context includes previous year"""
        builder = ContextBuilder()
        previous_attendees: list[dict[str, Any]] = []

        context = builder.build_historical_context(
            requester_cm_id=11111,
            target_name="Sarah Smith",
            session_name="Session 2",
            previous_year=2024,
            previous_attendees=previous_attendees,
        )

        assert context["previous_year"] == 2024
        assert context["session_name"] == "Session 2"

    def test_build_historical_context_filters_attendees(self):
        """Historical context filters to relevant attendees only"""
        builder = ContextBuilder()
        attendees = [
            {"person_id": 100, "first_name": "Sarah", "last_name": "Smith"},
            {"person_id": 101, "first_name": "Jane", "last_name": "Doe"},
            {"person_id": 102, "first_name": "John", "last_name": "Adams"},
        ]

        context = builder.build_historical_context(
            requester_cm_id=11111,
            target_name="Sarah Smith",
            session_name="Session 2",
            previous_year=2024,
            previous_attendees=attendees,
        )

        # Should only include Sarah (name match)
        relevant = context["previous_year_attendees"]
        assert len(relevant) == 1
        assert relevant[0]["first_name"] == "Sarah"

    def test_build_historical_context_excludes_requester(self):
        """Historical context excludes the requester themselves"""
        builder = ContextBuilder()
        attendees = [
            {"person_id": 11111, "first_name": "Self", "last_name": "Reference"},
            {"person_id": 100, "first_name": "Sarah", "last_name": "Smith"},
        ]

        context = builder.build_historical_context(
            requester_cm_id=11111,
            target_name="Sarah Smith",
            session_name="Session 2",
            previous_year=2024,
            previous_attendees=attendees,
        )

        # Should exclude self (person_id 11111)
        relevant = context["previous_year_attendees"]
        for attendee in relevant:
            assert attendee["person_id"] != 11111

    def test_build_historical_context_handles_last_year_bunkmates(self):
        """Special handling for generic 'last year bunkmates' request"""
        builder = ContextBuilder()
        attendees = [
            {"person_id": 100, "first_name": "Sarah", "last_name": "Smith", "was_bunkmate": True},
            {"person_id": 101, "first_name": "Jane", "last_name": "Doe", "was_bunkmate": False},
            {"person_id": 102, "first_name": "Alice", "last_name": "Brown", "was_bunkmate": True},
        ]

        context = builder.build_historical_context(
            requester_cm_id=11111,
            target_name="LAST_YEAR_BUNKMATES",
            session_name="Session 2",
            previous_year=2024,
            previous_attendees=attendees,
        )

        # Should only include bunkmates
        relevant = context["previous_year_attendees"]
        assert len(relevant) == 2
        for attendee in relevant:
            assert attendee["was_bunkmate"] is True

    def test_build_historical_context_limits_results(self):
        """Historical context limits to 20 attendees"""
        builder = ContextBuilder()
        # Create 25 attendees with matching names
        attendees = [{"person_id": 100 + i, "first_name": "Sarah", "last_name": f"Smith{i}"} for i in range(25)]

        context = builder.build_historical_context(
            requester_cm_id=11111,
            target_name="Sarah Smith",
            session_name="Session 2",
            previous_year=2024,
            previous_attendees=attendees,
        )

        relevant = context["previous_year_attendees"]
        assert len(relevant) <= 20


class TestContextBuilderHelperMethods:
    """Tests for helper methods"""

    def test_format_candidates_includes_person_id(self):
        """Candidate formatting includes person_id"""
        builder = ContextBuilder()
        candidate = _create_person(cm_id=12345)

        formatted = builder._format_candidates([candidate])

        assert len(formatted) == 1
        assert formatted[0]["person_id"] == 12345

    def test_format_candidates_combines_name(self):
        """Candidate formatting combines first and last name"""
        builder = ContextBuilder()
        candidate = _create_person(first_name="Sarah", last_name="Smith")

        formatted = builder._format_candidates([candidate])

        assert formatted[0]["name"] == "Sarah Smith"

    def test_format_candidates_includes_school(self):
        """Candidate formatting includes school"""
        builder = ContextBuilder()
        candidate = _create_person(school="Lincoln Elementary")

        formatted = builder._format_candidates([candidate])

        assert formatted[0]["school"] == "Lincoln Elementary"

    def test_format_candidates_includes_parent_names(self):
        """Candidate formatting includes parent names when available"""
        import json

        builder = ContextBuilder()
        parent_data = [
            {"first": "David", "last": "Katz", "relationship": "Father", "is_primary": True},
            {"first": "Sarah", "last": "Cohen", "relationship": "Mother", "is_primary": False},
        ]
        candidate = _create_person(
            first_name="Emma",
            last_name="Katz",
            parent_names=json.dumps(parent_data),
        )

        formatted = builder._format_candidates([candidate])

        assert formatted[0]["name"] == "Emma Katz"
        assert "parents" in formatted[0]
        # Should be formatted as "Father: David Katz, Mother: Sarah Cohen"
        assert "David Katz" in formatted[0]["parents"]
        assert "Sarah Cohen" in formatted[0]["parents"]
        assert "Father" in formatted[0]["parents"]
        assert "Mother" in formatted[0]["parents"]

    def test_format_candidates_omits_parents_when_not_available(self):
        """Candidate formatting omits parents field when no parent data exists"""
        builder = ContextBuilder()
        candidate = _create_person(
            first_name="Emma",
            last_name="Smith",
            parent_names=None,  # No parent data
        )

        formatted = builder._format_candidates([candidate])

        assert formatted[0]["name"] == "Emma Smith"
        # Should NOT have parents key when no parent data
        assert "parents" not in formatted[0]

    def test_format_candidates_handles_empty_parent_names(self):
        """Candidate formatting handles empty parent_names string"""
        builder = ContextBuilder()
        candidate = _create_person(
            first_name="Emma",
            last_name="Smith",
            parent_names="[]",  # Empty JSON array
        )

        formatted = builder._format_candidates([candidate])

        # Should NOT have parents key when parent list is empty
        assert "parents" not in formatted[0]

    def test_calculate_age_from_birthdate(self):
        """Age calculation from birth date"""
        builder = ContextBuilder()

        # Test with a known birth date
        age = builder._calculate_age("2015-06-15")

        # Should be around 9-10 depending on current date
        assert age is not None
        assert 8 <= age <= 12

    def test_calculate_age_handles_invalid_date(self):
        """Age calculation handles invalid date gracefully"""
        builder = ContextBuilder()

        age = builder._calculate_age("invalid-date")

        assert age is None

    def test_calculate_age_handles_none(self):
        """Age calculation handles None input"""
        builder = ContextBuilder()

        age = builder._calculate_age(None)  # type: ignore[arg-type]

        assert age is None


# =============================================================================
# =============================================================================


class TestDisambiguationContextNeverUseAsTarget:
    """"""

    def test_disambiguation_context_includes_never_use_as_target(self):
        """
            "NEVER_USE_AS_TARGET": requester_cm_id,  # Critical: prevent self-references

        This prevents the AI from suggesting the requester as their own bunk target.
        """
        builder = ContextBuilder()
        candidates = [_create_person(cm_id=111)]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school="Lincoln Elementary",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        # Must include NEVER_USE_AS_TARGET with requester's CM ID
        assert context.additional_context.get("NEVER_USE_AS_TARGET") == 11111

    def test_never_use_as_target_matches_requester_cm_id(self):
        """NEVER_USE_AS_TARGET value must exactly match requester_cm_id"""
        builder = ContextBuilder()
        candidates = [_create_person()]

        # Test with different requester IDs
        for requester_id in [12345, 99999, 1]:
            context = builder.build_disambiguation_context(
                target_name="Test Name",
                candidates=candidates,
                requester_name="Requester",
                requester_cm_id=requester_id,
                requester_school=None,
                session_cm_id=1000002,
                session_name="Session 2",
                year=2025,
                ambiguity_reason="test",
                local_confidence=0.5,
            )
            assert context.additional_context.get("NEVER_USE_AS_TARGET") == requester_id


# =============================================================================
# =============================================================================


class TestDisambiguationContextNicknameMappings:
    """"""

    def test_disambiguation_context_includes_nickname_mappings_from_config(self):
        """
        if hasattr(self, 'config_service'):
            ai_config = self.config_service.get_ai_config()
            context["nickname_mappings"] = ai_config.get('name_matching', {}).get('common_nicknames', {})
        """
        # Create mock config service
        mock_config_service = Mock()
        mock_config_service.get_ai_config.return_value = {
            "name_matching": {
                "common_nicknames": {
                    "Michael": ["Mike", "Mikey"],
                    "Robert": ["Rob", "Bobby", "Bob"],
                }
            }
        }

        builder = ContextBuilder(config_service=mock_config_service)
        candidates = [_create_person()]

        context = builder.build_disambiguation_context(
            target_name="Mike Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        # Must include nickname_mappings from config
        nickname_mappings = context.additional_context.get("nickname_mappings")
        assert nickname_mappings is not None
        assert nickname_mappings == {
            "Michael": ["Mike", "Mikey"],
            "Robert": ["Rob", "Bobby", "Bob"],
        }

    def test_disambiguation_context_no_nickname_mappings_without_config(self):
        """Without config service, nickname_mappings should be empty or default"""
        builder = ContextBuilder()  # No config service
        candidates = [_create_person()]

        context = builder.build_disambiguation_context(
            target_name="Mike Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
        )

        # Without config, should have empty dict or None (not error)
        nickname_mappings = context.additional_context.get("nickname_mappings")
        assert nickname_mappings is None or nickname_mappings == {}


# =============================================================================
# =============================================================================


class TestAmbiguityTypeBasedCandidateSearch:
    """
    Monolith behavior:
    - 'multiple_matches' → use specific candidate_ids from metadata
    - 'first_name_only_or_unclear' → fresh phonetic search (up to 20)
    - Default → age-filtered session attendees fallback
    """

    def test_multiple_matches_uses_provided_candidates(self):
        """For 'multiple_matches', context should use the provided candidates."""
        builder = ContextBuilder()
        candidates = [
            _create_person(cm_id=111, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=222, first_name="Sarah", last_name="Jones"),
        ]

        context = builder.build_disambiguation_context(
            target_name="Sarah",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="multiple_matches: 2 in same session",
            local_confidence=0.5,
        )

        # Should use the provided candidates
        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        assert len(candidates_data) == 2
        assert candidates_data[0]["person_id"] == 111
        assert candidates_data[1]["person_id"] == 222

    def test_first_name_only_triggers_phonetic_search(self):
        """For 'first_name_only_or_unclear', context builder should perform
        fresh phonetic search instead of using provided candidates.

            elif ambiguity_reason == 'first_name_only_or_unclear':
                similar_attendees = self._get_phonetically_similar_attendees(...)
        """
        # Create mock repositories for phonetic search
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()

        # Mock get_session_attendees to return session peers
        mock_attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": 100, "first_name": "Sarah", "last_name": "Smith"},
            {"person_cm_id": 101, "first_name": "Sara", "last_name": "Jones"},  # Phonetically similar (sar = sar)
            {"person_cm_id": 102, "first_name": "Sarita", "last_name": "Brown"},  # Phonetically similar (sar = sar)
            {"person_cm_id": 103, "first_name": "John", "last_name": "Doe"},  # Not similar
            {"person_cm_id": 104, "first_name": "Zara", "last_name": "White"},  # Not similar (zar != sar)
        ]

        # Mock person lookups - bulk_find_by_cm_ids returns a dict
        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            100: _create_person(cm_id=100, first_name="Sarah", last_name="Smith"),
            101: _create_person(cm_id=101, first_name="Sara", last_name="Jones"),
            102: _create_person(cm_id=102, first_name="Sarita", last_name="Brown"),
            103: _create_person(cm_id=103, first_name="John", last_name="Doe"),
            104: _create_person(cm_id=104, first_name="Zara", last_name="White"),
        }

        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
        )

        context = builder.build_disambiguation_context(
            target_name="Sarah",
            candidates=[],  # Empty - should trigger search
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="first_name_only_or_unclear",
            local_confidence=0.3,
        )

        # Should have searched for phonetically similar attendees
        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        # Should include Sarah, Sara, Sarita but NOT John or Zara
        person_ids = [c["person_id"] for c in candidates_data]
        assert 100 in person_ids  # Sarah - exact match
        assert 101 in person_ids  # Sara - first 3 letters match ("sar")
        assert 102 in person_ids  # Sarita - first 3 letters match ("sar")
        assert 103 not in person_ids  # John - not similar
        assert 104 not in person_ids  # Zara - not similar ("zar" != "sar")

    def test_default_ambiguity_uses_age_filtered_context(self):
        """For default/other ambiguity reasons, context should use age-filtered
        session attendees as fallback.

            else:
                context["current_year_attendees"] = self.get_age_filtered_context(requester_cm_id)
        """
        mock_attendee_repo = Mock()

        # Mock age-filtered peers
        mock_attendee_repo.get_age_filtered_session_peers.return_value = [
            _create_person(cm_id=200, first_name="Emma", last_name="Wilson"),
            _create_person(cm_id=201, first_name="Olivia", last_name="Brown"),
        ]

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)

        context = builder.build_disambiguation_context(
            target_name="Unknown Name",
            candidates=[],  # Empty
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="some_other_reason",  # Not multiple_matches or first_name_only
            local_confidence=0.2,
        )

        # Should have called get_age_filtered_session_peers
        mock_attendee_repo.get_age_filtered_session_peers.assert_called_once()

        # Context should include these attendees
        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        assert len(candidates_data) == 2


# =============================================================================
# =============================================================================


class TestGetPhoneticallySimularAttendees:
    """
    Monolith implementation matches:
    - First 3 letters matching
    - Reverse prefix matching
    - Nickname group matching
    - Limits to max_results (default 20)
    """

    def test_phonetic_match_first_three_letters(self):
        """"""
        mock_attendee_repo = Mock()
        mock_person_repo = Mock()

        # Mock session attendees
        mock_attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": 100},
            {"person_cm_id": 101},
            {"person_cm_id": 102},
        ]

        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            100: _create_person(cm_id=100, first_name="Sarah", last_name="Smith"),
            101: _create_person(cm_id=101, first_name="Sarita", last_name="Jones"),  # Same first 3: 'sar'
            102: _create_person(cm_id=102, first_name="John", last_name="Doe"),
        }

        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
        )

        result = builder.get_phonetically_similar_attendees(
            target_name="Sarah",
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Should include Sarah (exact) and Sarita (same first 3: 'sar')
        result_ids = [r["person_id"] for r in result]
        assert 100 in result_ids
        assert 101 in result_ids
        assert 102 not in result_ids  # John doesn't match

    def test_phonetic_match_reverse_prefix(self):
        """"""
        mock_attendee_repo = Mock()
        mock_person_repo = Mock()

        mock_attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": 100},
        ]

        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            100: _create_person(cm_id=100, first_name="Jo", last_name="Smith"),  # 'Jo' is prefix of 'Joe'
        }

        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
        )

        result = builder.get_phonetically_similar_attendees(
            target_name="Joey",  # Starts with 'Jo'
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Should include Jo (Joey starts with 'Jo')
        assert len(result) >= 1
        assert result[0]["person_id"] == 100

    def test_phonetic_match_nickname_groups(self):
        """"""
        mock_attendee_repo = Mock()
        mock_person_repo = Mock()

        mock_attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": 100},
            {"person_cm_id": 101},
        ]

        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            100: _create_person(cm_id=100, first_name="Robert", last_name="Smith"),
            101: _create_person(cm_id=101, first_name="Elizabeth", last_name="Doe"),
        }

        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
        )

        # Search for "Bobby" - should match "Robert" via nickname group
        result = builder.get_phonetically_similar_attendees(
            target_name="Bobby",
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Should include Robert (Bobby->Robert via nickname group)
        result_ids = [r["person_id"] for r in result]
        assert 100 in result_ids
        assert 101 not in result_ids  # Elizabeth not a Bobby nickname

    def test_phonetic_search_limits_to_max_results(self):
        """"""
        mock_attendee_repo = Mock()
        mock_person_repo = Mock()

        # Create 25 matching attendees
        mock_attendee_repo.get_session_attendees.return_value = [{"person_cm_id": 100 + i} for i in range(25)]

        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            100 + i: _create_person(cm_id=100 + i, first_name="Sarah", last_name=f"Smith{i}") for i in range(25)
        }

        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
        )

        result = builder.get_phonetically_similar_attendees(
            target_name="Sarah",
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
            max_results=20,
        )

        # Should be limited to 20
        assert len(result) <= 20

    def test_phonetic_search_excludes_requester(self):
        """Phonetic search should exclude the requester themselves"""
        mock_attendee_repo = Mock()
        mock_person_repo = Mock()

        mock_attendee_repo.get_session_attendees.return_value = [
            {"person_cm_id": 11111},  # The requester
            {"person_cm_id": 100},
        ]

        mock_person_repo.bulk_find_by_cm_ids.return_value = {
            11111: _create_person(cm_id=11111, first_name="Sarah", last_name="Requester"),
            100: _create_person(cm_id=100, first_name="Sarah", last_name="Smith"),
        }

        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
        )

        result = builder.get_phonetically_similar_attendees(
            target_name="Sarah",
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Should NOT include the requester
        result_ids = [r["person_id"] for r in result]
        assert 11111 not in result_ids
        assert 100 in result_ids


# =============================================================================
# =============================================================================


class TestGetAgeFilteredSessionAttendees:
    """
    Monolith uses this when:
    - Ambiguity reason is not 'multiple_matches' or 'first_name_only_or_unclear'
    - As a fallback when no specific candidates are found
    """

    def test_age_filtered_uses_config_max_age_difference(self):
        """
        max_age_diff_months = context_config.get('max_age_difference_months', 24)
        """
        mock_config_service = Mock()
        mock_config_service.get_ai_config.return_value = {
            "context_building": {
                "max_age_difference_months": 36  # Custom value
            }
        }

        mock_attendee_repo = Mock()
        mock_attendee_repo.get_age_filtered_session_peers.return_value = []

        builder = ContextBuilder(
            config_service=mock_config_service,
            attendee_repository=mock_attendee_repo,
        )

        builder.get_age_filtered_session_attendees(
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Should have called with the config value
        mock_attendee_repo.get_age_filtered_session_peers.assert_called_once()
        call_args = mock_attendee_repo.get_age_filtered_session_peers.call_args
        assert call_args[1].get("max_age_diff_months") == 36 or call_args[0][3] == 36

    def test_age_filtered_defaults_to_24_months(self):
        """ """
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_age_filtered_session_peers.return_value = []

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)

        builder.get_age_filtered_session_attendees(
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Should have called with default 24 months
        mock_attendee_repo.get_age_filtered_session_peers.assert_called_once()
        call_args = mock_attendee_repo.get_age_filtered_session_peers.call_args
        # Check either positional or keyword arg
        assert call_args[1].get("max_age_diff_months", 24) == 24

    def test_age_filtered_returns_formatted_attendees(self):
        """
        Monolith returns: {name, person_id, grade, age, session}
        """
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_age_filtered_session_peers.return_value = [
            _create_person(cm_id=100, first_name="Emma", last_name="Wilson", grade=5),
            _create_person(cm_id=101, first_name="Olivia", last_name="Brown", grade=6),
        ]

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)

        result = builder.get_age_filtered_session_attendees(
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        assert len(result) == 2

        assert result[0]["name"] == "Emma Wilson"
        assert result[0]["person_id"] == 100
        assert result[0]["grade"] == 5
        assert "age" in result[0]
        assert "session" in result[0] or "session_cm_id" in result[0]

    def test_age_filtered_excludes_requester(self):
        """Age-filtered results should exclude the requester"""
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_age_filtered_session_peers.return_value = [
            _create_person(cm_id=11111, first_name="Self", last_name="Requester"),
            _create_person(cm_id=100, first_name="Emma", last_name="Wilson"),
        ]

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)

        result = builder.get_age_filtered_session_attendees(
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
        )

        # Requester should be excluded
        result_ids = [r["person_id"] for r in result]
        assert 11111 not in result_ids


# =============================================================================
# =============================================================================


class TestContextBuilderDependencyInjection:
    """Tests for ContextBuilder dependency injection"""

    def test_context_builder_accepts_optional_dependencies(self):
        """ContextBuilder should accept optional repository and config dependencies"""
        mock_person_repo = Mock()
        mock_attendee_repo = Mock()
        mock_config_service = Mock()

        # Should not raise
        builder = ContextBuilder(
            person_repository=mock_person_repo,
            attendee_repository=mock_attendee_repo,
            config_service=mock_config_service,
        )

        assert builder.person_repository is mock_person_repo
        assert builder.attendee_repository is mock_attendee_repo
        assert builder.config_service is mock_config_service

    def test_context_builder_works_without_dependencies(self):
        """ContextBuilder should work without dependencies (backward compatible)"""
        builder = ContextBuilder()

        # Should not raise - uses fallback behavior
        context = builder.build_parse_only_context(
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            field_name="share_bunk_with",
        )

        assert context is not None

    def test_disambiguation_with_dependencies_and_empty_candidates(self):
        """When repositories are available and candidates list is empty,
        should search based on ambiguity reason instead of returning empty.
        """
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_age_filtered_session_peers.return_value = [
            _create_person(cm_id=100, first_name="Emma", last_name="Wilson"),
        ]

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)

        context = builder.build_disambiguation_context(
            target_name="Unknown",
            candidates=[],  # Empty!
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="generic_ambiguity",
            local_confidence=0.2,
        )

        # Should have searched and found attendees
        candidates_data = context.additional_context.get("candidates")
        assert candidates_data is not None
        assert len(candidates_data) >= 1


# =============================================================================
# =============================================================================


class TestNeedsHistoricalContextFetchesPriorBunkmates:
    """Tests for needs_historical_context actually fetching prior year bunkmate data.

    This addresses the gap documented in MONOLITH_PARITY_TRACKER.md:
    "**Remaining GAP**: `needs_historical_context` flag exists but no actual
    previous year data fetched"

    When needs_historical=True, build_disambiguation_context should:
    1. Call find_prior_year_bunkmates() on the attendee_repository
    2. Include the prior bunkmate data as previous_year_attendees in context
    """

    def test_needs_historical_true_calls_find_prior_year_bunkmates(self):
        """When needs_historical=True, should call find_prior_year_bunkmates().

        prior_data = self.find_prior_year_bunkmates(requester_cm_id, session_name)
        """
        mock_attendee_repo = Mock()
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [100, 101, 102],
            "prior_bunk": "B-7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 3,
        }

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)
        candidates = [_create_person(cm_id=111)]

        builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Historical reference - from last year",
            local_confidence=0.5,
            needs_historical=True,  # <-- This should trigger the call
        )

        # Must call find_prior_year_bunkmates
        mock_attendee_repo.find_prior_year_bunkmates.assert_called_once_with(
            11111,  # requester_cm_id
            1000002,  # session_cm_id
            2025,  # year
        )

    def test_needs_historical_true_includes_prior_bunkmates_in_context(self):
        """When needs_historical=True, context should include prior bunkmate data.

        The context should have:
        - previous_year: int (year - 1)
        - previous_year_bunkmates: dict with cm_ids, prior_bunk, etc.
        """
        mock_attendee_repo = Mock()
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {
            "cm_ids": [100, 101, 102],
            "prior_bunk": "B-7",
            "prior_year": 2024,
            "total_in_bunk": 5,
            "returning_count": 3,
        }

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)
        candidates = [_create_person(cm_id=111)]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Historical reference",
            local_confidence=0.5,
            needs_historical=True,
        )

        # Context must include prior bunkmate data
        assert context.additional_context.get("previous_year") == 2024
        prior_data = context.additional_context.get("previous_year_bunkmates")
        assert prior_data is not None
        assert prior_data["cm_ids"] == [100, 101, 102]
        assert prior_data["prior_bunk"] == "B-7"
        assert prior_data["returning_count"] == 3

    def test_needs_historical_false_does_not_call_find_prior_year_bunkmates(self):
        """When needs_historical=False (default), should NOT call find_prior_year_bunkmates."""
        mock_attendee_repo = Mock()

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)
        candidates = [_create_person(cm_id=111)]

        builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Multiple matches",
            local_confidence=0.5,
            needs_historical=False,  # Default - should NOT trigger call
        )

        # Should NOT call find_prior_year_bunkmates
        mock_attendee_repo.find_prior_year_bunkmates.assert_not_called()

    def test_needs_historical_without_attendee_repo_gracefully_skips(self):
        """When needs_historical=True but no attendee_repository, should not crash."""
        builder = ContextBuilder()  # No repositories
        candidates = [_create_person(cm_id=111)]

        # Should not raise
        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Historical reference",
            local_confidence=0.5,
            needs_historical=True,
        )

        # Should still set the flag (for AI to know we wanted historical data)
        assert context.additional_context.get("needs_historical_context") is True
        # But no bunkmate data since no repository
        assert context.additional_context.get("previous_year_bunkmates") is None

    def test_needs_historical_with_empty_bunkmate_result(self):
        """When find_prior_year_bunkmates returns empty dict, context should handle gracefully."""
        mock_attendee_repo = Mock()
        mock_attendee_repo.find_prior_year_bunkmates.return_value = {}  # Empty - no prior data

        builder = ContextBuilder(attendee_repository=mock_attendee_repo)
        candidates = [_create_person(cm_id=111)]

        context = builder.build_disambiguation_context(
            target_name="Sarah Smith",
            candidates=candidates,
            requester_name="John Doe",
            requester_cm_id=11111,
            requester_school=None,
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            ambiguity_reason="Historical reference",
            local_confidence=0.5,
            needs_historical=True,
        )

        # Flag should still be set
        assert context.additional_context.get("needs_historical_context") is True
        # previous_year should still be set (year - 1)
        assert context.additional_context.get("previous_year") == 2024
        # But bunkmate data may be empty or None
        prior_data = context.additional_context.get("previous_year_bunkmates")
        assert prior_data == {} or prior_data is None
