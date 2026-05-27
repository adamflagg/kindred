"""Exhaustive table tests for the request-classification registry.

The registry is the single source of truth for the two axes that key off
(source_field, request_type): the reporting bucket (report_group/counted) and
the solver rule (rule), plus the objective weight config key (weight_key).
Every valid combo gets a row; these tests pin every cell.
"""

import pytest

from bunking.satisfaction.request_registry import (
    COUNTED_BUCKETS,
    RequestBucket,
    RequestClass,
    SolverRule,
    classify,
    report_group_for,
    rule_for,
    weight_for,
    weight_key_for,
)
from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SourceField

# (source_field, request_type) -> (report_group, counted, rule, weight_key)
EXPECTED: dict[tuple[str, str], tuple[RequestBucket, bool, SolverRule, str | None]] = {
    (SourceField.BUNK_REQUEST_FORM, RequestType.BUNK_WITH.value): (
        RequestBucket.MATERIAL_PARENT,
        True,
        SolverRule.HARD_MSO,
        "share_bunk_with",
    ),
    (SourceField.BUNK_REQUEST_FORM, RequestType.NOT_BUNK_WITH.value): (
        RequestBucket.MATERIAL_PARENT,
        True,
        SolverRule.HARD_MSO,
        "do_not_share_with",
    ),
    (SourceField.BUNK_REQUEST_FORM, RequestType.AGE_PREFERENCE.value): (
        RequestBucket.MATERIAL_PARENT,
        True,
        SolverRule.HARD_MSO,
        "share_bunk_with",
    ),
    (SourceField.SOCIALIZE_WITH, RequestType.AGE_PREFERENCE.value): (
        RequestBucket.IMMATERIAL_PARENT,
        False,
        SolverRule.SOFT,
        "socialize_preference",
    ),
    (SourceField.STAFF_NOT_BUNK_WITH, RequestType.NOT_BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.HARD_MNT,
        "do_not_share_with",
    ),
    (SourceField.BUNKING_NOTES, RequestType.BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        "bunking_notes",
    ),
    (SourceField.BUNKING_NOTES, RequestType.NOT_BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        "bunking_notes",
    ),
    (SourceField.BUNKING_NOTES, RequestType.AGE_PREFERENCE.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        "bunking_notes",
    ),
    (SourceField.INTERNAL_NOTES, RequestType.BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        "internal_notes",
    ),
    (SourceField.INTERNAL_NOTES, RequestType.NOT_BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        "internal_notes",
    ),
    (SourceField.INTERNAL_NOTES, RequestType.AGE_PREFERENCE.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        "internal_notes",
    ),
    (SourceField.MANUAL, RequestType.BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        None,
    ),
    (SourceField.MANUAL, RequestType.NOT_BUNK_WITH.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.HARD_MNT,
        None,
    ),
    (SourceField.MANUAL, RequestType.AGE_PREFERENCE.value): (
        RequestBucket.STAFF,
        True,
        SolverRule.SOFT,
        None,
    ),
}


@pytest.mark.parametrize(("key", "expected"), list(EXPECTED.items()))
def test_registry_row(key: tuple[str, str], expected: tuple[RequestBucket, bool, SolverRule, str | None]) -> None:
    source, rtype = key
    report_group, counted, rule, weight_suffix = expected
    rc: RequestClass = classify(source, rtype)
    assert rc.report_group == report_group
    assert rc.counted == counted
    assert rc.rule == rule
    expected_key = f"objective.source_multipliers.{weight_suffix}" if weight_suffix else None
    assert rc.weight_key == expected_key


def test_registry_has_exactly_14_rows() -> None:
    """No extra or missing combos — the table is the complete enumeration."""
    from bunking.satisfaction import request_registry

    assert len(EXPECTED) == 14
    assert len(request_registry._REGISTRY) == 14
    assert set(request_registry._REGISTRY) == set(EXPECTED)


def test_accessors_match_classify() -> None:
    for (source, rtype), (report_group, _counted, rule, weight_suffix) in EXPECTED.items():
        assert report_group_for(source) == report_group
        assert rule_for(source, rtype) == rule
        expected_key = f"objective.source_multipliers.{weight_suffix}" if weight_suffix else None
        assert weight_key_for(source, rtype) == expected_key


