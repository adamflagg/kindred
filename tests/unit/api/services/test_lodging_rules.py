"""Pure lodging rules. These encode three facts that are invisible in the schema.

1. sleeps = 0 means UNKNOWN. PocketBase number columns are
   `NUMERIC DEFAULT 0 NOT NULL`, so an unset number stores as 0, never NULL.
2. Family availability is a two-input table (base default x per-session
   override), not a single flag.
3. private-vs-shared bathroom depends on merge state, so merging can itself
   satisfy a medical bathroom request.

The share gate, the NEAR/WITH modes and the request text are NOT here: the Go
ingest derives them into typed columns and this surface reads those. See the
module docstring of api/services/lodging_rules.py for why re-parsing them in
Python would regress two fixes that live only on the Go side.
"""

import itertools
from types import SimpleNamespace
from typing import ClassVar, get_args

import pytest

from api.schemas.lodging import AmenityCoverage
from api.services import lodging_rules
from api.services.lodging_rules import (
    BUNKING_CSV_REQUEST_TEXT_FIELDS,
    FAMILY_CAMP_REQUEST_TEXT_CM_IDS,
    REQUEST_TEXT_SOURCES,
    ComparePartyPlacement,
    HousingNameResolver,
    PushRow,
    RegistryUnit,
    UnitAlias,
    WriteInDemand,
    WriteInLoad,
    amenity_coverage,
    classify_push,
    compare_party_key,
    compare_placements,
    container_bathroom,
    effective_bathroom,
    free_family_spots,
    is_family_available,
    push_building_key,
    push_digest,
    request_text_authorship,
    request_text_source_order,
    unit_capacity,
    write_in_demand,
)


class TestUnitCapacity:
    def test_zero_means_unknown_not_zero_beds(self) -> None:
        assert unit_capacity(0) is None

    def test_none_means_unknown(self) -> None:
        assert unit_capacity(None) is None

    def test_negative_is_treated_as_unknown(self) -> None:
        assert unit_capacity(-3) is None

    def test_positive_passes_through(self) -> None:
        assert unit_capacity(8) == 8


class TestIsFamilyAvailable:
    """TWO QUESTIONS, and the override answers only one of them.

    1500000135 deleted availability's scenario dimension and collapsed the
    three-value `state` enum to one boolean. The three values were REASONS, not
    states: each only meant anything read against the unit's role, so
    `released_to_family` on a family_pool unit was storable and meaningless.

    kindred#2382 then found that the surviving boolean was still carrying two
    unrelated facts -- the staff<->family ROLE and whether somebody is IN the
    room -- and split them. `override` is the role; `free` is how many beds are
    left once the write-ins covering the unit are paid for, resolved by
    `free_family_spots` from the occupancy source rather than from the role
    column. This function is where the two meet, and the only place they do.
    """

    @pytest.mark.parametrize(
        ("inventory_class", "override", "expected"),
        [
            ("family_pool", None, True),
            ("family_pool", False, False),  # closed by role
            ("family_pool", True, True),  # redundant but harmless
            ("staff_default", None, False),
            ("staff_default", True, True),  # released for this weekend
            ("staff_default", False, False),
            # An admin-created unit with no explicit role stores "". Treated as
            # family_pool so it is at least visible; the roster reports the gap
            # separately via RosterCounts.units_missing_allocation.
            ("", None, True),
            ("", False, False),
        ],
    )
    def test_the_override_wins_and_the_role_decides_without_one(
        self, inventory_class: str, override: bool | None, expected: bool
    ) -> None:
        assert is_family_available(inventory_class, override, free=None) is expected

    def test_false_is_a_decision_and_not_an_absent_override(self) -> None:
        """`False` and `None` are different answers on a family_pool unit.

        This is the assertion that stops the override being read with a falsy
        test (`if override:`), which would silently discard every closure.
        Absence means "ask the role"; False means "closed this weekend".
        """
        assert is_family_available("family_pool", False, free=None) is False
        assert is_family_available("family_pool", None, free=None) is True

    @pytest.mark.parametrize(
        ("inventory_class", "override"),
        [
            ("family_pool", None),
            ("family_pool", True),
            ("staff_default", True),  # released AND fully taken -- occupancy wins
            ("", None),
        ],
    )
    def test_no_free_beds_closes_the_unit_whatever_the_role_says(
        self, inventory_class: str, override: bool | None
    ) -> None:
        assert is_family_available(inventory_class, override, free=0) is False

    def test_a_write_in_smaller_than_the_cabin_leaves_it_available(self) -> None:
        """THE REVERSAL, and it is deliberate. This function used to say
        "OCCUPANCY IS ABSOLUTE"; kindred#2432 struck that by making a
        written-into cabin take a family like any other, and the drop refusal
        came out of `dragPlacement.ts` with it. The stats bar has disagreed
        with the board it sits above ever since.

        A fifteen-bed cabin. Two people written in leaves thirteen, and the
        board will accept a family in them.
        """
        assert is_family_available("family_pool", None, free=13) is True

    def test_none_free_means_no_occupancy_and_not_unmeasured(self) -> None:
        """`None` mirrors `override: None` -- "there is no row, ask the role".
        An unmeasured cabin that somebody IS written into resolves to 0 in
        `free_family_spots`, never to None."""
        assert is_family_available("family_pool", None, free=None) is True
        assert is_family_available("staff_default", None, free=None) is False


class TestEffectiveBathroom:
    def test_unset_value_is_unknown_not_none(self) -> None:
        assert effective_bathroom("", "", frozenset(), frozenset({"ridge-a"})) == "unknown"

    def test_none_passes_through(self) -> None:
        assert effective_bathroom("none", "", frozenset(), frozenset({"ridge-a"})) == "none"

    def test_private_passes_through(self) -> None:
        assert effective_bathroom("private", "", frozenset(), frozenset({"hc-upstairs-5"})) == "private"

    def test_full_group_merge_upgrades_shared_to_private(self) -> None:
        """Merging both members of a two-room bathroom group upgrades the
        group's shared bathroom to private."""
        assert (
            effective_bathroom(
                "shared",
                "gt-tioga-12",
                frozenset({"gt-tioga-1", "gt-tioga-2"}),
                frozenset({"gt-tioga-1", "gt-tioga-2"}),
            )
            == "private"
        )

    def test_partial_group_merge_stays_shared(self) -> None:
        """Merging two of a five-room bathroom group's members leaves the
        other three out, so the group stays shared."""
        assert (
            effective_bathroom(
                "shared",
                "hc-upstairs-hall",
                frozenset({"hc-upstairs-1", "hc-upstairs-2", "hc-upstairs-3", "hc-upstairs-4", "hc-upstairs-6"}),
                frozenset({"hc-upstairs-1", "hc-upstairs-2"}),
            )
            == "shared"
        )

    def test_shared_without_a_group_stays_shared(self) -> None:
        assert effective_bathroom("shared", "", frozenset(), frozenset({"x"})) == "shared"


