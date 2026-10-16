"""Velocity's gender picker (#2898, owner answer #78): "Gender field | Gender identity", default the Gender field.

The Gender field split paces against cabins and reads the nightly snapshot's boys/girls counts where it can. The
snapshot stores nothing else, so the identity split is rebuilt from attendee records (registered by the day and not
cancelled by it), the way Today's Pace prior is, and never needs the snapshot job to write anything new. Lines are the
five fixed groups (#75 a); a camper with no identity answer counts by the Gender field and the response says how many
(ruling 58), per season.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from api.services.velocity_service import VelocityService
from tests.unit.api.conftest import create_mock_session
from tests.unit.api.test_velocity_service import (
    create_mock_attendee_with_date,
    create_mock_snapshot,
    create_mock_status_transition,
)


def _with_identity(record: Any, gender: str, identity: str = "", write_in: str = "") -> Any:
    person = Mock()
    person.gender = gender
    person.gender_identity_name = identity
    person.gender_identity_write_in = write_in
    record.expand["person"] = person
    return record


def _att(
    pid: int, sid: int, day: str, gender: str, identity: str = "", *, status: str = "enrolled", year: int = 2026
) -> Any:
    return _with_identity(
        create_mock_attendee_with_date(pid, sid, day, year=year, status=status, effective_date=day), gender, identity
    )


def _cancel(pid: int, sid: int, day: str, gender: str, identity: str = "", *, year: int = 2026) -> Any:
    return _with_identity(create_mock_status_transition(pid, sid, day, year=year), gender, identity)


@pytest.fixture
def mock_repository() -> AsyncMock:
    repo = AsyncMock()
    repo.fetch_enrollment_snapshots = AsyncMock(return_value=[])
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_attendees_with_dates = AsyncMock(return_value=[])
    repo.fetch_status_transitions = AsyncMock(return_value=[])

    async def reg_dates(year: int) -> dict[str, str]:
        return {"priority_reg_date": f"{year - 1}-11-01"}

    repo.fetch_registration_dates = AsyncMock(side_effect=reg_dates)
    return repo


@pytest.fixture
def service(mock_repository: AsyncMock) -> VelocityService:
    return VelocityService(mock_repository)


@pytest.fixture
def sessions() -> dict[int, Any]:
    return {
        1001: create_mock_session(1001, "Session 1", session_type="main"),
        1002: create_mock_session(1002, "Session 2", session_type="main"),
    }


@pytest.fixture
def enrolled_2026() -> list[Any]:
    return [
        _att(1, 1001, "2025-11-03", "F", "Girl/woman"),
        _att(2, 1001, "2025-11-10", "F", "Girl/woman"),
        _att(3, 1002, "2025-11-10", "F", "Non-binary"),
        _att(4, 1002, "2025-11-17", "F", "Transgender boy/man"),
        _att(5, 1001, "2025-11-17", "M", "Prefer not to answer"),
        # No identity answer: counted by the Gender field (ruling 58).
        _att(6, 1002, "2025-11-17", "M", ""),
        # Cancelled after registering: on the gross curve, off the net one.
        _att(7, 1001, "2025-11-03", "M", "Boy/man", status="cancelled"),
    ]


def _last(curve: Any) -> int:
    return int(curve.weekly[-1].enrolled)


class TestEnrollmentIdentityMode:
    @pytest.mark.asyncio
    async def test_default_stays_on_the_gender_field(
        self, service: Any, mock_repository: Any, sessions: Any, enrolled_2026: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert result.gender_basis == "field"
        assert sorted(c.gender for c in result.by_gender) == ["F", "M"]
        assert result.gender_fallback_count == 0

    @pytest.mark.asyncio
    async def test_identity_lines_are_the_five_groups_rebuilt_from_attendees(
        self, service: Any, mock_repository: Any, sessions: Any, enrolled_2026: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026
        # Snapshots with boys/girls counts exist, and identity mode never reads them.
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2025-11-20", 1001, 2026, 50, enrolled_male=25, enrolled_female=25)
        ]

        result = await service.get_velocity(year=2026, split_by_gender=True, gender_basis="identity")

        assert result.gender_basis == "identity"
        by = {c.gender: c for c in result.by_gender}
        assert list(by) == ["Girl/woman", "Boy/man", "Non-binary", "Another identity", "No answer"]
        assert _last(by["Girl/woman"]) == 2
        assert _last(by["Boy/man"]) == 1  # the fallback camper; the Boy/man who cancelled is off the net line
        assert by["Boy/man"].weekly[-1].gross_enrolled == 2
        assert _last(by["Non-binary"]) == 1
        assert _last(by["Another identity"]) == 1
        assert _last(by["No answer"]) == 1
        # Daily points too, so the daily chart draws the same lines.
        assert by["Girl/woman"].daily[-1].enrolled == 2
        assert all(p.data_source == "reconstructed" for c in result.by_gender for p in c.weekly)
        assert result.gender_fallback_count == 1

    @pytest.mark.asyncio
    async def test_identity_breakdown_per_session(
        self, service: Any, mock_repository: Any, sessions: Any, enrolled_2026: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026

        result = await service.get_velocity(year=2026, split_by_gender=True, gender_basis="identity")

        rows = {b.session_cm_id: b.by_identity for b in result.session_gender_breakdown}
        assert rows[1001] == {"Girl/woman": 2, "No answer": 1}
        assert rows[1002] == {"Boy/man": 1, "Non-binary": 1, "Another identity": 1}

    @pytest.mark.asyncio
    async def test_prior_years_rebuilt_too_with_their_own_fallback_count(
        self, service: Any, mock_repository: Any
    ) -> None:
        s26 = {1001: create_mock_session(1001, "Session 1", year=2026)}
        s25 = {901: create_mock_session(901, "Session 1", year=2025)}

        async def fetch_sessions(year: int, **_: Any) -> dict[int, Any]:
            return s26 if year == 2026 else s25

        async def fetch_attendees(year: int, **_: Any) -> list[Any]:
            if year == 2026:
                return [_att(1, 1001, "2025-11-03", "F", "Girl/woman")]
            return [
                _att(11, 901, "2024-11-04", "F", "", year=2025),
                _att(12, 901, "2024-11-04", "M", "", year=2025),
                _att(13, 901, "2024-11-04", "M", "Non-binary", year=2025),
            ]

        mock_repository.fetch_sessions.side_effect = fetch_sessions
        mock_repository.fetch_attendees_with_dates.side_effect = fetch_attendees

        result = await service.get_velocity(
            year=2026, compare_years=[2025], split_by_gender=True, gender_basis="identity"
        )

        prior = {c.gender: c for c in result.prior_year_by_gender if c.year == 2025}
        assert _last(prior["Girl/woman"]) == 1
        assert _last(prior["Boy/man"]) == 1
        assert _last(prior["Non-binary"]) == 1
        assert result.gender_fallback_count == 0
        assert result.prior_year_gender_fallback_counts == {2025: 2}

    @pytest.mark.asyncio
    async def test_no_split_ignores_the_basis(
        self, service: Any, mock_repository: Any, sessions: Any, enrolled_2026: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026

        result = await service.get_velocity(year=2026, gender_basis="identity")

        assert result.by_gender == []
        assert result.gender_fallback_count == 0


class TestCancellationIdentityMode:
    @pytest.mark.asyncio
    async def test_cancellation_identity_lines_and_breakdown(
        self, service: Any, mock_repository: Any, sessions: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_status_transitions.return_value = [
            _cancel(1, 1001, "2026-01-12", "F", "Girl/woman"),
            _cancel(2, 1001, "2026-01-12", "M", ""),
            _cancel(3, 1002, "2026-01-19", "F", "Agender"),
            _cancel(4, 1002, "2026-01-19", "F", "Girl/woman"),
        ]

        result = await service.get_velocity(
            year=2026, metric="cancellation", split_by_gender=True, gender_basis="identity"
        )

        by = {c.gender: c for c in result.by_gender}
        assert list(by) == ["Girl/woman", "Boy/man", "Another identity"]
        assert _last(by["Girl/woman"]) == 2
        assert _last(by["Boy/man"]) == 1
        assert _last(by["Another identity"]) == 1
        rows = {b.session_cm_id: b.by_identity for b in result.session_gender_breakdown}
        assert rows[1001] == {"Girl/woman": 1, "Boy/man": 1}
        assert rows[1002] == {"Girl/woman": 1, "Another identity": 1}
        assert result.gender_fallback_count == 1

    @pytest.mark.asyncio
    async def test_cancellation_field_mode_unchanged(self, service: Any, mock_repository: Any, sessions: Any) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_status_transitions.return_value = [_cancel(1, 1001, "2026-01-12", "F", "Agender")]

        result = await service.get_velocity(year=2026, metric="cancellation", split_by_gender=True)

        assert {c.gender for c in result.by_gender} == {"M", "F"}
        assert next(c for c in result.by_gender if c.gender == "F").weekly[-1].enrolled == 1
        assert result.session_gender_breakdown[0].by_identity == {}


def _by_day(curve: Any) -> dict[int, int]:
    return {p.day_offset: int(p.enrolled) for p in curve.daily}


class TestIdentityLinesSumToTheTotal:
    """The identity lines add up to the total line on every day the chart draws (#3273 scan): the pre-season week is
    squeezed once for everyone, not per group, and a camper with no persons row counts under No answer."""

    @pytest.mark.asyncio
    async def test_every_day_including_the_pre_season_week(
        self, service: Any, mock_repository: Any, sessions: Any
    ) -> None:
        attendees = [
            _att(1, 1001, "2025-08-01", "F", "Girl/woman"),  # long before priority registration
            _att(2, 1001, "2025-10-20", "M", "Boy/man"),
            _att(3, 1002, "2025-10-28", "F", "Non-binary"),
            _att(4, 1002, "2025-11-04", "F", "Girl/woman"),
            # No persons row at all: the expand carries no person.
            create_mock_attendee_with_date(5, 1001, "2025-10-15", effective_date="2025-10-15"),
        ]
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = attendees
        mock_repository.has_pre_anchor_enrollments = AsyncMock(return_value=True)

        result = await service.get_velocity(year=2026, split_by_gender=True, gender_basis="identity")

        total = _by_day(result.combined)
        assert min(total) < 0  # the pre-season week is drawn
        sums: dict[int, int] = {}
        for curve in result.by_gender:
            for day, n in _by_day(curve).items():
                sums[day] = sums.get(day, 0) + n
        assert sums == total
        assert {c.gender: c for c in result.by_gender}["No answer"].daily[-1].enrolled == 1

    @pytest.mark.asyncio
    async def test_every_day_when_the_total_is_rebuilt_session_by_session(
        self, service: Any, mock_repository: Any, sessions: Any
    ) -> None:
        # Snapshots that start after the season leave the total on the hybrid path, which rebuilds each session up
        # to its own first snapshot and squeezes each session's pre-season week on its own.
        attendees = [
            _att(1, 1001, "2025-08-01", "F", "Girl/woman"),
            _att(2, 1001, "2025-10-30", "M", "Boy/man"),
            _att(3, 1002, "2025-10-20", "F", "Non-binary"),
            _att(4, 1002, "2025-10-29", "F", "Girl/woman"),
            _att(5, 1002, "2025-11-04", "M", "Boy/man"),
        ]
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = attendees
        mock_repository.has_pre_anchor_enrollments = AsyncMock(return_value=True)
        mock_repository.fetch_enrollment_snapshots.return_value = [
            create_mock_snapshot("2026-09-01", 1001, 2026, 2),
            create_mock_snapshot("2026-09-01", 1002, 2026, 3),
        ]

        result = await service.get_velocity(
            year=2026, split_by_gender=True, gender_basis="identity", today=date(2026, 8, 1)
        )

        total = _by_day(result.combined)
        assert min(total) < 0
        sums: dict[int, int] = {}
        for curve in result.by_gender:
            for day, n in _by_day(curve).items():
                sums[day] = sums.get(day, 0) + n
        assert {d: sums.get(d, 0) for d in total} == total


class TestCancellationDailyGenderLines:
    """Cancellation Velocity's daily chart draws its gender lines (#3273 scan; owner answer #78): each gender curve
    carries a daily cumulative count, one point per day, and the lines add up to the total on each day it marks."""

    @staticmethod
    def _cancels() -> list[Any]:
        return [
            _cancel(1, 1001, "2026-01-12", "F", "Girl/woman"),
            _cancel(2, 1001, "2026-01-12", "M", ""),
            _cancel(3, 1002, "2026-01-19", "F", "Agender"),
            _cancel(4, 1002, "2026-02-02", "M", "Boy/man"),
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("basis", ["field", "identity"])
    async def test_gender_curves_carry_daily(
        self, service: Any, mock_repository: Any, sessions: Any, basis: str
    ) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_status_transitions.return_value = self._cancels()

        result = await service.get_velocity(
            year=2026, metric="cancellation", split_by_gender=True, gender_basis=basis, today=date(2026, 3, 1)
        )

        assert result.combined.daily
        for curve in result.by_gender:
            days = [p.day_offset for p in curve.daily]
            assert days == list(range(days[0], days[0] + len(days)))  # one point per day
        lines = [_by_day(c) for c in result.by_gender]
        for point in result.combined.daily:
            assert sum(line.get(point.day_offset, 0) for line in lines) == point.enrolled
        last = {c.gender: c.daily[-1].enrolled for c in result.by_gender}
        if basis == "field":
            assert last == {"M": 2, "F": 2}
        else:
            assert last == {"Girl/woman": 1, "Boy/man": 2, "Another identity": 1}


class TestCancellationHistoryGap:
    """Campers already cancelled when the dashboard first saw them have no status history row, so they are in the
    snapshot total but never on a gender line. The response says how many, per season, in both picker modes."""

    @pytest.fixture
    def one_session(self) -> dict[int, Any]:
        return {1001: create_mock_session(1001, "Session 1", session_type="main")}

    @staticmethod
    def _snap(year: int, cancelled: int) -> Any:
        return create_mock_snapshot(f"{year}-01-31", 1001, year, 20, cancelled=cancelled)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("basis", ["field", "identity"])
    async def test_gap_is_snapshot_total_minus_lines(
        self, service: Any, mock_repository: Any, one_session: Any, basis: str
    ) -> None:
        mock_repository.fetch_sessions.return_value = one_session
        mock_repository.fetch_enrollment_snapshots.return_value = [self._snap(2026, 5)]
        mock_repository.fetch_status_transitions.return_value = [
            _cancel(1, 1001, "2026-01-12", "F", "Girl/woman"),
            _cancel(2, 1001, "2026-01-13", "M", "Boy/man"),
        ]

        result = await service.get_velocity(
            year=2026, metric="cancellation", split_by_gender=True, gender_basis=basis, today=date(2026, 3, 1)
        )

        assert result.cancelled_to_date == 5
        assert [(g.year, g.unseen_count, g.no_history) for g in result.gender_history_gaps] == [(2026, 3, False)]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("basis", ["field", "identity"])
    async def test_no_gap_when_lines_match_total(
        self, service: Any, mock_repository: Any, one_session: Any, basis: str
    ) -> None:
        mock_repository.fetch_sessions.return_value = one_session
        mock_repository.fetch_enrollment_snapshots.return_value = [self._snap(2026, 2)]
        mock_repository.fetch_status_transitions.return_value = [
            _cancel(1, 1001, "2026-01-12", "F", "Girl/woman"),
            _cancel(2, 1001, "2026-01-13", "M", "Boy/man"),
        ]

        result = await service.get_velocity(
            year=2026, metric="cancellation", split_by_gender=True, gender_basis=basis, today=date(2026, 3, 1)
        )

        assert [(g.year, g.unseen_count, g.no_history) for g in result.gender_history_gaps] == [(2026, 0, False)]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("basis", ["field", "identity"])
    async def test_season_without_history_is_flagged_and_keeps_its_total(
        self, service: Any, mock_repository: Any, one_session: Any, basis: str
    ) -> None:
        mock_repository.fetch_sessions.return_value = one_session
        mock_repository.fetch_enrollment_snapshots.return_value = [self._snap(2025, 7)]

        result = await service.get_velocity(
            year=2025, metric="cancellation", split_by_gender=True, gender_basis=basis, today=date(2026, 3, 1)
        )

        assert result.cancelled_to_date == 7
        assert all(not c.weekly for c in result.by_gender)
        assert [(g.year, g.unseen_count, g.no_history) for g in result.gender_history_gaps] == [(2025, 7, True)]

    @pytest.mark.asyncio
    async def test_compared_season_gets_its_own_entry(
        self, service: Any, mock_repository: Any, one_session: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = one_session

        async def snaps(year: int) -> list[Any]:
            return [self._snap(year, 5 if year == 2026 else 7)]

        mock_repository.fetch_enrollment_snapshots.side_effect = snaps

        async def transitions(year: int, *_a: Any, **_k: Any) -> list[Any]:
            if year == 2026:
                return [_cancel(1, 1001, "2026-01-12", "F", "Girl/woman")]
            return []

        mock_repository.fetch_status_transitions.side_effect = transitions

        result = await service.get_velocity(
            year=2026,
            metric="cancellation",
            split_by_gender=True,
            compare_years=[2025],
            today=date(2026, 3, 1),
        )

        assert [(g.year, g.unseen_count, g.no_history) for g in result.gender_history_gaps] == [
            (2026, 4, False),
            (2025, 7, True),
        ]

    @pytest.mark.asyncio
    async def test_not_split_or_enrollment_has_no_entries(
        self, service: Any, mock_repository: Any, one_session: Any
    ) -> None:
        mock_repository.fetch_sessions.return_value = one_session
        mock_repository.fetch_enrollment_snapshots.return_value = [self._snap(2026, 5)]

        unsplit = await service.get_velocity(year=2026, metric="cancellation", today=date(2026, 3, 1))
        enrollment = await service.get_velocity(year=2026, split_by_gender=True, today=date(2026, 3, 1))

        assert unsplit.gender_history_gaps == []
        assert enrollment.gender_history_gaps == []
