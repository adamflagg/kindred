"""
Shared impossibility detection for hard solver constraints.

Each hard-constraint module registers a HardConstraintImpossibility
predicate via HARD_CONSTRAINT_REGISTRY. ``validate_impossibility``
runs all registered predicates in two layers (request, pair)
and returns a structured ``ImpossibilityReport``.

Both ``api.routers.solver.pre_validate_solver`` and
``DirectBunkingSolver._validate_requests`` delegate here. The registry
discipline test (``tests/unit/solver/impossibility/test_registry.py``)
asserts every hard-constraint module has a matching predicate.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput


class ImpossibilityReason(NamedTuple):
    code: str
    message: str
    detail: dict[str, Any]


@dataclass(frozen=True)
class ImpossibilityContext:
    """Read-only context passed to predicates. Predicates never mutate."""

    input: DirectSolverInput
    config: ConfigLoader
    person_by_cm_id: dict[int, DirectPerson]
    person_session: dict[int, int]
    bunks_by_session: dict[int, list[DirectBunk]]


@dataclass
class ImpossibleItem:
    request_id: str
    reason_code: str
    reason_message: str
    request_type: str
    requester: dict[str, Any]
    requestee: dict[str, Any] | None
    detail: dict[str, Any]


@dataclass
class ImpossibilityReport:
    total_impossible: int = 0
    affected_campers: int = 0
    by_reason: dict[str, list[ImpossibleItem]] = field(default_factory=dict)
    flat: list[ImpossibleItem] = field(default_factory=list)


class HardConstraintImpossibility:
    """Base class for per-constraint impossibility predicates.

    Override the layers that apply. Default returns None (not impossible).
    Subclasses MUST set ``name`` to a unique string.
    """

    name: str = ""

    def check_request(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        return None

    def check_pair(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        return None


HARD_CONSTRAINT_REGISTRY: list[HardConstraintImpossibility] = []


def register(predicate: HardConstraintImpossibility) -> None:
    """Append a predicate to the registry. Idempotent by name."""
    if not predicate.name:
        raise ValueError(f"Predicate {type(predicate).__name__} must set .name")
    if any(p.name == predicate.name for p in HARD_CONSTRAINT_REGISTRY):
        return
    HARD_CONSTRAINT_REGISTRY.append(predicate)


def _camper_dict(person: DirectPerson) -> dict[str, Any]:
    return {
        "cm_id": person.campminder_person_id,
        "name": f"{person.first_name} {person.last_name}".strip(),
        "grade": person.grade,
        "gender": person.gender,
    }


def _record_item(
    report: ImpossibilityReport,
    req: DirectBunkRequest,
    reason: ImpossibilityReason,
    ctx: ImpossibilityContext,
) -> None:
    requester = ctx.person_by_cm_id.get(req.requester_person_cm_id)
    requestee = ctx.person_by_cm_id.get(req.requested_person_cm_id) if req.requested_person_cm_id else None
    item = ImpossibleItem(
        request_id=req.id,
        reason_code=reason.code,
        reason_message=reason.message,
        request_type=req.request_type,
        requester=_camper_dict(requester) if requester else {"cm_id": req.requester_person_cm_id},
        requestee=_camper_dict(requestee) if requestee else None,
        detail=reason.detail,
    )
    report.flat.append(item)
    report.by_reason.setdefault(reason.code, []).append(item)


def _build_context(input_data: DirectSolverInput, config: ConfigLoader) -> ImpossibilityContext:
    person_by_cm_id = {p.campminder_person_id: p for p in input_data.persons}
    person_session = {p.campminder_person_id: p.session_cm_id for p in input_data.persons}
    bunks_by_session: dict[int, list[DirectBunk]] = defaultdict(list)
    for bunk in input_data.bunks:
        bunks_by_session[bunk.session_cm_id].append(bunk)
    return ImpossibilityContext(
        input=input_data,
        config=config,
        person_by_cm_id=person_by_cm_id,
        person_session=person_session,
        bunks_by_session=dict(bunks_by_session),
    )


def validate_impossibility(input_data: DirectSolverInput, config: ConfigLoader) -> ImpossibilityReport:
    """Run all registered predicates. Returns structured report."""
    ctx = _build_context(input_data, config)
    report = ImpossibilityReport()
    seen: set[str] = set()

    # Layer 1: per-request
    for req in input_data.requests:
        if req.id in seen:
            continue
        for predicate in HARD_CONSTRAINT_REGISTRY:
            reason = predicate.check_request(req, ctx)
            if reason is not None:
                _record_item(report, req, reason, ctx)
                seen.add(req.id)
                break

    # Layer 2: per-pair
    for req in input_data.requests:
        if req.id in seen:
            continue
        if req.request_type not in ("bunk_with", "not_bunk_with"):
            continue
        for predicate in HARD_CONSTRAINT_REGISTRY:
            reason = predicate.check_pair(req, ctx)
            if reason is not None:
                _record_item(report, req, reason, ctx)
                seen.add(req.id)
                break

    report.total_impossible = len(report.flat)
    report.affected_campers = len({item.requester.get("cm_id") for item in report.flat if item.requester.get("cm_id")})
    return report


# ---- Predicate registrations (populated by individual constraint modules) ----
# Import-time side-effect: each constraint module's predicate registers itself
# when imported. We import below to ensure all predicates are loaded when
# validate_impossibility is called. Order is not significant.

# Trigger predicate registration via import side-effects.
from bunking.solver.constraints import (  # noqa: E402, F401
    age_preference as _age_preference_module,
)