class TestContainerBathroom:
    """kindred#2022's second gap. All 15 registry containers store
    bathroom = "none" on their own row -- a building is not a room -- which
    short-circuits `effective_bathroom`'s exclusivity branch before it ever
    runs. A party that books the whole container needs the container's input
    substituted from its leaves instead. This is that substitution, kept
    OUTSIDE `effective_bathroom` itself -- that function stays the same
    four-argument pure test the class above already pins.

    ⚠️ THIS TAKES THE LEAVES' (bathroom, group) PAIRS, NOT BARE GROUP IDS.
    Grading on group identity alone cannot see whether any leaf actually HAS
    a bathroom, and the registry contains one group whose members all record
    "none" while sitting beside a bathhouse -- so identity-only grading
    answered "private" for a whole-let of rooms with no bathroom in them,
    on a need that is asked for medical reasons. The pairs are what close it.
    """

    def test_leaves_sharing_one_group_inherit_shared(self) -> None:
        assert container_bathroom(frozenset({("shared", "grp-a"), ("shared", "grp-a")})) == (
            "shared",
            "grp-a",
        )

    def test_leaves_with_no_group_inherit_nothing(self) -> None:
        assert container_bathroom(frozenset({("shared", "")})) == ("none", "")

    def test_leaves_split_across_groups_inherit_nothing(self) -> None:
        """Ambiguous -- rooms that don't share one physical bathroom have no
        single answer, so the container reports exactly what its own
        registry row already says.

        ⚠️ This is a FALSE NEGATIVE that is deliberately preserved: four
        registry buildings whose every room has a bathroom report "none"
        because their rooms span two groups. Widening it is a redefinition
        of what "this building has a bathroom" means and is gated on an
        owner ruling, so it is pinned here rather than fixed silently.
        """
        assert container_bathroom(frozenset({("shared", "grp-a"), ("shared", "grp-b")})) == (
            "none",
            "",
        )

    def test_no_leaves_inherit_nothing(self) -> None:
        assert container_bathroom(frozenset()) == ("none", "")

    def test_leaves_agreeing_on_a_group_but_recording_no_bathroom_inherit_nothing(self) -> None:
        """THE BATHHOUSE FALSE POSITIVE, and the reason this function takes
        pairs.

        A two-room building whose rooms both record `bathroom = "none"` while
        sharing one non-empty group: the rooms walk to a bathhouse, and the
        group names that bathhouse rather than a bathroom inside either room.
        Grading on group identity alone returned ("shared", group), which
        `effective_bathroom` then upgraded to "private" for a whole-let --
        a GREEN verdict on a medical in-cabin bathroom request for two rooms
        with no bathroom in them. A group is only inheritable when some leaf
        behind it actually has a bathroom.
        """
        assert container_bathroom(frozenset({("none", "grp-bathhouse")})) == ("none", "")

    def test_one_leaf_with_a_bathroom_carries_the_shared_group(self) -> None:
        """The mixed case: not every room needs its own bathroom for the
        group to be real -- one is enough, because the group is what they
        physically share."""
        assert container_bathroom(frozenset({("none", "grp-a"), ("shared", "grp-a")})) == (
            "shared",
            "grp-a",
        )


class TestAmenityCoverage:
    """kindred#1912. A container's stored amenity flags describe the
    CONTAINER, not its rooms -- the same shape as the settled
    "a container's `sleeps` is a delta" ruling, on a different column. In the
    2026 registry twelve of the fourteen family-pool containers record
    `has_power = 0` while every leaf beneath them has power, so reading a
    container's own flag marks twelve entirely-powered buildings unpowered.

    The grain is three-valued rather than boolean because both boolean
    policies fall out of it for free (`OR == state != "none"`,
    `AND == state == "all"`), so a per-criterion policy map would be a strict
    subset that costs more to build.

    `None` is the fourth answer and it is not a grain: it is the ABSENCE of
    an answer, which `unit_capacity`, `unit_shareability` and
    `effective_bathroom` each already spell as "unknown" for the same reason.

    ⚠️ AN UNCONFIRMED ROW IS NOT ONE (kindred#2526). `_resolve_amenity_coverage`
    used to map one to `None` here; registry values are read at face value now
    and `is_confirmed` is a staff work-down checklist. A bool cannot be
    unanswered, so no caller passes one today at all -- `ramp_coverage`, the
    five-grade twin whose select genuinely could be blank, was DELETED by
    kindred#2327. The all-or-nothing rule is pinned below anyway: the arm is
    the contract this function states about missing evidence, not an artefact
    of the one caller that used to reach it.
    """

    def test_every_source_has_it(self) -> None:
        assert amenity_coverage([True, True, True]) == "all"

    def test_no_source_has_it(self) -> None:
        assert amenity_coverage([False, False]) == "none"

    def test_a_mixed_set_is_some(self) -> None:
        assert amenity_coverage([True, False, True]) == "some"

    def test_a_single_source_answers_for_itself(self) -> None:
        """A leaf has no descendants, so it is its own one-element set."""
        assert amenity_coverage([True]) == "all"
        assert amenity_coverage([False]) == "none"

    def test_nothing_to_judge_is_unknown(self) -> None:
        """Never "none": marking a slot we cannot see as unmet asserts a fact
        about it, and the mark this feeds exists to state a fact."""
        assert amenity_coverage([]) == "unknown"

    def test_one_unmeasured_source_makes_the_whole_answer_unknown(self) -> None:
        """One room that gave NO answer withholds the whole verdict, rather
        than the slot being graded on the rooms that did answer -- a looser
        bar would grade a building on the strength of the rooms somebody got
        to. (The room is unmeasured, NOT merely unreconfirmed: kindred#2526
        stopped confirmation producing a `None` here.)"""
        assert amenity_coverage([True, None]) == "unknown"
        assert amenity_coverage([False, None]) == "unknown"
        assert amenity_coverage([None]) == "unknown"


class TestRampCoverageIsDeleted:
    """kindred#2327. `ramp_coverage()` and its `RampCoverage` vocabulary are
    GONE, and this pins the deletion rather than leaving it to be re-added by
    somebody reading kindred#2438's argument without kindred#2327's ruling.

    The step-free grade is graded from `is_accessible` through
    `amenity_coverage` above, the same bool grain that serves power, AC and
    fridge. That takes `partial` and `unknown` out in ONE move: a bool has no
    third value to hold "a ramp with a lip", and a bool cannot be unanswered.

    ⚠️ THIS SUPERSEDES kindred#2502, which deliberately moved the grade the
    other way. Owner ruling, 2026-08-30: *"we just need to know what is in fact
    accessible."* Safe because `is_accessible = 1` is a STRICT SUBSET of
    `has_ramp = 'yes'` on the 2026 snapshot -- 0 rows accessible without a
    ramp -- so the swap can only NARROW a ramp assessment and can never promise
    a wheelchair user access a ramp assessment denies.

    `has_ramp` itself STAYS STORED (no destructive migration over 14 real staff
    assessments); nothing reads it into a verdict any more.
    """

    def test_the_five_grade_grader_is_gone(self) -> None:
        assert not hasattr(lodging_rules, "ramp_coverage")

    def test_the_bool_grain_is_the_only_coverage_grader_left(self) -> None:
        """`amenity_coverage` never returns `partial`, on any input it can be
        handed. The step-free dimension has no grade of its own now.

        ⚠️ THIS EXERCISES THE FUNCTION, NOT A CONSTANT BESIDE IT. An earlier
        version of this test asserted only
        `set(AMENITY_COVERAGE_VALUES) == {...}` -- a module-level literal tuple
        compared against itself, which `amenity_coverage` does not consult and
        no production code reads. It passed with the grader returning
        `"partial"`, so it pinned the deletion it was written to pin exactly not
        at all. The domain below is EXHAUSTIVE over what a caller can hand this
        function: every room answers `True`, `False` or `None`, and
        `_resolve_amenity_coverage` passes at most one entry per answering leaf.
        """
        domain: list[bool | None] = [True, False, None]
        seen: set[str] = set()
        for length in range(4):
            for combo in itertools.product(domain, repeat=length):
                grade = amenity_coverage(list(combo))
                assert grade != "partial", f"{combo!r} graded partial"
                assert grade in lodging_rules.AMENITY_COVERAGE_VALUES, f"{combo!r} -> {grade!r}"
                seen.add(grade)

        # ...and all four grades are genuinely reachable, so the assertion
        # above is not passing merely because the domain is too narrow.
        assert seen == {"all", "some", "none", "unknown"}

    def test_the_wire_vocabulary_matches_the_grader(self) -> None:
        """The CONTRACT the frontend generates its union from. `AmenityCoverage`
        in `api/schemas/lodging.py` is what reaches `types.gen.ts`, and
        `ramp_coverage` is typed as it since kindred#2327 -- so re-widening it
        to hold `partial` again would put a fifth grade back on the wire that
        this module can no longer produce."""
        assert set(get_args(AmenityCoverage)) == set(lodging_rules.AMENITY_COVERAGE_VALUES)
        assert "partial" not in get_args(AmenityCoverage)


