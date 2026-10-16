"""Drill-downs can group by household, epic #3207 PR 6b (decision 39; owner rulings #41-#43).

Every list row carries `household_cm_id`: the CampMinder id of the camper's primary childhood
household, read from this season's household record (the relation `persons.primary_childhood_household`
points at it by PocketBase id). The modal groups on it, and the CSV always has it as "Household ID"
(ruling #42), on every list, Retention included (ruling #43). A camper with no household, or whose
household record is missing, gets None, and the modal gives that camper a group of their own.

The same household fetch also gives Zip (PR 6, decision 13), so the list reads households once.
"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest

from api.services.drilldown_service import DrilldownService
from api.services.metrics_repository import DrilldownHousehold, MetricsRepository
from tests.unit.api.services.test_drilldown_lists_pr6 import ALL_SUMMER, MAIN, YEAR, Attendee, Person, _att, _repo


def _households_repo(
    persons: dict[int, Person], households: dict[str, DrilldownHousehold], **lists: list[Attendee]
) -> MagicMock:
    repo = _repo(lists or {"enrolled": [_att(pid, MAIN) for pid in persons]}, persons)
    repo.fetch_drilldown_households.return_value = households
    return repo


class TestHouseholdId:
    @pytest.mark.asyncio
    async def test_each_row_carries_its_primary_childhood_households_campminder_id(self) -> None:
        persons = {
            1: Person(1, last_name="Baker", primary_childhood_household="pb_a"),
            2: Person(2, last_name="Rossi", primary_childhood_household="pb_a"),
            3: Person(3, last_name="Garcia", primary_childhood_household="pb_b"),
        }
        households = {
            "pb_a": DrilldownHousehold(cm_id=5001, postal_code="94110"),
            "pb_b": DrilldownHousehold(cm_id=5002, postal_code=None),
        }
        repo = _households_repo(persons, households)

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert {a.person_id: a.household_cm_id for a in result} == {1: 5001, 2: 5001, 3: 5002}
        repo.fetch_drilldown_households.assert_awaited_once_with(YEAR)

    @pytest.mark.asyncio
    async def test_no_household_or_a_missing_record_reads_none(self) -> None:
        persons = {
            1: Person(1, primary_childhood_household=None),
            2: Person(2, primary_childhood_household="pb_gone"),
        }
        repo = _households_repo(persons, {})

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert {a.person_id: a.household_cm_id for a in result} == {1: None, 2: None}

    @pytest.mark.asyncio
    async def test_zip_comes_from_the_same_household_fetch(self) -> None:
        persons = {1: Person(1, primary_childhood_household="pb_a")}
        repo = _households_repo(persons, {"pb_a": DrilldownHousehold(cm_id=5001, postal_code="94110")})

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert result[0].zip == "94110"
        assert result[0].household_cm_id == 5001

    @pytest.mark.asyncio
    async def test_retention_rows_carry_it_too(self) -> None:
        """Ruling #43: Retention groups like every other list, keyed on the base season's records."""
        persons = {1: Person(1, primary_childhood_household="pb_a"), 2: Person(2, primary_childhood_household="pb_a")}
        repo = _households_repo(persons, {"pb_a": DrilldownHousehold(cm_id=5001, postal_code=None)})

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            YEAR, "retention_all", "all", session_types=ALL_SUMMER, compare_year=YEAR + 1
        )

        assert {a.person_id: a.household_cm_id for a in result} == {1: 5001, 2: 5001}
        repo.fetch_drilldown_households.assert_awaited_once_with(YEAR)


@dataclass
class HouseholdRecord:
    id: str
    cm_id: float | None = None
    billing_postal_code: str | None = None


class TestFetchDrilldownHouseholds:
    @pytest.mark.asyncio
    async def test_keys_by_pocketbase_id_with_cm_id_and_postal_code(self) -> None:
        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = [
            HouseholdRecord("pb_a", 5001.0, "94110"),
            HouseholdRecord("pb_b", 5002, ""),
            HouseholdRecord("pb_c", None, "94612"),
        ]

        result = await MetricsRepository(pb).fetch_drilldown_households(YEAR)

        assert result == {
            "pb_a": DrilldownHousehold(cm_id=5001, postal_code="94110"),
            "pb_b": DrilldownHousehold(cm_id=5002, postal_code=None),
            "pb_c": DrilldownHousehold(cm_id=None, postal_code="94612"),
        }
        assert isinstance(result["pb_a"].cm_id, int)

    @pytest.mark.asyncio
    async def test_names_its_three_columns_and_the_season(self) -> None:
        """No hidden Camperships-only household column rides along."""
        pb = MagicMock()
        pb.collection.return_value.get_full_list.return_value = []

        await MetricsRepository(pb).fetch_drilldown_households(YEAR)

        params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
        assert params == {"filter": f"year = {YEAR}", "fields": "id,cm_id,billing_postal_code"}
