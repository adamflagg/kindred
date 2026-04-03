"""Batch signal detection for resolution results.

Detects signals that require cross-request visibility:
- Reciprocal: A requested B AND B requested A (same session, same type)
- Household co-request: requester's sibling also requested same target
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from ..core.models import RequestType


@dataclass
class ResolvedRequest:
    """Minimal info needed for batch signal detection."""

    requester_cm_id: int
    target_cm_id: int
    request_type: RequestType
    session_cm_id: int
    household_id: int | None = None


@dataclass
class BatchSignals:
    """Batch-level signals for a single request."""

    is_reciprocal: bool = False
    reciprocal_with: int | None = None
    household_co_request: bool = False
    household_co_requester: int | None = None


def detect_batch_signals(
    resolved_requests: list[ResolvedRequest],
) -> dict[tuple[int, int, int], BatchSignals]:
    """Detect batch signals across all resolved requests.

    Returns dict keyed by (requester_cm_id, target_cm_id, session_cm_id).
    """
    if not resolved_requests:
        return {}

    # Initialize signals for every request
    signals: dict[tuple[int, int, int], BatchSignals] = {}
    for req in resolved_requests:
        key = (req.requester_cm_id, req.target_cm_id, req.session_cm_id)
        if key not in signals:
            signals[key] = BatchSignals()

    # --- Reciprocal detection ---
    request_set: set[tuple[int, int, str, int]] = set()
    for req in resolved_requests:
        request_set.add((req.requester_cm_id, req.target_cm_id, req.request_type.value, req.session_cm_id))

    for req in resolved_requests:
        reverse = (req.target_cm_id, req.requester_cm_id, req.request_type.value, req.session_cm_id)
        if reverse in request_set:
            key = (req.requester_cm_id, req.target_cm_id, req.session_cm_id)
            signals[key].is_reciprocal = True
            signals[key].reciprocal_with = req.target_cm_id

    # --- Household co-request detection ---
    # Group by (target_cm_id, session_cm_id) to find multiple requesters for same target
    target_groups: dict[tuple[int, int], list[ResolvedRequest]] = defaultdict(list)
    for req in resolved_requests:
        if req.household_id is not None:
            target_groups[(req.target_cm_id, req.session_cm_id)].append(req)

    for (target, session), requesters in target_groups.items():
        # Group requesters by household_id
        household_members: dict[int, list[ResolvedRequest]] = defaultdict(list)
        for req in requesters:
            assert req.household_id is not None  # guaranteed by filter at line 70
            household_members[req.household_id].append(req)

        for members in household_members.values():
            # Need 2+ DIFFERENT requesters from same household
            unique_requesters = {m.requester_cm_id for m in members}
            if len(unique_requesters) >= 2:
                for req in members:
                    key = (req.requester_cm_id, target, session)
                    if key in signals:
                        signals[key].household_co_request = True
                        # Find the sibling (first different requester)
                        for other in members:
                            if other.requester_cm_id != req.requester_cm_id:
                                signals[key].household_co_requester = other.requester_cm_id
                                break

    return signals
