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
    PushPreviewResponse,
    RosterParty,
    WeekendRosterResponse,
)
from api.services.lodging_compare_service import (
    LodgingCompareService,
    NotAFamilyWeekendError,
)
from api.services.lodging_roster_service import SessionNotFoundError


def _party(cm_id: int, name: str, codes: tuple[str, ...] = (), label: str = "") -> RosterParty:
    return RosterParty(
        grain="household",
        household_cm_id=cm_id,
        display_name=name,
        unit_codes=list(codes),
        unit_name=label or " + ".join(codes),
    )


def _roster(parties: list[RosterParty], session_type: str = "family") -> WeekendRosterResponse:
    return WeekendRosterResponse(
        year=2026,
        session_cm_id=1000001,
        session_name="Family Weekend One",
        session_type=session_type,
        parties=parties,
    )


class _Stubs(NamedTuple):
    """The service under test and the two awaits it is composed of, so a test
    can assert on the calls without reaching back through the instance (whose
    attributes mypy still types as the real bound methods)."""

    service: LodgingCompareService
    build_roster: AsyncMock
    preview_push: AsyncMock


def _service(
    *,
    mirror: WeekendRosterResponse,
    scenario: WeekendRosterResponse,
    preview: PushPreviewResponse | None = None,
) -> _Stubs:
    service = LodgingCompareService(MagicMock())

    async def build_roster(year: int, session_cm_id: int, scenario_id: str = "", **_: Any) -> Any:
        return scenario if scenario_id else mirror

    roster_stub = AsyncMock(side_effect=build_roster)
    preview_stub = AsyncMock(
        return_value=preview
        or PushPreviewResponse(year=2026, session_cm_id=1000001, scenario="scn_1", digest="d", buildings=[])
    )
    service.roster.build_roster = roster_stub  # type: ignore[method-assign]
    service.writes.preview_push = preview_stub  # type: ignore[method-assign]
    return _Stubs(service, roster_stub, preview_stub)


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
