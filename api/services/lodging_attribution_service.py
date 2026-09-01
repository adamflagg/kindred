"""Occupancy evidence for the cabin-weekend attribution queue.

The round-2 triage-attack master plan §12.8, owner-designed and owner-ruled
2026-08-31. It closes no issue and none is filed, deliberately, per the
standing "fewer issues, not more" rule.

WHAT IT ANSWERS. When a household attends 2+ weekends, CampMinder holds ONE
`Family Camp Cabin` value for the year and cannot say which weekend it
describes. The Go ingest files that as an `ambiguous_session` work-queue row
carrying a SUGGESTION from `AttributeSession`
(`pocketbase/sync/lodging_session_attribution.go:327`), which picks the
earliest candidate weekend starting on or after the value's `last_updated`.
This service asks the one question that suggestion cannot: is the cabin
already occupied in each candidate weekend, and by whom.

⛔ WHY THE HEURISTIC NEEDS HELP, MEASURED. The 2026 snapshot's 136 cabin values
carry only SEVEN distinct `last_updated` days -- 60 on one, 53 on another, 83%
on two. `last_updated` records when staff did a bulk pass over a whole weekend,
not when one household's cabin was set: it has no per-household resolution at
all. Occupancy does.

⛔ NOTHING IN GO, AND `AttributeSession` IS UNTOUCHED. §12.8.6 gives two
disqualifying reasons and an ordering hazard:

1. A Go implementation would be a SECOND IMPLEMENTATION OF AVAILABILITY. The
   canonical computation is Python -- `is_family_available` / `free_family_spots`
   in `api/services/lodging_rules.py`, carrying owner rulings dated 2026-08-23
   and 2026-08-29 -- and a copy is the drift class this repository has been
   burned by three times.
2. It would go STALE AGAINST WRITE-INS. `lodging_assignments` is ingest-owned
   and `is_admin` (migration 1500000132), so placement evidence cannot go
   stale -- but `lodging_write_ins` rows are board-written directly
   (`api/services/lodging_write_service.py`), and write-ins are exactly what
   owner ruling 4 adds to the definition of occupancy.

⚠️ Plus an ordering hazard read time dissolves entirely: `ingestValue`
(`pocketbase/sync/lodging_assignments_sync.go:457`) both attributes and WRITES
in one per-household loop, so a live read there would see a conflict only if
the other household happened to be processed first -- and a full re-sync from
empty would see NO conflicts at all while an incremental run would. Same input,
different suggestion.

`suggested_session` therefore keeps its timestamp value in PocketBase, as the
fallback for any reader not coming through this API.

THE SEAM. Everything decided here is decided by `lodging_rules`'
`attribution_conflicts` / `conflict_aware_suggestion`, which are pure over
`(leaves, occupancy, candidates)`. This module only FETCHES and SHAPES: it
resolves the raw value through the alias table, expands containers to their
rooms, and reads each candidate weekend's board through the roster service's
own builders so that availability is literally the number the board draws
rather than a second answer to the same question.
"""

from __future__ import annotations

import asyncio
from typing import Any

