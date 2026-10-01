"""The intake repository's narrowed reads (campership sub-project 5)."""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from api.services.financial_aid_intake_repository import (
    EQUITY_FIELD_CM_IDS,
    FA_READ_FIELDS,
    FA_REGISTRATION_ASK_FIELD,
    FinancialAidIntakeRepository,
    allowlist_filter,
    parse_poc_answer,
)
from api.services.financial_aid_intake_types import EquityAnswers
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.rules import SectionName
from bunking.financial_aid.rules.lifecycle import SectionStatus, initial_status, status_to_json
from tests.unit.bunking.financial_aid.fixtures import fictional_rules_json

APPROVED_AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)


def test_the_equity_allowlist_is_exactly_the_two_poc_fields() -> None:
    assert EQUITY_FIELD_CM_IDS == (165525, 209079)
    assert allowlist_filter(EQUITY_FIELD_CM_IDS) == "field_definition.cm_id = 165525 || field_definition.cm_id = 209079"
    with pytest.raises(ValueError, match="empty"):
        allowlist_filter(())


def test_poc_answers_parse_to_yes_no_or_unknown() -> None:
    assert parse_poc_answer(" Yes ") is True
    assert parse_poc_answer("no") is False
    assert parse_poc_answer("Prefer not to answer") is None
    assert parse_poc_answer("") is None


def test_the_fa_read_names_its_columns_and_never_contact_fields() -> None:
    columns = FA_READ_FIELDS.split(",")
    assert FA_REGISTRATION_ASK_FIELD == "registration_request_amount"  # SP1's name (migration 1500000184)
    assert {FA_REGISTRATION_ASK_FIELD, "expand.household.cm_id"} <= set(columns)
    assert {"reported_income_fields", "unemployment", "total_rent"} <= set(columns)
    assert not [c for c in columns if c.startswith(("contact_", "parent_2_", "applicant_"))]


@pytest.mark.asyncio
async def test_fetch_fa_rows_reads_applicants_only_and_maps_the_household_and_reported_income() -> None:
    record = SimpleNamespace(
        id="fa0000000000001",
        person_id=1000011,
        summer_program="Session 2",
        summer_amount_requested=1500,
        fc_program="",
        fc_amount_requested=0,
        tbm_program="",
        tbm_amount_requested=0,
        interest_expressed=True,
        total_gross_income=0,
        reported_income_fields='["total_gross_income"]',
        expand={"household": SimpleNamespace(cm_id=1000001)},
        **{FA_REGISTRATION_ASK_FIELD: 700},
    )
    handle = MagicMock()
    handle.get_full_list.return_value = [record]
    pb = MagicMock()
    pb.collection.return_value = handle
    (row,) = await FinancialAidIntakeRepository(pb).fetch_fa_rows(2027)
    assert (row.person_cm_id, row.household_cm_id, row.summer_program, row.registration_ask) == (
        1000011,
        1000001,
        "Session 2",
        700.0,
    )
    assert row.answers["total_gross_income"] == 0
    assert row.reported_income_fields == frozenset({"total_gross_income"})  # a reported $0, not a blank
    params = handle.get_full_list.call_args.kwargs["query_params"]
    assert params["filter"] == "year = 2027 && is_applicant = true"
    assert params["fields"] == FA_READ_FIELDS


@pytest.mark.asyncio
async def test_a_row_the_sync_has_not_restamped_reports_no_income() -> None:
    record = SimpleNamespace(
        id="fa0000000000002",
        person_id=1000012,
        total_gross_income=0,
        expand={"household": SimpleNamespace(cm_id=1000001)},
    )
    handle = MagicMock()
    handle.get_full_list.return_value = [record]
    pb = MagicMock()
    pb.collection.return_value = handle
    (row,) = await FinancialAidIntakeRepository(pb).fetch_fa_rows(2027)
    assert row.reported_income_fields == frozenset()  # every 0 then reads as unknown: the safe side


@pytest.mark.asyncio
async def test_fetch_sessions_is_scoped_to_the_season_and_carries_the_first_day() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = [
        SimpleNamespace(
            cm_id=1000202, name="Family Camp 6", session_type="family", start_date="2027-08-20 00:00:00.000Z"
        )
    ]
    pb = MagicMock()
    pb.collection.return_value = handle
    (session,) = await FinancialAidIntakeRepository(pb).fetch_sessions(2028)
    assert (session.cm_id, session.start_date) == (1000202, "2027-08-20 00:00:00.000Z")
    assert handle.get_full_list.call_args.kwargs["query_params"]["filter"] == "year = 2028"


