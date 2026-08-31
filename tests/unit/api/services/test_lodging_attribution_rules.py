"""The cabin-weekend attribution CONFLICT rule, pure over its three inputs.

Spec: the round-2 triage-attack master plan §12.8 (owner-designed and
owner-ruled 2026-08-31). No issue is filed and none should be.

Everything here is total over plain values -- `(leaves, occupancy, candidates)`
-- for the reason `_resolve_write_in_covers` states about its own pure
counterpart: the rule is what the tests reason about, and the service is one
line that calls it. Nothing in this file touches PocketBase, FastAPI, or the
roster orchestrator.
"""

from __future__ import annotations

import pytest

from api.services.lodging_rules import (
    CandidateOccupancy,
    HousingNameResolver,
    LeafOccupancy,
    PlacedHousehold,
    RegistryUnit,
    UnitAlias,
    attribution_conflicts,
    conflict_aware_suggestion,
)

# Fictional throughout (tests/CLAUDE.md). Household CampMinder ids are ids, not
# names, so §12.8's own worked figures are carried verbatim.
THIS_HOUSEHOLD = 7990954
OTHER_HOUSEHOLD = 10569302
THIRD_HOUSEHOLD = 8604272

# The evidence line names the FAMILY, not the id -- fictional throughout.
OTHER = PlacedHousehold(cm_id=OTHER_HOUSEHOLD, label="The Garcia Family")
THIRD = PlacedHousehold(cm_id=THIRD_HOUSEHOLD, label="The Chen Family")
MINE = PlacedHousehold(cm_id=THIS_HOUSEHOLD, label="The Johnson Family")

FC1 = 1000001
FC2 = 1000002
FC3 = 1000003


def _leaf(
    code: str,
    *,
    name: str = "",
    shareability: str = "single_party",
    is_family_available: bool = True,
    placed: tuple[PlacedHousehold, ...] = (),
    write_ins: tuple[str, ...] = (),
    container_name: str = "",
) -> LeafOccupancy:
    return LeafOccupancy(
        unit_code=code,
        unit_name=name or code,
        shareability=shareability,
        is_family_available=is_family_available,
        placed_households=placed,
        write_in_labels=write_ins,
        container_name=container_name,
    )


def _candidate(
    session_cm_id: int,
    *leaves: LeafOccupancy,
    weekend_has_placements: bool = True,
) -> CandidateOccupancy:
    return CandidateOccupancy(
        session_cm_id=session_cm_id,
        leaves=tuple(leaves),
        weekend_has_placements=weekend_has_placements,
    )


def _verdicts(*candidates: CandidateOccupancy, household_cm_id: int = THIS_HOUSEHOLD) -> dict[int, str]:
    return {row.session_cm_id: row.verdict for row in attribution_conflicts(candidates, household_cm_id)}


class TestValueShapes:
    """§12.8.9's three value shapes. One rule, no special cases -- what changes
    between them is only how many leaves the value resolved to."""

    def test_a_single_leaf_value_conflicts_on_its_own_leaf(self) -> None:
        verdicts = _verdicts(
            _candidate(FC1, _leaf("HCU1", placed=(OTHER,))),
            _candidate(FC2, _leaf("HCU1")),
        )
        assert verdicts == {FC1: "conflict", FC2: "free"}

    def test_a_multi_unit_value_conflicts_when_any_named_unit_is_taken(self) -> None:
        """`Golden Triangle - Tioga 1and2` resolves to TWO leaves. One of them
        being held is the whole value being unavailable -- a family cannot take
        half of the pair it was written into."""
        verdicts = _verdicts(
            _candidate(FC1, _leaf("TIOGA1"), _leaf("TIOGA2", placed=(OTHER,))),
            _candidate(FC2, _leaf("TIOGA1"), _leaf("TIOGA2")),
        )
        assert verdicts == {FC1: "conflict", FC2: "free"}

    def test_a_container_value_conflicts_on_a_contained_leaf(self) -> None:
        """Owner ruling 3: *"if someone is assigned a container and another
        family has a contained leaf, i think that's likely a demote/conflict
        yes."* The VALUE names the building; the occupancy is one room."""
        clouds = [
            _leaf("CR1", container_name="Clouds Rest"),
            _leaf("CR2", container_name="Clouds Rest"),
            _leaf("CR3", container_name="Clouds Rest", placed=(OTHER,)),
            _leaf("CR4", container_name="Clouds Rest"),
        ]
        free = [_leaf(leaf.unit_code, container_name="Clouds Rest") for leaf in clouds]

        verdicts = _verdicts(_candidate(FC1, *clouds), _candidate(FC2, *free))

        assert verdicts == {FC1: "conflict", FC2: "free"}

    def test_a_placement_occupant_is_labelled_with_the_household_not_its_id(self) -> None:
        """The evidence line reads *"held by The Garcia Family"*. An id is a
        key, not something staff can check a cabin against -- and the queue
        already names households everywhere else it shows one."""
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("HCU1", name="HC Upstairs 1", placed=(OTHER,))),),
            THIS_HOUSEHOLD,
        )

        assert [(o.kind, o.label, o.leaf_name) for o in rows[0].occupants] == [
            ("placement", "The Garcia Family", "HC Upstairs 1")
        ]

    def test_a_conflicting_leaf_inside_a_container_says_which_building(self) -> None:
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("CR3", name="Room 3", container_name="Clouds Rest", placed=(OTHER,))),),
            THIS_HOUSEHOLD,
        )

        occupant = rows[0].occupants[0]
        assert occupant.leaf_code == "CR3"
        assert occupant.container_name == "Clouds Rest"