from api.schemas.lodging import (
    AttributionCandidate,
    AttributionOccupant,
    SessionAttributionConflictRow,
    SessionAttributionConflictsResponse,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import (
    SUMMARY_ENTRY_CONCURRENCY,
    LodgingRosterService,
    _BathroomIndex,
    _capacity_by_code,
    _household_display_name,
    _i,
    _resolve_family_availability,
    _resolve_write_in_covers,
    _s,
    placement_grain,
    resolved_units,
    write_in_rows_by_unit,
)
from api.services.lodging_rules import (
    CandidateOccupancy,
    LeafOccupancy,
    PlacedParty,
    attribution_conflicts,
    compare_party_key,
    conflict_aware_suggestion,
    conflict_in_every_candidate,
)


class _WeekendBoard:
    """One candidate weekend's board, reduced to what the conflict rule reads.

    Built through the ROSTER SERVICE'S OWN BUILDERS -- `_build_units`, then
    `_BathroomIndex`, then the write-in cover walk and the availability
    resolver, in that order and for the reasons those functions document. What
    lands in `available_by_code` is therefore the same `is_family_available` the
    board card draws and the stats bar counts, not a second derivation of it.
    """

    __slots__ = ("available_by_code", "has_placements", "index", "placed_by_leaf", "write_ins_by_code")

    def __init__(
        self,
        index: _BathroomIndex,
        available_by_code: dict[str, bool],
        write_ins_by_code: dict[str, tuple[str, ...]],
        placed_by_leaf: dict[str, tuple[PlacedParty, ...]],
        *,
        has_placements: bool,
    ) -> None:
        self.index = index
        self.available_by_code = available_by_code
        self.write_ins_by_code = write_ins_by_code
        self.placed_by_leaf = placed_by_leaf
        self.has_placements = has_placements


class LodgingAttributionService:
    """Annotates the open attribution queue with per-weekend occupancy."""

    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository
        # COMPOSED, not subclassed and not copied: `_build_units` and the two
        # resolvers are the roster's, and running the queue's evidence through
        # anything else is how this surface would come to disagree with the
        # board staff are looking at.
        self.roster = LodgingRosterService(repository)

    async def build_conflicts(self, year: int) -> SessionAttributionConflictsResponse:
        """Every open `ambiguous_session` row for `year`, with its evidence.

        THE CHEAP QUESTION FIRST. An empty queue -- which is the normal state
        for most of the year -- costs exactly one read. `build_summary` pays
        its ten year-scoped reads before it knows whether it needs them; there
        is no reason for this to.

        ONE READ PER CANDIDATE WEEKEND, not one per queue row. The eight live
        2026 rows share a handful of weekends between them, so reading per row
        would re-pay four session-scoped reads for every row naming the same
        weekend. Bounded by the same semaphore `build_summary` uses, for the
        same reason (kindred#1920).

        THE LIVE BOARD, NEVER A SCENARIO. A scenario is one staff member's
        draft; the queue is a fact about what CampMinder holds, so it is judged
        against the scope `AttributeSession` itself would have seen.
        """
        issues = await self.repository.fetch_open_ambiguous_session_issues(year)
        if not issues:
            return SessionAttributionConflictsResponse(year=year, rows=[])

        async with asyncio.TaskGroup() as tg:
            sessions_task = tg.create_task(self.repository.fetch_weekend_sessions(year))
            units_task = tg.create_task(self.repository.fetch_units(year))
            households_task = tg.create_task(self.repository.fetch_households(year))
            # kindred#2332's registry-naming pair -- the same helper the roster
            # uses, so the value resolves to the unit the queue already labels
            # it with rather than to a second opinion.
            names_task = tg.create_task(self.roster._housing_names())

        sessions = sessions_task.result()
        units = units_task.result()
        households = households_task.result()
        resolver = names_task.result()

        # START DATE ASCENDING is `AttributeSession`'s own candidate order and
        # `conflict_aware_suggestion` derives from it -- `fetch_weekend_sessions`
        # sorts by `sort_order` first, which is a display choice and need not
        # agree.
        ordered = sorted(sessions, key=lambda s: (_s(s, "start_date"), _i(s, "cm_id")))
        session_cm_ids = [_i(s, "cm_id") for s in ordered]
        name_by_cm_id = {_i(s, "cm_id"): _s(s, "name") for s in ordered}
        cm_id_by_pb_id = {_s(s, "id"): _i(s, "cm_id") for s in ordered}
        label_by_household_cm_id = {
            _i(row, "cm_id"): _household_display_name(row, _i(row, "cm_id")) for row in households.values()
        }

        wanted = {cm_id for issue in issues for cm_id in self._candidate_cm_ids(issue) if cm_id in name_by_cm_id}
        boards = await self._weekend_boards(year, sorted(wanted), units, label_by_household_cm_id)

        rows = [
            self._row(issue, year, boards, resolver, session_cm_ids, name_by_cm_id, cm_id_by_pb_id) for issue in issues
        ]
        return SessionAttributionConflictsResponse(year=year, rows=rows)

    @staticmethod
    def _candidate_cm_ids(issue: Any) -> list[int]:
        """The row's candidate weekends, as a list of CampMinder ids.

        `candidate_session_cm_ids` is a PocketBase `json` column, so a row
        written before the column existed -- or one a future writer leaves
        blank -- arrives as None rather than as an empty list. Total over both,
        and over a stray non-integer member, because a malformed queue row must
        degrade to "no candidates" rather than 500 the whole report.
        """
        raw = getattr(issue, "candidate_session_cm_ids", None) or []
        if not isinstance(raw, list):
            return []
        out: list[int] = []
        for member in raw:
            try:
                out.append(int(member))
            except TypeError, ValueError:
                continue
        return out

    async def _weekend_boards(
        self,
        year: int,
        session_cm_ids: list[int],
        units: list[Any],
        label_by_household_cm_id: dict[int, str],
    ) -> dict[int, _WeekendBoard]:
        gate = asyncio.Semaphore(SUMMARY_ENTRY_CONCURRENCY)

        async def _one(session_cm_id: int) -> tuple[int, _WeekendBoard]:
            async with gate, asyncio.TaskGroup() as inner:
                availability_task = inner.create_task(self.repository.fetch_availability(year, session_cm_id))
                write_ins_task = inner.create_task(self.repository.fetch_write_ins(year, session_cm_id))
                placements_task = inner.create_task(self.repository.fetch_assignments(year, session_cm_id))
                merges_task = inner.create_task(self.repository.fetch_slot_merges(year, session_cm_id, ""))
            return session_cm_id, self._board(
                units,
                availability_task.result(),
                write_ins_task.result(),
                placements_task.result(),
                merges_task.result(),
                label_by_household_cm_id,
            )

        async with asyncio.TaskGroup() as tg:
            tasks = [tg.create_task(_one(cm_id)) for cm_id in session_cm_ids]
        return dict(task.result() for task in tasks)

    def _board(
        self,
        units: list[Any],
        availability: list[Any],
        write_ins: list[Any],
        placements: list[Any],
        merges: list[Any],
        label_by_household_cm_id: dict[int, str],
    ) -> _WeekendBoard:
        """One weekend's board, in the roster's own four steps.

        THE ORDER IS NOT FREE. `_resolve_write_in_covers` must run before
        `_resolve_family_availability` -- a unit's cover can come from a row on
        a unit built after it, which is why the cover walk is a second pass at
        all -- and both need the index `_BathroomIndex.build` produces. Running
        one and not the other is the half-fix the roster's own guard tests
        exist to catch; here it would report a written-into cabin as free and
        promote the wrong weekend.
        """
        summaries = self.roster._build_units(units, availability, write_ins, merges)
        index = _BathroomIndex.build(summaries)
        # THROUGH `_capacity_by_code`, NEVER A COMPREHENSION. That helper is a
        # function rather than an inline dict precisely so the orchestrators
        # cannot drift on the map that feeds BOTH write-in resolvers -- this is
        # the third orchestrator to build it. The one thing it does that a bare
        # comprehension does not is drop a BLANK-coded unit: "" is the key
        # `parent_code == ""` already means "no parent" by, so a blank-coded
        # unit under it collides with every other one and hands
        # `_resolve_family_availability` a real capacity where the roster hands
        # it None -- defeating that resolver's blank-code backstop.
        capacity_by_code = _capacity_by_code(summaries, index)
        write_in_rows = write_in_rows_by_unit(write_ins)
        _resolve_write_in_covers(summaries, write_in_rows, capacity_by_code)
        _resolve_family_availability(summaries, capacity_by_code, write_in_rows)

        available_by_code = {unit.code: unit.is_family_available for unit in summaries}
        write_ins_by_code = {unit.code: tuple(cover.occupant_name for cover in unit.write_ins) for unit in summaries}

        # KEYED BY PARTY, NOT A LIST, so one party is one occupant of one leaf.
        # `units` is a MULTI-SELECT since 1500000134, so a placement can name a
        # container AND a room inside it; both expand to leaves independently
        # and the room would otherwise collect the same party twice. Insertion
        # order is preserved, so the evidence line still reads in placement
        # order.
        placed_by_leaf: dict[str, dict[str, PlacedParty]] = {}
        for row in placements:
            grain = placement_grain(row)
            if grain is None:
                continue
            household_cm_id = grain[1] if grain[0] == "household" else 0
            person_cm_id = grain[1] if grain[0] == "person" else 0
            label = label_by_household_cm_id.get(household_cm_id) if household_cm_id else ""
            if not label:
                label = _household_display_name(None, household_cm_id) if household_cm_id else f"Person {person_cm_id}"
            party = PlacedParty(
                # The same key `compare_placements` joins on and `partyKey`
                # spells in TypeScript -- see `PlacedParty`. A bare CampMinder
                # id would let a person-grain queue row match a same-numbered
                # household's placement.
                party_key=compare_party_key(grain[0], household_cm_id, person_cm_id, label),
                label=label,
            )
            # A PLACEMENT NAMES WHATEVER LEVEL STAFF PLACED AT -- a room, a
            # combined building, or several units at once -- and the conflict
            # rule works at leaf grain, so each named unit is expanded here
            # exactly as the raw value's own units are. A family in a building
            # occupies every room in it.
            for placed_unit in resolved_units(row):
                for code in self._leaves_of(_s(placed_unit, "code"), index):
                    placed_by_leaf.setdefault(code, {}).setdefault(party.party_key, party)
        return _WeekendBoard(
            index,
            available_by_code,
            write_ins_by_code,
            {code: tuple(parties.values()) for code, parties in placed_by_leaf.items()},
            has_placements=bool(placements),
        )

    @staticmethod
    def _leaves_of(code: str, index: _BathroomIndex) -> tuple[str, ...]:
        """`code`'s rooms, or `code` itself when it is already a room.

        LEAF-NESS READS THE `is_container` FLAG, never child count -- the same
        call `drawn_units` makes, and for the same reason: a container with one
        room is still a container.
        """
        unit = index.units_by_code.get(code)
        if unit is None:
            return ()
        if not unit.is_container:
            return (code,)
        return tuple(sorted(index.leaf_codes_under(code)))

    def _row(
        self,
        issue: Any,
        year: int,
        boards: dict[int, _WeekendBoard],
        resolver: Any,
        session_cm_ids: list[int],
        name_by_cm_id: dict[int, str],
        cm_id_by_pb_id: dict[str, int],
    ) -> SessionAttributionConflictRow:
        """One queue row's evidence.

        THE VALUE IS RESOLVED ONCE, through `HousingNameResolver.resolve_codes`
        -- the same resolution the queue's own label comes from -- and then
        expanded to leaves. All 136 of 2026's values go through it: 130 leaf, 5
        multi-unit, 1 container. One rule, no special cases.

        A STRING THAT RESOLVES TO NOTHING DEMOTES NOTHING. Three of the 88
        distinct strings name a unit FAMILY rather than a unit (kindred#2392),
        and a value with no cabin has no cabin to find an occupant in. The
        alternative -- treating "unknown" as unavailable -- would conflict in
        every candidate and raise the alarm on every unmapped string, which is
        the `unresolved_alias` queue's job and not this one's.
        """
        household_cm_id = _i(issue, "household_cm_id")
        person_cm_id = _i(issue, "person_cm_id")
        grain = "person" if person_cm_id > 0 else "household"
        # `compare_party_key`'s fourth argument disambiguates parties whose id
        # is 0; a queue row always carries one of the two ids, so the raw value
        # is a sufficient (and stable) stand-in for a display name here.
        party_key = compare_party_key(grain, household_cm_id, person_cm_id, _s(issue, "raw_value"))

        raw_value = _s(issue, "raw_value")
        # The YEAR THE STRING CAME FROM, which is what picks the alias row that
        # was in use then -- `lodging_ingest_issues.year`, not the registry's
        # own latest season.
        unit_codes = resolver.resolve_codes(raw_value, _i(issue, "year") or year)

        candidate_cm_ids = {cm_id for cm_id in self._candidate_cm_ids(issue) if cm_id in name_by_cm_id}
        # ORDERED BY START DATE, the order `AttributeSession` requires of its
        # own candidates and the one `conflict_aware_suggestion` derives from.
        # The set is built ONCE rather than inside the condition, which rebuilt
        # it per weekend per queue row.
        ordered_candidates = [cm_id for cm_id in session_cm_ids if cm_id in candidate_cm_ids]

        leaf_codes: list[str] = []
        container_by_leaf: dict[str, str] = {}
        unit_names: list[str] = []
        # Any board will do for the tree: `_BathroomIndex` is built from the
        # YEAR's unit registry, which is the same list for every weekend --
        # only the occupancy differs. A row whose candidates are all unknown
        # weekends has no board at all, and resolves to no leaves.
        index = next((boards[cm_id].index for cm_id in ordered_candidates if cm_id in boards), None)
        for code in unit_codes:
            unit = index.units_by_code.get(code) if index is not None else None
            unit_names.append(unit.name if unit is not None else code)
            for leaf in self._leaves_of(code, index) if index is not None else ():
                if leaf in container_by_leaf:
                    continue
                leaf_codes.append(leaf)
                # "" when the value named the leaf itself, so the evidence line
                # only says "a room inside <building>" when the building really
                # is what staff wrote down.
                container_by_leaf[leaf] = unit.name if unit is not None and unit.is_container else ""

        occupancies = tuple(
            self._candidate_occupancy(cm_id, boards.get(cm_id), leaf_codes, container_by_leaf)
            for cm_id in ordered_candidates
        )
        verdicts = attribution_conflicts(occupancies, party_key)

        timestamp_suggestion = cm_id_by_pb_id.get(_s(issue, "suggested_session"))
        conflict_aware = conflict_aware_suggestion(ordered_candidates, verdicts, timestamp_suggestion)

        return SessionAttributionConflictRow(
            issue_id=_s(issue, "id"),
            raw_value=raw_value,
            source_field=_s(issue, "source_field"),
            household_cm_id=household_cm_id,
            person_cm_id=person_cm_id,
            resolved_unit_codes=list(unit_codes),
            resolved_unit_names=unit_names,
            resolved_leaf_codes=leaf_codes,
            candidates=[
                AttributionCandidate(
                    session_cm_id=verdict.session_cm_id,
                    session_name=name_by_cm_id.get(verdict.session_cm_id, ""),
                    verdict=verdict.verdict,
                    occupants=[
                        AttributionOccupant(
                            kind=occupant.kind,
                            label=occupant.label,
                            leaf_code=occupant.leaf_code,
                            leaf_name=occupant.leaf_name,
                            container_name=occupant.container_name,
                        )
                        for occupant in verdict.occupants
                    ],
                )
                for verdict in verdicts
            ],
            conflict_in_every_candidate=conflict_in_every_candidate(verdicts),
            timestamp_suggested_session_cm_id=timestamp_suggestion,
            conflict_aware_suggested_session_cm_id=conflict_aware,
            # A DEMOTION HAPPENED: the date heuristic named a weekend, the
            # conflict rule named a different one, so a conflict moved the
            # pick. Named once here rather than re-derived per render.
            #
            # ⚠️ NOT "the two suggestions disagree", which this comment used to
            # claim. It is deliberately FALSE when the stored pick is absent
            # and the rule still answers -- `conflict_aware_suggestion`'s
            # one-survivor arm answers without consulting the timestamp, and
            # `AttributeSession` publishes no guess for a zero `last_updated`.
            # Nothing was demoted there because there was no pick to demote, so
            # this field is right to stay False; a UI that wants to banner that
            # case needs its own second condition, and cannot read this one for
            # it.
            demotion_applied=(
                timestamp_suggestion is not None
                and conflict_aware is not None
                and timestamp_suggestion != conflict_aware
            ),
        )

    @staticmethod
    def _candidate_occupancy(
        session_cm_id: int,
        board: _WeekendBoard | None,
        leaf_codes: list[str],
        container_by_leaf: dict[str, str],
    ) -> CandidateOccupancy:
        """One candidate weekend's leaves, as the rule reads them.

        A MISSING BOARD IS `no_data`, not a conflict. It means the candidate
        names a weekend `fetch_weekend_sessions` did not return -- a stale
        queue row, which `computeStaleQueueIds` already hides in the UI -- and
        an absence of data is never evidence here (§12.8.4).

        A LEAF THE REGISTRY DOES NOT KNOW is treated the same way: available,
        with nobody in it. It cannot be occupied by anyone, because nothing can
        be placed into a unit that does not exist.
        """
        if board is None:
            return CandidateOccupancy(session_cm_id=session_cm_id, leaves=(), weekend_has_placements=False)
        leaves = tuple(
            LeafOccupancy(
                unit_code=code,
                unit_name=(unit.name if (unit := board.index.units_by_code.get(code)) is not None else code),
                shareability=(unit.shareability if unit is not None else "unknown"),
                is_family_available=board.available_by_code.get(code, True),
                placed_parties=board.placed_by_leaf.get(code, ()),
                write_in_labels=board.write_ins_by_code.get(code, ()),
                container_name=container_by_leaf.get(code, ""),
            )
            for code in leaf_codes
        )
        return CandidateOccupancy(
            session_cm_id=session_cm_id,
            leaves=leaves,
            weekend_has_placements=board.has_placements,
        )
