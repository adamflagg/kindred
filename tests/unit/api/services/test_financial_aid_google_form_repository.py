"""The adult aid Google Form mirror's reads (adult-aid form design PR 2, §8).

aid_form_responses also holds the respondent email, POC, race/ethnicity and gender identity. The season read names
its columns and leaves every one of those out: they are stored in the locked mirror and returned by no operational
endpoint. The respondent email has its own one-record read, used only by Link…'s candidates. Fictional data only."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from api.services.financial_aid_intake_repository import (
    FORM_RESPONSE_READ_FIELDS,
    FinancialAidIntakeRepository,
)
from tests.unit.api.services.pb_recording import RecordingPb


def test_the_season_read_names_its_columns_and_never_a_sensitive_one() -> None:
    columns = set(FORM_RESPONSE_READ_FIELDS.split(","))
    assert not columns & {"respondent_email", "poc", "race_ethnicity", "gender_identity", "birthdate_typed"}
    assert {"response_id", "match_status", "form_status", "person_cm_id", "household_cm_id", "parse_notes",
            "reported_income_fields", "total_gross_income", "ask", "last_submitted_at"} <= columns  # fmt: skip


@pytest.mark.asyncio
async def test_fetch_form_response_rows_maps_a_record() -> None:
    record = SimpleNamespace(
        id="abc123def456789",
        year=2027,
        response_id="resp-1",
        form_status="live",
        match_status="auto",
        person_cm_id=1000091,
        household_cm_id=1000009,
        program_key="adult_weekend",
        weekend_session_cm_id=1000401,
        program_choice="Adult Weekend A (Sep 10-12)",
        ask=400,
        total_gross_income=80000,
        expected_gross_income=0,
        unemployment=True,
        num_children=2,
        special_circumstances="Lost my job.",
        reported_income_fields='["total_gross_income"]',
        parse_notes=json.dumps({"ask": {"typed": "about 400", "read": 400, "note": "read 'about 400' as $400"}}),
        match_candidates="[]",
        last_submitted_at="2026-11-05T17:00:00Z",
        created_at_google="2026-11-05T17:00:00Z",
        signature_typed="Rachel Garcia",
        linked_at="",
    )
    pb = RecordingPb({"aid_form_responses": [record]})
    (row,) = await FinancialAidIntakeRepository(pb).fetch_form_response_rows(2027)
    assert (row.id, row.response_id, row.person_cm_id, row.weekend_session_cm_id, row.ask) == (
        "abc123def456789",
        "resp-1",
        1000091,
        1000401,
        400.0,
    )
    assert (row.answers["total_gross_income"], row.answers["unemployment"], row.answers["num_children"]) == (
        80000,
        True,
        2,
    )
    assert row.reported_income_fields == frozenset({"total_gross_income"})
    assert row.parse_notes["ask"]["note"] == "read 'about 400' as $400"
    assert [f for c, f in pb.calls if c == "aid_form_responses"] == ["year = 2027"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "clause"),
    [
        ("1000091", "cm_id = 1000091"),
        ("1971-04-02", "birthdate ~ '1971-04-02'"),
        ("Rachel", "first_name ~ 'Rachel'"),
    ],
)
async def test_links_search_reads_the_seasons_persons_by_id_birthdate_or_name(query: str, clause: str) -> None:
    pb = RecordingPb({"persons": [SimpleNamespace(cm_id=1000091, household_id=1000009)]})
    found = await FinancialAidIntakeRepository(pb).search_registration_people(2027, query)
    assert [p.cm_id for p in found] == [1000091]
    ((collection, filter_),) = pb.calls
    assert collection == "persons"
    assert "year = 2027" in filter_
    assert clause in filter_
