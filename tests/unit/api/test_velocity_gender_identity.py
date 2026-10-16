"""Velocity's gender picker (#2898, owner answer #78): "Gender field | Gender identity", default the Gender field.

The Gender field split paces against cabins and reads the nightly snapshot's boys/girls counts where it can. The
snapshot stores nothing else, so the identity split is rebuilt from attendee records (registered by the day and not
cancelled by it), the way Today's Pace prior is, and never needs the snapshot job to write anything new. Lines are the
five fixed groups (#75 a); a camper with no identity answer counts by the Gender field and the response says how many
(ruling 58), per season.
"""

from __future__ import annotations

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


def _att(pid: int, sid: int, day: str, gender: str, identity: str = "", *, status: str = "enrolled", year: int = 2026):
    return _with_identity(
        create_mock_attendee_with_date(pid, sid, day, year=year, status=status, effective_date=day), gender, identity
    )


def _cancel(pid: int, sid: int, day: str, gender: str, identity: str = "", *, year: int = 2026):
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
    return curve.weekly[-1].enrolled


class TestEnrollmentIdentityMode:
    @pytest.mark.asyncio
    async def test_default_stays_on_the_gender_field(self, service, mock_repository, sessions, enrolled_2026) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026

        result = await service.get_velocity(year=2026, split_by_gender=True)

        assert result.gender_basis == "field"
        assert sorted(c.gender for c in result.by_gender) == ["F", "M"]
        assert result.gender_fallback_count == 0

    @pytest.mark.asyncio
    async def test_identity_lines_are_the_five_groups_rebuilt_from_attendees(
        self, service, mock_repository, sessions, enrolled_2026
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
    async def test_identity_breakdown_per_session(self, service, mock_repository, sessions, enrolled_2026) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026

        result = await service.get_velocity(year=2026, split_by_gender=True, gender_basis="identity")

        rows = {b.session_cm_id: b.by_identity for b in result.session_gender_breakdown}
        assert rows[1001] == {"Girl/woman": 2, "No answer": 1}
        assert rows[1002] == {"Boy/man": 1, "Non-binary": 1, "Another identity": 1}

    @pytest.mark.asyncio
    async def test_prior_years_rebuilt_too_with_their_own_fallback_count(self, service, mock_repository) -> None:
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
    async def test_no_split_ignores_the_basis(self, service, mock_repository, sessions, enrolled_2026) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_dates.return_value = enrolled_2026

        result = await service.get_velocity(year=2026, gender_basis="identity")

        assert result.by_gender == []
        assert result.gender_fallback_count == 0


class TestCancellationIdentityMode:
    @pytest.mark.asyncio
    async def test_cancellation_identity_lines_and_breakdown(self, service, mock_repository, sessions) -> None:
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
    async def test_cancellation_field_mode_unchanged(self, service, mock_repository, sessions) -> None:
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_status_transitions.return_value = [_cancel(1, 1001, "2026-01-12", "F", "Agender")]

        result = await service.get_velocity(year=2026, metric="cancellation", split_by_gender=True)

        assert {c.gender for c in result.by_gender} == {"M", "F"}
        assert next(c for c in result.by_gender if c.gender == "F").weekly[-1].enrolled == 1
        assert result.session_gender_breakdown[0].by_identity == {}
