"""PlaceholderExpander service for expanding placeholder requests.

Extracts placeholder expansion logic from orchestrator.py to reduce complexity.
This service handles the expansion of placeholder requests into individual
bunk_with requests based on historical bunking data or family relationships.

Supported placeholders:
- LAST_YEAR_BUNKMATES: Expands to bunk_with requests for returning bunkmates
- SIBLING: Expands to bunk_with/not_bunk_with request for sibling(s) via household_id
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ..core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    RequestType,
)
from ..resolution.interfaces import ResolutionResult
from ..shared.constants import LAST_YEAR_BUNKMATES_PLACEHOLDER, SIBLING_PLACEHOLDER

if TYPE_CHECKING:
    from ..data.repositories.attendee_repository import AttendeeRepository
    from ..data.repositories.person_repository import PersonRepository

logger = logging.getLogger(__name__)


class PlaceholderExpander:
    """Service for expanding placeholder requests into individual requests.

    Handles two types of placeholders:
    1. LAST_YEAR_BUNKMATES: When a parent says "keep with last year's bunk",
       expands to individual bunk_with requests for each returning bunkmate.
    2. SIBLING: When parents say "bunk with twin", "with sibling", etc.,
       expands to request(s) for sibling(s) found via household_id lookup.
    """

    def __init__(
        self,
        attendee_repo: AttendeeRepository,
        person_repo: PersonRepository,
        year: int,
    ) -> None:
        """Initialize the placeholder expander.

        Args:
            attendee_repo: Repository for attendee/bunkmate data
            person_repo: Repository for person data
            year: Current year for processing

        Raises:
            ValueError: If year is not positive
        """
        if year <= 0:
            raise ValueError("year must be positive")

        self._attendee_repo = attendee_repo
        self._person_repo = person_repo
        self.year = year

    async def expand(
        self,
        resolution_results: list[tuple[ParseResult, list[ResolutionResult]]],
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Expand placeholder requests into individual requests.

        Handles both LAST_YEAR_BUNKMATES and SIBLING placeholders.

        Args:
            resolution_results: List of (ParseResult, List[ResolutionResult]) from Phase 2

        Returns:
            Updated list with placeholder requests expanded to individual requests
        """
        if not resolution_results:
            return []

        expanded_results = []

        for parse_result, resolution_list in resolution_results:
            if not parse_result.is_valid or not parse_result.parsed_requests:
                expanded_results.append((parse_result, resolution_list))
                continue

            # Check for LAST_YEAR_BUNKMATES placeholder
            lyb_idx = self._find_placeholder_index(resolution_list, LAST_YEAR_BUNKMATES_PLACEHOLDER)
            if lyb_idx is not None:
                expanded = await self._expand_last_year_bunkmates(parse_result, resolution_list, lyb_idx)
                expanded_results.extend(expanded)
                continue

            # Check for SIBLING placeholder
            sibling_idx = self._find_placeholder_index(resolution_list, SIBLING_PLACEHOLDER)
            if sibling_idx is not None:
                expanded = await self._expand_sibling(parse_result, resolution_list, sibling_idx)
                expanded_results.extend(expanded)
                continue

            # No placeholder, pass through unchanged
            expanded_results.append((parse_result, resolution_list))

        return expanded_results

    def _find_placeholder_index(self, resolution_list: list[ResolutionResult], placeholder_type: str) -> int | None:
        """Find the index of a specific placeholder in resolution list.

        Args:
            resolution_list: List of resolution results
            placeholder_type: The placeholder constant to search for

        Returns:
            Index of placeholder, or None if not found
        """
        for idx, res_result in enumerate(resolution_list):
            if res_result.metadata is None:
                continue
            if res_result.method == "placeholder" and res_result.metadata.get("placeholder") == placeholder_type:
                return idx
        return None

    async def _expand_last_year_bunkmates(
        self,
        parse_result: ParseResult,
        resolution_list: list[ResolutionResult],
        placeholder_idx: int,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Expand a single placeholder into individual requests.

        Args:
            parse_result: Original parse result containing the placeholder
            resolution_list: List of resolution results
            placeholder_idx: Index of the placeholder in resolution_list

        Returns:
            List of expanded (ParseResult, ResolutionResult) pairs
        """
        parsed_req = parse_result.parsed_requests[placeholder_idx]
        original_parse_request = parse_result.parse_request

        if original_parse_request is None:
            return []
        requester_cm_id = original_parse_request.requester_cm_id
        session_cm_id = original_parse_request.session_cm_id

        logger.info(f"Expanding LAST_YEAR_BUNKMATES for requester {requester_cm_id} in session {session_cm_id}")

        # Find prior year bunkmates
        prior_data = self._attendee_repo.find_prior_year_bunkmates(
            requester_cm_id=requester_cm_id,
            session_cm_id=session_cm_id,
            year=self.year,
        )

        # Handle failure cases
        if not prior_data or not prior_data.get("cm_ids"):
            return self._handle_expansion_failure(parse_result, resolution_list, placeholder_idx, prior_data)

        # Expand to individual requests
        return await self._create_expanded_requests(parsed_req, original_parse_request, prior_data)

    def _handle_expansion_failure(
        self,
        parse_result: ParseResult,
        resolution_list: list[ResolutionResult],
        placeholder_idx: int,
        prior_data: dict[str, Any] | None,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Handle cases where placeholder expansion fails.

        Args:
            parse_result: Original parse result
            resolution_list: List of resolution results
            placeholder_idx: Index of the placeholder
            prior_data: Prior year data (may be None or empty)

        Returns:
            Single-item list with failed expansion result
        """
        if not prior_data:
            reason = "No prior year assignment found for requester"
        else:
            reason = f"No returning bunkmates from {prior_data.get('prior_bunk', 'unknown bunk')}"

        logger.warning(f"Cannot expand LAST_YEAR_BUNKMATES: {reason}")

        updated_resolution = ResolutionResult(
            person=None,
            confidence=0.0,
            method="placeholder_expansion_failed",
            metadata={
                "original_request": LAST_YEAR_BUNKMATES_PLACEHOLDER,
                "prior_data": prior_data,
                "expansion_failure_reason": reason,
            },
        )

        # Replace the placeholder resolution with the failed one
        new_resolution_list = resolution_list.copy()
        new_resolution_list[placeholder_idx] = updated_resolution

        return [(parse_result, new_resolution_list)]

    async def _create_expanded_requests(
        self,
        parsed_req: ParsedRequest,
        original_parse_request: ParseRequest,
        prior_data: dict[str, Any],
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Create individual bunk_with requests for each returning bunkmate.

        Args:
            parsed_req: Original parsed request with placeholder
            original_parse_request: Original parse request for context
            prior_data: Prior year bunkmate data

        Returns:
            List of (ParseResult, ResolutionResult) pairs, one per bunkmate
        """
        prior_bunk = prior_data.get("prior_bunk", "Unknown")
        prior_year = prior_data.get("prior_year", self.year - 1)

        logger.info(f"Found {len(prior_data['cm_ids'])} returning bunkmates from {prior_bunk} in {prior_year}")

        expanded_results = []

        for bunkmate_cm_id in prior_data["cm_ids"]:
            # Look up bunkmate person info
            bunkmate = self._person_repo.find_by_cm_id(bunkmate_cm_id)

            if not bunkmate:
                logger.warning(f"Could not find person for cm_id {bunkmate_cm_id}")
                continue

            bunkmate_name = bunkmate.full_name

            # Create new ParsedRequest for this bunkmate
            new_parsed_request = ParsedRequest(
                raw_text=parsed_req.raw_text,
                request_type=RequestType.BUNK_WITH,
                target_name=bunkmate_name,
                age_preference=None,
                source_field=parsed_req.source_field,
                source=parsed_req.source,
                confidence=0.90,
                csv_position=parsed_req.csv_position,
                metadata={
                    "auto_generated_from_prior_year": True,
                    "prior_year_bunk": prior_bunk,
                    "prior_year": prior_year,
                    "original_request": LAST_YEAR_BUNKMATES_PLACEHOLDER,
                },
                notes=f"Auto-expanded from 'last year's bunk' request. Was in {prior_bunk} in {prior_year}",
            )

            # Create new ParseResult (one per expanded request)
            new_parse_result = ParseResult(
                parsed_requests=[new_parsed_request],
                needs_historical_context=False,
                is_valid=True,
                parse_request=original_parse_request,
                metadata={
                    "expanded_from_placeholder": True,
                    "original_placeholder": LAST_YEAR_BUNKMATES_PLACEHOLDER,
                },
            )

            # Create ResolutionResult with the resolved person
            new_resolution = ResolutionResult(
                person=bunkmate,
                confidence=0.90,
                method="prior_year_bunkmate",
                metadata={
                    "auto_generated_from_prior_year": True,
                    "prior_year_bunk": prior_bunk,
                    "prior_year": prior_year,
                    "original_request": LAST_YEAR_BUNKMATES_PLACEHOLDER,
                },
            )

            expanded_results.append((new_parse_result, [new_resolution]))
            logger.info(f"  - Created bunk_with request for {bunkmate_name} (ID: {bunkmate_cm_id})")

        return expanded_results

    # =========================================================================
    # SIBLING Placeholder Expansion
    # =========================================================================

    async def _expand_sibling(
        self,
        parse_result: ParseResult,
        resolution_list: list[ResolutionResult],
        placeholder_idx: int,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Expand a SIBLING placeholder into request(s) for sibling(s).

        Looks up siblings via household_id and creates individual requests
        for each sibling found. Preserves the original request_type (bunk_with
        or not_bunk_with) from the parsed request.

        Args:
            parse_result: Original parse result containing the placeholder
            resolution_list: List of resolution results
            placeholder_idx: Index of the placeholder in resolution_list

        Returns:
            List of expanded (ParseResult, ResolutionResult) pairs
        """
        parsed_req = parse_result.parsed_requests[placeholder_idx]
        original_parse_request = parse_result.parse_request

        if original_parse_request is None:
            return []

        requester_cm_id = original_parse_request.requester_cm_id

        logger.info(f"Expanding SIBLING placeholder for requester {requester_cm_id}")

        # Find siblings via household_id
        siblings = self._person_repo.find_siblings(requester_cm_id, self.year)

        if not siblings:
            return self._handle_sibling_expansion_failure(
                parse_result, resolution_list, placeholder_idx, requester_cm_id
            )

        # Create individual requests for each sibling
        return self._create_sibling_requests(parsed_req, original_parse_request, siblings)

    def _handle_sibling_expansion_failure(
        self,
        parse_result: ParseResult,
        resolution_list: list[ResolutionResult],
        placeholder_idx: int,
        requester_cm_id: int,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Handle cases where sibling expansion fails (no siblings found).

        Args:
            parse_result: Original parse result
            resolution_list: List of resolution results
            placeholder_idx: Index of the placeholder
            requester_cm_id: CM ID of the requester

        Returns:
            Single-item list with failed expansion result
        """
        reason = f"No siblings found for person {requester_cm_id} (no matching household_id)"
        logger.warning(f"Cannot expand SIBLING: {reason}")

        updated_resolution = ResolutionResult(
            person=None,
            confidence=0.0,
            method="placeholder_expansion_failed",
            metadata={
                "original_request": SIBLING_PLACEHOLDER,
                "requester_cm_id": requester_cm_id,
                "expansion_failure_reason": reason,
            },
        )

        # Replace the placeholder resolution with the failed one
        new_resolution_list = resolution_list.copy()
        new_resolution_list[placeholder_idx] = updated_resolution

        return [(parse_result, new_resolution_list)]

    def _create_sibling_requests(
        self,
        parsed_req: ParsedRequest,
        original_parse_request: ParseRequest,
        siblings: list[Any],  # list[Person] - but avoiding circular import
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Create individual requests for each sibling.

        Preserves the original request_type (bunk_with or not_bunk_with)
        from the parsed request.

        Args:
            parsed_req: Original parsed request with SIBLING placeholder
            original_parse_request: Original parse request for context
            siblings: List of sibling Person objects

        Returns:
            List of (ParseResult, ResolutionResult) pairs, one per sibling
        """
        logger.info(f"Found {len(siblings)} sibling(s): {[s.full_name for s in siblings]}")

        expanded_results = []

        for sibling in siblings:
            sibling_name = sibling.full_name

            # Create new ParsedRequest for this sibling
            # IMPORTANT: Preserve the original request_type (bunk_with or not_bunk_with)
            new_parsed_request = ParsedRequest(
                raw_text=parsed_req.raw_text,
                request_type=parsed_req.request_type,  # Preserve original type
                target_name=sibling_name,
                age_preference=None,
                source_field=parsed_req.source_field,
                source=parsed_req.source,
                confidence=0.95,  # High confidence - sibling lookup is reliable
                csv_position=parsed_req.csv_position,
                metadata={
                    "auto_generated_from_sibling": True,
                    "sibling_cm_id": sibling.cm_id,
                    "original_request": SIBLING_PLACEHOLDER,
                },
                notes=f"Auto-expanded from sibling reference to {sibling_name}",
            )

            # Create new ParseResult
            new_parse_result = ParseResult(
                parsed_requests=[new_parsed_request],
                needs_historical_context=False,
                is_valid=True,
                parse_request=original_parse_request,
                metadata={
                    "expanded_from_placeholder": True,
                    "original_placeholder": SIBLING_PLACEHOLDER,
                },
            )

            # Create ResolutionResult with the resolved sibling
            new_resolution = ResolutionResult(
                person=sibling,
                confidence=0.95,
                method="sibling_household_lookup",
                metadata={
                    "auto_generated_from_sibling": True,
                    "sibling_cm_id": sibling.cm_id,
                    "original_request": SIBLING_PLACEHOLDER,
                },
            )

            expanded_results.append((new_parse_result, [new_resolution]))
            logger.info(
                f"  - Created {parsed_req.request_type.value} request for sibling {sibling_name} (ID: {sibling.cm_id})"
            )

        return expanded_results
