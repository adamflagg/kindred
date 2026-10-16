"""A past season's Campership sheet as "as reported" recipients (owner ruling 2026-10-16, CS-AGES25). Pure.

The owner's words: "don't auto count all summer kids in a family if one kid in the family (or the family got aid)
automatically, it overcounts summer, and don't forget to include families who only got external aid, else you
undercount families. the real answer is 'we need the google sheet' for each year back to 2022."

So a season the dashboard did not price (an "as reported" column) takes its summer age lines from that season's
sheet, loaded once into `aid_reported_recipients`: one row per camper, program and payer, matched to CampMinder by
id. `source` is "camp" (an award on the sheet's aid calculator) or "outside" (a grant on its Grants tab, naming its
funder); `match` says how the row was matched ("personal_id", or "household_birthdate" when the sheet had no id).
CampMinder ids only, never a name.
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


def sheet_ages(
    recipients: Iterable[ReportedRecipient],
    stays: Iterable[tuple[int, date | None]],
    persons: Mapping[int, Person],
) -> dict[str, int]:
    """The summer age lines of an as-reported season: exactly the distinct summer recipients on the sheet (the camp's
    award or an outside grant) who have an enrolled summer stay that season (`stays`: person, session start, enrolled
    summer-type registrations only). A sibling the sheet doesn't list is never counted. Age is on the first day of
    the camper's first summer session (D103), as in a dashboard column; no birthdate is age unknown."""
    first: dict[int, date | None] = {}
    for person, start in stays:
        if person not in first:
            first[person] = start
        elif start is not None:
            known = first[person]
            first[person] = start if known is None else min(known, start)
    ages: dict[str, int] = {}
    for person in {r.person_cm_id for r in recipients if r.program == "summer"} & first.keys():
        who = persons.get(person)
        band = age_band(age_on(who.birthdate if who is not None else None, first[person]))
        ages[band] = ages.get(band, 0) + 1
    return ages
