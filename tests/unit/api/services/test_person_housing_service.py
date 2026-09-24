"""PersonHousingService -- the adult camper journey's server read."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.lodging import PersonHousingResponse, PersonHousingWeekend
from api.services.person_housing_service import PersonHousingService

PERSON = 3000001
WW = 1001


def _repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_person_cabin_values": [],
        "fetch_person_adult_attendees": [],
        "fetch_person_teen_assignments": [],
        # kindred#2775: the guest's live CampMinder-layer rows, 2026 onward.
        # Empty by default: 0 person-grain rows exist on the snapshot yet.
        "fetch_person_live_assignments": [],
        "fetch_all_units": [],
        "fetch_unit_aliases": [],
    }
    defaults.update(overrides)
    for method, value in defaults.items():
        setattr(repo, method, AsyncMock(return_value=value))
    return repo


def _cabin_row(year: int, raw: str, last_updated: str, field_cm_id: int = 223823) -> SimpleNamespace:
    return SimpleNamespace(
        year=year, value=raw, last_updated=last_updated, expand={"field_definition": SimpleNamespace(cm_id=field_cm_id)}
    )


def _attendee_row(year: int, session_cm_id: int, end_date: str) -> SimpleNamespace:
    return SimpleNamespace(year=year, expand={"session": SimpleNamespace(cm_id=session_cm_id, end_date=end_date)})


def _teen_row(year: int, session_cm_id: int, session_type: str, bunk: str) -> SimpleNamespace:
    return SimpleNamespace(
        year=year,
        expand={
            "session": SimpleNamespace(cm_id=session_cm_id, session_type=session_type),
            "bunk": SimpleNamespace(name=bunk),
        },
    )


SCIT = 2001
TLI = 2002

# One registry unit and the alias that maps a teen program's 2025 bunk string
# onto it -- the same alias layer every other historical cabin resolves through.
_TEEN_UNIT = SimpleNamespace(id="u9", code="teen-village-2", name="Village Cabin 2", year=2026, parent_unit="")
_TEEN_ALIAS = SimpleNamespace(alias_string="Teen 2", member_units=["u9"], valid_from_year=0, valid_to_year=0)


class TestPersonHousingService:
    @pytest.mark.asyncio
    async def test_publishes_one_row_per_attributed_weekend(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2024, "River F", "2024-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(
            person_cm_id=PERSON,
            weekends=[
                PersonHousingWeekend(year=2024, session_cm_id=WW, cabin_name="River F", cabin_name_raw="River F")
            ],
        )

    @pytest.mark.asyncio
    async def test_a_field_outside_the_allowlist_never_reaches_the_response(self) -> None:
        """Defense in depth behind the repository's allowlist."""
        repo = _repo(
            fetch_person_cabin_values=[
                _cabin_row(
                    2024, "Summer Camp - Position: Counselor - Total Salary: 2000", "2024-10-01T00:00:00+00:00", 34148
                ),
                _cabin_row(2024, "Not a cabin", "2024-10-02T00:00:00+00:00", 209082),
                _cabin_row(2024, "River F", "2024-09-01T00:00:00+00:00"),
            ],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert [w.cabin_name for w in result.weekends] == ["River F"]
        assert "Salary" not in result.model_dump_json()

    @pytest.mark.asyncio
    async def test_an_unresolvable_person_reads_nothing(self) -> None:
        repo = _repo()

        result = await PersonHousingService(repo).build_person_housing(0)

        assert result == PersonHousingResponse(person_cm_id=0)
        repo.fetch_person_cabin_values.assert_not_awaited()
        repo.fetch_person_adult_attendees.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_the_registry_collapses_two_spellings_of_one_unit(self) -> None:
        """Rule step 2 reads the SAME resolver the household journey uses."""
        repo = _repo(
            fetch_person_cabin_values=[
                _cabin_row(2022, "Golden Triangle -Tenaya 1", "2022-09-14T12:00:00+00:00", 212997),
                _cabin_row(2022, "Tenaya 1", "2022-09-15T12:00:00+00:00"),
            ],
            fetch_person_adult_attendees=[_attendee_row(2022, WW, "2022-10-02 07:00:00.000Z")],
            fetch_all_units=[SimpleNamespace(id="u1", code="gt-tenaya-1", name="Tenaya 1", year=2026, parent_unit="")],
            fetch_unit_aliases=[
                SimpleNamespace(
                    alias_string="Golden Triangle -Tenaya 1", member_units=["u1"], valid_from_year=0, valid_to_year=0
                )
            ],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert [w.cabin_name for w in result.weekends] == ["Tenaya 1"]

    @pytest.mark.asyncio
    async def test_a_weekend_with_no_readable_end_date_is_skipped(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2024, "River F", "2024-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.weekends == []

    @pytest.mark.asyncio
    async def test_values_with_no_adult_attendee_rows_never_builds_the_resolver(self) -> None:
        """PR1 review fix (2026-09-22, controller ruling): the resolver costs
        two whole-table reads (`fetch_all_units` / `fetch_unit_aliases`), and
        most callers -- once the tooltip and summer panel wire up -- have no
        adult weekends at all. A person with cabin values but no enrolled
        adult attendee rows has nothing to attribute them to, so there is
        nothing for the resolver to resolve."""
        repo = _repo(fetch_person_cabin_values=[_cabin_row(2024, "River F", "2024-10-10T18:00:00+00:00")])

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(person_cm_id=PERSON)
        repo.fetch_all_units.assert_not_awaited()
        repo.fetch_unit_aliases.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_adult_attendee_rows_with_no_cabin_values_never_builds_the_resolver(self) -> None:
        """The mirror case: enrolled adult weekends but no cabin values at all
        -- nothing to attribute, so the resolver stays unbuilt here too."""
        repo = _repo(fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")])

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(person_cm_id=PERSON)
        repo.fetch_all_units.assert_not_awaited()
        repo.fetch_unit_aliases.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_renamed_unit_publishes_todays_name_and_the_raw_string(self) -> None:
        """Owner ruling 2026-09-22 (evening): the camper journey follows the
        kindred#2332 pattern on adult rows too -- `cabin_name` is the unit's
        PRESENT-DAY registry name, resolved through the same alias layer the
        household journey uses, and `cabin_name_raw` keeps the string staff
        actually typed that season. This reverses the same-day morning ruling
        that had `cabin_name` publish the raw string unchanged."""
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2022, "Old Meadow 1", "2022-09-14T12:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2022, WW, "2022-10-02 07:00:00.000Z")],
            fetch_all_units=[
                SimpleNamespace(id="u1", code="meadow-1", name="Meadow House 1", year=2026, parent_unit="")
            ],
            fetch_unit_aliases=[
                SimpleNamespace(alias_string="Old Meadow 1", member_units=["u1"], valid_from_year=0, valid_to_year=0)
            ],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(
            person_cm_id=PERSON,
            weekends=[
                PersonHousingWeekend(
                    year=2022, session_cm_id=WW, cabin_name="Meadow House 1", cabin_name_raw="Old Meadow 1"
                )
            ],
        )

    @pytest.mark.asyncio
    async def test_an_unresolvable_value_publishes_the_trimmed_raw_string(self) -> None:
        """No unit or alias answers to the string, so `display_name` renders it
        unchanged (per its own docstring) and the SERVICE, not the rule, does
        the trimming -- `cabin_name_raw` keeps the untouched value."""
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2024, "  River F  ", "2024-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(
            person_cm_id=PERSON,
            weekends=[
                PersonHousingWeekend(year=2024, session_cm_id=WW, cabin_name="River F", cabin_name_raw="  River F  ")
            ],
        )


class TestTeenProgramCabins:
    """Owner ruling 2026-09-22 (late, Q9): CampMinder's "bunk" for a teen
    program is usually a program GROUP ("SCIT A", "TLI"), not a cabin. A
    TLI/SCIT cabin shows ONLY when the lodging registry resolves the string to
    a real unit -- through the ONE resolver (kindred#2332), never a client
    copy -- named by today's registry name with the as-typed string kept."""

    @pytest.mark.asyncio
    async def test_a_teen_bunk_the_registry_resolves_is_published_by_todays_name(self) -> None:
        repo = _repo(
            fetch_person_teen_assignments=[_teen_row(2025, SCIT, "scit", "Teen 2")],
            fetch_all_units=[_TEEN_UNIT],
            fetch_unit_aliases=[_TEEN_ALIAS],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(
            person_cm_id=PERSON,
            teen_cabins=[
                PersonHousingWeekend(
                    year=2025, session_cm_id=SCIT, cabin_name="Village Cabin 2", cabin_name_raw="Teen 2"
                )
            ],
        )

    @pytest.mark.asyncio
    async def test_a_program_group_the_registry_cannot_resolve_is_left_out(self) -> None:
        repo = _repo(
            fetch_person_teen_assignments=[
                _teen_row(2026, SCIT, "scit", "SCIT A"),
                _teen_row(2026, TLI, "tli", "TLI"),
            ],
            fetch_all_units=[_TEEN_UNIT],
            fetch_unit_aliases=[_TEEN_ALIAS],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.teen_cabins == []

    @pytest.mark.asyncio
    async def test_a_non_teen_row_is_never_published_even_if_it_resolves(self) -> None:
        """Defense in depth behind the repository's TLI/SCIT filter: a Quest
        row (a trip name) or any other program never becomes a teen cabin."""
        repo = _repo(
            fetch_person_teen_assignments=[_teen_row(2025, 3001, "quest", "Teen 2")],
            fetch_all_units=[_TEEN_UNIT],
            fetch_unit_aliases=[_TEEN_ALIAS],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.teen_cabins == []

    @pytest.mark.asyncio
    async def test_teen_rows_alone_are_enough_to_build_the_resolver(self) -> None:
        """The early return now weighs BOTH lists: no adult values or weekends,
        but a teen bunk to resolve, still reaches the registry."""
        repo = _repo(
            fetch_person_teen_assignments=[_teen_row(2025, SCIT, "scit", "Teen 2")],
            fetch_all_units=[_TEEN_UNIT],
            fetch_unit_aliases=[_TEEN_ALIAS],
        )

        await PersonHousingService(repo).build_person_housing(PERSON)

        repo.fetch_all_units.assert_awaited_once()
        repo.fetch_unit_aliases.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_nothing_in_either_list_never_builds_the_resolver(self) -> None:
        repo = _repo()

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result == PersonHousingResponse(person_cm_id=PERSON)
        repo.fetch_person_teen_assignments.assert_awaited_once_with(PERSON)
        repo.fetch_all_units.assert_not_awaited()
        repo.fetch_unit_aliases.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_both_lists_resolve_through_one_registry_read(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2024, "River F", "2024-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2024, WW, "2024-10-20 07:00:00.000Z")],
            fetch_person_teen_assignments=[_teen_row(2025, SCIT, "scit", "Teen 2")],
            fetch_all_units=[_TEEN_UNIT],
            fetch_unit_aliases=[_TEEN_ALIAS],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert [w.cabin_name for w in result.weekends] == ["River F"]
        assert [t.cabin_name for t in result.teen_cabins] == ["Village Cabin 2"]
        repo.fetch_all_units.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_one_row_per_teen_session_first_resolved_wins(self) -> None:
        """The bunk-grain unique index lets one (year, session) hold two bunk
        rows; the client keys its label by (year, session), so publish one."""
        repo = _repo(
            fetch_person_teen_assignments=[
                _teen_row(2025, SCIT, "scit", "SCIT A"),
                _teen_row(2025, SCIT, "scit", "Teen 2"),
                _teen_row(2025, SCIT, "scit", "Teen 2"),
            ],
            fetch_all_units=[_TEEN_UNIT],
            fetch_unit_aliases=[_TEEN_ALIAS],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert [(t.year, t.session_cm_id, t.cabin_name_raw) for t in result.teen_cabins] == [(2025, SCIT, "Teen 2")]


def _live_row(year: int, session_cm_id: int, *unit_ids: str) -> SimpleNamespace:
    """One live person-grain `lodging_assignments` row (the Go ingest's)."""
    return SimpleNamespace(
        year=year, session_cm_id=session_cm_id, person_cm_id=PERSON, household_cm_id=0, units=list(unit_ids)
    )


_MEADOW = SimpleNamespace(id="u1", code="meadow-1", name="Meadow House 1", year=2026, parent_unit="")
_LAKE = SimpleNamespace(id="u2", code="lake-1", name="Lake Cabin 1", year=2026, parent_unit="")


class TestLiveRowsFrom2026:
    """kindred#2775: for 2026 onward the adult journey reads the per-weekend
    CampMinder-layer rows; before 2026, and wherever a weekend has no live
    row, it keeps #2751's date rule, as typed."""

    @pytest.mark.asyncio
    async def test_a_2025_year_renders_exactly_as_today(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2025, "River F", "2025-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2025, WW, "2025-10-19 07:00:00.000Z")],
            # Cannot exist (the ingest writes only the active season), and must
            # not be read if it did.
            fetch_person_live_assignments=[_live_row(2025, WW, "u2")],
            fetch_all_units=[_MEADOW, _LAKE],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.weekends == [
            PersonHousingWeekend(year=2025, session_cm_id=WW, cabin_name="River F", cabin_name_raw="River F")
        ]

    @pytest.mark.asyncio
    async def test_a_2026_adult_with_a_live_row_gets_that_cabin(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2026, "Lake 1", "2026-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2026, WW, "2026-10-18 07:00:00.000Z")],
            fetch_person_live_assignments=[_live_row(2026, WW, "u2")],
            fetch_all_units=[_MEADOW, _LAKE],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        # Today's registry name for the live row; the as-typed string on hover.
        assert result.weekends == [
            PersonHousingWeekend(year=2026, session_cm_id=WW, cabin_name="Lake Cabin 1", cabin_name_raw="Lake 1")
        ]

    @pytest.mark.asyncio
    async def test_a_2026_adult_without_a_live_row_keeps_todays_rule_as_typed(self) -> None:
        repo = _repo(
            fetch_person_cabin_values=[_cabin_row(2026, "Ridge Hut", "2026-10-10T18:00:00+00:00")],
            fetch_person_adult_attendees=[_attendee_row(2026, WW, "2026-10-18 07:00:00.000Z")],
            fetch_all_units=[_MEADOW, _LAKE],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.weekends == [
            PersonHousingWeekend(year=2026, session_cm_id=WW, cabin_name="Ridge Hut", cabin_name_raw="Ridge Hut")
        ]

    @pytest.mark.asyncio
    async def test_a_live_row_alone_is_enough_to_show_the_cabin(self) -> None:
        """No value keyed yet (or already cleared), but the ingest placed the
        guest: the live row is the answer, never blank."""
        repo = _repo(
            fetch_person_adult_attendees=[_attendee_row(2026, WW, "2026-10-18 07:00:00.000Z")],
            fetch_person_live_assignments=[_live_row(2026, WW, "u1")],
            fetch_all_units=[_MEADOW],
        )

        result = await PersonHousingService(repo).build_person_housing(PERSON)

        assert result.weekends == [
            PersonHousingWeekend(year=2026, session_cm_id=WW, cabin_name="Meadow House 1", cabin_name_raw="")
        ]
