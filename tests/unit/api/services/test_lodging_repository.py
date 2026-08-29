"""LodgingRepository: the filter strings are the contract.

These tests assert the exact PocketBase filter/expand/sort parameters,
because a wrong filter here is silently wrong data rather than an error.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from api.dependencies import lodging_cache
from api.services.lodging_repository import (
    PAGE_SIZE,
    WEEKEND_SESSION_TYPES,
    LodgingRepository,
)


def _record(**kwargs: Any) -> MagicMock:
    record = MagicMock()
    for key, value in kwargs.items():
        setattr(record, key, value)
    return record


@pytest.fixture(autouse=True)
def _reset_lodging_cache() -> Any:
    """`lodging_cache` is a process-wide singleton (kindred#1963), so a value
    one test's mock sets up would otherwise leak into the next test's
    assertions -- most of this file reuses year 2026 across dozens of tests
    with different mocked rows. Every test in this module runs against an
    empty cache and leaves one behind it.
    """
    lodging_cache.invalidate_all()
    yield
    lodging_cache.invalidate_all()


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
            pytest.param(lambda r: r.fetch_availability(2026, 1000001), id="fetch_availability"),
            pytest.param(lambda r: r.fetch_assignments(2026, 1000001), id="fetch_assignments"),
            pytest.param(lambda r: r.fetch_slot_merges(2026, 1000001, "scn_1"), id="fetch_slot_merges"),
            pytest.param(lambda r: r.fetch_write_ins(2026, 1000001), id="fetch_write_ins"),
            pytest.param(lambda r: r.fetch_draft_write_ins(2026, 1000001, "scn_1"), id="fetch_draft_write_ins"),
            pytest.param(lambda r: r.fetch_attendees_for_session(2026, "s1"), id="fetch_attendees"),
            pytest.param(lambda r: r.fetch_households(2026), id="fetch_households"),
            pytest.param(lambda r: r.fetch_prior_household_cm_ids(2026), id="fetch_prior_cm_ids"),
            pytest.param(lambda r: r.fetch_family_camp_registrations(2026), id="fetch_registrations"),
            pytest.param(lambda r: r.fetch_family_camp_medical(2026), id="fetch_medical"),
            pytest.param(lambda r: r.fetch_weekend_sessions(2026), id="fetch_weekend_sessions"),
            pytest.param(lambda r: r.fetch_units(2026), id="fetch_units"),
            pytest.param(lambda r: r.fetch_family_camp_adults(2026), id="fetch_adults"),
        ],
    )
    async def test_paginated_read_pins_a_sort_key(self, repo: LodgingRepository, pb: MagicMock, call: Any) -> None:
        await call(repo)

        assert _last_query(pb).get("sort"), "paginated read must pin a stable sort key"


class TestNarrowMedicalReads:
    """The medical-narrative path reads one household, never the whole year.

    Loading every family's medical row to answer one is a disclosure problem
    before it is a performance one.
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


class TestFamilyCampMedicalIsScopedToFamilyOrAdultAttendance:
    """kindred#2306. `processMedical` reads `Family Medical-*` /
    `Family Camp-Physician*` custom values, which summer households answer
    too -- 310 of 886 2026 `family_camp_medical` rows belong to a household
    that never touched a family or adult session at all. Owner ruling
    2026-08-13 (campaign decision D3): filter at READ, leave `processMedical`
    and the write path untouched -- reversible, where narrowing the write
    plus an unguarded sweep would not be.

    "Touched" is ANY attendee row on a family/adult session that year,
    regardless of status -- deliberately NOT narrowed to
    `ACTIVE_ENROLLED_FILTER`. The 71-of-886 households that registered but
    had nobody actively enrolled are kindred#2305's separate problem;
    narrowing to status_id = 2 here would silently do that fix too and
    conflate the two issues the campaign is keeping apart.
    """

    @pytest.mark.asyncio
    async def test_bulk_read_drops_a_household_that_never_touched_a_weekend_session(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        _route_by_collection(
            pb,
            {
                "family_camp_medical": [_record(household="hh_untouched", cpap_info="Uses a CPAP nightly")],
                "attendees": [],
            },
        )

        result = await repo.fetch_family_camp_medical(2026)

        assert result == {}

    @pytest.mark.asyncio
    async def test_bulk_read_keeps_a_household_that_touched_a_weekend_session(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        touched_attendee = _record()
        touched_attendee.expand = {"person": _record(household="hh_touched")}
        _route_by_collection(
            pb,
            {
                "family_camp_medical": [_record(household="hh_touched", cpap_info="Uses a CPAP nightly")],
                "attendees": [touched_attendee],
            },
        )

        result = await repo.fetch_family_camp_medical(2026)

        assert "hh_touched" in result
        assert result["hh_touched"].cpap_info == "Uses a CPAP nightly"

    @pytest.mark.asyncio
    async def test_bulk_read_keeps_a_household_registered_but_never_actively_enrolled(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The kindred#2305 population -- registered, nobody enrolled -- must
        stay in scope here. Only zero-connection households (kindred#2306)
        are excluded.
        """
        not_enrolled_attendee = _record(status_id=7)
        not_enrolled_attendee.expand = {"person": _record(household="hh_registered_only")}
        _route_by_collection(
            pb,
            {
                "family_camp_medical": [_record(household="hh_registered_only", cpap_info="Uses a CPAP nightly")],
                "attendees": [not_enrolled_attendee],
            },
        )

        result = await repo.fetch_family_camp_medical(2026)

        assert "hh_registered_only" in result

    @pytest.mark.asyncio
    async def test_bulk_touched_check_is_scoped_to_family_and_adult_sessions_and_the_year(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        queries = _route_by_collection(pb, {"family_camp_medical": [], "attendees": []})

        await repo.fetch_family_camp_medical(2026)

        filter_str = queries["attendees"][0]["filter"]
        assert "year = 2026" in filter_str
        assert 'session.session_type = "family"' in filter_str
        assert 'session.session_type = "adult"' in filter_str
        assert "status_id" not in filter_str

    @pytest.mark.asyncio
    async def test_single_household_read_returns_none_for_an_untouched_household(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        _route_by_collection(
            pb,
            {
                "family_camp_medical": [_record(household="hh_1", cpap_info="Uses a CPAP nightly")],
                "attendees": [],
            },
        )

        result = await repo.fetch_medical_for_household(2026, "hh_1")

        assert result is None

    @pytest.mark.asyncio
    async def test_single_household_read_returns_the_row_for_a_touched_household(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        _route_by_collection(
            pb,
            {
                "family_camp_medical": [_record(household="hh_1", cpap_info="Uses a CPAP nightly")],
                "attendees": [_record()],
            },
        )

        result = await repo.fetch_medical_for_household(2026, "hh_1")

        assert result is not None
        assert result.cpap_info == "Uses a CPAP nightly"

    @pytest.mark.asyncio
    async def test_single_household_touched_check_never_reads_family_camp_medical_when_untouched(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """Minimisation: an untouched household's medical row is never read
        off PocketBase at all, not merely filtered out afterward.
        """
        queries = _route_by_collection(pb, {"family_camp_medical": [], "attendees": []})

        await repo.fetch_medical_for_household(2026, "hh_1")

        assert "family_camp_medical" not in queries

    @pytest.mark.asyncio
    async def test_single_household_touched_check_filters_on_the_person_household_relation(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        queries = _route_by_collection(pb, {"family_camp_medical": [], "attendees": []})

        await repo.fetch_medical_for_household(2026, "hh_1")

        filter_str = queries["attendees"][0]["filter"]
        assert "year = 2026" in filter_str
        assert 'person.household = "hh_1"' in filter_str
        assert 'session.session_type = "family"' in filter_str
        assert 'session.session_type = "adult"' in filter_str
        assert "status_id" not in filter_str


class TestLodgingReadsKeyOnTheCampMinderSessionId:
    """Every lodging read names the weekend by `session_cm_id` (kindred#2042).

    CLAUDE.md section 1: cross-table relationships use CampMinder ids, never
    PocketBase ids. The four lodging tables have carried both since 1500000124
    -- a `session` relation AND a required `session_cm_id` -- and every filter
    in this file keyed on the relation, which is the one of the two that does
    not survive a camp_sessions record being RECREATED rather than updated.
    The rows survive that (`cascadeDelete: false`, #1879); they just stop being
    reachable through a relation-keyed filter while the durable key beside them
    still points at the right weekend.

    Migration 1500000147 re-keys the six unique indexes to match, so a filter
    that kept naming the relation would no longer be answered by an index
    either.

    `fetch_attendees_for_session` is deliberately NOT in this list: `attendees`
    is not a lodging table and carries no `session_cm_id`.
    """

    SESSION_CM_ID = 1000001

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("call", "collection"),
        [
            pytest.param(
                lambda r, s: r.fetch_availability(2026, s),
                "lodging_availability",
                id="fetch_availability",
            ),
            pytest.param(
                lambda r, s: r.fetch_assignments(2026, s),
                "lodging_assignments",
                id="fetch_assignments",
            ),
            pytest.param(
                lambda r, s: r.fetch_draft_assignments(2026, s, "scn_1"),
                "lodging_assignments_draft",
                id="fetch_draft_assignments",
            ),
            pytest.param(
                lambda r, s: r.fetch_slot_merges(2026, s, "scn_1"),
                "lodging_slot_merges",
                id="fetch_slot_merges",
            ),
            pytest.param(
                lambda r, s: r.find_draft_assignment(2026, s, "scn_1", 2000001, 0),
                "lodging_assignments_draft",
                id="find_draft_assignment",
            ),
            pytest.param(
                lambda r, s: r.find_availability_override(2026, s, "u1"),
                "lodging_availability",
                id="find_availability_override",
            ),
            pytest.param(
                lambda r, s: r.find_slot_merge(2026, s, "u1", "scn_1"),
                "lodging_slot_merges",
                id="find_slot_merge",
            ),
            pytest.param(
                lambda r, s: r.fetch_write_ins(2026, s),
                "lodging_write_ins",
                id="fetch_write_ins",
            ),
            pytest.param(
                lambda r, s: r.fetch_draft_write_ins(2026, s, "scn_1"),
                "lodging_write_ins_draft",
                id="fetch_draft_write_ins",
            ),
            pytest.param(
                lambda r, s: r.find_write_in(2026, s, "u1", "Olivia Chen"),
                "lodging_write_ins",
                id="find_write_in",
            ),
            pytest.param(
                lambda r, s: r.find_draft_write_in(2026, s, "scn_1", "u1", "Olivia Chen"),
                "lodging_write_ins_draft",
                id="find_draft_write_in",
            ),
            pytest.param(
                lambda r, s: r.fetch_write_ins_on_unit(2026, s, "u1"),
                "lodging_write_ins",
                id="fetch_write_ins_on_unit",
            ),
            pytest.param(
                lambda r, s: r.fetch_draft_write_ins_on_unit(2026, s, "scn_1", "u1"),
                "lodging_write_ins_draft",
                id="fetch_draft_write_ins_on_unit",
            ),
        ],
    )
    async def test_the_session_term_is_the_campminder_id(
        self, repo: LodgingRepository, pb: MagicMock, call: Any, collection: str
    ) -> None:
        await call(repo, self.SESSION_CM_ID)

        pb.collection.assert_called_with(collection)
        filter_str = _last_query(pb)["filter"]
        assert f"session_cm_id = {self.SESSION_CM_ID}" in filter_str
        # The relation must not also be filtered on: keying on both would
        # reinstate exactly the unreachability this change removes.
        assert 'session = "' not in filter_str

    @pytest.mark.asyncio
    async def test_count_draft_assignments_keys_on_the_campminder_id(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The counting read goes through `get_list`, not `get_full_list`."""
        await repo.count_draft_assignments(2026, self.SESSION_CM_ID, "scn_1")

        pb.collection.assert_called_with("lodging_assignments_draft")
        filter_str = pb.collection.return_value.get_list.call_args[1]["query_params"]["filter"]
        assert f"session_cm_id = {self.SESSION_CM_ID}" in filter_str
        assert 'session = "' not in filter_str

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(lambda r, s: r.fetch_availability(2026, s), id="fetch_availability"),
            pytest.param(lambda r, s: r.fetch_assignments(2026, s), id="fetch_assignments"),
            pytest.param(lambda r, s: r.fetch_draft_assignments(2026, s, "scn_1"), id="fetch_draft_assignments"),
            pytest.param(lambda r, s: r.fetch_slot_merges(2026, s, "scn_1"), id="fetch_slot_merges"),
            pytest.param(lambda r, s: r.find_draft_assignment(2026, s, "scn_1", 2000001, 0), id="find_draft"),
            pytest.param(lambda r, s: r.find_availability_override(2026, s, "u1"), id="find_availability"),
            pytest.param(lambda r, s: r.find_slot_merge(2026, s, "u1", "scn_1"), id="find_slot_merge"),
            pytest.param(lambda r, s: r.fetch_write_ins(2026, s), id="fetch_write_ins"),
            pytest.param(lambda r, s: r.fetch_draft_write_ins(2026, s, "scn_1"), id="fetch_draft_write_ins"),
            pytest.param(lambda r, s: r.find_write_in(2026, s, "u1", "Olivia Chen"), id="find_write_in"),
            pytest.param(
                lambda r, s: r.find_draft_write_in(2026, s, "scn_1", "u1", "Olivia Chen"), id="find_draft_write_in"
            ),
            pytest.param(lambda r, s: r.fetch_write_ins_on_unit(2026, s, "u1"), id="fetch_write_ins_on_unit"),
            pytest.param(
                lambda r, s: r.fetch_draft_write_ins_on_unit(2026, s, "scn_1", "u1"),
                id="fetch_draft_write_ins_on_unit",
            ),
        ],
    )
    async def test_the_session_term_is_never_compared_to_a_string(
        self, repo: LodgingRepository, pb: MagicMock, call: Any
    ) -> None:
        """`session_cm_id` is a number column; it is never quoted, and never
        tested with `!= ''`.

        PocketBase declares number fields as NUMERIC DEFAULT 0 NOT NULL and
        SQLite evaluates `0 != ''` as TRUE, so a string comparison against this
        column matches rows it should exclude -- the same trap
        `find_draft_assignment`'s docstring documents for the two party grains.
        An unquoted integer also leaves no string literal for an injected `||`
        to close, which is why these filters need no `pb_escape` on the session
        term.
        """
        await call(repo, self.SESSION_CM_ID)

        filter_str = _last_query(pb)["filter"]
        assert 'session_cm_id = "' not in filter_str
        assert "session_cm_id != ''" not in filter_str
        assert 'session_cm_id != ""' not in filter_str


class TestFetchAssignments:
    @pytest.mark.asyncio
    async def test_reads_the_synced_rows_and_expands_units(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """No scenario predicate, because there is no scenario column.

        This assertion used to require `scenario = ""` here. 1500000132 dropped
        that column from lodging_assignments -- it was never written, and
        keeping it invited the `scenario != ""` write rule the draft table
        exists to avoid -- so filtering on it now asks PocketBase for an
        unknown field. These rows are the live plan, and since kindred#1974 a
        request naming a scenario does not read them at all -- it reads
        fetch_draft_assignments instead.
        """
        await repo.fetch_assignments(2026, 1000001)

        pb.collection.assert_called_with("lodging_assignments")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert "scenario" not in params["filter"]
        assert params["expand"] == "units"


class TestFetchDraftAssignments:
    @pytest.mark.asyncio
    async def test_scopes_to_one_scenario_and_expands_units(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """One target expands, not three.

        1500000134 collapsed `unit` (an atomic room), `merge` (a slot the
        ingest built from a historical cabin string) and `merge_draft` (one
        the board built inside this scenario) into the single `units`
        relation -- a read that does not expand it renders a placed party as
        unplaced, whether that placement is one room or several.
        """
        await repo.fetch_draft_assignments(2026, 1000001, "scn_1")

        pb.collection.assert_called_with("lodging_assignments_draft")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = "scn_1"' in params["filter"]
        assert params["expand"] == "units"


class TestFetchSlotMerges:
    @pytest.mark.asyncio
    async def test_a_named_scenario_gets_its_own_rows_and_the_weekend_level_ones(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """Two tiers, one round trip (1500000140).

        `scenario` on lodging_slot_merges used to be a REQUIRED relation, so
        a caller naming a scenario got only that scenario's rows and the
        CampMinder mirror (scenario="") got skipped by LodgingRosterService
        entirely rather than queried -- see 1500000139's history. `scenario`
        is optional now, and both tiers can name the same unit, so a named
        scenario's fetch must pull BOTH: its own rows, union'd with the
        weekend-level (`scenario = ""`) rows every scenario inherits.
        resolve_combined is what picks the winner; this call must not
        pre-filter one tier away before that happens.
        """
        await repo.fetch_slot_merges(2026, 1000001, "scn_1")

        pb.collection.assert_called_with("lodging_slot_merges")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = "scn_1"' in params["filter"]
        assert 'scenario = ""' in params["filter"]

    @pytest.mark.asyncio
    async def test_a_blank_scenario_gets_only_the_weekend_level_rows(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The CampMinder mirror's call -- the whole point of 1500000140.

        A blank scenario is what LodgingRosterService now passes for the
        mirror (it used to skip this fetch outright). It must not widen to
        "every scenario's own rows"; it gets exactly the weekend-level tier,
        because `scenario = ""` is already that filter with no OR needed.
        """
        await repo.fetch_slot_merges(2026, 1000001, "")

        pb.collection.assert_called_with("lodging_slot_merges")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = ""' in params["filter"]
        # No OR clause: a blank scenario_id must not turn into "any scenario".
        assert "||" not in params["filter"]


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
        await repo.fetch_draft_assignments(2026, 1000001, self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_draft_assignment_escapes_the_scenario(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.find_draft_assignment(2026, 1000001, self.INJECTION, 2000001, 0)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_fetch_slot_merges_escapes_the_scenario(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_slot_merges(2026, 1000001, self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_fetch_draft_write_ins_escapes_the_scenario(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_draft_write_ins(2026, 1000001, self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_write_in_escapes_the_unit_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.find_write_in(2026, 1000001, 'u1" || id != "', "Olivia Chen")

        filter_str = _last_query(pb)["filter"]
        assert 'unit = "u1\\" || id != \\""' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_write_in_escapes_the_occupant_name(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """The occupant name is the SECOND client string on this filter now.

        Design B (kindred#2583, ruled 2026-08-29) addresses a write-in by
        `(unit, occupant_name)`, so a name typed by a staff member reaches
        the predicate. Unescaped, an injected `||` would return some other
        unit's row -- which `set_availability` then updates, or the
        row-addressed delete removes.
        """
        await repo.find_write_in(2026, 1000001, "u1", self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'occupant_name = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_draft_write_in_escapes_every_client_value(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """THREE client-supplied strings reach this one filter now.

        `unit_pb_id` arrives in the request body, `scenario_id` off the
        `?scenario=` query parameter, and `occupant_name` is the Design B
        addressing key typed by a staff member. Any one unescaped widens the
        predicate past its own scoping -- which on this lookup means the
        caller updates or deletes another scenario's write-in.
        """
        await repo.find_draft_write_in(2026, 1000001, self.INJECTION, 'u1" || id != "', self.INJECTION)

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert 'unit = "u1\\" || id != \\""' in filter_str
        assert f'occupant_name = "{self.ESCAPED}"' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_fetch_write_ins_on_unit_escapes_the_unit_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_write_ins_on_unit(2026, 1000001, 'u1" || id != "')

        filter_str = _last_query(pb)["filter"]
        assert 'unit = "u1\\" || id != \\""' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_fetch_draft_write_ins_on_unit_escapes_both_client_values(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.fetch_draft_write_ins_on_unit(2026, 1000001, self.INJECTION, 'u1" || id != "')

        filter_str = _last_query(pb)["filter"]
        assert f'scenario = "{self.ESCAPED}"' in filter_str
        assert 'unit = "u1\\" || id != \\""' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_find_availability_override_escapes_the_unit_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """One client value left, not two: 1500000135 took the scenario.

        `unit_pb_id` still arrives in the request body, and unescaped an
        injected `||` would make this return some OTHER weekend's row -- which
        `set_availability` then updates or deletes.
        """
        await repo.find_availability_override(2026, 1000001, 'u1" || id != "')

        filter_str = _last_query(pb)["filter"]
        assert 'unit = "u1\\" || id != \\""' in filter_str
        assert "scenario" not in filter_str
        assert '" || id != "' not in filter_str

    # The session term used to be pinned here too, as a string that had to be
    # escaped like every other. kindred#2042 made it `session_cm_id`, a NUMBER,
    # so there is no literal left for an injected `||` to close and nothing for
    # `pb_escape` to do -- what replaces this is
    # `TestLodgingReadsKeyOnTheCampMinderSessionId.test_the_session_term_is_never_compared_to_a_string`,
    # which pins the stronger property that the term is never quoted at all.


class TestFetchAvailability:
    @pytest.mark.asyncio
    async def test_reads_the_whole_weekend_with_no_scenario_predicate(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """ONE layer, and the filter is where that is enforced.

        1500000135 dropped this table's `scenario` column: availability is a
        fact about the weekend, not about the plan. The old filter carried
        `scenario = ""` to select the live plan out of a scenario-partitioned
        table; against the collapsed table that predicate would name a column
        that no longer exists, which PocketBase rejects at query time rather
        than ignoring.
        """
        await repo.fetch_availability(2026, 1000001)

        pb.collection.assert_called_with("lodging_availability")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert "scenario" not in params["filter"]

    def test_there_is_no_scenario_availability_read(self, repo: LodgingRepository) -> None:
        """The overlay's other half, asserted as absent.

        A guard against the shape coming back by a different name: with the
        scenario dimension deleted there is nothing for a second read to
        return that the first one does not.
        """
        assert not hasattr(repo, "fetch_scenario_availability")


class TestWriteInReads:
    """`lodging_write_ins` / `lodging_write_ins_draft` — kindred#2382, PR 1 of 4.

    The owner's 2026-08-15 clarification split `family_available` in two:
    the staff<->family ROLE override stays on `lodging_availability`,
    session-scoped and global, and write-in OCCUPANCY moves to its own
    live+draft pair sitting beside `lodging_assignments`/`_draft`. These
    reads are that pair's half of the repository.

    BOTH HALVES ARE LIVE, AND NOTHING HERE IS DARK ANY MORE. PR 2 moved the
    21 rows (1500000162) and switched `write_in_covers` and `set_availability`
    onto the live table; PR 3 gave the draft its readers, so `build_roster` and
    `build_summary` read it INSTEAD OF the live one whenever the request names
    a scenario, and both seed paths write it; PR 4 gave `set_availability` an
    optional `scenario`, which is what reaches `find_`, `update_` and
    `delete_draft_write_in`.
    """

    @pytest.mark.asyncio
    async def test_fetch_write_ins_reads_the_live_table_with_no_scenario_predicate(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The live board is a scope in its own right (owner, 2026-08-15).

        It is not "the absence of a scenario" and it is not `scenario = ""` on
        a partitioned table -- that sentinel shape is the one 1500000135's
        own reasoning, quoted in this module's header, rejected. The live
        rows live in their own table and carry no scenario column at all, so
        naming one here would name a column that does not exist, which
        PocketBase rejects at query time rather than ignoring.
        """
        await repo.fetch_write_ins(2026, 1000001)

        pb.collection.assert_called_with("lodging_write_ins")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert "scenario" not in params["filter"]

    @pytest.mark.asyncio
    async def test_fetch_draft_write_ins_returns_only_the_named_scenarios_rows(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """REPLACE, not overlay -- the same rule kindred#1974 set for placements.

        `lodging_slot_merges` is the tempting counter-model: it unions the
        weekend-level tier in (`scenario = ""`) because a draw level is a
        fact about the weekend. A write-in is not -- it is an occupancy, the
        same kind of fact as a placement -- so a scenario's write-ins are its
        whole set, and a scenario is seeded by an explicit copy (PR 3) rather
        than by rendering the live board through the gaps.
        """
        await repo.fetch_draft_write_ins(2026, 1000001, "scn_1")

        pb.collection.assert_called_with("lodging_write_ins_draft")
        params = _last_query(pb)
        assert "session_cm_id = 1000001" in params["filter"]
        assert "year = 2026" in params["filter"]
        assert 'scenario = "scn_1"' in params["filter"]
        # No fall-through to the live board's rows.
        assert 'scenario = ""' not in params["filter"]
        assert "||" not in params["filter"]

    @pytest.mark.asyncio
    async def test_find_write_in_keys_the_narrowed_live_unique_index(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """Matches the NARROWED `idx_lodging_write_in_unique`
        (session_cm_id, year, unit, occupant_name).

        Design B (kindred#2583, ruled 2026-08-29): a write-in is addressed by
        `(unit, occupant_name)`. `unit` alone is no longer the key -- on a
        shareable cabin it names as many rows as staff have written -- so a
        lookup keyed on it would hand `_upsert_row` an arbitrary neighbour to
        overwrite. The occupant term is what makes "which of these rows did
        this write mean?" a question with an answer.
        """
        await repo.find_write_in(2026, 1000001, "u1", "Olivia Chen")

        pb.collection.assert_called_with("lodging_write_ins")
        filter_str = _last_query(pb)["filter"]
        assert "session_cm_id = 1000001" in filter_str
        assert "year = 2026" in filter_str
        assert 'unit = "u1"' in filter_str
        assert 'occupant_name = "Olivia Chen"' in filter_str
        assert "scenario" not in filter_str

    @pytest.mark.asyncio
    async def test_find_draft_write_in_keys_the_narrowed_draft_unique_index(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The draft key is the live key plus `scenario`, both narrowed.

        `lodging_assignments_draft`'s partial indexes do the same
        (1500000132/1500000147): the draft key is the live key plus the
        scenario, so two scenarios may hold contradicting rows for one unit
        and neither collides with the other. `scenario` is RETAINED under the
        narrowing -- dropping it would let two scenarios' rows collide.
        """
        await repo.find_draft_write_in(2026, 1000001, "scn_1", "u1", "Olivia Chen")

        pb.collection.assert_called_with("lodging_write_ins_draft")
        filter_str = _last_query(pb)["filter"]
        assert "session_cm_id = 1000001" in filter_str
        assert "year = 2026" in filter_str
        assert 'unit = "u1"' in filter_str
        assert 'scenario = "scn_1"' in filter_str
        assert 'occupant_name = "Olivia Chen"' in filter_str

    @pytest.mark.asyncio
    async def test_a_finder_keyed_on_one_occupant_does_not_see_another(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The whole point of the narrowing, stated as a filter fact.

        Two occupants on one shareable cabin differ in exactly one term, so
        the predicate that finds one must NAME that term. Without the
        occupant clause both lookups return the same first row and the second
        family's write overwrites the first -- the live data-loss path
        kindred#2583 exists to close.
        """
        await repo.find_write_in(2026, 1000001, "u1", "Emma Johnson")
        first = _last_query(pb)["filter"]
        await repo.find_write_in(2026, 1000001, "u1", "Liam Garcia")
        second = _last_query(pb)["filter"]

        assert first != second

    @pytest.mark.asyncio
    async def test_find_write_in_returns_none_when_there_is_no_row(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_full_list.return_value = []

        assert await repo.find_write_in(2026, 1000001, "u1", "Olivia Chen") is None
        assert await repo.find_draft_write_in(2026, 1000001, "scn_1", "u1", "Olivia Chen") is None

    @pytest.mark.asyncio
    async def test_find_write_in_returns_the_single_row(self, repo: LodgingRepository, pb: MagicMock) -> None:
        row = _record(id="wi_1")
        pb.collection.return_value.get_full_list.return_value = [row]

        assert await repo.find_write_in(2026, 1000001, "u1", "Olivia Chen") is row
        assert await repo.find_draft_write_in(2026, 1000001, "scn_1", "u1", "Olivia Chen") is row


class TestEveryOccupancyRowOnOneUnit:
    """The unit-grain read the CLEAR verbs need (kindred#2583 step 7).

    `family_available: null` clears the unit ENTIRELY and a release
    (`family_available: true`) drops whatever occupies the unit it opens.
    Both are unit-grain facts, so neither can go through the occupant-keyed
    finder above: on a shareable cabin that finder answers about one row and
    would leave the other standing -- a cleared cabin still occupied, or a
    released one advertised as open with somebody in it.
    """

    @pytest.mark.asyncio
    async def test_the_live_read_is_keyed_on_the_unit_and_names_no_occupant(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.fetch_write_ins_on_unit(2026, 1000001, "u1")

        pb.collection.assert_called_with("lodging_write_ins")
        filter_str = _last_query(pb)["filter"]
        assert "session_cm_id = 1000001" in filter_str
        assert "year = 2026" in filter_str
        assert 'unit = "u1"' in filter_str
        assert "occupant_name" not in filter_str
        assert "scenario" not in filter_str

    @pytest.mark.asyncio
    async def test_the_draft_read_is_scoped_to_one_scenario(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_draft_write_ins_on_unit(2026, 1000001, "scn_1", "u1")

        pb.collection.assert_called_with("lodging_write_ins_draft")
        filter_str = _last_query(pb)["filter"]
        assert 'unit = "u1"' in filter_str
        assert 'scenario = "scn_1"' in filter_str
        assert "occupant_name" not in filter_str
        # No fall-through: a clear inside one scenario must not reach another's.
        assert "||" not in filter_str

    @pytest.mark.asyncio
    async def test_every_row_comes_back_not_only_the_first(self, repo: LodgingRepository, pb: MagicMock) -> None:
        rows = [_record(id="wi_1"), _record(id="wi_2")]
        pb.collection.return_value.get_full_list.return_value = rows

        assert await repo.fetch_write_ins_on_unit(2026, 1000001, "u1") == rows
        assert await repo.fetch_draft_write_ins_on_unit(2026, 1000001, "scn_1", "u1") == rows

    @pytest.mark.asyncio
    async def test_an_empty_unit_reads_as_an_empty_list(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = []

        assert await repo.fetch_write_ins_on_unit(2026, 1000001, "u1") == []
        assert await repo.fetch_draft_write_ins_on_unit(2026, 1000001, "scn_1", "u1") == []


class TestWriteInWrites:
    """The write half, live and draft, targets the right table each time.

    A create that reached the wrong grain would record a scenario's modelling
    choice on the live board -- the exact conflation kindred#2382 exists to
    undo -- so the collection name is asserted on every one of the six.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("call", "collection"),
        [
            pytest.param(lambda r: r.create_write_in({"unit": "u1"}), "lodging_write_ins", id="create_live"),
            pytest.param(lambda r: r.update_write_in("wi_1", {"note": "x"}), "lodging_write_ins", id="update_live"),
            pytest.param(lambda r: r.delete_write_in("wi_1"), "lodging_write_ins", id="delete_live"),
            pytest.param(
                lambda r: r.create_draft_write_in({"unit": "u1"}), "lodging_write_ins_draft", id="create_draft"
            ),
            pytest.param(
                lambda r: r.update_draft_write_in("wi_1", {"note": "x"}),
                "lodging_write_ins_draft",
                id="update_draft",
            ),
            pytest.param(lambda r: r.delete_draft_write_in("wi_1"), "lodging_write_ins_draft", id="delete_draft"),
        ],
    )
    async def test_the_write_targets_its_own_grain(
        self, repo: LodgingRepository, pb: MagicMock, call: Any, collection: str
    ) -> None:
        await call(repo)

        pb.collection.assert_called_with(collection)


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
        await repo.fetch_units(2026)

        pb.collection.assert_called_with("lodging_units")
        params = _last_query(pb)
        assert params["expand"] == "area"
        assert "is_container" not in params.get("filter", "")

    @pytest.mark.asyncio
    async def test_filters_to_the_requested_year_only(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Units became year-scoped in 1500000141.

        `code` is unique only per (code, year), so an unfiltered read would
        return every season at once and collide two rows onto one card in
        `leafByCode`. The year argument is what keeps a payload to one season.
        """
        await repo.fetch_units(2027)

        filter_str = _last_query(pb)["filter"]
        assert "year = 2027" in filter_str


class TestFetchPriorHouseholdCmIds:
    """kindred#2475: the returning-family signal must be an ENROLLED prior
    attendance, not a bare `households` row -- a household row exists for a
    year a family only cancelled or waitlisted, `households` carries no
    status column at all, and the old bare `year < {year}` read on
    `households` badged those families Returning anyway.
    """

    @pytest.mark.asyncio
    async def test_returns_household_ids_from_enrolled_weekend_attendees_only(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        enrolled_person = _record(household_id=2000001)
        pb.collection.return_value.get_full_list.return_value = [
            _record(expand={"person": enrolled_person}),
        ]

        result = await repo.fetch_prior_household_cm_ids(2026)

        pb.collection.assert_called_with("attendees")
        filter_str = _last_query(pb)["filter"]
        assert "year < 2026" in filter_str
        assert "status_id = 2" in filter_str
        assert _last_query(pb)["expand"] == "person"
        assert result == {2000001}

    @pytest.mark.asyncio
    async def test_a_cancelled_or_waitlisted_only_household_is_not_returning(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The literal reported bug: a household whose only prior rows are
        cancelled/waitlisted attendees has no ENROLLED row, so ACTIVE_ENROLLED_FILTER
        (status_id = 2) excludes it at the PocketBase filter -- the mock never
        returns a row for it, exactly as the real filter would not.
        """
        pb.collection.return_value.get_full_list.return_value = []

        result = await repo.fetch_prior_household_cm_ids(2026)

        assert result == set()

    @pytest.mark.asyncio
    async def test_filters_to_weekend_session_types_through_the_relation(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """Same weekend types as `_weekend_type_filter`, but through the
        `session.` relation prefix -- summer's main/embedded/ag/quest
        sessions must not count as a prior weekend visit.
        """
        pb.collection.return_value.get_full_list.return_value = []

        await repo.fetch_prior_household_cm_ids(2026)

        filter_str = _last_query(pb)["filter"]
        for session_type in WEEKEND_SESSION_TYPES:
            assert f'session.session_type = "{session_type}"' in filter_str

    @pytest.mark.asyncio
    async def test_a_person_with_no_household_id_contributes_nothing(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(expand={"person": _record(household_id=0)}),
            _record(expand={}),
            _record(expand=None),
        ]

        result = await repo.fetch_prior_household_cm_ids(2026)

        assert result == set()


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


def _route_by_collection(pb: MagicMock, rows: dict[str, list[Any]]) -> dict[str, list[dict[str, Any]]]:
    """Give the pb mock a different row set per collection name.

    Every other test in this file reads ONE collection, so the shared `pb`
    fixture can hand the same list to any caller.
    `fetch_cabin_assignments_by_household_cm_id` reads TWO -- and the whole
    point of it is that they are joined on the right key, which a mock
    returning the same rows to both would make untestable.

    Returns the per-collection record of `query_params` each read was issued
    with, so a test can assert both filters carry the SAME year.
    """
    queries: dict[str, list[dict[str, Any]]] = {}

    def _collection(name: str) -> MagicMock:
        def _get_full_list(**kwargs: Any) -> list[Any]:
            queries.setdefault(name, []).append(kwargs["query_params"])
            return rows.get(name, [])

        col = MagicMock()
        col.get_full_list.side_effect = _get_full_list
        return col

    pb.collection.side_effect = _collection
    return queries


class TestFetchCabinAssignmentsByHouseholdCmId:
    """The prior-year housing read, keyed by CampMinder id.

    ⚠️ THE JOIN IS THE WHOLE TEST. `family_camp_registrations.household` is a
    PocketBase relation, and `households` is YEAR-SCOPED -- a 2025
    registration hangs off the *2025* households record, whose PB id the 2026
    roster is not carrying. Joining a prior year's registrations onto the
    current year's household ids returns a plausible near-empty map rather
    than an error, so the board would quietly report a camp of first-timers.
    Measured on the 2026 prod snapshot: bridging on `cm_id` finds 257 of 459
    registered households with a 2025 cabin; joining on the PB id finds 0.

    Deliberately NOT restricted to "last year" here. kindred#2073 needs the
    identical read once per year of 2022-2025, so the YEAR is the parameter
    and "directly prior" is the caller's decision (kindred#2075's ruling
    limits what the CARD renders, not what this can fetch).
    """

    @pytest.mark.asyncio
    async def test_keys_by_household_cm_id_not_pocketbase_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        _route_by_collection(
            pb,
            {
                "family_camp_registrations": [_record(household="hh_2025_1", cabin_assignment="Cedar Lodge - Room 2")],
                "households": [_record(id="hh_2025_1", cm_id=2000001)],
            },
        )

        result = await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert result == {2000001: "Cedar Lodge - Room 2"}
        # Belt and braces on the key SPACE, not just the value: a map keyed by
        # PocketBase id would still satisfy an equality check written against
        # whatever it happened to produce.
        assert all(isinstance(key, int) for key in result)

    @pytest.mark.asyncio
    async def test_both_reads_are_scoped_to_the_year_asked_for(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Reading registrations at 2025 against households at 2026 is the
        same defect as joining on the PB id, one layer up.
        """
        queries = _route_by_collection(pb, {"family_camp_registrations": [], "households": []})

        await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert "year = 2025" in queries["family_camp_registrations"][0]["filter"]
        assert "year = 2025" in queries["households"][0]["filter"]

    @pytest.mark.asyncio
    async def test_blank_and_whitespace_assignments_are_dropped(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`cabin_assignment` is empty for every row 2017-2021 (0 of 1,433) and
        for the 16% of a live year not yet placed. An entry here means "we know
        where they were"; a blank one would render as an empty right-anchored
        gap on the card.
        """
        _route_by_collection(
            pb,
            {
                "family_camp_registrations": [
                    _record(household="hh_a", cabin_assignment=""),
                    _record(household="hh_b", cabin_assignment="   "),
                    _record(household="hh_c", cabin_assignment=None),
                    _record(household="hh_d", cabin_assignment="  Pine Cabin  "),
                ],
                "households": [
                    _record(id="hh_a", cm_id=2000001),
                    _record(id="hh_b", cm_id=2000002),
                    _record(id="hh_c", cm_id=2000003),
                    _record(id="hh_d", cm_id=2000004),
                ],
            },
        )

        result = await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert result == {2000004: "Pine Cabin"}

    @pytest.mark.asyncio
    async def test_a_registration_with_no_matching_household_is_dropped(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """Never key on 0. `_build_household_parties` gives an unresolvable
        household `household_cm_id = 0`, so a 0 key here would hand every
        such party somebody else's cabin.
        """
        _route_by_collection(
            pb,
            {
                "family_camp_registrations": [_record(household="hh_gone", cabin_assignment="Pine Cabin")],
                "households": [_record(id="hh_other", cm_id=2000001)],
            },
        )

        result = await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert result == {}

    @pytest.mark.asyncio
    async def test_shares_the_round_trips_of_whoever_read_the_year_first(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """A year already in hand costs this read NOTHING extra.

        This is the whole reason it composes over the two existing
        `@cached_by_year` reads instead of issuing a bespoke narrower query:
        kindred#2073's sweep of 2022-2025 pays each year once per process,
        and a bespoke query would have its own cache to keep coherent with
        those two.

        ⚠️ THE INNER READS ARE WHAT THIS PINS, so it must reach them --
        calling THIS function twice would prove nothing, because its own
        `@cached_by_year` entry serves the second call and the inner reads
        are never touched. Mutation-checked: strip the decorator off
        `fetch_households` or `fetch_family_camp_registrations` and the
        counts here go to two.
        """
        queries = _route_by_collection(pb, {"family_camp_registrations": [], "households": []})

        # Somebody else -- the same year's roster, or kindred#2073's previous
        # year in the sweep -- got here first.
        await repo.fetch_family_camp_registrations(2025)
        await repo.fetch_households(2025)

        await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert len(queries["family_camp_registrations"]) == 1
        assert len(queries["households"]) == 1

    @pytest.mark.asyncio
    async def test_its_own_cache_serves_the_second_call(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Two round trips the first time, none the second.

        The join on top gets its own `@cached_by_year` entry, so a second
        weekend loading the same year re-walks neither the registrations nor
        the households.
        """
        queries = _route_by_collection(pb, {"family_camp_registrations": [], "households": []})

        await repo.fetch_cabin_assignments_by_household_cm_id(2025)
        await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert len(queries["family_camp_registrations"]) == 1
        assert len(queries["households"]) == 1


class TestFetchHouseholdFamilyAttendees:
    """One household's enrolled family-camp children, across EVERY year.

    The cross-year read behind the household journey (kindred#2073). Three
    things about it are load-bearing and each is silently wrong rather than
    loud if it drifts:

    * `person.household_id`, NOT `person.household`. `persons` rows are
      themselves year-scoped and their `household` relation points at the
      SAME year's households record, so a PB-id filter can only ever match
      one year. `household_id` is the CampMinder id, which is the identity
      thread across seasons (CLAUDE.md section 1).
    * `session.session_type = "family"`. Adult weekends are person-grain and
      enrol the adult directly; letting them through would put a parent's own
      weekend into their children's journey.
    * `status_id = 2`. 2020 has 1,264 family attendee rows and not one
      enrolled -- the whole season cancelled -- and without this filter that
      year renders as a normal one.
    """

    @pytest.mark.asyncio
    async def test_filters_on_the_campminder_household_id_across_every_year(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.fetch_household_family_attendees(2000001)

        pb.collection.assert_called_with("attendees")
        params = _last_query(pb)
        assert "person.household_id = 2000001" in params["filter"]
        assert 'session.session_type = "family"' in params["filter"]
        assert "status_id = 2" in params["filter"]
        # No year predicate at all -- the sweep IS every year on file.
        assert "year =" not in params["filter"]
        # `session` alongside `person` (kindred#2420): the journey computes
        # each child's age at THEIR OWN attended session's start, which
        # needs that session's `start_date` in hand.
        assert params["expand"] == "person,session"

    @pytest.mark.asyncio
    async def test_an_unresolvable_household_reads_nothing(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`_build_household_parties` gives an unresolvable household
        `household_cm_id = 0`. `person.household_id = 0` is a real predicate
        that matches whatever rows carry a zero, so this must never be issued.
        """
        result = await repo.fetch_household_family_attendees(0)

        assert result == []
        pb.collection.assert_not_called()


class TestFetchHouseholdAdultsByYear:
    """The adult half of the journey, grouped by year.

    Family Camp adults have NO `persons` row -- `family_camp_adults` is their
    only representation and its rows are year-scoped, so this is the only
    place a past year's adults can come from. Bridged through the relation's
    `cm_id` rather than a PB id for the same reason as everything else here:
    `households` is year-scoped, so one PB id names one season.
    """

    @pytest.mark.asyncio
    async def test_groups_by_year_in_adult_number_order(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(year=2025, adult_number=2, name="Liam Garcia"),
            _record(year=2025, adult_number=1, name="Emma Johnson"),
            _record(year=2021, adult_number=1, name="Emma Johnson"),
        ]

        result = await repo.fetch_household_adults_by_year(2000001)

        pb.collection.assert_called_with("family_camp_adults")
        assert "household.cm_id = 2000001" in _last_query(pb)["filter"]
        assert [a.name for a in result[2025]] == ["Emma Johnson", "Liam Garcia"]
        assert [a.name for a in result[2021]] == ["Emma Johnson"]

    @pytest.mark.asyncio
    async def test_an_unresolvable_household_reads_nothing(self, repo: LodgingRepository, pb: MagicMock) -> None:
        result = await repo.fetch_household_adults_by_year(0)

        assert result == {}
        pb.collection.assert_not_called()


class TestFetchHouseholdRegistrationYears:
    """Which years the household registered for family camp at all.

    NOT derivable from `fetch_cabin_assignments_by_household_cm_id`, which
    drops every blank `cabin_assignment` -- and blank is all of 2017-2021.
    Measured on the production snapshot: between 24 and 89 registrations a
    year carry neither an enrolled child nor an adult row, so registration is
    a trace of its own and a journey built without it silently loses those
    years.
    """

    @pytest.mark.asyncio
    async def test_returns_the_set_of_years(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(year=2024),
            _record(year=2021),
            _record(year=2024),
        ]

        result = await repo.fetch_household_registration_years(2000001)

        pb.collection.assert_called_with("family_camp_registrations")
        assert "household.cm_id = 2000001" in _last_query(pb)["filter"]
        assert result == {2021, 2024}

    @pytest.mark.asyncio
    async def test_an_unresolvable_household_reads_nothing(self, repo: LodgingRepository, pb: MagicMock) -> None:
        result = await repo.fetch_household_registration_years(0)

        assert result == set()
        pb.collection.assert_not_called()


class TestFetchHouseholdsByIds:
    """The fresh-fetch escape hatch for kindred#2143.

    `fetch_households` is cached for up to 15 minutes (kindred#1963); a
    household created after the snapshot was cached is absent from it even
    though a fresh attendee can already name it. This method is the roster
    service's fallback for exactly that gap -- deliberately NOT decorated
    with @cached_by_year, unlike every other read in this class.
    """

    @pytest.mark.asyncio
    async def test_filters_by_id_and_keys_by_pb_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [_record(id="hh_9", cm_id=2000009)]

        result = await repo.fetch_households_by_ids(["hh_9"])

        pb.collection.assert_called_with("households")
        filter_str = _last_query(pb)["filter"]
        assert 'id = "hh_9"' in filter_str
        assert result["hh_9"].cm_id == 2000009

    @pytest.mark.asyncio
    async def test_multiple_ids_are_ored_together(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(id="hh_1", cm_id=2000001),
            _record(id="hh_2", cm_id=2000002),
        ]

        result = await repo.fetch_households_by_ids(["hh_1", "hh_2"])

        filter_str = _last_query(pb)["filter"]
        assert 'id = "hh_1"' in filter_str
        assert 'id = "hh_2"' in filter_str
        assert "||" in filter_str
        assert set(result) == {"hh_1", "hh_2"}

    @pytest.mark.asyncio
    async def test_an_empty_id_list_makes_no_request(self, repo: LodgingRepository, pb: MagicMock) -> None:
        result = await repo.fetch_households_by_ids([])

        assert result == {}
        pb.collection.return_value.get_full_list.assert_not_called()

    @pytest.mark.asyncio
    async def test_not_cached_across_calls(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Unlike fetch_households, a second call must hit PocketBase again --
        this method exists BECAUSE the cached snapshot is stale."""
        pb.collection.return_value.get_full_list.return_value = [_record(id="hh_1", cm_id=2000001)]

        await repo.fetch_households_by_ids(["hh_1"])
        await repo.fetch_households_by_ids(["hh_1"])

        assert pb.collection.return_value.get_full_list.call_count == 2

    @pytest.mark.asyncio
    async def test_ids_are_escaped(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_households_by_ids(['hh_1" || year != ""'])

        filter_str = _last_query(pb)["filter"]
        assert '\\"' in filter_str


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

        count = await repo.count_open_unresolved_aliases(2027)

        pb.collection.assert_called_with("lodging_ingest_issues")
        filter_str = _last_list_query(pb)["filter"]
        assert "year = 2027" in filter_str
        assert 'kind = "unresolved_alias"' in filter_str
        assert "is_resolved = false" in filter_str
        assert count == 3
        pb.collection.return_value.get_full_list.assert_not_called()

    @pytest.mark.asyncio
    async def test_open_unresolved_aliases_is_year_scoped(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`lodging_ingest_issues` has carried a required `year` since
        1500000122. Without this filter, viewing 2027's weekend header counts
        2026's unresolved cabin strings too, disagreeing with the now-year-
        scoped Unresolved names queue underneath it -- the same defect fixed
        one collection over in `lodgingCrud.ts`'s `listUnresolvedAliasIssues`.
        """
        pb.collection.return_value.get_list.return_value = _record(total_items=0)

        await repo.count_open_unresolved_aliases(2026)

        filter_str = _last_list_query(pb)["filter"]
        assert "year = 2026" in filter_str

    @pytest.mark.asyncio
    async def test_counts_request_a_single_row(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_list.return_value = _record(total_items=42)

        await repo.count_open_unresolved_aliases(2026)

        args = pb.collection.return_value.get_list.call_args[0]
        assert args[0] == 1, "page 1"
        assert args[1] == 1, "one row is enough to carry total_items"


class TestPageSize:
    """Every paged read must name its batch size (#1966).

    The SDK's `get_full_list(batch: int = 100, ...)` defaults to 100 rows per
    HTTP request and recurses once per page. `fetch_prior_household_cm_ids`
    pages every household from every prior year -- 20,256 rows on 2026 data --
    which is 203 round trips and ~2.3s of the roster's ~3.1s, to produce one
    boolean per party. At 1000 it is 21.

    Measured loopback against the dev DB; a round-trip-bound cost scales with
    per-hop RTT, so the production figure is likely worse rather than better.
    """

    @pytest.mark.asyncio
    async def test_prior_households_page_at_exactly_page_size(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """The batch must reach the SDK, and must be PAGE_SIZE.

        `batch` is a positional-or-keyword parameter on `get_full_list`, NOT a
        member of `query_params` -- putting it in the dict is silently ignored
        and leaves the default in place.

        Asserted as EQUAL to the constant rather than as a lower bound. A
        `>= 500` assertion passes while somebody "tunes" PAGE_SIZE to 500 and
        doubles the round trips -- the exact regression this pins. 1000 is also
        PocketBase's `MaxPerPage`, above which it clamps, so there is one
        correct value here and the test should say which.
        """
        await repo.fetch_prior_household_cm_ids(2026)

        call = pb.collection.return_value.get_full_list.call_args
        batch = call[1].get("batch", call[0][0] if call[0] else None)
        assert batch == PAGE_SIZE, f"paged at {batch}, not PAGE_SIZE ({PAGE_SIZE})"

    def test_no_read_calls_get_full_list_directly(self) -> None:
        """`_page` is the ONLY place `get_full_list` may be named.

        This replaces an earlier test that walked for `get_full_list` calls
        missing a `batch=` keyword. That test was defeated by an intermediate
        variable -- `getter = self.pb.collection(X).get_full_list` followed by
        `to_thread(getter, ...)` puts no `get_full_list` attribute inside the
        call's own subtree, so the walk saw nothing and reported success.

        Funnelling every paged read through one helper makes the defect
        UNREPRESENTABLE rather than merely detected: a read added later cannot
        forget `batch`, because it never passes one. So this asserts the funnel
        holds, which is a claim about one line of code rather than a claim
        about every call site's shape.
        """
        import ast
        import inspect

        from api.services import lodging_repository

        tree = ast.parse(inspect.getsource(lodging_repository))
        page_helper = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef) and node.name == "_page"
        )
        inside_helper = {id(node) for node in ast.walk(page_helper)}

        stray = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr == "get_full_list" and id(node) not in inside_helper
        ]

        assert not stray, f"get_full_list named outside _page at lines {stray} -- route it through the helper"


class TestFilterEscaping:
    """Every PocketBase id interpolated into a filter goes through `pb_escape`.

    These ids are server-derived today -- they come from `fetch_session`,
    `_resolve_session_pb_id` or a resolved household, never straight off the
    wire -- so this is defence in depth rather than a live hole. It is worth
    pinning anyway: the asymmetry is how the next one gets written wrong, and
    a reader comparing two adjacent methods cannot tell which convention is
    the deliberate one.

    The LODGING reads left this list with kindred#2042: they name the weekend
    by `session_cm_id`, a number, so there is no string literal to escape. The
    guard that replaced them is
    `TestLodgingReadsKeyOnTheCampMinderSessionId.test_the_session_term_is_never_compared_to_a_string`.
    """

    @pytest.mark.asyncio
    async def test_the_medical_read_escapes_the_household_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`fetch_medical_for_household` is the one that did not.

        It is also the worst one to leave out: an unescaped quote closes the
        `household = "..."` literal, and PocketBase binds `&&` tighter than
        `||`, so an injected `||` clause widens the predicate past the year
        AND the household -- and the first row of the result is returned as
        THIS family's medical narrative. The method's own docstring already
        argues that an unanchored filter is how one family's narrative
        reaches another family's request; escaping is the other half of that
        anchor.
        """
        await repo.fetch_medical_for_household(2026, 'hh_1" || id != "')

        filter_str = _last_query(pb)["filter"]
        assert 'household = "hh_1\\" || id != \\""' in filter_str
        assert '" || id != "' not in filter_str

    @pytest.mark.asyncio
    async def test_attendees_escapes_the_session_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_attendees_for_session(2026, 'pb"; //')

        filter_str = _last_query(pb)["filter"]
        # Assert the RAW value is absent and the ESCAPED form is present.
        # Asserting only that `"; //` is missing would fail against correctly
        # escaped output too, because `pb\"; //` still contains that substring
        # -- a test that cannot pass is as useless as one that cannot fail.
        assert 'pb"; //' not in filter_str, "raw quote reached the filter unescaped"
        assert 'pb\\"; //' in filter_str, "quote was not backslash-escaped"

    # This class used to parametrize the same assertion across four
    # session-scoped reads. Three of them (fetch_availability,
    # fetch_assignments, fetch_draft_assignments) left the list with
    # kindred#2042 -- they no longer interpolate a session STRING at all -- and
    # `fetch_attendees_for_session` above is the only PocketBase id a lodging
    # read still puts in a filter, so the parametrize collapsed to one case.


# kindred#1963 -- of the six year-scoped reads in build_roster's TaskGroup,
# only these four are safe to cache. The other two, fetch_units and
# count_open_unresolved_aliases, are written straight to PocketBase from the
# browser by the admin panels (frontend/src/services/lodgingCrud.ts) and would
# hide an admin's own edit for the cache's whole TTL.
CACHED_YEAR_SCOPED_READS = [
    "fetch_households",
    "fetch_prior_household_cm_ids",
    "fetch_family_camp_adults",
    "fetch_family_camp_registrations",
]


class TestYearScopedCaching:
    """The four sync-only year-scoped reads collapse to one PocketBase round
    trip per year, however many weekends or requests ask for it.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method_name", CACHED_YEAR_SCOPED_READS)
    async def test_second_call_for_the_same_year_is_a_cache_hit(
        self, repo: LodgingRepository, pb: MagicMock, method_name: str
    ) -> None:
        method = getattr(repo, method_name)
        await method(2026)
        assert pb.collection.return_value.get_full_list.call_count == 1

        await method(2026)

        assert pb.collection.return_value.get_full_list.call_count == 1, "second call must not hit PocketBase again"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method_name", CACHED_YEAR_SCOPED_READS)
    async def test_different_years_are_different_cache_entries(
        self, repo: LodgingRepository, pb: MagicMock, method_name: str
    ) -> None:
        method = getattr(repo, method_name)
        await method(2026)
        await method(2027)

        assert pb.collection.return_value.get_full_list.call_count == 2, "each year must issue its own read"

    @pytest.mark.asyncio
    async def test_two_repository_instances_share_one_cache(self, pb: MagicMock) -> None:
        """The cache is a module-level singleton (kindred#1963 trap #3): the
        router builds a fresh LodgingRepository per request
        (api/routers/lodging.py's `_service`), so per-instance state would
        never be reused across two requests for the same year.
        """
        await LodgingRepository(pb).fetch_households(2026)
        await LodgingRepository(pb).fetch_households(2026)

        assert pb.collection.return_value.get_full_list.call_count == 1

    @pytest.mark.asyncio
    async def test_fetch_units_is_never_cached(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`lodging_units` is written straight to PocketBase from the admin
        panel (createLodgingUnit / confirmLodgingUnits / deactivateLodgingUnit
        in lodgingCrud.ts). Caching it would hide a just-confirmed unit for
        the whole TTL to buy a read that is not even the expensive one.
        """
        await repo.fetch_units(2026)
        await repo.fetch_units(2026)

        assert pb.collection.return_value.get_full_list.call_count == 2

    @pytest.mark.asyncio
    async def test_open_unresolved_aliases_is_never_cached(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`lodging_ingest_issues.is_resolved` is written straight to
        PocketBase from the admin panel (mapUnresolvedAlias / ignoreIngestIssue
        in lodgingCrud.ts). Caching the count would leave a cabin name staff
        just resolved sitting in the "unmapped" figure for the whole TTL.
        """
        pb.collection.return_value.get_list.return_value = _record(total_items=3)

        await repo.count_open_unresolved_aliases(2026)
        await repo.count_open_unresolved_aliases(2026)

        assert pb.collection.return_value.get_list.call_count == 2


class TestLodgingYearCache:
    """The cache class itself, independent of LodgingRepository.

    Modeled on tests/unit/metrics/test_metrics_cache.py for
    api/services/metrics_cache.py, the sibling this class is shaped after.
    """

    def test_get_returns_none_on_miss(self) -> None:
        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=300, max_size=10)
        assert cache.get("fetch_households", 2026) is None

    def test_set_then_get_returns_the_cached_value(self) -> None:
        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=300, max_size=10)
        value = {"hh_1": "household"}
        cache.set("fetch_households", 2026, value)
        assert cache.get("fetch_households", 2026) == value

    def test_read_name_and_year_are_independent_axes(self) -> None:
        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=300, max_size=10)
        cache.set("fetch_households", 2026, "households-2026")
        cache.set("fetch_households", 2027, "households-2027")
        cache.set("fetch_family_camp_adults", 2026, "adults-2026")

        assert cache.get("fetch_households", 2026) == "households-2026"
        assert cache.get("fetch_households", 2027) == "households-2027"
        assert cache.get("fetch_family_camp_adults", 2026) == "adults-2026"

    def test_entry_expires_after_ttl(self) -> None:
        import time

        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=1, max_size=10)
        cache.set("fetch_households", 2026, "value")
        assert cache.get("fetch_households", 2026) is not None
        time.sleep(1.1)
        assert cache.get("fetch_households", 2026) is None

    def test_invalidate_all_clears_every_entry(self) -> None:
        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=300, max_size=10)
        cache.set("fetch_households", 2026, "a")
        cache.set("fetch_family_camp_adults", 2026, "b")

        cleared = cache.invalidate_all()

        assert cleared == 2
        assert cache.get("fetch_households", 2026) is None
        assert cache.get("fetch_family_camp_adults", 2026) is None

    def test_evicts_lru_when_at_capacity(self) -> None:
        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=300, max_size=2)
        cache.set("fetch_households", 2024, "a")
        cache.set("fetch_households", 2025, "b")
        cache.get("fetch_households", 2024)  # touch 2024 so 2025 is the LRU entry
        cache.set("fetch_households", 2026, "c")

        assert cache.get("fetch_households", 2024) is not None
        assert cache.get("fetch_households", 2025) is None, "least-recently-used entry must be evicted"
        assert cache.get("fetch_households", 2026) is not None


class TestCachedByYearSingleFlight:
    """Concurrent misses on the same key must coalesce onto one fetch (kindred#2144).

    A test that merely calls the wrapper twice in sequence passes against the
    *unfixed* code -- the second call would just see the first call's already-
    written cache entry. This races two coroutines through a shared
    `asyncio.Event` so both have genuinely entered the wrapper concurrently,
    before either one has written the cache, and asserts the wrapped
    function only ran once.
    """

    @pytest.mark.asyncio
    async def test_concurrent_misses_on_the_same_key_coalesce_to_one_fetch(self) -> None:
        import asyncio

        from api.services.lodging_cache import LodgingYearCache, cached_by_year

        cache = LodgingYearCache(ttl_seconds=300, max_size=10)
        call_count = 0
        callers_entered = 0
        both_entered = asyncio.Event()

        class Fake:
            @cached_by_year(cache)
            async def fetch_households(self, year: int) -> str:
                nonlocal call_count
                call_count += 1
                # Blocks until the test confirms BOTH callers have already
                # entered the wrapper -- proving the second caller observed
                # the first one's in-flight fetch rather than running after
                # it had already finished and written the cache.
                await both_entered.wait()
                return "value"

        fake = Fake()

        async def caller() -> str:
            nonlocal callers_entered
            callers_entered += 1
            if callers_entered == 2:
                both_entered.set()
            return await fake.fetch_households(2026)

        first, second = await asyncio.gather(caller(), caller())

        assert call_count == 1, "single-flight must coalesce concurrent misses into one fetch"
        assert first == "value"
        assert second == "value"

    def test_invalidate_all_clears_stale_inflight_locks(self) -> None:
        """`asyncio.Lock` binds to the event loop it is first awaited on, and
        pytest-asyncio hands every test its own loop -- a lock left behind by
        a prior test's loop raises RuntimeError when a later test awaits it.
        `invalidate_all()` must drop the in-flight lock map, not just the
        cached values, so the existing `_reset_lodging_cache` autouse fixture
        (which already calls `invalidate_all()` around every test) keeps the
        suite green.
        """
        from api.services.lodging_cache import LodgingYearCache

        cache = LodgingYearCache(ttl_seconds=300, max_size=10)
        lock_before = cache._lock_for("fetch_households", 2026)

        cache.invalidate_all()

        lock_after = cache._lock_for("fetch_households", 2026)
        assert lock_before is not lock_after, "invalidate_all must drop stale per-key locks"


class TestFetchSessionStatuses:
    """The staff-owned cancelled flag (kindred#2092).

    CampMinder's Sessions API exposes no status or registration-availability
    concept, so nothing syncs this. It is keyed on (session_cm_id, year) --
    CampMinder reuses session ids across years -- and read as a MAP so the
    caller never has to scan a list per weekend.
    """

    @pytest.mark.asyncio
    async def test_reads_the_whole_season_keyed_by_campminder_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        pb.collection.return_value.get_full_list.return_value = [
            _record(session_cm_id=1000001, year=2026, status="cancelled"),
            _record(session_cm_id=1000002, year=2026, status="active"),
        ]

        statuses = await repo.fetch_session_statuses(2026)

        pb.collection.assert_called_with("lodging_session_status")
        assert _last_query(pb)["filter"] == "year = 2026"
        assert statuses == {1000001: "cancelled", 1000002: "active"}

    @pytest.mark.asyncio
    async def test_a_season_with_no_rows_is_an_empty_map_not_an_error(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """ABSENCE OF A ROW MEANS ACTIVE, so an untouched season reads empty.

        The migration seeds nothing on purpose; if this raised or returned a
        sentinel, every weekend in every season before staff first used the
        panel would have to be special-cased by the caller.
        """
        pb.collection.return_value.get_full_list.return_value = []

        assert await repo.fetch_session_statuses(2026) == {}

    @pytest.mark.asyncio
    async def test_is_not_cached(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Written from the browser, exactly like lodging_units (kindred#1963).

        A cache hit here would keep showing a weekend as running for the TTL
        after staff cancelled it, to buy back a read of at most a dozen rows.
        """
        pb.collection.return_value.get_full_list.return_value = [
            _record(session_cm_id=1, year=2026, status="cancelled")
        ]
        await repo.fetch_session_statuses(2026)

        pb.collection.return_value.get_full_list.return_value = []
        assert await repo.fetch_session_statuses(2026) == {}


class TestFetchRequestTextValues:
    """The raw per-field, per-child bunk-request answers (kindred#2330).

    This is the one read on this surface that is deliberately NOT a derived
    column, and the module docstring's "request answers are NOT re-parsed
    here" still holds: nothing below normalises a gate, parses a mode or
    resolves a verdict. It reads the free text exactly as it was written, in
    the two lanes it was written in, because the household-grain
    `request_text` column joins its sources with `'; '` and 10 of 422
    non-blank 2026 values contain that separator themselves.
    """

    @staticmethod
    def _lanes(pb: MagicMock, family_camp: list[Any], bunking_csv: list[Any]) -> None:
        """Answer each lane by its FILTER, never by call order.

        The two lanes run concurrently through `asyncio.gather` over
        `asyncio.to_thread`, and both reach the same
        `pb.collection.return_value.get_full_list`. A positional
        `side_effect=[family, csv]` therefore hands the rows to whichever
        worker thread dequeues first, which nothing in asyncio guarantees --
        the family-camp lane wins today and a loaded CI runner is exactly
        where it would stop winning.
        """

        def _by_filter(**kwargs: Any) -> list[Any]:
            query_filter = kwargs.get("query_params", {}).get("filter", "")
            return family_camp if "field_definition" in query_filter else bunking_csv

        pb.collection.return_value.get_full_list.side_effect = _by_filter

    @pytest.mark.asyncio
    async def test_the_family_camp_lane_filters_on_the_three_custom_field_ids(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        await repo.fetch_request_text_values(2026)

        calls = {call[0][0] for call in pb.collection.call_args_list}
        assert "person_custom_values" in calls
        filters = [
            call[1]["query_params"]["filter"] for call in pb.collection.return_value.get_full_list.call_args_list
        ]
        family_camp = next(f for f in filters if "field_definition" in f)
        assert "year = 2026" in family_camp
        for cm_id in (206286, 240598, 274133):
            assert f"field_definition.cm_id = {cm_id}" in family_camp

    @pytest.mark.asyncio
    async def test_the_bunking_csv_lane_filters_on_the_three_column_slugs(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """32 rostered 2026 households have request text ONLY in this lane, so
        it is invisible on every weekend surface until this read exists."""
        await repo.fetch_request_text_values(2026)

        calls = {call[0][0] for call in pb.collection.call_args_list}
        assert "original_bunk_requests" in calls
        filters = [
            call[1]["query_params"]["filter"] for call in pb.collection.return_value.get_full_list.call_args_list
        ]
        csv_lane = next(f for f in filters if "bunk_request_form" in f)
        assert "year = 2026" in csv_lane
        for slug in ("bunk_request_form", "bunking_notes", "internal_notes"):
            assert f'field = "{slug}"' in csv_lane

    @pytest.mark.asyncio
    async def test_neither_excluded_source_field_is_ever_requested(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """`staff_not_bunk_with` is the sixth candidate the 2026-08-17 ruling
        did not name; `socialize_with` is not free text at all (two distinct
        values in 2026, both 40 characters). Excluding them at the READ is
        what makes them impossible to render by accident."""
        await repo.fetch_request_text_values(2026)

        filters = [
            call[1]["query_params"]["filter"] for call in pb.collection.return_value.get_full_list.call_args_list
        ]
        assert not any("staff_not_bunk_with" in f for f in filters)
        assert not any("socialize_with" in f for f in filters)

    @pytest.mark.asyncio
    async def test_a_family_camp_value_is_keyed_by_household_and_labelled_verbatim(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """The label is the CampMinder field name as it stands, including the
        misnamed `COVID-19 Bunking Requests` that carries 205 households of
        general bunking requests (owner ruling 2026-08-17: original field
        names until staff can weigh in after it is live)."""
        person = _record(id="p_1", household="hh_1", first_name="Emma", last_name="Johnson", preferred_name="")
        self._lanes(
            pb,
            [
                _record(
                    value="  Please put us near the Garcia family  ",
                    expand={"person": person, "field_definition": _record(cm_id=206286)},
                )
            ],
            [],
        )

        values = await repo.fetch_request_text_values(2026)

        assert list(values) == ["hh_1"]
        assert values["hh_1"][0].source_field == "COVID-19 Bunking Requests"
        assert values["hh_1"][0].text == "Please put us near the Garcia family"
        assert values["hh_1"][0].person is person

    @pytest.mark.asyncio
    async def test_a_bunking_csv_row_is_keyed_through_its_requester(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """`original_bunk_requests` carries no household relation at all, so
        the only route to one is the requester person -- which is year-scoped,
        exactly like the value rows in the other lane."""
        person = _record(id="p_2", household="hh_2", first_name="Liam", last_name="Garcia", preferred_name="")
        self._lanes(
            pb,
            [],
            [_record(field="bunking_notes", content="Split the siblings.", expand={"requester": person})],
        )

        values = await repo.fetch_request_text_values(2026)

        assert values["hh_2"][0].source_field == "BunkingNotes Notes"
        assert values["hh_2"][0].text == "Split the siblings."

    @pytest.mark.asyncio
    async def test_a_blank_answer_is_dropped_rather_than_rendered_as_an_empty_block(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """kindred#2255's ruling for this same modal: a source field with no
        text renders nothing at all, no "nothing applicable" clutter."""
        person = _record(id="p_1", household="hh_1", first_name="Emma", last_name="Johnson", preferred_name="")
        self._lanes(
            pb,
            [_record(value="   ", expand={"person": person, "field_definition": _record(cm_id=274133)})],
            [_record(field="internal_notes", content="", expand={"requester": person})],
        )

        assert await repo.fetch_request_text_values(2026) == {}

    @pytest.mark.asyncio
    async def test_a_value_whose_person_resolves_to_no_household_is_dropped(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """A blank household is not an identity. Grouping several of them
        together would invent a household holding other families' text."""
        self._lanes(
            pb,
            [
                _record(
                    value="Anything",
                    expand={"person": _record(id="p_9", household=""), "field_definition": _record(cm_id=274133)},
                )
            ],
            [_record(field="internal_notes", content="Anything", expand={"requester": None})],
        )

        assert await repo.fetch_request_text_values(2026) == {}

    @pytest.mark.asyncio
    async def test_an_unregistered_custom_field_id_is_dropped(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """The filter names three ids; a fourth arriving means the filter
        stopped narrowing, and rendering it would put an unlabelled block on
        the panel."""
        person = _record(id="p_1", household="hh_1", first_name="Emma", last_name="Johnson", preferred_name="")
        self._lanes(
            pb,
            [_record(value="Anything", expand={"person": person, "field_definition": _record(cm_id=240877)})],
            [],
        )

        assert await repo.fetch_request_text_values(2026) == {}

    @pytest.mark.asyncio
    async def test_is_cached_by_year(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Year-scoped and sync-written, like the registrations read beside it
        (kindred#1963). 422 family-camp value rows and 1,262 bunking-CSV rows
        on 2026, re-read per weekend without this."""
        person = _record(id="p_1", household="hh_1", first_name="Emma", last_name="Johnson", preferred_name="")
        self._lanes(
            pb,
            [
                _record(
                    value="Cabin near the bathhouse",
                    expand={"person": person, "field_definition": _record(cm_id=274133)},
                )
            ],
            [],
        )
        first = await repo.fetch_request_text_values(2026)

        pb.collection.return_value.get_full_list.side_effect = None
        pb.collection.return_value.get_full_list.return_value = []
        assert await repo.fetch_request_text_values(2026) == first


class TestRegistryNameReads:
    """kindred#2332's two reads: the whole unit registry and the whole alias
    table, which together let a prior year's housing render in TODAY's
    language.

    NEITHER IS YEAR-FILTERED, and that is the point of both. `lodging_units` is
    year-scoped and holds 2026 only, so the registry's LATEST season has to be
    discovered from the table rather than assumed to be the year being read --
    filtering to a 2023 row's own year finds nothing at all (kindred#2392).
    `lodging_unit_aliases` has no `year` column: a row's window
    (`valid_from_year` / `valid_to_year`) says which raw string was in use
    when, which is a rename history and not a per-year copy.
    """

    @pytest.mark.asyncio
    async def test_all_units_are_read_without_a_year_filter(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_all_units()

        pb.collection.assert_called_with("lodging_units")
        assert "year" not in _last_query(pb).get("filter", "")

    @pytest.mark.asyncio
    async def test_all_units_does_not_pay_for_the_area_expand(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Naming needs `code`, `name`, `year` and `parent_unit` and nothing
        else -- the area is `fetch_units`' business, for the board's grouping.
        """
        await repo.fetch_all_units()

        assert "expand" not in _last_query(pb)

    @pytest.mark.asyncio
    async def test_all_units_is_never_cached(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Same reason `fetch_units` is not: `lodging_units.name` is written
        straight to PocketBase from the admin panel, and this issue's own
        evidence is that staff rename units in bursts -- fourteen of the 118 in
        under two minutes on 2026-08-15. A TTL here shows the old name on every
        surface at once.
        """
        await repo.fetch_all_units()
        await repo.fetch_all_units()

        assert pb.collection.return_value.get_full_list.call_count == 2

    @pytest.mark.asyncio
    async def test_aliases_are_read_whole_and_unfiltered(self, repo: LodgingRepository, pb: MagicMock) -> None:
        await repo.fetch_unit_aliases()

        pb.collection.assert_called_with("lodging_unit_aliases")
        assert not _last_query(pb).get("filter", "")

    @pytest.mark.asyncio
    async def test_aliases_are_never_cached(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`mapUnresolvedAlias` in `lodgingCrud.ts` writes this table straight
        from the admin panel, never through this API -- the same argument
        `count_open_unresolved_aliases` makes for the queue it feeds.
        """
        await repo.fetch_unit_aliases()
        await repo.fetch_unit_aliases()

        assert pb.collection.return_value.get_full_list.call_count == 2


class TestFetchLastSuccessfulSyncEnd:
    """The mirror's own age, read server-side from `sync_runs`.

    The compare footer used to take this from an INDEPENDENT `/sync/status`
    read in the browser, which could advance while the comparison on screen
    did not -- a footer claiming the mirror was fresher than the data it
    described. Reading it here lets the compare response carry the age it was
    actually built against.
    """

    @pytest.mark.asyncio
    async def test_reads_the_latest_successful_run_for_that_service(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """SUCCESS ONLY, and newest first -- the same two rules the Go
        rehydration in `sync_runs.go` applies. A failed run made nothing
        fresh, so reporting its `ended` would be the freshness lie that
        function's own docstring refuses.
        """
        pb.collection.return_value.get_list.return_value = MagicMock(items=[_record(ended="2026-08-23 10:16:08.257Z")])

        ended = await repo.fetch_last_successful_sync_end("lodging_assignments")

        pb.collection.assert_called_with("sync_runs")
        call = pb.collection.return_value.get_list.call_args
        assert call[0] == (1, 1)
        params: dict[str, Any] = call[1]["query_params"]
        assert params["filter"] == 'service = "lodging_assignments" && status = "success"'
        # `-started,-id` rather than `-ended`: this is the ordering
        # `Orchestrator.LastRecordedRuns` already uses to pick one row per
        # service, and the two readouts must never disagree about which run
        # is the last one.
        assert params["sort"] == "-started,-id"
        assert ended == "2026-08-23T10:16:08.257Z"

    @pytest.mark.asyncio
    async def test_one_row_is_read_not_the_whole_history(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`sync_runs` holds every service's run for the retention window, so
        the whole-collection read `_page` performs would page in thousands of
        rows to use one field of one of them.
        """
        pb.collection.return_value.get_list.return_value = MagicMock(items=[])

        await repo.fetch_last_successful_sync_end("lodging_assignments")

        assert pb.collection.return_value.get_full_list.call_count == 0

    @pytest.mark.asyncio
    async def test_a_pocketbase_timestamp_is_normalised_to_rfc3339(
        self, repo: LodgingRepository, pb: MagicMock
    ) -> None:
        """PocketBase serialises a datetime SPACE-separated
        ("2026-08-23 10:16:08.257Z"); the Go status endpoint this replaces
        emitted Go's own RFC3339. `new Date()` parses the space form only by
        engine leniency, so the footer would read "Invalid Date" wherever that
        leniency runs out -- the separator is normalised here rather than in
        the component.
        """
        pb.collection.return_value.get_list.return_value = MagicMock(items=[_record(ended="2026-08-23 10:16:08.257Z")])

        assert await repo.fetch_last_successful_sync_end("lodging_assignments") == "2026-08-23T10:16:08.257Z"

    @pytest.mark.asyncio
    async def test_no_recorded_run_is_empty_rather_than_a_guess(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """ "" is what the footer renders as "last sync time is unknown". A
        service that has never recorded a successful run must not borrow a
        neighbour's timestamp or invent `now`.
        """
        pb.collection.return_value.get_list.return_value = MagicMock(items=[])

        assert await repo.fetch_last_successful_sync_end("lodging_assignments") == ""

    @pytest.mark.asyncio
    async def test_a_row_with_a_blank_end_is_empty(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`recordSyncRun` sets `ended` only from a completed run, and the
        column's PocketBase default is "". A row that somehow carries none is
        unknown, not the empty string rendered as a date.
        """
        pb.collection.return_value.get_list.return_value = MagicMock(items=[_record(ended="")])

        assert await repo.fetch_last_successful_sync_end("lodging_assignments") == ""
