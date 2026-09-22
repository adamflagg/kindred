"""PersonHousingService -- the adult camper journey's server read (spec §4)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.lodging import PersonHousingResponse, PersonHousingWeekend
from api.services.person_housing_service import PersonHousingService

PERSON = 3000001
WW = 1001


def _repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_person_cabin_values": [],
        "fetch_person_adult_attendees": [],
        "fetch_all_units": [],
        "fetch_unit_aliases": [],
    }
    defaults.update(overrides)
    for method, value in defaults.items():
        setattr(repo, method, AsyncMock(return_value=value))
    return repo


def _cabin_row(year: int, raw: str, last_updated: str, field_cm_id: int = 223823) -> SimpleNamespace:
    return SimpleNamespace(
        year=year, value=raw, last_updated=last_updated, expand={"field_definition": SimpleNamespace(cm_id=field_cm_id)}
    )


def _attendee_row(year: int, session_cm_id: int, end_date: str) -> SimpleNamespace:
    return SimpleNamespace(year=year, expand={"session": SimpleNamespace(cm_id=session_cm_id, end_date=end_date)})


class TestPersonHousingService:
    @pytest.mark.asyncio
    async def test_publishes_one_row_per_attributed_weekend(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2024, "River F", "2024-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(
            person_cm_id=PERSON,
            weekends=[
                PersonHousingWeekend(year=2024, session_cm_id=WW, cabin_name="River F", cabin_name_raw="River F")
            ],
        )

    @pytest.mark.asyncio
    async def test_a_field_outside_the_allowlist_never_reaches_the_response(self) -> None:
        """Defense in depth behind the repository's allowlist (spec §4.1)."""
        repo = _repo(
            fetch_person_cabin_values=[
                _cabin_row(
                    2024, "Summer Camp - Position: Counselor - Total Salary: 2000", "2024-10-01T00:00:00+00:00", 34148
                ),
                _cabin_row(2024, "Not a cabin", "2024-10-02T00:00:00+00:00", 209082),
                _cabin_row(2024, "River F", "2024-09-01T00:00:00+00:00"),
            ],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert [w.cabin_name for w in result.weekends] == ["River F"]
        assert "Salary" not in result.model_dump_json()

    @pytest.mark.asyncio
    async def test_an_unresolvable_person_reads_nothing(self) -> None:
        repo = _repo()

        result = await PersonHousingService(repo).build_person_housing(0)

        assert result == PersonHousingResponse(person_cm_id=0)
        repo.fetch_person_cabin_values.assert_not_awaited()
        repo.fetch_person_adult_attendees.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_the_registry_collapses_two_spellings_of_one_unit(self) -> None:
        """Rule step 2 reads the SAME resolver the household journey uses."""
        repo = _repo(
            fetch_person_cabin_values=[
                _cabin_row(2022, "Golden Triangle -Tenaya 1", "2022-09-14T12:00:00+00:00", 212997),
                _cabin_row(2022, "Tenaya 1", "2022-09-15T12:00:00+00:00"),
            ],
            fetch_person_adult_attendees=[_attendee_row(2022, WW, "2022-10-02 07:00:00.000Z")],
            fetch_all_units=[SimpleNamespace(id="u1", code="gt-tenaya-1", name="Tenaya 1", year=2026, parent_unit="")],
            fetch_unit_aliases=[
                SimpleNamespace(
                    alias_string="Golden Triangle -Tenaya 1", member_units=["u1"], valid_from_year=0, valid_to_year=0
                )
            ],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert [w.cabin_name for w in result.weekends] == ["Tenaya 1"]

    @pytest.mark.asyncio
    async def test_a_weekend_with_no_readable_end_date_is_skipped(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2024, "River F", "2024-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.weekends == []
