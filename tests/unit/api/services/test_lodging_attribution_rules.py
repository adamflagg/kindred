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
    PlacedParty,
    RegistryUnit,
    UnitAlias,
    attribution_conflicts,
    compare_party_key,
    conflict_aware_suggestion,
)

# Fictional throughout (tests/CLAUDE.md). Household CampMinder ids are ids, not
# names, so §12.8's own worked figures are carried verbatim.
THIS_HOUSEHOLD = 7990954
OTHER_HOUSEHOLD = 10569302
THIRD_HOUSEHOLD = 8604272

# IDENTITY IS `compare_party_key`, the join key this surface already shares
# with `partyKey` in TypeScript -- so a PERSON-grain queue row (adult weekends
# place people, not households) can never match a household placement that
# happens to carry the same CampMinder integer.
MY_KEY = compare_party_key("household", THIS_HOUSEHOLD, 0, "The Johnson Family")

# The evidence line names the FAMILY, not the id -- fictional throughout.
OTHER = PlacedParty(
    party_key=compare_party_key("household", OTHER_HOUSEHOLD, 0, "The Garcia Family"),
    label="The Garcia Family",
)
THIRD = PlacedParty(
    party_key=compare_party_key("household", THIRD_HOUSEHOLD, 0, "The Chen Family"),
    label="The Chen Family",
)
MINE = PlacedParty(party_key=MY_KEY, label="The Johnson Family")

FC1 = 1000001
FC2 = 1000002
FC3 = 1000003


