"""The camper journey's server read: one person's adult-weekend cabins, and
the TLI/SCIT cabins the lodging registry resolves (owner ruling 2026-09-22,
late, Q9).

The rule lives in `person_housing_rules`; this module only reads and converts.
`person_custom_values` is admin-only in PocketBase, which is why this read is
server-side at all -- the same reason family camp's cabins are.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, NamedTuple

from api.schemas.lodging import PersonHousingResponse, PersonHousingWeekend
from api.services.lodging_roster_service import build_housing_name_resolver
from api.services.person_housing_rules import (
    adult_weekends_from_rows,
    cabin_values_from_rows,
    live_names,
    named_adult_cabins,
)
from api.utils.session_metrics import SUMMER_TEEN_TYPES

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository
    from api.services.lodging_rules import HousingNameResolver


def _expanded(row: Any, name: str) -> Any:
    expand = getattr(row, "expand", None) or {}
    return expand.get(name) if isinstance(expand, dict) else None


class _TeenBunk(NamedTuple):
    year: int
    session_cm_id: int
    raw: str


def _teen_bunks(rows: list[Any]) -> list[_TeenBunk]:
    """TLI/SCIT bunk strings, one per (year, session), in stable read order.

    Defense in depth behind the repository's TLI/SCIT filter: any other
    program -- Quest above all, whose "bunk" is a trip name -- is dropped
    here too. Every raw string is kept; which ones name a real cabin is the
    resolver's call, made by the caller.
    """
    out: list[_TeenBunk] = []
    for row in rows:
        session = _expanded(row, "session")
        bunk = _expanded(row, "bunk")
        if session is None or bunk is None:
            continue
        if str(getattr(session, "session_type", "") or "") not in SUMMER_TEEN_TYPES:
            continue
        session_cm_id = int(getattr(session, "cm_id", 0) or 0)
        raw = str(getattr(bunk, "name", "") or "")
        if session_cm_id <= 0 or not raw.strip():
            continue
        out.append(_TeenBunk(year=int(getattr(row, "year", 0) or 0), session_cm_id=session_cm_id, raw=raw))
    return out


def _resolved_teen_cabins(bunks: list[_TeenBunk], resolver: HousingNameResolver) -> list[PersonHousingWeekend]:
    """The teen bunks the registry resolves to a real unit -- the rest are
    program groups ("SCIT A", "TLI") and are left out, so no cabin shows.

    One row per (year, session): the bunk-grain unique index lets a session
    hold two bunk rows, and the client keys its label by (year, session). The
    first RESOLVED row in read order wins.
    """
    out: list[PersonHousingWeekend] = []
    seen: set[tuple[int, int]] = set()
    for bunk in bunks:
        key = (bunk.year, bunk.session_cm_id)
        if key in seen or not resolver.resolve_codes(bunk.raw, bunk.year):
            continue
        seen.add(key)
        out.append(
            PersonHousingWeekend(
                year=bunk.year,
                session_cm_id=bunk.session_cm_id,
                cabin_name=resolver.display_name(bunk.raw, bunk.year).strip(),
                cabin_name_raw=bunk.raw,
            )
        )
    return out


class PersonHousingService:
    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository

    async def build_person_housing(self, person_cm_id: int) -> PersonHousingResponse:
        if person_cm_id <= 0:
            return PersonHousingResponse(person_cm_id=person_cm_id)
        value_rows, attendee_rows, teen_rows, live_rows = await asyncio.gather(
            self.repository.fetch_person_cabin_values(person_cm_id),
            self.repository.fetch_person_adult_attendees(person_cm_id),
            self.repository.fetch_person_teen_assignments(person_cm_id),
            # kindred#2775: the CampMinder layer, 2026 onward.
            self.repository.fetch_person_live_assignments(person_cm_id),
        )
        values = cabin_values_from_rows(value_rows)
        weekends = adult_weekends_from_rows(attendee_rows)
        teen_bunks = _teen_bunks(teen_rows)
        # The resolver is two whole-table reads (`build_housing_name_resolver`),
        # and most callers have nothing to resolve: no adult cabin value or
        # live row, or no enrolled adult weekend to hang one on, AND no
        # TLI/SCIT bunk. Read the cheap rows first and skip the registry
        # entirely when neither list has anything for it.
        has_adult = bool(weekends) and (bool(values) or bool(live_rows))
        if not has_adult and not teen_bunks:
            return PersonHousingResponse(person_cm_id=person_cm_id)
        resolver = await build_housing_name_resolver(self.repository)
        # kindred#2332 pattern (owner ruling 2026-09-22, evening): today's
        # registry name, falling back to the as-typed string (trimmed) when
        # nothing resolves -- through the same resolver the rule used to
        # collapse same-place values. For a live-housing year every enrolled
        # weekend of which has a CampMinder-layer row (kindred#2775), that row
        # is the answer instead, and the as-typed string rides along.
        cabins = (
            named_adult_cabins(
                values,
                weekends,
                live_names(live_rows, resolver.display_name_for_unit_ids),
                resolver.resolve_codes,
                resolver.display_name,
            )
            if has_adult
            else []
        )
        return PersonHousingResponse(
            person_cm_id=person_cm_id,
            teen_cabins=_resolved_teen_cabins(teen_bunks, resolver),
            weekends=[
                PersonHousingWeekend(
                    year=cabin.year,
                    session_cm_id=cabin.session_cm_id,
                    cabin_name=cabin.cabin_name,
                    cabin_name_raw=cabin.cabin_name_raw,
                )
                for cabin in cabins
            ],
        )
