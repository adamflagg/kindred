"""Billed family-camp headcount (campership sub-project 5; spec 8, levers catalogue 5)."""

from __future__ import annotations

from api.services.financial_aid_billing import (
    BilledHeadcount,
    billed_headcount,
    billed_headcounts,
    family_camp_category_by_session,
)
from api.services.financial_aid_intake_types import BillingLine

FC6 = 17006
FC8 = 17008


def line(
    kind: str,
    *,
    household: int = 1000001,
    person: int = 0,
    session: int = 0,
    category: int = FC6,
    quantity: float = 1,
    amount: float = 600.0,
    reversed_: bool = False,
    description: str | None = None,
    category_name: str | None = None,
) -> BillingLine:
    number = 6 if category == FC6 else 8
    return BillingLine(
        household_cm_id=household,
        person_cm_id=person,
        session_cm_id=session,
        category_cm_id=category,
        category_name=category_name or f"Family Camp {number}",
        description=description or f"Family Camp {number} - {kind}",
        quantity=quantity,
        amount=amount,
        is_reversed=reversed_,
    )


def household_lines() -> list[BillingLine]:
    return [
        line("Adult", quantity=2),
        line("Child", person=1000012, session=1000202),
        line("Child", person=1000013, session=1000202),
        line("Infant", person=1000014, amount=300.0),
    ]


def test_adults_by_quantity_children_and_infants_are_counted() -> None:
    lines = household_lines()
    assert billed_headcount(1000001, 1000202, lines, family_camp_category_by_session(lines)) == BilledHeadcount(4, 1)


def test_canteen_tax_and_shared_cabin_lines_are_ignored() -> None:
    lines = household_lines() + [
        line("", description="Family Camp 6 Canteen Payment", amount=120.0),
        line("", description="Family Camp 6 Canteen Tax", amount=9.0),
        line("", description="FC6-Shared Cabin", amount=300.0),
        line("Adult", category_name="Family Camp 6 Canteen Payment"),
    ]
    assert billed_headcount(1000001, 1000202, lines, family_camp_category_by_session(lines)) == BilledHeadcount(4, 1)


def test_reversed_legs_are_ignored_and_a_live_repost_counts() -> None:
    lines = [
        line("Adult", quantity=3, reversed_=True),
        line("Adult", quantity=3, amount=-600.0, reversed_=True),
        line("Adult", quantity=2),
        line("Child", person=1000012, session=1000202),
        line("Child", person=1000013, session=1000202, reversed_=True),
        line("Child", person=1000015, session=1000202, amount=-600.0),  # an unflagged negative leg
    ]
    assert billed_headcount(1000001, 1000202, lines, family_camp_category_by_session(lines)) == BilledHeadcount(3, 0)


def test_another_households_lines_never_count() -> None:
    lines = household_lines() + [line("Adult", household=1000002, quantity=4)]
    assert billed_headcount(1000001, 1000202, lines, family_camp_category_by_session(lines)) == BilledHeadcount(4, 1)


def test_no_live_line_for_the_household_means_no_billed_headcount() -> None:
    lines = household_lines()
    assert billed_headcount(1000009, 1000202, lines, family_camp_category_by_session(lines)) is None


def test_a_session_whose_category_is_never_seen_on_a_child_line_has_no_billed_headcount() -> None:
    lines = [line("Adult", quantity=2)]
    assert family_camp_category_by_session(lines) == {}
    assert billed_headcount(1000001, 1000202, lines, {}) is None


def test_a_category_shared_by_two_sessions_prices_neither() -> None:  # Review Focus 4
    lines = household_lines() + [line("Child", household=1000002, person=1000022, session=1000203)]
    category_by_session = family_camp_category_by_session(lines)
    assert 1000202 not in category_by_session
    assert 1000203 not in category_by_session
    assert billed_headcount(1000001, 1000202, lines, category_by_session) is None


def test_billed_headcounts_keys_by_household_and_session() -> None:
    lines = household_lines() + [
        line("Adult", household=1000002, category=FC8, quantity=1, amount=500.0),
        line("Child", household=1000002, person=1000022, session=1000208, category=FC8, amount=500.0),
    ]
    assert billed_headcounts(lines, [1000001, 1000002]) == {
        (1000001, 1000202): BilledHeadcount(4, 1),
        (1000002, 1000208): BilledHeadcount(2, 0),
    }


def test_the_infant_cutoff_reclasses_billed_children_and_infants() -> None:
    lines = household_lines()  # Adult x2, Child 1000012, Child 1000013, Infant 1000014
    ages = {1000013: True, 1000014: False}  # a billed child still under the cutoff; a billed infant over it

    def age_rule(person_cm_id: int, session_cm_id: int) -> bool | None:
        assert session_cm_id == 1000202  # measured on THIS session's first day
        return ages.get(person_cm_id)

    counted = billed_headcount(1000001, 1000202, lines, family_camp_category_by_session(lines), age_rule)
    assert counted == BilledHeadcount(non_infant=4, infant=1, reclassified=2)


def test_an_unknown_age_leaves_the_billing_label_standing() -> None:
    lines = household_lines()
    counted = billed_headcounts(lines, [1000001], age_rule=lambda person_cm_id, session_cm_id: None)
    assert counted == {(1000001, 1000202): BilledHeadcount(4, 1)}
