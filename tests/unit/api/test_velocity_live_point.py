"""PR 5b (#3207): Velocity's live point, the enrolled count now continuing the 3 a.m. stored line.

The line ends at the nightly snapshot. ``VelocityResponse.live`` carries the count the hourly sync has
written since, in the line's own scope, so the page can draw one more point after it. The rule it must
keep is that it CONTINUES the same series: with no change since 3 a.m. the live count equals the stored
point exactly.
"""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from api.schemas.velocity import VelocityResponse
from api.services.velocity_service import VelocityService
from tests.unit.api.conftest import create_mock_session

YEAR = 2027
# Priority date 2026-11-03; "today" is 41 days in, a live season.
REG_DATES = {"priority_reg_date": "2026-11-03"}
TODAY = date(2026, 12, 14)
LAST = "2026-12-14 10:40:12.000Z"


def snap(when: str, sid: int, enrolled: int, cancelled: int = 0) -> Mock:
    s = Mock()
    s.snapshot_datetime = when
    s.session_cm_id = sid
    s.year = YEAR
    s.enrolled_count = enrolled
    s.waitlisted_count = 0
    s.cancelled_count = cancelled
    for f in (
        "enrolled_male_count",
        "enrolled_female_count",
        "waitlisted_male_count",
        "waitlisted_female_count",
        "cancelled_male_count",
        "cancelled_female_count",
    ):
        setattr(s, f, None)
    return s


def enrolled(person_id: int, sid: int) -> Mock:
    """An attendee row as fetch_attendees returns it: status_id 2, its session in expand."""
    a = Mock()
    a.person_id = person_id
    a.year = YEAR
    a.status = "enrolled"
    a.status_id = 2
    a.enrollment_date = "2026-11-04"
    a.effective_date = "2026-11-04"
    session = Mock()
    session.cm_id = sid
    a.expand = {"session": session}
    return a


def campers(sid: int, n: int, start: int) -> list[Mock]:
    return [enrolled(start + i, sid) for i in range(n)]


@pytest.fixture
def repo() -> Any:
    r = AsyncMock()
    r.fetch_registration_dates = AsyncMock(return_value=REG_DATES)
    r.fetch_sessions = AsyncMock(
        return_value={
            1001: create_mock_session(1001, "Session 1", year=YEAR, start_date="2027-06-15", end_date="2027-07-05"),
            1002: create_mock_session(1002, "Session 2", year=YEAR, start_date="2027-06-15", end_date="2027-07-05"),
            1003: create_mock_session(
                1003,
                "AG 1",
                year=YEAR,
                session_type="ag",
                parent_id=1001,
                start_date="2027-06-15",
                end_date="2027-07-05",
            ),
        }
    )
    r.fetch_enrollment_snapshots = AsyncMock(
        return_value=[
            snap("2026-12-13 10:41:00.000Z", 1001, 18),
            snap("2026-12-13 10:41:00.000Z", 1002, 9),
            snap("2026-12-13 10:41:00.000Z", 1003, 2),
            snap(LAST, 1001, 20),
            snap(LAST, 1002, 10),
            snap(LAST, 1003, 3),
        ]
    )
    r.fetch_attendees_with_dates = AsyncMock(return_value=[])
    r.fetch_snapshots_start = AsyncMock(return_value="2026-10-01 10:00:00.000Z")
    # Nothing changed since 3 a.m.: the same counts the last snapshot stored.
    r.fetch_attendees = AsyncMock(return_value=campers(1001, 20, 1) + campers(1002, 10, 100) + campers(1003, 3, 200))
    return r


async def velocity(repo: Any, **kw: Any) -> VelocityResponse:
    return await VelocityService(repo).get_velocity(year=YEAR, today=kw.pop("today", TODAY), **kw)


@pytest.mark.asyncio
async def test_live_equals_the_stored_point_when_nothing_changed(repo):
    result = await velocity(repo)

    assert result.combined.daily[-1].enrolled == 33
    assert result.live is not None
    assert result.live.enrolled == result.combined.daily[-1].enrolled
    assert result.live.stored_at == LAST


@pytest.mark.asyncio
async def test_live_adds_the_sign_ups_since_the_stored_point(repo):
    repo.fetch_attendees.return_value += campers(1002, 4, 300)

    result = await velocity(repo)

    assert result.combined.daily[-1].enrolled == 33
    assert result.live is not None
    assert result.live.enrolled == 37


@pytest.mark.asyncio
async def test_an_all_gender_cabin_counts_with_its_parent_session(repo):
    """The line folds an AG cabin's snapshot into its parent; the live count folds its campers the same way."""
    repo.fetch_attendees.return_value += campers(1003, 2, 300)

    result = await velocity(repo, session_cm_id=1001)

    assert result.combined.daily[-1].enrolled == 23  # 20 + AG's 3
    assert result.live is not None
    assert result.live.enrolled == 25


