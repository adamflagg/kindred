"""Canonical request-classification registry.

Single source of truth for the two axes keyed by (source_field, request_type):

  * Reporting axis  — `report_group` (which scorecard bucket) + `counted`
    (does it roll into the headline satisfaction %). Consumed by
    `bunking.satisfaction.aggregate` via `classify_request` / `COUNTED_BUCKETS`.
  * Solver axis     — `rule` (HARD_MSO / HARD_MNT / SOFT) + `weight_key`
    (config suffix for the objective multiplier).

One row per valid combo. `report_group` and `weight_key` are both currently
source-determined; `_build_source_to_group` and `_build_weight_key_by_source`
enforce that invariant at import (raises if a source's rows disagree).
  * `weight_key` is consumed by the objective evaluators via `weight_for`
    (Phase 3). For off-axis combos absent from the registry, `weight_for` falls
    back to the source-keyed projection — preserving the pre-Phase-3 lookup
    semantics on synthetic fixtures and off-axis data.
  * `rule == HARD_MNT` is a DECLARED placeholder for deferred staff-hardening
    (#1543 / #1541); it is not enforced. `parent_paramount` still detects MP via
    `is_material_parent_request` (report_group == MATERIAL_PARENT).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SourceField

if TYPE_CHECKING:
    from bunking.config import ConfigLoader

_MULT = "objective.source_multipliers"


class RequestBucket(StrEnum):
    """Reporting bucket — the scorecard grouping a request rolls into."""

    MATERIAL_PARENT = "material_parent"
    IMMATERIAL_PARENT = "immaterial_parent"
    STAFF = "staff"


class SolverRule(StrEnum):
    """Constraint shape the solver should generate for a request.

    HARD_MNT is declared but NOT enforced as of this PR — see module docstring.
    """

    HARD_MSO = "hard_mso"
    HARD_MNT = "hard_mnt"
    SOFT = "soft"


@dataclass(frozen=True, slots=True)
class RequestClass:
    """All classification properties for one (source_field, request_type) combo."""

    report_group: RequestBucket
    counted: bool
    rule: SolverRule
    weight_key: str | None


_MP = RequestBucket.MATERIAL_PARENT
_IMP = RequestBucket.IMMATERIAL_PARENT
_STAFF = RequestBucket.STAFF

_BW = RequestType.BUNK_WITH.value
_NBW = RequestType.NOT_BUNK_WITH.value
_AGE = RequestType.AGE_PREFERENCE.value

_REGISTRY: dict[tuple[str, str], RequestClass] = {
    # Parent bunk-request form — flexible type, all MATERIAL_PARENT / HARD_MSO.
    (SourceField.BUNK_REQUEST_FORM, _BW): RequestClass(_MP, True, SolverRule.HARD_MSO, f"{_MULT}.share_bunk_with"),
    (SourceField.BUNK_REQUEST_FORM, _NBW): RequestClass(_MP, True, SolverRule.HARD_MSO, f"{_MULT}.share_bunk_with"),
    (SourceField.BUNK_REQUEST_FORM, _AGE): RequestClass(_MP, True, SolverRule.HARD_MSO, f"{_MULT}.share_bunk_with"),
    # Parent socialize-with dropdown — strict age_preference, informational.
    (SourceField.SOCIALIZE_WITH, _AGE): RequestClass(_IMP, False, SolverRule.SOFT, f"{_MULT}.socialize_preference"),
    # Staff "do not bunk with" — strict not_bunk_with. HARD_MNT = deferred target.
    (SourceField.STAFF_NOT_BUNK_WITH, _NBW): RequestClass(
        _STAFF, True, SolverRule.HARD_MNT, f"{_MULT}.do_not_share_with"
    ),
    # AI-parsed bunking notes — flexible type, soft.
    (SourceField.BUNKING_NOTES, _BW): RequestClass(_STAFF, True, SolverRule.SOFT, f"{_MULT}.bunking_notes"),
    (SourceField.BUNKING_NOTES, _NBW): RequestClass(_STAFF, True, SolverRule.SOFT, f"{_MULT}.bunking_notes"),
    (SourceField.BUNKING_NOTES, _AGE): RequestClass(_STAFF, True, SolverRule.SOFT, f"{_MULT}.bunking_notes"),
    # AI-parsed internal notes — flexible type, soft.
    (SourceField.INTERNAL_NOTES, _BW): RequestClass(_STAFF, True, SolverRule.SOFT, f"{_MULT}.internal_notes"),
    (SourceField.INTERNAL_NOTES, _NBW): RequestClass(_STAFF, True, SolverRule.SOFT, f"{_MULT}.internal_notes"),
    (SourceField.INTERNAL_NOTES, _AGE): RequestClass(_STAFF, True, SolverRule.SOFT, f"{_MULT}.internal_notes"),
    # Admin-UI manual entries — no config multiplier today (→ 1.0 default).
    (SourceField.MANUAL, _BW): RequestClass(_STAFF, True, SolverRule.SOFT, None),
    (SourceField.MANUAL, _NBW): RequestClass(_STAFF, True, SolverRule.HARD_MNT, None),
    (SourceField.MANUAL, _AGE): RequestClass(_STAFF, True, SolverRule.SOFT, None),
}


def _build_source_to_group() -> dict[str, RequestBucket]:
    """Project the registry onto source_field, asserting report_group consistency."""
    mapping: dict[str, RequestBucket] = {}
    for (source, _rtype), rc in _REGISTRY.items():
        existing = mapping.get(source)
        if existing is not None and existing != rc.report_group:
            raise AssertionError(
                f"report_group for source {source!r} is not source-determined "
                f"({existing} vs {rc.report_group}); a new bucket split is required"
            )
        mapping[source] = rc.report_group
    return mapping


_SOURCE_TO_GROUP: dict[str, RequestBucket] = _build_source_to_group()

COUNTED_BUCKETS: frozenset[RequestBucket] = frozenset(rc.report_group for rc in _REGISTRY.values() if rc.counted)

# Per-config-key fallback defaults — the values the objective evaluators
# (score_evaluator / objective_evaluator) hardcode, mirroring the seed in
# pocketbase/pb_migrations/1500000011_config.js. `weight_for` passes these so a
# config missing the key reproduces the evaluators' historical fallback exactly.
_WEIGHT_DEFAULTS: dict[str, float] = {
    f"{_MULT}.share_bunk_with": 1.75,
    f"{_MULT}.do_not_share_with": 1.5,
    f"{_MULT}.bunking_notes": 1.0,
    f"{_MULT}.internal_notes": 1.0,
    f"{_MULT}.socialize_preference": 0.6,
}

# Invariant (enforced at import, like the report_group projection above): every
# weight_key the registry declares must have a default, or `weight_for` would
# KeyError at runtime. A new row without a matching default fails loudly here.
_missing_weight_defaults = sorted(
    key for rc in _REGISTRY.values() if (key := rc.weight_key) is not None and key not in _WEIGHT_DEFAULTS
)
if _missing_weight_defaults:
    raise AssertionError(f"weight_key(s) lack a _WEIGHT_DEFAULTS entry: {_missing_weight_defaults}")


def _build_weight_key_by_source() -> dict[str, str | None]:
    """Project the registry onto source_field, asserting weight_key consistency.

    Today weight_key is source-determined: every row of a given source shares
    one weight_key (mirroring `report_group`). This projection powers
    `weight_for`'s source-keyed fallback for off-axis combos (strict source +
    a request_type the registry doesn't admit), which preserves the
    pre-Phase-3 evaluator semantics where the multiplier keyed on source_field
    alone. If a future row makes weight_key request_type-dependent, this
    raises — that's the signal that the fallback path needs to go away and a
    per-(source,type) config split is required (Phase 4 / #1218).
    """
    mapping: dict[str, str | None] = {}
    sentinel: object = object()
    for (source, _rtype), rc in _REGISTRY.items():
        existing: str | None | object = mapping.get(source, sentinel)
        if existing is not sentinel and existing != rc.weight_key:
            raise AssertionError(
                f"weight_key for source {source!r} is not source-determined "
                f"({existing} vs {rc.weight_key}); a per-(source,type) config "
                f"split is required — see solver-config-it #1218"
            )
        mapping[source] = rc.weight_key
    return mapping


_WEIGHT_KEY_BY_SOURCE: dict[str, str | None] = _build_weight_key_by_source()


def classify(source_field: str, request_type: str) -> RequestClass:
    """Full classification for a (source_field, request_type) combo. Raises on unknown."""
    rc = _REGISTRY.get((source_field, request_type))
    if rc is None:
        raise ValueError(
            f"unknown (source_field, request_type) combo "
            f"({source_field!r}, {request_type!r}); expected one of {sorted(_REGISTRY)}"
        )
    return rc


def report_group_for(source_field: str) -> RequestBucket:
    """Reporting bucket for a source_field (source-determined). Raises on unknown."""
    bucket = _SOURCE_TO_GROUP.get(source_field)
    if bucket is None:
        raise ValueError(f"unknown source_field {source_field!r}; expected one of {sorted(_SOURCE_TO_GROUP)}")
    return bucket


def rule_for(source_field: str, request_type: str) -> SolverRule:
    """Solver rule for a combo. SCAFFOLD — no consumer reads this yet."""
    return classify(source_field, request_type).rule


def weight_key_for(source_field: str, request_type: str) -> str | None:
    """Objective multiplier config key for a combo. Raises on unknown combo."""
    return classify(source_field, request_type).weight_key


def weight_for(source_field: str, request_type: str, config: ConfigLoader) -> float:
    """Objective multiplier for a (source_field, request_type) combo.

    Resolves the registry's weight_key for the combo and looks it up in
    `config`, falling back to the per-key default in `_WEIGHT_DEFAULTS`. For
    combos absent from the registry (synthetic fixtures or off-axis data
    pairing a strict source with a request_type it doesn't admit), falls back
    to the source-keyed projection — preserving the pre-Phase-3 evaluator
    semantics where the multiplier keyed on source_field alone. Today this
    fallback returns the same value as the strict lookup for every valid combo
    (weight_key is source-determined; see `_build_weight_key_by_source`).

    Returns neutral 1.0 if the source has no weight_key (manual rows) or is
    unknown to the registry entirely.
    """
    rc = _REGISTRY.get((source_field, request_type))
    key = rc.weight_key if rc is not None else _WEIGHT_KEY_BY_SOURCE.get(source_field)
    if key is None:
        return 1.0
    return config.get_float(key, default=_WEIGHT_DEFAULTS[key])
