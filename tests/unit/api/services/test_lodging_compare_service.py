"""`LodgingCompareService` — the scenario-vs-CampMinder compare (kindred#2478 §5).

The service composes and never re-decides: `compare_placements` owns the
placement predicate (pinned in test_lodging_rules.py) and `preview_push` owns
the write-in half. What is pinned HERE is the composition — which roster is
read as which side, the family-camp scope gate, and the count split §5.4
requires.

Both roster reads are stubbed. Unit codes are invented rather than sampled
from the registry (scripts/dev/verify-no-hardcoded-lodging.sh scans tests).
"""

from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.lodging import (
    LodgingUnitSummary,
    PartyChild,
    PushPreviewResponse,
    RosterParty,
    WeekendRosterResponse,
)
from api.services.lodging_compare_service import (
    LodgingCompareService,
    NotAFamilyWeekendError,
)
from api.services.lodging_roster_service import SessionNotFoundError


def _party(
    cm_id: int,
    name: str,
    codes: tuple[str, ...] = (),
    label: str = "",
    children: list[PartyChild] | None = None,
) -> RosterParty:
    return RosterParty(
        grain="household",
        household_cm_id=cm_id,
        display_name=name,
        unit_codes=list(codes),
        unit_name=label or " + ".join(codes),
        children=children or [],
    )


def _unit(code: str, name: str, parent: str = "", container: bool = False) -> LodgingUnitSummary:
    return LodgingUnitSummary(unit_id=f"id-{code}", code=code, name=name, parent_code=parent, is_container=container)


#: One combined house over two rooms -- the shape every multi-unit alias in the
#: registry has, and the one the compare has to read as a single placement.
_UPSTAIRS_TREE = [
    _unit("alpha-upstairs", "Alpha Upstairs", container=True),
    _unit("alpha-1", "Alpha 1", parent="alpha-upstairs"),
    _unit("alpha-2", "Alpha 2", parent="alpha-upstairs"),
]


def _roster(
    parties: list[RosterParty],
    session_type: str = "family",
    units: list[LodgingUnitSummary] | None = None,
) -> WeekendRosterResponse:
    return WeekendRosterResponse(
        year=2026,
        session_cm_id=1000001,
        session_name="Family Weekend One",
        session_type=session_type,
        parties=parties,
        units=units or [],
    )


class _Stubs(NamedTuple):
    """The service under test and the three awaits it is composed of, so a test
    can assert on the calls without reaching back through the instance (whose
    attributes mypy still types as the real bound methods)."""

    service: LodgingCompareService
    build_roster: AsyncMock
    preview_push: AsyncMock
    sync_end: AsyncMock
    #: The stubbed repository, for asserting a read did NOT happen. Same reason
    #: the three awaits are carried here: `service.repository.fetch_units` is
    #: typed as the real bound method, so mypy rejects `assert_not_called` on it.
    repository: MagicMock
    #: Every stubbed await, in the order the service issued it. ORDER is the
    #: whole correctness argument for the mirror-age read, so it needs to be
    #: assertable rather than inferred from three separate call counts.
    calls: list[str]


def _service(
    *,
    mirror: WeekendRosterResponse,
    scenario: WeekendRosterResponse,
    preview: PushPreviewResponse | None = None,
    synced_at: str = "",
) -> _Stubs:
    calls: list[str] = []

    async def build_roster(year: int, session_cm_id: int, scenario_id: str = "", **_: Any) -> Any:
        calls.append("scenario_roster" if scenario_id else "mirror_roster")
        return scenario if scenario_id else mirror

    async def sync_end(service_name: str) -> str:
        calls.append(f"sync_end:{service_name}")
        return synced_at

    async def preview_push(*_: Any, **__: Any) -> PushPreviewResponse:
        calls.append("preview_push")
        return preview or PushPreviewResponse(
            year=2026, session_cm_id=1000001, scenario="scn_1", digest="d", buildings=[]
        )

    repository = MagicMock()
    sync_end_stub = AsyncMock(side_effect=sync_end)
    repository.fetch_last_successful_sync_end = sync_end_stub

    service = LodgingCompareService(repository)
    roster_stub = AsyncMock(side_effect=build_roster)
    preview_stub = AsyncMock(side_effect=preview_push)
    service.roster.build_roster = roster_stub  # type: ignore[method-assign]
    service.writes.preview_push = preview_stub  # type: ignore[method-assign]
    return _Stubs(service, roster_stub, preview_stub, sync_end_stub, repository, calls)


