"""A past season's Campership sheet as "as reported" recipients (owner ruling 2026-10-16, CS-AGES25). Pure.

The owner's words: "don't auto count all summer kids in a family if one kid in the family (or the family got aid)
automatically, it overcounts summer, and don't forget to include families who only got external aid, else you
undercount families. the real answer is 'we need the google sheet' for each year back to 2022."

So a season the dashboard did not price (an "as reported" column) takes its summer age lines from that season's
sheet, loaded once into `aid_reported_recipients`: one row per camper, program and payer, matched to CampMinder by
id. `source` is "camp" (an award on the sheet's aid calculator) or "outside" (a grant on its Grants tab, naming its
funder); `match` says how the row was matched ("personal_id", or "household_birthdate" when the sheet had no id).
CampMinder ids only, never a name.

A family whose only aid was an outside grant often has no sheet row (2025's tool has no Grants tab: outside grants
are per-application columns), so its camper is taken from the ledger, only when certain (#55, `_certain_camper`).
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Final, Literal, get_args

from bunking.financial_aid.reports.development import Person, age_band, age_on

Program = Literal["summer", "family_camp", "bmitzvah", "weekend", "other"]
Source = Literal["camp", "outside"]
Match = Literal["personal_id", "household_birthdate"]
PROGRAMS: Final[tuple[Program, ...]] = get_args(Program)
SOURCES: Final[tuple[Source, ...]] = get_args(Source)
MATCHES: Final[tuple[Match, ...]] = get_args(Match)
FIRST_SHEET_SEASON: Final = 2022  # the ruling: "for each year back to 2022"
LAST_SHEET_SEASON: Final = 2026  # 2027 on, the dashboard prices the season itself (FIRST_TICKED_SEASON)
ENTITY_MAX: Final = 64  # aid_change_log.entity_id's limit (1500000187_aid_change_log.js)


@dataclass(frozen=True)
class ReportedRecipient:
    year: int
    person_cm_id: int
    household_cm_id: int
    program: Program
    source: Source
    funder: str  # "" for the camp's own award; the funder's name as the sheet wrote it for an outside grant
    amount: Decimal
    sheet_tab: str
    sheet_row: int
    match: Match

    @property
    def key(self) -> tuple[int, int, str, str, str]:
        """The natural key: a second load of the same line corrects its amount or where it came from."""
        return (self.year, self.person_cm_id, self.program, self.source, self.funder)


def problems(recipient: ReportedRecipient) -> list[str]:
    """Why a sheet row can't be stored (empty: it can)."""
    out: list[str] = []
    if not FIRST_SHEET_SEASON <= recipient.year <= LAST_SHEET_SEASON:
        out.append(f"{recipient.year} is not a season a sheet is loaded for ({FIRST_SHEET_SEASON}–{LAST_SHEET_SEASON})")
    if recipient.source == "outside" and not recipient.funder.strip():
        out.append("an outside grant names its funder")
    if recipient.source == "camp" and recipient.funder:
        out.append("the camp's own award has no funder")
    if recipient.amount <= 0:
        out.append("a recipient got money: the amount is more than 0")
    return out


def recipient_entity(recipient: ReportedRecipient) -> str:
    """The change log's key, within aid_change_log.entity_id's 64 characters: "<year>:<person>:<program>:<source>:
    <12 hex digits of the SHA-1 of the whole natural key>" (the funder, which can be long, is in the digest)."""
    digest = hashlib.sha1(":".join(map(str, recipient.key)).encode(), usedforsecurity=False).hexdigest()
    return f"{recipient.year}:{recipient.person_cm_id}:{recipient.program}:{recipient.source}:{digest[:12]}"


@dataclass(frozen=True)
class OutsideCredit:
    """A live outside or incentive ledger credit of the season (an aid_postings row): who CampMinder posted it to
    (`person_cm_id`, 0 = the household), where the sync placed it (`attributed_person_cm_id` at
    `attribution_level`), and whether its source or program implies summer aid (`summer_source`; False: it never
    adds a camper to the summer age lines)."""

    household_cm_id: int
    person_cm_id: int
    attributed_person_cm_id: int
    attribution_level: str
    summer_source: bool


SUMMER_AID_FAMILIES: Final = frozenset({"summer", "quest", "teen"})  # aid program families that are summer aid
# The sync's attribution levels that name one person for certain; "program_family", "ambiguous" and "none" don't.
CERTAIN_LEVELS: Final = frozenset({"override", "decision", "session", "person"})


def _certain_camper(credit: OutsideCredit, summer_homes: Mapping[int, set[int]]) -> int | None:
    """RULED (owner 2026-10-16, #55 = a): an outside-only family's camper counts in the age lines only when the
    camper is certain: CampMinder named the person on the line, or the sync placed it on a person (person or session
    level, a staff override or a decision; never "ambiguous" or "program_family"), or the household had exactly
    one enrolled summer camper that season. Never fanned out to siblings.

    Every branch needs the line's source or program to be summer aid (summer, Quest or teen; coordinator, applying
    #55, 2026-10-16): a Family Camp, B*Mitzvah or weekend grant doesn't make a child a summer aid recipient, even
    when CampMinder posted it to that child."""
    if not credit.summer_source:
        return None
    if credit.person_cm_id > 0:
        return credit.person_cm_id
    if credit.attribution_level in CERTAIN_LEVELS and credit.attributed_person_cm_id > 0:
        return credit.attributed_person_cm_id
    campers = summer_homes.get(credit.household_cm_id, set())
    if len(campers) == 1:
        return next(iter(campers))
    return None


def sheet_ages(
    recipients: Iterable[ReportedRecipient],
    stays: Iterable[tuple[int, int, date | None]],
    persons: Mapping[int, Person],
    outside: Iterable[OutsideCredit] = (),
) -> dict[str, int]:
    """The summer age lines of an as-reported season: exactly the distinct summer recipients on the sheet (the camp's
    award or an outside grant), plus (#55) the certain camper of each family whose only aid was an outside credit
    with no row on the sheet, who have an enrolled summer stay that season (`stays`: person, household, session
    start, enrolled summer-type registrations only). A sibling nothing names is never counted. Age is on the first
    day of the camper's first summer session (D103), as in a dashboard column; no birthdate is age unknown."""
    listed = list(recipients)
    first: dict[int, date | None] = {}
    summer_homes: dict[int, set[int]] = {}
    for person, household, start in stays:
        summer_homes.setdefault(household, set()).add(person)
        if person not in first:
            first[person] = start
        elif start is not None:
            known = first[person]
            first[person] = start if known is None else min(known, start)
    on_sheet = {r.household_cm_id for r in listed}
    counted = {r.person_cm_id for r in listed if r.program == "summer"}
    for credit in outside:
        if credit.household_cm_id in on_sheet:
            continue  # the sheet already says who this family's aid was for
        if (camper := _certain_camper(credit, summer_homes)) is not None:
            counted.add(camper)
    ages: dict[str, int] = {}
    for person in counted & first.keys():
        who = persons.get(person)
        band = age_band(age_on(who.birthdate if who is not None else None, first[person]))
        ages[band] = ages.get(band, 0) + 1
    return ages
