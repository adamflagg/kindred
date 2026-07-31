"""LodgingRepository: the filter strings are the contract.

These tests assert the exact PocketBase filter/expand/sort parameters,
because a wrong filter here is silently wrong data rather than an error.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.lodging_repository import (
    WEEKEND_SESSION_TYPES,
    LodgingRepository,
)


def _record(**kwargs: Any) -> MagicMock:
    record = MagicMock()
    for key, value in kwargs.items():
        setattr(record, key, value)
    return record


@pytest.fixture
def pb() -> MagicMock:
    client = MagicMock()
    client.collection.return_value.get_full_list.return_value = []
    return client


@pytest.fixture
def repo(pb: MagicMock) -> LodgingRepository:
    return LodgingRepository(pb)


def _last_query(pb: MagicMock) -> dict[str, Any]:
    call = pb.collection.return_value.get_full_list.call_args
    params: dict[str, Any] = call[1]["query_params"]
    return params


class TestFetchWeekendSessions:
    @pytest.mark.asyncio
    async def test_filters_to_family_and_adult_types(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_weekend_sessions(2026)

        pb.collection.assert_called_with("camp_sessions")
        filter_str = _last_query(pb)["filter"]
        assert "year = 2026" in filter_str
        for session_type in WEEKEND_SESSION_TYPES:
            assert f'session_type = "{session_type}"' in filter_str
        # summer types must not leak in
        assert '"main"' not in filter_str


class TestFetchAssignments:
    @pytest.mark.asyncio
    async def test_reads_only_the_live_plan_and_expands_unit_and_merge(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.fetch_assignments(2026, "sess_pb_1")

        pb.collection.assert_called_with("lodging_assignments")
        params = _last_query(pb)
        assert 'session = "sess_pb_1"' in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = ""' in params["filter"]
        assert params["expand"] == "unit,merge"


class TestFetchAvailability:
    @pytest.mark.asyncio
    async def test_reads_only_the_live_plan(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_availability(2026, "sess_pb_1")

        pb.collection.assert_called_with("lodging_availability")
        assert 'scenario = ""' in _last_query(pb)["filter"]


class TestFetchAttendees:
    @pytest.mark.asyncio
    async def test_uses_active_enrolled_status_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_attendees_for_session(2026, "sess_pb_1")

        pb.collection.assert_called_with("attendees")
        params = _last_query(pb)
        assert "status_id = 2" in params["filter"]
        assert params["expand"] == "person"


class TestFetchUnits:
    @pytest.mark.asyncio
    async def test_expands_area_and_does_not_prefilter_containers(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Containers stay in the payload (badged); only COUNTS exclude them."""
        await repo.fetch_units()

        pb.collection.assert_called_with("lodging_units")
        params = _last_query(pb)
        assert params["expand"] == "area"
        assert "is_container" not in params.get("filter", "")


class TestFetchPriorHouseholdCmIds:
    @pytest.mark.asyncio
    async def test_returns_cm_ids_from_earlier_years_only(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(cm_id=2000001),
            _record(cm_id=2000002),
        ]

        result = await repo.fetch_prior_household_cm_ids(2026)

        assert "year < 2026" in _last_query(pb)["filter"]
        assert result == {2000001, 2000002}


class TestFetchFamilyCampAdults:
    @pytest.mark.asyncio
    async def test_groups_by_household_pb_id_in_adult_number_order(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(household="hh_1", adult_number=2, name="Liam Garcia"),
            _record(household="hh_1", adult_number=1, name="Emma Johnson"),
            _record(household="hh_2", adult_number=1, name="Noah Smith"),
        ]

        result = await repo.fetch_family_camp_adults(2026)

        assert [a.name for a in result["hh_1"]] == ["Emma Johnson", "Liam Garcia"]
        assert [a.name for a in result["hh_2"]] == ["Noah Smith"]


class TestFetchFamilyCampRegistrations:
    @pytest.mark.asyncio
    async def test_keys_by_household_pb_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(household="hh_1", share_cabin_gate="yes_share"),
        ]

        result = await repo.fetch_family_camp_registrations(2026)

        pb.collection.assert_called_with("family_camp_registrations")
        assert "year = 2026" in _last_query(pb)["filter"]
        assert result["hh_1"].share_cabin_gate == "yes_share"


class TestCounts:
    @pytest.mark.asyncio
    async def test_open_unresolved_aliases_reads_the_ingest_work_queue(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """One work queue, owned by ingest, narrowed to the alias kind.

        `lodging_ingest_issues` carries seven kinds; only `unresolved_alias`
        is a cabin string awaiting a mapping. Counting the whole table would
        report ambiguous-session and write-failure rows as unmapped cabins.
        """
        pb.collection.return_value.get_full_list.return_value = [_record(), _record(), _record()]

        count = await repo.count_open_unresolved_aliases()

        pb.collection.assert_called_with("lodging_ingest_issues")
        filter_str = _last_query(pb)["filter"]
        assert 'kind = "unresolved_alias"' in filter_str
        assert "is_resolved = false" in filter_str
        assert count == 3

    @pytest.mark.asyncio
    async def test_unconfirmed_units_excludes_containers_and_inactive(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_full_list.return_value = [_record()]

        count = await repo.count_unconfirmed_units()

        pb.collection.assert_called_with("lodging_units")
        filter_str = _last_query(pb)["filter"]
        assert "is_confirmed = false" in filter_str
        assert "is_container = false" in filter_str
        assert "is_active = true" in filter_str
        assert count == 1