def _rules_row(version: int, approved: tuple[SectionName, ...]) -> SimpleNamespace:
    status = initial_status()
    for name in approved:
        status[name] = SectionStatus(state="approved", approved_by="finance@example.com", approved_at=APPROVED_AT)
    return SimpleNamespace(
        id=f"rul00000000000{version}",
        year=2031,
        version=version,
        document=fictional_rules_json(),
        section_status=status_to_json(status),
        parent_year=0,
        parent_version=0,
    )


def _pb_with_rules(*rows: SimpleNamespace) -> MagicMock:
    handle = MagicMock()
    handle.get_full_list.return_value = list(rows)
    pb = MagicMock()
    pb.collection.return_value = handle
    return pb


@pytest.mark.asyncio
async def test_intake_rules_are_none_for_a_season_with_no_rules_or_only_drafts() -> None:  # owner ruling Q4
    assert await FinancialAidIntakeRepository(_pb_with_rules()).load_intake_rules(2031) is None
    drafts = _pb_with_rules(_rules_row(1, ()), _rules_row(2, ("programs",)))  # cost never approved
    assert await FinancialAidIntakeRepository(drafts).load_intake_rules(2031) is None


@pytest.mark.asyncio
async def test_intake_rules_come_from_the_newest_version_with_programs_and_cost_approved() -> None:
    pb = _pb_with_rules(_rules_row(1, ("programs", "cost")), _rules_row(2, ("cost",)))
    rules = await FinancialAidIntakeRepository(pb).load_intake_rules(2031)
    assert rules is not None
    assert rules.year == 2031


@pytest.mark.asyncio
async def test_equity_rules_come_only_from_a_version_with_equity_approved() -> None:
    # The season warning on unanswered yes/no fields reads approved weights, never a draft.
    assert (
        await FinancialAidIntakeRepository(_pb_with_rules(_rules_row(1, ("programs", "cost")))).load_equity_rules(2031)
        is None
    )
    rules = await FinancialAidIntakeRepository(_pb_with_rules(_rules_row(1, ("equity",)))).load_equity_rules(2031)
    assert rules is not None
    assert rules.year == 2031


@pytest.mark.asyncio
async def test_a_payer_share_reads_its_percentage_as_an_exact_decimal() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = [
        SimpleNamespace(
            id="shr000000000001",
            year=2027,
            request="req000000000001",
            household_cm_id=1000001,
            share_pct=39.9818,
            source="staff",
            actor="registrar@example.com",
            note="",
        ),
        SimpleNamespace(
            id="shr000000000002",
            year=2027,
            request="req000000000002",
            household_cm_id=1000002,
            share_pct=100,
            source="staff",
            actor="registrar@example.com",
            note="",
        ),
    ]
    pb = MagicMock()
    pb.collection.return_value = handle
    partial, full = await FinancialAidIntakeRepository(pb).fetch_payer_shares(2027)
    assert (partial.request_id, partial.share_pct) == ("req000000000001", Decimal("39.9818"))
    assert str(partial.share_pct) == "39.9818"
    assert (full.request_id, full.share_pct) == ("req000000000002", Decimal(100))
    # (Controller ruling C2) Decimal.normalize() alone can emit exponent notation
    # (Decimal("100").normalize() == Decimal("1E+2")), which Pydantic then serialises
    # as the string "1E+2". A stored 100% must read back as the plain string "100".
    assert str(full.share_pct) == "100"


