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

from types import SimpleNamespace
from typing import ClassVar

import pytest

from api.services.lodging_rules import (
    BUNKING_CSV_REQUEST_TEXT_FIELDS,
    FAMILY_CAMP_REQUEST_TEXT_CM_IDS,
    REQUEST_TEXT_SOURCES,
    HousingNameResolver,
    PushRow,
    RegistryUnit,
    UnitAlias,
    WriteInDemand,
    WriteInLoad,
    amenity_coverage,
    classify_push,
    container_bathroom,
    effective_bathroom,
    free_family_spots,
    is_family_available,
    push_building_key,
    push_digest,
    ramp_coverage,
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
    unanswered, so the boolean callers pass no `None` today at all -- the arm
    is `ramp_coverage`'s, whose select genuinely can be blank -- but the
    all-or-nothing rule is pinned below because both share this shape.
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


class TestRampCoverage:
    """kindred#2438. The step-free twin of `amenity_coverage`, and the reason
    it is a separate function rather than a call into that one: `has_ramp` is a
    THREE-VALUE select, so a room can answer "qualified" and no boolean grain
    has anywhere to put that.

    Migration 1500000131 made it a select on purpose -- "a bool maps every
    unassessed cabin to false, which asserts 'no ramp' about cabins nobody has
    looked at". The production distribution is 104 blank / 4 `no` / 5 `partial`
    / 5 `yes`; a bool read reports 0 of 118 and erases all 14 assessments.

    Five grades, worst-known first: `none` < `partial` < `some` < `all`, plus
    `unknown` for the absence of evidence.
    """

    def test_every_room_step_free_is_all(self) -> None:
        assert ramp_coverage(["yes", "yes"]) == "all"

    def test_every_room_refused_is_none(self) -> None:
        assert ramp_coverage(["no", "no"]) == "none"

    def test_a_mixed_set_is_some(self) -> None:
        assert ramp_coverage(["yes", "no"]) == "some"
        assert ramp_coverage(["yes", "partial"]) == "some"

    def test_qualified_without_a_full_yes_is_partial(self) -> None:
        """The grade a boolean amenity has no room for, and the one that must
        NOT collapse into `none`: three of the five production `partial` units
        carry the ramp qualifier in `notes`, which is the record of somebody
        having gone and looked."""
        assert ramp_coverage(["partial"]) == "partial"
        assert ramp_coverage(["partial", "no"]) == "partial"

    def test_partial_is_not_some(self) -> None:
        """`some` says at least one room IS step-free, which invites the
        placement that lands in one of the others. `partial` says none is, and
        the two are different claims."""
        assert ramp_coverage(["partial", "partial"]) != "some"

    def test_blank_is_unknown_never_none(self) -> None:
        """104 of 118 production units are blank. Reading blank as `no` marks
        almost the whole registry step-free-hostile on evidence nobody
        recorded -- the exact inversion the select exists to prevent."""
        assert ramp_coverage([None]) == "unknown"
        assert ramp_coverage(["yes", None]) == "unknown"
        assert ramp_coverage(["no", None]) == "unknown"

    def test_nothing_to_judge_is_unknown(self) -> None:
        assert ramp_coverage([]) == "unknown"


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
        assert write_in_demand(15, []) == WriteInDemand(consumed=0, sized=0, known=True)

    def test_an_own_sized_cover_consumes_its_size(self) -> None:
        loads = [WriteInLoad("own", 2, 15)]
        assert write_in_demand(15, loads) == WriteInDemand(consumed=2, sized=2, known=True)

    def test_an_unsized_cover_consumes_the_unit_it_names_but_is_not_sized(self) -> None:
        """The wholesale fallback: `null` means "occupies the room", which is
        what the card's em dash has always asserted. It reaches `consumed` and
        must never reach `sized`."""
        loads = [WriteInLoad("own", None, 15)]
        assert write_in_demand(15, loads) == WriteInDemand(consumed=15, sized=0, known=False)

    def test_descendants_consume_their_own_capacity_not_the_card_s(self) -> None:
        """A combined house whose four rooms are each written into. Each room
        contributes ITS spots, not the house's."""
        loads = [
            WriteInLoad("descendant", None, 3),
            WriteInLoad("descendant", None, 1),
            WriteInLoad("descendant", None, 2),
            WriteInLoad("descendant", None, 2),
        ]
        assert write_in_demand(8, loads) == WriteInDemand(consumed=8, sized=0, known=False)

    def test_a_mixture_sums_both_ways_and_is_not_known(self) -> None:
        """One room counted, three not. `consumed` is exact enough to place
        against; `known` is false because a partial count is a lower bound, and
        kindred#2528's rule is that a count which is not a fact supports no
        claim."""
        loads = [
            WriteInLoad("descendant", 2, 3),
            WriteInLoad("descendant", None, 1),
            WriteInLoad("descendant", None, 2),
            WriteInLoad("descendant", None, 2),
        ]
        assert write_in_demand(8, loads) == WriteInDemand(consumed=7, sized=2, known=False)

    def test_an_ancestor_takes_the_whole_card_and_contributes_no_sized_people(self) -> None:
        """A house written into whole, then split. Each room is inside a house
        somebody has taken, so neither is separately lettable -- but the
        house's size is a fact about the HOUSE, and printing it on both rooms
        would spend one two-person party twice on one screen.

        `known` is TRUE: "the whole card is taken" is a fact, unlike a
        wholesale guess about a room that may be shared.
        """
        assert write_in_demand(4, [WriteInLoad("ancestor", 2, 7)]) == WriteInDemand(consumed=4, sized=0, known=True)

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
        assert forward == backward == WriteInDemand(consumed=4, sized=0, known=True)

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
        assert demand == WriteInDemand(consumed=8, sized=0, known=False)

    def test_unknown_card_capacity_is_never_known(self) -> None:
        assert write_in_demand(None, [WriteInLoad("own", 2, None)]).known is False

    def test_sized_survives_an_unknown_card_capacity(self) -> None:
        """A human-recorded count is a fact whether or not the card itself is
        measured. A cabin nobody has measured, holding a two-person write-in,
        must print 2/-, not -/- -- no capacity guard may discard a count
        somebody actually wrote down."""
        assert write_in_demand(None, [WriteInLoad("own", 2, None)]).sized == 2


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
