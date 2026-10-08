"""Who is an infant on a family-camp request (spec 2 item 22, 7.2 cost).

Owner 2026-10-08: infants are under 2, on the session's first day, and it never changes ("once kids are 2 they can go
to day groups. its not a changing number"). So it is a constant, not a season setting.
"""

from datetime import date

from bunking.financial_aid.headcount import INFANT_UNDER_MONTHS, is_infant, months_old

FIRST_DAY = date(2031, 8, 20)


def test_months_old_counts_whole_months() -> None:
    assert months_old(date(2029, 8, 20), FIRST_DAY) == 24
    assert months_old(date(2029, 8, 21), FIRST_DAY) == 23
    assert months_old(date(2031, 9, 1), FIRST_DAY) < 0  # born after the first day


def test_infants_are_under_two() -> None:
    assert INFANT_UNDER_MONTHS == 24


def test_a_baby_is_under_two_on_the_sessions_first_day() -> None:
    assert is_infant(date(2029, 8, 21), FIRST_DAY) is True  # 23 months: an infant
    assert is_infant(date(2029, 8, 20), FIRST_DAY) is False  # 2 to the day: full price


def test_age_is_measured_on_each_sessions_first_day() -> None:
    born = date(2029, 7, 1)
    assert is_infant(born, date(2031, 6, 7)) is True  # an early-June weekend: still under 2
    assert is_infant(born, date(2031, 8, 20)) is False  # a late-August weekend: 2 by then


def test_an_unknown_date_decides_nothing() -> None:
    assert is_infant(None, FIRST_DAY) is None
    assert is_infant(date(2030, 2, 1), None) is None