class TestWriteIns:
    """Owner ruling 4 -- *"does it also cover write ins as a conflict, not just
    family records. it should."*"""

    def test_an_unsized_write_in_conflicts_on_a_single_party_leaf(self) -> None:
        """⭐ THE REGRESSION MOST LIKELY TO BE WRITTEN BACKWARDS (§12.8.9).

        `party_size = 0` is the column's "nobody recorded a count", never
        "zero people" -- `lodging_write_ins.party_size` carries `min: 1`, so 0
        can only be the unset default. An unsized write-in occupies the unit
        WHOLESALE (kindred#2540), so the leaf is taken. Reading 0 as "takes no
        beds" reports an occupied cabin as free and PROMOTES the wrong weekend.
        """
        verdicts = _verdicts(
            _candidate(
                FC1,
                _leaf("HCU1", is_family_available=False, write_ins=("Weekend staff",)),
            ),
            _candidate(FC2, _leaf("HCU1")),
        )

        assert verdicts == {FC1: "conflict", FC2: "free"}, "an unsized write-in takes the whole unit"

    def test_a_sized_write_in_still_conflicts_on_a_single_party_leaf(self) -> None:
        """A single_party leaf holds ONE party. Beds left over do not make room
        for a second one -- that is what the shareability column means."""
        verdicts = _verdicts(_candidate(FC1, _leaf("HCU1", write_ins=("Weekend staff",))))

        assert verdicts == {FC1: "conflict"}

    def test_a_write_in_is_reported_as_the_occupant(self) -> None:
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("HCU1", name="HC Upstairs 1", write_ins=("Weekend staff",))),),
            THIS_HOUSEHOLD,
        )

        assert [(o.kind, o.label, o.leaf_code) for o in rows[0].occupants] == [
            ("write_in", "Weekend staff", "HCU1")
        ]


class TestShareable:
    """A shareable leaf takes a second party until its beds run out. Room left
    is NOT a conflict; capacity exhausted is."""

    def test_shareable_with_room_left_does_not_conflict(self) -> None:
        verdicts = _verdicts(
            _candidate(
                FC1,
                _leaf(
                    "BUNKHOUSE",
                    shareability="shareable",
                    is_family_available=True,
                    placed=(OTHER,),
                    write_ins=("Weekend staff",),
                ),
            )
        )

        assert verdicts == {FC1: "free"}

    def test_shareable_at_capacity_conflicts(self) -> None:
        """`is_family_available` is the ONE availability answer (owner rulings
        2026-08-23 / 2026-08-29, `api/services/lodging_rules.py`). False here
        means `free_family_spots` reached 0."""
        verdicts = _verdicts(
            _candidate(
                FC1,
                _leaf("BUNKHOUSE", shareability="shareable", is_family_available=False, write_ins=("Weekend staff",)),
            )
        )

        assert verdicts == {FC1: "conflict"}

    def test_an_unclassified_leaf_is_treated_as_single_party(self) -> None:
        """`unit_shareability` answers "unknown" for a column staff never set.
        A cabin nobody classified holds one party until somebody says
        otherwise -- the same direction the board's own drop rules take."""
        verdicts = _verdicts(_candidate(FC1, _leaf("MYSTERY", shareability="unknown", placed=(OTHER,))))

        assert verdicts == {FC1: "conflict"}


