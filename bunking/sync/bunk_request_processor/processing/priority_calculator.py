"""Priority calculator for bunk requests.

Implements the 1-4 priority scale based on request type, source, and context.
Configuration can be provided via ai_config.json priority section."""

from __future__ import annotations

from typing import Any

from ..core.constants import PRIORITY_KEYWORDS
from ..core.models import ParsedRequest, RequestType
from ..shared.constants import LAST_YEAR_BUNKMATES_PLACEHOLDER

# Default rule priorities (used when config not provided or incomplete)
DEFAULT_RULES = {
    "family_bunk_with_first_or_keyword": {"priority": 4},
    "family_bunk_with_subsequent": {"priority": 3},
    "family_not_bunk_with": {"priority": 4},
    "staff_not_bunk_with": {"priority": 4},
    "age_preference_sole": {"priority": 4},
    "age_preference_with_others": {"priority": 1},
    "last_year_bunkmates_sole": {"priority": 4},
    "last_year_bunkmates_with_others": {"priority": 3},
    "staff_notes": {"priority": 2},
    "parent_age_preference": {"priority": 1},
}

DEFAULT_BASE_PRIORITY = 2


class PriorityCalculator:
    """Calculate request priority based on configurable business rules"""

    def __init__(self, config: dict[str, Any] | None = None):
        """Initialize with optional config from ai_config.json priority section.

        Args:
            config: Priority configuration dict, or None for defaults.
                   Expected structure:
                   {
                       "keywords": {"high_priority": [...]},
                       "rules": {"rule_name": {"priority": N}, ...},
                       "source_weights": {"field": "category", ...},
                       "defaults": {"base_priority": N}
                   }
        """
        self._config = config or {}
        self._keywords = self._load_keywords()
        self._rules = self._load_rules()
        self._source_weights = self._config.get("source_weights", {})
        self._default_priority = self._config.get("defaults", {}).get("base_priority", DEFAULT_BASE_PRIORITY)

    def _load_keywords(self) -> list[str]:
        """Load priority keywords from config or use defaults"""
        keywords_config = self._config.get("keywords", {})
        high_priority = keywords_config.get("high_priority", [])

        if high_priority:
            result: list[str] = high_priority
            return result

        # Fallback: Use constants for backward compatibility
        return list(PRIORITY_KEYWORDS)

    def _load_rules(self) -> dict[str, dict[str, Any]]:
        """Load rule priorities from config, merging with defaults"""
        config_rules = self._config.get("rules", {})

        # Start with defaults, then overlay config
        rules = dict(DEFAULT_RULES)
        for rule_name, rule_config in config_rules.items():
            if rule_name in rules:
                rules[rule_name] = rule_config
            else:
                # Allow new rules from config
                rules[rule_name] = rule_config

        return rules

    def _get_rule_priority(self, rule_name: str) -> int:
        """Get priority for a rule, with fallback to default"""
        rule = self._rules.get(rule_name, {})
        priority: int = rule.get("priority", self._default_priority)
        return priority

    def calculate_priority(
        self,
        parsed: ParsedRequest,
        all_requests_for_person: list[ParsedRequest],
    ) -> int:
        """Calculate priority (1-4 scale) based on source, type, and context.

        Priority 4 (Highest):
        - bunk_with from family (first in list OR with keywords)
        - not_bunk_with from family or staff
        - age_preference from family as sole request
        - LAST_YEAR_BUNKMATES as sole non-age request

        Priority 3:
        - bunk_with from family (subsequent without keywords)
        - LAST_YEAR_BUNKMATES with other specific requests

        Priority 2:
        - Any request from staff notes

        Priority 1 (Lowest):
        - age_preference from family with other requests
        - age_preference from parent (always)
        """
        # Check what other requests exist for this person
        non_age_requests = [r for r in all_requests_for_person if r.request_type != RequestType.AGE_PREFERENCE]

        has_other_requests = len(all_requests_for_person) > 1
        has_specific_bunk_requests = any(
            r
            for r in non_age_requests
            if r.request_type == RequestType.BUNK_WITH and r.target_name != LAST_YEAR_BUNKMATES_PLACEHOLDER
        )

        # Get all bunk_with requests from family source
        family_bunk_requests = [
            r
            for r in all_requests_for_person
            if r.source_field == "share_bunk_with" and r.request_type == RequestType.BUNK_WITH
        ]

        # Check if ANY family bunk request has priority keywords
        any_family_request_has_priority = any(self._has_priority_keyword(r.raw_text) for r in family_bunk_requests)

        # Priority 4 cases
        if parsed.source_field == "share_bunk_with":
            if parsed.request_type == RequestType.BUNK_WITH:
                if any_family_request_has_priority:
                    # List has keywords = unordered, only keyword requests get highest
                    if self._has_priority_keyword(parsed.raw_text):
                        return self._get_rule_priority("family_bunk_with_first_or_keyword")
                    else:
                        return self._get_rule_priority("family_bunk_with_subsequent")
                else:
                    # No keywords anywhere = ordered list, first gets highest
                    if parsed.csv_position == 1:
                        return self._get_rule_priority("family_bunk_with_first_or_keyword")
                    else:
                        return self._get_rule_priority("family_bunk_with_subsequent")

            if parsed.request_type == RequestType.NOT_BUNK_WITH:
                return self._get_rule_priority("family_not_bunk_with")

            if parsed.request_type == RequestType.AGE_PREFERENCE and not has_other_requests:
                return self._get_rule_priority("age_preference_sole")

        if parsed.source_field == "do_not_share_with" and parsed.request_type == RequestType.NOT_BUNK_WITH:
            return self._get_rule_priority("staff_not_bunk_with")

        if parsed.target_name == LAST_YEAR_BUNKMATES_PLACEHOLDER and not has_specific_bunk_requests:
            return self._get_rule_priority("last_year_bunkmates_sole")

        # Priority 3 cases
        if parsed.target_name == LAST_YEAR_BUNKMATES_PLACEHOLDER and has_specific_bunk_requests:
            return self._get_rule_priority("last_year_bunkmates_with_others")

        # Priority 2 cases - staff notes
        if parsed.source_field in ["internal_notes", "bunking_notes"]:
            return self._get_rule_priority("staff_notes")

        # Priority 1 cases - parent age preference
        if parsed.source_field == "ret_parent_socialize_with_best":
            if parsed.request_type == RequestType.AGE_PREFERENCE:
                return self._get_rule_priority("parent_age_preference")

        # Age preference with other requests
        if parsed.request_type == RequestType.AGE_PREFERENCE:
            return self._get_rule_priority("age_preference_with_others")

        # Default for any edge cases
        default_priority: int = self._default_priority
        return default_priority

    def _has_priority_keyword(self, text: str) -> bool:
        """Check if text contains priority keywords"""
        if not text:
            return False
        text_lower = text.lower()
        return any(keyword in text_lower for keyword in self._keywords)
