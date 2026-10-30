"""Form intake reads the adult aid Google Form (adult-aid form design PR 2, §10; owner answers 10-29).

  - A matched, live response is the aid form for its bucket FOR THAT PERSON (IN-FORM-ONLY): the adult stops reading
    "Registration ask only" / "No aid form for <program>". Their row's Form asked lists the response, its source
    "google_form".
  - Every response is listed (`form_responses`), each with its parsed figures and parse notes, narrative, signature
    line, agreement date, superseded responses and match evidence. Suggested, registered-elsewhere, not-registered
    and unmatched ones are the new "Responses to link" segment (counts.to_link, and Today's Form intake line).
    Ignored ones stay listed with the reason, who and when (owner Q3: they can be Link…ed to undo).
  - Needs a look gains form_changed_after_decision / form_response_deleted (GF-4), form_choice_unclear, and a
    refused pull (form_pull_refused).
  - Respondent email, POC, race/ethnicity and gender identity are never in this payload.
  - 2026 reads nothing new.

Fictional data only (tests/CLAUDE.md)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from api.schemas.financial_aid_form_intake import FormIntakeResponse, FormIntakeRowOut
from api.services.financial_aid_decisions_repository import decision_event
from api.services.financial_aid_form_intake import FormIntakeService
from api.services.financial_aid_google_form import FormResponseRow
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_today import _form_intake_line
from tests.unit.api.services.financial_aid_fakes import FakeAidStore, fa_row
from tests.unit.api.services.financial_aid_gform_fakes import (
    ADULT_WEEKEND_A,
    ADULT_WEEKEND_B,
    RACHEL,
    RACHEL_HOUSEHOLD,
    enrolled,
    form_response,
    gform_store,
)

SECRET_WORDS = ("Prefer not to say", "respondent@example.com", "Two or more races", "Nonbinary")


def _registration_only_rachel(*responses: FormResponseRow) -> FakeAidStore:
    """Rachel typed $400 on the adult-weekend registration and is enrolled for Adult Weekend A."""
    return gform_store(
        *responses,
        attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A),
        fa_rows=[fa_row(RACHEL, RACHEL_HOUSEHOLD, interest=True, registration_ask=400.0, weekend_interest=True,
                        weekend_ask=400.0)],
    )  # fmt: skip


async def _forms(store: FakeAidStore, year: int = 2027) -> FormIntakeResponse:
    await FinancialAidIntakeService(store).build(year)
    return await FormIntakeService(store).forms(year)


def _row(out: FormIntakeResponse, person: int) -> FormIntakeRowOut:
    (row,) = [r for r in out.rows if r.person_cm_id == person]
    return row


@pytest.mark.asyncio
async def test_without_a_response_the_adult_reads_registration_ask_only() -> None:
    out = await _forms(_registration_only_rachel())
    row = _row(out, RACHEL)
    assert (row.registration_only, row.registration_only_programs) == (True, ["adult_weekend"])


@pytest.mark.asyncio
async def test_a_matched_response_is_the_adults_form_for_her_bucket() -> None:
    out = await _forms(_registration_only_rachel(form_response()))
    row = _row(out, RACHEL)
    assert (row.filed, row.registration_only, row.registration_only_programs) == (True, False, [])
    (answer,) = row.answers
    assert (answer.program_key, answer.ask, answer.form_source, answer.named_session_cm_id) == (
        "adult_weekend",
        400.0,
        "google_form",
        ADULT_WEEKEND_A,
    )
    (became,) = row.became
    assert (became.status, became.origin, became.form_source) == ("active", "form", "google_form")
    assert out.counts.registration_only == 0


@pytest.mark.asyncio
async def test_a_campminder_answer_keeps_its_2026_json_shape() -> None:
    store = gform_store(attendees=enrolled(1000092, 1000009, 1000101))
    store.fa_rows = [fa_row(1000092, 1000009, summer="Session 2", summer_ask=1500.0, total_gross_income=90000.0)]
    out = await _forms(store, 2026)
    dumped = out.model_dump(mode="json")
    (answer,) = dumped["rows"][0]["answers"]
    assert "form_source" not in answer
    assert dumped["form_responses"] == []
    assert dumped["google_form"] is None
    assert 2026 not in store.form_years_read


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["suggested", "registered_elsewhere", "not_registered", "unmatched"])
async def test_an_unlinked_response_is_in_responses_to_link(status: str) -> None:
    candidates = ({"person_cm_id": RACHEL, "household_cm_id": RACHEL_HOUSEHOLD, "signals": ["name", "birthdate"],
                   "session_cm_ids": [ADULT_WEEKEND_A]},)  # fmt: skip
    out = await _forms(_registration_only_rachel(form_response(match_status=status, candidates=candidates)))
    (response,) = out.form_responses
    assert (response.match_status, response.to_link, response.row_key) == (status, True, "")
    (candidate,) = response.candidates
    assert (candidate.person_cm_id, candidate.signals) == (RACHEL, ["name", "birthdate"])
    assert out.counts.to_link == 1
    # Unlinked, it makes no request, so the adult still reads Registration ask only.
    assert _row(out, RACHEL).registration_only is True


@pytest.mark.asyncio
async def test_an_ignored_response_stays_listed_with_why_who_and_when_and_is_not_to_link() -> None:
    response = form_response(match_status="ignored", ignored_reason="A test entry")
    store = _registration_only_rachel(response)
    store.form_responses = [
        type(response)(**{**response.__dict__, "ignored_by": "registrar@example.com", "ignored_at": "2026-11-06 10:00:00.000Z"})
    ]  # fmt: skip
    out = await _forms(store)
    (listed,) = out.form_responses
    assert (listed.match_status, listed.to_link, listed.ignored_reason, listed.ignored_by, listed.ignored_at) == (
        "ignored",
        False,
        "A test entry",
        "registrar@example.com",
        "2026-11-06 10:00:00.000Z",
    )
    assert out.counts.to_link == 0


@pytest.mark.asyncio
async def test_the_opened_response_carries_figures_notes_narrative_signature_and_supersessions() -> None:
    older = form_response(match_status="superseded", superseded_by="resp-rachel-2", submitted="2026-11-05T17:00:00Z")
    newer = form_response(
        "resp-rachel-2",
        submitted="2026-11-09T09:00:00Z",
        special_circumstances="Lost my job in March.",
        notes={"ask": {"typed": "about 400", "read": 400.0, "note": "read 'about 400' as $400"}},
    )
    out = await _forms(_registration_only_rachel(older, newer))
    by_id = {r.response_id: r for r in out.form_responses}
    opened = by_id["resp-rachel-2"]
    assert opened.row_key == f"{RACHEL_HOUSEHOLD}:{RACHEL}"
    assert (opened.special_circumstances, opened.signature_typed, opened.agreement_date) == (
        "Lost my job in March.",
        "Rachel Garcia",
        "2026-11-05",
    )
    figures = {f.field: f for f in opened.figures}
    assert figures["ask"].value == 400.0
    assert figures["ask"].note == "read 'about 400' as $400"
    assert figures["total_gross_income"].value == 80000.0
    assert figures["total_gross_income"].note == ""
    assert [(s.response_id, s.submitted_at) for s in opened.superseded] == [("resp-rachel-1", "2026-11-05T17:00:00Z")]
    assert by_id["resp-rachel-1"].to_link is False


@pytest.mark.asyncio
async def test_an_unread_figure_is_listed_as_unknown_not_zero() -> None:
    response = form_response(
        total_gross_income=0.0,
        reported=("expected_gross_income",),
        notes={"total_gross_income": {"typed": "80-90k", "read": None, "note": "a range: not read"}},
    )
    out = await _forms(_registration_only_rachel(response))
    (listed,) = out.form_responses
    figure = next(f for f in listed.figures if f.field == "total_gross_income")
    assert (figure.value, figure.typed, figure.note) == (None, "80-90k", "a range: not read")


@pytest.mark.asyncio
async def test_no_sensitive_answer_reaches_the_payload() -> None:
    out = await _forms(_registration_only_rachel(form_response()))
    text = json.dumps(out.model_dump(mode="json"))
    for key in ("respondent_email", "poc", "race_ethnicity", "gender_identity"):
        assert f'"{key}"' not in text
    for word in SECRET_WORDS:
        assert word not in text


@pytest.mark.asyncio
async def test_a_changed_after_decision_request_needs_a_look() -> None:
    store = _registration_only_rachel(form_response())
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    store.decision_events.append(
        decision_event(SimpleNamespace(id="dec000000000001", request=request.id, round=1, event="award", amount=300,
                                       created=datetime(2026, 12, 1, tzinfo=UTC), actor="registrar@example.com"))
    )  # fmt: skip
    store.form_responses = [form_response(submitted="2026-12-10T09:00:00Z", ask=900.0)]
    out = await _forms(store)
    row = _row(out, RACHEL)
    assert (row.needs_look, "form_changed_after_decision" in row.look_reasons) == (True, True)


@pytest.mark.asyncio
async def test_an_unclear_choice_needs_a_look() -> None:
    out = await _forms(_registration_only_rachel(form_response(weekend=0)))
    assert "form_choice_unclear" in _row(out, RACHEL).look_reasons
    (listed,) = out.form_responses
    assert "form_choice_unclear" in listed.look_reasons


@pytest.mark.asyncio
async def test_a_refused_pull_shows_and_counts() -> None:
    store = _registration_only_rachel(form_response())
    store.google_form_status = {
        "last_pulled_at": "2026-11-09 14:20:00.000Z",
        "last_pull_status": "refused: 4 of 6 responses missing",
    }
    out = await _forms(store)
    assert out.google_form is not None
    assert (out.google_form.refused, out.google_form.last_pulled_at) == (True, "2026-11-09 14:20:00.000Z")
    assert out.counts.needs_look == 1
    summary = await FormIntakeService(store).summary(2027)
    assert (summary.needs_look, summary.to_link) == (1, 0)


@pytest.mark.asyncio
async def test_todays_form_intake_line_counts_responses_to_link_and_a_refused_pull() -> None:
    store = _registration_only_rachel(form_response(match_status="suggested"))
    store.google_form_status = {"last_pulled_at": "", "last_pull_status": "refused: 0 of 6 responses returned"}
    await FinancialAidIntakeService(store).build(2027)
    look = await FormIntakeService(store).needs_a_look(2027)
    assert (look.to_link, look.pull_refused) == (1, True)
    line = _form_intake_line(look)
    codes = {r.code: r.items for r in line.reasons}
    assert (codes.get("form_response_to_link"), codes.get("form_pull_refused")) == (1, 1)
    assert line.items == len(look.rows) + 2


# -- What PR 3's screen reads (the lead's additions, 10-29) --------------------------------------------------------


@pytest.mark.asyncio
async def test_became_carries_the_form_change_until_reviewed_and_after() -> None:
    from api.services.financial_aid_google_form_writes import FormResponseCaseworkService

    store = _registration_only_rachel(form_response())
    service = FinancialAidIntakeService(store)
    await service.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    out = await FormIntakeService(store).forms(2027)
    (became,) = _row(out, RACHEL).became
    assert became.form_change is None
    store.decision_events.append(
        decision_event(SimpleNamespace(id="dec000000000001", request=request.id, round=1, event="award", amount=300,
                                       created=datetime(2026, 12, 1, tzinfo=UTC), actor="registrar@example.com"))
    )  # fmt: skip
    store.form_responses = [form_response(form_status="deleted")]
    out = await _forms(store)
    (became,) = _row(out, RACHEL).became
    assert became.form_change is not None
    assert (became.form_change.kind, became.form_change.reviewed) == ("deleted", False)
    await FormResponseCaseworkService(store).review_form_change(2027, request.id, "registrar@example.com")
    out = await _forms(store)
    row = _row(out, RACHEL)
    (became,) = row.became
    assert became.form_change is not None
    assert (became.form_change.kind, became.form_change.reviewed) == ("deleted", True)
    assert became.form_change.at
    assert "form_response_deleted" not in row.look_reasons


@pytest.mark.asyncio
async def test_became_says_when_the_request_has_no_price_yet() -> None:
    from tests.unit.api.services.financial_aid_fakes import intake_rules
    from tests.unit.bunking.financial_aid.fixtures import with_lever

    priced = await _forms(_registration_only_rachel(form_response()))  # the fixture's catalog prices Weekend A
    (became,) = _row(priced, RACHEL).became
    assert became.price_missing is False
    store = _registration_only_rachel(form_response())
    store.rules = with_lever(intake_rules(), "cost.tuition", {"1000101": "2000"})
    out = await _forms(store)
    (became,) = _row(out, RACHEL).became
    assert became.price_missing is True


@pytest.mark.asyncio
async def test_a_2026_became_carries_neither_new_field() -> None:
    store = gform_store(attendees=enrolled(1000092, 1000009, 1000101))
    store.fa_rows = [fa_row(1000092, 1000009, summer="Session 2", summer_ask=1500.0, total_gross_income=90000.0)]
    out = await _forms(store, 2026)
    (became,) = out.model_dump(mode="json")["rows"][0]["became"]
    assert not {"form_source", "form_change", "price_missing"} & set(became)


@pytest.mark.asyncio
async def test_the_pull_status_reads_how_many_were_returned_of_how_many() -> None:
    store = _registration_only_rachel(form_response())
    store.google_form_status = {
        "last_pulled_at": "2026-11-09 14:20:00.000Z",
        "last_pull_status": "refused: 4 of 6 responses missing · 2 responses · 1 linked · 0 to link",
    }
    out = await _forms(store)
    assert out.google_form is not None
    assert (out.google_form.returned, out.google_form.expected) == (2, 6)
    store.google_form_status = {"last_pulled_at": "", "last_pull_status": "ok · 12 responses · 10 linked · 2 to link"}
    out = await _forms(store)
    assert out.google_form is not None
    assert (out.google_form.refused, out.google_form.returned, out.google_form.expected) == (False, 12, None)


@pytest.mark.asyncio
async def test_a_superseded_response_shows_its_ask_income_and_when_it_was_replaced() -> None:
    older = form_response(match_status="superseded", superseded_by="resp-rachel-2", ask=300.0)
    newer = form_response("resp-rachel-2", submitted="2026-11-09T09:00:00Z", unemployment=True)
    out = await _forms(_registration_only_rachel(older, newer))
    opened = next(r for r in out.form_responses if r.response_id == "resp-rachel-2")
    (replaced,) = opened.superseded
    assert (replaced.ask, replaced.total_gross_income, replaced.replaced_at) == (300.0, 80000.0, "2026-11-09T09:00:00Z")
    assert opened.unemployment is True


@pytest.mark.asyncio
async def test_an_ignored_response_shows_its_kind() -> None:
    response = form_response(match_status="ignored")
    store = _registration_only_rachel(type(response)(**{**response.__dict__, "ignored_kind": "duplicate"}))
    out = await _forms(store)
    (listed,) = out.form_responses
    assert listed.ignored_kind == "duplicate"


# -- PR 3: what the Form intake screen draws from a response it cannot link on its own -------------------------------


@pytest.mark.asyncio
async def test_a_candidate_is_named_with_its_household_and_registration() -> None:
    """The Responses to link row names who it may be ("Suggested: Camper 1000091 · name and birthdate"), so each
    candidate carries their name, household and how they are registered; never their birthdate or email."""
    candidates = ({"person_cm_id": RACHEL, "household_cm_id": RACHEL_HOUSEHOLD, "signals": ["name", "birthdate"],
                   "session_cm_ids": [ADULT_WEEKEND_A]},)  # fmt: skip
    store = _registration_only_rachel(form_response(match_status="suggested", candidates=candidates))
    store.attendees = enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A, status=4)
    out = await _forms(store)
    (candidate,) = out.form_responses[0].candidates
    assert (candidate.camper_name, candidate.household_label, candidate.registration_status) == (
        f"Camper {RACHEL}",
        f"Family {RACHEL_HOUSEHOLD}",
        "applied",
    )
    dumped = out.model_dump(mode="json")["form_responses"][0]["candidates"][0]
    assert "birthdate" not in dumped
    assert "email" not in dumped


@pytest.mark.asyncio
async def test_the_sessions_name_every_weekend_a_response_or_candidate_names() -> None:
    """A registered-elsewhere response chose one weekend and its candidate registered for another; no Form intake row
    references either, yet the screen names both ("Chose AW B, registered for AW A")."""
    candidates = ({"person_cm_id": RACHEL, "household_cm_id": RACHEL_HOUSEHOLD, "signals": ["name", "birthdate"],
                   "session_cm_ids": [ADULT_WEEKEND_B], "elsewhere": True},)  # fmt: skip
    store = gform_store(
        form_response(match_status="registered_elsewhere", weekend=ADULT_WEEKEND_A, candidates=candidates),
        attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_B),
    )
    out = await _forms(store)
    named = {s.session_cm_id for s in out.sessions}
    assert {ADULT_WEEKEND_A, ADULT_WEEKEND_B} <= named


@pytest.mark.asyncio
async def test_a_response_deleted_in_google_stays_on_its_persons_row() -> None:
    """A deleted response no longer makes a request, but its person's row still opens onto it (mock v2 step 3: the
    response is marked, never dropped), so it keeps that row's key rather than reading as a response no one holds."""
    out = await _forms(_registration_only_rachel(form_response(form_status="deleted")))
    (response,) = out.form_responses
    assert response.row_key == f"{RACHEL_HOUSEHOLD}:{RACHEL}"
