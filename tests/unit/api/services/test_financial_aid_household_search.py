"""The Add-a-link picker's search (owner F3 #27; app spec §6.3 †): a household by name or CampMinder id, with the
family keys it is linked under. Fictional only: the Johnson (1000001) and Garcia (1000002) households are linked
under one key; the Chen household (1000003) is linked to none."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from types import SimpleNamespace
from typing import Any

import pytest

from api.services.financial_aid_household_search import (
    FILTER_LIMIT,
    MAX_MATCHES,
    HouseholdSearchService,
    household_name_filter,
    person_name_filter,
    words_of,
)

YEAR = 2027
JOHNSON, GARCIA, CHEN = 1000001, 1000002, 1000003


def _household(cm_id: int, title: str) -> SimpleNamespace:
    return SimpleNamespace(cm_id=cm_id, mailing_title=title, greeting="")


def _person(cm_id: int, first: str, last: str, household: int) -> SimpleNamespace:
    return SimpleNamespace(cm_id=cm_id, first_name=first, preferred_name="", last_name=last, household_id=household)


def _link(link_id: str, household: int, key: str, *, excluded: bool = False) -> SimpleNamespace:
    return SimpleNamespace(id=link_id, household_cm_id=household, family_key=key, excluded=excluded)


class _Store:
    def __init__(self) -> None:
        self.households = [
            _household(JOHNSON, "The Johnson Family"),
            _household(GARCIA, "The Garcia Family"),
            _household(CHEN, "The Chen Family"),
        ]
        self.people = [
            _person(1000011, "Emma", "Johnson", JOHNSON),
            _person(1000021, "Liam", "Garcia", GARCIA),
            _person(1000031, "Olivia", "Chen", CHEN),
        ]
        self.links = [_link("lnk000000000001", JOHNSON, "hh-1000001"), _link("lnk000000000002", GARCIA, "hh-1000001")]
        self.name_searches: list[tuple[str, tuple[str, ...]]] = []
        self.household_fetches: list[frozenset[int]] = []

    async def search_households(self, year: int, words: Sequence[str]) -> list[Any]:
        self.name_searches.append(("households", tuple(words)))
        return [h for h in self.households if all(w.lower() in h.mailing_title.lower() for w in words)]

    async def search_people(self, year: int, words: Sequence[str]) -> list[Any]:
        self.name_searches.append(("people", tuple(words)))
        return [p for p in self.people if all(w.lower() in f"{p.first_name} {p.last_name}".lower() for w in words)]

    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        self.household_fetches.append(frozenset(cm_ids))
        return [h for h in self.households if h.cm_id in cm_ids]

    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        return [p for p in self.people if p.cm_id in cm_ids]

    async def fetch_household_members(self, year: int, household_ids: Collection[int]) -> list[Any]:
        return [p for p in self.people if p.household_id in household_ids]

    async def fetch_links(self, year: int) -> list[Any]:
        return list(self.links)


@pytest.mark.asyncio
async def test_a_name_finds_the_household_with_its_people_and_family_keys() -> None:
    out = await HouseholdSearchService(_Store()).search(YEAR, "garcia")
    (match,) = out.matches
    assert (match.household_cm_id, match.family_name, match.people) == (GARCIA, "The Garcia Family", ["Liam Garcia"])
    assert (match.family_keys, match.linked_household_cm_ids) == (["hh-1000001"], [JOHNSON])
    assert out.truncated is False


@pytest.mark.asyncio
async def test_a_persons_name_finds_their_household_and_a_lone_household_has_no_key() -> None:
    (match,) = (await HouseholdSearchService(_Store()).search(YEAR, "Olivia")).matches
    assert (match.household_cm_id, match.family_keys, match.linked_household_cm_ids) == (CHEN, [], [])


@pytest.mark.asyncio
async def test_a_household_or_person_id_finds_the_household_without_a_name_search() -> None:
    store = _Store()
    by_household = await HouseholdSearchService(store).search(YEAR, "1000002")
    by_person = await HouseholdSearchService(store).search(YEAR, " 1000031 ")
    assert [m.household_cm_id for m in by_household.matches] == [GARCIA]
    assert [m.household_cm_id for m in by_person.matches] == [CHEN]
    assert store.name_searches == []


@pytest.mark.asyncio
async def test_an_excluded_link_is_not_a_family_key() -> None:
    store = _Store()
    store.links.append(_link("lnk000000000003", CHEN, "hh-1000001", excluded=True))
    (match,) = (await HouseholdSearchService(store).search(YEAR, "chen")).matches
    assert match.family_keys == []


@pytest.mark.asyncio
async def test_a_query_of_only_spaces_finds_nothing() -> None:
    store = _Store()
    out = await HouseholdSearchService(store).search(YEAR, "   ")
    assert (out.matches, out.truncated, store.name_searches) == ([], False, [])


@pytest.mark.asyncio
async def test_more_matches_than_the_list_holds_are_cut_by_name_and_said_so() -> None:
    store = _Store()
    store.households = [_household(2000000 + i, f"The Smith Family {i:02d}") for i in range(MAX_MATCHES + 3)]
    out = await HouseholdSearchService(store).search(YEAR, "smith")
    assert len(out.matches) == MAX_MATCHES
    assert out.truncated is True
    assert [m.family_name for m in out.matches] == sorted(m.family_name for m in out.matches)


def test_only_the_first_four_words_count_and_each_is_cut_to_forty_characters() -> None:
    assert words_of("a b c d e") == ["a", "b", "c", "d"]
    assert words_of("x" * 60) == ["x" * 40]


def test_the_longest_query_keeps_every_filter_under_the_limit() -> None:
    """PocketBase refuses a filter over 3,500 characters (financial_aid_repository); a quote escapes to two."""
    worst = words_of(" ".join(["'" * 40] * 6))
    assert len(household_name_filter(YEAR, worst)) < FILTER_LIMIT
    assert len(person_name_filter(YEAR, worst)) < FILTER_LIMIT


def test_quotes_and_backslashes_are_escaped() -> None:
    assert person_name_filter(YEAR, ["O'Brien\\"]) == (
        "year = 2027 && (first_name ~ 'O\\'Brien\\\\' || preferred_name ~ 'O\\'Brien\\\\' "
        "|| last_name ~ 'O\\'Brien\\\\')"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("query", [" a", "a b", "%%", "%", "% x"])
async def test_a_query_with_no_word_of_two_characters_runs_no_name_search(query: str) -> None:
    """A lone % would switch off PocketBase's wildcard wrapping and match nearly everything."""
    store = _Store()
    out = await HouseholdSearchService(store).search(YEAR, query)
    assert (out.matches, store.name_searches) == ([], [])


@pytest.mark.asyncio
async def test_a_household_the_name_search_returned_is_not_fetched_again() -> None:
    store = _Store()
    await HouseholdSearchService(store).search(YEAR, "garcia")  # found by its title, and by Liam
    assert store.household_fetches == []
    store.household_fetches.clear()
    await HouseholdSearchService(store).search(YEAR, "olivia")  # found only by a person: its row is fetched
    assert store.household_fetches == [frozenset({CHEN})]


def test_the_household_name_search_asks_only_for_the_fields_the_match_reads() -> None:
    from api.services.financial_aid_household_search import HOUSEHOLD_FIELDS

    assert HOUSEHOLD_FIELDS == "cm_id,mailing_title,greeting"