def test_counted_buckets_is_material_parent_plus_staff() -> None:
    """Reporting no-op: only IMMATERIAL_PARENT is excluded today."""
    assert frozenset({RequestBucket.MATERIAL_PARENT, RequestBucket.STAFF}) == COUNTED_BUCKETS


def test_report_group_is_source_determined() -> None:
    """Invariant: every row of a given source shares one report_group.

    If this breaks, report_group has become request_type-dependent and a new
    bucket split is required (see request-classification.md stopping rule).
    """
    from collections import defaultdict

    by_source: dict[str, set[RequestBucket]] = defaultdict(set)
    for (source, _rtype), (report_group, *_rest) in EXPECTED.items():
        by_source[source].add(report_group)
    for source, groups in by_source.items():
        assert len(groups) == 1, f"{source} maps to multiple report groups: {groups}"


def test_unknown_combo_raises() -> None:
    with pytest.raises(ValueError):
        classify("nonexistent_source", "bunk_with")


class _StubConfig:
    """ConfigLoader double for weight_for tests.

    Returns a configured override when present, otherwise echoes back the
    default the caller passed — mirroring a ConfigLoader where the key is unset.
    """

    def __init__(self, overrides: dict[str, float] | None = None) -> None:
        self._overrides = overrides or {}

    def get_float(self, key: str, default: float | None = None) -> float:
        if key in self._overrides:
            return self._overrides[key]
        return default if default is not None else 1.0


# Per-combo expected default multiplier, keyed by the weight_key suffix from
# EXPECTED. Mirrors the fallback defaults the objective evaluators hardcode
# today; None suffix (manual) → neutral 1.0.
_DEFAULT_BY_SUFFIX: dict[str | None, float] = {
    "share_bunk_with": 1.75,
    "do_not_share_with": 1.5,
    "bunking_notes": 1.0,
    "internal_notes": 1.0,
    "socialize_preference": 0.6,
    None: 1.0,
}


@pytest.mark.parametrize(("key", "expected"), list(EXPECTED.items()))
def test_weight_for_uses_per_combo_default_when_unconfigured(
    key: tuple[str, str],
    expected: tuple[RequestBucket, bool, SolverRule, str | None],
) -> None:
    """No-op pin: with no config override, weight_for returns the evaluators'
    historical per-source multiplier default for every valid combo."""
    source, rtype = key
    weight_suffix = expected[3]
    assert weight_for(source, rtype, _StubConfig()) == _DEFAULT_BY_SUFFIX[weight_suffix]  # type: ignore[arg-type]


def test_weight_for_reads_configured_value_over_default() -> None:
    """When the config supplies the weight_key, weight_for returns it (not the default)."""
    cfg = _StubConfig({"objective.source_multipliers.share_bunk_with": 9.25})
    assert weight_for(SourceField.BUNK_REQUEST_FORM, RequestType.BUNK_WITH.value, cfg) == 9.25  # type: ignore[arg-type]


def test_weight_for_unknown_source_raises() -> None:
    """A source the registry doesn't know raises ValueError — the 14 combos
    are the universe, off-axis data fails loud."""
    with pytest.raises(ValueError):
        weight_for("nonexistent_source", RequestType.BUNK_WITH.value, _StubConfig())  # type: ignore[arg-type]


def test_weight_for_off_axis_combo_raises() -> None:
    """A strict source paired with a request_type it doesn't admit is not in
    the registry — weight_for raises rather than silently applying the source's
    multiplier (the pre-Phase-3 behavior). Off-axis pipeline data is a hygiene
    bug we want to surface, not paper over."""
    # staff_not_bunk_with admits only not_bunk_with; bunk_with is off-axis.
    with pytest.raises(ValueError):
        weight_for(SourceField.STAFF_NOT_BUNK_WITH, RequestType.BUNK_WITH.value, _StubConfig())  # type: ignore[arg-type]
    # socialize_with admits only age_preference; bunk_with is off-axis.
    with pytest.raises(ValueError):
        weight_for(SourceField.SOCIALIZE_WITH, RequestType.BUNK_WITH.value, _StubConfig())  # type: ignore[arg-type]


