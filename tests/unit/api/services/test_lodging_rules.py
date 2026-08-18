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

import pytest

from api.services.lodging_rules import (
    BUNKING_CSV_REQUEST_TEXT_FIELDS,
    FAMILY_CAMP_REQUEST_TEXT_CM_IDS,
    REQUEST_TEXT_SOURCES,
    HousingNameResolver,
    RegistryUnit,
    UnitAlias,
    amenity_coverage,
    container_bathroom,
    effective_bathroom,
    is_family_available,
    request_text_authorship,
    request_text_source_order,
    unit_capacity,
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
    room -- and split them. `override` is the role; `is_occupied` is the
    occupancy, read from `lodging_write_ins` rather than from the role column.
    This function is where the two meet, and the only place they do.
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
        assert is_family_available(inventory_class, override, is_occupied=False) is expected

    def test_false_is_a_decision_and_not_an_absent_override(self) -> None:
        """`False` and `None` are different answers on a family_pool unit.

        This is the assertion that stops the override being read with a falsy
        test (`if override:`), which would silently discard every closure.
        Absence means "ask the role"; False means "closed this weekend".
        """
        assert is_family_available("family_pool", False, is_occupied=False) is False
        assert is_family_available("family_pool", None, is_occupied=False) is True

    @pytest.mark.parametrize(
        ("inventory_class", "override"),
        [
            ("family_pool", None),
            ("family_pool", True),
            ("staff_default", True),  # released AND written into -- occupancy wins
            ("", None),
        ],
    )
    def test_an_occupancy_closes_the_unit_whatever_the_role_says(
        self, inventory_class: str, override: bool | None
    ) -> None:
        """kindred#2382: somebody is in it, so no family can go in it.

        The role can say "this is family inventory" as loudly as it likes; a
        cabin with an occupant cannot take a second party. Ordering it the other
        way round is a bed collision, which is the failure write-ins exist to
        prevent.
        """
        assert is_family_available(inventory_class, override, is_occupied=True) is False


class TestEffectiveBathroom:
    def test_unset_value_is_unknown_not_none(self) -> None:
        assert effective_bathroom("", "", frozenset(), frozenset({"ridge-a"})) == "unknown"

    def test_none_passes_through(self) -> None:
        assert effective_bathroom("none", "", frozenset(), frozenset({"ridge-a"})) == "none"

    def test_private_passes_through(self) -> None:
        assert effective_bathroom("private", "", frozenset(), frozenset({"hc-upstairs-5"})) == "private"

    def test_full_group_merge_upgrades_shared_to_private(self) -> None:
        """merge{Tioga 1, Tioga 2} covers the whole gt-tioga-12 group."""
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
        """merge{Upstairs 1, Upstairs 2} leaves 3 members of hc-upstairs-hall out."""
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
    short-circuits `effective_bathroom`'s exclusivity branch (line 108-109)
    before it ever runs. A party that books the whole container (the
    health-center apartments: two bedrooms over one shared bath, normally
    let whole) needs the container's input substituted from its leaves
    instead. This is that substitution, kept OUTSIDE `effective_bathroom`
    itself -- that function stays the same four-argument pure test the
    class above already pins, rather than growing a fifth argument to know
    about children it has no way to walk.
    """

    def test_leaves_sharing_one_group_inherit_shared(self) -> None:
        assert container_bathroom(frozenset({"hc-dh-bath"})) == ("shared", "hc-dh-bath")

    def test_leaves_with_no_group_inherit_nothing(self) -> None:
        assert container_bathroom(frozenset({""})) == ("none", "")

    def test_leaves_split_across_groups_inherit_nothing(self) -> None:
        """Ambiguous -- rooms that don't share one physical bathroom have no
        single answer, so the container reports exactly what its own
        registry row already says."""
        assert container_bathroom(frozenset({"group-a", "group-b"})) == ("none", "")

    def test_no_leaves_inherit_nothing(self) -> None:
        assert container_bathroom(frozenset()) == ("none", "")


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
    evidence, which `unit_capacity`, `unit_shareability` and
    `effective_bathroom` each already spell as "unknown" for the same reason.
    An unconfirmed cabin's `has_power = False` means "nobody has said", not
    "there is no power" -- the gate `rosterAttention` already applies to the
    roster's own fit check.
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
        """The same all-or-nothing evidence bar `resolvePartyUnit` applies to
        a merge: one unconfirmed room is an absence of data, not a looser
        standard for having more rooms."""
        assert amenity_coverage([True, None]) == "unknown"
        assert amenity_coverage([False, None]) == "unknown"
        assert amenity_coverage([None]) == "unknown"


class TestRequestTextSourceRegistry:
    """The five free-text bunk-request source fields, and the two excluded ones.

    kindred#2330. The registry is one ordered tuple rather than a map so the
    panel's block order is a property of the rule layer, not of whichever
    order PocketBase happened to page the rows back in.

    Measured on `pocketbase/pb_data/data-prod.db`, denominator 382 households
    rostered into one of 2026's eight family sessions (`status_id = 2`):
    `COVID-19 Bunking Requests` 205, `Share Bunk With` 104, `Shared-request`
    100, `BunkingNotes Notes` 28, `Internal Bunk Notes` 8.
    `FAM CAMP-Share Comments` is 0 for 2026 and is carried anyway -- it is one
    of the three fields the Go ingest already joins into `request_text`
    (2024-2025 only), so dropping it here would lose those years' text.
    """

    def test_the_registry_is_the_ruled_five_plus_the_dormant_share_comments(self) -> None:
        assert [source.label for source in REQUEST_TEXT_SOURCES] == [
            "COVID-19 Bunking Requests",
            "Share Bunk With",
            "Shared-request",
            "FAM CAMP-Share Comments",
            "BunkingNotes Notes",
            "Internal Bunk Notes",
        ]

    def test_family_authored_blocks_sort_ahead_of_staff_authored_ones(self) -> None:
        """An internal note must never read as a family's own ask, so the two
        staff fields land at the bottom of the panel as well as in grey."""
        authorship = [source.authorship for source in REQUEST_TEXT_SOURCES]
        assert authorship == ["family", "family", "family", "family", "staff", "staff"]

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
