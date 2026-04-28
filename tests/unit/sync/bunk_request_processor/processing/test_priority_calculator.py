"""Test-Driven Development for Priority Calculator

Tests the 1-4 priority scale based on business rules."""

import sys
from pathlib import Path

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import AgePreference, ParsedRequest, RequestSource, RequestType
from bunking.sync.bunk_request_processor.processing.priority_calculator import PriorityCalculator
from bunking.sync.bunk_request_processor.shared.constants import SourceField


class TestPriorityCalculator:
    """Test the priority calculation logic"""

    @pytest.fixture
    def calculator(self):
        """Create a priority calculator instance"""
        return PriorityCalculator()

    def test_family_bunk_with_first_no_keywords(self, calculator):
        """First bunk_with from family gets priority 4 when no keywords exist"""
        # Note: csv_position is 1-indexed (first = 1), matching orchestrator convention
        requests = [
            ParsedRequest(
                raw_text="Johnny Smith",
                request_type=RequestType.BUNK_WITH,
                target_name="Johnny Smith",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=1,  # First position (1-indexed)
                metadata={},
            ),
            ParsedRequest(
                raw_text="Sarah Jones",
                request_type=RequestType.BUNK_WITH,
                target_name="Sarah Jones",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=2,  # Second position (1-indexed)
                metadata={},
            ),
        ]

        # First request should get priority 4
        priority = calculator.calculate_priority(requests[0], requests)
        assert priority == 4

        # Second request should get priority 3
        priority = calculator.calculate_priority(requests[1], requests)
        assert priority == 3

    def test_family_bunk_with_keywords(self, calculator):
        """Requests with keywords get priority 4, others get 3"""
        requests = [
            ParsedRequest(
                raw_text="Johnny Smith",
                request_type=RequestType.BUNK_WITH,
                target_name="Johnny Smith",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=0,
                metadata={},
            ),
            ParsedRequest(
                raw_text="Sarah Jones (must have)",
                request_type=RequestType.BUNK_WITH,
                target_name="Sarah Jones",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=1,
                metadata={},
            ),
            ParsedRequest(
                raw_text="Tommy Wilson",
                request_type=RequestType.BUNK_WITH,
                target_name="Tommy Wilson",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=2,
                metadata={},
            ),
        ]

        # First request WITHOUT keyword should get priority 3 (keywords exist elsewhere)
        priority = calculator.calculate_priority(requests[0], requests)
        assert priority == 3

        # Second request WITH keyword should get priority 4
        priority = calculator.calculate_priority(requests[1], requests)
        assert priority == 4

        # Third request WITHOUT keyword should get priority 3
        priority = calculator.calculate_priority(requests[2], requests)
        assert priority == 3

    def test_family_not_bunk_with(self, calculator):
        """not_bunk_with from family always gets priority 4"""
        request = ParsedRequest(
            raw_text="Billy Bad Kid",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Billy Bad Kid",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4

    def test_staff_not_bunk_with(self, calculator):
        """not_bunk_with from staff always gets priority 4"""
        request = ParsedRequest(
            raw_text="Problem Child",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Problem Child",
            age_preference=None,
            source_field=SourceField.NOT_BUNK_WITH,
            source=RequestSource.STAFF,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4

    def test_age_preference_sole_request(self, calculator):
        """age_preference from family as sole request gets priority 4"""
        request = ParsedRequest(
            raw_text="older",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.OLDER,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4

    def test_age_preference_with_other_requests(self, calculator):
        """age_preference from family with other requests gets priority 1"""
        requests = [
            ParsedRequest(
                raw_text="Johnny Smith",
                request_type=RequestType.BUNK_WITH,
                target_name="Johnny Smith",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=0,
                metadata={},
            ),
            ParsedRequest(
                raw_text="older",
                request_type=RequestType.AGE_PREFERENCE,
                target_name=None,
                age_preference=AgePreference.OLDER,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=1.0,
                csv_position=1,
                metadata={},
            ),
        ]

        priority = calculator.calculate_priority(requests[1], requests)
        assert priority == 1

    def test_age_preference_from_socialize_with_sole_request(self, calculator):
        """age_preference from socialize_with as sole request gets priority 4 (same as bunk_with sole age pref)"""
        request = ParsedRequest(
            raw_text="younger",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.YOUNGER,
            source_field=SourceField.SOCIALIZE_WITH,
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4, "Sole age_preference from socialize_with should get priority 4"

    def test_age_preference_from_socialize_with_with_other_requests(self, calculator):
        """age_preference from socialize_with with other non-bunk_with requests still
        gets promoted to priority 4.

        Updated per Stage 1 fix: staff requests (and other non-bunk_with source_field
        requests) no longer suppress socialize_with sole-promote. Only a request with
        source_field=BUNK_WITH (parent bunk_with text) suppresses the promotion.

        The 'other' request here is a BUNK_WITH type but from source_field=SOCIALIZE_WITH,
        meaning it's not a parent bunk_with field submission — so promotion still applies.
        """
        requests = [
            ParsedRequest(
                raw_text="Emma Johnson",
                request_type=RequestType.BUNK_WITH,
                target_name="Emma Johnson",
                age_preference=None,
                source_field=SourceField.SOCIALIZE_WITH,  # NOT source_field BUNK_WITH
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=1,
                metadata={},
            ),
            ParsedRequest(
                raw_text="younger",
                request_type=RequestType.AGE_PREFERENCE,
                target_name=None,
                age_preference=AgePreference.YOUNGER,
                source_field=SourceField.SOCIALIZE_WITH,
                source=RequestSource.FAMILY,
                confidence=1.0,
                csv_position=0,
                metadata={},
            ),
        ]

        priority = calculator.calculate_priority(requests[1], requests)
        # Updated per Stage 1 fix: no bunk_with source_field request exists,
        # so socialize_with is still the "sole" parent input — priority 4.
        assert priority == 4, (
            "age_preference from socialize_with should be priority 4 when no "
            "source_field=BUNK_WITH request exists (only non-bunk_with source requests)"
        )

    def test_staff_notes_request(self, calculator):
        """Any request from staff notes gets priority 2"""
        request = ParsedRequest(
            raw_text="Works well with Johnny",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.INTERNAL_NOTES,
            source=RequestSource.STAFF,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 2

    def test_multiple_priority_keywords(self, calculator):
        """Multiple requests with keywords all get priority 4"""
        requests = [
            ParsedRequest(
                raw_text="Johnny (very important)",
                request_type=RequestType.BUNK_WITH,
                target_name="Johnny",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=0,
                metadata={},
            ),
            ParsedRequest(
                raw_text="Sarah (must have)",
                request_type=RequestType.BUNK_WITH,
                target_name="Sarah",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=1,
                metadata={},
            ),
            ParsedRequest(
                raw_text="Tommy",
                request_type=RequestType.BUNK_WITH,
                target_name="Tommy",
                age_preference=None,
                source_field=SourceField.BUNK_WITH,
                source=RequestSource.FAMILY,
                confidence=0.95,
                csv_position=2,
                metadata={},
            ),
        ]

        # Both keyword requests get priority 4
        assert calculator.calculate_priority(requests[0], requests) == 4
        assert calculator.calculate_priority(requests[1], requests) == 4

        # Non-keyword request gets priority 3
        assert calculator.calculate_priority(requests[2], requests) == 3

    def test_keyword_case_insensitive(self, calculator):
        """Keywords should be detected case-insensitively"""
        request = ParsedRequest(
            raw_text="Johnny (MUST HAVE)",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=0,
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4


class TestConfigDrivenPriorityCalculator:
    """Test that PriorityCalculator can be configured via ai_config.json.

    Per the plan: Keywords, scale values, AND source field weights should
    all be configurable. The default behavior (no config) should match
    the current hardcoded behavior for backward compatibility.
    """

    def test_default_no_config_matches_current_behavior(self):
        """PriorityCalculator without config should match current hardcoded behavior"""
        calculator = PriorityCalculator()

        # Test family bunk_with first gets priority 4
        # Note: csv_position is 1-indexed (first = 1), matching orchestrator convention
        request = ParsedRequest(
            raw_text="Johnny Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny Smith",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=1,  # First position (1-indexed)
            metadata={},
        )
        priority = calculator.calculate_priority(request, [request])
        assert priority == 4, "Default behavior should match current: first family request = 4"

    def test_custom_keywords_from_config(self):
        """Custom keywords from config should trigger priority 4"""
        config = {"keywords": {"high_priority": ["super important", "mega urgent", "absolutely needs"]}}
        calculator = PriorityCalculator(config)

        request = ParsedRequest(
            raw_text="Johnny (super important)",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=2,  # Not first position (1-indexed, so 2 = second)
            metadata={},
        )

        # With keyword, should still get priority 4 (keyword overrides position)
        priority = calculator.calculate_priority(request, [request])
        assert priority == 4, "Custom keyword from config should trigger priority 4"

    def test_config_keywords_replace_defaults(self):
        """When config provides keywords, they should replace the defaults"""
        config = {"keywords": {"high_priority": ["custom only"]}}
        calculator = PriorityCalculator(config)

        # Create two requests - first without keyword, second with old keyword
        first_request = ParsedRequest(
            raw_text="Sarah Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Sarah Smith",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=1,  # First position (1-indexed)
            metadata={},
        )

        request_old_keyword = ParsedRequest(
            raw_text="Johnny (must have)",  # Was a default keyword, but config replaced it
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=2,  # Second position (1-indexed)
            metadata={},
        )

        requests = [first_request, request_old_keyword]
        # Old default keyword "must have" should NOT work - config replaced keywords
        priority = calculator.calculate_priority(request_old_keyword, requests)
        assert priority == 3, "Old default keyword should not work when config provides custom keywords"

    def test_custom_rule_priorities(self):
        """Priority values for different rules should come from config"""
        config = {
            "rules": {
                "staff_notes": {"priority": 3}  # Changed from default 2
            },
            "defaults": {
                "base_priority": 1  # Changed from default 2
            },
        }
        calculator = PriorityCalculator(config)

        request = ParsedRequest(
            raw_text="Works well with Johnny",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.INTERNAL_NOTES,
            source=RequestSource.STAFF,
            confidence=0.85,
            csv_position=1,  # First position (1-indexed)
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 3, "Staff notes priority should come from config"

    def test_custom_source_weights(self):
        """Source field categorization should come from config"""
        config = {
            "source_weights": {
                "custom_family_field": "family",  # Map custom field to family
                "custom_staff_field": "staff_notes",  # Map custom field to staff
            }
        }
        calculator = PriorityCalculator(config)

        # Test that source_weights is loaded (implementation will use this)
        assert hasattr(calculator, "_source_weights") or hasattr(calculator, "_config"), (
            "Calculator should store config for source weight lookup"
        )

    def test_empty_config_uses_defaults(self):
        """Empty config dict should use all defaults"""
        calculator = PriorityCalculator({})

        request = ParsedRequest(
            raw_text="Johnny (must have)",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=1,  # First position (1-indexed)
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4, "Empty config should use default keywords including 'must have'"

    def test_partial_config_merges_with_defaults(self):
        """Partial config should merge with defaults, not replace everything"""
        config = {
            "rules": {"staff_notes": {"priority": 3}}
            # No keywords provided - should use defaults
        }
        calculator = PriorityCalculator(config)

        # Default keyword should still work since keywords weren't overridden
        request = ParsedRequest(
            raw_text="Johnny (must have)",
            request_type=RequestType.BUNK_WITH,
            target_name="Johnny",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=2,  # Second position - should still get 4 due to keyword
            metadata={},
        )

        priority = calculator.calculate_priority(request, [request])
        assert priority == 4, "Default keywords should work when config only overrides rules"


class TestSocializeWithParentParamountStage1:
    """Stage 1 fix: staff requests don't suppress socialize_with sole-promote.

    Per the parent-paramount taxonomy: socialize_with is sole parent input when
    no bunk_with request exists. Staff requests (internal_notes, bunking_notes,
    not_bunk_with) are not parent input and must not suppress the promotion.
    """

    @pytest.fixture
    def calculator(self):
        return PriorityCalculator()

    def test_socialize_with_sole_promoted_when_bunk_with_empty_even_with_staff_notes(self, calculator):
        """Per parent-paramount rule: socialize_with is the sole parent input when
        no bunk_with request exists, and gets priority 4. Staff notes don't suppress
        this — they're not parent input."""
        socialize_req = ParsedRequest(
            raw_text="younger",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.YOUNGER,
            source_field=SourceField.SOCIALIZE_WITH,
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )
        staff_note_req = ParsedRequest(
            raw_text="keep away from Liam",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Liam Garcia",
            age_preference=None,
            source_field=SourceField.INTERNAL_NOTES,
            source=RequestSource.STAFF,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        all_for_person = [socialize_req, staff_note_req]

        priority = calculator.calculate_priority(socialize_req, all_for_person)

        assert priority == 4, (
            "socialize_with should be sole-promoted to priority 4 when no bunk_with "
            "exists for the camper, regardless of staff requests"
        )

    def test_socialize_with_low_priority_when_bunk_with_exists(self, calculator):
        """Counterpart: when a parent submitted bunk_with text, socialize_with stays
        at priority 1 because the parent has a higher-priority input."""
        socialize_req = ParsedRequest(
            raw_text="younger",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.YOUNGER,
            source_field=SourceField.SOCIALIZE_WITH,
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )
        bunk_with_req = ParsedRequest(
            raw_text="wants to bunk with Liam",
            request_type=RequestType.BUNK_WITH,
            target_name="Liam Garcia",
            age_preference=None,
            source_field=SourceField.BUNK_WITH,
            source=RequestSource.FAMILY,
            confidence=0.95,
            csv_position=1,
            metadata={},
        )
        all_for_person = [socialize_req, bunk_with_req]

        priority = calculator.calculate_priority(socialize_req, all_for_person)

        assert priority == 1, (
            "socialize_with should stay at parent_age_preference priority (1) when any bunk_with parent input exists"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