class TestOwnHouseholdIsNotAConflict:
    def test_this_households_own_placement_does_not_conflict(self) -> None:
        """"Taken" means taken by SOMEBODY ELSE. A household already placed in
        the cabin it was written into is the opposite of evidence against."""
        verdicts = _verdicts(_candidate(FC1, _leaf("HCU1", placed=(MINE,))))

        assert verdicts == {FC1: "free"}

    def test_this_households_own_placement_is_not_listed_as_an_occupant(self) -> None:
        rows = attribution_conflicts((_candidate(FC1, _leaf("HCU1", placed=(MINE,))),), THIS_HOUSEHOLD)

        assert rows[0].occupants == ()


class TestNoData:
    """⚠️ `no_data` means no PLACEMENTS, not no occupancy (§12.8.7)."""

    def test_a_weekend_with_no_placements_is_no_data(self) -> None:
        verdicts = _verdicts(_candidate(FC1, _leaf("HCU1"), weekend_has_placements=False))

        assert verdicts == {FC1: "no_data"}

    def test_write_ins_with_no_placements_is_still_no_data(self) -> None:
        """FC6 carries 3 write-ins and 0 placements. The write-ins make the
        weekend look non-empty; they do not make it PLANNED."""
        verdicts = _verdicts(
            _candidate(FC1, _leaf("SOMEWHERE", write_ins=("Weekend staff",)), weekend_has_placements=False),
            _candidate(FC2, _leaf("HCU1"), weekend_has_placements=False),
        )

        assert verdicts == {FC1: "conflict", FC2: "no_data"}, "a conflict outranks the no_data label"

    def test_no_data_carries_no_ranking_power(self) -> None:
        """§12.8.4's asymmetry. Only a conflict demotes; "no data" and "free"
        are both absences and neither promotes the other weekend."""
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("HCU1"), weekend_has_placements=False),
                _candidate(FC2, _leaf("HCU1")),
            ),
            THIS_HOUSEHOLD,
        )

        assert [row.verdict for row in rows] == ["no_data", "free"]
        assert conflict_aware_suggestion([FC1, FC2], rows, FC1) == FC1, "a free weekend must not outrank a no_data one"


