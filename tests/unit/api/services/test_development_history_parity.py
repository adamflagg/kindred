"""Pins what Reports › Development's history read (DevelopmentRepository.earlier_attendance) returns TODAY, over a
fixture that holds every way a past registration can match or miss. A cached whole read joined in Python must answer
these exactly the same, so these tests are the proof that no first-time figure moves.

The double APPLIES every filter it is sent (development_history_fixture), including `person.household_id = N` through
the attendee's related person row: the person's OWN household column in that season's person record.

Every expected value is written by hand from the fixture, as attendee row ids. If one fails, the fixture or the
expectation is wrong -- never edit the repository to make it pass.

Compared order-insensitively: the one consumer (FinancialAidDevelopmentService._native) reduces the list to sets
(earlier_summer, earlier_family_households) at once, so the list's order reaches no figure."""

from __future__ import annotations

from collections import Counter
from collections.abc import Collection
from typing import Any

import pytest

from api.services.financial_aid_development_repository import (
    FIRST_HISTORY_SEASON,
    ID_CHUNK,
    AttendanceRecord,
    DevelopmentRepository,
    attendance_record,
)
from tests.unit.api.services.development_history_fixture import FilteringPb, Row

REPORT_YEAR = 2027

# Campers (fictional CampMinder ids).
EMMA = 1000011  # matched by person id only
LIAM = 1000021  # matched by household only, and only in the season his own household was the one asked for
OLIVIA = 1000031  # matched by person id AND household: returned once per registration
RILEY = 1000041  # own household differs from the household asked for (her childhood household): never matched
SAMUEL = 1000051  # an attendee row with no linked person: matched by person id, never by household
NOAH = 1000061  # one registration inside the window, the rest outside it or not enrolled
AVA = 1000071  # matched through her own household in a family session

# Households.
EMMA_HOME = 1000901  # not asked for
LIAM_HOME = 1000902  # asked for
LIAM_OLD_HOME = 1000903  # Liam's own household in 2017: not asked for
OLIVIA_HOME = 1000904  # asked for
RILEY_HOME = 1000905  # Riley's own household: not asked for
RILEY_CHILDHOOD = 1000906  # asked for; Riley's primary childhood household only
AVA_HOME = 1000907  # asked for

# Filler ids push both lists past ID_CHUNK, so today's code reads in several chunks.
FILLER_PEOPLE = list(range(1000100, 1000220))  # 120 people
FILLER_HOUSEHOLDS = list(range(1001000, 1001060))  # 60 households
FILLER_PERSON_MATCH_LOW, FILLER_PERSON_MATCH_HIGH = 1000150, 1000219  # in the second and third person chunks
FILLER_HOUSEHOLD_MATCH = 1001055  # in the second household chunk
FILLER_HOUSEHOLD_CAMPER = 1000301  # not asked for by person id

ASKED_PEOPLE = [EMMA, OLIVIA, SAMUEL, NOAH, *FILLER_PEOPLE, 0, -3]
ASKED_HOUSEHOLDS = [LIAM_HOME, OLIVIA_HOME, RILEY_CHILDHOOD, AVA_HOME, *FILLER_HOUSEHOLDS, 0, -7]


def _session(rid: str, cm_id: int, year: int, session_type: str, start: str) -> Row:
    return Row(
        rid, {"cm_id": cm_id, "year": year, "session_type": session_type, "start_date": f"{start} 00:00:00.000Z"}
    )


def _person(rid: str, cm_id: int, year: int, household: int, childhood: Row | None = None) -> Row:
    return Row(
        rid,
        {"cm_id": cm_id, "year": year, "household_id": household},
        {"primary_childhood_household": childhood},
    )


SESSIONS = {
    2015: _session("ses000000002015", 1000101, 2015, "main", "2015-06-20"),
    2016: _session("ses000000002016", 1000101, 2016, "main", "2016-06-20"),
    2017: _session("ses000000002017", 1000106, 2017, "quest", "2017-07-05"),
    2018: _session("ses000000002018", 1000101, 2018, "main", "2018-06-20"),
    2019: _session("ses000000002019", 1000101, 2019, "main", "2019-06-20"),
    2020: _session("ses000000002020", 1000202, 2020, "family", "2020-08-20"),
    2021: _session("ses000000002021", 1000101, 2021, "main", "2021-06-20"),
    2022: _session("ses000000002022", 1000202, 2022, "family", "2022-08-20"),
    2023: _session("ses000000002023", 1000102, 2023, "embedded", "2023-06-20"),
    2024: _session("ses000000002024", 1000101, 2024, "main", "2024-06-20"),
    2025: _session("ses000000002025", 1000401, 2025, "adult", "2025-09-10"),
    2026: _session("ses000000002026", 1000101, 2026, "main", "2026-06-20"),
    2027: _session("ses000000002027", 1000101, 2027, "main", "2027-06-20"),
    2028: _session("ses000000002028", 1000101, 2028, "main", "2028-06-20"),
}

_HOUSEHOLD_ROWS = {h: Row(f"hh{h:013d}", {"cm_id": h}) for h in (RILEY_CHILDHOOD,)}

