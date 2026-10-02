"""The jump box's index (clean spec §3.5, D13, D27): every household with aid activity this season
(~450), its campers, their parents' names and the aid-form requesters, read once and searched in memory in the browser, with
no server call per keystroke. financial_aid.view only: a summary-only user has no jump box (D65).

Aid activity is any of: an aid application, a request, a payer share (the paying home finds the
camper it pays for, D26's both directions), an aid posting live or reversed, or a grant commitment that
isn't withdrawn (a withdrawn one is history, not a register row).
Names follow the ledger and grants reads (household_display_name, person_display_name).
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from typing import Any, Protocol

from api.constants.collections import AID_APPLICATIONS, AID_GRANTS, AID_PAYER_SHARES, AID_POSTINGS, AID_REQUESTS
from api.schemas.financial_aid_surfaces import JumpIndexHousehold, JumpIndexPerson, JumpIndexResponse
from api.services.financial_aid_intake_repository import read_fa_contacts
from api.services.financial_aid_ledger_service import household_display_name, person_display_name
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_requesters import FaContact, requester_resolver
from api.services.lodging_repository import STABLE_SORT


@dataclass(frozen=True)
class Touch:
    """One fact of aid activity: a household, and the camper it concerns (0 = the household itself)."""

    household_cm_id: int
    person_cm_id: int


class JumpIndexStore(Protocol):
    async def fetch_touches(self, year: int) -> list[Touch]: ...
    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]: ...
    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]: ...
    async def fetch_fa_contacts(self, year: int) -> list[FaContact]: ...


def _int(value: Any) -> int:
    return int(value or 0)


class JumpIndexRepository(FinancialAidRepository):
    async def fetch_fa_contacts(self, year: int) -> list[FaContact]:
        return await read_fa_contacts(self._page, year)

    async def fetch_touches(self, year: int) -> list[Touch]:
        """The season's aid activity, five reads at once, each with only the ids it needs."""
        season = {"filter": f"year = {int(year)}", "sort": STABLE_SORT}
        applications, requests, shares, postings, commitments = await asyncio.gather(
            self._page(AID_APPLICATIONS, {**season, "fields": "household_cm_id"}),
            self._page(AID_REQUESTS, {**season, "fields": "id,household_cm_id,person_cm_id"}),
            self._page(AID_PAYER_SHARES, {**season, "fields": "request,household_cm_id"}),
            self._page(AID_POSTINGS, {**season, "fields": "household_cm_id,person_cm_id,attributed_person_cm_id"}),
            self._page(
                AID_GRANTS,
                {
                    **season,
                    "filter": f"year = {int(year)} && status != 'withdrawn'",
                    "fields": "household_cm_id,person_cm_id",
                },
            ),
        )
        person_of = {str(r.id): _int(r.person_cm_id) for r in requests}
        touches = [Touch(_int(a.household_cm_id), 0) for a in applications]
        touches += [Touch(_int(r.household_cm_id), _int(r.person_cm_id)) for r in requests]
        touches += [Touch(_int(s.household_cm_id), person_of.get(str(s.request), 0)) for s in shares]
        for p in postings:
            people = {_int(p.person_cm_id), _int(p.attributed_person_cm_id)} - {0}
            touches += [Touch(_int(p.household_cm_id), person) for person in people or {0}]
        touches += [Touch(_int(c.household_cm_id), _int(c.person_cm_id)) for c in commitments]
        return [t for t in touches if t.household_cm_id > 0]


def _parents(people: Iterable[Any]) -> list[str]:
    names = {
        f"{str(p.get('first') or '').strip()} {str(p.get('last') or '').strip()}".strip()
        for person in people
        for p in (getattr(person, "parent_names", None) or [])
        if isinstance(p, dict)
    }
    return sorted(names - {""}, key=str.lower)


class JumpIndexService:
    def __init__(self, store: JumpIndexStore) -> None:
        self._store = store

    async def read(self, year: int) -> JumpIndexResponse:
        campers_of: dict[int, set[int]] = defaultdict(set)
        for touch in await self._store.fetch_touches(year):
            campers_of[touch.household_cm_id].add(touch.person_cm_id)
        camper_ids = {p for people in campers_of.values() for p in people} - {0}
        households_raw, persons_raw, contacts = await asyncio.gather(
            self._store.fetch_households(year, sorted(campers_of)),
            self._store.fetch_persons(year, sorted(camper_ids)) if camper_ids else _nothing(),
            self._store.fetch_fa_contacts(year),
        )
        resolve = requester_resolver(contacts)
        households = {_int(h.cm_id): h for h in households_raw}
        persons = {_int(p.cm_id): p for p in persons_raw}
        rows = []
        for household, people in campers_of.items():
            campers = sorted(people - {0})
            camper_names = [person_display_name(persons[p]) if p in persons else "" for p in campers]
            parents = _parents(persons[p] for p in campers if p in persons)
            # A household-level touch (person 0) uses the household step alone, like a request with no camper.
            requesters = {n for person in people for n in [resolve(person, household)] if n}
            listed = {n.strip().casefold() for n in [*camper_names, *parents]}
            requester_list = sorted({n.casefold(): n for n in sorted(requesters)}.values(), key=str.lower)
            rows.append(
                JumpIndexHousehold(
                    household_cm_id=household,
                    family_name=household_display_name(households.get(household), household),
                    people=[
                        *(
                            JumpIndexPerson(person_cm_id=p, name=name, role="camper")
                            for p, name in zip(campers, camper_names, strict=True)
                        ),
                        *(JumpIndexPerson(person_cm_id=None, name=name, role="parent") for name in parents),
                        *(
                            JumpIndexPerson(person_cm_id=None, name=name, role="requester")
                            for name in requester_list
                            if name.strip().casefold() not in listed
                        ),
                    ],
                )
            )
        rows.sort(key=lambda r: (r.family_name.lower(), r.household_cm_id))
        return JumpIndexResponse(year=year, households=rows)


async def _nothing() -> list[Any]:
    return []