@pytest.mark.asyncio
async def test_fetch_equity_answers_reads_only_allowlisted_fields_for_named_people() -> None:
    values = MagicMock()
    values.get_full_list.return_value = [
        SimpleNamespace(
            value="Yes",
            expand={"person": SimpleNamespace(cm_id=1000011), "field_definition": SimpleNamespace(cm_id=165525)},
        ),
    ]
    persons = MagicMock()
    persons.get_full_list.return_value = [
        SimpleNamespace(cm_id=1000011, gender_identity_name="Non-binary", gender_pronoun_name="They/Them"),
        SimpleNamespace(cm_id=1000012, gender_identity_name="", gender_pronoun_name=""),
    ]
    pb = MagicMock()
    pb.collection.side_effect = lambda name: values if name == "person_custom_values" else persons
    result = await FinancialAidIntakeRepository(pb).fetch_equity_answers(2027, [1000012, 1000011])
    assert result == {
        1000011: EquityAnswers(True, "Non-binary", "They/Them"),
        1000012: EquityAnswers(None, "", ""),
    }
    value_filter = values.get_full_list.call_args.kwargs["query_params"]["filter"]
    assert "field_definition.cm_id = 165525 || field_definition.cm_id = 209079" in value_filter
    assert value_filter.count("field_definition.cm_id") == 2
    assert "person.cm_id = 1000011" in value_filter
    assert "person.cm_id = 1000012" in value_filter


@pytest.mark.asyncio
async def test_commit_hands_the_writes_to_the_shared_helper_off_the_event_loop() -> None:
    pb = MagicMock()
    writes = [
        AidWrite(
            collection="aid_requests",
            action="update",
            year=2027,
            record_id="req000000000001",
            before={"status": "active"},
            data={"status": "withdrawn"},
        )
    ]
    result = AidOperationResult(
        operation_id="op0000000000001", record_ids=("req000000000001",), records=(None,), batches=1
    )
    threads: list[int] = []

    def helper(*args: Any, **kwargs: Any) -> AidOperationResult:
        threads.append(threading.get_ident())
        return result

    with patch("api.services.financial_aid_intake_repository.commit_aid_writes", side_effect=helper) as sent:
        out = await FinancialAidIntakeRepository(pb).commit(
            writes,
            actor="registrar@example.com",
            reason="Tax return.",
            require_reason=True,
        )
    assert out is result
    assert sent.call_args.args == (pb, writes)
    assert sent.call_args.kwargs == {
        "actor": "registrar@example.com",
        "operation_id": None,
        "reason": "Tax return.",
        "require_reason": True,
        "allow_chunking": False,
    }
    assert threads != [threading.get_ident()]  # PocketBase I/O never runs on the event loop's thread


def test_the_repository_has_no_write_path_but_commit() -> None:
    # spec 14.4: a write and its log row commit together. A create_/update_/delete_ method
    # here would be a second path that writes without its aid_change_log row.
    direct = [n for n in vars(FinancialAidIntakeRepository) if n.startswith(("create", "update", "delete", "upsert"))]
    assert direct == []


@pytest.mark.asyncio
async def test_an_empty_application_id_reads_nothing_rather_than_the_whole_season() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = []
    pb = MagicMock()
    pb.collection.return_value = handle
    repository = FinancialAidIntakeRepository(pb)
    assert await repository.fetch_requests(2027, "") == []
    assert await repository.fetch_corrections(2027, "") == []
    handle.get_full_list.assert_not_called()


@pytest.mark.asyncio
async def test_a_named_application_scopes_the_request_and_correction_reads() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = []
    pb = MagicMock()
    pb.collection.return_value = handle
    repository = FinancialAidIntakeRepository(pb)
    await repository.fetch_requests(2027, "app000000000001")
    await repository.fetch_corrections(2027, "app000000000001")
    filters = [c.kwargs["query_params"]["filter"] for c in handle.get_full_list.call_args_list]
    assert filters == ["year = 2027 && application = 'app000000000001'"] * 2


@pytest.mark.asyncio
async def test_a_request_reads_its_recorded_equity_copy_and_none_when_there_is_none() -> None:
    """3c-2: aid_requests.equity, intake's recorded copy; null until intake records one."""
    row = SimpleNamespace(
        id="req000000000001",
        year=2027,
        application="app000000000001",
        household_cm_id=1000001,
        person_cm_id=1000011,
        session_cm_id=1000101,
        program_key="summer",
        session_resolution="enrollment",
        status="active",
        equity={"bipoc": None, "gender_identity": "", "pronouns": "they/them"},
    )
    handle = MagicMock()
    handle.get_full_list.return_value = [row, SimpleNamespace(**{**vars(row), "id": "req000000000002", "equity": None})]
    pb = MagicMock()
    pb.collection.return_value = handle
    recorded, unrecorded = await FinancialAidIntakeRepository(pb).fetch_requests(2027)
    assert recorded.equity == EquityAnswers(bipoc=None, gender_identity="", pronouns="they/them")
    assert unrecorded.equity is None
