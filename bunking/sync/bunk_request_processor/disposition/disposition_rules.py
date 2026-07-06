"""Post-resolution disposition rules.

Determines RESOLVED/PENDING/DECLINED for resolved matches.
Unresolved names (person=None or cm_id<0) are PENDING by definition
and never reach these rules — with one exception: stale dated notes
(#1801) decline even when the name is unresolved, so a 3+ year old
note can't linger in the review queue.

Otherwise rules only apply AFTER resolution (Phase 2 or Phase 3) has
identified a candidate person. Business gates check enrollment/session.
Resolution quality checks determine auto-resolve vs staff review.
"""

from dataclasses import dataclass

from ..core.models import RequestStatus, RequestType

# Auto-resolve threshold for non-exact, non-reciprocal resolved matches.
# Same as the current pipeline default. Tunable.
AUTO_RESOLVE_THRESHOLD = 0.85

# NOT_BUNK_WITH is more permissive — incorrectly leaving a separation
# for review is less harmful than incorrectly enforcing one.
NOT_BUNK_WITH_THRESHOLD = 0.80

# Reciprocal matches require a confidence floor to prevent wrong-person
# auto-resolves where Phase 3 AI picked the wrong person but the reciprocal
# signal coincidentally existed.
RECIPROCAL_MIN_CONFIDENCE = 0.70


@dataclass(frozen=True)
class Disposition:
    """Result of applying disposition rules to a resolved match."""

    status: RequestStatus
    reason: str
    rule_id: int


# NOTE: disposition_reason is the output of this rules engine. It considers
# batch signals (is_reciprocal, household_co_request) among other factors.
# See batch_signals.py for how input signals are detected.
def determine_disposition(
    request_type: RequestType,
    *,
    resolution_method: str = "unknown",
    match_confidence: float = 0.0,
    is_reciprocal: bool = False,
    requester_is_inactive: bool = False,
    target_is_inactive: bool = False,
    target_has_bunking_session: bool = True,
    target_waitlisted: bool = False,
    session_match: bool = True,
    age_direction: str | None = None,
    auto_resolve_threshold: float = AUTO_RESOLVE_THRESHOLD,
    is_stale_dated_note: bool = False,
) -> Disposition:
    """Apply priority-ordered disposition rules to a resolved match.

    Args are keyword-only to make call sites self-documenting.
    """
    # Requester not attending takes priority over all other rules
    if requester_is_inactive:
        return Disposition(RequestStatus.DECLINED, "requester_not_attending", 0)

    # #1801: a staff-note entry dated 3+ years before the current season is
    # historical record, not current intent — decline across all request types.
    # Staff can flip it back to resolved in request management if it still matters.
    if is_stale_dated_note:
        return Disposition(RequestStatus.DECLINED, "stale_dated_note", 9)

    if request_type == RequestType.AGE_PREFERENCE:
        return _age_preference_rules(age_direction)
    if request_type == RequestType.NOT_BUNK_WITH:
        return _not_bunk_with_rules(
            match_confidence=match_confidence,
            target_is_inactive=target_is_inactive,
            target_has_bunking_session=target_has_bunking_session,
            target_waitlisted=target_waitlisted,
            session_match=session_match,
        )
    return _bunk_with_rules(
        resolution_method=resolution_method,
        match_confidence=match_confidence,
        is_reciprocal=is_reciprocal,
        target_is_inactive=target_is_inactive,
        target_has_bunking_session=target_has_bunking_session,
        target_waitlisted=target_waitlisted,
        session_match=session_match,
        auto_resolve_threshold=auto_resolve_threshold,
    )


def _bunk_with_rules(
    *,
    resolution_method: str,
    match_confidence: float,
    is_reciprocal: bool,
    target_is_inactive: bool,
    target_has_bunking_session: bool,
    target_waitlisted: bool,
    session_match: bool,
    auto_resolve_threshold: float = AUTO_RESOLVE_THRESHOLD,
) -> Disposition:
    # Business gates (priority order)
    if target_is_inactive:
        return Disposition(RequestStatus.DECLINED, "target_not_attending", 1)
    if not target_has_bunking_session:
        return Disposition(RequestStatus.DECLINED, "target_not_enrolled", 2)
    if target_waitlisted:
        return Disposition(RequestStatus.PENDING, "target_waitlisted", 3)
    if not session_match:
        return Disposition(RequestStatus.DECLINED, "session_mismatch", 4)

    # Resolution quality
    if resolution_method == "exact_match":
        return Disposition(RequestStatus.RESOLVED, "exact_match", 5)
    if is_reciprocal and match_confidence >= RECIPROCAL_MIN_CONFIDENCE:
        return Disposition(RequestStatus.RESOLVED, "reciprocal_match", 6)
    if not is_reciprocal and match_confidence >= auto_resolve_threshold:
        return Disposition(RequestStatus.RESOLVED, "high_confidence_match", 7)

    # Catch-all
    return Disposition(RequestStatus.PENDING, "needs_review", 8)


def _not_bunk_with_rules(
    *,
    match_confidence: float,
    target_is_inactive: bool,
    target_has_bunking_session: bool,
    target_waitlisted: bool,
    session_match: bool,
) -> Disposition:
    if target_is_inactive or not target_has_bunking_session:
        return Disposition(RequestStatus.DECLINED, "target_not_attending", 1)
    if target_waitlisted:
        return Disposition(RequestStatus.PENDING, "target_waitlisted", 2)
    if not session_match and match_confidence >= NOT_BUNK_WITH_THRESHOLD:
        return Disposition(RequestStatus.RESOLVED, "cross_session_satisfied", 3)
    if match_confidence >= NOT_BUNK_WITH_THRESHOLD:
        return Disposition(RequestStatus.RESOLVED, "auto_resolved", 4)
    return Disposition(RequestStatus.PENDING, "needs_review", 5)


def _age_preference_rules(age_direction: str | None) -> Disposition:
    if age_direction is not None:
        return Disposition(RequestStatus.RESOLVED, "directional_preference", 1)
    return Disposition(RequestStatus.PENDING, "undirected_preference", 2)