class TestRequestTextSourceRegistry:
    """The six free-text bunk-request source fields, in the block order staff
    put in front of the panel (kindred#2476, owner ruling 2026-08-21).

    kindred#2330. The registry is one ordered tuple rather than a map so the
    panel's block order is a property of the rule layer, not of whichever
    order PocketBase happened to page the rows back in.

    Measured on `pocketbase/pb_data/data-prod.db`, denominator 479 households
    rostered into a 2026 family-camp registration:
    `COVID-19 Bunking Requests` 238, `Share Bunk With` 234, `Shared-request`
    114, `BunkingNotes Notes` 111, `Internal Bunk Notes` 10.
    `FAM CAMP-Share Comments` is 0 for 2026 and is carried anyway -- it is one
    of the three fields the Go ingest already joins into `request_text`
    (2024-2025 only), so dropping it here would lose those years' text.
    """

    def test_the_registry_order_is_what_staff_asked_for(self) -> None:
        """kindred#2476: `Share Bunk With` moves from position 2 to position 6
        by owner ruling, NOT by measuring the columns. On 2026 family-camp
        households it is the SECOND MOST POPULATED of the six blocks (234 of
        479) -- ahead of `Shared-request` (114) and `FAM CAMP-Share Comments`
        (0) -- yet staff put it last. The order is what staff asked for; it
        must not be re-derived from volume (or from authorship -- see the
        next test) by a later reader who measures the columns and "corrects"
        it back."""
        # Owner ruling 2026-08-23, after the form-label correction: the
        # REGISTRATION-form box (`Shared-request`, written in the radio's
        # sitting) renders FIRST, ahead of the Information form's names box
        # (`COVID-19 Bunking Requests`). Under the earlier backwards labels
        # the old order merely LOOKED reg-first; this pin makes it real.
        assert [source.label for source in REQUEST_TEXT_SOURCES] == [
            "Shared-request",
            "COVID-19 Bunking Requests",
            "FAM CAMP-Share Comments",
            "BunkingNotes Notes",
            "Internal Bunk Notes",
            "Share Bunk With",
        ]

    def test_the_order_is_staff_specified_not_authorship_derived(self) -> None:
        """kindred#2476 deliberately retires the older invariant that every
        family-authored block sorts ahead of every staff-authored one --
        `Share Bunk With` is family-authored and now sorts after both staff
        notes. The OLD rationale was authorship (an internal note must never
        read as a family's own ask); the ordering ruling replaces it with a
        staff-specified order that is not derived from authorship, and must
        not be re-derived from authorship by a later reader who notices this
        no longer sorts family-before-staff."""
        authorship = [source.authorship for source in REQUEST_TEXT_SOURCES]
        assert authorship == ["family", "family", "family", "staff", "staff", "family"]

    def test_the_two_staff_authored_fields_are_the_bunking_csv_notes(self) -> None:
        """All 34 `BunkingNotes` values end in an inline staff signature and
        timestamp; no parent-authored field does."""
        staff = {source.label for source in REQUEST_TEXT_SOURCES if source.authorship == "staff"}
        assert staff == {"BunkingNotes Notes", "Internal Bunk Notes"}

    def test_every_storage_key_maps_onto_exactly_one_registered_label(self) -> None:
        """The two lanes are keyed differently -- the family-camp lane by
        CampMinder custom-field id, the bunking CSV by its own column slug --
        and a label in one map with no row in the registry would render as an
        unordered block at the end of the panel."""
        labels = [source.label for source in REQUEST_TEXT_SOURCES]
        mapped = list(FAMILY_CAMP_REQUEST_TEXT_CM_IDS.values()) + list(BUNKING_CSV_REQUEST_TEXT_FIELDS.values())
        assert sorted(mapped) == sorted(labels)
        assert len(labels) == len(set(labels))

    def test_socialize_with_is_not_free_text_and_is_absent(self) -> None:
        """`RetParent-Socializewithbest` has exactly two distinct values in
        2026, both 40 characters, and `requestBucket.ts` already classes it
        immaterial. 107 rostered households carry one."""
        assert "RetParent-Socializewithbest" not in BUNKING_CSV_REQUEST_TEXT_FIELDS.values()
        assert "socialize_with" not in BUNKING_CSV_REQUEST_TEXT_FIELDS

    def test_the_sixth_candidate_field_is_deliberately_excluded(self) -> None:
        """`Do Not Share Bunk With` (3 rostered households) travels the same
        code path, and the 2026-08-17 owner ruling did not name it. Silence is
        not a yes -- adding it is one line here plus one entry below."""
        assert "Do Not Share Bunk With" not in [source.label for source in REQUEST_TEXT_SOURCES]
        assert "staff_not_bunk_with" not in BUNKING_CSV_REQUEST_TEXT_FIELDS

    def test_source_order_is_total_over_the_registry(self) -> None:
        positions = [request_text_source_order(source.label) for source in REQUEST_TEXT_SOURCES]
        assert positions == sorted(positions)
        assert len(set(positions)) == len(positions)

    def test_an_unregistered_label_sorts_last_rather_than_raising(self) -> None:
        """A render path never raises on one unexpected row -- see
        `safeSourceFromField`, which takes the same position on the TS side."""
        assert request_text_source_order("Some Field We Have Never Seen") > max(
            request_text_source_order(source.label) for source in REQUEST_TEXT_SOURCES
        )

    def test_an_unregistered_label_is_attributed_to_nobody_in_particular(self) -> None:
        """`family` is the WRONG default for an unknown field: it would render
        a staff note in the amber treatment reserved for a family's own ask."""
        assert request_text_authorship("Some Field We Have Never Seen") == "staff"


def _unit(unit_id: str, code: str, name: str, *, year: int = 2026, parent_id: str = "") -> RegistryUnit:
    return RegistryUnit(unit_id=unit_id, code=code, name=name, year=year, parent_id=parent_id)


