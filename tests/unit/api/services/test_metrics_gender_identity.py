"""Analytics breaks gender down by CampMinder's Gender Identity, not the binary field (#2898).

Epic #3207 decision 38: "Gender in analytics is identity first (CampMinder's Gender Identity), not the binary
field. Cabins, capacity and the solver stay on the binary field." Owner ruling 58 (b), superseding 38b's "no
fallback" for Analytics only: a camper with NO identity answer falls back to the binary Gender field, and the
chart or table says so in a numbered note (how many campers). A write-in is still "self-described". Camperships
keeps its own no-fallback rule.

Every fixture with an identity answer gives the binary field a value that disagrees with it, so a service still
reading the binary field fails here. Fictional campers only.
"""

from __future__ import annotations

from collections import Counter
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from bunking.gender_identity import NOT_GIVEN, SELF_DESCRIBED


def _person(cm_id: int, gender: str, identity: str = "", write_in: str = "", grade: int | None = 5) -> Any:
    return SimpleNamespace(
        cm_id=cm_id,
        first_name="Test",
        last_name="Camper",
        preferred_name=None,
        gender=gender,
        gender_identity_name=identity,
        gender_identity_write_in=write_in,
        grade=grade,
        years_at_camp=1,
        school=None,
        normalized_school=None,
        address_city=None,
        address_state=None,
        normalized_city=None,
        normalized_congregation=None,
        household_id=None,
        birthdate=None,
        age=None,
        primary_childhood_household=None,
        parent_names=None,
    )


# Emma: Non-binary (binary F). Liam: Boy/man (M). Olivia: a write-in (F). Riley: no answer, binary M.
# Samuel: Transgender girl/woman (M). Ava: no answer, binary Other. Mia: no answer, binary F.
PERSONS: dict[int, Any] = {
    1: _person(1, "F", identity="Non-binary", grade=5),
    2: _person(2, "M", identity="Boy/man", grade=5),
    3: _person(3, "F", write_in="their own words", grade=6),
    4: _person(4, "M", grade=6),
    5: _person(5, "M", identity="Transgender girl/woman", grade=6),
    6: _person(6, "Other", grade=7),
    7: _person(7, "F", grade=7),
}
EXPECTED = {
    1: "Non-binary",
    2: "Boy/man",
    3: SELF_DESCRIBED,
    4: "Boy/man",  # ruling 58: no answer, binary M
    5: "Transgender girl/woman",
    6: NOT_GIVEN,  # no answer anywhere: binary Other
    7: "Girl/woman",  # ruling 58: no answer, binary F
}
EXPECTED_COUNTS = dict(Counter(EXPECTED.values()))
IDS = set(PERSONS)
FALLBACKS = 2  # Riley and Mia


# ----------------------------------------------------------------------------
# The extractor, its one fallback switch, and the fallback count
# ----------------------------------------------------------------------------


def test_extract_gender_identity_reads_identity_first() -> None:
    from api.services.extractors import extract_gender_identity

    assert {pid: extract_gender_identity(p) for pid, p in PERSONS.items()} == EXPECTED


def test_a_blank_identity_falls_back_to_the_binary_field() -> None:
    """Ruling 58: F counts as Girl/woman, M as Boy/man; Other or blank has nothing to fall back to."""
    from api.services.extractors import extract_gender_identity

    assert extract_gender_identity(SimpleNamespace(gender="F")) == "Girl/woman"
    assert extract_gender_identity(SimpleNamespace(gender="M", gender_identity_name="  ")) == "Boy/man"
    assert extract_gender_identity(SimpleNamespace(gender="Other")) == NOT_GIVEN
    assert extract_gender_identity(SimpleNamespace(gender_identity_name=None, gender_identity_write_in=None)) == (
        NOT_GIVEN
    )
    assert extract_gender_identity(None) == NOT_GIVEN


def test_a_write_in_never_falls_back() -> None:
    from api.services.extractors import extract_gender_identity

    assert extract_gender_identity(SimpleNamespace(gender="F", gender_identity_write_in="words")) == SELF_DESCRIBED