class TestCompareScenario:
    @pytest.mark.asyncio
    async def test_the_mirror_side_is_the_no_scenario_roster(self) -> None:
        """The compare reads the SAME roster the board renders, twice — once
        with the scenario and once without. Any other party source could
        disagree with what staff are looking at."""
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            scenario=_roster([_party(11, "The Alvarez Family", ("beta-2",))]),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert stubs.build_roster.await_args_list[0].args == (2026, 1000001, "")
        assert stubs.build_roster.await_args_list[1].args == (2026, 1000001, "scn_1")
        assert [(p.cls, p.mirror_unit_label, p.scenario_unit_label) for p in report.parties] == [
            ("conflict", "alpha-1", "beta-2")
        ]

    @pytest.mark.asyncio
    async def test_counts_split_both_unassigned_out_of_match(self) -> None:
        """§5.4: agreement on a cabin and agreement that nobody has been given
        one are two different kinds of agreement. One green number over the
        pair hides a scenario nobody has worked."""
        mirror = _roster(
            [
                _party(11, "The Alvarez Family", ("alpha-1",)),
                _party(12, "The Bhatt Family"),
                _party(13, "The Castellano Family", ("alpha-2",)),
                _party(14, "The Duarte Family", ("beta-1",)),
                _party(15, "The Eze Family"),
            ]
        )
        scenario = _roster(
            [
                _party(11, "The Alvarez Family", ("alpha-1",)),
                _party(12, "The Bhatt Family"),
                _party(13, "The Castellano Family", ("beta-2",)),
                _party(14, "The Duarte Family"),
                _party(15, "The Eze Family", ("beta-3",)),
            ]
        )
        stubs = _service(mirror=mirror, scenario=scenario)
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert report.counts.match == 1
        assert report.counts.both_unassigned == 1
        assert report.counts.conflict == 1
        assert report.counts.remove == 1
        assert report.counts.add == 1

    @pytest.mark.asyncio
    async def test_the_write_in_half_is_preview_push_verbatim(self) -> None:
        """§5.4: the write-in section is the same classifier the Push
        Write-Ins screen runs, so the two can never disagree."""
        preview = PushPreviewResponse(
            year=2026,
            session_cm_id=1000001,
            scenario="scn_1",
            digest="digest_abc",
            buildings=[{"key": "alpha", "label": "Alpha", "cls": "add", "live": [], "draft": []}],
        )
        stubs = _service(mirror=_roster([]), scenario=_roster([]), preview=preview)
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert [b.cls for b in report.write_ins] == ["add"]
        stubs.preview_push.assert_awaited_once_with(2026, 1000001, "scn_1")

    @pytest.mark.asyncio
    async def test_an_adult_weekend_is_refused_not_compared(self) -> None:
        """Owner ruling §5.1: family camp weekends only. Adult sessions are not
        in the bounded cohort at all, so a compare against their mirror rows
        would grade a scenario against custom values up to seven days old."""
        stubs = _service(mirror=_roster([], session_type="adult"), scenario=_roster([], session_type="adult"))
        with pytest.raises(NotAFamilyWeekendError):
            await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        stubs.preview_push.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_the_mirror_cannot_be_compared_against_itself(self) -> None:
        stubs = _service(mirror=_roster([]), scenario=_roster([]))
        with pytest.raises(ValueError, match="scenario"):
            await stubs.service.compare_scenario(2026, 1000001, "")

    @pytest.mark.asyncio
    async def test_an_unknown_weekend_propagates_as_session_not_found(self) -> None:
        stubs = _service(mirror=_roster([]), scenario=_roster([]))
        stubs.service.roster.build_roster = AsyncMock(  # type: ignore[method-assign]
            side_effect=SessionNotFoundError("no weekend 9999999")
        )
        with pytest.raises(SessionNotFoundError):
            await stubs.service.compare_scenario(2026, 9999999, "scn_1")

    @pytest.mark.asyncio
    async def test_the_report_carries_no_action_of_any_kind(self) -> None:
        """§5.6: the modal REPORTS. Two of the four verdicts cannot be actioned
        at all — acting on `remove` means writing toward the mirror, which
        lodging_write_service.py forbids — so the payload carries no decision
        handle, no digest to echo, and nothing a client could post back."""
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            scenario=_roster([_party(11, "The Alvarez Family")]),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert "digest" not in report.model_dump()
        assert all("decision" not in field for field in report.parties[0].model_dump())


