"""What a request's addition says about it (PR 3): who added it, why, whether a rule-made one is reviewed, and which
of its rounds are posted. One builder for Form intake's Became and the household page's request card, so the two agree.
Pure: callers pass the season's additions and folded rounds."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from api.schemas.financial_aid_form_intake import RequestAdditionOut
from api.services.financial_aid_intake_types import (
    ADDITION_SOURCE_REGISTRATION_ASK,
    ORIGIN_FORM,
    AdditionRecord,
    RequestKey,
    RequestRecord,
    request_origin,
)
from bunking.financial_aid.decisions.rounds import RoundState


def additions_by_request_key(additions: Iterable[AdditionRecord]) -> dict[RequestKey, AdditionRecord]:
    """Each request key's addition: the live one when there is one, else the latest retired one (a retired addition's
    request keeps its key, and a re-add revives it)."""
    ordered = sorted(additions, key=lambda a: (a.live, a.created, a.id))
    return {a.request_key: a for a in ordered}


def posted_rounds(rounds: Mapping[int, RoundState]) -> list[int]:
    return sorted(n for n, state in rounds.items() if state.posted)


def addition_view(
    request: RequestRecord, by_key: Mapping[RequestKey, AdditionRecord], rounds: Mapping[int, RoundState]
) -> RequestAdditionOut | None:
    """The request's addition, or None for a request the aid form made (or one whose addition is not read)."""
    origin = request_origin(request.program_option_key)
    addition = by_key.get(request.key) if origin != ORIGIN_FORM else None
    if addition is None:
        return None
    rule_made = addition.source == ADDITION_SOURCE_REGISTRATION_ASK
    return RequestAdditionOut(
        addition_id=addition.id,
        origin=origin,
        added_by=addition.actor,
        added_at=addition.created,
        added_reason=addition.reason,
        reviewed=addition.reviewed if rule_made else None,
        reviewed_by=addition.reviewed_by,
        reviewed_at=addition.reviewed_at,
        posted_rounds=posted_rounds(rounds),
        live=addition.live,
    )