# (attendee row id, person_id, year, status_id, person record or None).
_REGISTRATIONS: list[tuple[str, int, int, int, Row | None]] = [
    # Emma: only 2019 counts (2016 is before 2017, 2027 is the report's own season, 2026 was cancelled).
    ("at0000000000k19", EMMA, 2019, 2, _person("pe0000000emma19", EMMA, 2019, EMMA_HOME)),
    ("at0000000000a16", EMMA, 2016, 2, _person("pe0000000emma16", EMMA, 2016, EMMA_HOME)),
    ("at0000000000z27", EMMA, 2027, 2, _person("pe0000000emma27", EMMA, 2027, EMMA_HOME)),
    ("at0000000000m26", EMMA, 2026, 32, _person("pe0000000emma26", EMMA, 2026, EMMA_HOME)),
    # Liam: 2020 in the household asked for; in 2017 his own household was another one.
    ("at0000000000b20", LIAM, 2020, 2, _person("pe0000000liam20", LIAM, 2020, LIAM_HOME)),
    ("at0000000000y17", LIAM, 2017, 2, _person("pe0000000liam17", LIAM, 2017, LIAM_OLD_HOME)),
    # Olivia: person id and household both asked for.
    ("at0000000000c26", OLIVIA, 2026, 2, _person("pe000000oliv26", OLIVIA, 2026, OLIVIA_HOME)),
    # Riley: her own household is not the one asked for, only her childhood household is.
    (
        "at0000000000d24",
        RILEY,
        2024,
        2,
        _person("pe00000riley24", RILEY, 2024, RILEY_HOME, _HOUSEHOLD_ROWS[RILEY_CHILDHOOD]),
    ),
    # Samuel: the attendee row has no linked person.
    ("at0000000000e21", SAMUEL, 2021, 2, None),
    # Noah: 2018 counts; 2015 and 2028 are outside the window, 2022 withdrawn, 2023 status 4.
    ("at0000000000x18", NOAH, 2018, 2, _person("pe0000000noah18", NOAH, 2018, 1000908)),
    ("at0000000000f15", NOAH, 2015, 2, _person("pe0000000noah15", NOAH, 2015, 1000908)),
    ("at0000000000g28", NOAH, 2028, 2, _person("pe0000000noah28", NOAH, 2028, 1000908)),
    ("at0000000000h22", NOAH, 2022, 256, _person("pe0000000noah22", NOAH, 2022, 1000908)),
    ("at0000000000i23", NOAH, 2023, 4, _person("pe0000000noah23", NOAH, 2023, 1000908)),
    # Ava: a family session, matched through her own household.
    ("at0000000000j22", AVA, 2022, 2, _person("pe00000000ava22", AVA, 2022, AVA_HOME)),
    # A row with no CampMinder person id: never matched by the ids <= 0 a caller passes.
    ("at0000000000n25", 0, 2025, 2, _person("pe0000000zero25", 0, 2025, 0)),
    # Filler matches, in later chunks.
    ("at0000000000p21", FILLER_PERSON_MATCH_LOW, 2021, 2, _person("pe000000fill21", FILLER_PERSON_MATCH_LOW, 2021, 1)),
    (
        "at0000000000q23",
        FILLER_PERSON_MATCH_HIGH,
        2023,
        2,
        _person("pe000000fill23", FILLER_PERSON_MATCH_HIGH, 2023, 2),
    ),
    (
        "at0000000000r22",
        FILLER_HOUSEHOLD_CAMPER,
        2022,
        2,
        _person("pe000000fhhd22", FILLER_HOUSEHOLD_CAMPER, 2022, FILLER_HOUSEHOLD_MATCH),
    ),
    # Someone nobody asked for, inside the window.
    ("at0000000000s19", 1000999, 2019, 2, _person("pe000000other1", 1000999, 2019, 1000998)),
]


def history_pb() -> FilteringPb:
    attendees = [
        Row(
            rid,
            {
                "person_id": person_id,
                "year": year,
                "status_id": status,
                "enrollment_date": "",
                "effective_date": f"{year - 1}-11-20 08:00:00.000Z",
            },
            {"person": person, "session": SESSIONS[year]},
        )
        for rid, person_id, year, status, person in _REGISTRATIONS
    ]
    return FilteringPb({"attendees": attendees})


def _expected(pb: FilteringPb, *row_ids: str) -> Counter[AttendanceRecord]:
    """The records today's read builds from these attendee rows (expand and projection as it asks for them)."""
    served = pb.collection("attendees").get_full_list(
        query_params={
            "filter": " || ".join(f'id = "{r}"' for r in row_ids) or 'id = ""',
            "expand": "person,session",
            "fields": (
                "id,person_id,status_id,enrollment_date,effective_date,year,"
                "expand.person.household_id,expand.session.cm_id,expand.session.session_type,expand.session.start_date"
            ),
        }
    )
    pb.reset()
    assert sorted(r.id for r in served) == sorted(row_ids)
    return Counter(attendance_record(r) for r in served)


