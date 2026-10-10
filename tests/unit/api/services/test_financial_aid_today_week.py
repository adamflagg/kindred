"""Today's This week (spec 2026-10-10 §8): this week against the same days of last week, and the latest six events
the caller may see. Development's feed names funders, never families (§9.4). Fictional only."""

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_GRANTORS
from api.schemas.financial_aid_grants import GrantorOut, GrantorsResponse, GrantsResponse
from api.services.financial_aid_today_week import TodayWeekService
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions.rounds import DecisionEvent, EventKind
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, grant_row, seed_request

NOW = datetime(2031, 4, 16, 18, tzinfo=UTC)  # Wednesday 2031-04-16, camp time 11:00


def _at(month: int, day: int, hour: int = 17) -> datetime:
    return datetime(2031, month, day, hour, tzinfo=UTC)


class _Store(FakeDecisionsStore):
    async def fetch_names(self, year: int, household_cm_ids: Any, person_cm_ids: Any) -> Any:
        names = {1000001: "Johnson", 1000002: "Garcia"}
        return {h: names[h] for h in household_cm_ids if h in names}, {}

    async def fetch_decision_events(self, year: int) -> list[DecisionEvent]:
        return list(self.events)  # the fixtures' requests are the fake's season, not 2031

    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[Any]:
        return list(self.requests.values())


class _Grants:
    def __init__(self, register: list[Any]) -> None:
        self.register = register

    async def read_with_rows(self, year: int) -> tuple[GrantsResponse, list[Any]]:
        empty = GrantsResponse(year=year, grants=[], needs_camper=[], unmapped=[], waiting=[], expected=[])
        return empty, self.register

    async def list_grantors(self, *, include_retired: bool = False) -> GrantorsResponse:
        return GrantorsResponse(
            grantors=[
                GrantorOut(
                    key="regional_fund",
                    name="Regional Fund",
                    aliases=[],
                    full_coverage=False,
                    covers_canteen="unknown",
                    pays_after_camp_aid=False,
                    eligibility="",
                    contacts="",
                    retired_at="",
                    descriptions=[],
                )
            ]
        )


def _event(
    store: FakeDecisionsStore, request_id: str, kind: EventKind, created: datetime, amount: str | None = "1500"
) -> None:
    store.events.append(
        DecisionEvent(
            id=f"evt{len(store.events):012d}",
            request_id=request_id,
            round=1,
            kind=kind,
            created=created,
            amount=Decimal(amount) if amount else None,
        )
    )


def _service(store: FakeDecisionsStore, grants: _Grants) -> TodayWeekService:
    return TodayWeekService(store=store, grants=grants, clock=lambda: NOW)


def _register() -> list[Any]:
    this_week = replace(grant_row("reqjohnson00001", "800"), recorded_at=_at(4, 15))
    return [this_week]


@pytest.fixture
def store_with_posts() -> tuple[_Store, _Grants]:
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    seed_request(store, "reqgarcia000001", household=1000002, person=1000012)
    for day in (14, 15, 16):  # Mon-Wed this week
        _event(store, "reqjohnson00001" if day != 15 else "reqgarcia000001", "post", _at(4, day))
    for day in (7, 8):  # Mon, Tue last week
        _event(store, "reqjohnson00001", "post", _at(4, day))
    _event(store, "reqgarcia000001", "post", _at(4, 10))  # last Thursday: excluded
    _event(store, "reqgarcia000001", "accept", _at(4, 15, 20))
    store.change_log.append(
        LogRow(
            id="log000000000001",
            entity=AID_GRANTORS,
            entity_id="grt000000000001",
            before={"name": "Regional Fund"},
            after={"name": "Regional Fund"},
            created=_at(4, 16, 15),
        )
    )
    return store, _Grants(_register())


@pytest.fixture
def store_with_old_post() -> tuple[_Store, _Grants]:
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    _event(store, "reqjohnson00001", "post", _at(3, 31))  # Monday; 14 days later is 2031-04-14
    return store, _Grants([])


@pytest.mark.asyncio
async def test_offers_posted_this_week_against_the_same_days_last_week(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    week = await _service(*store_with_posts).read(2031, casework=True, finance=False, development=False)
    posted = next(f for f in week.registrar or [] if f.key == "posted")
    assert (posted.value, posted.previous) == (3, 2)
    assert week.week_of == date(2031, 4, 14)


@pytest.mark.asyncio
async def test_the_comparison_leaves_out_days_after_the_same_weekday_last_week(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    store, grants = store_with_posts
    week = await _service(store, grants).read(2031, casework=True, finance=True, development=False)
    posted = next(f for f in week.registrar or [] if f.key == "posted")
    assert posted.previous == 2  # Mon 7 and Tue 8: last Thursday the 10th is past the same weekday
    answered = next(f for f in week.registrar or [] if f.key == "answered")
    assert (answered.value, answered.previous) == (1, 0)
    avg = next(f for f in week.finance or [] if f.key == "avg")
    assert (avg.value, avg.previous) == (1500, 1500)
    helped = next(f for f in week.finance or [] if f.key == "helped")
    assert helped.value == 2


@pytest.mark.asyncio
async def test_the_feed_is_newest_first_and_capped_at_six(store_with_posts: tuple[_Store, _Grants]) -> None:
    week = await _service(*store_with_posts).read(2031, casework=True, finance=False, development=False)
    assert len(week.feed) <= 6
    assert [f.at for f in week.feed] == sorted((f.at for f in week.feed), reverse=True)


@pytest.mark.asyncio
async def test_development_feed_names_no_family(store_with_posts: tuple[_Store, _Grants]) -> None:
    week = await _service(*store_with_posts).read(2031, casework=False, finance=False, development=True)
    # The field's own name contains "household"; its value is pinned to None above, so scan around the key.
    body = week.model_dump_json().replace('"household_cm_id":null', "")
    assert week.feed
    assert all(f.household_cm_id is None for f in week.feed)
    assert all(f.kind in {"grant", "funder"} for f in week.feed)
    for leak in ("household", "Johnson", "Garcia", "1000001", "reqjohnson"):
        assert leak not in body
    assert week.registrar is None
    assert week.finance is None
    assert {f.key for f in week.development or []} == {"outside_in", "awards", "funders_edited"}


@pytest.mark.asyncio
async def test_an_offer_unanswered_for_fourteen_days_appears_once_as_overdue(
    store_with_old_post: tuple[_Store, _Grants],
) -> None:
    week = await _service(*store_with_old_post).read(2031, casework=True, finance=False, development=False)
    assert [f.kind for f in week.feed].count("overdue") == 1


@pytest.mark.asyncio
async def test_a_caller_with_no_section_gets_an_empty_feed(store_with_posts: tuple[_Store, _Grants]) -> None:
    week = await _service(*store_with_posts).read(2031, casework=False, finance=False, development=False)
    assert week.feed == []


@pytest.mark.asyncio
async def test_a_feed_item_with_no_household_links_nowhere(store_with_old_post: tuple[_Store, _Grants]) -> None:
    store, grants = store_with_old_post
    _event(store, "reqmissing00001", "accept", _at(4, 15))  # its request is not in the season
    week = await _service(store, grants).read(2031, casework=True, finance=False, development=False)
    orphan = next(f for f in week.feed if f.kind == "accepted")
    assert orphan.household_cm_id is None
    assert orphan.href_kind == "none"
