"""kindred#2803: the year-wide lodging reads ask PocketBase only for the fields they use.

`fetch_prior_household_cm_ids` expanded all 42 `persons` columns to read one of
them (`household_id`) -- about 9 MB and 99% of a cold roster on the production
snapshot. A `fields=` projection is a query-param change with no semantic
change, and exactly one way to go wrong: a field the code reads but the list
leaves out comes back MISSING, and every consumer here reads with
`getattr(..., default)`, so it reads as `""`/0 rather than failing.

So each narrowed read gets TWO tests:

* a PIN on the exact field set the repository sends, and
* an EQUIVALENCE check: the same fixture rows, served once in full and once
  projected the way PocketBase projects them (`tests/fixtures/pb_projection.py`), must produce
  identical results all the way through the real consumer. That is the test
  that catches a missing field -- it compares against the unprojected read
  rather than against a hand-written expectation that could share the mistake.

The fixture rows are deliberately WIDE (every column a consumer might plausibly
touch, plus noise), and are turned into real SDK `Record`s, so attribute access
behaves exactly as it does against a live PocketBase.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from pocketbase.models.record import Record

from api.dependencies import lodging_cache
from api.services.adult_need_answers import (
    ADULT_BATHROOM_FIELD_CM_ID,
    ADULT_CPAP_FIELD_CM_ID,
    HOUSING_ACCOMODATION_FIELD_CM_ID,
    adult_need_flags_by_person,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import _person_display_name, _request_blocks
from api.services.person_housing_rules import cabin_values_from_rows
from tests.fixtures.pb_projection import project as _project

# ---------------------------------------------------------------- the pins
#
# The field lists each read sends. A set, because PocketBase does not care
# about order -- but every entry is load-bearing, and the equivalence tests
# below are what prove it.
PRIOR_HOUSEHOLD_FIELDS = {"expand.person.household_id"}
PRIOR_ADULT_FIELDS = {"person_id"}
FAMILY_CAMP_REQUEST_FIELDS = {
    "value",
    "expand.field_definition.cm_id",
    "expand.person.household",
    "expand.person.first_name",
    "expand.person.last_name",
    "expand.person.preferred_name",
}
BUNKING_CSV_REQUEST_FIELDS = {
    "field",
    "content",
    "expand.requester.household",
    "expand.requester.first_name",
    "expand.requester.last_name",
    "expand.requester.preferred_name",
}
COHORT_VALUE_FIELDS = {
    "year",
    "value",
    "last_updated",
    "expand.person.cm_id",
    "expand.field_definition.cm_id",
}


@pytest.fixture(autouse=True)
def _reset_lodging_cache() -> Any:
    """Every read here is `@cached_by_year`, and the cache is a process-wide
    singleton: without this the projected run would be served the full run's
    cached answer and the equivalence checks would compare a value to itself."""
    lodging_cache.invalidate_all()
    yield
    lodging_cache.invalidate_all()


class _ProjectingPB:
    """A PocketBase stand-in serving fixed rows per collection, projected by
    each request's own `fields` -- or not at all, when `project` is False,
    which is the "before" read every equivalence test compares against."""

    def __init__(self, rows: dict[str, list[dict[str, Any]]], *, project: bool) -> None:
        self._rows = rows
        self._project = project
        self.params: dict[str, list[dict[str, Any]]] = {}

    def collection(self, name: str) -> MagicMock:
        coll = MagicMock()

        def get_full_list(batch: int = 100, query_params: dict[str, Any] | None = None) -> list[Record]:
            params = dict(query_params or {})
            self.params.setdefault(name, []).append(params)
            fields = params.get("fields") if self._project else None
            return [Record(_project(row, fields)) for row in self._rows.get(name, [])]

        coll.get_full_list.side_effect = get_full_list
        return coll

    def fields_sent(self, collection: str) -> set[str]:
        sent = self.params[collection][-1].get("fields", "")
        entries = [entry.strip() for entry in sent.split(",") if entry.strip()]
        assert len(entries) == len(set(entries)), f"duplicate entries in fields={sent!r}"
        return set(entries)


def _person(
    cm_id: int, household_id: int, household_pb: str, first: str, last: str, preferred: str = ""
) -> dict[str, Any]:
    """A WIDE persons row: the columns the reads use, plus the noise that made
    the unprojected read 9 MB."""
    return {
        "id": f"p_{cm_id}",
        "collectionName": "persons",
        "cm_id": cm_id,
        "household_id": household_id,
        "household": household_pb,
        "first_name": first,
        "last_name": last,
        "preferred_name": preferred,
        "year": 2026,
        "grade": 5,
        "gender": "F",
        "age": 10.5,
        "birthdate": "2016-01-01",
        "primary_email": "test@example.com",
        "phone": "555-0100",
        "address_city": "Springfield",
        "school": "Riverside Elementary",
        "years_at_camp": 2,
    }


async def _both(rows: dict[str, list[dict[str, Any]]], read: Any) -> tuple[Any, Any, _ProjectingPB]:
    """Run `read(repo)` against the full rows, then against projected rows."""
    full = await read(LodgingRepository(_ProjectingPB(rows, project=False)))  # type: ignore[arg-type]
    lodging_cache.invalidate_all()
    projecting = _ProjectingPB(rows, project=True)
    narrowed = await read(LodgingRepository(projecting))  # type: ignore[arg-type]
    return full, narrowed, projecting


# ------------------------------------------------------------ attendee reads


def _attendee(person: dict[str, Any], *, person_id: int, year: int) -> dict[str, Any]:
    return {
        "id": f"a_{person_id}_{year}",
        "collectionName": "attendees",
        "person_id": person_id,
        "person": person["id"],
        "session": "s_1",
        "year": year,
        "status_id": 2,
        "status": "enrolled",
        "enrollment_date": "2025-01-01",
        "expand": {"person": person},
    }


ATTENDEE_ROWS = {
    "attendees": [
        _attendee(_person(1000001, 2000001, "hh_1", "Emma", "Johnson"), person_id=1000001, year=2024),
        _attendee(_person(1000002, 2000001, "hh_1", "Samuel", "Johnson"), person_id=1000002, year=2025),
        _attendee(_person(1000003, 2000002, "hh_2", "Liam", "Garcia"), person_id=1000003, year=2025),
        # No household: contributes nothing, projected or not.
        _attendee(_person(1000004, 0, "", "Olivia", "Chen"), person_id=1000004, year=2025),
    ]
}


class TestPriorHouseholdCmIdsProjection:
    @pytest.mark.asyncio
    async def test_asks_only_for_the_household_id(self) -> None:
        _, _, projecting = await _both(ATTENDEE_ROWS, lambda r: r.fetch_prior_household_cm_ids(2026))

        assert projecting.fields_sent("attendees") == PRIOR_HOUSEHOLD_FIELDS

    @pytest.mark.asyncio
    async def test_returns_the_same_households_as_the_full_read(self) -> None:
        full, narrowed, _ = await _both(ATTENDEE_ROWS, lambda r: r.fetch_prior_household_cm_ids(2026))

        assert narrowed == full == {2000001, 2000002}


class TestFamilyEnrolledHouseholdCmIdsProjection:
    @pytest.mark.asyncio
    async def test_asks_only_for_the_household_id(self) -> None:
        _, _, projecting = await _both(ATTENDEE_ROWS, lambda r: r.fetch_family_enrolled_household_cm_ids(2025))

        assert projecting.fields_sent("attendees") == PRIOR_HOUSEHOLD_FIELDS

    @pytest.mark.asyncio
    async def test_returns_the_same_households_as_the_full_read(self) -> None:
        full, narrowed, _ = await _both(ATTENDEE_ROWS, lambda r: r.fetch_family_enrolled_household_cm_ids(2025))

        assert narrowed == full == {2000001, 2000002}


class TestPriorAdultPersonCmIdsProjection:
    @pytest.mark.asyncio
    async def test_asks_only_for_the_person_id(self) -> None:
        _, _, projecting = await _both(ATTENDEE_ROWS, lambda r: r.fetch_prior_adult_person_cm_ids(2026))

        assert projecting.fields_sent("attendees") == PRIOR_ADULT_FIELDS

    @pytest.mark.asyncio
    async def test_returns_the_same_guests_as_the_full_read(self) -> None:
        full, narrowed, _ = await _both(ATTENDEE_ROWS, lambda r: r.fetch_prior_adult_person_cm_ids(2026))

        assert narrowed == full == {1000001, 1000002, 1000003, 1000004}


# -------------------------------------------------------- request-text lanes


def _field_definition(cm_id: int, name: str) -> dict[str, Any]:
    return {"id": f"fd_{cm_id}", "cm_id": cm_id, "name": name, "data_type": "String", "partition": "Camper"}


REQUEST_ROWS = {
    "person_custom_values": [
        {
            "id": "pcv_1",
            "collectionName": "person_custom_values",
            "year": 2026,
            "value": "Near the Garcias please",
            "last_updated": "2026-03-01 10:00:00.000Z",
            "person": "p_1000001",
            "field_definition": "fd_240598",
            "expand": {
                "person": _person(1000001, 2000001, "hh_1", "Emma", "Johnson", preferred="Em"),
                "field_definition": _field_definition(240598, "FAM CAMP-Share Comments"),
            },
        },
        {
            "id": "pcv_2",
            "collectionName": "person_custom_values",
            "year": 2026,
            "value": "near the garcias please",
            "last_updated": "2026-03-02 10:00:00.000Z",
            "person": "p_1000002",
            "field_definition": "fd_240598",
            "expand": {
                "person": _person(1000002, 2000001, "hh_1", "Samuel", "Johnson"),
                "field_definition": _field_definition(240598, "FAM CAMP-Share Comments"),
            },
        },
    ],
    "original_bunk_requests": [
        {
            "id": "obr_1",
            "collectionName": "original_bunk_requests",
            "year": 2026,
            "field": "bunk_request_form",
            "content": "Riley Sam",
            "processed": "",
            "requester": "p_1000003",
            "expand": {"requester": _person(1000003, 2000002, "hh_2", "Liam", "Garcia")},
        },
        {
            "id": "obr_2",
            "collectionName": "original_bunk_requests",
            "year": 2026,
            "field": "internal_notes",
            "content": "Staff note about the Garcias",
            "processed": "",
            "requester": "p_1000003",
            "expand": {"requester": _person(1000003, 2000002, "hh_2", "Liam", "Garcia")},
        },
    ],
}


def _rendered(values: dict[str, list[Any]]) -> dict[str, Any]:
    """Everything the roster can derive from the request-text read: the panel
    blocks (staff notes included, so both lanes render), and each row's
    household and contributor name."""
    return {
        household: {
            "blocks": [b.model_dump() for b in _request_blocks(rows, include_staff_notes=True)],
            "rows": sorted(
                (
                    row.source_field,
                    row.text,
                    str(getattr(row.person, "household", "")),
                    _person_display_name(row.person),
                )
                for row in rows
            ),
        }
        for household, rows in values.items()
    }


class TestRequestTextLanesProjection:
    @pytest.mark.asyncio
    async def test_the_family_camp_lane_asks_only_for_what_the_panel_uses(self) -> None:
        _, _, projecting = await _both(REQUEST_ROWS, lambda r: r.fetch_request_text_values(2026))

        assert projecting.fields_sent("person_custom_values") == FAMILY_CAMP_REQUEST_FIELDS

    @pytest.mark.asyncio
    async def test_the_bunking_csv_lane_asks_only_for_what_the_panel_uses(self) -> None:
        _, _, projecting = await _both(REQUEST_ROWS, lambda r: r.fetch_request_text_values(2026))

        assert projecting.fields_sent("original_bunk_requests") == BUNKING_CSV_REQUEST_FIELDS

    @pytest.mark.asyncio
    async def test_the_panel_renders_identically_from_the_projected_rows(self) -> None:
        full, narrowed, _ = await _both(REQUEST_ROWS, lambda r: r.fetch_request_text_values(2026))

        assert set(full) == {"hh_1", "hh_2"}
        assert _rendered(narrowed) == _rendered(full)
        # The display name survives the projection, preferred name included.
        assert ("FAM CAMP-Share Comments", "Near the Garcias please", "hh_1", "Em Johnson") in _rendered(narrowed)[
            "hh_1"
        ]["rows"]


# --------------------------------------------------- cohort custom values


def _cohort_value(person_cm_id: int, field_cm_id: int, value: str, year: int) -> dict[str, Any]:
    return {
        "id": f"pcv_{person_cm_id}_{field_cm_id}_{year}",
        "collectionName": "person_custom_values",
        "year": year,
        "value": value,
        "last_updated": f"{year}-05-01 12:00:00.000Z",
        "person": f"p_{person_cm_id}",
        "field_definition": f"fd_{field_cm_id}",
        "expand": {
            "person": _person(person_cm_id, 2000009, "hh_9", "Riley", "Sam"),
            "field_definition": _field_definition(field_cm_id, "Adult field"),
        },
    }


NEED_ROWS = {
    "person_custom_values": [
        _cohort_value(1000005, ADULT_BATHROOM_FIELD_CM_ID, "Yes", 2026),
        _cohort_value(1000005, ADULT_CPAP_FIELD_CM_ID, "Yes", 2026),
        _cohort_value(1000006, HOUSING_ACCOMODATION_FIELD_CM_ID, "Ground floor room, required", 2026),
    ]
}
CABIN_ROWS = {
    "person_custom_values": [
        _cohort_value(1000005, 212997, "Ridge Hut", 2025),
        _cohort_value(1000006, 223823, "Old Meadow 1", 2025),
    ]
}


class TestCohortValueProjection:
    @pytest.mark.asyncio
    async def test_the_need_read_asks_only_for_what_the_flags_use(self) -> None:
        _, _, projecting = await _both(NEED_ROWS, lambda r: r.fetch_adult_need_values(2026))

        assert projecting.fields_sent("person_custom_values") == COHORT_VALUE_FIELDS

    @pytest.mark.asyncio
    async def test_the_cabin_read_asks_only_for_what_attribution_uses(self) -> None:
        _, _, projecting = await _both(CABIN_ROWS, lambda r: r.fetch_adult_cabin_values(2025))

        assert projecting.fields_sent("person_custom_values") == COHORT_VALUE_FIELDS

    @pytest.mark.asyncio
    async def test_need_flags_are_identical_from_the_projected_rows(self) -> None:
        full, narrowed, _ = await _both(NEED_ROWS, lambda r: r.fetch_adult_need_values(2026))

        flags = adult_need_flags_by_person(narrowed)
        assert flags == adult_need_flags_by_person(full)
        assert set(flags) == {1000005, 1000006}

    @pytest.mark.asyncio
    async def test_cabin_values_are_identical_from_the_projected_rows(self) -> None:
        full, narrowed, _ = await _both(CABIN_ROWS, lambda r: r.fetch_adult_cabin_values(2025))

        values = cabin_values_from_rows(narrowed)
        assert values == cabin_values_from_rows(full)
        assert {(v.year, v.field_cm_id, v.raw) for v in values} == {
            (2025, 212997, "Ridge Hut"),
            (2025, 223823, "Old Meadow 1"),
        }
        # The attribution rule's write time survives too.
        assert all(v.written_at is not None for v in values)
