"""The adult camper journey's server read: one person's adult-weekend cabins.

Spec: docs/superpowers/specs/2026-09-22-adult-camper-journey-design.md §4.
The rule lives in `person_housing_rules`; this module only reads and converts.
`person_custom_values` is admin-only in PocketBase, which is why this read is
server-side at all -- the same reason family camp's cabins are.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from api.schemas.lodging import PersonHousingResponse, PersonHousingWeekend
from api.services.lodging_roster_service import build_housing_name_resolver
from api.services.person_housing_rules import (
    ADULT_WEEKEND_CABIN_FIELD_CM_IDS,
    AdultWeekend,
    CabinValue,
    attribute_adult_cabins,
    parse_instant,
    weekend_last_day_ends,
)

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository


def _expanded(row: Any, name: str) -> Any:
    expand = getattr(row, "expand", None) or {}
    return expand.get(name) if isinstance(expand, dict) else None


def _cabin_values(rows: list[Any]) -> list[CabinValue]:
    out: list[CabinValue] = []
    for row in rows:
        field_cm_id = int(getattr(_expanded(row, "field_definition"), "cm_id", 0) or 0)
        # Defense in depth: the repository already filters to the allowlist.
        if field_cm_id not in ADULT_WEEKEND_CABIN_FIELD_CM_IDS:
            continue
        out.append(
            CabinValue(
                year=int(getattr(row, "year", 0) or 0),
                field_cm_id=field_cm_id,
                raw=str(getattr(row, "value", "") or ""),
                written_at=parse_instant(str(getattr(row, "last_updated", "") or "")),
            )
        )
    return out


def _weekends(rows: list[Any]) -> list[AdultWeekend]:
    out: list[AdultWeekend] = []
    for row in rows:
        session = _expanded(row, "session")
        if session is None:
            continue
        ends = weekend_last_day_ends(str(getattr(session, "end_date", "") or ""))
        session_cm_id = int(getattr(session, "cm_id", 0) or 0)
        if ends is None or session_cm_id <= 0:
            continue
        out.append(
            AdultWeekend(year=int(getattr(row, "year", 0) or 0), session_cm_id=session_cm_id, last_day_ends=ends)
        )
    return out


class PersonHousingService:
    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository

    async def build_person_housing(self, person_cm_id: int) -> PersonHousingResponse:
        if person_cm_id <= 0:
            return PersonHousingResponse(person_cm_id=person_cm_id)
        value_rows, attendee_rows = await asyncio.gather(
            self.repository.fetch_person_cabin_values(person_cm_id),
            self.repository.fetch_person_adult_attendees(person_cm_id),
        )
        values = _cabin_values(value_rows)
        weekends = _weekends(attendee_rows)
        # The resolver is two whole-table reads (`build_housing_name_resolver`),
        # and most callers have nothing to attribute: no cabin values, no
        # enrolled adult weekends, or both. Read the cheap rows first and skip
        # the registry entirely when there is nothing for it to resolve.
        if not values or not weekends:
            return PersonHousingResponse(person_cm_id=person_cm_id)
        resolver = await build_housing_name_resolver(self.repository)
        attributed = attribute_adult_cabins(values, weekends, resolver.resolve_codes)
        return PersonHousingResponse(
            person_cm_id=person_cm_id,
            weekends=[
                PersonHousingWeekend(
                    year=cabin.year,
                    session_cm_id=cabin.session_cm_id,
                    cabin_name=cabin.cabin_name,
                    cabin_name_raw=cabin.cabin_name_raw,
                )
                for cabin in attributed
            ],
        )
