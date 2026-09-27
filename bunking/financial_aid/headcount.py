"""Who counts as an infant on a family-camp request (campership spec 2 item 22, 7.2 cost).

Family camp is priced per person, with a lower infant rate. A baby is a person
under the season's `cost.infant_age_cutoff_months` on the SESSION'S FIRST DAY,
not on the season's age reference date (that date is for reports). Intake
(sub-project 5) uses this to pre-fill and cross-check the family-camp headcount
from CampMinder's billed lines; the calculator only reads the headcount.

Pure: no I/O, no clock.
"""

from __future__ import annotations

from datetime import date

from bunking.financial_aid.rules.schema import AidRules


def months_old(born: date, on: date) -> int:
    """Whole months from `born` to `on`; negative when `born` is later."""
    months = (on.year - born.year) * 12 + (on.month - born.month)
    return months - 1 if on.day < born.day else months


def is_infant(born: date | None, first_day: date | None, rules: AidRules) -> bool | None:
    """Under the season's cutoff on the session's first day. None when the season sets no
    cutoff or either date is unknown: then CampMinder's billing label stands."""
    cutoff = rules.cost.infant_age_cutoff_months
    if cutoff is None or born is None or first_day is None:
        return None
    return months_old(born, first_day) < cutoff