def _alias(alias_string: str, *member_ids: str, valid_from: int = 0, valid_to: int = 0) -> UnitAlias:
    return UnitAlias(
        alias_string=alias_string,
        member_unit_ids=tuple(member_ids),
        valid_from_year=valid_from,
        valid_to_year=valid_to,
    )


class TestHousingNameResolver:
    """kindred#2332: a prior year's housing renders in TODAY's language.

    Owner ruling 2026-08-18: *"the last year housing should use the same
    language via the alias year over year concept so it appears in current
    language."* The alias's year window says which raw string was in use WHEN;
    it is an input to FINDING the unit, never to NAMING it. Once the unit is
    identified, its present-day `lodging_units.name` renders.
    """

    def test_a_blank_string_stays_blank(self) -> None:
        assert HousingNameResolver.build([], []).display_name("", 2025) == ""

    def test_a_string_that_already_names_a_unit_resolves_without_an_alias(self) -> None:
        resolver = HousingNameResolver.build([_unit("u1", "cedar-1", "Cedar Lodge 1")], [])

        assert resolver.display_name("cedar lodge 1", 2023) == "Cedar Lodge 1"

    def test_the_unit_code_resolves_too(self) -> None:
        resolver = HousingNameResolver.build([_unit("u1", "cedar-1", "Cedar Lodge 1")], [])

        assert resolver.display_name("cedar-1", 2023) == "Cedar Lodge 1"

    def test_a_renamed_unit_renders_its_current_name_not_the_historical_string(self) -> None:
        """THE RULING, in one test. `Old Meadow 1` is what staff typed in
        2022; the unit is called `Meadow House 1` today, so that is what a
        2022 row shows.
        """
        resolver = HousingNameResolver.build(
            [_unit("u1", "meadow-1", "Meadow House 1")],
            [_alias("Old Meadow 1", "u1")],
        )

        assert resolver.display_name("Old Meadow 1", 2022) == "Meadow House 1"

    def test_an_alias_is_windowed_at_the_rows_own_year_not_the_registry_year(self) -> None:
        """`valid_to_year = 2024` is correct for the years it covers. Windowing
        every alias at the registry's loaded year would discard it -- 1,792 of
        1,861 rows instead of 1,841 on the production snapshot.
        """
        resolver = HousingNameResolver.build(
            [_unit("u1", "meadow-1", "Meadow House 1")],
            [_alias("Old Meadow 1", "u1", valid_to=2024)],
        )

        assert resolver.display_name("Old Meadow 1", 2023) == "Meadow House 1"
        assert resolver.display_name("Old Meadow 1", 2026) == "Old Meadow 1"

    def test_two_members_under_one_parent_collapse_to_the_parents_name(self) -> None:
        """THE COLLAPSE RULE. Joining member names gives up to 35 characters --
        longer than the 34-character worst raw string, on a `whitespace-nowrap`
        span. Every multi-member alias in use shares one container parent.
        """
        resolver = HousingNameResolver.build(
            [
                _unit("p1", "cedar", "Cedar Lodge"),
                _unit("u1", "cedar-1", "Cedar Lodge Room 1", parent_id="p1"),
                _unit("u2", "cedar-2", "Cedar Lodge Room 2", parent_id="p1"),
            ],
            [_alias("Cedar 1and2", "u1", "u2")],
        )

        assert resolver.display_name("Cedar 1and2", 2023) == "Cedar Lodge"

    def test_members_with_no_shared_parent_join_rather_than_inventing_one(self) -> None:
        """No production row reaches this branch -- all seven in-use
        multi-member aliases share one parent -- but the rule stays total.
        """
        resolver = HousingNameResolver.build(
            [_unit("u1", "cedar-1", "Cedar Lodge 1"), _unit("u2", "pine-1", "Pine Cabin 1")],
            [_alias("Cedar 1 and Pine 1", "u1", "u2")],
        )

        assert resolver.display_name("Cedar 1 and Pine 1", 2023) == "Cedar Lodge 1 + Pine Cabin 1"

    def test_two_alias_rows_covering_one_year_refuse_rather_than_guess(self) -> None:
        """The unique index is on (alias_string, valid_from_year), not on
        alias_string alone, so the admin UI can create an overlapping pair.
        `AliasResolver.Resolve` calls that `Ambiguous` and places nobody.
        """
        resolver = HousingNameResolver.build(
            [_unit("u1", "cedar-1", "Cedar Lodge 1"), _unit("u2", "pine-1", "Pine Cabin 1")],
            [_alias("Overlap", "u1", valid_from=2020), _alias("Overlap", "u2", valid_from=2021)],
        )

        assert resolver.display_name("Overlap", 2023) == "Overlap"

    def test_a_member_missing_from_the_registry_year_is_all_or_nothing(self) -> None:
        """Go's `Resolve` refuses on the same door: returning the members that
        DO exist would silently shrink a family's rooms.
        """
        resolver = HousingNameResolver.build(
            [
                _unit("p1", "cedar", "Cedar Lodge"),
                _unit("u1", "cedar-1", "Cedar Lodge Room 1", parent_id="p1"),
            ],
            [_alias("Cedar 1and2", "u1", "u9")],
        )

        assert resolver.display_name("Cedar 1and2", 2023) == "Cedar 1and2"

    def test_an_unresolvable_string_renders_unchanged(self) -> None:
        """Three of the 88 distinct strings name a unit FAMILY and not a unit
        (kindred#2392). What staff wrote is better than nothing.
        """
        resolver = HousingNameResolver.build([_unit("u1", "cedar-1", "Cedar Lodge 1")], [])

        assert resolver.display_name("Ridge 2", 2022) == "Ridge 2"

    def test_the_registry_year_is_the_latest_season_the_table_holds(self) -> None:
        """`lodging_units` is a year-scoped table that today holds 2026 only.
        A stale season's row must not become the display name.
        """
        resolver = HousingNameResolver.build(
            # Current season FIRST, so an index that merely takes the last row
            # per code -- rather than filtering to the registry year -- ends up
            # holding the stale one and this test still catches it.
            [
                _unit("new", "cedar-1", "Cedar Lodge 1", year=2026),
                _unit("old", "cedar-1", "Old Cedar 1", year=2025),
            ],
            [_alias("Old Cedar 1", "old")],
        )

        assert resolver.registry_year == 2026
        assert resolver.display_name("Old Cedar 1", 2022) == "Cedar Lodge 1"

    def test_inner_spacing_stays_significant_and_outer_does_not(self) -> None:
        """`aliasLookupKey` in Go lowercases and trims and does no more: one
        seeded string genuinely carries a double space before its separator.
        """
        resolver = HousingNameResolver.build(
            [_unit("u1", "cedar-1", "Cedar Lodge 1")],
            [_alias("Cedar  Lodge - 1", "u1")],
        )

        assert resolver.display_name("  cedar  lodge - 1  ", 2023) == "Cedar Lodge 1"
        assert resolver.display_name("Cedar Lodge - 1", 2023) == "Cedar Lodge - 1"

    def test_an_empty_registry_leaves_every_string_alone(self) -> None:
        """A fresh deployment seeds no units. Rendering nothing, or rendering
        a blank, would be worse than rendering what staff wrote.
        """
        resolver = HousingNameResolver.build([], [])

        assert resolver.registry_year == 0
        assert resolver.display_name("Cedar Lodge - Room 2", 2025) == "Cedar Lodge - Room 2"

    def test_two_units_answering_to_one_name_defer_to_the_alias_table(self) -> None:
        """A direct name collision is an ACCIDENT; an alias row is a staff
        mapping. `build` refuses to pick between the two colliding units, and
        `display_name` then treats that refusal exactly as it treats a key no
        unit answers to -- so the alias still gets its say, and the raw string
        renders only when it fails too.
        """
        collide = [_unit("u1", "cedar-1", "Cedar Lodge 1"), _unit("u2", "c2", "cedar lodge 1")]
        resolver = HousingNameResolver.build(
            [*collide, _unit("u3", "pine-1", "Pine Cabin 1")],
            [_alias("Cedar Lodge 1", "u3")],
        )

        assert resolver.display_name("Cedar Lodge 1", 2023) == "Pine Cabin 1"

    def test_a_name_two_units_answer_to_renders_unchanged_with_no_alias(self) -> None:
        """The other half of the same rule: with nothing to defer TO, naming
        either colliding unit would name a cabin nobody chose.
        """
        resolver = HousingNameResolver.build(
            [_unit("u1", "cedar-1", "Cedar Lodge 1"), _unit("u2", "c2", "cedar lodge 1")],
            [],
        )

        assert resolver.display_name("Cedar Lodge 1", 2023) == "Cedar Lodge 1"


