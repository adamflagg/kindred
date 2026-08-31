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
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.lodging_attribution_service import LodgingAttributionService
from api.services.lodging_repository import LodgingRepository

YEAR = 2026

# CampMinder ids are ids, not names, so §12.8's own worked figures stand.
HH_AMBIGUOUS = 7990954
HH_HOLDER = 10569302

FC1_PB, FC1 = "s_fc1", 1000001
FC2_PB, FC2 = "s_fc2", 1000002


def _session(pb_id: str, cm_id: int, name: str, start: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=pb_id,
        cm_id=cm_id,
        name=name,
        start_date=start,
        end_date=start,
        session_type="family",
        sort_order=cm_id,
    )


SESSIONS = [
    _session(FC1_PB, FC1, "Family Weekend One", "2026-06-05"),
    _session(FC2_PB, FC2, "Family Weekend Two", "2026-06-12"),
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
    async def test_a_shareable_unit_with_room_left_does_not_conflict(self) -> None:
        repo = _repo(
            issues=[_issue("Shared Hall")],
            placements={FC1: [_placement(HH_HOLDER, [MAPLE])], FC2: [_placement(HH_HOLDER, [MAPLE])]},
            write_ins={FC1: [_write_in(HALL, "Weekend staff", party_size=2)]},
        )

        response = await LodgingAttributionService(repo).build_conflicts(YEAR)

        assert _verdicts(response) == {FC1: "free", FC2: "free"}


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
