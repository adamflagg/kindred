"""Staff's writes on adult aid form responses (adult-aid form design PR 2, §5; owner answers 10-29).

  - Link…: a response goes to a person registered this season; match_status "staff" (PR 1's job never re-matches
    it), linked_by / linked_at, and the person's own household. An ignored response can be Link…ed (owner Q3: the
    undo).
  - Ignore…: a reason is required; who and when are kept.
  - Mark Reviewed (owner Q2): clears a request's form_changed_after_decision / form_response_deleted look until the
    next DIFFERENT change.
  - The respondent email appears only on the link-candidates read.
Every write is one aid_change_log operation with the actor and reason, as casework writes are.

Fictional data only (tests/CLAUDE.md)."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from api.services.financial_aid_casework_service import CaseworkNotFoundError, CaseworkValidationError
from api.services.financial_aid_decisions_repository import decision_event
from api.services.financial_aid_google_form_writes import FormResponseCaseworkService
from api.services.financial_aid_intake_service import FinancialAidIntakeService, season_lock
from api.services.financial_aid_intake_types import AttendeeRow
from tests.unit.api.services.financial_aid_gform_fakes import (
    ACTOR,
    ADULT_WEEKEND_A,
    RACHEL,
    RACHEL_HOUSEHOLD,
    enrolled,
    form_response,
    gform_store,
)

CANDIDATES = (
    {"person_cm_id": RACHEL, "household_cm_id": RACHEL_HOUSEHOLD, "signals": ["name"],
     "session_cm_ids": [ADULT_WEEKEND_A]},
)  # fmt: skip


def _suggested_store(**kwargs: object) -> object:
    response = form_response(match_status="suggested", candidates=CANDIDATES, **kwargs)  # type: ignore[arg-type]
    store = gform_store(response, attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A, status=8))
    store.respondent_emails = {response.id: "rachel@example.com"}
    return store


@pytest.mark.asyncio
async def test_link_sets_staff_the_person_their_household_and_who_and_logs_it() -> None:
    store = _suggested_store()
    (response,) = store.form_responses  # type: ignore[attr-defined]
    out = await FormResponseCaseworkService(store).link(2027, response.id, RACHEL, "Typed a nickname", ACTOR)  # type: ignore[arg-type]
    assert (out.match_status, out.person_cm_id, out.household_cm_id, out.linked_by) == (
        "staff",
        RACHEL,
        RACHEL_HOUSEHOLD,
        ACTOR,
    )
    assert out.linked_at
    (row,) = store.form_responses  # type: ignore[attr-defined]
    assert (row.match_status, row.person_cm_id, row.household_cm_id, row.linked_by) == (
        "staff",
        RACHEL,
        RACHEL_HOUSEHOLD,
        ACTOR,
    )
    (logged,) = [r for r in store.change_log if r["entity"] == "aid_form_responses"]  # type: ignore[attr-defined]
    assert (logged["actor"], logged["reason"], logged["action"]) == (ACTOR, "Typed a nickname", "link_form_response")
    assert logged["after"]["match_status"] == "staff"


@pytest.mark.asyncio
async def test_link_refuses_a_person_not_registered_this_season() -> None:
    store = _suggested_store()
    (response,) = store.form_responses  # type: ignore[attr-defined]
    with pytest.raises(CaseworkValidationError, match="registered"):
        await FormResponseCaseworkService(store).link(2027, response.id, 1000999, "", ACTOR)  # type: ignore[arg-type]
    assert store.change_log == []  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_link_refuses_a_response_that_names_no_program() -> None:
    # A response with no program choice makes no request whoever it is linked to, so Link… refuses it rather than
    # taking it off Responses to link with nothing to show for it (Ignore… is the way to clear it).
    store = _suggested_store(program="", choice="")
    (response,) = store.form_responses  # type: ignore[attr-defined]
    with pytest.raises(CaseworkValidationError, match="program"):
        await FormResponseCaseworkService(store).link(2027, response.id, RACHEL, "", ACTOR)  # type: ignore[arg-type]
    assert store.change_log == []  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_link_refuses_an_unknown_response_or_another_seasons() -> None:
    store = _suggested_store()
    (response,) = store.form_responses  # type: ignore[attr-defined]
    service = FormResponseCaseworkService(store)  # type: ignore[arg-type]
    with pytest.raises(CaseworkNotFoundError):
        await service.link(2027, "nosuchrecord000", RACHEL, "", ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await service.link(2028, response.id, RACHEL, "", ACTOR)


@pytest.mark.asyncio
async def test_a_linked_response_makes_its_request_at_the_next_rebuild() -> None:
    store = _suggested_store()
    (response,) = store.form_responses  # type: ignore[attr-defined]
    await FormResponseCaseworkService(store).link(2027, response.id, RACHEL, "", ACTOR)  # type: ignore[arg-type]
    await FinancialAidIntakeService(store).build(2027)  # type: ignore[arg-type]
    request = store.request_for(person=RACHEL, program="adult_weekend")  # type: ignore[attr-defined]
    assert request.form_response_id == response.response_id


@pytest.mark.asyncio
async def test_ignore_keeps_its_kind_who_and_when_and_needs_a_reason_only_for_other() -> None:
    store = _suggested_store()
    (response,) = store.form_responses  # type: ignore[attr-defined]
    service = FormResponseCaseworkService(store)  # type: ignore[arg-type]
    with pytest.raises(CaseworkValidationError, match="reason"):
        await service.ignore(2027, response.id, "other", "  ", ACTOR)
    with pytest.raises(CaseworkValidationError, match="kind"):
        await service.ignore(2027, response.id, "spam", "", ACTOR)
    out = await service.ignore(2027, response.id, "test", "", ACTOR)
    assert (out.match_status, out.ignored_kind, out.ignored_reason, out.ignored_by) == ("ignored", "test", "", ACTOR)
    assert out.ignored_at
    (logged,) = [r for r in store.change_log if r["entity"] == "aid_form_responses"]  # type: ignore[attr-defined]
    assert (logged["action"], logged["reason"]) == ("ignore_form_response", "Ignored: test")
    other = await service.ignore(2027, response.id, "other", "Sent twice by mistake", ACTOR)
    assert (other.ignored_kind, other.ignored_reason) == ("other", "Sent twice by mistake")


@pytest.mark.asyncio
async def test_an_ignored_response_can_be_linked_to_undo_the_ignore() -> None:
    store = _suggested_store()
    (response,) = store.form_responses  # type: ignore[attr-defined]
    service = FormResponseCaseworkService(store)  # type: ignore[arg-type]
    await service.ignore(2027, response.id, "other", "Looked like a test", ACTOR)
    out = await service.link(2027, response.id, RACHEL, "It was real", ACTOR)
    assert (out.match_status, out.ignored_kind, out.ignored_reason, out.ignored_by) == ("staff", "", "", "")


@pytest.mark.asyncio
async def test_the_link_candidates_read_carries_the_respondent_email_and_named_candidates() -> None:
    store = _suggested_store()
    store.person_contacts = {RACHEL: ("1971-04-02", "rgarcia@example.com")}  # type: ignore[attr-defined]
    (response,) = store.form_responses  # type: ignore[attr-defined]
    out = await FormResponseCaseworkService(store).link_candidates(2027, response.id)  # type: ignore[arg-type]
    assert (out.respondent_email, out.name_typed, out.program_choice) == (
        "rachel@example.com",
        "Rachel Garcia",
        "Adult Weekend A (Sep 10-12)",
    )
    (candidate,) = out.candidates
    assert (candidate.person_cm_id, candidate.camper_name, candidate.household_label, candidate.signals) == (
        RACHEL,
        f"Camper {RACHEL}",
        f"Family {RACHEL_HOUSEHOLD}",
        ["name"],
    )
    assert (candidate.registration_status, candidate.birthdate, candidate.email) == (
        "waitlisted",
        "1971-04-02",
        "rgarcia@example.com",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("query", [str(1000092), "Liam Garcia", "2015-06-01"])
async def test_the_candidates_search_finds_people_registered_this_season(query: str) -> None:
    store = _suggested_store()
    liam, liam_household = 1000092, 1000009
    store.attendees.append(AttendeeRow(liam, liam_household, 1000101, 2))  # type: ignore[attr-defined]
    store.searchable_people = [  # type: ignore[attr-defined]
        SimpleNamespace(cm_id=liam, household_id=liam_household, first_name="Liam", last_name="Garcia",
                        birthdate="2015-06-01"),
        SimpleNamespace(cm_id=1000999, household_id=1000099, first_name="Liam", last_name="Garcia",
                        birthdate="2015-06-01"),  # not registered this season: never offered
    ]  # fmt: skip
    (response,) = store.form_responses  # type: ignore[attr-defined]
    out = await FormResponseCaseworkService(store).link_candidates(2027, response.id, query)  # type: ignore[arg-type]
    (found,) = out.candidates
    assert (found.person_cm_id, found.household_cm_id, found.signals, found.registration_status) == (
        liam,
        liam_household,
        [],
        "enrolled",
    )
    assert found.session_cm_ids == [1000101]


@pytest.mark.asyncio
async def test_mark_reviewed_clears_the_look_until_the_next_different_change() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    intake = FinancialAidIntakeService(store)
    await intake.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    store.decision_events.append(
        decision_event(SimpleNamespace(id="dec000000000001", request=request.id, round=1, event="award", amount=300,
                                       created=datetime(2026, 12, 1, tzinfo=UTC), actor=ACTOR))
    )  # fmt: skip
    store.form_responses = [form_response(submitted="2026-12-10T09:00:00Z", ask=900.0)]
    await intake.build(2027)
    assert any(f.get("code") == "form_changed_after_decision" for f in store.requests[request.id].flags)

    service = FormResponseCaseworkService(store)
    out = await service.review_form_change(2027, request.id, ACTOR)
    assert (out.request_id, out.reviewed_by) == (request.id, ACTOR)
    assert not any(f.get("code") == "form_changed_after_decision" for f in store.requests[request.id].flags)
    await intake.build(2027)  # the same change again: still reviewed
    assert not any(f.get("code") == "form_changed_after_decision" for f in store.requests[request.id].flags)
    assert store.requests[request.id].ask == 400.0  # reviewed is not applied

    store.form_responses = [form_response(submitted="2026-12-20T09:00:00Z", ask=950.0)]
    await intake.build(2027)  # a different change: the look is back
    assert any(f.get("code") == "form_changed_after_decision" for f in store.requests[request.id].flags)


@pytest.mark.asyncio
async def test_mark_reviewed_waits_for_its_seasons_build_and_reads_the_request_inside_it() -> None:
    # Mark Reviewed rewrites the request's flags, which intake's build also writes: like casework's writers it takes
    # season_lock and re-reads the request inside it, so neither commits over the other's flags.
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    intake = FinancialAidIntakeService(store)
    await intake.build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    store.decision_events.append(
        decision_event(SimpleNamespace(id="dec000000000001", request=request.id, round=1, event="award", amount=300,
                                       created=datetime(2026, 12, 1, tzinfo=UTC), actor=ACTOR))
    )  # fmt: skip
    store.form_responses = [form_response(submitted="2026-12-10T09:00:00Z", ask=900.0)]
    await intake.build(2027)
    operations = len(store.operations)
    async with season_lock(2027):  # a build of the season is running
        task = asyncio.create_task(FormResponseCaseworkService(store).review_form_change(2027, request.id, ACTOR))
        for _ in range(20):
            await asyncio.sleep(0)
        assert not task.done()
        assert len(store.operations) == operations
        flagged = store.requests[request.id]
        store.requests[request.id] = replace(flagged, flags=(*flagged.flags, {"code": "build_only", "detail": {}}))
    await asyncio.wait_for(task, 5)
    codes = [f.get("code") for f in store.requests[request.id].flags]
    assert "build_only" in codes  # read after the build, so its flag survives
    assert "form_changed_after_decision" not in codes


@pytest.mark.asyncio
async def test_mark_reviewed_refuses_a_request_with_nothing_to_review() -> None:
    store = gform_store(form_response(), attendees=enrolled(RACHEL, RACHEL_HOUSEHOLD, ADULT_WEEKEND_A))
    await FinancialAidIntakeService(store).build(2027)
    request = store.request_for(person=RACHEL, program="adult_weekend")
    with pytest.raises(CaseworkValidationError, match="nothing"):
        await FormResponseCaseworkService(store).review_form_change(2027, request.id, ACTOR)
