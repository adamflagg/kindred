"""Today's This week (spec 2026-10-10 §8): this week against the same days of last week, and the latest six events
the caller may see. Development's feed names funders, never families (§9.4). Fictional only."""

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, ClassVar

import pytest

from api.constants.collections import AID_GRANTORS
from api.schemas.financial_aid_grants import GrantorOut, GrantorsResponse, GrantsResponse
from api.services.financial_aid_cancellations import CancelEvent
from api.services.financial_aid_today_week import TodayWeekService
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions.rounds import DecisionEvent, EventKind
from tests.unit.api.services.decisions_fakes import (
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR

NOW = datetime(2031, 4, 16, 18, tzinfo=UTC)  # Wednesday 2031-04-16, camp time 11:00


def _at(month: int, day: int, hour: int = 17) -> datetime:
    return datetime(2031, month, day, hour, tzinfo=UTC)


class _Store(FakeDecisionsStore):
    def __init__(self) -> None:
        super().__init__()
        self.camper_names = {1000011: ("Emma", "Johnson"), 1000012: ("Liam", "Garcia")}

    async def fetch_names(self, year: int, household_cm_ids: Any, person_cm_ids: Any) -> Any:
        names = {1000001: "Johnson", 1000002: "Garcia", 1000003: "Chen"}
        campers = {1000011: "Emma Johnson", 1000012: "Liam Garcia"}
        return (
            {h: names[h] for h in household_cm_ids if h in names},
            {p: campers[p] for p in person_cm_ids if p in campers},
        )

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
    return TodayWeekService(store=store, grants=grants, pricing=FakeRules(approved()), clock=lambda: NOW)


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
    # Monday; CampMinder posted it that day, so the Waiting line counts it overdue from Tue 2031-04-15 (S2)
    _posted_on(store, "reqjohnson00001", _at(3, 31), date(2031, 3, 31))
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


# --- Final review ---------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_finance_week_figures_leave_posted_in_cm_to_the_today_read(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    """Posted in CM is counted from the budget's own rows in the Today read (TodayResponse.posted_this_week)."""
    week = await _service(*store_with_posts).read(2031, casework=True, finance=True, development=False)
    assert [f.key for f in week.finance or []] == ["approved", "avg", "helped"]


@pytest.mark.asyncio
async def test_an_overdue_item_is_stamped_the_day_the_line_goes_overdue() -> None:
    """The line is overdue past 14 days (`> 14`), so the item is stamped on the CampMinder post day + 15 days, not
    + 14, at camp midnight, the moment the line's day count passes 14 (final check S2: the line's clock)."""
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    _posted_on(store, "reqjohnson00001", _at(3, 31), date(2031, 3, 31))
    week = await _service(store, _Grants([])).read(2031, casework=True, finance=False, development=False)
    overdue = next(f for f in week.feed if f.kind == "overdue")
    assert overdue.at == datetime(2031, 4, 15, 7, tzinfo=UTC)  # 00:00 camp time (PDT)


@pytest.mark.asyncio
async def test_an_overdue_item_later_than_now_is_not_shown() -> None:
    """CampMinder posted it Apr 2: the line counts it overdue from Apr 17, tomorrow."""
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    _posted_on(store, "reqjohnson00001", _at(4, 2), date(2031, 4, 2))
    week = await _service(store, _Grants([])).read(2031, casework=True, finance=False, development=False)
    assert [f for f in week.feed if f.kind == "overdue"] == []


@pytest.mark.asyncio
async def test_developments_awards_count_outside_grants_with_camp_posts() -> None:
    """Ruling 15: development cares about all awards, the camp's and outside grants. Final check S1: as the headline
    counts them, so an outside grant on a session the camp has not posted is an award of its own."""
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    seed_request(store, "reqgarcia000001", household=1000002, person=1000012)
    _event(store, "reqgarcia000001", "post", _at(4, 14))
    grants = _Grants([replace(grant_row("reqjohnson00001", "800"), recorded_at=_at(4, 15))])
    week = await _service(store, grants).read(2031, casework=False, finance=False, development=True)
    awards = next(f for f in week.development or [] if f.key == "awards")
    assert (awards.value, awards.previous) == (2, 0)
    assert "outside grants" in awards.title


@pytest.mark.asyncio
async def test_a_reversed_or_uncounted_grant_is_no_award() -> None:
    live = replace(grant_row("reqjohnson00001", "800"), recorded_at=_at(4, 15))
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    week = await _service(store, _Grants([live])).read(2031, casework=False, finance=False, development=True)
    assert next(f for f in week.development or [] if f.key == "awards").value == 1
    gone = _Grants([replace(live, is_reversed=True), replace(live, counts=False)])
    week = await _service(store, gone).read(2031, casework=False, finance=False, development=True)
    assert next(f for f in week.development or [] if f.key == "awards").value == 0


@pytest.mark.asyncio
async def test_finances_families_helped_says_it_is_season_to_date(store_with_posts: tuple[_Store, _Grants]) -> None:
    week = await _service(*store_with_posts).read(2031, casework=False, finance=True, development=False)
    assert next(f for f in week.finance or [] if f.key == "helped").label == "Families helped so far"


# --- Visual fix wave (2026-10-11): the feed names households as the grid does, and links only the name -----------


class _Labels:
    """The household page's labeler: each household's adults' label, and the adults' surnames (short_family_name)."""

    SURNAMES: ClassVar[dict[str, str]] = {
        "Pat Johnson & Alex Garcia": "Johnson & Garcia",
        "Liam & Olivia Becker": "Becker",
        "Olivia & Wei Chen": "Chen",
    }

    def __init__(self, labels: dict[int, str]) -> None:
        self.labels = labels
        self.asked: list[frozenset[int]] = []

    async def __call__(self, year: int, households: Any) -> dict[int, Any]:
        from api.services.financial_aid_household_page import HouseholdLabel

        self.asked.append(frozenset(households))
        return {
            h: HouseholdLabel(self.labels[h], "", self.SURNAMES.get(self.labels[h], ""))
            for h in households
            if h in self.labels
        }


class _Drafts:
    def __init__(self, version: Any) -> None:
        self.version = version

    async def load(self, year: int, version: int | None = None) -> Any:
        return self.version


def _labelled(store: FakeDecisionsStore, grants: _Grants, **kw: Any) -> TodayWeekService:
    labels = _Labels(
        {1000001: "Pat Johnson & Alex Garcia", 1000002: "Liam & Olivia Becker", 1000003: "Olivia & Wei Chen"}
    )
    return TodayWeekService(
        store=store, grants=grants, pricing=FakeRules(approved()), labels=labels, clock=lambda: NOW, **kw
    )


@pytest.mark.asyncio
async def test_the_feed_names_a_household_by_surname_and_marks_the_name_to_link(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    """Owner ruling 19 (1a, 2026-10-11): feed names are last names only, so a line fits one line. A camper request's
    item reads the camper's surname (CampMinder's last name); a household-level (Family Camp) request's the adults'
    surnames, a shared one once. The item says which words are the name, so only the name is the link. The label is
    read only for the household-level items. (Chips and to-dos keep ruling 18's full names.)"""
    store, grants = store_with_posts
    seed_request(store, "reqchenfc000001", household=1000003, person=0)
    _event(store, "reqchenfc000001", "accept", _at(4, 16, 16))
    service = _labelled(store, grants)
    week = await service.read(2031, casework=True, finance=False, development=False)
    accepted = {f.household_cm_id: f for f in week.feed if f.kind == "accepted"}
    assert (accepted[1000002].words, accepted[1000002].name) == ("Garcia accepted", "Garcia")
    assert (accepted[1000003].words, accepted[1000003].name) == ("Chen accepted", "Chen")
    posted = next(f for f in week.feed if f.kind == "posted" and f.household_cm_id == 1000001)
    assert (posted.words, posted.name) == ("Johnson · R1 $1,500", "Johnson")
    assert all("household" not in f.words for f in week.feed)
    assert service._labels.asked == [frozenset({1000003})]  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_a_family_camp_item_with_two_surnames_names_both(store_with_posts: tuple[_Store, _Grants]) -> None:
    """Ruling 19 (1a): adults with different surnames read "Johnson & Garcia", as the household chip's short name
    (short_family_name) joins them."""
    store, grants = store_with_posts
    seed_request(store, "reqjohnfc000001", household=1000001, person=0)
    _event(store, "reqjohnfc000001", "accept", _at(4, 16, 16))
    week = await _labelled(store, grants).read(2031, casework=True, finance=False, development=False)
    fc = next(f for f in week.feed if f.kind == "accepted" and f.household_cm_id == 1000001)
    assert (fc.words, fc.name) == ("Johnson & Garcia accepted", "Johnson & Garcia")


@pytest.mark.asyncio
async def test_every_family_line_is_short_and_leads_with_the_name(store_with_posts: tuple[_Store, _Grants]) -> None:
    """Ruling 19 (1a): shorter words, one line, as the mock: "Hart · R1 $1,200", not "Samuel Hart · R1 posted ·
    $1,200". The name still leads every family line (ruling W2). The grant line has its own test (six items cap the feed)."""
    store, grants = store_with_posts
    _event(store, "reqgarcia000001", "approve", _at(4, 16, 17), amount="1200")
    seed_request(store, "reqoldpost00001", household=1000002, person=1000012)
    _posted_on(store, "reqoldpost00001", _at(4, 1, 18), date(2031, 4, 1))  # overdue from Wed 4/16, camp midnight
    week = await _labelled(store, grants).read(2031, casework=True, finance=True, development=False)
    words = {f.kind: f.words for f in week.feed}
    assert words["approved"] == "Garcia · R1 approved $1,200"
    assert words["overdue"] == "Garcia waiting 14+ days"
    family = [f for f in week.feed if f.household_cm_id is not None]
    assert family
    assert all(f.words.startswith(f.name) for f in family)


@pytest.mark.asyncio
async def test_a_grant_line_leads_with_the_name_and_says_unmatched_not_a_funder(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    """Audit N4 / ruling W2: the name leads the line, so what a narrow column cuts is never the name. Audit R25:
    a grant no funder claims says "Unmatched", since "A funder" reads like a real funder's name. Development's
    funder lines are unchanged by ruling 19."""
    store, grants = store_with_posts
    week = await _labelled(store, grants).read(2031, casework=True, finance=False, development=False)
    grant = next(f for f in week.feed if f.kind == "grant")
    assert (grant.words, grant.name) == ("Johnson · Regional Fund grant", "Johnson")
    grants.register = [replace(grants.register[0], grantor_key="")]
    week = await _labelled(store, grants).read(2031, casework=True, finance=False, development=True)
    assert next(f for f in week.feed if f.kind == "grant").words == "Johnson · Unmatched grant"
    dev = await _labelled(store, grants).read(2031, casework=False, finance=False, development=True)
    assert next(f for f in dev.feed if f.kind == "grant").words == "Unmatched grant · $800 posted"


@pytest.mark.asyncio
async def test_the_feed_shows_this_week_only_and_nothing_in_the_future(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    """Ruling W6 (audit N5): Monday 00:00 camp time through now, newest first. Last week's items, and a grant
    recorded after now (a future-dated row), never appear; a quiet week is an empty feed."""
    store, grants = store_with_posts
    grants.register = [
        replace(grants.register[0], recorded_at=_at(4, 13)),  # last Sunday
        replace(grants.register[0], recorded_at=datetime(2031, 4, 14, 7, 30, tzinfo=UTC)),  # Mon 00:30 camp time
        replace(grants.register[0], recorded_at=_at(4, 20)),  # next Sunday: future
    ]
    week = await _labelled(store, grants).read(2031, casework=True, finance=True, development=False)
    start = datetime(2031, 4, 14, 7, tzinfo=UTC)  # Monday 00:00 camp time
    assert week.feed
    assert all(start <= f.at <= NOW for f in week.feed)
    assert [f.at for f in week.feed if f.kind == "grant"] == [datetime(2031, 4, 14, 7, 30, tzinfo=UTC)]
    quiet = _Store()
    seed_request(quiet, "reqjohnson00001", household=1000001)
    _event(quiet, "reqjohnson00001", "post", _at(4, 8))  # last week only
    empty = await _labelled(quiet, _Grants([])).read(2031, casework=True, finance=True, development=True)
    assert empty.feed == []


@pytest.mark.asyncio
async def test_development_grant_lines_link_nothing_and_funder_edits_link_the_funder(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    """The mock: development's grant lines are plain; a funder edit bolds and links the funder's name."""
    week = await _labelled(*store_with_posts).read(2031, casework=False, finance=False, development=True)
    grant = next(f for f in week.feed if f.kind == "grant")
    assert (grant.words, grant.name) == ("Regional Fund grant · $800 posted", "")
    edit = next(f for f in week.feed if f.kind == "funder")
    assert (edit.words, edit.name, edit.href_kind) == ("Regional Fund updated", "Regional Fund", "funders")


@pytest.mark.asyncio
async def test_finances_feed_says_when_a_rules_section_was_saved_as_a_draft(
    store_with_posts: tuple[_Store, _Grants],
) -> None:
    """Audit F21 (spec §8.1, ✎): a rules section edited this week is a finance feed item naming the section."""
    from bunking.financial_aid.rules.lifecycle import SectionStatus
    from tests.unit.api.services.decisions_fakes import approved

    version = approved()
    status = {
        **version.section_status,
        "round3": SectionStatus(state="draft", edited_by="finance", edited_at=_at(4, 15, 18)),
        "tiers": SectionStatus(state="draft", edited_by="finance", edited_at=_at(4, 1)),  # last month: not this week
    }
    store, grants = store_with_posts
    service = _labelled(store, grants, rules=_Drafts(version.model_copy(update={"section_status": status})))
    week = await service.read(2031, casework=True, finance=True, development=False)
    sections = [f for f in week.feed if f.kind == "section"]
    assert [(f.words, f.name, f.href_kind) for f in sections] == [
        ("Who can ask, and how much section saved as a draft", "Who can ask, and how much", "rules")
    ]
    registrar = await service.read(2031, casework=True, finance=False, development=False)
    assert [f for f in registrar.feed if f.kind == "section"] == []


@pytest.mark.asyncio
async def test_you_approved_says_how_many_requests_it_counts(store_with_posts: tuple[_Store, _Grants]) -> None:
    """Audit F19 (spec §7.2: You approved $ "with {n} req")."""
    store, grants = store_with_posts
    quiet = await _labelled(store, grants).read(2031, casework=False, finance=True, development=False)
    assert next(f for f in quiet.finance or [] if f.key == "approved").note == ""  # "0 req" says nothing
    _event(store, "reqjohnson00001", "approve", _at(4, 15), amount="1200")
    _event(store, "reqgarcia000001", "approve", _at(4, 16), amount="800")
    week = await _labelled(store, grants).read(2031, casework=False, finance=True, development=False)
    approved_figure = next(f for f in week.finance or [] if f.key == "approved")
    assert (approved_figure.value, approved_figure.note) == (2000, "2 req")


# --- Final check (2026-10-11) ------------------------------------------------------------------------------------
# S1: development's Awards counts as the headline counts (each camper and session once, camp aid and outside grants
# together, ruling 15): the week's figure is how many awards the season gained in it.
# S2: the waiting-14+-days item runs on the Waiting on the family line's own clock and population: the CampMinder post
# day, live requests, rounds not clawed back. An undated post (the reproduced load) is no item.


def _posted_on(
    store: FakeDecisionsStore,
    request_id: str,
    created: datetime,
    effective_on: date | None,
    *,
    round_: int = 1,
    lock_source: str = "tick",
) -> None:
    store.events.append(
        DecisionEvent(
            id=f"evt{len(store.events):012d}",
            request_id=request_id,
            round=round_,
            kind="post",
            created=created,
            amount=Decimal(1500),
            effective_on=effective_on,
            lock_source=lock_source,
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )


def _priced(store: FakeDecisionsStore, now: datetime, grants: _Grants | None = None) -> TodayWeekService:
    return TodayWeekService(store=store, grants=grants or _Grants([]), pricing=FakeRules(approved()), clock=lambda: now)


def _awards(week: Any) -> tuple[float, float]:
    figure = next(f for f in week.development or [] if f.key == "awards")
    return figure.value, figure.previous


@pytest.mark.asyncio
async def test_s1_a_camp_post_and_an_outside_grant_on_one_session_are_one_award() -> None:
    """The headline: "The camp's aid plus a grant on the same session is one award". A camper posted and granted on
    the same session in the same week is one award, never two."""
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    _event(store, "reqjohnson00001", "post", _at(4, 15))
    grants = _Grants([replace(grant_row("reqjohnson00001", "800"), recorded_at=_at(4, 16, 15))])
    week = await _service(store, grants).read(2031, casework=False, finance=False, development=True)
    assert _awards(week) == (1, 0)


@pytest.mark.asyncio
async def test_s1_a_later_round_on_a_session_already_awarded_is_no_new_award() -> None:
    """Round 2 posted this week on a session whose Round 1 posted last week: the season's awards did not grow."""
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    _event(store, "reqjohnson00001", "post", _at(4, 8))
    store.events.append(replace(store.events[-1], id="evtround200001", round=2, created=_at(4, 15)))
    week = await _service(store, _Grants([])).read(2031, casework=False, finance=False, development=True)
    assert _awards(week) == (0, 1)


@pytest.mark.asyncio
async def test_s1_a_post_undone_and_ticked_again_is_one_award() -> None:
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    _event(store, "reqjohnson00001", "post", _at(4, 14))
    _event(store, "reqjohnson00001", "unpost", _at(4, 14, 20), amount=None)
    _event(store, "reqjohnson00001", "post", _at(4, 15))
    week = await _service(store, _Grants([])).read(2031, casework=False, finance=False, development=True)
    assert _awards(week) == (1, 0)


@pytest.mark.asyncio
async def test_s1_two_sessions_are_two_awards_and_a_camp_only_grant_is_not_an_outside_one() -> None:
    store = _Store()
    seed_request(store, "reqjohnson00001", household=1000001)
    seed_request(store, "reqjohnson00002", household=1000001, session=1000102)
    _event(store, "reqjohnson00001", "post", _at(4, 14))
    _event(store, "reqjohnson00002", "post", _at(4, 15))
    camp = replace(
        grant_row("reqjohnson00001", "800", funder_type="camp"), person_cm_id=1000099, recorded_at=_at(4, 15)
    )
    week = await _service(store, _Grants([camp])).read(2031, casework=False, finance=False, development=True)
    assert _awards(week) == (2, 0)


@pytest.mark.asyncio
async def test_s1_this_week_and_last_week_count_alike(store_with_posts: tuple[_Store, _Grants]) -> None:
    """store_with_posts: Johnson's session first posted Mon 4/7 (last week) and Garcia's Thu 4/10, past last week's
    Monday-to-Wednesday; this week's posts and the grant on Johnson's session add no award."""
    week = await _service(*store_with_posts).read(2031, casework=False, finance=False, development=True)
    assert _awards(week) == (0, 1)
    assert "each camper and session once" in next(f for f in week.development or [] if f.key == "awards").title


MAR24 = datetime(2027, 3, 24, 19, tzinfo=UTC)  # Wednesday, camp time 12:00 (PDT); the week began Mon 2027-03-22


@pytest.mark.asyncio
async def test_s2_a_back_dated_tick_goes_overdue_on_the_campminder_post_day_plus_fifteen() -> None:
    """Ticked Mon 3/22 for a post CampMinder made Mon 3/8: the Waiting line counts it overdue from Tue 3/23 (15 days
    after the post day), so the item is stamped then, at camp midnight, not 15 days after the tick."""
    store = FakeDecisionsStore()
    seed_request(store, "reqjohnson00001", household=1000001)
    _posted_on(store, "reqjohnson00001", datetime(2027, 3, 22, 18, tzinfo=UTC), date(2027, 3, 8))
    week = await _priced(store, MAR24).read(YEAR, casework=True, finance=False, development=False)
    overdue = [f for f in week.feed if f.kind == "overdue"]
    assert [f.at for f in overdue] == [datetime(2027, 3, 23, 7, tzinfo=UTC)]
    assert overdue[0].household_cm_id == 1000001


@pytest.mark.asyncio
async def test_s2_a_load_with_no_post_dates_never_floods_the_feed() -> None:
    """The 2026 reproduced load writes no effective_on: the Waiting line shows those families undated and not
    overdue, so the feed says nothing about them either."""
    store = FakeDecisionsStore()
    for n in range(4):
        rid = f"reqloaded0000{n}"
        seed_request(store, rid, household=1000001 + n, person=1000011 + n)
        _posted_on(store, rid, datetime(2027, 3, 8, 18, tzinfo=UTC), None, lock_source="reproduced")
    week = await _priced(store, MAR24).read(YEAR, casework=True, finance=False, development=False)
    assert [f for f in week.feed if f.kind == "overdue"] == []


@pytest.mark.asyncio
async def test_s2_a_cancelled_request_waits_on_no_one() -> None:
    store = FakeDecisionsStore()
    seed_request(store, "reqjohnson00001", household=1000001)
    _posted_on(store, "reqjohnson00001", datetime(2027, 3, 8, 18, tzinfo=UTC), date(2027, 3, 8))
    store.cancel_events.append(
        CancelEvent("can000000000001", "reqjohnson00001", "cancel", T0, reason="not_known", in_kindred=True)
    )
    week = await _priced(store, MAR24).read(YEAR, casework=True, finance=False, development=False)
    assert [f for f in week.feed if f.kind == "overdue"] == []


@pytest.mark.asyncio
async def test_s2_a_round_campminder_reversed_waits_on_no_one() -> None:
    """A withdrawn request whose CampMinder money was reversed (D54's claw-back) is not waiting on the family."""
    store = FakeDecisionsStore()
    seed_request(store, "reqjohnson00001", household=1000001, status="withdrawn")
    _posted_on(store, "reqjohnson00001", datetime(2027, 3, 8, 18, tzinfo=UTC), date(2027, 3, 8))
    seed_line(
        store,
        9001,
        "1500",
        posted=datetime(2027, 3, 8, 18, tzinfo=UTC),
        reversed_at=datetime(2027, 3, 12, 18, tzinfo=UTC),
    )
    store.synced_at = datetime(2027, 3, 13, 18, tzinfo=UTC)
    week = await _priced(store, MAR24).read(YEAR, casework=True, finance=False, development=False)
    assert [f for f in week.feed if f.kind == "overdue"] == []


@pytest.mark.asyncio
async def test_s2_the_item_appears_once_per_request_as_the_line_counts_it() -> None:
    """Two rounds waiting on one request are one family waiting: the line counts requests (over_14_days)."""
    store = FakeDecisionsStore()
    seed_request(store, "reqjohnson00001", household=1000001)
    _posted_on(store, "reqjohnson00001", datetime(2027, 3, 8, 18, tzinfo=UTC), date(2027, 3, 8))
    _posted_on(store, "reqjohnson00001", datetime(2027, 3, 8, 19, tzinfo=UTC), date(2027, 3, 8), round_=2)
    week = await _priced(store, MAR24).read(YEAR, casework=True, finance=False, development=False)
    assert [f.kind for f in week.feed].count("overdue") == 1


@pytest.mark.asyncio
async def test_s2_development_never_prices_the_season() -> None:
    class _NoSeason(FakeDecisionsStore):
        async def fetch_sessions(self, year: int) -> Any:
            raise AssertionError("development read the season")

    store = _NoSeason()
    seed_request(store, "reqjohnson00001", household=1000001)
    _posted_on(store, "reqjohnson00001", datetime(2027, 3, 8, 18, tzinfo=UTC), date(2027, 3, 8))
    week = await _priced(store, MAR24).read(YEAR, casework=False, finance=False, development=True)
    assert all(f.household_cm_id is None for f in week.feed)
