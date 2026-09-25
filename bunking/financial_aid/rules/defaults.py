"""Default program keys for a new season.

Program keys are staff-chosen strings; these are only where a new season starts.
Every default profile is CLOSED to aid and routed to no table, so nothing is
awarded until staff set the tables, equity class and pool.
"""

from __future__ import annotations

from bunking.financial_aid.rules.schema import ProgramProfile

DEFAULT_PROGRAM_KEYS: tuple[str, ...] = (
    "summer",
    "quest",
    "teen",
    "bmitzvah",
    "family_camp",
    "adult_weekend",
    "family_school",
    "other",
)

DEFAULT_PROGRAM_LABELS: dict[str, str] = {
    "summer": "Summer",
    "quest": "Quest",
    "teen": "Teen programs",
    "bmitzvah": "B'mitzvah",
    "family_camp": "Family camp",
    "adult_weekend": "Adult weekends",
    "family_school": "Family school",
    "other": "Other",
}


def default_program_profiles() -> dict[str, ProgramProfile]:
    return {
        key: ProgramProfile(
            label=DEFAULT_PROGRAM_LABELS[key],
            r1_table=None,
            r2_table=None,
            equity_class=None,
            budget_pool=None,
            cost_source="per_person" if key == "family_camp" else "catalog",
            open_to_aid=False,
        )
        for key in DEFAULT_PROGRAM_KEYS
    }
