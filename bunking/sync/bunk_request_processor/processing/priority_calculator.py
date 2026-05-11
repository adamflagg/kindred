"""Priority calculator for bunk requests.

Implements the 1-4 priority scale based on request type, source, and context.
Configuration can be provided via ai_config.json priority section."""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger

from ..core.constants import PRIORITY_KEYWORDS
from ..core.models import ParsedRequest, RequestType
from ..shared.constants import SourceField

logger = get_logger(__name__)

# Rule keys no longer honored by the priority calculator. Presence in a
# loaded config produces a WARN so operators notice inert entries instead of
# them being silently ignored.
_REMOVED_RULE_KEYS = frozenset(
    {
        "last_year_bunkmates_sole",
        "last_year_bunkmates_with_others",
    }
)

# Default rule priorities (used when config not provided or incomplete)
DEFAULT_RULES = {
    "family_bunk_with_first_or_keyword": {"priority": 4},
    "family_bunk_with_subsequent": {"priority": 3},
    "family_not_bunk_with": {"priority": 4},
    "staff_not_bunk_with": {"priority": 4},
    "age_preference_sole": {"priority": 4},  # bunk_with source only since Stage 3a; socialize_with always priority 1
    "age_preference_with_others": {"priority": 1},
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
        # Memoize the per-list family_bunk_requests priority scan (#923).
        # Keyed by id(list) since the list object is reused across the inner loop
        # and each iteration passes the same list. A weak key would be nicer, but
        # id() suffices while the calculator is short-lived per batch.
        self._family_priority_cache: dict[int, bool] = {}

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

        stale = sorted(k for k in config_rules if k in _REMOVED_RULE_KEYS)
        if stale:
            logger.warning(
                "priority_calculator: config contains removed rule keys that no longer apply: %s",
                stale,
            )

        rules = dict(DEFAULT_RULES)
        rules.update(config_rules)
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
        - age_preference from family as sole request (bunk_with source only)

        Priority 3:
        - bunk_with from family (subsequent without keywords)

        Priority 2:
        - Any request from staff notes

        Priority 1 (Lowest):
        - age_preference from family with other requests
        - age_preference from parent (always)
        """
        has_other_requests = len(all_requests_for_person) > 1

        # Memoize the per-list family_bunk_requests scan to avoid O(N^2) work
        # when this method is invoked once per request for the same list (#923).
        any_family_request_has_priority = self._any_family_request_has_priority(all_requests_for_person)

        # Priority 4 cases
        if parsed.source_field == SourceField.BUNK_REQUEST_FORM:
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

        if parsed.source_field == SourceField.STAFF_NOT_BUNK_WITH and parsed.request_type == RequestType.NOT_BUNK_WITH:
            return self._get_rule_priority("staff_not_bunk_with")

        # Priority 2 cases - staff notes
        if parsed.source_field in [SourceField.INTERNAL_NOTES, SourceField.BUNKING_NOTES]:
            return self._get_rule_priority("staff_notes")

        # Parent age preference from socialize_with
        if parsed.source_field == SourceField.SOCIALIZE_WITH:
            if parsed.request_type == RequestType.AGE_PREFERENCE:
                # Stage 3a: socialize_with is best-effort, always priority 1.
                # Sole-promotion was removed because socialize_with never counts toward
                # the parent-min-one rule under the materiality refactor.
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

    def _any_family_request_has_priority(self, all_requests_for_person: list[ParsedRequest]) -> bool:
        """Return True if any bunk_with family request has a priority keyword.

        Memoized by id(list) so a single pass through a batch's inner loop does
        not rescan the list per request (#923 — O(N^2) removal).
        """
        cache_key = id(all_requests_for_person)
        cached = self._family_priority_cache.get(cache_key)
        if cached is not None:
            return cached

        result = any(
            self._has_priority_keyword(r.raw_text)
            for r in all_requests_for_person
            if r.source_field == SourceField.BUNK_REQUEST_FORM and r.request_type == RequestType.BUNK_WITH
        )
        self._family_priority_cache[cache_key] = result
        return result