class TestWriteInDemand:
    """How many spots the write-ins covering one card take, and how many of
    those the board actually knows about.

    TWO SUMS, and collapsing them is the mistake this class exists to stop.
    `consumed` includes the WHOLESALE fallback for a row with no count, because
    such a row still asserts somebody is in the space. `sized` includes only
    counts a human recorded, because it is what the card's numerator prints and
    a numerator must never state a headcount nobody wrote down -- that is the
    whole reason the em dash exists.

    They differ on every production row today: all 24 are unsized.
    """

    def test_no_covers_is_no_demand(self) -> None:
        assert write_in_demand(15, []) == WriteInDemand(consumed=0, sized=0, known=True, usable=True)

    def test_an_own_sized_cover_consumes_its_size(self) -> None:
        loads = [WriteInLoad("own", 2, 15)]
        assert write_in_demand(15, loads) == WriteInDemand(consumed=2, sized=2, known=True, usable=True)

    def test_an_unsized_cover_consumes_the_unit_it_names_but_is_not_sized(self) -> None:
        """The wholesale fallback: `null` means "occupies the room", which is
        what the card's em dash has always asserted. It reaches `consumed` and
        must never reach `sized`."""
        loads = [WriteInLoad("own", None, 15)]
        assert write_in_demand(15, loads) == WriteInDemand(consumed=15, sized=0, known=False, usable=True)

    def test_descendants_consume_their_own_capacity_not_the_card_s(self) -> None:
        """A combined house whose four rooms are each written into. Each room
        contributes ITS spots, not the house's."""
        loads = [
            WriteInLoad("descendant", None, 3),
            WriteInLoad("descendant", None, 1),
            WriteInLoad("descendant", None, 2),
            WriteInLoad("descendant", None, 2),
        ]
        assert write_in_demand(8, loads) == WriteInDemand(consumed=8, sized=0, known=False, usable=True)

    def test_a_mixture_sums_both_ways_and_is_not_known(self) -> None:
        """One room counted, three not. `known` is false because nobody sized
        every party -- but `usable` is true, and since kindred#2543 that is
        what the board's own marks read: 7 is a FLOOR on what the write-ins
        take, so 1 free is a number both surfaces may state.

        This docstring used to end *"`known` still gates the Assign modal,
        which states facts rather than floors"*, and that stopped being true
        inside kindred#2543's own review: the owner extended the ruling to the
        modal (*"sure modal can follow the floor, roll that fix in as well"*),
        so its header and its candidate rows read `usable` too and `known`
        gates nothing in production."""
        loads = [
            WriteInLoad("descendant", 2, 3),
            WriteInLoad("descendant", None, 1),
            WriteInLoad("descendant", None, 2),
            WriteInLoad("descendant", None, 2),
        ]
        assert write_in_demand(8, loads) == WriteInDemand(consumed=7, sized=2, known=False, usable=True)

    def test_an_ancestor_takes_the_whole_card_and_contributes_no_sized_people(self) -> None:
        """A house written into whole, then split. Each room is inside a house
        somebody has taken, so neither is separately lettable -- but the
        house's size is a fact about the HOUSE, and printing it on both rooms
        would spend one two-person party twice on one screen.

        `known` is TRUE: "the whole card is taken" is a fact, unlike a
        wholesale guess about a room that may be shared.
        """
        assert write_in_demand(4, [WriteInLoad("ancestor", 2, 7)]) == WriteInDemand(
            consumed=4, sized=0, known=True, usable=True
        )

    def test_an_ancestor_answers_the_same_regardless_of_load_order(self) -> None:
        """Fix-round finding, reviewer-verified repro: the ancestor branch
        used to return whatever the loop had accumulated from covers seen
        EARLIER in the list. An unsized descendant before the ancestor set
        `known = False` before the loop ever reached the ancestor's early
        return; the same descendant placed AFTER the ancestor never got a
        chance to run, so `known` stayed `True`. Same set of loads, two
        different answers on the one field (`known`) that a hoisted `sized`
        computation does not by itself make order-independent -- the ancestor
        check has to be a pre-pass over `loads`, not a fact the per-cover loop
        happens to preserve, so the order cannot matter."""
        unsized_descendant = WriteInLoad("descendant", None, 3)
        ancestor = WriteInLoad("ancestor", 2, 7)
        forward = write_in_demand(4, [unsized_descendant, ancestor])
        backward = write_in_demand(4, [ancestor, unsized_descendant])
        assert forward == backward == WriteInDemand(consumed=4, sized=0, known=True, usable=True)

    def test_an_unmeasured_card_is_not_known_even_with_an_ancestor_cover(self) -> None:
        """An ancestor cover only tells you the whole card is taken, not how
        big the card is -- a capacity nobody measured stays unknown even with
        an ancestor cover asserting occupancy.

        NAMED FOR THE GUARD IT ACTUALLY PINS, which is the unmeasured-capacity
        return above the ancestor branch, not the branch. It cannot be made to
        bite on the branch: reaching the branch requires `capacity is not
        None`, so the branch's `known` could never be False there, and its old
        `known=capacity is not None` was dead-code-equivalent to True. The
        behaviour under test is real and unchanged -- only the claim about
        WHERE it is decided was wrong.
        """
        assert write_in_demand(None, [WriteInLoad("ancestor", 2, 7)]).known is False

    def test_an_ancestor_on_a_measured_card_is_known(self) -> None:
        """The other side of the same guard, and the case the branch really
        owns: capacity is a fact, so the whole-card claim is one too."""
        assert write_in_demand(4, [WriteInLoad("ancestor", 2, 7)]).known is True

    def test_consumption_is_capped_at_the_card(self) -> None:
        """A hand-typed count above the cabin's spots is over capacity, which is
        a real state the card reddens -- but it cannot take MORE spots than
        exist, or a container's arithmetic would go negative. `sized` is NOT
        capped the same way: kindred#2503's over-capacity red needs the true
        recorded count, so the numerator must show 9, not a clipped 4."""
        demand = write_in_demand(4, [WriteInLoad("own", 9, 4)])
        assert demand.consumed == 4
        assert demand.sized == 9

    def test_an_unbounded_wholesale_claim_takes_everything(self) -> None:
        """An unsized cover on a unit nobody measured cannot be bounded, so
        nothing on this card is offerable."""
        demand = write_in_demand(8, [WriteInLoad("descendant", None, None)])
        assert demand == WriteInDemand(consumed=8, sized=0, known=False, usable=True)

    def test_unknown_card_capacity_is_never_known(self) -> None:
        assert write_in_demand(None, [WriteInLoad("own", 2, None)]).known is False

    def test_sized_survives_an_unknown_card_capacity(self) -> None:
        """A human-recorded count is a fact whether or not the card itself is
        measured. A cabin nobody has measured, holding a two-person write-in,
        must print 2/-, not -/- -- no capacity guard may discard a count
        somebody actually wrote down."""
        assert write_in_demand(None, [WriteInLoad("own", 2, None)]).sized == 2

    # ------------------------------------------------------------------
    # `usable` -- kindred#2543, owner ruling 2026-08-29.
    #
    # `known=False` MEANS THREE DIFFERENT THINGS, and only one of them makes
    # `consumed` meaningless. `known` answers "did somebody size every party";
    # `usable` answers "is `consumed` a number you may PUBLISH". The card was
    # reading the first to decide the second, which is why the stats bar
    # published a remainder the board declined to claim.
    #
    #   1. nobody measured the card      -> consumed is 0 and meaningless
    #   2. an unsized cover on an unmeasured LEAF -> consumed is the whole card
    #   3. an unsized cover on a measured leaf    -> consumed is a real FLOOR
    #
    # Only (1) withholds. (2) and (3) both publish, because a party cannot
    # exceed the leaf it sleeps in: the remainder can only understate
    # availability, never overstate it.
    # ------------------------------------------------------------------

    def test_a_partly_sized_card_is_not_known_but_its_consumption_is_usable(self) -> None:
        """CASE 3, and the case this ruling exists for. A container of 10, one
        cover sized at 2, one unsized cover on a measured room of 3. Nobody
        sized every party, so `known` is false -- but 5 is a FLOOR on what the
        write-ins take, because the unsized party cannot be bigger than the
        room it is sleeping in. The card may print that floor, and must,
        because it is the number the stats bar already publishes.
        """
        loads = [WriteInLoad("descendant", 2, 3), WriteInLoad("descendant", None, 3)]
        demand = write_in_demand(10, loads)
        assert demand.consumed == 5
        assert demand.known is False
        assert demand.usable is True

    def test_an_unbounded_wholesale_claim_is_still_usable(self) -> None:
        """CASE 2. An unsized cover on a leaf nobody measured takes the whole
        card, which is a bound rather than a guess: `consumed == capacity`
        leaves nothing, and 0 free is exactly what `free_family_spots`
        publishes. The card agrees with it instead of going quiet.
        """
        demand = write_in_demand(8, [WriteInLoad("descendant", None, None)])
        assert demand.consumed == 8
        assert demand.known is False
        assert demand.usable is True

    def test_an_unmeasured_card_is_the_one_thing_that_is_not_usable(self) -> None:
        """CASE 1, and the trap. `consumed` is returned as 0 there and means
        nothing at all -- there was no capacity to subtract it from. A card
        that read `usable` as "not `known`" would offer an unmeasured cabin
        somebody is written into as wholly free, which is the defect
        `free_family_spots`' `capacity is None` branch exists to stop.
        """
        assert write_in_demand(None, [WriteInLoad("own", 2, None)]).usable is False
        assert write_in_demand(None, [WriteInLoad("own", None, 3)]).usable is False
        assert write_in_demand(None, [WriteInLoad("ancestor", 2, 7)]).usable is False

    def test_an_uncovered_card_is_usable_only_once_somebody_has_measured_it(self) -> None:
        """`known` is vacuously TRUE with no covers -- there is no unsized
        party to spoil it -- and that is true whether or not anybody has
        measured the card. `usable` must not inherit that: `writeInDemand(null,
        [])` answering "yes, publish 0" is how an unmeasured, uncovered room
        would read as a known zero. The card used to fold `capacityKnown` back
        in by hand for exactly this; the rule now answers it itself.
        """
        assert write_in_demand(None, []).known is True
        assert write_in_demand(None, []).usable is False
        assert write_in_demand(15, []).usable is True

    def test_usable_is_exactly_whether_the_card_was_measured(self) -> None:
        """The whole rule, over every branch: `consumed` is publishable if and
        only if there was a capacity to subtract it from. Stated once here so
        a new branch that makes `consumed` meaningless again has to break this
        test rather than a caller's re-derivation of it.
        """
        shapes = [
            [],
            [WriteInLoad("own", 2, 15)],
            [WriteInLoad("own", None, 15)],
            [WriteInLoad("own", None, None)],
            [WriteInLoad("ancestor", 2, 7)],
            [WriteInLoad("descendant", 2, 3), WriteInLoad("descendant", None, 3)],
            [WriteInLoad("descendant", None, None), WriteInLoad("descendant", 2, 3)],
        ]
        for loads in shapes:
            assert write_in_demand(9, loads).usable is True, loads
            assert write_in_demand(None, loads).usable is False, loads