async def _history(
    pb: FilteringPb, year: int, people: Collection[int], households: Collection[int]
) -> Counter[AttendanceRecord]:
    found = await DevelopmentRepository(pb).earlier_attendance(year, people, households)
    return Counter(found)


# --- the fixture ----------------------------------------------------------------------------------------------------


def test_the_fixture_matches_through_the_related_persons_own_household() -> None:
    pb = history_pb()
    rows = pb.collection("attendees").get_full_list(query_params={"filter": f"person.household_id = {RILEY_HOME}"})
    assert [r.id for r in rows] == ["at0000000000d24"]
    assert (
        pb.collection("attendees").get_full_list(query_params={"filter": f"person.household_id = {RILEY_CHILDHOOD}"})
        == []
    )
    # Samuel's row has no person: a filter through it matches nothing.
    unlinked = pb.collection("attendees").get_full_list(query_params={"filter": "person.household_id = 0"})
    assert [r.id for r in unlinked] == ["at0000000000n25"]


def test_the_fixture_refuses_a_filter_shape_it_does_not_know() -> None:
    pb = history_pb()
    with pytest.raises(NotImplementedError):
        pb.collection("attendees").get_full_list(query_params={"filter": "person_id ~ 1000"})
    with pytest.raises(NotImplementedError):
        pb.collection("attendees").get_full_list(query_params={"filter": "nickname = 'Em'"})


def test_the_fixture_asks_for_enough_ids_to_chunk() -> None:
    assert FIRST_HISTORY_SEASON == 2017
    assert len({i for i in ASKED_PEOPLE if i > 0}) > 2 * ID_CHUNK
    assert len({i for i in ASKED_HOUSEHOLDS if i > 0}) > ID_CHUNK


# --- what the read returns --------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_match_route_inside_the_window_and_nothing_else() -> None:
    pb = history_pb()
    expected = _expected(
        pb,
        "at0000000000k19",  # Emma, by person id
        "at0000000000b20",  # Liam, by household
        "at0000000000c26",  # Olivia, by both: once
        "at0000000000e21",  # Samuel, by person id, no linked person
        "at0000000000x18",  # Noah, the one enrolled season inside the window
        "at0000000000j22",  # Ava, by household, a family session
        "at0000000000p21",  # filler person, second chunk
        "at0000000000q23",  # filler person, third chunk
        "at0000000000r22",  # filler household, second chunk
    )
    found = await _history(pb, REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    assert found == expected
    assert all(n == 1 for n in found.values())


@pytest.mark.asyncio
async def test_a_smaller_ask_after_a_larger_one_answers_only_what_it_asks() -> None:
    """Development, then the ZIP export: the same report year asked twice, with different campers and households."""
    pb = history_pb()
    assert await _history(pb, REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    assert await _history(pb, REPORT_YEAR, [EMMA], []) == _expected(pb, "at0000000000k19")
    assert await _history(pb, REPORT_YEAR, [], [LIAM_HOME]) == _expected(pb, "at0000000000b20")
    assert await _history(pb, REPORT_YEAR, [OLIVIA], [OLIVIA_HOME]) == _expected(pb, "at0000000000c26")
    assert await _history(pb, REPORT_YEAR, [RILEY], []) == _expected(pb, "at0000000000d24")
    assert await _history(pb, REPORT_YEAR, [], [RILEY_CHILDHOOD, RILEY_HOME]) == _expected(pb, "at0000000000d24")
    assert await _history(pb, REPORT_YEAR, [LIAM], []) == _expected(pb, "at0000000000b20", "at0000000000y17")


@pytest.mark.asyncio
async def test_the_window_ends_the_season_before_the_report_year() -> None:
    pb = history_pb()
    expected = _expected(
        pb,
        "at0000000000k19",  # Emma 2019
        "at0000000000b20",  # Liam 2020
        "at0000000000x18",  # Noah 2018
    )
    assert await _history(pb, 2021, ASKED_PEOPLE, ASKED_HOUSEHOLDS) == expected
    # The first season of the window is 2017 itself: Liam's quest that summer counts by person id.
    assert await _history(pb, 2018, [LIAM], []) == _expected(pb, "at0000000000y17")
    assert await _history(pb, FIRST_HISTORY_SEASON, ASKED_PEOPLE, ASKED_HOUSEHOLDS) == Counter()


@pytest.mark.asyncio
async def test_nobody_asked_reads_nothing_and_ids_at_or_below_zero_never_match() -> None:
    pb = history_pb()
    assert await _history(pb, REPORT_YEAR, [], []) == Counter()
    assert pb.reads == []
    assert await _history(pb, REPORT_YEAR, [0, -3], [0, -7]) == Counter()


@pytest.mark.asyncio
async def test_ids_arriving_as_other_numbers_are_the_same_campers() -> None:
    pb = history_pb()
    people: list[Any] = [float(EMMA), str(SAMUEL)]
    households: list[Any] = [str(AVA_HOME)]
    assert await _history(pb, REPORT_YEAR, people, households) == _expected(
        pb, "at0000000000k19", "at0000000000e21", "at0000000000j22"
    )