@pytest.mark.asyncio
async def test_campers_outside_the_scope_do_not_move_it(repo):
    repo.fetch_attendees.return_value += campers(1002, 5, 300) + campers(9999, 7, 400)

    result = await velocity(repo, session_cm_id=1001)

    assert result.live is not None
    assert result.live.enrolled == result.combined.daily[-1].enrolled == 23


@pytest.mark.asyncio
async def test_a_dropped_enrollment_lowers_it(repo):
    repo.fetch_attendees.return_value = repo.fetch_attendees.return_value[1:]

    result = await velocity(repo)

    assert result.live is not None
    assert result.live.enrolled == 32


@pytest.mark.asyncio
async def test_no_live_point_once_the_season_is_over(repo):
    """#110: only the current live season. A closed season's line is history."""
    result = await velocity(repo, today=date(2027, 9, 30))

    assert result.today_day_offset is None
    assert result.live is None


@pytest.mark.asyncio
async def test_no_live_point_on_the_cancellation_metric(repo):
    """Cancellations stay at the 3 a.m. count."""
    repo.fetch_status_transitions = AsyncMock(return_value=[])

    result = await velocity(repo, metric="cancellation")

    assert result.live is None


@pytest.mark.asyncio
async def test_no_live_point_without_a_stored_line(repo):
    """With no nightly snapshot the line is rebuilt from registration dates, which is already live."""
    repo.fetch_enrollment_snapshots.return_value = []
    repo.fetch_attendees_with_dates.return_value = []

    result = await velocity(repo)

    assert result.live is None


@pytest.mark.asyncio
async def test_a_session_missing_from_the_last_snapshot_is_not_added(repo):
    """The live count moves only the sessions counted on the stored point's own night. A session missing
    from that count rides the line at its earlier value (carried forward), and the live point leaves it so."""
    repo.fetch_enrollment_snapshots.return_value = [
        s
        for s in repo.fetch_enrollment_snapshots.return_value
        if not (s.session_cm_id == 1002 and s.snapshot_datetime == LAST)
    ]
    repo.fetch_attendees.return_value += campers(1002, 6, 300)

    result = await velocity(repo)

    assert result.combined.daily[-1].enrolled == 32  # 20 + AG's 3, and Session 2's 9 carried from the night before
    assert result.live is not None
    assert result.live.enrolled == 32


@pytest.mark.asyncio
async def test_a_failed_live_read_leaves_the_stored_line(repo):
    repo.fetch_attendees.side_effect = RuntimeError("db gone")

    result = await velocity(repo)

    assert result.live is None
    assert result.combined.daily[-1].enrolled == 33


@pytest.mark.asyncio
async def test_a_rebuilt_quest_in_scope_is_counted_once(repo):
    """The default scope holds Quests, which the snapshot job never counts: the line rebuilds them from the
    attendees already (hybrid path), so the live count must leave them as rebuilt, not count them a second time."""
    sessions = repo.fetch_sessions.return_value
    sessions[1004] = create_mock_session(
        1004, "Quest 1", year=YEAR, session_type="quest", start_date="2027-06-15", end_date="2027-07-05"
    )
    quest = campers(1004, 5, 500)
    repo.fetch_attendees_with_dates.return_value = quest
    repo.has_pre_anchor_enrollments = AsyncMock(return_value=False)
    repo.fetch_attendees.return_value += quest

    result = await velocity(repo)

    assert result.combined.daily[-1].enrolled == 38  # 33 stored + the 5 rebuilt Quest campers
    assert result.live is not None
    assert result.live.enrolled == 38

    repo.fetch_attendees.return_value += campers(1004, 2, 600) + campers(1001, 1, 700)
    repo.fetch_attendees_with_dates.return_value = quest + campers(1004, 2, 600)

    result = await velocity(repo)

    assert result.combined.daily[-1].enrolled == 40  # the rebuilt Quest line is already current
    assert result.live is not None
    assert result.live.enrolled == 41  # only the snapshot session's new camper is added


@pytest.mark.asyncio
async def test_live_on_the_pure_snapshot_path(repo):
    """Snapshots from the priority day on take the pure snapshot path (the live season's real case): the live
    count still starts from the stored point and moves by the sign-ups since."""
    early = "2026-11-03 10:40:00.000Z"
    repo.fetch_enrollment_snapshots.return_value = [
        snap(early, 1001, 1),
        snap(early, 1002, 1),
        snap(early, 1003, 0),
        *repo.fetch_enrollment_snapshots.return_value,
    ]

    result = await velocity(repo)

    assert result.combined.daily[0].date == "2026-11-03"
    assert result.combined.daily[-1].enrolled == 33
    assert result.live is not None
    assert result.live.enrolled == 33

    repo.fetch_attendees.return_value += campers(1002, 3, 300)

    result = await velocity(repo)

    assert result.live is not None
    assert result.live.enrolled == 36