def _leaf(
    code: str,
    *,
    name: str = "",
    placed: tuple[PlacedParty, ...] = (),
    write_ins: tuple[str, ...] = (),
    container_name: str = "",
) -> LeafOccupancy:
    return LeafOccupancy(
        unit_code=code,
        unit_name=name or code,
        placed_parties=placed,
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


def _verdicts(*candidates: CandidateOccupancy, party_key: str = MY_KEY) -> dict[int, str]:
    return {row.session_cm_id: row.verdict for row in attribution_conflicts(candidates, party_key)}


class TestValueShapes:
    """§12.8.9's three value shapes. One rule, no special cases -- what changes
    between them is only how many leaves the value resolved to."""

    def test_a_single_leaf_value_conflicts_on_its_own_leaf(self) -> None:
        verdicts = _verdicts(
            _candidate(FC1, _leaf("maple-1", placed=(OTHER,))),
            _candidate(FC2, _leaf("maple-1")),
        )
        assert verdicts == {FC1: "conflict", FC2: "free"}

    def test_a_multi_unit_value_conflicts_when_any_named_unit_is_taken(self) -> None:
        """`Aspen Pair - Aspen 1and2` resolves to TWO leaves. One of them
        being held is the whole value being unavailable -- a family cannot take
        half of the pair it was written into."""
        verdicts = _verdicts(
            _candidate(FC1, _leaf("aspen-1"), _leaf("aspen-2", placed=(OTHER,))),
            _candidate(FC2, _leaf("aspen-1"), _leaf("aspen-2")),
        )
        assert verdicts == {FC1: "conflict", FC2: "free"}

    def test_a_container_value_conflicts_on_a_contained_leaf(self) -> None:
        """Owner ruling 3: *"if someone is assigned a container and another
        family has a contained leaf, i think that's likely a demote/conflict
        yes."* The VALUE names the building; the occupancy is one room."""
        rooms = [
            _leaf("birch-1", container_name="Birch House"),
            _leaf("birch-2", container_name="Birch House"),
            _leaf("birch-3", container_name="Birch House", placed=(OTHER,)),
            _leaf("birch-4", container_name="Birch House"),
        ]
        free = [_leaf(leaf.unit_code, container_name="Birch House") for leaf in rooms]

        verdicts = _verdicts(_candidate(FC1, *rooms), _candidate(FC2, *free))

        assert verdicts == {FC1: "conflict", FC2: "free"}

    def test_a_placement_occupant_is_labelled_with_the_household_not_its_id(self) -> None:
        """The evidence line reads *"held by The Garcia Family"*. An id is a
        key, not something staff can check a cabin against -- and the queue
        already names households everywhere else it shows one."""
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("maple-1", name="Maple Upper 1", placed=(OTHER,))),),
            MY_KEY,
        )

        assert [(o.kind, o.label, o.leaf_name) for o in rows[0].occupants] == [
            ("placement", "The Garcia Family", "Maple Upper 1")
        ]

    def test_a_conflicting_leaf_inside_a_container_says_which_building(self) -> None:
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("birch-3", name="Room 3", container_name="Birch House", placed=(OTHER,))),),
            MY_KEY,
        )

        occupant = rows[0].occupants[0]
        assert occupant.leaf_code == "birch-3"
        assert occupant.container_name == "Birch House"


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

        ⚖️ Since the 2026-09-01 presence ruling a SIZED write-in conflicts by
        the same disjunct, so there is no sized/unsized pair to keep here --
        party size is not an input to this rule at all. The service-level suite
        still pins both, where the sizes are real.
        """
        verdicts = _verdicts(
            _candidate(
                FC1,
                _leaf("maple-1", write_ins=("Weekend staff",)),
            ),
            _candidate(FC2, _leaf("maple-1")),
        )

        assert verdicts == {FC1: "conflict", FC2: "free"}, "an unsized write-in takes the whole unit"

    def test_a_write_in_is_reported_as_the_occupant(self) -> None:
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("maple-1", name="Maple Upper 1", write_ins=("Weekend staff",))),),
            MY_KEY,
        )

        assert [(o.kind, o.label, o.leaf_code) for o in rows[0].occupants] == [("write_in", "Weekend staff", "maple-1")]


class TestShareable:
    """⚖️ OWNER RULING 2026-09-01: OCCUPANCY IS PRESENCE, NOT BED ARITHMETIC.

    *"write ins and placed families matter, but for purposes of bed
    subtraction that's overkill... we don't need to perfectly hone what is
    ultimately only a suggestion change."*

    So shareability no longer gates the rule at all: another party in the leaf
    is a conflict whether the cabin could have held them both or not. The
    reason it had to change is that the previous shape could not fire on a
    shareable leaf AT ALL. It deferred capacity to `is_family_available`, whose
    own docstring says *"Placed families are NOT subtracted here"* -- so a
    shareable cabin whose beds were entirely taken by placed families read
    `free`. Measured on the 2026 snapshot: 44 of 118 units are shareable and
    **5 of the 10 open queue rows name one**, so half the live queue could
    never be demoted on placement evidence.
    """

    def test_a_placement_in_a_shareable_leaf_conflicts(self) -> None:
        """The case the old rule could not see. Beds left over do not matter:
        somebody else is already in the cabin, and that is the evidence."""
        verdicts = _verdicts(_candidate(FC1, _leaf("shared-hall", placed=(OTHER,))))

        assert verdicts == {FC1: "conflict"}

    def test_a_write_in_on_a_shareable_leaf_conflicts(self) -> None:
        verdicts = _verdicts(_candidate(FC1, _leaf("shared-hall", write_ins=("Weekend staff",))))

        assert verdicts == {FC1: "conflict"}

    def test_an_empty_shareable_leaf_is_free(self) -> None:
        """Presence is the whole rule, so an empty shareable leaf is free for
        the same reason an empty single-party one is."""
        verdicts = _verdicts(_candidate(FC1, _leaf("shared-hall")))

        assert verdicts == {FC1: "free"}


class TestOwnHouseholdIsNotAConflict:
    def test_this_households_own_placement_does_not_conflict(self) -> None:
        """ "Taken" means taken by SOMEBODY ELSE. A household already placed in
        the cabin it was written into is the opposite of evidence against."""
        verdicts = _verdicts(_candidate(FC1, _leaf("maple-1", placed=(MINE,))))

        assert verdicts == {FC1: "free"}

    def test_this_households_own_placement_is_not_listed_as_an_occupant(self) -> None:
        rows = attribution_conflicts((_candidate(FC1, _leaf("maple-1", placed=(MINE,))),), MY_KEY)

        assert rows[0].occupants == ()


class TestNoData:
    """⚠️ `no_data` means no PLACEMENTS, not no occupancy (§12.8.7)."""

    def test_a_weekend_with_no_placements_is_no_data(self) -> None:
        verdicts = _verdicts(_candidate(FC1, _leaf("maple-1"), weekend_has_placements=False))

        assert verdicts == {FC1: "no_data"}

    def test_write_ins_with_no_placements_is_still_no_data(self) -> None:
        """FC6 carries 3 write-ins and 0 placements. The write-ins make the
        weekend look non-empty; they do not make it PLANNED."""
        verdicts = _verdicts(
            _candidate(FC1, _leaf("unit-x", write_ins=("Weekend staff",)), weekend_has_placements=False),
            _candidate(FC2, _leaf("maple-1"), weekend_has_placements=False),
        )

        assert verdicts == {FC1: "conflict", FC2: "no_data"}, "a conflict outranks the no_data label"

    def test_no_data_carries_no_ranking_power(self) -> None:
        """§12.8.4's asymmetry. Only a conflict demotes; "no data" and "free"
        are both absences and neither promotes the other weekend."""
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("maple-1"), weekend_has_placements=False),
                _candidate(FC2, _leaf("maple-1")),
            ),
            MY_KEY,
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
            MY_KEY,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, FC1) == FC1

    def test_a_conflicted_pick_is_demoted_to_the_survivor(self) -> None:
        """§12.8.2's worked case: the household is enrolled FC1 + FC2, the
        value is `Maple Upper 1`, and FC1's copy is held by another household.
        """
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("maple-1", placed=(OTHER,))),
                _candidate(FC2, _leaf("maple-1")),
            ),
            MY_KEY,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, FC1) == FC2

    def test_conflict_in_every_candidate_demotes_nothing(self) -> None:
        """Adopted default, §12.8.3: an all-conflict row raises an alarm about
        the VALUE rather than moving the guess to a weekend it just called
        wrong."""
        rows = attribution_conflicts(
            (
                _candidate(FC1, _leaf("maple-1", placed=(OTHER,))),
                _candidate(FC2, _leaf("maple-1", placed=(THIRD,))),
            ),
            MY_KEY,
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
            MY_KEY,
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
            MY_KEY,
        )

        assert conflict_aware_suggestion([FC1, FC2, FC3], rows, FC3) == FC2

    def test_one_survivor_is_certain_even_with_no_timestamp_pick(self) -> None:
        """`AttributeSession` answers a ONE-candidate set with certainty and
        never consults `lastUpdated` -- so a set the conflict rule narrowed to
        one gets that answer even where the timestamp heuristic had none (a
        zero `last_updated` leaves `suggested_session` empty)."""
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("A", placed=(OTHER,))), _candidate(FC2, _leaf("A"))),
            MY_KEY,
        )

        assert conflict_aware_suggestion([FC1, FC2], rows, None) == FC2

    def test_no_timestamp_pick_and_several_survivors_answers_nothing(self) -> None:
        """A zero `last_updated` gives `AttributeSession` no answer over ANY
        set. Inventing one here would be a SECOND heuristic wearing the first
        one's name."""
        rows = attribution_conflicts(
            (_candidate(FC1, _leaf("A")), _candidate(FC2, _leaf("A"))),
            MY_KEY,
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
            RegistryUnit(unit_id="u1", code="aspen-1", name="Aspen 1", year=2026, parent_id="up"),
            RegistryUnit(unit_id="u2", code="aspen-2", name="Aspen 2", year=2026, parent_id="up"),
            RegistryUnit(unit_id="up", code="aspen-pair", name="Aspen Pair", year=2026, parent_id=""),
            RegistryUnit(unit_id="u3", code="maple-1", name="Maple Upper 1", year=2026, parent_id=""),
        ]
        aliases = [
            UnitAlias(
                alias_string="Aspen Pair - Aspen 1and2",
                member_unit_ids=("u1", "u2"),
                valid_from_year=0,
                valid_to_year=0,
            ),
        ]
        return HousingNameResolver.build(units, aliases)

    def test_a_direct_name_resolves_to_one_code(self) -> None:
        assert self._resolver().resolve_codes("Maple Upper 1", 2026) == ("maple-1",)

    def test_a_multi_member_alias_resolves_to_every_member_code(self) -> None:
        assert self._resolver().resolve_codes("Aspen Pair - Aspen 1and2", 2026) == ("aspen-1", "aspen-2")

    def test_an_unrecognised_string_resolves_to_nothing(self) -> None:
        assert self._resolver().resolve_codes("wherever they like", 2026) == ()

    def test_the_collapsed_display_name_still_reads_the_same_resolution(self) -> None:
        """The collapse rule is unchanged: 2+ members under one parent render
        the PARENT's name. `resolve_codes` publishes the members it collapsed,
        which is what the conflict rule has to expand."""
        resolver = self._resolver()

        assert resolver.display_name("Aspen Pair - Aspen 1and2", 2026) == "Aspen Pair"
        assert resolver.resolve_codes("Aspen Pair - Aspen 1and2", 2026) == ("aspen-1", "aspen-2")


@pytest.mark.parametrize("party_key", [MY_KEY, "household-999"])
def test_the_rule_is_total_over_an_empty_candidate_list(party_key: str) -> None:
    assert attribution_conflicts((), party_key) == ()


def test_a_person_grain_row_does_not_match_a_household_with_the_same_id() -> None:
    """`ambiguous_session` is filed at BOTH grains -- family camp places
    households, adult weekends place people -- and the two id spaces are
    unrelated. Comparing bare integers would let an adult's own queue row read
    a same-numbered household's placement as its own and call a taken cabin
    free."""
    same_number = PlacedParty(
        party_key=compare_party_key("household", THIS_HOUSEHOLD, 0, "The Garcia Family"),
        label="The Garcia Family",
    )
    person_key = compare_party_key("person", 0, THIS_HOUSEHOLD, "Riley Sam")

    verdicts = {
        row.session_cm_id: row.verdict
        for row in attribution_conflicts((_candidate(FC1, _leaf("maple-1", placed=(same_number,))),), person_key)
    }

    assert verdicts == {FC1: "conflict"}
