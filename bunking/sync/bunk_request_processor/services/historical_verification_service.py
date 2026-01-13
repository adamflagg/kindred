"""HistoricalVerificationService for verifying historical bunking groups.

Extracts historical group verification logic from orchestrator.py to reduce complexity.
This service verifies that resolved campers from historical requests were actually
in the same bunk together, boosting confidence when verified.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ..resolution.interfaces import ResolutionResult

if TYPE_CHECKING:
    from ..core.models import ParseResult
    from ..data.cache.temporal_name_cache import TemporalNameCache

logger = logging.getLogger(__name__)


class HistoricalVerificationService:
    """Service for verifying historical bunking groups.

    When multiple requests for the same historical year have been resolved,
    verifies they were actually in the same bunk together. If verified,
    boosts confidence by +0.10 (capped at 0.95).
    """

    def __init__(
        self,
        temporal_name_cache: TemporalNameCache | None = None,
    ) -> None:
        """Initialize the historical verification service.

        Args:
            temporal_name_cache: Cache for historical data lookups.
                If None, verification is disabled.
        """
        self._temporal_cache = temporal_name_cache

    async def verify(
        self,
        resolution_results: list[tuple[ParseResult, list[ResolutionResult]]],
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Verify historical bunking groups and boost confidence for verified campers.

        Args:
            resolution_results: List of (ParseResult, List[ResolutionResult]) from Phase 2

        Returns:
            Updated list with confidence boosted for verified historical groups
        """
        if not self._temporal_cache:
            logger.debug("Skipping historical group verification - no temporal cache")
            return resolution_results

        if not resolution_results:
            return []

        verified_count = 0
        unverified_count = 0

        for parse_result, resolution_list in resolution_results:
            if not parse_result.is_valid:
                continue

            if parse_result.parse_request is None:
                continue
            requester_cm_id = parse_result.parse_request.requester_cm_id

            # Group resolved requests by historical_year from metadata
            by_year = self._group_by_historical_year(resolution_list)

            # Verify each year's group
            for year, year_items in by_year.items():
                if len(year_items) < 2:
                    # Need at least 2 targets to verify group
                    continue

                verified, unverified = self._verify_year_group(requester_cm_id, year, year_items, resolution_list)
                verified_count += verified
                unverified_count += unverified

        if verified_count > 0 or unverified_count > 0:
            logger.info(
                f"Historical group verification: {verified_count} verified, {unverified_count} could not be verified"
            )

        return resolution_results

    def _group_by_historical_year(
        self, resolution_list: list[ResolutionResult]
    ) -> dict[int, list[tuple[int, ResolutionResult]]]:
        """Group resolved requests by historical_year from metadata.

        Args:
            resolution_list: List of resolution results

        Returns:
            Dict mapping year -> list of (index, ResolutionResult)
        """
        by_year: dict[int, list[tuple[int, ResolutionResult]]] = {}

        for idx, res_result in enumerate(resolution_list):
            if not res_result.is_resolved or not res_result.person:
                continue

            # Check for historical_year in metadata
            metadata = res_result.metadata or {}
            historical_year = metadata.get("historical_year")
            if historical_year:
                if historical_year not in by_year:
                    by_year[historical_year] = []
                by_year[historical_year].append((idx, res_result))

        return by_year

    def _verify_year_group(
        self,
        requester_cm_id: int,
        year: int,
        year_items: list[tuple[int, ResolutionResult]],
        resolution_list: list[ResolutionResult],
    ) -> tuple[int, int]:
        """Verify a single year's group and update resolutions.

        Args:
            requester_cm_id: CM ID of the requester
            year: Historical year to verify
            year_items: List of (index, ResolutionResult) for this year
            resolution_list: Full resolution list (modified in place)

        Returns:
            Tuple of (verified_count, unverified_count)
        """
        # Get target CM IDs for this year's group
        target_ids = [res.person.cm_id for _, res in year_items if res.person and res.person.cm_id]

        if not target_ids:
            return 0, 0

        # Verify they were all in same bunk
        if self._temporal_cache is None:
            return 0, 0
        were_together, bunk_name = self._temporal_cache.verify_bunk_together(requester_cm_id, target_ids, year)

        if were_together:
            logger.info(
                f"✓ Verified: {len(target_ids)} campers were in {bunk_name} "
                f"together in {year} for requester {requester_cm_id}"
            )
            self._apply_verification_boost(year_items, resolution_list, bunk_name)
            return len(year_items), 0
        else:
            logger.warning(f"✗ Could not verify all campers were together in {year} for requester {requester_cm_id}")
            self._mark_unverified(year_items, resolution_list)
            return 0, len(year_items)

    def _apply_verification_boost(
        self,
        year_items: list[tuple[int, ResolutionResult]],
        resolution_list: list[ResolutionResult],
        bunk_name: str,
    ) -> None:
        """Apply confidence boost to verified group.

        Args:
            year_items: List of (index, ResolutionResult) for verified group
            resolution_list: Full resolution list (modified in place)
            bunk_name: Name of the verified bunk
        """
        for idx, res_result in year_items:
            if res_result.confidence < 0.95:
                new_confidence = min(0.95, res_result.confidence + 0.10)
                resolution_list[idx] = self._create_updated_result(
                    res_result,
                    confidence=new_confidence,
                    verified=True,
                    bunk_name=bunk_name,
                )
            else:
                # Already high confidence, just add metadata
                resolution_list[idx] = self._create_updated_result(
                    res_result,
                    confidence=res_result.confidence,
                    verified=True,
                    bunk_name=bunk_name,
                )

    def _mark_unverified(
        self,
        year_items: list[tuple[int, ResolutionResult]],
        resolution_list: list[ResolutionResult],
    ) -> None:
        """Mark group as unverified (don't reduce confidence).

        Args:
            year_items: List of (index, ResolutionResult) for unverified group
            resolution_list: Full resolution list (modified in place)
        """
        for idx, res_result in year_items:
            resolution_list[idx] = self._create_updated_result(
                res_result,
                confidence=res_result.confidence,
                verified=False,
                bunk_name=None,
            )

    def _create_updated_result(
        self,
        original: ResolutionResult,
        confidence: float,
        verified: bool,
        bunk_name: str | None,
    ) -> ResolutionResult:
        """Create an updated ResolutionResult with verification metadata.

        Args:
            original: Original resolution result
            confidence: Updated confidence value
            verified: Whether group was verified
            bunk_name: Name of verified bunk (or None)

        Returns:
            New ResolutionResult with updated values
        """
        metadata: dict[str, Any] = {**(original.metadata or {})}
        metadata["historical_group_verified"] = verified
        if bunk_name:
            metadata["verified_bunk"] = bunk_name

        return ResolutionResult(
            person=original.person,
            confidence=confidence,
            method=original.method,
            candidates=original.candidates,
            metadata=metadata,
        )
