"""The scenario-vs-CampMinder compare (kindred#2478 §5).

Composes; it does not decide. The placement predicate is
`lodging_rules.compare_placements` and the write-in half is
`LodgingWriteService.preview_push` -- both already owned, both already tested,
and neither re-implemented here. What this module owns is which roster is read
as which side, the family-camp scope gate, and the count split §5.4 requires.

READ-ONLY, ABSOLUTELY. Nothing here writes, and the response deliberately
carries no digest, no decision handle and nothing a client could post back
(owner ruling §5.6). Two of the four verdicts cannot be actioned at all: acting
on `remove` -- CampMinder has a family placed and the scenario does not --
means writing TOWARD the mirror, which `api/services/lodging_write_service.py`
forbids outright ("mirror into draft, never back... there is still no
promote/publish path, and adding one is a decision, not a follow-up").
`conflict` and `add` WOULD be legal in the draft direction, but a modal where
half the verdicts carry a button teaches staff a rule about our table
permissions rather than about their work. Acting is gated on the
promote/publish decision, which is its own issue and its own owner call.

⚠️ `copy_from_mirror` is not the escape hatch for that either -- it is
seed-only and refuses rather than merging, and its own docstring names this
modal as the front half of a feature that is not it: "Re-baselining a worked
plan against upstream drift is a different feature and is not this one."

## Why the roster is read TWICE rather than the two tables read directly

`lodging_assignments` and `lodging_assignments_draft` carry near-identical
columns, so reading them side by side is genuinely cheap -- but a party set
built here would be a SECOND answer to "who is enrolled this weekend", and the
label for a merged slot would be a second answer to "what is this placement
called". `build_roster` already answers both, and answers them the way the
board renders them. A compare that disagrees with the board it is describing
is worse than no compare.

The two reads are SEQUENTIAL, not a TaskGroup. Every year-scoped read inside
`build_roster` is `@cached_by_year`, so the second call pays only the
session-scoped ones; issued concurrently they would both miss a cold cache and
pay the year-scoped set twice.
"""

from collections.abc import Sequence
from typing import Any

