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


class TestFetchSession:
    @pytest.mark.asyncio
    async def test_filters_to_family_and_adult_types(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """A summer cm_id must not resolve here.

        `build_roster` branches on session_type and falls through to the
        household grain for anything that is not "adult", so an unfiltered
        read hands a summer session a family-grain roster instead of the 404
        the router promises.
        """
        await repo.fetch_session(2026, 900001)

        pb.collection.assert_called_with("camp_sessions")
        filter_str = _last_query(pb)["filter"]
        assert "year = 2026" in filter_str
        assert "cm_id = 900001" in filter_str
        for session_type in WEEKEND_SESSION_TYPES:
            assert f'session_type = "{session_type}"' in filter_str


class TestStableSort:
    """Every paginated read pins a sort key.

    `get_full_list` walks pages with LIMIT/OFFSET. With no ORDER BY, SQLite
    may return a different row order per request, so a row past page 1 can be
    skipped or duplicated -- silently dropping a household from the roster.
    Same defect CodeRabbit caught on the Go side in #1877.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(lambda r: r.fetch_session(2026, 1), id="fetch_session"),
            pytest.param(lambda r: r.fetch_availability(2026, "s1"), id="fetch_availability"),
            pytest.param(lambda r: r.fetch_assignments(2026, "s1"), id="fetch_assignments"),
            pytest.param(lambda r: r.fetch_attendees_for_session(2026, "s1"), id="fetch_attendees"),
            pytest.param(lambda r: r.fetch_households(2026), id="fetch_households"),
            pytest.param(lambda r: r.fetch_prior_household_cm_ids(2026), id="fetch_prior_cm_ids"),
            pytest.param(lambda r: r.fetch_family_camp_registrations(2026), id="fetch_registrations"),
            pytest.param(lambda r: r.fetch_family_camp_medical(2026), id="fetch_medical"),
            pytest.param(lambda r: r.fetch_weekend_sessions(2026), id="fetch_weekend_sessions"),
            pytest.param(lambda r: r.fetch_units(), id="fetch_units"),
            pytest.param(lambda r: r.fetch_family_camp_adults(2026), id="fetch_adults"),
        ],
    )
    async def test_paginated_read_pins_a_sort_key(self, repo: LodgingRepository, pb: MagicMock, call: Any) -> None:
        await call(repo)

        assert _last_query(pb).get("sort"), "paginated read must pin a stable sort key"


class TestNarrowPhiReads:
    """The PHI path reads one household, never the whole year.

    Loading every family's medical row to answer one is a PHI-surface
    problem before it is a performance one.
    """

    @pytest.mark.asyncio
    async def test_fetch_household_by_cm_id_filters_to_the_one_household(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_full_list.return_value = [_record(id="hh_1", cm_id=2000001)]

        result = await repo.fetch_household_by_cm_id(2026, 2000001)

        pb.collection.assert_called_with("households")
        filter_str = _last_query(pb)["filter"]
        assert "year = 2026" in filter_str
        assert "cm_id = 2000001" in filter_str
        assert result is not None
        assert result.id == "hh_1"

    @pytest.mark.asyncio
    async def test_fetch_household_by_cm_id_returns_none_when_absent(self, repo: LodgingRepository) -> None:
        assert await repo.fetch_household_by_cm_id(2026, 2000001) is None

    @pytest.mark.asyncio
    async def test_fetch_medical_for_household_filters_to_the_one_household(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_full_list.return_value = [_record(cpap_info="uses a CPAP")]

        result = await repo.fetch_medical_for_household(2026, "hh_1")

        pb.collection.assert_called_with("family_camp_medical")
        filter_str = _last_query(pb)["filter"]
        assert "year = 2026" in filter_str
        assert 'household = "hh_1"' in filter_str
        assert result is not None
        assert result.cpap_info == "uses a CPAP"

    @pytest.mark.asyncio
    async def test_fetch_medical_for_household_returns_none_for_a_blank_id(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """A blank PB id means the household did not resolve.

        Never turn that into a query: an unanchored filter is how one
        household's narrative reaches another household's request.
        """
        assert await repo.fetch_medical_for_household(2026, "") is None
        pb.collection.return_value.get_full_list.assert_not_called()


class TestFetchAssignments:
    @pytest.mark.asyncio
    async def test_reads_the_synced_rows_and_expands_unit_and_merge(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """No scenario predicate, because there is no scenario column.

        This assertion used to require `scenario = ""` here. 1500000132 dropped
        that column from lodging_assignments -- it was never written, and
        keeping it invited the `scenario != ""` write rule the draft table
        exists to avoid -- so filtering on it now asks PocketBase for an
        unknown field. The synced rows ARE the base; a scenario overlays them.
        """
        await repo.fetch_assignments(2026, "sess_pb_1")

        pb.collection.assert_called_with("lodging_assignments")
        params = _last_query(pb)
        assert 'session = "sess_pb_1"' in params["filter"]
        assert "year = 2026" in params["filter"]
        assert "scenario" not in params["filter"]
        assert params["expand"] == "unit,merge"


class TestFetchDraftAssignments:
    @pytest.mark.asyncio
    async def test_scopes_to_one_scenario_and_expands_all_three_targets(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """Three targets expand, not two.

        `merge` is a slot the ingest built from a historical cabin string;
        `merge_draft` is one the board built inside this scenario. A PocketBase
        relation names a single collection, so a draft row that could point at
        either needs both fields -- and a read that expands only one of them
        renders a placed party as unplaced.
        """
        await repo.fetch_draft_assignments(2026, "sess_pb_1", "scn_1")

        pb.collection.assert_called_with("lodging_assignments_draft")
        params = _last_query(pb)
        assert 'session = "sess_pb_1"' in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = "scn_1"' in params["filter"]
        assert params["expand"] == "unit,merge,merge_draft"


class TestClientSuppliedValuesAreEscaped:
    """`scenario` and `unit_id` arrive from the client and reach a filter.

    `scenario` is a bare query parameter on /roster and /summary, which gate on
    authentication only, and a body field on every write. `unit_id` is a body
    field. A value carrying a double quote closes the string literal early, and
    because PocketBase binds `&&` tighter than `||`, an injected `||` clause
    widens the predicate past its own session/year/scenario scoping -- which on
    the write paths means the lookup returns a row from another scenario and
    the caller then updates or deletes it.

    api/utils/pb_filters.pb_escape exists for exactly this and is used by
    geo_service and routers/debug; these call sites must use it too.
    """

    INJECTION = 'scn_1" || id != "'
    ESCAPED = 'scn_1\\" || id != \\"'

    @pytest.mark.asyncio
    async def test_fetch_draft_assignments_escapes_the_scenario(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_draft_assignments(2026, "sess_pb_1", self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_fetch_scenario_availability_escapes_the_scenario(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.fetch_scenario_availability(2026, "sess_pb_1", self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_draft_assignment_escapes_the_scenario(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.find_draft_assignment(2026, "sess_pb_1", self.INJECTION, 1000001, 0)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_availability_override_escapes_both_client_values(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.find_availability_override(2026, "sess_pb_1", self.INJECTION, 'u1" || id != "')

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert 'unit = "u1\\" || id != \\""' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(lambda r, s: r.fetch_availability(2026, s), id="fetch_availability"),
            pytest.param(lambda r, s: r.fetch_assignments(2026, s), id="fetch_assignments"),
            pytest.param(lambda r, s: r.fetch_draft_assignments(2026, s, "scn_1"), id="fetch_draft_assignments"),
            pytest.param(lambda r, s: r.fetch_scenario_availability(2026, s, "scn_1"), id="fetch_scenario_avail"),
        ],
    )
    async def test_every_session_filter_escapes_the_session_id(
        self, repo: LodgingRepository, pb: MagicMock, call: Any
    ) -> None:
        """One convention across the whole file, not a per-call-site argument.

        `session_pb_id` is server-resolved today, so none of these is
        exploitable. The hazard is the split: escaping it in some session
        filters and not others leaves a reader to work out which is which, and
        the next caller to pass a client value inherits whichever form they
        copied.
        """
        await call(repo, 'sess" || id != "')

        filter_str = _last_query(pb)["filter"]
        assert 'session = "sess\\" || id != \\""' in filter_str
        assert '" || id != "' not in filter_str


class TestFetchAvailability:
    @pytest.mark.asyncio
    async def test_reads_only_the_live_plan(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """lodging_availability KEPT its scenario column, unlike the two tables
        that gained draft twins: nothing syncs into it, so there is no record
        of truth there to protect. Empty scenario is still the live plan."""
        await repo.fetch_availability(2026, "sess_pb_1")

        pb.collection.assert_called_with("lodging_availability")
        assert 'scenario = ""' in _last_query(pb)["filter"]

    @pytest.mark.asyncio
    async def test_scenario_overrides_read_that_scenario_only(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_scenario_availability(2026, "sess_pb_1", "scn_1")

        pb.collection.assert_called_with("lodging_availability")
        params = _last_query(pb)
        assert 'session = "sess_pb_1"' in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = "scn_1"' in params["filter"]


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


def _last_list_query(pb: MagicMock) -> dict[str, Any]:
    call = pb.collection.return_value.get_list.call_args
    params: dict[str, Any] = call[1]["query_params"]
    return params


class TestCounts:
    """Counts ask the server for a total; they never page the rows in.

    `get_full_list` fetches every matching row only to call len() on it. One
    page of one row carries the same total_items.
    """

    @pytest.mark.asyncio
    async def test_open_unresolved_aliases_reads_the_ingest_work_queue(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """One work queue, owned by ingest, narrowed to the alias kind.

        `lodging_ingest_issues` carries seven kinds; only `unresolved_alias`
        is a cabin string awaiting a mapping. Counting the whole table would
        report ambiguous-session and write-failure rows as unmapped cabins.
        """
        pb.collection.return_value.get_list.return_value = _record(total_items=3)

        count = await repo.count_open_unresolved_aliases()

        pb.collection.assert_called_with("lodging_ingest_issues")
        filter_str = _last_list_query(pb)["filter"]
        assert 'kind = "unresolved_alias"' in filter_str
        assert "is_resolved = false" in filter_str
        assert count == 3
        pb.collection.return_value.get_full_list.assert_not_called()

    @pytest.mark.asyncio
    async def test_unconfirmed_units_excludes_containers_and_inactive(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_list.return_value = _record(total_items=1)

        count = await repo.count_unconfirmed_units()

        pb.collection.assert_called_with("lodging_units")
        filter_str = _last_list_query(pb)["filter"]
        assert "is_confirmed = false" in filter_str
        assert "is_container = false" in filter_str
        assert "is_active = true" in filter_str
        assert count == 1
        pb.collection.return_value.get_full_list.assert_not_called()

    @pytest.mark.asyncio
    async def test_counts_request_a_single_row(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_list.return_value = _record(total_items=42)

        await repo.count_unconfirmed_units()

        args = pb.collection.return_value.get_list.call_args[0]
        assert args[0] == 1, "page 1"
        assert args[1] == 1, "one row is enough to carry total_items"