class TestFreeFamilySpots:
    """THREE returns, and the middle one is the one this design nearly shipped
    without.

    `None` reads as "no occupancy at all", mirroring how `override: None`
    already reads as "no row" in `is_family_available`. It does NOT mean
    unmeasured: an unmeasured cabin somebody is written into must CLOSE, or a
    cabin with a person in it is reported as an open space -- the exact defect
    this change exists to fix, in a different disguise.
    """

    def test_no_covers_is_no_occupancy(self) -> None:
        assert free_family_spots(15, []) is None

    def test_covered_and_unmeasurable_is_closed(self) -> None:
        assert free_family_spots(None, [WriteInLoad("own", 2, None)]) == 0

    def test_a_sized_write_in_leaves_the_remainder(self) -> None:
        """A fifteen-spot cabin; two people written in leaves thirteen. Since
        kindred#2432 the board will accept a family there, so the bar must
        agree with it."""
        assert free_family_spots(15, [WriteInLoad("own", 2, 15)]) == 13

    def test_a_wholesale_write_in_leaves_nothing(self) -> None:
        assert free_family_spots(15, [WriteInLoad("own", None, 15)]) == 0

    def test_a_fully_covered_house_leaves_nothing(self) -> None:
        loads = [
            WriteInLoad("descendant", None, 3),
            WriteInLoad("descendant", None, 1),
            WriteInLoad("descendant", None, 2),
            WriteInLoad("descendant", None, 2),
        ]
        assert free_family_spots(8, loads) == 0

    def test_a_partly_covered_house_keeps_the_rest(self) -> None:
        """Owner ruling 2026-08-20: a room-level write-in does not make the
        rest of the house unavailable."""
        assert free_family_spots(8, [WriteInLoad("descendant", None, 3)]) == 5

    def test_the_remainder_it_publishes_is_the_one_the_card_may_claim(self) -> None:
        """kindred#2543, owner ruling 2026-08-29: *"it should subsume its leaf
        as it does today, but also reflect that in the stats bar."*

        THE DIVERGENCE THIS PAIR USED TO CARRY IS GONE. This function has
        always turned a partly-sized card's `consumed` into a remainder while
        the board withheld any claim about the same card, because the board
        gated on `known`. The card now gates on `usable`, so the two surfaces
        state one number.

        `known` IS STILL NOT READ HERE and must not be (owner ruling
        2026-08-23) -- the card moved toward this function, not the reverse.
        """
        loads = [WriteInLoad("descendant", 2, 3), WriteInLoad("descendant", None, 3)]
        demand = write_in_demand(10, loads)
        assert demand.known is False
        assert demand.usable is True
        assert free_family_spots(10, loads) == 10 - demand.consumed == 5


