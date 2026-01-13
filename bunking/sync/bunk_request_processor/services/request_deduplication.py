"""AI Request Text Deduplication Service

Groups identical request texts together, parses them once via AI,
and clones results to all requesters sharing the same text.

This saves AI API costs when multiple requesters have the same
request text (e.g., "John Smith" appears in multiple forms)."""

from __future__ import annotations

import re
from copy import deepcopy

from ..core.models import ParseRequest, ParseResult


def normalize_request_text(text: str) -> str:
    """Normalize request text for deduplication matching.

    Performs case-insensitive, whitespace-normalized comparison.

    Args:
        text: Raw request text

    Returns:
        Normalized text key for grouping
    """
    # Lowercase
    normalized = text.lower()
    # Collapse all whitespace (tabs, multiple spaces) to single space
    normalized = re.sub(r"\s+", " ", normalized)
    # Strip leading/trailing whitespace
    normalized = normalized.strip()
    return normalized


def group_by_request_text(requests: list[ParseRequest]) -> dict[str, list[ParseRequest]]:
    """Group ParseRequests by their normalized request text.

    Args:
        requests: List of ParseRequest objects to group

    Returns:
        Dict mapping normalized text to list of ParseRequests with that text
    """
    groups: dict[str, list[ParseRequest]] = {}

    for request in requests:
        key = normalize_request_text(request.request_text)
        if key not in groups:
            groups[key] = []
        groups[key].append(request)

    return groups


def get_representative_requests(groups: dict[str, list[ParseRequest]]) -> list[ParseRequest]:
    """Select one representative request per group for AI parsing.

    Args:
        groups: Dict mapping normalized text to list of ParseRequests

    Returns:
        List of representative ParseRequest objects (one per unique text)
    """
    representatives = []
    for requests in groups.values():
        # Use the first request as the representative
        representatives.append(requests[0])
    return representatives


def clone_parse_result(original: ParseResult, new_request: ParseRequest) -> ParseResult:
    """Clone a ParseResult with a new parse_request.

    Creates a deep copy of the parsed_requests so modifications
    to the clone don't affect the original.

    Args:
        original: The original ParseResult from AI parsing
        new_request: The new ParseRequest to associate with the clone

    Returns:
        New ParseResult with cloned data and updated parse_request
    """
    # Deep copy parsed_requests so each requester has independent objects
    cloned_parsed_requests = deepcopy(original.parsed_requests)

    # Copy metadata and add deduplication info
    cloned_metadata = dict(original.metadata) if original.metadata else {}
    cloned_metadata["deduplicated"] = True
    if original.parse_request is not None:
        cloned_metadata["original_requester_cm_id"] = original.parse_request.requester_cm_id

    return ParseResult(
        parsed_requests=cloned_parsed_requests,
        needs_historical_context=original.needs_historical_context,
        is_valid=original.is_valid,
        parse_request=new_request,
        metadata=cloned_metadata,
    )


class RequestDeduplicator:
    """Handles deduplication of AI parsing requests.

    Usage:
        deduplicator = RequestDeduplicator()

        # Get unique requests for AI parsing
        unique_requests, mapping = deduplicator.deduplicate(all_requests)

        # Send unique_requests to AI, get results
        ai_results = await ai_service.batch_parse(unique_requests)

        # Expand results back to all original requesters
        all_results = deduplicator.expand_results(ai_results, mapping)
    """

    def __init__(self) -> None:
        self._stats: dict[str, int] = {"total_requests": 0, "unique_texts": 0, "requests_saved": 0}

    def deduplicate(self, requests: list[ParseRequest]) -> tuple[list[ParseRequest], dict[str, list[ParseRequest]]]:
        """Deduplicate requests by text, returning unique requests and mapping.

        Args:
            requests: List of all ParseRequest objects

        Returns:
            Tuple of:
            - List of unique requests (one per distinct text)
            - Mapping from normalized text to all requests with that text
        """
        self._stats["total_requests"] = len(requests)

        # Group by normalized text
        groups = group_by_request_text(requests)
        self._stats["unique_texts"] = len(groups)
        self._stats["requests_saved"] = len(requests) - len(groups)

        # Get one representative per group
        unique_requests = get_representative_requests(groups)

        return unique_requests, groups

    def expand_results(
        self, ai_results: list[ParseResult], unique_requests: list[ParseRequest], mapping: dict[str, list[ParseRequest]]
    ) -> list[ParseResult]:
        """Expand AI results to all original requesters.

        Args:
            ai_results: List of ParseResult objects (in same order as unique_requests)
            unique_requests: List of representative requests sent to AI
            mapping: Dict mapping normalized text to all ParseRequests with that text

        Returns:
            List of ParseResult objects, one for each original request
        """
        expanded = []

        # Build lookup from representative request to result
        rep_to_result: dict[int, ParseResult] = {}
        for rep_request, result in zip(unique_requests, ai_results, strict=False):
            rep_to_result[id(rep_request)] = result

        # For each group, clone the result to all members
        for _normalized_text, requests in mapping.items():
            # First request in each group was the representative
            representative = requests[0]
            rep_result: ParseResult | None = rep_to_result.get(id(representative))

            if rep_result is None:
                continue

            result_to_use: ParseResult = rep_result
            for request in requests:
                if request is representative:
                    # Original result for the representative
                    expanded.append(result_to_use)
                else:
                    # Clone result for other requesters
                    cloned = clone_parse_result(result_to_use, request)
                    expanded.append(cloned)

        return expanded

    def get_stats(self) -> dict[str, int]:
        """Get deduplication statistics.

        Returns:
            Dict with keys: total_requests, unique_texts, requests_saved
        """
        return dict(self._stats)
