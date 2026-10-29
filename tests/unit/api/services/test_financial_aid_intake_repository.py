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
    FA_CONTACT_FIELDS,
    FA_READ_FIELDS,
    FA_REGISTRATION_ASK_FIELD,
    FinancialAidIntakeRepository,
    allowlist_filter,
    parse_poc_answer,
)
from api.services.financial_aid_intake_types import EquityAnswers
from api.services.financial_aid_requesters import FaContact
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.rules import SectionName
from bunking.financial_aid.rules.lifecycle import SectionStatus, initial_status, status_to_json
from tests.unit.api.services.pb_recording import RecordingPb
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
        is_applicant=True,
        expand={"household": SimpleNamespace(cm_id=1000001)},
        **{FA_REGISTRATION_ASK_FIELD: 700},
    )
    donation_only = SimpleNamespace(id="fa0000000000003", person_id=1000013, is_applicant=False, expand={})
    pb = RecordingPb({"financial_aid_applications": [record, donation_only]})
    (row,) = await FinancialAidIntakeRepository(pb).fetch_fa_rows(2027)
    assert (row.person_cm_id, row.household_cm_id, row.summer_program, row.registration_ask) == (
        1000011,
        1000001,
        "Session 2",
        700.0,
    )
    assert row.answers["total_gross_income"] == 0
    assert row.reported_income_fields == frozenset({"total_gross_income"})  # a reported $0, not a blank
    # Read through layer 1 (aid_sync_inputs): the season's whole mirror, once, its projection a superset of
    # FA_READ_FIELDS (test_aid_sync_inputs pins the projection).
    assert [f for c, f in pb.calls if c == "financial_aid_applications"] == ["year = 2027"]


@pytest.mark.asyncio
async def test_a_row_the_sync_has_not_restamped_reports_no_income() -> None:
    record = SimpleNamespace(
        id="fa0000000000002",
        person_id=1000012,
        total_gross_income=0,
        is_applicant=True,
        expand={"household": SimpleNamespace(cm_id=1000001)},
    )
    (row,) = await FinancialAidIntakeRepository(RecordingPb({"financial_aid_applications": [record]})).fetch_fa_rows(
        2027
    )
    assert row.reported_income_fields == frozenset()  # every 0 then reads as unknown: the safe side


def test_the_fa_read_names_the_per_program_ask_columns() -> None:
    # IN-BUCKETS (owner 2026-10-28): the camper (CA-) and adult-weekend (WW-) registration asks each keep their own
    # pair (migration 1500000253), so a 2027-on reader can judge each bucket on its own ask.
    assert {
        "camper_interest_expressed",
        "camper_registration_request_amount",
        "adult_weekend_interest_expressed",
        "adult_weekend_registration_request_amount",
    } <= set(FA_READ_FIELDS.split(","))


@pytest.mark.asyncio
async def test_fetch_fa_rows_maps_the_per_program_asks_beside_the_legacy_pair() -> None:
    record = SimpleNamespace(
        id="fa0000000000004",
        person_id=1000014,
        interest_expressed=True,
        camper_interest_expressed=False,
        camper_registration_request_amount=500,
        adult_weekend_interest_expressed=True,
        adult_weekend_registration_request_amount=300,
        is_applicant=True,
        expand={"household": SimpleNamespace(cm_id=1000001)},
        **{FA_REGISTRATION_ASK_FIELD: 500},
    )
    (row,) = await FinancialAidIntakeRepository(RecordingPb({"financial_aid_applications": [record]})).fetch_fa_rows(
        2027
    )
    assert (row.interest_expressed, row.registration_ask) == (True, 500.0)  # the legacy pair, as before
    assert (row.camper_interest, row.camper_registration_ask) == (False, 500.0)
    assert (row.adult_weekend_interest, row.adult_weekend_registration_ask) == (True, 300.0)


@pytest.mark.asyncio
async def test_a_row_the_sync_has_not_rewritten_reads_no_per_program_ask() -> None:
    record = SimpleNamespace(id="fa0000000000005", person_id=1000015, is_applicant=True, expand={})
    (row,) = await FinancialAidIntakeRepository(RecordingPb({"financial_aid_applications": [record]})).fetch_fa_rows(
        2027
    )
    assert (row.camper_interest, row.camper_registration_ask) == (False, 0.0)
    assert (row.adult_weekend_interest, row.adult_weekend_registration_ask) == (False, 0.0)


