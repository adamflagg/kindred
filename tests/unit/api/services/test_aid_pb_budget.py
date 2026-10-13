"""How many PocketBase reads one Camperships season build makes, against a fixed budget.

Two caches keep these green: the sync-input cache (layer 1, api/services/aid_sync_inputs.py, shared by the
season's heavy reads) brings a cold build under budget, and the season cache (layer 2,
api/services/aid_season_cache.py) makes a repeat read free and a rebuild after a write read no heavy table.

The fixture season is 200 request households (300 requests, 300 campers) plus 800 grant-only households:
1000 households and 1100 persons. This file budgets call COUNTS; it is not a correctness proof (the
person_custom_values table is empty, and FakeRules means aid_rules reads are not counted). PocketBase is a RecordingPb: it
counts calls and ignores filters, so the counts are exact and the row sets are supersets."""

from __future__ import annotations

import re
from collections import Counter
from types import SimpleNamespace
from typing import Any

import pytest

from api.dependencies import aid_season_cache
from api.services.aid_season_cache import on_aid_commit
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_grants_service import GrantsService
from bunking.financial_aid.change_log import AidWrite
from tests.unit.api.services.decisions_fakes import FakeRules, approved
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR
from tests.unit.api.services.pb_recording import HEAVY, RecordingPb

COLD_BUDGET = 100
AFTER_WRITE_BUDGET = 20

HOUSEHOLDS = 200  # applicant households: 100 with two campers, 100 with one
CAMPERS = 300  # one request each
# The grants register also reads every household holding an outside grant line, applicant or not, and a
# real season's register spans far more households than its applicants. The cold count is dominated by
# these (the register reads their people by household, in chunks), so the fixture needs them: with only
# the 200 applicants a cold build makes ~60 calls, which would hide the problem the budget exists for.
GRANT_ONLY_HOUSEHOLDS = 800  # never applied; one outside grant line and one person each
_SUMMER_SESSION = 1000101
_FAMILY_NAMES = ("Johnson", "Garcia", "Chen", "Sam", "Rivera", "Okafor", "Lindqvist", "Haddad")
_FIRST_NAMES = ("Emma", "Liam", "Olivia", "Riley", "Samuel", "Maya", "Noah", "Ava")

# A filter that reaches through a relation (person.cm_id = ..., field_definition.cm_id = ...) makes
# PocketBase join per row; the budget forbids it on the season's reads.
_RELATION_PATH = re.compile(r"\b[a-z_]+\.[a-z_]+\s*(=|~|!=)")


def _household_id(n: int) -> int:
    return 2_000_000 + n


def _person_id(n: int) -> int:
    return 3_000_000 + n


def _rid(prefix: str, n: int) -> str:
    return f"{prefix}{n:0{15 - len(prefix)}d}"  # a 15-character PocketBase id


def _build_tables() -> dict[str, list[Any]]:
    households = [
        SimpleNamespace(
            id=_rid("hh", h),
            cm_id=_household_id(h),
            year=YEAR,
            greeting=f"The {_FAMILY_NAMES[h % len(_FAMILY_NAMES)]} Family",
            mailing_title="",
            alternate_mailing_title="",
            billing_mailing_title="",
        )
        for h in range(HOUSEHOLDS + GRANT_ONLY_HOUSEHOLDS)
    ]
    persons: list[Any] = []
    applications: list[Any] = []
    requests: list[Any] = []
    attendees: list[Any] = []
    postings: list[Any] = []
    sessions = [
        SimpleNamespace(
            id=_rid("ses", i),
            cm_id=s.cm_id,
            year=YEAR,
            name=s.name,
            session_type=s.session_type,
            start_date=s.start_date,
            end_date="",
            parent_id=0,
        )
        for i, s in enumerate(SESSIONS)
    ]
    session_row = next(s for s in sessions if s.cm_id == _SUMMER_SESSION)
    next_person = 0
    for h in range(HOUSEHOLDS + GRANT_ONLY_HOUSEHOLDS):
        applied = h < HOUSEHOLDS
        camper_ids = [_person_id(next_person + k) for k in range(2 if applied and h < 100 else 1)]
        next_person += len(camper_ids)
        if applied:
            applications.append(
                SimpleNamespace(
                    id=_rid("app", h),
                    year=YEAR,
                    household_cm_id=_household_id(h),
                    status="active",
                    answers={},
                    member_person_cm_ids=camper_ids,
                    flags=[],
                )
            )
        else:
            postings.append(
                SimpleNamespace(
                    id=_rid("pst", h),
                    transaction_cm_id=4_000_000 + h,
                    household_cm_id=_household_id(h),
                    person_cm_id=0,
                    amount=250.0,
                    effective_source_key="outside_trust",
                    source_key="outside_trust",
                    source_family="outside",
                    funder_type="outside",
                    post_date="2027-03-01",
                    is_reversed=False,
                    reversal_date="",
                    attribution_method="",
                    attributed_person_cm_id=0,
                    attributed_session_cm_id=0,
                    program_family="",
                )
            )
        for p in camper_ids:
            n = p - _person_id(0)
            person = SimpleNamespace(
                id=_rid("per", n),
                cm_id=p,
                year=YEAR,
                household_id=_household_id(h),
                first_name=_FIRST_NAMES[n % len(_FIRST_NAMES)],
                last_name=_FAMILY_NAMES[h % len(_FAMILY_NAMES)],
                gender_identity_name="",
                gender_pronoun_name="",
                birthdate="2015-04-02",
                expand={},
            )
            persons.append(person)
            attendees.append(
                SimpleNamespace(
                    id=_rid("att", n),
                    person_id=p,
                    year=YEAR,
                    status_id=2,
                    enrollment_date="2027-02-01 12:00:00.000Z",
                    expand={"person": person, "session": session_row},
                )
            )
            if applied:
                requests.append(
                    SimpleNamespace(
                        id=_rid("req", n),
                        year=YEAR,
                        application=_rid("app", h),
                        household_cm_id=_household_id(h),
                        person_cm_id=p,
                        session_cm_id=_SUMMER_SESSION,
                        program_key="summer",
                        session_resolution="matched",
                        ask=1500.0,
                        status="active",
                        flags=[],
                    )
                )
    assert len(requests) == CAMPERS
    return {
        "households": households,
        "persons": persons,
        "attendees": attendees,
        "camp_sessions": sessions,
        "aid_applications": applications,
        "aid_requests": requests,
        "aid_postings": postings,
    }