class TestLeafGrain:
    """The registry the predicate expands with comes from the ROSTER PAYLOAD,
    which is the same registry the board draws from (kindred#2478 §5, fixed
    2026-09-01).

    Not a second `fetch_units` of its own: a compare that expanded against a
    different unit list than the board drew could call a placement equal that
    the board shows in two places. `build_roster` has already paid for the
    read, and `WeekendRosterResponse.units` is deliberately unfiltered on
    `is_container` and `is_active`, so every room under a house is there.
    """

    @pytest.mark.asyncio
    async def test_a_house_and_its_rooms_are_one_placement_end_to_end(self) -> None:
        """CampMinder's alias resolves to the two rooms, the board holds the
        combined house, and the family never moved."""
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1", "alpha-2"))], units=_UPSTAIRS_TREE),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-upstairs",))], units=_UPSTAIRS_TREE),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert [p.cls for p in report.parties] == ["match"]
        assert (report.counts.match, report.counts.conflict) == (1, 0)

    @pytest.mark.asyncio
    async def test_a_partial_room_set_stays_a_conflict_end_to_end(self) -> None:
        """Owner ruling: partial is not equal."""
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))], units=_UPSTAIRS_TREE),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-upstairs",))], units=_UPSTAIRS_TREE),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert [p.cls for p in report.parties] == ["conflict"]
        assert report.counts.conflict == 1

    @pytest.mark.asyncio
    async def test_each_side_is_published_naming_the_units_it_holds(self) -> None:
        """⚠️ THE EXPANSION IS THE VERDICT'S ALONE. The modal names a placement
        from `*_unit_codes`, and THE BOARD IS THE AUTHORITY on that name (owner
        ruling 2026-08-28) -- publishing the expanded rooms would rename the
        card staff are looking at."""
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1", "alpha-2"))], units=_UPSTAIRS_TREE),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-upstairs",))], units=_UPSTAIRS_TREE),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert report.parties[0].scenario_unit_codes == ["alpha-upstairs"]
        assert report.parties[0].mirror_unit_codes == ["alpha-1", "alpha-2"]

    @pytest.mark.asyncio
    async def test_a_code_the_registry_has_never_heard_of_stays_in_the_comparison(
        self,
    ) -> None:
        """`_leaf_expander`'s half of the totality guarantee: an unresolvable
        code expands to ITSELF, not to nothing.

        Expanding it away would drop it out of the set, and a side holding a
        room PLUS something the registry cannot place would read as equal to a
        side holding the room alone -- a `Same cabin` covering a difference.
        """
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1", "ghost-9"))], units=_UPSTAIRS_TREE),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-1",))], units=_UPSTAIRS_TREE),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert [p.cls for p in report.parties] == ["conflict"]

    @pytest.mark.asyncio
    async def test_a_house_with_no_rooms_beneath_it_still_places_the_party(self) -> None:
        """The other unresolvable case: a container the registry carries no
        rooms under. It expands to itself for the same reason, so the family
        stays placed and reads as a `remove` against an empty scenario rather
        than as `Both unassigned`."""
        hollow = [_unit("alpha-hollow", "Alpha Hollow", container=True)]
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-hollow",))], units=hollow),
            scenario=_roster([_party(11, "The Alvarez Family")], units=hollow),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert [(p.cls, p.both_unassigned) for p in report.parties] == [("remove", False)]

    @pytest.mark.asyncio
    async def test_rooms_nested_below_a_second_container_still_expand(self) -> None:
        """`leaf_codes_under` recurses, so a house whose own children are
        containers still resolves to rooms -- the registry has three-level
        trees (a property, a wing, its rooms)."""
        nested = [
            _unit("alpha", "Alpha", container=True),
            _unit("alpha-upstairs", "Alpha Upstairs", parent="alpha", container=True),
            _unit("alpha-1", "Alpha 1", parent="alpha-upstairs"),
            _unit("alpha-2", "Alpha 2", parent="alpha-upstairs"),
        ]
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1", "alpha-2"))], units=nested),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha",))], units=nested),
        )
        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert [p.cls for p in report.parties] == ["match"]

    @pytest.mark.asyncio
    async def test_the_registry_is_not_fetched_a_second_time(self) -> None:
        """The two roster reads and the mirror-age read are still the whole
        cost of a compare. A `fetch_units` here would be a third source of
        truth about the unit tree as well as a third read."""
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1", "alpha-2"))], units=_UPSTAIRS_TREE),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-upstairs",))], units=_UPSTAIRS_TREE),
        )
        await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        stubs.repository.fetch_units.assert_not_called()


