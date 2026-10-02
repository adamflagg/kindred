"""The jump box's index (clean spec §3.5, D13, D27): every household with aid activity this season,
with its campers and parents, read once and searched in the browser. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Collection
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_jump_index import JumpIndexRepository, JumpIndexService, Touch
from api.services.financial_aid_requesters import FaContact

YEAR = 2031


def _person(cm_id: int, first: str, last: str, parents: list[tuple[str, str]] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        cm_id=cm_id,
        first_name=first,
        preferred_name="",
        last_name=last,
        parent_names=[
            {"first": f, "last": la, "relationship": "Parent", "is_primary": True} for f, la in parents or []
        ],
    )


class FakeJumpStore:
    def __init__(
        self, touches: list[Touch], households: list[Any], persons: list[Any], contacts: list[FaContact] | None = None
    ) -> None:
        self.contacts = contacts or []
        self.contact_reads = 0
        self.touches = touches
        self.households = households
        self.persons = persons
        self.person_reads: list[frozenset[int]] = []

    async def fetch_touches(self, year: int) -> list[Touch]:
        return list(self.touches)

    async def fetch_fa_contacts(self, year: int) -> list[FaContact]:
        self.contact_reads += 1
        return list(self.contacts)

    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        return [h for h in self.households if h.cm_id in cm_ids]

    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        self.person_reads.append(frozenset(cm_ids))
        return [p for p in self.persons if p.cm_id in cm_ids]


def _store() -> FakeJumpStore:
    return FakeJumpStore(
        touches=[
            Touch(household_cm_id=1000001, person_cm_id=1000011),  # Emma's request
            Touch(household_cm_id=1000001, person_cm_id=1000012),  # Samuel's request
            Touch(household_cm_id=1000002, person_cm_id=1000011),  # pays a share of Emma's request
            Touch(household_cm_id=1000003, person_cm_id=0),  # a household-level grant line, no camper
            Touch(household_cm_id=1000001, person_cm_id=1000011),  # Emma again, from a posting
        ],
        households=[
            SimpleNamespace(cm_id=1000001, mailing_title="The Johnson Family", greeting=""),
            SimpleNamespace(cm_id=1000002, mailing_title="", greeting="Mr. Garcia"),
        ],
        persons=[
            _person(1000011, "Emma", "Johnson", [("Pat", "Johnson"), ("Alex", "Garcia")]),
            _person(1000012, "Samuel", "Johnson", [("Pat", "Johnson")]),
        ],
    )


@pytest.mark.asyncio
async def test_every_household_with_aid_activity_is_one_row_with_its_campers_and_parents() -> None:
    out = await JumpIndexService(_store()).read(YEAR)
    assert out.year == YEAR
    assert [(h.household_cm_id, h.family_name) for h in out.households] == [
        (1000003, "Household 1000003"),
        (1000002, "Mr. Garcia"),
        (1000001, "The Johnson Family"),
    ]
    johnson = out.households[2]
    assert [(p.person_cm_id, p.name, p.role) for p in johnson.people] == [
        (1000011, "Emma Johnson", "camper"),
        (1000012, "Samuel Johnson", "camper"),
        (None, "Alex Garcia", "parent"),
        (None, "Pat Johnson", "parent"),
    ]


@pytest.mark.asyncio
async def test_a_payer_share_household_finds_the_camper_it_pays_for() -> None:
    """D26: the household page's scope runs both ways, so the paying home's row lists the camper too."""
    out = await JumpIndexService(_store()).read(YEAR)
    garcia = next(h for h in out.households if h.household_cm_id == 1000002)
    assert [p.person_cm_id for p in garcia.people if p.role == "camper"] == [1000011]


@pytest.mark.asyncio
async def test_a_household_level_line_is_a_row_with_no_one_in_it() -> None:
    out = await JumpIndexService(_store()).read(YEAR)
    row = next(h for h in out.households if h.household_cm_id == 1000003)
    assert row.people == []


@pytest.mark.asyncio
async def test_a_camper_missing_from_persons_keeps_the_id_so_id_search_still_finds_it() -> None:
    store = _store()
    store.persons = []
    out = await JumpIndexService(store).read(YEAR)
    assert [(p.person_cm_id, p.name) for p in out.households[2].people] == [(1000011, ""), (1000012, "")]


@pytest.mark.asyncio
async def test_persons_are_read_once_for_every_camper() -> None:
    store = _store()
    await JumpIndexService(store).read(YEAR)
    assert store.person_reads == [frozenset({1000011, 1000012})]


@pytest.mark.asyncio
async def test_an_empty_season_is_an_empty_index() -> None:
    out = await JumpIndexService(FakeJumpStore([], [], [])).read(YEAR)
    assert out.households == []


# --- requesters (owner add-on) ---------------------------------------------------------------------


def _req_store(touches: list[Touch], contacts: list[FaContact], persons: list[Any] | None = None) -> FakeJumpStore:
    return FakeJumpStore(
        touches,
        [SimpleNamespace(cm_id=1000001, mailing_title="The Johnson Family", greeting="")],
        persons
        if persons is not None
        else [_person(1000011, "Emma", "Johnson"), _person(1000012, "Samuel", "Johnson")],
        contacts,
    )


def _requesters(out: Any, household: int = 1000001) -> list[str]:
    row = next(h for h in out.households if h.household_cm_id == household)
    return [p.name for p in row.people if p.role == "requester"]


@pytest.mark.asyncio
async def test_a_campers_own_form_contact_is_listed_as_a_requester() -> None:
    store = _req_store([Touch(1000001, 1000011)], [FaContact(1000011, 1000001, "Maria", "Garcia")])
    out = await JumpIndexService(store).read(YEAR)
    row = out.households[0]
    assert [(p.person_cm_id, p.name, p.role) for p in row.people if p.role == "requester"] == [
        (None, "Maria Garcia", "requester")
    ]


@pytest.mark.asyncio
async def test_a_requester_filing_from_another_household_is_listed_in_the_campers_household() -> None:
    """The form row sits in household 1000002 (the requester's own home), but the camper's touch is here."""
    store = _req_store([Touch(1000001, 1000011)], [FaContact(1000011, 1000002, "Maria", "Garcia")])
    out = await JumpIndexService(store).read(YEAR)
    assert _requesters(out) == ["Maria Garcia"]


@pytest.mark.asyncio
async def test_a_camper_without_an_own_row_falls_back_to_the_households_one_contact() -> None:
    store = _req_store([Touch(1000001, 1000011)], [FaContact(1000012, 1000001, "David", "Chen")])
    out = await JumpIndexService(store).read(YEAR)
    assert _requesters(out) == ["David Chen"]


@pytest.mark.asyncio
async def test_an_ambiguous_household_lists_no_requester() -> None:
    store = _req_store(
        [Touch(1000001, 1000011)],
        [FaContact(1000012, 1000001, "David", "Chen"), FaContact(1000013, 1000001, "Maria", "Garcia")],
    )
    out = await JumpIndexService(store).read(YEAR)
    assert _requesters(out) == []


@pytest.mark.asyncio
async def test_a_requester_already_listed_as_a_parent_is_not_repeated() -> None:
    store = _req_store(
        [Touch(1000001, 1000011)],
        [FaContact(1000011, 1000001, " maria ", "GARCIA")],
        [_person(1000011, "Emma", "Johnson", [("Maria", "Garcia")])],
    )
    out = await JumpIndexService(store).read(YEAR)
    assert _requesters(out) == []
    assert [p.name for p in out.households[0].people if p.role == "parent"] == ["Maria Garcia"]


@pytest.mark.asyncio
async def test_a_requester_named_like_a_camper_is_not_repeated() -> None:
    store = _req_store([Touch(1000001, 1000011)], [FaContact(1000011, 1000001, "emma", "johnson")])
    out = await JumpIndexService(store).read(YEAR)
    assert _requesters(out) == []


@pytest.mark.asyncio
async def test_campers_with_different_requesters_list_both_sorted_after_the_parents() -> None:
    store = _req_store(
        [Touch(1000001, 1000011), Touch(1000001, 1000012)],
        [FaContact(1000011, 1000001, "olivia", "Chen"), FaContact(1000012, 1000001, "David", "Chen")],
        [_person(1000011, "Emma", "Johnson", [("Pat", "Johnson")]), _person(1000012, "Samuel", "Johnson")],
    )
    out = await JumpIndexService(store).read(YEAR)
    assert [(p.name, p.role) for p in out.households[0].people][2:] == [
        ("Pat Johnson", "parent"),
        ("David Chen", "requester"),
        ("olivia Chen", "requester"),
    ]


@pytest.mark.asyncio
async def test_a_household_level_only_touch_uses_the_household_unique_step() -> None:
    store = _req_store([Touch(1000001, 0)], [FaContact(1000011, 1000001, "Maria", "Garcia")])
    assert _requesters(await JumpIndexService(store).read(YEAR)) == ["Maria Garcia"]
    ambiguous = _req_store(
        [Touch(1000001, 0)],
        [FaContact(1000011, 1000001, "Maria", "Garcia"), FaContact(1000012, 1000001, "David", "Chen")],
    )
    assert _requesters(await JumpIndexService(ambiguous).read(YEAR)) == []


@pytest.mark.asyncio
async def test_the_contacts_are_read_once_per_index_read() -> None:
    store = _req_store(
        [Touch(1000001, 1000011), Touch(1000001, 1000012)], [FaContact(1000011, 1000001, "Maria", "Garcia")]
    )
    await JumpIndexService(store).read(YEAR)
    assert store.contact_reads == 1


# --- the repository ---------------------------------------------------------------------------------


def _pb(rows: dict[str, list[Any]]) -> tuple[MagicMock, list[tuple[str, dict[str, Any]]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    pb = MagicMock()

    def collection(name: str) -> Any:
        handle = MagicMock()

        def get_full_list(batch: int, query_params: dict[str, Any]) -> list[Any]:
            calls.append((name, query_params))
            return list(rows.get(name, []))

        handle.get_full_list.side_effect = get_full_list
        return handle

    pb.collection.side_effect = collection
    return pb, calls


@pytest.mark.asyncio
async def test_the_repository_reads_five_season_tables_with_only_the_ids_it_needs() -> None:
    pb, calls = _pb(
        {
            "aid_applications": [SimpleNamespace(household_cm_id=1000001)],
            "aid_requests": [SimpleNamespace(id="reqemma00000001", household_cm_id=1000001, person_cm_id=1000011)],
            "aid_payer_shares": [SimpleNamespace(request="reqemma00000001", household_cm_id=1000002)],
            "aid_postings": [SimpleNamespace(household_cm_id=1000003, person_cm_id=0, attributed_person_cm_id=0)],
            "aid_grants": [SimpleNamespace(household_cm_id=1000004, person_cm_id=1000041)],
        }
    )
    touches = await JumpIndexRepository(pb).fetch_touches(YEAR)
    assert set(touches) == {
        Touch(1000001, 0),
        Touch(1000001, 1000011),
        Touch(1000002, 1000011),
        Touch(1000003, 0),
        Touch(1000004, 1000041),
    }
    assert {name for name, _ in calls} == {
        "aid_applications",
        "aid_requests",
        "aid_payer_shares",
        "aid_postings",
        "aid_grants",
    }
    filters = {name: str(params["filter"]) for name, params in calls}
    # Reversed postings count as activity; a withdrawn commitment doesn't (the register leaves it out, so its
    # household's page would be a 404: plan review minor 1).
    assert filters.pop("aid_grants") == f"year = {YEAR} && status != 'withdrawn'"
    assert set(filters.values()) == {f"year = {YEAR}"}
    for _, params in calls:
        assert "fields" in params
        assert params["sort"] == "id"


@pytest.mark.asyncio
async def test_the_repository_serves_the_form_contacts_through_the_shared_narrow_read() -> None:
    row = SimpleNamespace(
        person_id=1000011,
        contact_first_name="Maria",
        contact_last_name="Garcia",
        expand={"household": SimpleNamespace(cm_id=1000002)},
    )
    pb, calls = _pb({"financial_aid_applications": [row]})
    assert await JumpIndexRepository(pb).fetch_fa_contacts(YEAR) == [FaContact(1000011, 1000002, "Maria", "Garcia")]
    assert [(n, p["filter"]) for n, p in calls] == [("financial_aid_applications", f"year = {YEAR}")]