class TestConflictAwareSuggestion:
    """`survivors = [c for c in candidates if not conflict(c)]`;
    `best = AttributeSession_rule(survivors if survivors else candidates)`.
    """

    def test_the_timestamp_pick_stands_when_it_survives(self) -> None:
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("A")), _candidate(FC2, _leaf("A", placed=(OTHER,)))),
            THIS_HOUSEHOLD,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, FC1) == FC1

    def test_a_conflicted_pick_is_demoted_to_the_survivor(self) -> None:
        """§12.8.2's worked case: the household is enrolled FC1 + FC2, the
        value is `HC Upstairs 1`, and FC1's copy is held by another household.
        """
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("HCU1", placed=(OTHER,))),
                _candidate(FC2, _leaf("HCU1")),
            ),
            THIS_HOUSEHOLD,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, FC1) == FC2

    def test_conflict_in_every_candidate_demotes_nothing(self) -> None:
        """Adopted default, §12.8.3: an all-conflict row raises an alarm about
        the VALUE rather than moving the guess to a weekend it just called
        wrong."""
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("HCU1", placed=(OTHER,))),
                _candidate(FC2, _leaf("HCU1", placed=(THIRD,))),
            ),
            THIS_HOUSEHOLD,
        )

        assert all(row.verdict == "conflict" for row in rows)
        assert conflict_aware_suggestion([FC1, FC2], rows, FC1) == FC1, "nothing survives, so nothing moves"

    def test_the_demotion_keeps_attribute_sessions_own_order(self) -> None:
        """`AttributeSession` walks candidates by START DATE ASCENDING and takes
        the FIRST at or after the value's `last_updated`. Restricted to
        survivors that is the first survivor AT OR AFTER the demoted pick --
        every earlier candidate was already rejected by the same comparison.
        """
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("A")),
                _candidate(FC2, _leaf("A", placed=(OTHER,))),
                _candidate(FC3, _leaf("A")),
            ),
            THIS_HOUSEHOLD,
        )

        assert conflict_aware_suggestion([FC1, FC2, FC3], rows, FC2) == FC3

    def test_a_demoted_last_candidate_falls_back_to_the_last_survivor(self) -> None:
        """`AttributeSession`'s own fallback arm: a value edited after every
        weekend has ended suggests the LAST one. With no survivor at or after
        the demoted pick, the same arm answers the last survivor."""
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("A")),
                _candidate(FC2, _leaf("A")),
                _candidate(FC3, _leaf("A", placed=(OTHER,))),
            ),
            THIS_HOUSEHOLD,
        )

        assert conflict_aware_suggestion([FC1, FC2, FC3], rows, FC3) == FC2

    def test_one_survivor_is_certain_even_with_no_timestamp_pick(self) -> None:
        """`AttributeSession` answers a ONE-candidate set with certainty and
        never consults `lastUpdated` -- so a set the conflict rule narrowed to
        one gets that answer even where the timestamp heuristic had none (a
        zero `last_updated` leaves `suggested_session` empty)."""
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("A", placed=(OTHER,))), _candidate(FC2, _leaf("A"))),
            THIS_HOUSEHOLD,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, None) == FC2

    def test_no_timestamp_pick_and_several_survivors_answers_nothing(self) -> None:
        """A zero `last_updated` gives `AttributeSession` no answer over ANY
        set. Inventing one here would be a SECOND heuristic wearing the first
        one's name."""
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("A")), _candidate(FC2, _leaf("A"))),
            THIS_HOUSEHOLD,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, None) is None


class TestResolveCodes:
    """`HousingNameResolver` already turns a raw cabin string into the unit it
    names; this publishes the CODES it resolved rather than only the name it
    renders, so the conflict rule expands the same resolution the queue's own
    label came from instead of making a second one."""

    @staticmethod
    def _resolver() -> HousingNameResolver:
        units = [
            RegistryUnit(unit_id="u1", code="TIOGA1", name="Tioga 1", year=2026, parent_id="gt"),
            RegistryUnit(unit_id="u2", code="TIOGA2", name="Tioga 2", year=2026, parent_id="gt"),
            RegistryUnit(unit_id="gt", code="GT", name="Golden Triangle", year=2026, parent_id=""),
            RegistryUnit(unit_id="u3", code="HCU1", name="HC Upstairs 1", year=2026, parent_id=""),
        ]
        aliases = [
            UnitAlias(
                alias_string="Golden Triangle - Tioga 1and2",
                member_unit_ids=("u1", "u2"),
                valid_from_year=0,
                valid_to_year=0,
            ),
        ]
        return HousingNameResolver.build(units, aliases)

    def test_a_direct_name_resolves_to_one_code(self) -> None:
        assert self._resolver().resolve_codes("HC Upstairs 1", 2026) == ("HCU1",)

    def test_a_multi_member_alias_resolves_to_every_member_code(self) -> None:
        assert self._resolver().resolve_codes("Golden Triangle - Tioga 1and2", 2026) == ("TIOGA1", "TIOGA2")

    def test_an_unrecognised_string_resolves_to_nothing(self) -> None:
        assert self._resolver().resolve_codes("wherever they like", 2026) == ()

    def test_the_collapsed_display_name_still_reads_the_same_resolution(self) -> None:
        """The collapse rule is unchanged: 2+ members under one parent render
        the PARENT's name. `resolve_codes` publishes the members it collapsed,
        which is what the conflict rule has to expand."""
        resolver = self._resolver()

        assert resolver.display_name("Golden Triangle - Tioga 1and2", 2026) == "Golden Triangle"
        assert resolver.resolve_codes("Golden Triangle - Tioga 1and2", 2026) == ("TIOGA1", "TIOGA2")


@pytest.mark.parametrize("household_cm_id", [THIS_HOUSEHOLD, OTHER_HOUSEHOLD])
def test_the_rule_is_total_over_an_empty_candidate_list(household_cm_id: int) -> None:
    assert attribution_conflicts((), household_cm_id) == ()