@pytest.fixture
def season_pb() -> RecordingPb:
    return RecordingPb(_build_tables())


def invalidate_after_write(year: int) -> None:
    """What commit_aid_writes' listener does after a staff write to `year`: the real listener, on a real write."""
    on_aid_commit(
        [
            AidWrite(
                collection="aid_requests",
                action="update",
                year=year,
                record_id=_rid("req", 0),
                before={"ask": 1500.0},
                data={"ask": 1600.0},
            )
        ],
        "staff@example.org",
    )


async def _discard_commit(*_args: Any, **_kwargs: Any) -> None:
    return None


def _service(pb: RecordingPb, *, cached: bool = False) -> FinancialAidDecisionsService:
    """The real service over the real repositories; only the rules are a fake, because a rules read is not
    one of the heavy collections. `cached` builds through the process's season cache, as every staff read does."""
    store = FinancialAidDecisionsRepository(pb)
    # The one stub: a season read logs the grants register's new placements through a PocketBase BATCH write,
    # which RecordingPb cannot serve (no auth store). It is a write, not one of the counted reads, and the
    # budget concerns reads; every read, the four heavy collections included, goes through real repository code.
    # Side effect: this removes the placement-log self-invalidation path (a read that logs placements writes,
    # which must NOT drop the season cache), so test_aid_season_cache.py covers that path itself.
    store.commit = _discard_commit  # type: ignore[method-assign, assignment]
    return FinancialAidDecisionsService(
        store,
        FakeRules(approved()),
        GrantsService(GrantsRepository(pb)).register_rows,
        season_cache=aid_season_cache if cached else None,
    )


def _summary(pb: RecordingPb) -> str:
    counts = Counter(c for c, _ in pb.calls)
    lines = [f"{len(pb.calls)} PocketBase calls"]
    lines += [f"  {c:<28}{n:>5}{'  (heavy)' if c in HEAVY else ''}" for c, n in counts.most_common()]
    return "\n".join(lines)


# Layer 1 (aid_sync_inputs) brought the cold build under budget: 167 calls (145 heavy) became 27 (4 heavy, one
# per table).
@pytest.mark.asyncio
async def test_a_cold_season_build_stays_under_budget(season_pb: RecordingPb) -> None:
    await _service(season_pb).season(YEAR)
    assert len(season_pb.calls) < COLD_BUDGET, _summary(season_pb)
    assert not [f for _, f in season_pb.calls if _RELATION_PATH.search(f)], "a filter traverses a relation"


@pytest.mark.asyncio
async def test_a_rebuild_after_a_write_reads_no_heavy_table(season_pb: RecordingPb) -> None:
    # A fresh service per call, as production builds one per request: the cache under test must be
    # process-level, shared across service instances, not a per-instance memo.
    await _service(season_pb, cached=True).season(YEAR)
    season_pb.reset()
    invalidate_after_write(YEAR)  # what a staff write's commit listener does
    await _service(season_pb, cached=True).season(YEAR)
    assert len(season_pb.calls) < AFTER_WRITE_BUDGET, _summary(season_pb)
    assert sum(season_pb.count(c) for c in HEAVY) == 0, _summary(season_pb)


@pytest.mark.asyncio
async def test_a_cached_season_reads_nothing(season_pb: RecordingPb) -> None:
    # Fresh service per call: the cache must be process-level, shared across instances (see above).
    await _service(season_pb, cached=True).season(YEAR)
    season_pb.reset()
    await _service(season_pb, cached=True).season(YEAR)
    assert season_pb.calls == []
