"""`LodgingAttributionService` -- the composition around §12.8's conflict rule.

The RULE is pinned in test_lodging_attribution_rules.py; what is pinned here is
the composition: which reads happen, that availability is the roster's own
answer rather than a second derivation, that a container value expands to its
rooms, and that BOTH suggestions reach the payload.

Unit codes and names are invented rather than sampled from the registry
(scripts/dev/verify-no-hardcoded-lodging.sh scans tests), and every household
name comes from the fictional set (tests/CLAUDE.md).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.lodging_attribution_service import LodgingAttributionService
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import _resolve_write_in_covers

YEAR = 2026

# CampMinder ids are ids, not names, so §12.8's own worked figures stand.
HH_AMBIGUOUS = 7990954
HH_HOLDER = 10569302

FC1_PB, FC1 = "s_fc1", 1000001
FC2_PB, FC2 = "s_fc2", 1000002
FC3_PB, FC3 = "s_fc3", 1000003


def _session(pb_id: str, cm_id: int, name: str, start: str, sort_order: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=pb_id,
        cm_id=cm_id,
        name=name,
        start_date=start,
        end_date=start,
        session_type="family",
        sort_order=sort_order,
    )


# ⚠️ FETCH ORDER IS NOT DATE ORDER HERE, DELIBERATELY. `fetch_weekend_sessions`
# sorts by `sort_order` first, which is a DISPLAY choice staff set, while
# `AttributeSession` requires its candidates in START DATE ascending order --
# so the third weekend is returned first and starts last.
SESSIONS = [
    _session(FC3_PB, FC3, "Family Weekend Three", "2026-06-19", sort_order=0),
    _session(FC1_PB, FC1, "Family Weekend One", "2026-06-05", sort_order=1),
    _session(FC2_PB, FC2, "Family Weekend Two", "2026-06-12", sort_order=2),
]


def _unit(
    pb_id: str,
    code: str,
    name: str,
    *,
    sleeps: int = 4,
    is_container: bool = False,
    parent_unit: str = "",
    shareability: str = "single_party",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=pb_id,
        code=code,
        name=name,
        year=YEAR,
        sleeps=sleeps,
        is_container=is_container,
        parent_unit=parent_unit,
        shareability=shareability,
        inventory_class="family_pool",
        is_active=True,
        is_confirmed=True,
    )


MAPLE = _unit("u_maple", "maple-1", "Maple Upper 1")
BIRCH_HOUSE = _unit("u_birch", "birch-house", "Birch House", is_container=True, sleeps=0)
BIRCH_1 = _unit("u_birch1", "birch-1", "Birch Room 1", parent_unit="u_birch")
BIRCH_2 = _unit("u_birch2", "birch-2", "Birch Room 2", parent_unit="u_birch")
HALL = _unit("u_hall", "shared-hall", "Shared Hall", sleeps=12, shareability="shareable")

UNITS = [MAPLE, BIRCH_HOUSE, BIRCH_1, BIRCH_2, HALL]


def _household(pb_id: str, cm_id: int, title: str) -> SimpleNamespace:
    return SimpleNamespace(id=pb_id, cm_id=cm_id, mailing_title=title, greeting="")


HOUSEHOLDS = {
    "h_amb": _household("h_amb", HH_AMBIGUOUS, "The Johnson Family"),
    "h_hold": _household("h_hold", HH_HOLDER, "The Garcia Family"),
}


def _issue(
    raw_value: str,
    *,
    issue_id: str = "iss_1",
    household_cm_id: int = HH_AMBIGUOUS,
    person_cm_id: int = 0,
    suggested_session: str = FC1_PB,
    candidates: tuple[int, ...] = (FC1, FC2),
) -> SimpleNamespace:
    return SimpleNamespace(
        id=issue_id,
        raw_value=raw_value,
        source_field="Family Camp Cabin",
        year=YEAR,
        household_cm_id=household_cm_id,
        person_cm_id=person_cm_id,
        suggested_session=suggested_session,
        candidate_session_cm_ids=list(candidates),
        occurrences=1,
        first_seen="2026-08-01T00:00:00Z",
        last_seen="2026-08-18T21:44:00Z",
    )


def _placement(household_cm_id: int, units: list[SimpleNamespace]) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"a_{household_cm_id}_{units[0].code}",
        household_cm_id=household_cm_id,
        person_cm_id=0,
        units=[u.id for u in units],
        expand={"units": units},
    )


def _write_in(unit: SimpleNamespace, occupant: str, party_size: int = 0) -> SimpleNamespace:
    return SimpleNamespace(id=f"w_{unit.code}", unit=unit.id, occupant_name=occupant, note="", party_size=party_size)


def _repo(
    *,
    issues: list[Any],
    placements: dict[int, list[Any]] | None = None,
    write_ins: dict[int, list[Any]] | None = None,
    aliases: list[Any] | None = None,
) -> MagicMock:
    """A repository whose per-weekend reads answer per session_cm_id.

    `spec=` is not decoration: it makes a read the service invents -- or one it
    calls under a name the repository does not have -- an AttributeError here
    rather than a MagicMock that silently answers everything.
    """
    placements = placements or {}
    write_ins = write_ins or {}
    repo = MagicMock(spec=LodgingRepository)
    repo.calls = []

    def _record(name: str, value: Any) -> AsyncMock:
        async def _call(*args: Any, **_: Any) -> Any:
            repo.calls.append((name, *args))
            return value(*args) if callable(value) else value

        return AsyncMock(side_effect=_call)

    repo.fetch_open_ambiguous_session_issues = _record("issues", issues)
    repo.fetch_weekend_sessions = _record("sessions", SESSIONS)
    repo.fetch_units = _record("units", UNITS)
    repo.fetch_all_units = _record("all_units", UNITS)
    repo.fetch_unit_aliases = _record("aliases", aliases or [])
    repo.fetch_households = _record("households", HOUSEHOLDS)
    repo.fetch_availability = _record("availability", lambda *_: [])
    repo.fetch_slot_merges = _record("merges", lambda *_: [])
    repo.fetch_assignments = _record("assignments", lambda _y, cm_id: placements.get(cm_id, []))
    repo.fetch_write_ins = _record("write_ins", lambda _y, cm_id: write_ins.get(cm_id, []))
    return repo


def _row(response: Any, index: int = 0) -> Any:
    return response.rows[index]


def _verdicts(response: Any, index: int = 0) -> dict[int, str]:
    return {c.session_cm_id: c.verdict for c in _row(response, index).candidates}


class TestTheWorkedCase:
    """§12.8.2's measured case, at household grain: enrolled FC1 + FC2, one
    cabin value, FC1's copy held by another household."""

    @pytest.mark.asyncio
    async def test_a_conflicted_timestamp_pick_is_demoted_to_the_survivor(self) -> None:
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [HALL])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}
        row = _row(response)
        assert row.timestamp_suggested_session_cm_id == FC1
        assert row.conflict_aware_suggested_session_cm_id == FC2
        assert row.demotion_applied is True
        assert row.conflict_in_every_candidate is False

    @pytest.mark.asyncio
    async def test_both_suggestions_are_published_even_when_they_agree(self) -> None:
        """Publishing BOTH is what lets the UI say "FC2, because FC1 is taken"
        instead of silently disagreeing with the row PocketBase stores."""
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            placements={FC1: [_placement(HH_HOLDER, [HALL])], FC2: [_placement(HH_HOLDER, [HALL])]},
        )

        row = _row(await LodgingAttributionService(repo).build_conflicts(YEAR))

        assert row.timestamp_suggested_session_cm_id == FC1
        assert row.conflict_aware_suggested_session_cm_id == FC1
        assert row.demotion_applied is False

    @pytest.mark.asyncio
    async def test_the_occupant_is_named_and_located(self) -> None:
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [HALL])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        conflicted = next(c for c in _row(response).candidates if c.session_cm_id == FC1)
        assert [(o.kind, o.label, o.leaf_code) for o in conflicted.occupants] == [
            ("placement", "The Garcia Family", "maple-1")
        ]