def test_non_string_fields_read_as_blank() -> None:
    """A Mock person (or a stray non-string) must not become a label."""
    from api.services.extractors import extract_gender_identity

    assert extract_gender_identity(Mock(gender="M", spec=["gender"])) == "Boy/man"
    assert extract_gender_identity(SimpleNamespace(gender="F", gender_identity_name=Mock())) == "Girl/woman"


def test_the_fallback_is_one_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Whether a blank answer falls back is one constant, so the ruling can be reversed in one line."""
    from api.services import extractors

    assert extractors.IDENTITY_FALLS_BACK_TO_BINARY is True
    monkeypatch.setattr(extractors, "IDENTITY_FALLS_BACK_TO_BINARY", False)
    assert extractors.extract_gender_identity(PERSONS[4]) == NOT_GIVEN
    assert extractors.extract_gender_identity(PERSONS[1]) == "Non-binary"
    assert extractors.count_binary_fallbacks(IDS, PERSONS) == 0


def test_count_binary_fallbacks_counts_campers_counted_by_the_binary_field() -> None:
    from api.services.extractors import count_binary_fallbacks

    assert count_binary_fallbacks(IDS, PERSONS) == FALLBACKS
    assert count_binary_fallbacks({1, 2, 3, 5, 6}, PERSONS) == 0
    assert count_binary_fallbacks({4, 99}, PERSONS) == 1  # a person id with no record is skipped


def test_camperships_never_falls_back() -> None:
    """The shared rule only falls back when the caller passes the binary field; Camperships never does."""
    from bunking.financial_aid.reports.development import gender_label

    assert gender_label("", "") == NOT_GIVEN


def test_both_repositories_read_the_identity_fields() -> None:
    from api.services.metrics_repository import PERSON_FIELDS

    assert "gender_identity_name" in PERSON_FIELDS
    assert "gender_identity_write_in" in PERSON_FIELDS


# ----------------------------------------------------------------------------
# Registration: by gender, gender by grade, gender by session length
# ----------------------------------------------------------------------------


def _registration() -> Any:
    from api.services.registration_service import RegistrationService

    return RegistrationService(AsyncMock())


def test_registration_by_gender_counts_identity_labels() -> None:
    rows = _registration()._compute_gender_breakdown(IDS, PERSONS, len(IDS))
    assert {r.gender: r.count for r in rows} == EXPECTED_COUNTS


def test_registration_by_gender_lists_known_identities_first_and_the_non_answers_last() -> None:
    rows = _registration()._compute_gender_breakdown(IDS, PERSONS, len(IDS))
    assert [r.gender for r in rows] == [
        "Girl/woman",
        "Boy/man",
        "Non-binary",
        "Transgender girl/woman",
        SELF_DESCRIBED,
        NOT_GIVEN,
    ]


def test_gender_by_grade_counts_every_identity_label() -> None:
    rows = {r.grade: r for r in _registration()._compute_gender_by_grade(IDS, PERSONS)}
    assert rows[5].by_gender == {"Non-binary": 1, "Boy/man": 1}
    assert rows[5].total == 2
    assert rows[6].by_gender == {"Boy/man": 1, "Transgender girl/woman": 1, SELF_DESCRIBED: 1}
    assert list(rows[6].by_gender) == ["Boy/man", "Transgender girl/woman", SELF_DESCRIBED]  # display order
    assert rows[6].total == 3
    assert rows[7].by_gender == {"Girl/woman": 1, NOT_GIVEN: 1}
    assert rows[7].total == 2  # "not given" counts in the grade's total


def test_gender_by_session_length_counts_every_identity_label() -> None:
    session = SimpleNamespace(
        cm_id=1000,
        name="Session 2",
        session_type="main",
        parent_id=None,
        start_date="2026-06-15",
        end_date="2026-06-28",
    )
    attendees = [SimpleNamespace(person_id=pid, expand={"session": session}) for pid in PERSONS]
    rows = _registration()._compute_gender_by_session_length(attendees, {1000: session}, PERSONS)
    assert len(rows) == 1
    assert rows[0].length_category == "2-week"
    assert rows[0].by_gender == EXPECTED_COUNTS
    assert rows[0].total == 7


@pytest.mark.asyncio
async def test_registration_says_how_many_campers_fell_back() -> None:
    from api.services.registration_service import RegistrationService

    session = SimpleNamespace(
        cm_id=1000, name="S1", session_type="main", parent_id=None, start_date="2026-06-15", end_date="2026-06-28"
    )
    repo = AsyncMock()
    repo.fetch_attendees.return_value = [
        SimpleNamespace(person_id=pid, status="enrolled", status_id=2, expand={"session": session}) for pid in PERSONS
    ]
    repo.fetch_persons.return_value = PERSONS
    repo.fetch_sessions.return_value = {1000: session}
    repo.fetch_summer_enrollment_history.return_value = []
    repo.fetch_bunk_plans.return_value = []
    repo.fetch_capacity_config.return_value = 12

    result = await RegistrationService(repo).calculate_registration(2026)

    assert {g.gender: g.count for g in result.by_gender} == EXPECTED_COUNTS
    assert result.gender_fallback_count == FALLBACKS


def test_the_binary_count_columns_are_gone() -> None:
    from api.schemas.metrics import GenderByGradeBreakdown, GenderBySessionLengthBreakdown

    for model in (GenderByGradeBreakdown, GenderBySessionLengthBreakdown):
        assert "male_count" not in model.model_fields
        assert "female_count" not in model.model_fields


# ----------------------------------------------------------------------------
# Retention (two-year), retention trends, historical trends
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retention_by_gender_reads_identity() -> None:
    from api.services.retention_service import RetentionService

    session = SimpleNamespace(cm_id=1000, name="S1", session_type="main", parent_id=None, start_date="", end_date="")
    base = [SimpleNamespace(person_id=pid, year=2025, expand={"session": session}) for pid in PERSONS]
    compare = [SimpleNamespace(person_id=pid, year=2026, expand={"session": session}) for pid in (1, 4)]
    repo = AsyncMock()
    repo.fetch_attendees.side_effect = [base, compare]
    repo.fetch_persons.return_value = PERSONS
    repo.fetch_sessions.return_value = {1000: session}
    repo.fetch_bunk_assignments.return_value = []
    repo.fetch_summer_enrollment_history.return_value = []

    result = await RetentionService(repo).calculate_retention(base_year=2025, compare_year=2026)

    by = {r.gender: (r.base_count, r.returned_count) for r in result.by_gender}
    assert by == {
        "Non-binary": (1, 1),
        "Boy/man": (2, 1),
        SELF_DESCRIBED: (1, 0),
        "Transgender girl/woman": (1, 0),
        NOT_GIVEN: (1, 0),
        "Girl/woman": (1, 0),
    }
    assert next(r.gender for r in result.by_gender) == "Girl/woman"
    assert result.gender_fallback_count == FALLBACKS


def test_retention_trends_by_gender_reads_identity() -> None:
    from api.services.retention_trends_service import RetentionTrendsService

    rows = RetentionTrendsService(AsyncMock())._compute_gender_breakdown(IDS, {1, 4}, PERSONS)
    assert {r.gender: (r.base_count, r.returned_count) for r in rows} == {
        "Non-binary": (1, 1),
        "Boy/man": (2, 1),
        SELF_DESCRIBED: (1, 0),
        "Transgender girl/woman": (1, 0),
        NOT_GIVEN: (1, 0),
        "Girl/woman": (1, 0),
    }


def test_retention_trends_enrollment_by_year_reads_identity() -> None:
    from api.services.retention_trends_service import RetentionTrendsService

    years = RetentionTrendsService(AsyncMock())._compute_enrollment_by_year(
        [2026], {2026: {"person_ids": IDS, "persons": PERSONS}}
    )
    assert {g.gender: g.count for g in years[0].by_gender} == EXPECTED_COUNTS
    assert years[0].gender_fallback_count == FALLBACKS


def test_historical_by_gender_reads_identity() -> None:
    from api.services.historical_service import HistoricalService

    metrics = HistoricalService(AsyncMock())._compute_year_metrics(2026, IDS, PERSONS)
    assert {g.gender: g.count for g in metrics.by_gender} == EXPECTED_COUNTS
    assert metrics.gender_fallback_count == FALLBACKS


# ----------------------------------------------------------------------------
# Waitlist and cancellations
# ----------------------------------------------------------------------------


def test_waitlist_by_gender_reads_identity() -> None:
    from api.services.waitlist_service import WaitlistService

    _, by_gender = WaitlistService(AsyncMock())._compute_demographics(IDS, PERSONS, enrolled_person_ids={1})
    by = {g.gender: (g.count, g.no_enrollment, g.has_enrollment) for g in by_gender}
    assert by["Non-binary"] == (1, 0, 1)
    assert by["Boy/man"] == (2, 2, 0)
    assert by[NOT_GIVEN] == (1, 1, 0)
    assert set(by) == set(EXPECTED.values())


def test_cancellations_by_gender_reads_identity() -> None:
    from api.services.cancellation_service import CancellationService

    prior = {"enrolled": {1, 2}, "waitlisted": {3}, "applied": {4, 6}, "other": {5, 7}}
    _, by_gender = CancellationService(AsyncMock())._compute_demographics(IDS, PERSONS, prior)
    by = {g.gender: g for g in by_gender}
    assert set(by) == set(EXPECTED.values())
    assert by["Non-binary"].was_enrolled == 1
    assert (by["Boy/man"].was_enrolled, by["Boy/man"].was_applied) == (1, 1)
    assert by[NOT_GIVEN].was_applied == 1
    assert by["Girl/woman"].other_prior_status == 1
    assert by[SELF_DESCRIBED].was_waitlisted == 1


# ----------------------------------------------------------------------------
# Drill-down: a gender slice lists the campers under that identity label, and shows it
# ----------------------------------------------------------------------------


def _drilldown_repo() -> AsyncMock:
    session = SimpleNamespace(cm_id=1000, name="S1", session_type="main", parent_id=None, start_date="", end_date="")
    repo = AsyncMock()
    repo.fetch_attendees.return_value = [
        SimpleNamespace(person_id=pid, status="enrolled", expand={"session": session}) for pid in PERSONS
    ]
    repo.fetch_persons.return_value = PERSONS
    repo.fetch_sessions.return_value = {1000: session}
    repo.fetch_household_postal_codes.return_value = {}
    return repo


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("label", "pids"),
    [("Non-binary", [1]), (SELF_DESCRIBED, [3]), (NOT_GIVEN, [6]), ("Boy/man", [2, 4]), ("Girl/woman", [7])],
)
async def test_drilldown_gender_slice_matches_the_identity_label(label: str, pids: list[int]) -> None:
    from api.services.drilldown_service import DrilldownService

    rows = await DrilldownService(_drilldown_repo()).get_attendees_for_breakdown(
        year=2026, breakdown_type="gender", breakdown_value=label
    )
    assert sorted(r.person_id for r in rows) == pids


@pytest.mark.asyncio
async def test_drilldown_binary_value_no_longer_matches() -> None:
    from api.services.drilldown_service import DrilldownService

    rows = await DrilldownService(_drilldown_repo()).get_attendees_for_breakdown(
        year=2026, breakdown_type="gender", breakdown_value="F"
    )
    assert rows == []


@pytest.mark.asyncio
async def test_drilldown_rows_show_the_identity_label() -> None:
    from api.services.drilldown_service import DrilldownService

    rows = await DrilldownService(_drilldown_repo()).get_attendees_for_breakdown(
        year=2026, breakdown_type="session", breakdown_value="1000"
    )
    assert {r.person_id: r.gender for r in rows} == EXPECTED
