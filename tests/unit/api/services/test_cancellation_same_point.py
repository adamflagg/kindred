"""Cancellations compares with the same point last year while registration is live (PM-8 A, decision 7).

``calculate_cancellations(year, ..., same_point_of=S)`` reads ``year`` at the registration day season S
has reached today. Cancelled by day N = a cancelled, withdrawn or dismissed record whose cancellation
(its ``enrollment_date``, the date ``attendees_at_cutoff`` reads "left by N" from) is on or before the
cutoff; "still enrolled elsewhere" is the enrolled-at-N set (registered by N, not cancelled by N).
Every figure built from those two sets reads the same day. The figures that need status history (the
status before cancelling, Re-enrolled) read the same day only when that history covers the compare
year's whole registration year; otherwise they are None: no comparison, never a final figure.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.cancellation_service import CancellationService

PRIOR = 2025
CURRENT = 2026
ANCHORS = {CURRENT: "2025-11-12", PRIOR: "2024-11-12"}
STATUS_IDS = {"enrolled": 2, "cancelled": 32, "withdrawn": 256, "dismissed": 64}
TYPES = ["main", "embedded", "ag", "quest"]


@dataclass
class _Session:
    cm_id: int
    name: str
    session_type: str = "main"
    parent_id: int | None = None
    start_date: str | None = None
    end_date: str | None = None


@dataclass
class _Person:
    person_id: int
    gender: str | None = "F"
    grade: int | None = 5


@dataclass
class _Att:
    person_id: int
    status: str
    status_id: int
    effective_date: str
    enrollment_date: str
    expand: dict[str, Any] = field(default_factory=dict)


@dataclass
class _History:
    person_id: int
    old_status: str
    new_status: str
    detected_at: str
    expand: dict[str, Any] = field(default_factory=dict)


def _sessions(year: int) -> dict[int, _Session]:
    # Dated in the year asked for: 2026 stays live until its last session starts (2026-07-26)
    return {
        1000: _Session(1000, "Session 2", start_date=f"{year}-06-28", end_date=f"{year}-07-18"),
        1001: _Session(1001, "Session 3", start_date=f"{year}-07-26", end_date=f"{year}-08-08"),
    }


def _att(pid: int, sid: int, status: str, registered: str, posted: str) -> _Att:
    return _Att(pid, status, STATUS_IDS[status], registered, posted, {"session": _sessions(PRIOR)[sid]})


# 2025, read at day 110 of 2026's season (2026-03-02) -> cutoff 2025-03-02
PRIOR_ATTENDEES = [
    # Emma: cancelled Session 2 by the cutoff, still enrolled in Session 3 then: a swap
    _att(1000001, 1000, "cancelled", "2024-11-12", "2025-01-10"),
    _att(1000001, 1001, "enrolled", "2024-11-12", "2024-11-12"),
    # Liam: cancelled after the cutoff: not cancelled yet then
    _att(1000002, 1000, "cancelled", "2024-11-13", "2025-05-01"),
    # Olivia: withdrew by the cutoff, nothing else: a departure
    _att(1000003, 1001, "withdrawn", "2024-11-20", "2025-02-01"),
    # Riley: dismissed on the cutoff day itself: counts
    _att(1000004, 1000, "dismissed", "2024-11-12", "2025-03-02"),
    # Samuel: cancelled by the cutoff; his other enrolment came after it, so he had left camp then
    _att(1000005, 1001, "cancelled", "2024-12-01", "2025-02-15"),
    _att(1000005, 1000, "enrolled", "2025-04-01", "2025-04-01"),
    # No cancellation date: cannot be placed on a day, so never "cancelled by" one
    _att(1000006, 1000, "cancelled", "2024-11-12", ""),
]

HISTORY_TO_CANCELLED = [
    _History(1000001, "enrolled", "cancelled", "2025-01-10 20:00:00.000Z"),
    _History(1000005, "waitlisted", "cancelled", "2025-02-15 20:00:00.000Z"),
    _History(1000002, "enrolled", "cancelled", "2025-05-01 20:00:00.000Z"),
]
HISTORY_RE_ENROLLED = [
    _History(1000001, "cancelled", "enrolled", "2025-01-20 20:00:00.000Z"),
    _History(1000003, "cancelled", "enrolled", "2025-04-01 20:00:00.000Z"),
]
for _h in HISTORY_TO_CANCELLED + HISTORY_RE_ENROLLED:
    _h.expand = {"session": _sessions(PRIOR)[1000]}


def _repo(history_start: str | None = None) -> AsyncMock:
    repo = AsyncMock()

    async def fetch_sessions(year: int, session_types: Any = None) -> dict[int, _Session]:
        return {k: s for k, s in _sessions(year).items() if session_types is None or s.session_type in session_types}

    async def fetch_attendees(year: int, status_filter: Any = None, expand_person: bool = False) -> list[Any]:
        wanted = status_filter if isinstance(status_filter, list) else [status_filter or "enrolled"]
        return [a for a in PRIOR_ATTENDEES if a.status in wanted]

    async def with_dates(year: int, session_cm_id: int | None = None, expand_person: bool = False) -> list[Any]:
        return list(PRIOR_ATTENDEES)

    async def fetch_dates(year: int) -> dict[str, str]:
        return {"priority_reg_date": ANCHORS[year]} if year in ANCHORS else {}

    async def fetch_history(year: int, old_status: str | None = None, new_statuses: Any = None) -> list[Any]:
        if old_status == "cancelled":
            return list(HISTORY_RE_ENROLLED)
        return list(HISTORY_TO_CANCELLED)

    repo.fetch_sessions.side_effect = fetch_sessions
    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_attendees_with_dates.side_effect = with_dates
    repo.fetch_registration_dates.side_effect = fetch_dates
    repo.fetch_status_history.side_effect = fetch_history
    repo.fetch_status_history_start.return_value = history_start
    repo.fetch_persons.return_value = {i: _Person(i, grade=5 if i < 1000004 else 6) for i in range(1000001, 1000007)}
    return repo


async def _same_day(repo: AsyncMock) -> Any:
    return await CancellationService(repo).calculate_cancellations(
        PRIOR, session_types=TYPES, same_point_of=CURRENT, today=date(2026, 3, 2)
    )


class TestCancellationsSamePoint:
    @pytest.mark.asyncio
    async def test_says_which_day_it_read(self) -> None:
        result = await _same_day(_repo())

        assert result.prior_basis == "same_point"
        assert result.day_offset == 110
        assert result.prior_day_offset == 110
        assert result.as_of_date == "2025-03-02"

    @pytest.mark.asyncio
    async def test_counts_the_cancellations_dated_by_the_cutoff(self) -> None:
        result = await _same_day(_repo())

        assert result.total_cancelled == 4  # Emma, Olivia, Riley, Samuel

    @pytest.mark.asyncio
    async def test_still_attending_reads_who_was_enrolled_then(self) -> None:
        result = await _same_day(_repo())

        assert (result.has_other_sessions, result.no_other_sessions) == (1, 3)
        assert (result.session_swap_count, result.true_departure_count) == (1, 3)

    @pytest.mark.asyncio
    async def test_by_session_reads_the_same_day(self) -> None:
        result = await _same_day(_repo())

        rows = {
            s.session_name: (s.total_cancelled, s.has_other_sessions, s.no_other_sessions) for s in result.by_session
        }
        assert rows == {"Session 2": (2, 1, 1), "Session 3": (2, 0, 2)}

    @pytest.mark.asyncio
    async def test_grade_and_gender_read_the_same_day(self) -> None:
        result = await _same_day(_repo())

        assert {g.grade: g.count for g in result.by_grade} == {5: 2, 6: 2}
        assert sum(g.count for g in result.by_gender) == 4

    @pytest.mark.asyncio
    async def test_time_to_cancel_and_registration_month_read_the_same_day(self) -> None:
        result = await _same_day(_repo())

        # Non-swaps: Olivia 73 days, Riley 110, Samuel 76
        assert result.avg_days_to_cancellation == 86.3
        assert result.median_days_to_cancellation == 76.0
        assert {m.month: m.count for m in result.by_registration_month} == {"Nov 2024": 3, "Dec 2024": 1}

    @pytest.mark.asyncio
    async def test_without_history_for_the_whole_year_the_status_figures_have_no_comparison(self) -> None:
        repo = _repo(history_start="2025-02-11 23:10:17.859Z")  # started after the 2025 anchor

        result = await _same_day(repo)

        assert result.was_enrolled is None
        assert result.was_waitlisted is None
        assert result.was_applied is None
        assert result.other_prior_status is None
        assert result.total_re_enrolled is None
        repo.fetch_status_history.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_history_at_all_has_no_comparison_either(self) -> None:
        result = await _same_day(_repo(history_start=None))

        assert result.was_enrolled is None
        assert result.total_re_enrolled is None

    @pytest.mark.asyncio
    async def test_history_covering_the_year_reads_the_changes_recorded_by_the_cutoff(self) -> None:
        result = await _same_day(_repo(history_start="2024-10-01 12:00:00.000Z"))

        assert result.was_enrolled == 1  # Emma; Liam's change came after the cutoff
        assert result.was_waitlisted == 1  # Samuel
        assert result.total_re_enrolled == 1  # Emma; Olivia re-enrolled after it


class TestCancellationsFinal:
    @pytest.mark.asyncio
    async def test_after_the_season_reads_the_year_as_it_stands(self) -> None:
        result = await CancellationService(_repo()).calculate_cancellations(
            PRIOR, session_types=TYPES, same_point_of=CURRENT, today=date(2026, 7, 26)
        )

        assert result.prior_basis == "final"
        assert result.as_of_date is None
        assert result.total_cancelled == 6
        assert result.has_other_sessions == 2
        assert result.was_enrolled is not None

    @pytest.mark.asyncio
    async def test_a_plain_read_has_no_basis(self) -> None:
        result = await CancellationService(_repo()).calculate_cancellations(PRIOR, session_types=TYPES)

        assert result.prior_basis is None
        assert result.total_cancelled == 6