from api.schemas.lodging import (
    ComparePartyReport,
    PartyChild,
    RosterParty,
    ScenarioCompareCounts,
    ScenarioCompareResponse,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import LodgingRosterService
from api.services.lodging_rules import (
    ComparePartyPlacement,
    ComparePartyVerdict,
    compare_party_key,
    compare_placements,
)
from api.services.lodging_write_service import LodgingWriteService

# `camp_sessions.session_type` for a family-camp weekend. The same literal
# `SessionResolver.GetFamilyCampSessionCMIDs` filters on -- exactly and only --
# which is what makes §5.1's scope ruling a fact about the data rather than a
# preference: the adult sessions are not in the bounded cohort at all, so their
# cabin answers are never fetched by the six-job chain and their mirror rows
# are rewritten daily from custom values up to seven days old.
FAMILY_SESSION_TYPE = "family"


class NotAFamilyWeekendError(ValueError):
    """The weekend exists but is not family camp (owner ruling, §5.1).

    A 400, not a 404 and not an empty report: the request named a real weekend
    and asked a question this feature does not answer for it. An empty report
    would read as "your scenario matches CampMinder", which on an adult
    weekend is a claim about data the refresh chain never fetched.
    """


def _placement_side(party: RosterParty) -> ComparePartyPlacement:
    """One roster party as one side of the compare.

    `unit_codes` empty is UNPLACED -- `RosterParty.unit_codes` is documented as
    "empty for unplaced" -- and that is the whole placed/unplaced test. Reading
    `unit_code` instead would be wrong twice over: it is "" on a merged slot,
    so every multi-room family would read as unplaced.
    """
    return ComparePartyPlacement(
        grain=party.grain,
        household_cm_id=party.household_cm_id,
        person_cm_id=party.person_cm_id,
        display_name=party.display_name,
        unit_codes=tuple(party.unit_codes),
        unit_label=party.unit_name,
    )


def _children_by_key(*rosters: Sequence[RosterParty]) -> dict[str, list[PartyChild]]:
    """Every party's children, keyed exactly as `compare_placements` keys them.

    BOTH sides are folded in, scenario first, because a `remove` party exists
    only on the mirror side -- and those are precisely the rows staff most need
    to identify, since they are the ones the plan has dropped. A map built from
    the scenario alone would leave them with nothing but a mailing title.

    Earlier rosters win: a party on both sides is the same enrolment either
    way (a scenario changes where families sleep, not who is enrolled), so the
    collision is a formality rather than a choice between two answers.
    """
    out: dict[str, list[PartyChild]] = {}
    for roster in rosters:
        for party in roster:
            key = compare_party_key(party.grain, party.household_cm_id, party.person_cm_id, party.display_name)
            out.setdefault(key, list(party.children))
    return out


def _report(verdict: ComparePartyVerdict, children: list[PartyChild]) -> ComparePartyReport:
    return ComparePartyReport(
        grain=verdict.grain,
        household_cm_id=verdict.household_cm_id,
        person_cm_id=verdict.person_cm_id,
        display_name=verdict.display_name,
        cls=verdict.cls,
        both_unassigned=verdict.both_unassigned,
        children=children,
        scenario_unit_label=verdict.scenario_unit_label,
        scenario_unit_codes=list(verdict.scenario_unit_codes),
        mirror_unit_label=verdict.mirror_unit_label,
        mirror_unit_codes=list(verdict.mirror_unit_codes),
    )


def _counts(verdicts: list[ComparePartyVerdict]) -> ScenarioCompareCounts:
    """The overview, with "both unassigned" taken OUT of `match` (§5.4)."""
    counts = ScenarioCompareCounts()
    for verdict in verdicts:
        if verdict.cls == "match":
            if verdict.both_unassigned:
                counts.both_unassigned += 1
            else:
                counts.match += 1
        elif verdict.cls == "conflict":
            counts.conflict += 1
        elif verdict.cls == "add":
            counts.add += 1
        else:
            counts.remove += 1
    return counts


class LodgingCompareService:
    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository
        self.roster = LodgingRosterService(repository)
        self.writes = LodgingWriteService(repository)

    async def compare_scenario(self, year: int, session_cm_id: int, scenario: str) -> ScenarioCompareResponse:
        """One family-camp weekend's scenario against the CampMinder mirror.

        Raises `SessionNotFoundError` for a weekend that does not exist and
        `NotAFamilyWeekendError` for one that is not family camp. The scope
        gate runs on the FIRST read, before `preview_push` is issued at all --
        an adult weekend should cost one roster read, not three.
        """
        if not scenario:
            raise ValueError("a compare requires a scenario -- the mirror cannot be compared against itself")

        mirror_roster: Any = await self.roster.build_roster(year, session_cm_id, "")
        if mirror_roster.session_type != FAMILY_SESSION_TYPE:
            raise NotAFamilyWeekendError(
                f"Weekend {session_cm_id} in {year} is not a family camp session; "
                "the scenario compare is family camp only"
            )
        scenario_roster: Any = await self.roster.build_roster(year, session_cm_id, scenario)

        verdicts = compare_placements(
            [_placement_side(p) for p in mirror_roster.parties],
            [_placement_side(p) for p in scenario_roster.parties],
        )
        children = _children_by_key(scenario_roster.parties, mirror_roster.parties)
        preview = await self.writes.preview_push(year, session_cm_id, scenario)

        return ScenarioCompareResponse(
            year=year,
            session_cm_id=session_cm_id,
            scenario=scenario,
            session_name=mirror_roster.session_name,
            counts=_counts(verdicts),
            parties=[_report(v, children.get(v.key, [])) for v in verdicts],
            write_ins=preview.buildings,
        )
