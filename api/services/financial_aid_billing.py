"""Family-camp headcount from CampMinder's billed fee lines (spec 8).

Staff price a family-camp request as headcount x the season's rate table.
Intake PRE-FILLS the headcount from billing when billing exists. It is a
suggestion with source `billed`, and a staff entry always wins
(financial_aid_intake_plan).

What the lines look like, measured on the 2026 snapshot:
* A "Family Camp N" category holds three tuition lines: "- Adult" (household
  level, `quantity` = adults, NO person and NO session), "- Child" (one per
  person, WITH a session) and "- Infant" (one per person, no session). CampMinder
  bills Adult and Child at the same rate, so "non-infant" = adults + children.
* The same category also holds canteen, canteen-tax and shared-cabin lines.
  Only descriptions ending "- Adult" / "- Child" / "- Infant" count.
* A reversal flags BOTH legs is_reversed, so live billing is the unflagged
  lines. An unflagged negative line is ignored: it is never a head.
* An Adult line reaches a session only through its category, and the
  category-to-session map is learned from live Child lines. A category seen
  with two sessions maps neither, because its Adult lines cannot be split.
  Those requests get no billed headcount and are flagged missing.
* A baby is under 2 (`headcount.INFANT_UNDER_MONTHS`) on the session's FIRST
  DAY (spec 2 item 22). When an `age_rule` knows a billed child's or infant's age, it
  decides infant vs non-infant and any disagreement with the billing label is
  counted in `reclassified` (the request is flagged; billing is a cross-check).
  Adult lines carry no person and are always non-infant.

Known gap: a weekend billed outside the "Family Camp N" categories (the 2026
spring retreat) gets no pre-fill, and staff enter its headcount.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from api.services.financial_aid_intake_types import BillingLine

_FAMILY_CAMP_CATEGORY: Final = re.compile(r"^family camp \d+$", re.IGNORECASE)
_LINE_CLASS: Final = re.compile(r"-\s*(adult|child|infant)\s*$", re.IGNORECASE)

# (person_cm_id, session_cm_id) -> an infant on that session's first day? None: unknown.
AgeRule = Callable[[int, int], bool | None]


@dataclass(frozen=True)
class BilledHeadcount:
    non_infant: int
    infant: int
    # Billed people whose age on the first day contradicts their billing label.
    reclassified: int = 0


def classify_billing_line(line: BillingLine) -> str | None:
    if line.is_reversed or line.amount < 0:
        return None
    if not _FAMILY_CAMP_CATEGORY.match(line.category_name.strip()):
        return None
    match = _LINE_CLASS.search(line.description.strip())
    return match.group(1).lower() if match else None


def family_camp_category_by_session(lines: Sequence[BillingLine]) -> dict[int, int]:
    categories_by_session: dict[int, set[int]] = defaultdict(set)
    sessions_by_category: dict[int, set[int]] = defaultdict(set)
    for line in lines:
        if line.session_cm_id > 0 and classify_billing_line(line) == "child":
            categories_by_session[line.session_cm_id].add(line.category_cm_id)
            sessions_by_category[line.category_cm_id].add(line.session_cm_id)
    result: dict[int, int] = {}
    for session_cm_id, categories in categories_by_session.items():
        if len(categories) == 1:
            (category,) = categories
            if len(sessions_by_category[category]) == 1:
                result[session_cm_id] = category
    return result


def billed_headcount(
    household_cm_id: int,
    session_cm_id: int,
    lines: Sequence[BillingLine],
    category_by_session: Mapping[int, int],
    age_rule: AgeRule | None = None,
) -> BilledHeadcount | None:
    category = category_by_session.get(session_cm_id)
    if category is None:
        return None
    non_infant = infant = reclassified = 0
    found = False
    for line in lines:
        if line.household_cm_id != household_cm_id or line.category_cm_id != category:
            continue
        kind = classify_billing_line(line)
        if kind is None:
            continue
        found = True
        heads = round(line.quantity)
        if kind != "adult" and line.person_cm_id > 0 and age_rule is not None:
            verdict = age_rule(line.person_cm_id, session_cm_id)
            if verdict is not None:
                by_age = "infant" if verdict else "child"
                if by_age != kind:
                    reclassified += heads
                kind = by_age
        if kind == "infant":
            infant += heads
        else:
            non_infant += heads
    return BilledHeadcount(non_infant, infant, reclassified) if found else None


def billed_headcounts(
    lines: Sequence[BillingLine], household_cm_ids: Iterable[int], age_rule: AgeRule | None = None
) -> dict[tuple[int, int], BilledHeadcount]:
    category_by_session = family_camp_category_by_session(lines)
    result: dict[tuple[int, int], BilledHeadcount] = {}
    for household_cm_id in sorted(set(household_cm_ids)):
        for session_cm_id in sorted(category_by_session):
            counted = billed_headcount(household_cm_id, session_cm_id, lines, category_by_session, age_rule)
            if counted is not None:
                result[(household_cm_id, session_cm_id)] = counted
    return result