class TestValueShapes:
    @pytest.mark.asyncio
    async def test_a_container_value_expands_to_its_rooms(self) -> None:
        """Owner ruling 3. The VALUE names the building; the occupancy is one
        room, and the leaf expansion is what lets the two meet."""
        repo = _repo(
            issues=[_issue("Birch House")],
            placements={FC1: [_placement(HH_HOLDER, [BIRCH_2])], FC2: [_placement(HH_HOLDER, [HALL])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert sorted(_row(response).resolved_leaf_codes) == ["birch-1", "birch-2"]
        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}
        conflicted = next(c for c in _row(response).candidates if c.session_cm_id == FC1)
        assert conflicted.occupants[0].container_name == "Birch House"

    @pytest.mark.asyncio
    async def test_a_multi_unit_alias_resolves_to_every_member(self) -> None:
        alias = SimpleNamespace(
            id="al_1",
            alias_string="Birch 1and2",
            member_units=[BIRCH_1.id, BIRCH_2.id],
            valid_from_year=0,
            valid_to_year=0,
        )
        repo = _repo(
            issues=[_issue("Birch 1and2")],
            aliases=[alias],
            placements={FC1: [_placement(HH_HOLDER, [BIRCH_1])], FC2: [_placement(HH_HOLDER, [HALL])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert sorted(_row(response).resolved_leaf_codes) == ["birch-1", "birch-2"]
        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}

    @pytest.mark.asyncio
    async def test_an_unresolvable_value_reports_no_leaves_and_no_conflict(self) -> None:
        """Three of the 88 distinct strings name a unit FAMILY rather than a
        unit (kindred#2392). A string that resolves to nothing has no cabin to
        find an occupant in, so it demotes nothing rather than demoting
        everything."""
        repo = _repo(
            issues=[_issue("wherever they like")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [HALL])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _row(response).resolved_leaf_codes == []
        assert _verdicts(response) == {FC1: "free", FC2: "free"}
        assert _row(response).conflict_aware_suggested_session_cm_id == FC1

    @pytest.mark.asyncio
    async def test_a_placement_on_the_building_takes_the_rooms_inside_it(self) -> None:
        """The mirror image of the container-value case, and it needs the same
        expansion from the other end: staff placed a family on the WHOLE house
        and the value names one room in it. A family in a building occupies
        every room in it, so reading the room's own placements finds nothing
        and would call a full house free."""
        repo = _repo(
            issues=[_issue("Birch Room 1")],
            placements={FC1: [_placement(HH_HOLDER, [BIRCH_HOUSE])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}
        conflicted = next(c for c in _row(response).candidates if c.session_cm_id == FC1)
        assert [(o.kind, o.label, o.leaf_code) for o in conflicted.occupants] == [
            ("placement", "The Garcia Family", "birch-1")
        ]


class TestCandidateOrder:
    @pytest.mark.asyncio
    async def test_the_demotion_walks_candidates_by_start_date_not_fetch_order(self) -> None:
        """`AttributeSession` requires its candidates START DATE ASCENDING, and
        `conflict_aware_suggestion` derives from that order -- the first
        survivor at or after the demoted pick. `fetch_weekend_sessions` returns
        them in `sort_order`, which staff set for display and which SESSIONS
        above deliberately disagrees with. Reading the fetch order here would
        demote to the wrong weekend whenever the two differ.

        The ROW's OWN `candidate_session_cm_ids` is not the order either, and
        this fixture lists it backwards to say so: it is a plain PocketBase
        `json` array with no ordering contract of its own, so the order has to
        come from the session table rather than from whatever the writer
        happened to store.
        """
        repo = _repo(
            issues=[_issue("Maple Upper 1", suggested_session=FC2_PB, candidates=(FC3, FC2, FC1))],
            placements={
                FC1: [_placement(HH_HOLDER, [HALL])],
                FC2: [_placement(HH_HOLDER, [MAPLE])],
                FC3: [_placement(HH_HOLDER, [HALL])],
            },
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)
        row = _row(response)

        assert [c.session_cm_id for c in row.candidates] == [FC1, FC2, FC3]
        assert _verdicts(response) == {FC1: "free", FC2: "conflict", FC3: "free"}
        assert row.timestamp_suggested_session_cm_id == FC2
        assert row.conflict_aware_suggested_session_cm_id == FC3


class TestWriteInsAreReadLive:
    @pytest.mark.asyncio
    async def test_an_unsized_write_in_conflicts_wholesale(self) -> None:
        """⭐ §12.8.9's most-likely-backwards case, end to end. `party_size = 0`
        is the column's unset default (`min: 1` forbids a real zero), so the
        write-in takes the room WHOLESALE (kindred#2540) -- and this is the
        second reason the endpoint is uncached: write-ins are board-written
        straight to PocketBase."""
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            placements={FC1: [_placement(HH_HOLDER, [HALL])], FC2: [_placement(HH_HOLDER, [HALL])]},
            write_ins={FC1: [_write_in(MAPLE, "Weekend staff")]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}
        conflicted = next(c for c in _row(response).candidates if c.session_cm_id == FC1)
        assert [(o.kind, o.label) for o in conflicted.occupants] == [("write_in", "Weekend staff")]

    @pytest.mark.asyncio
    async def test_a_shareable_unit_with_an_unsized_write_in_conflicts_wholesale(self) -> None:
        """⭐ THE ARM ONLY `is_family_available` CAN ANSWER, and the reason this
        service must not re-derive availability.

        On a `single_party` leaf the write-in arm of the rule closes the space
        on its own, so an unsized write-in there proves nothing about the
        availability wiring. On a SHAREABLE leaf it does not: a shareable cabin
        takes a second party until its beds run out, and what runs them out is
        `free_family_spots` charging an unsized cover the unit's WHOLE capacity
        (kindred#2540). Twelve beds, one write-in nobody counted, zero spots
        left -- and the ONLY thing that says so is the resolver pass this
        service borrows from the roster.
        """
        repo = _repo(
            issues=[_issue("Shared Hall")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
            write_ins={FC1: [_write_in(HALL, "Weekend staff")]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}

    @pytest.mark.asyncio
    async def test_a_write_in_on_the_building_closes_a_room_inside_it(self) -> None:
        """A write-in is a fact about a physical SPACE, and a building's space
        contains its rooms' (`WriteInCover`). The row names the house; the
        value names one room; the room is taken. Only the cover walk resolves
        that -- reading the room's own rows finds nothing at all.
        """
        repo = _repo(
            issues=[_issue("Birch Room 1")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
            write_ins={FC1: [_write_in(BIRCH_HOUSE, "Weekend staff")]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}
        conflicted = next(c for c in _row(response).candidates if c.session_cm_id == FC1)
        assert [(o.kind, o.label, o.leaf_code) for o in conflicted.occupants] == [
            ("write_in", "Weekend staff", "birch-1")
        ]

    @pytest.mark.asyncio
    async def test_a_sized_write_in_on_a_shareable_unit_with_beds_left_still_conflicts(self) -> None:
        """⚖️ INVERTED BY THE 2026-09-01 RULING. It asserted `free` -- twelve
        beds, a write-in for two, room to spare -- and that was the old
        capacity rule working as designed.

        Presence replaced it: *"write ins and placed families matter, but for
        purposes of bed subtraction that's overkill."* Somebody is in the hall,
        so the weekend is demoted, and staff can still confirm it anyway.
        """
        repo = _repo(
            issues=[_issue("Shared Hall")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
            write_ins={FC1: [_write_in(HALL, "Weekend staff", party_size=2)]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}

    @pytest.mark.asyncio
    async def test_a_placement_on_a_shareable_unit_conflicts(self) -> None:
        """⭐ THE CASE THE OLD RULE COULD NOT SEE AT ALL, and the reason the
        ruling was needed rather than merely simpler.

        `leaf_conflicts` used to skip its placement arm for a shareable leaf
        and defer to `is_family_available`, which is computed from
        `free_family_spots` -- and that function's own docstring says *"Placed
        families are NOT subtracted here."* So NO placement, of any size, could
        ever close a shareable cabin: this returned `free` however many other
        families were in it. Measured on the 2026 snapshot, 44 of 118 units are
        shareable and 5 of the 10 open queue rows name one.
        """
        repo = _repo(
            issues=[_issue("Shared Hall")],
            placements={FC1: [_placement(HH_HOLDER, [HALL])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "free"}


class TestNoData:
    @pytest.mark.asyncio
    async def test_a_weekend_with_no_placements_is_no_data(self) -> None:
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "conflict", FC2: "no_data"}

    @pytest.mark.asyncio
    async def test_write_ins_alone_do_not_make_a_weekend_planned(self) -> None:
        """FC6 carries 3 write-ins and 0 placements. ⚠️ `no_data` means no
        PLACEMENTS, not no occupancy."""
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            write_ins={FC2: [_write_in(HALL, "Weekend staff")]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "no_data", FC2: "no_data"}


class TestAllCandidatesConflict:
    @pytest.mark.asyncio
    async def test_the_alarm_is_raised_and_nothing_is_demoted(self) -> None:
        repo = _repo(
            issues=[_issue("Maple Upper 1")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)
        row = _row(response)

        assert row.conflict_in_every_candidate is True
        assert row.conflict_aware_suggested_session_cm_id == FC1
        assert row.demotion_applied is False


class TestReads:
    @pytest.mark.asyncio
    async def test_an_empty_queue_costs_one_read(self) -> None:
        """Nothing to annotate means nothing to fetch. `build_summary` pays ten
        year-scoped reads before it knows whether it needs them; this asks the
        cheap question first."""
        repo = _repo(issues=[])

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert response.rows == []
        assert [call[0] for call in repo.calls] == ["issues"]

    @pytest.mark.asyncio
    async def test_a_candidate_weekend_shared_by_two_rows_is_read_once(self) -> None:
        """Eight live queue rows share a handful of weekends. Reading per ROW
        instead of per WEEKEND would re-pay the four session-scoped reads for
        every row that names the same weekend."""
        repo = _repo(
            issues=[_issue("Maple Upper 1", issue_id="iss_1"), _issue("Shared Hall", issue_id="iss_2")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])]},
        )

        await LodgingAttributionService(repo).build_conflicts(YEAR)

        assignment_reads = [call for call in repo.calls if call[0] == "assignments"]
        assert sorted(call[2] for call in assignment_reads) == [FC1, FC2]

    @pytest.mark.asyncio
    async def test_the_live_board_is_read_not_a_scenario(self) -> None:
        """A scenario is one staff member's draft. The queue is a fact about
        what CampMinder holds, so it is judged against the LIVE board -- the
        same scope `AttributeSession` would have seen."""
        repo = _repo(issues=[_issue("Maple Upper 1")])

        await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert repo.fetch_draft_assignments.await_count == 0
        assert repo.fetch_draft_write_ins.await_count == 0
        assert any(call[0] == "assignments" for call in repo.calls), "the live board really was read"


class TestTheCapacityMapIsTheRostersOwn:
    """`_capacity_by_code` is a FUNCTION rather than a comprehension on purpose.

    Its own docstring says why: *"`build_roster` and `build_summary._entry` are
    the two orchestrators kindred#2503 exists to keep in step, and this map
    feeds the write-in cover walk AND the availability resolution on both.
    Copy-pasted, the symmetry is something a reviewer has to notice; extracted,
    it is structural."* This service is the THIRD orchestrator to build that
    map, so it goes through the same helper.

    The one thing the helper does that a bare comprehension does not is drop a
    BLANK-coded unit. `""` is the key `parent_code == ""` already uses for "no
    parent", so a blank-coded unit under that key collides with every other
    blank-coded unit and hands the write-in cover resolver a real capacity
    where the roster hands it None -- defeating the blank-code backstop that
    resolver's docstring spends a paragraph on. Not live today (no production
    unit has a blank code) and not reachable through this endpoint's own
    payload, since a raw value only ever resolves to registry codes. It is
    pinned anyway, because the next reader of this map has no way to know that.
    """

    @pytest.mark.asyncio
    async def test_a_blank_coded_unit_never_reaches_the_resolvers_under_the_empty_key(self) -> None:
        seen: dict[str, Any] = {}

        def _spy(units: Any, write_in_rows: Any, capacity_by_code: Any) -> Any:
            seen["caps"] = dict(capacity_by_code)
            return _resolve_write_in_covers(units, write_in_rows, capacity_by_code)

        blank = _unit("u_blank", "", "Unmapped Cabin")
        repo = _repo(issues=[_issue("Maple Upper 1")])
        repo.fetch_units = AsyncMock(return_value=[*UNITS, blank])

        with patch("api.services.lodging_attribution_service._resolve_write_in_covers", _spy):
            await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert "" not in seen["caps"], "a blank-coded unit collided into the 'no parent' key"
        # Positive control: without it, a map that reached the resolver EMPTY
        # would satisfy the assertion above just as loudly.
        assert seen["caps"][MAPLE.code] == MAPLE.sleeps


class TestOneOccupantPerParty:
    """A placement's `units` relation is a MULTI-SELECT (1500000134 collapsed
    `unit`/`merge`/`merge_draft` into it), so it can name a container AND a
    room inside that container. Both expand to leaves independently, so the
    room used to collect the same party twice and the evidence line named one
    family as two occupants of one room.

    The verdict was never affected -- `leaf_conflicts` asks *whether* another
    party is placed, not how many times -- so this is the evidence line only.
    That is the entire point of the payload.
    """

    @pytest.mark.asyncio
    async def test_a_party_placed_on_both_a_building_and_its_room_is_one_occupant(self) -> None:
        repo = _repo(
            issues=[_issue("Birch Room 1")],
            placements={FC1: [_placement(HH_HOLDER, [BIRCH_HOUSE, BIRCH_1])]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        candidate = next(c for c in _row(response).candidates if c.session_cm_id == FC1)
        # A positive control: the conflict really was found, so an empty
        # occupant list cannot pass this test by saying nothing at all.
        assert candidate.verdict == "conflict"
        assert [(o.label, o.leaf_code) for o in candidate.occupants] == [("The Garcia Family", BIRCH_1.code)]