def _push_unit(id, code, name=None, container=False, parent=""):
    return SimpleNamespace(id=id, code=code, name=name or code, is_container=container, parent_unit=parent, sleeps=4)


def _push_row(unit_id, code, occ, note="", ppl=None, sleeps=4, name=None):
    return PushRow(
        unit_id=unit_id,
        unit_code=code,
        unit_name=name or code,
        occupant_name=occ,
        note=note,
        party_size=ppl,
        sleeps=sleeps,
    )


class TestPushBuildingKey:
    def test_container_is_its_own_key(self):
        units = [
            _push_unit("u1", "big-house", container=True, parent="u0"),
            _push_unit("u0", "grouping", container=True),
        ]
        by_code = {u.code: u for u in units}
        assert push_building_key(units[0], by_code) == "big-house"

    def test_leaf_keys_to_immediate_parent_not_root(self):
        units = [
            _push_unit("u0", "top", container=True),
            _push_unit("u1", "mid", container=True, parent="u0"),
            _push_unit("u2", "room-1", parent="u1"),
        ]
        by_code = {u.code: u for u in units}
        # classify_push resolves parent PB id -> code before calling this;
        # here the test passes the resolved shape the classifier builds.
        assert push_building_key(units[2], by_code, parent_code="mid") == "mid"

    def test_orphan_leaf_is_its_own_key(self):
        u = _push_unit("u9", "lone-cabin")
        assert push_building_key(u, {"lone-cabin": u}, parent_code="") == "lone-cabin"


class TestClassifyPush:
    UNITS: ClassVar[list[SimpleNamespace]] = [
        _push_unit("uh", "big-house", container=True),
        _push_unit("u1", "room-1", parent="uh"),
        _push_unit("u2", "room-2", parent="uh"),
        _push_unit("uc", "cedar-9"),
    ]

    def test_whole_house_draft_groups_with_room_live_rows_as_one_conflict(self):
        live = [_push_row("u1", "room-1", "R. Okafor"), _push_row("u2", "room-2", "M. Diaz")]
        draft = [_push_row("uh", "big-house", "Woodson family", ppl=6)]
        out = classify_push(live, draft, self.UNITS)
        assert [b.cls for b in out] == ["conflict"]
        assert out[0].key == "big-house"

    def test_multiset_equality_is_match(self):
        live = [_push_row("u1", "room-1", "A. Chen"), _push_row("u2", "room-2", "T. Nguyen")]
        draft = [_push_row("u2", "room-2", "T. Nguyen"), _push_row("u1", "room-1", "A. Chen")]
        assert [b.cls for b in classify_push(live, draft, self.UNITS)] == ["match"]

    def test_null_vs_sized_people_is_a_conflict(self):
        live = [_push_row("uc", "cedar-9", "B. Tran", ppl=None)]
        draft = [_push_row("uc", "cedar-9", "B. Tran", ppl=2)]
        assert [b.cls for b in classify_push(live, draft, self.UNITS)] == ["conflict"]

    def test_trim_only_normalisation(self):
        live = [_push_row("uc", "cedar-9", "  E. Sandoval  ")]
        draft = [_push_row("uc", "cedar-9", "E. Sandoval")]
        assert [b.cls for b in classify_push(live, draft, self.UNITS)] == ["match"]
        draft2 = [_push_row("uc", "cedar-9", "e. sandoval")]  # case differs: conflict
        assert [b.cls for b in classify_push(live, draft2, self.UNITS)] == ["conflict"]

    def test_add_and_remove(self):
        live = [_push_row("uc", "cedar-9", "K. Sato")]
        out = classify_push(live, [], self.UNITS)
        assert [b.cls for b in out] == ["remove"]
        out2 = classify_push([], live, self.UNITS)
        assert [b.cls for b in out2] == ["add"]

    def test_none_vs_int_party_size_with_shared_prefix_does_not_crash(self):
        """kindred#2477 fix-round: two same-side rows on one building sharing
        (unit_id, occupant, note) but differing only in party_size -- one
        None, one recorded -- crashed the multiset comparison. Plain
        `sorted()` over `tuple_key()` reaches the fourth element only when
        the first three already tie, and Python 3 refuses `int < NoneType`
        there. Repro: `sorted([('u1','N','',None), ('u1','N','',5)])`."""
        live = [
            _push_row("uc", "cedar-9", "Same Name", ppl=None),
            _push_row("uc", "cedar-9", "Same Name", ppl=5),
        ]
        draft = [_push_row("uc", "cedar-9", "Same Name", ppl=5)]
        out = classify_push(live, draft, self.UNITS)
        assert [b.cls for b in out] == ["conflict"]
        assert push_digest(out)  # must not raise either


class TestPushDigest:
    def test_stable_across_row_order(self):
        # 2+ rows per side, sharing one building, including the mixed
        # None/int party_size shape that exercises the new sort key.
        units = [
            _push_unit("uh", "big-house", container=True),
            _push_unit("u1", "room-1", parent="uh"),
            _push_unit("u2", "room-2", parent="uh"),
        ]
        live = [
            _push_row("u1", "room-1", "A", ppl=None),
            _push_row("u2", "room-2", "B", ppl=5),
        ]
        draft = [
            _push_row("u1", "room-1", "A", ppl=2),
            _push_row("u2", "room-2", "C", ppl=None),
        ]
        a = classify_push(live, draft, units)
        b = classify_push(list(reversed(live)), list(reversed(draft)), units)
        assert push_digest(a) == push_digest(b)

    def test_changes_when_a_tuple_changes(self):
        u = [_push_unit("uc", "cedar-9")]
        a = classify_push([], [_push_row("uc", "cedar-9", "A", ppl=None)], u)
        b = classify_push([], [_push_row("uc", "cedar-9", "A", ppl=2)], u)
        assert push_digest(a) != push_digest(b)


# --------------------------------------------------- scenario-vs-mirror compare
#
# kindred#2478 §5. Unit codes here are invented (`alpha-1`, `beta-2`) rather
# than sampled from the registry -- scripts/dev/verify-no-hardcoded-lodging.sh
# scans tests too.


def _compare_side(cm_id, name, codes=(), label="", grain="household", person_cm_id=0):
    codes = tuple(codes)
    return ComparePartyPlacement(
        grain=grain,
        household_cm_id=cm_id,
        person_cm_id=person_cm_id,
        display_name=name,
        unit_codes=codes,
        unit_label=label or " + ".join(codes),
    )


