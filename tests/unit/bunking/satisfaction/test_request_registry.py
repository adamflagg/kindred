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
        "share_bunk_with",
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
    assert len(EXPECTED) == 14


def test_accessors_match_classify() -> None:
    for (source, rtype), (report_group, _counted, rule, weight_suffix) in EXPECTED.items():
        assert report_group_for(source) == report_group
        assert rule_for(source, rtype) == rule
        expected_key = f"objective.source_multipliers.{weight_suffix}" if weight_suffix else None
        assert weight_key_for(source, rtype) == expected_key


def test_counted_buckets_is_material_parent_plus_staff() -> None:
    """Reporting no-op: only IMMATERIAL_PARENT is excluded today."""
    assert COUNTED_BUCKETS == frozenset({RequestBucket.MATERIAL_PARENT, RequestBucket.STAFF})


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
