"""Who counts as an infant on a family-camp request (campership spec 2 item 22, 7.2 cost).

Family camp is priced per person, with a lower infant rate. A baby is a person under 2 (`INFANT_UNDER_MONTHS`) on the
SESSION'S FIRST DAY, not on the season's age reference date (that date is for reports). Intake (sub-project 5) uses
this to pre-fill and cross-check the family-camp headcount from CampMinder's billed lines; the calculator only reads
the headcount.

Owner 2026-10-08: "its going to remain < 24 months. once kids are 2 they can go to day groups. its not a changing
number." So it is a constant here, not a season setting: the rules' `cost.infant_age_cutoff_months` is no longer read.

Pure: no I/O, no clock.
"""

from __future__ import annotations

from datetime import date
from typing import Final

INFANT_UNDER_MONTHS: Final = 24


def months_old(born: date, on: date) -> int:
    """Whole months from `born` to `on`; negative when `born` is later."""
    months = (on.year - born.year) * 12 + (on.month - born.month)
    return months - 1 if on.day < born.day else months


def is_infant(born: date | None, first_day: date | None) -> bool | None:
    """Under 2 on the session's first day. None when either date is unknown: then CampMinder's billing label stands."""
    if born is None or first_day is None:
        return None
    return months_old(born, first_day) < INFANT_UNDER_MONTHS
