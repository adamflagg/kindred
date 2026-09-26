"""bunking.financial_aid.change_diff -- the readable diff behind aid_change_log.

Spec §14.4: a log row holds "before and after, holding only the changed
fields", and a screen renders a field-level diff ("Round 1 %, tier 3:
74.5 -> 72"). Fictional values only.
"""

from datetime import date
from decimal import Decimal

import pytest

from bunking.financial_aid.change_diff import FieldChange, changed_fields, field_changes, values_equal


def test_only_changed_top_level_fields_are_kept() -> None:
    before = {"stage": "draft", "amount": Decimal("1250.50"), "round": 1}
    after = {"stage": "offered", "amount": Decimal("1250.50"), "round": 1}
    assert changed_fields(before, after) == ({"stage": "draft"}, {"stage": "offered"})


def test_an_added_key_appears_only_after_and_a_removed_key_only_before() -> None:
    before = {"stage": "draft", "note": "call back"}
    after = {"stage": "draft", "hold": True}
    assert changed_fields(before, after) == ({"note": "call back"}, {"hold": True})


def test_nested_dicts_keep_only_the_changed_leaves() -> None:
    """Rules documents are nested (a tier table keyed by tier)."""
    before = {"tiers": {"3": {"round1_pct": Decimal("74.5"), "cap": 2000}, "4": {"round1_pct": Decimal(60)}}}
    after = {"tiers": {"3": {"round1_pct": Decimal(72), "cap": 2000}, "4": {"round1_pct": Decimal(60)}}}
    assert changed_fields(before, after) == (
        {"tiers": {"3": {"round1_pct": Decimal("74.5")}}},
        {"tiers": {"3": {"round1_pct": Decimal(72)}}},
    )


def test_lists_are_compared_whole() -> None:
    before = {"families": ["summer", "family_camp"], "same": [1, 2]}
    after = {"families": ["summer"], "same": [1, 2]}
    assert changed_fields(before, after) == ({"families": ["summer", "family_camp"]}, {"families": ["summer"]})


def test_a_dict_replaced_by_a_scalar_is_one_leaf_change() -> None:
    before = {"cap": {"amount": 100}}
    after = {"cap": None}
    assert changed_fields(before, after) == ({"cap": {"amount": 100}}, {"cap": None})


def test_identical_snapshots_have_no_changes() -> None:
    snap = {"stage": "draft", "tiers": {"1": [1, 2]}}
    assert changed_fields(snap, dict(snap)) == ({}, {})
    assert field_changes(snap, dict(snap)) == []


# The equality rule, chosen deliberately:
#   * numbers (int, float, Decimal -- never bool) are equal when their values
#     are equal, so a PocketBase float 1250.5 read back equals the calculator's
#     Decimal("1250.50"), and Decimal("72") equals Decimal("72.00");
#   * otherwise two values are equal when aid_change_log would STORE them
#     identically: Decimal("74.5") equals "74.5", date(2027, 3, 1) equals
#     "2027-03-01";
#   * a bool is never equal to a number (True is not 1).
@pytest.mark.parametrize(
    ("a", "b"),
    [
        (Decimal(72), Decimal("72.00")),
        (Decimal("1250.50"), 1250.5),
        (Decimal(5), 5),
        (0.1, Decimal("0.1")),
        (Decimal("74.5"), "74.5"),
        (date(2027, 3, 1), "2027-03-01"),
        ({"a": Decimal("1.0")}, {"a": 1}),
        ([Decimal("1.50"), "x"], [1.5, "x"]),
        (None, None),
        (True, True),
    ],
)
def test_equal_values(a: object, b: object) -> None:
    assert values_equal(a, b)
    assert values_equal(b, a)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        (Decimal(72), "72.0"),  # a string is compared as stored, not parsed
        (True, 1),
        (False, 0),
        (Decimal(0), None),
        ("", None),
        ([1, 2], [2, 1]),
        ({"a": 1}, {"a": 1, "b": 2}),
        (1, "1"),
    ],
)
def test_unequal_values(a: object, b: object) -> None:
    assert not values_equal(a, b)
    assert not values_equal(b, a)


def test_numerically_equal_decimals_are_not_a_change() -> None:
    assert changed_fields({"amount": Decimal(72)}, {"amount": Decimal("72.00")}) == ({}, {})


def test_field_changes_names_each_leaf_by_its_path() -> None:
    before = {"tiers": {"3": {"round1_pct": Decimal("74.5")}}, "note": "old", "stage": "draft"}
    after = {"tiers": {"3": {"round1_pct": Decimal(72)}}, "stage": "draft", "hold": True}
    changes = field_changes(before, after)
    assert changes == [
        FieldChange(path=("hold",), kind="added", before=None, after=True),
        FieldChange(path=("note",), kind="removed", before="old", after=None),
        FieldChange(path=("tiers", "3", "round1_pct"), kind="changed", before=Decimal("74.5"), after=Decimal(72)),
    ]
    assert [c.dotted for c in changes] == ["hold", "note", "tiers.3.round1_pct"]


def test_field_changes_reads_a_stored_row_back() -> None:
    """A stored update row already holds only the changed fields, as JSON: the
    screen renders it with the same function."""
    stored_before = {"tiers": {"3": {"round1_pct": "74.5"}}}
    stored_after = {"tiers": {"3": {"round1_pct": "72"}}, "hold": True}
    assert field_changes(stored_before, stored_after) == [
        FieldChange(path=("hold",), kind="added", before=None, after=True),
        FieldChange(path=("tiers", "3", "round1_pct"), kind="changed", before="74.5", after="72"),
    ]


def test_a_create_or_delete_lists_every_leaf() -> None:
    assert field_changes(None, {"stage": "offered", "grant": {"amount": 500}}) == [
        FieldChange(path=("grant", "amount"), kind="added", before=None, after=500),
        FieldChange(path=("stage",), kind="added", before=None, after="offered"),
    ]
    assert field_changes({"stage": "offered"}, None) == [
        FieldChange(path=("stage",), kind="removed", before="offered", after=None),
    ]


def test_a_key_present_with_none_is_not_the_same_as_absent() -> None:
    assert changed_fields({"note": None}, {}) == ({"note": None}, {})
    assert field_changes({}, {"note": None}) == [FieldChange(path=("note",), kind="added", before=None, after=None)]


def test_inputs_are_not_mutated() -> None:
    before = {"tiers": {"3": {"a": 1, "b": 2}}}
    after = {"tiers": {"3": {"a": 1, "b": 3}}}
    changed_before, changed_after = changed_fields(before, after)
    changed_before["tiers"]["3"]["b"] = 99
    assert before == {"tiers": {"3": {"a": 1, "b": 2}}}
    assert after == {"tiers": {"3": {"a": 1, "b": 3}}}
