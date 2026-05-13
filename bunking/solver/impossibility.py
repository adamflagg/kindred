"""
Shared impossibility detection for hard solver constraints.

Each hard-constraint module registers a HardConstraintImpossibility
predicate via HARD_CONSTRAINT_REGISTRY. ``validate_impossibility``
runs all registered predicates in three layers (request, pair,
cluster) and returns a structured ``ImpossibilityReport``.

Both ``api.routers.solver.pre_validate_solver`` and
``DirectBunkingSolver._validate_requests`` delegate here. The registry
discipline test (``tests/unit/solver/impossibility/test_registry.py``)
asserts every hard-constraint module has a matching predicate.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field, replace
from typing import Any, NamedTuple

from bunking.config import ConfigLoader
from bunking.models_v2 import DirectBunk, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.satisfaction.bucket import is_material_parent_request


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
    bunk_with_components: list[set[int]] = field(default_factory=list)


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
class ImpossibleCluster:
    reason_code: str
    reason_message: str
    cm_ids: list[int]
    campers: list[dict[str, Any]]
    detail: dict[str, Any]


@dataclass
class ImpossibilityReport:
    total_impossible: int = 0
    affected_campers: int = 0
    by_reason: dict[str, list[ImpossibleItem]] = field(default_factory=dict)
    flat: list[ImpossibleItem] = field(default_factory=list)
    clusters: list[ImpossibleCluster] = field(default_factory=list)


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

    def check_cluster(self, component_cms: set[int], ctx: ImpossibilityContext) -> ImpossibilityReason | None:
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


def _record_cluster(
    report: ImpossibilityReport,
    component: set[int],
    reason: ImpossibilityReason,
    ctx: ImpossibilityContext,
) -> None:
    campers = [_camper_dict(ctx.person_by_cm_id[cm]) for cm in sorted(component) if cm in ctx.person_by_cm_id]
    report.clusters.append(
        ImpossibleCluster(
            reason_code=reason.code,
            reason_message=reason.message,
            cm_ids=sorted(component),
            campers=campers,
            detail=reason.detail,
        )
    )


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


def _compute_bunk_with_components(input_data: DirectSolverInput, ctx: ImpossibilityContext) -> list[set[int]]:
    """Union-find over MP bunk_with edges. Returns list of components >= 2."""
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent.get(x, x), parent.get(x, x))
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for req in input_data.requests:
        if req.request_type != "bunk_with":
            continue
        if not is_material_parent_request(req):
            continue
        if req.requester_person_cm_id not in ctx.person_by_cm_id:
            continue
        requestee = req.requested_person_cm_id
        if not requestee or requestee not in ctx.person_by_cm_id:
            continue
        parent.setdefault(req.requester_person_cm_id, req.requester_person_cm_id)
        parent.setdefault(requestee, requestee)
        union(req.requester_person_cm_id, requestee)

    groups: dict[int, set[int]] = defaultdict(set)
    for cm in parent:
        groups[find(cm)].add(cm)
    return [g for g in groups.values() if len(g) >= 2]


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

    # Layer 3: cluster (only when any predicate overrides check_cluster)
    has_cluster_impls = any(
        type(p).check_cluster is not HardConstraintImpossibility.check_cluster for p in HARD_CONSTRAINT_REGISTRY
    )
    if has_cluster_impls:
        components = _compute_bunk_with_components(input_data, ctx)
        ctx_components = replace(ctx, bunk_with_components=components)
        for component in components:
            for predicate in HARD_CONSTRAINT_REGISTRY:
                reason = predicate.check_cluster(component, ctx_components)
                if reason is not None:
                    _record_cluster(report, component, reason, ctx_components)
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
    gender as _gender_module,
    session_boundary as _session_boundary_module,
)
