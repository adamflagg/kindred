"""The household search for adding a household link (owner ruling F3 #27; app spec §6.3 †): find a household by
name or CampMinder id and say which family keys it is linked under, so the Add picker can name the key to join.
financial_aid.view, as the household page that shows links. Read-only: Add and Remove stay unbuilt for now.

Digits are an id: a household's, or a person's, which finds their household. Anything else is a name: each word
(the first four, each cut to forty characters) must appear in the household's mailing title or greeting, or in one
person's first, preferred or last name. Every filter stays far below PocketBase's 3,500-character limit.
"""

from __future__ import annotations

import asyncio
from collections.abc import Collection, Sequence
from typing import Any, Final, Protocol

from api.constants.collections import HOUSEHOLDS, PERSONS
from api.schemas.financial_aid_surfaces import HouseholdMatchOut, HouseholdSearchResponse
from api.services.financial_aid_ledger_service import family_household_set, household_display_name, person_display_name
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.lodging_repository import STABLE_SORT
from api.utils.pb_filters import pb_escape

MAX_MATCHES: Final = 25
MAX_WORDS: Final = 4
MAX_WORD_LENGTH: Final = 40
MIN_WORD_LENGTH: Final = 2  # a one-letter word matches nearly everything
HOUSEHOLD_FIELDS: Final = "cm_id,mailing_title,greeting"
FILTER_LIMIT: Final = 3500  # PocketBase refuses a longer filter (financial_aid_repository)


def words_of(query: str) -> list[str]:
    return [word[:MAX_WORD_LENGTH] for word in query.split()][:MAX_WORDS]


def _all_of(year: int, clauses: Sequence[str]) -> str:
    return " && ".join([f"year = {int(year)}", *clauses])


def household_name_filter(year: int, words: Sequence[str]) -> str:
    return _all_of(year, [f"(mailing_title ~ '{e}' || greeting ~ '{e}')" for e in (pb_escape(w) for w in words)])


def person_name_filter(year: int, words: Sequence[str]) -> str:
    return _all_of(
        year,
        [f"(first_name ~ '{e}' || preferred_name ~ '{e}' || last_name ~ '{e}')" for e in (pb_escape(w) for w in words)],
    )


class HouseholdSearchStore(Protocol):
    async def search_households(self, year: int, words: Sequence[str]) -> list[Any]: ...
    async def search_people(self, year: int, words: Sequence[str]) -> list[Any]: ...
    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]: ...
    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]: ...
    async def fetch_household_members(self, year: int, household_ids: Collection[int]) -> list[Any]: ...
    async def fetch_links(self, year: int) -> list[Any]: ...


class HouseholdSearchRepository(FinancialAidRepository):
    async def search_households(self, year: int, words: Sequence[str]) -> list[Any]:
        return await self._page(
            HOUSEHOLDS,
            {"filter": household_name_filter(year, words), "fields": HOUSEHOLD_FIELDS, "sort": STABLE_SORT},
        )

    async def search_people(self, year: int, words: Sequence[str]) -> list[Any]:
        return await self._page(
            PERSONS,
            {
                "filter": person_name_filter(year, words),
                "fields": "cm_id,first_name,preferred_name,last_name,household_id",
                "sort": STABLE_SORT,
            },
        )


async def _none() -> list[Any]:
    return []


def _household_id(person: Any) -> int:
    return int(getattr(person, "household_id", 0) or 0)


class HouseholdSearchService:
    def __init__(self, store: HouseholdSearchStore) -> None:
        self._store = store

    async def _ids(self, year: int, text: str) -> tuple[set[int], dict[int, Any]]:
        """The matching households' ids, and the household rows the search already read (by id)."""
        if text.isdecimal():
            cm_id = int(text)
            households, people = await asyncio.gather(
                self._store.fetch_households(year, [cm_id]), self._store.fetch_persons(year, [cm_id])
            )
        else:
            # A % is a wildcard to PocketBase: a word made of one would match nearly everything, so none is searched.
            words = words_of(text.replace("%", ""))
            if not words or max(len(w) for w in words) < MIN_WORD_LENGTH:
                return set(), {}
            households, people = await asyncio.gather(
                self._store.search_households(year, words), self._store.search_people(year, words)
            )
        rows = {int(h.cm_id): h for h in households}
        return (rows.keys() | {_household_id(p) for p in people}) - {0}, rows

    async def search(self, year: int, query: str) -> HouseholdSearchResponse:
        ids, by_id = await self._ids(year, query.strip())
        if not ids:
            return HouseholdSearchResponse(year=year, matches=[], truncated=False)
        unread = ids - by_id.keys()  # found only through a person: its household row is still to read
        more, links = await asyncio.gather(
            self._store.fetch_households(year, unread) if unread else _none(), self._store.fetch_links(year)
        )
        by_id = {**by_id, **{int(h.cm_id): h for h in more}}
        named = sorted(ids, key=lambda h: (household_display_name(by_id.get(h), h).lower(), h))
        kept = named[:MAX_MATCHES]
        members = await self._store.fetch_household_members(year, kept)
        people: dict[int, set[str]] = {h: set() for h in kept}
        for person in members:
            if _household_id(person) in people:
                people[_household_id(person)].add(person_display_name(person))
        return HouseholdSearchResponse(
            year=year,
            matches=[
                HouseholdMatchOut(
                    household_cm_id=h,
                    family_name=household_display_name(by_id.get(h), h),
                    people=sorted(people[h] - {""}, key=str.lower),
                    family_keys=sorted(
                        {str(ln.family_key) for ln in links if int(ln.household_cm_id) == h and not ln.excluded}
                    ),
                    linked_household_cm_ids=[o for o in family_household_set(links, h) if o != h],
                )
                for h in kept
            ],
            truncated=len(named) > MAX_MATCHES,
        )