@pytest.mark.asyncio
async def test_fetch_sessions_is_scoped_to_the_season_and_carries_the_first_day() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = [
        SimpleNamespace(
            cm_id=1000202,
            name="Family Camp 6",
            session_type="family",
            start_date="2027-08-20 00:00:00.000Z",
            end_date="2027-08-22 00:00:00.000Z",
        )
    ]
    pb = MagicMock()
    pb.collection.return_value = handle
    (session,) = await FinancialAidIntakeRepository(pb).fetch_sessions(2028)
    assert (session.cm_id, session.start_date) == (1000202, "2027-08-20 00:00:00.000Z")
    # Reports' "season closed" reads the last aided session's last day (owner N2 = C).
    assert session.end_date == "2027-08-22 00:00:00.000Z"
    assert "end_date" in handle.get_full_list.call_args.kwargs["query_params"]["fields"]
    assert handle.get_full_list.call_args.kwargs["query_params"]["filter"] == "year = 2028"


@pytest.mark.asyncio
async def test_fetch_sessions_carries_an_ag_sessions_parent() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = [
        SimpleNamespace(
            cm_id=1000103, name="AG Session 2", session_type="ag", start_date="", end_date="", parent_id=1000101
        ),
        SimpleNamespace(cm_id=1000101, name="Session 2", session_type="main", start_date="", end_date=""),
    ]
    pb = MagicMock()
    pb.collection.return_value = handle
    ag, main = await FinancialAidIntakeRepository(pb).fetch_sessions(2028)
    assert (ag.parent_cm_id, main.parent_cm_id) == (1000101, 0)
    assert "parent_id" in handle.get_full_list.call_args.kwargs["query_params"]["fields"]


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
        # As the fill reads it: its own relation ids, no expand (layer 1 joins them to persons and the definitions).
        SimpleNamespace(
            id="pv0000000000001", value="Yes", person="pp0000000000011", field_definition="fd0000000000001"
        ),
    ]
    persons = MagicMock()
    persons.get_full_list.return_value = [
        SimpleNamespace(
            id="pp0000000000011", cm_id=1000011, gender_identity_name="Non-binary", gender_pronoun_name="They/Them"
        ),
        SimpleNamespace(id="pp0000000000012", cm_id=1000012, gender_identity_name="", gender_pronoun_name=""),
    ]
    defs = MagicMock()
    defs.get_full_list.return_value = [
        SimpleNamespace(id="fd0000000000001", cm_id=165525),
        SimpleNamespace(id="fd0000000000002", cm_id=209079),
    ]
    empty = MagicMock()
    empty.get_full_list.return_value = []
    tables = {"person_custom_values": values, "persons": persons, "custom_field_defs": defs}
    pb = MagicMock()
    pb.collection.side_effect = lambda name: tables.get(name, empty)
    result = await FinancialAidIntakeRepository(pb).fetch_equity_answers(2027, [1000012, 1000011])
    assert result == {
        1000011: EquityAnswers(True, "Non-binary", "They/Them"),
        1000012: EquityAnswers(None, "", ""),
    }
    # Answered from layer 1 (aid_sync_inputs), which reads the season's values once: the definitions by the
    # allowlisted cm_ids only, then the values by those definitions' ids -- never a field outside the allowlist.
    assert defs.get_full_list.call_args.kwargs["query_params"]["filter"] == "cm_id = 165525 || cm_id = 209079"
    value_filter = values.get_full_list.call_args.kwargs["query_params"]["filter"]
    assert (
        value_filter == 'year = 2027 && (field_definition = "fd0000000000001" || field_definition = "fd0000000000002")'
    )


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


@pytest.mark.asyncio
async def test_fetch_fa_contacts_reads_every_row_of_the_year_with_only_the_contact_columns() -> None:
    records = [
        SimpleNamespace(
            id="fa0000000000001",
            person_id=1000011,
            contact_first_name="Maria",
            contact_last_name="Garcia",
            expand={"household": SimpleNamespace(cm_id=1000001)},
        ),
        SimpleNamespace(id="fa0000000000002", person_id=0, expand={}),  # a row the sync has not stamped
    ]
    pb = RecordingPb({"financial_aid_applications": records})
    contacts = await FinancialAidIntakeRepository(pb).fetch_fa_contacts(2027)
    assert contacts == [FaContact(1000011, 1000001, "Maria", "Garcia"), FaContact(0, 0, "", "")]
    # Layer 1's read of the whole season, not only applicants: a donation-only row names a household too. Its
    # projection holds FA_CONTACT_FIELDS and no other contact column (test_aid_sync_inputs pins it).
    assert [f for c, f in pb.calls if c == "financial_aid_applications"] == ["year = 2027"]
    assert FA_CONTACT_FIELDS == "id,person_id,contact_first_name,contact_last_name,expand.household.cm_id"