class TestComparePartyChildren:
    """The modal names a family by its CHILDREN, exactly as the board does
    (`FamilyCard`: "the children lead, bold", with `display_name` only as the
    fallback). That means the children have to reach the wire -- the verdict
    carries placement and identity, not the roster row -- so the SERVICE
    attaches them rather than `compare_placements`, which stays a pure
    placement predicate over the two sides.
    """

    @pytest.mark.asyncio
    async def test_the_report_carries_the_scenario_partys_children(self) -> None:
        kids = [
            PartyChild(person_cm_id=91, display_name="Rowan Abara", last_name="Abara", age=9.4),
            PartyChild(person_cm_id=92, display_name="Wren Abara", last_name="Abara", age=6.1),
        ]
        stubs = _service(
            mirror=_roster([_party(11, "The Abara Family", ("alpha-1",), children=kids)]),
            scenario=_roster([_party(11, "The Abara Family", ("beta-2",), children=kids)]),
        )

        result = await stubs.service.compare_scenario(2026, 1000001, "plan-a")

        assert [c.person_cm_id for c in result.parties[0].children] == [91, 92]
        assert [c.display_name for c in result.parties[0].children] == ["Rowan Abara", "Wren Abara"]

    @pytest.mark.asyncio
    async def test_a_mirror_only_party_still_carries_its_children(self) -> None:
        """`remove` parties exist only on the mirror side, so a children map
        built from the scenario alone would leave exactly the rows staff most
        need to identify with nothing but a mailing title."""
        kids = [PartyChild(person_cm_id=93, display_name="Ines Okafor", last_name="Okafor", age=7.0)]
        stubs = _service(
            mirror=_roster([_party(12, "The Okafor Family", ("alpha-1",), children=kids)]),
            scenario=_roster([]),
        )

        result = await stubs.service.compare_scenario(2026, 1000001, "plan-a")

        assert result.parties[0].cls == "remove"
        assert [c.display_name for c in result.parties[0].children] == ["Ines Okafor"]

    @pytest.mark.asyncio
    async def test_a_party_with_no_children_carries_an_empty_list(self) -> None:
        """Not None -- the client falls back to `display_name` on empty, and an
        adult-grain guest legitimately has no children at all."""
        stubs = _service(
            mirror=_roster([_party(13, "The Vance Family", ("alpha-1",))]),
            scenario=_roster([_party(13, "The Vance Family", ("alpha-1",))]),
        )

        result = await stubs.service.compare_scenario(2026, 1000001, "plan-a")

        assert result.parties[0].children == []


class TestMirrorAge:
    """The footer's age travels WITH the comparison, not beside it.

    §5.4 makes the age this screen's honesty mechanism: "without the age on
    screen, staff read a stale diff as a live one." It used to be fetched by
    the browser from `/api/custom/sync/status`, a read entirely independent of
    the one that built the report -- so a `lodging_assignments` transform
    landing between the two left the footer claiming the mirror was FRESHER
    than the rows the comparison had actually run over. The guard staff rely
    on was the one thing that could overstate.
    """

    @pytest.mark.asyncio
    async def test_the_report_states_the_mirror_age_it_was_built_against(self) -> None:
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            scenario=_roster([_party(11, "The Alvarez Family", ("beta-2",))]),
            synced_at="2026-08-23T10:16:08.257Z",
        )

        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert report.mirror_synced_at == "2026-08-23T10:16:08.257Z"

    @pytest.mark.asyncio
    async def test_the_age_read_names_the_transform_that_writes_the_mirror(self) -> None:
        """`lodging_assignments` and no other job. It is the transform that
        writes the table this compare reads as the mirror side, and the last
        of the six-job chain -- the same service §4's "Housing synced" line
        names, so the two readouts cannot drift apart.
        """
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
        )

        await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert stubs.sync_end.await_args is not None
        assert stubs.sync_end.await_args.args == ("lodging_assignments",)

    @pytest.mark.asyncio
    async def test_the_age_is_read_before_the_mirror_rows(self) -> None:
        """THE ORDER IS THE GUARANTEE, and it is the entire fix.

        A sync landing mid-request can only be in one of two places. Read the
        timestamp FIRST and it belongs to a run at or before the rows, so the
        footer understates freshness -- "anything staff changed since then is
        not here yet" stays true. Read it after the rows and the same sync
        makes the footer name a run whose output the comparison never saw,
        which is the claim §5.4 exists to prevent.

        Moving the read after `build_roster` would leave every assertion in
        this class passing, so the ordering is pinned on its own.
        """
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            scenario=_roster([_party(11, "The Alvarez Family", ("beta-2",))]),
            synced_at="2026-08-23T10:16:08.257Z",
        )

        await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert stubs.calls.index("sync_end:lodging_assignments") < stubs.calls.index("mirror_roster")

    @pytest.mark.asyncio
    async def test_a_mirror_that_never_synced_reports_no_age_rather_than_now(self) -> None:
        """ "" is what the footer renders as "its last sync time is unknown".
        A missing run must never be softened into a timestamp -- an unknown
        age reads as a warning, and `now` reads as a guarantee.
        """
        stubs = _service(
            mirror=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            scenario=_roster([_party(11, "The Alvarez Family", ("alpha-1",))]),
            synced_at="",
        )

        report = await stubs.service.compare_scenario(2026, 1000001, "scn_1")

        assert report.mirror_synced_at == ""
