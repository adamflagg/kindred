"""Who is an infant on a family-camp request (spec 2 item 22, 7.2 cost)."""

from datetime import date

from bunking.financial_aid.headcount import is_infant, months_old
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever

FIRST_DAY = date(2031, 8, 20)


def test_months_old_counts_whole_months() -> None:
    assert months_old(date(2029, 8, 20), FIRST_DAY) == 24
    assert months_old(date(2029, 8, 21), FIRST_DAY) == 23
    assert months_old(date(2031, 9, 1), FIRST_DAY) < 0  # born after the first day


def test_a_baby_is_under_the_cutoff_on_the_sessions_first_day() -> None:
    rules = with_lever(fictional_rules(), "cost.infant_age_cutoff_months", 24)
    assert is_infant(date(2029, 8, 21), FIRST_DAY, rules) is True  # 23 months: an infant
    assert is_infant(date(2029, 8, 20), FIRST_DAY, rules) is False  # 2 to the day: full price


def test_the_cutoff_is_a_season_setting() -> None:
    born = date(2030, 2, 1)  # 18 months on the first day
    assert is_infant(born, FIRST_DAY, with_lever(fictional_rules(), "cost.infant_age_cutoff_months", 24)) is True
    assert is_infant(born, FIRST_DAY, with_lever(fictional_rules(), "cost.infant_age_cutoff_months", 12)) is False


def test_age_is_measured_on_each_sessions_first_day() -> None:
    rules = with_lever(fictional_rules(), "cost.infant_age_cutoff_months", 24)
    born = date(2029, 7, 1)
    assert is_infant(born, date(2031, 6, 7), rules) is True  # an early-June weekend: still under 2
    assert is_infant(born, date(2031, 8, 20), rules) is False  # a late-August weekend: 2 by then


def test_no_cutoff_or_an_unknown_date_decides_nothing() -> None:
    no_cutoff = with_lever(fictional_rules(), "cost.infant_age_cutoff_months", None)
    assert is_infant(date(2030, 2, 1), FIRST_DAY, no_cutoff) is None
    assert is_infant(None, FIRST_DAY, fictional_rules()) is None
    assert is_infant(date(2030, 2, 1), None, fictional_rules()) is None