@pytest.mark.asyncio
async def test_an_additions_times_read_as_utc_stamps_whatever_shape_the_sdk_hands_back() -> None:
    """The PocketBase SDK hands `created` back as a datetime (naive, in UTC); str() of it has no zone, so a browser
    reads "2026-10-16 01:44:02.377000" as local time and names the wrong day. Every addition time reads as PocketBase's
    own UTC stamp, "2026-10-16 01:44:02.377Z" (form-intake visual audit)."""
    stored = SimpleNamespace(
        id="add000000000001",
        year=2027,
        household_cm_id=1000001,
        person_cm_id=1000011,
        program_key="summer",
        session_cm_id=1000108,
        ask=290,
        source="staff",
        reason="Asked at TWR registration",
        actor="registrar@example.com",
        created=datetime(2026, 10, 16, 1, 44, 2, 377000),
        retired_at=datetime(2026, 10, 17, 2, 5, 0, tzinfo=UTC),
        retired_by="registrar@example.com",
        retire_reason="Not attending after all",
        reviewed_at="2026-10-18 03:00:00.000Z",
        reviewed_by="",
    )
    pb = RecordingPb(tables={"aid_request_additions": [stored]})
    (addition,) = await FinancialAidIntakeRepository(pb).fetch_request_additions(2027)
    assert addition.created == "2026-10-16 01:44:02.377Z"
    assert addition.retired_at == "2026-10-17 02:05:00.000Z"
    assert addition.reviewed_at == "2026-10-18 03:00:00.000Z"
    blank = SimpleNamespace(**{**vars(stored), "retired_at": "", "reviewed_at": None})
    pb.tables["aid_request_additions"] = [blank]
    (addition,) = await FinancialAidIntakeRepository(pb).fetch_request_additions(2027)
    assert (addition.retired_at, addition.reviewed_at, addition.live) == ("", "", True)


# -- PR 4b: the registration-ask rule's two reads ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_ask_history_read_is_the_seasons_camper_ask_field_only() -> None:
    """aid_registration_ask_history holds the camper ask (28906) and the adult-weekend one (209090); the rule reads the
    camper ask alone, as superuser (all five rules are null), each row's time verbatim and its order kept."""
    handle = MagicMock()
    handle.get_full_list.return_value = [
        SimpleNamespace(
            id="ask000000000001",
            person_cm_id=1000011,
            field_cm_id=28906,
            amount=585,
            source_changed_at="2027-10-01T17:02:11.000+00:00",
            observed_at=datetime(2027, 10, 2, 4, 0, tzinfo=UTC),
            created=datetime(2027, 10, 2, 4, 0, 1, 250000),
        )
    ]
    pb = MagicMock()
    pb.collection.return_value = handle
    (row,) = await FinancialAidIntakeRepository(pb).fetch_registration_ask_history(2027)
    assert (row.person_cm_id, row.amount, row.source_changed_at) == (1000011, 585.0, "2027-10-01T17:02:11.000+00:00")
    assert (row.observed_at, row.created) == ("2027-10-02 04:00:00.000Z", "2027-10-02 04:00:01.250Z")
    pb.collection.assert_called_with("aid_registration_ask_history")
    params = handle.get_full_list.call_args.kwargs["query_params"]
    assert params["filter"] == "year = 2027 && field_cm_id = 28906"
    assert set(params["fields"].split(",")) == {
        "id",
        "person_cm_id",
        "amount",
        "source_changed_at",
        "observed_at",
        "created",
    }


@pytest.mark.asyncio
async def test_the_dated_attendee_read_takes_every_status_with_both_dates() -> None:
    handle = MagicMock()
    handle.get_full_list.return_value = [
        SimpleNamespace(
            id="att000000000001",
            person_id=1000011,
            status_id=32,
            effective_date=datetime(2027, 7, 27),
            enrollment_date="2027-07-28 05:40:00.000Z",
            expand={"person": SimpleNamespace(household_id=1000001), "session": SimpleNamespace(cm_id=1000301)},
        )
    ]
    pb = MagicMock()
    pb.collection.return_value = handle
    (row,) = await FinancialAidIntakeRepository(pb).fetch_attendee_dates(2027)
    assert (row.person_cm_id, row.household_cm_id, row.session_cm_id, row.status_id) == (
        1000011,
        1000001,
        1000301,
        32,
    )
    assert (row.effective_date, row.enrollment_date) == ("2027-07-27 00:00:00.000Z", "2027-07-28 05:40:00.000Z")
    params = handle.get_full_list.call_args.kwargs["query_params"]
    assert params["filter"] == "year = 2027"  # any status: a cancelled same-day registration still makes an ask unclear
    assert {"effective_date", "enrollment_date", "status_id"} <= set(params["fields"].split(","))
