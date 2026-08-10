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
    async def test_composes_over_the_two_cached_reads(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """Two round trips the first time, none the second.

        Both halves are already `@cached_by_year`, so kindred#2073's sweep of
        2022-2025 pays each year once per process rather than once per
        request. A bespoke narrower query would have its own cache to keep
        coherent with those two.
        """
        queries = _route_by_collection(pb, {"family_camp_registrations": [], "households": []})

        await repo.fetch_cabin_assignments_by_household_cm_id(2025)
        await repo.fetch_cabin_assignments_by_household_cm_id(2025)

        assert len(queries["family_camp_registrations"]) == 1
        assert len(queries["households"]) == 1


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
    async def test_the_phi_read_escapes_the_household_id(self, repo: LodgingRepository, pb: MagicMock) -> None:
        """`fetch_medical_for_household` is the one that did not.

        It is also the worst one to leave out: an unescaped quote closes the
        `household = "..."` literal, and PocketBase binds `&&` tighter than
        `||`, so an injected `||` clause widens the predicate past the year
        AND the household -- and the first row of the result is returned as
        THIS family's medical narrative. The method's own docstring already
        argues that an unanchored filter is how one family's PHI reaches
        another family's request; escaping is the other half of that anchor.
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