class TestComparePlacements:
    """The RULED placement predicate (kindred#2478 §5.2): grain is the enrolled
    party, compared on the EXACT unit set, in `classify_push`'s own four-word
    vocabulary (§5.3)."""

    def test_identical_unit_set_is_a_placed_match(self):
        mirror = [_compare_side(11, "The Alvarez Family", ["alpha-1"])]
        scenario = [_compare_side(11, "The Alvarez Family", ["alpha-1"])]
        out = compare_placements(mirror, scenario)
        assert [(v.cls, v.both_unassigned) for v in out] == [("match", False)]

    def test_both_unassigned_is_a_match_flagged_apart(self):
        """§5.4: "both unassigned" is agreement, but not the same KIND of
        agreement as a placed match -- lumping them hides a barely-worked
        scenario behind a green number. Same `cls`, separate flag."""
        mirror = [_compare_side(12, "The Bhatt Family")]
        scenario = [_compare_side(12, "The Bhatt Family")]
        out = compare_placements(mirror, scenario)
        assert [(v.cls, v.both_unassigned) for v in out] == [("match", True)]

    def test_different_unit_is_a_conflict(self):
        mirror = [_compare_side(13, "The Castellano Family", ["alpha-1"])]
        scenario = [_compare_side(13, "The Castellano Family", ["beta-2"])]
        out = compare_placements(mirror, scenario)
        assert [(v.cls, v.both_unassigned) for v in out] == [("conflict", False)]
        assert out[0].mirror_unit_codes == ("alpha-1",)
        assert out[0].scenario_unit_codes == ("beta-2",)

    def test_a_multi_room_difference_is_a_conflict_not_a_match(self):
        """Owner ruling, §5.2: the comparison is on the EXACT unit set. No
        building-level tolerance -- two rooms against one of the same two is a
        conflict, and it is the only rule in §5 with no judgement in it."""
        mirror = [_compare_side(14, "The Duarte Family", ["alpha-1"])]
        scenario = [_compare_side(14, "The Duarte Family", ["alpha-1", "alpha-2"])]
        out = compare_placements(mirror, scenario)
        assert [v.cls for v in out] == ["conflict"]

    def test_the_same_multi_room_set_in_a_different_order_is_a_match(self):
        """SET equality, not sequence equality: `units` is a relation whose
        stored order is a fact about how the row was written, not about where
        the family sleeps."""
        mirror = [_compare_side(15, "The Eze Family", ["alpha-2", "alpha-1"])]
        scenario = [_compare_side(15, "The Eze Family", ["alpha-1", "alpha-2"])]
        out = compare_placements(mirror, scenario)
        assert [(v.cls, v.both_unassigned) for v in out] == [("match", False)]

    def test_placed_only_in_the_scenario_is_an_add(self):
        mirror = [_compare_side(16, "The Fontaine Family")]
        scenario = [_compare_side(16, "The Fontaine Family", ["alpha-1"])]
        assert [v.cls for v in compare_placements(mirror, scenario)] == ["add"]

    def test_placed_only_in_campminder_is_a_remove(self):
        mirror = [_compare_side(17, "The Grigoryan Family", ["alpha-1"])]
        scenario = [_compare_side(17, "The Grigoryan Family")]
        assert [v.cls for v in compare_placements(mirror, scenario)] == ["remove"]

    def test_unresolved_households_keying_on_zero_stay_separate_rows(self):
        """🚨 kindred#2478 §5.5's landmine, in Python. The roster service emits
        `household_cm_id = 0` for a household whose record failed to resolve,
        so two of them collide on the id alone and `display_name` is the only
        thing left to separate them. Keyed on the id alone this returns ONE
        verdict for two families -- and whichever one lost would silently
        inherit the other's cabin.

        THIS IS THE HALF THE NAME CAN SEPARATE: a household record that exists
        and carries no `cm_id` still has its own `mailing_title`. The half it
        cannot is pinned by the test below."""
        mirror = [
            _compare_side(0, "Unresolved household A", ["alpha-1"]),
            _compare_side(0, "Unresolved household B"),
        ]
        scenario = [
            _compare_side(0, "Unresolved household A", ["alpha-1"]),
            _compare_side(0, "Unresolved household B", ["beta-2"]),
        ]
        out = compare_placements(mirror, scenario)
        assert len(out) == 2
        assert [(v.display_name, v.cls) for v in out] == [
            ("Unresolved household A", "match"),
            ("Unresolved household B", "add"),
        ]

    def test_two_households_with_no_record_at_all_collapse_and_that_is_pinned(self):
        """The residue the test above does NOT cover, pinned rather than fixed.

        The case above is a household RECORD that exists with no `cm_id` -- it
        still has a `mailing_title`, so the name separates it. Where the record
        is missing entirely the roster names EVERY such party "Household 0"
        (`_household_display_name(None, 0)`), so the name separates nothing and
        two of them share one key.

        What that costs is one row and one tick of `both_unassigned`, never a
        wrong cabin: `placement_by_household` is keyed on the same 0, so both
        sides read both parties as unplaced. Pinned here so the next reader
        finds the residue in a test rather than in production, in the same
        spirit `_last_token`'s wrong answer is pinned in the roster service.
        Removing it means giving `RosterParty` a real identity across every
        weekend surface -- a decision, not a follow-up.
        """
        side = [
            _compare_side(0, "Household 0"),
            _compare_side(0, "Household 0"),
        ]
        out = compare_placements(side, side)
        assert len(out) == 1
        assert (out[0].cls, out[0].both_unassigned) == ("match", True)

    def test_person_grain_and_household_grain_never_collide(self):
        mirror = [
            _compare_side(0, "P. Nakamura", ["alpha-1"], grain="person", person_cm_id=91),
            _compare_side(91, "The Nakamura Family", ["beta-2"]),
        ]
        out = compare_placements(mirror, mirror)
        assert len(out) == 2
        assert {v.key for v in out} == {"person-91", "household-91"}

    def test_rows_follow_the_scenario_order_then_mirror_only_parties(self):
        """The scenario side is the roster's own order -- already filed on
        `sort_name` -- so the modal lists families the way the board does
        rather than in a second order of this classifier's invention."""
        mirror = [
            _compare_side(22, "The Rojas Family", ["alpha-1"]),
            _compare_side(21, "The Quintero Family"),
            _compare_side(23, "The Sorenson Family", ["beta-2"]),
        ]
        scenario = [
            _compare_side(21, "The Quintero Family"),
            _compare_side(22, "The Rojas Family", ["alpha-1"]),
        ]
        out = compare_placements(mirror, scenario)
        assert [v.household_cm_id for v in out] == [21, 22, 23]
        assert out[2].cls == "remove"

    def test_the_display_label_of_each_side_is_carried_through(self):
        mirror = [_compare_side(31, "The Terzian Family", ["alpha-1"], label="Alpha 1")]
        scenario = [_compare_side(31, "The Terzian Family", ["alpha-1", "alpha-2"], label="Alpha 1 + Alpha 2")]
        out = compare_placements(mirror, scenario)
        assert out[0].mirror_unit_label == "Alpha 1"
        assert out[0].scenario_unit_label == "Alpha 1 + Alpha 2"


class TestComparePartyKey:
    """The Python half of `frontend/src/components/weekend/partyKey.ts`'s rule,
    spelled the same way on purpose (kindred#2478 §5.5)."""

    def test_falls_through_zero_to_the_grain_that_is_set(self):
        assert compare_party_key("person", 0, 91, "P. Nakamura") == "person-91"
        assert compare_party_key("household", 44, 0, "The Ubeda Family") == "household-44"

    def test_falls_through_to_the_display_name_when_both_ids_are_zero(self):
        assert compare_party_key("household", 0, 0, "Unresolved household A") == ("household-Unresolved household A")