def test_weight_for_manual_is_neutral() -> None:
    """manual rows are in the registry but have no weight_key → 1.0 (today's behavior)."""
    for rtype in (RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value, RequestType.AGE_PREFERENCE.value):
        assert weight_for(SourceField.MANUAL, rtype, _StubConfig()) == 1.0  # type: ignore[arg-type]


def test_weight_defaults_match_evaluator_fallbacks() -> None:
    """_WEIGHT_DEFAULTS must equal the fallback defaults the objective evaluators
    hardcode (score_evaluator / objective_evaluator). Pins the Phase-3 reroute as
    a no-op: a config missing a key resolves to the same value as before.
    """
    from bunking.satisfaction import request_registry

    assert request_registry._WEIGHT_DEFAULTS == {
        "objective.source_multipliers.share_bunk_with": 1.75,
        "objective.source_multipliers.do_not_share_with": 1.5,
        "objective.source_multipliers.bunking_notes": 1.0,
        "objective.source_multipliers.internal_notes": 1.0,
        "objective.source_multipliers.socialize_preference": 0.6,
    }


def test_every_weight_key_has_a_default() -> None:
    """Every non-None weight_key in the registry has a _WEIGHT_DEFAULTS entry, so
    weight_for never KeyErrors."""
    from bunking.satisfaction import request_registry

    keys = {rc.weight_key for rc in request_registry._REGISTRY.values() if rc.weight_key is not None}
    assert keys <= set(request_registry._WEIGHT_DEFAULTS)


from types import SimpleNamespace

from bunking.satisfaction.request_registry import (
    is_hard_separation,
    would_downgrade_hard_separation,
)


class TestIsHardSeparation:
    def test_staff_not_bunk_with_is_hard(self):
        assert is_hard_separation(SourceField.STAFF_NOT_BUNK_WITH, "not_bunk_with") is True

    def test_manual_not_bunk_with_is_hard(self):
        assert is_hard_separation(SourceField.MANUAL, "not_bunk_with") is True

    def test_parent_not_bunk_with_is_not_hard(self):
        assert is_hard_separation(SourceField.BUNK_REQUEST_FORM, "not_bunk_with") is False

    def test_notes_not_bunk_with_is_not_hard(self):
        assert is_hard_separation(SourceField.BUNKING_NOTES, "not_bunk_with") is False
        assert is_hard_separation(SourceField.INTERNAL_NOTES, "not_bunk_with") is False

    def test_off_axis_combo_is_not_hard(self):
        assert is_hard_separation(SourceField.SOCIALIZE_WITH, "not_bunk_with") is False


def _r(source_field: str, request_type: str = "not_bunk_with") -> SimpleNamespace:
    return SimpleNamespace(source_field=source_field, request_type=request_type)


class TestWouldDowngradeHardSeparation:
    def test_parent_plus_staff_nbw_downgrades(self):
        assert (
            would_downgrade_hard_separation([_r(SourceField.BUNK_REQUEST_FORM), _r(SourceField.STAFF_NOT_BUNK_WITH)])
            is True
        )

    def test_parent_plus_manual_nbw_downgrades(self):
        assert would_downgrade_hard_separation([_r(SourceField.BUNK_REQUEST_FORM), _r(SourceField.MANUAL)]) is True

    def test_two_parent_nbw_no_downgrade(self):
        assert (
            would_downgrade_hard_separation([_r(SourceField.BUNK_REQUEST_FORM), _r(SourceField.BUNK_REQUEST_FORM)])
            is False
        )

    def test_two_hard_nbw_no_downgrade(self):
        assert would_downgrade_hard_separation([_r(SourceField.STAFF_NOT_BUNK_WITH), _r(SourceField.MANUAL)]) is False

    def test_single_request_no_downgrade(self):
        assert would_downgrade_hard_separation([_r(SourceField.STAFF_NOT_BUNK_WITH)]) is False

    def test_non_nbw_requests_ignored(self):
        assert (
            would_downgrade_hard_separation(
                [_r(SourceField.BUNK_REQUEST_FORM, "bunk_with"), _r(SourceField.STAFF_NOT_BUNK_WITH)]
            )
            is False
        )
