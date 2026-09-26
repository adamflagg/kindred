"""The intake planner: idempotent, never wipes staff work (campership sub-project 5)."""

from __future__ import annotations

from typing import Any

from api.services.financial_aid_billing import BilledHeadcount
from api.services.financial_aid_household import RequestSpec
from api.services.financial_aid_intake_plan import HouseholdIntake, StatusChange, plan_intake
from api.services.financial_aid_intake_types import ApplicationRecord, Flag, RequestRecord, SessionResolution
from api.services.financial_aid_session_resolver import normalize_option_text

ANSWERS = {"total_gross_income": 85000.0}


def spec(
    *,
    person: int = 1000011,
    household: int = 1000001,
    program: str = "summer",
    text: str = "Session 2",
    session: int = 1000101,
    enrolled: frozenset[int] = frozenset({1000101}),
    ask: float = 1500.0,
) -> RequestSpec:
    method = "exact" if session else "unmatched"
    return RequestSpec(
        household,
        person,
        program,
        text,
        normalize_option_text(text),
        ask,
        SessionResolution(session, method, (session,) if session else ()),
        enrolled,
        (),
    )


def household(*specs: RequestSpec, household_cm_id: int = 1000001) -> HouseholdIntake:
    members = tuple(sorted({s.person_cm_id for s in specs if s.person_cm_id}))
    return HouseholdIntake(household_cm_id, members, ANSWERS, (), specs)


def app(*, household_cm_id: int = 1000001, status: str = "active", rid: str = "app000000000001") -> ApplicationRecord:
    return ApplicationRecord(rid, 2027, household_cm_id, status, ANSWERS, (1000011,), ())


def record(s: RequestSpec, rid: str, **overrides: Any) -> RequestRecord:
    fields: dict[str, Any] = {
        "id": rid,
        "year": 2027,
        "application_id": "app000000000001",
        "household_cm_id": s.household_cm_id,
        "person_cm_id": s.person_cm_id,
        "session_cm_id": s.resolution.session_cm_id,
        "program_key": s.program_key,
        "program_option_text": s.program_option_text,
        "program_option_key": s.program_option_key,
        "session_resolution": s.resolution.method,
        "ask": s.ask,
        "headcount_non_infant": 0,
        "headcount_infant": 0,
        "headcount_source": "",
        "status": "active",
        "duplicate_of": "",
        "flags": (),
    }
    fields.update(overrides)
    return RequestRecord(**fields)


def test_a_new_household_creates_its_application_and_request() -> None:
    plan = plan_intake([household(spec())], [], [], {})
    assert plan.application_creates == [
        (1000001, {"status": "active", "answers": ANSWERS, "member_person_cm_ids": [1000011], "flags": []})
    ]
    (create,) = plan.request_creates
    assert (create.ref, create.duplicate_of_ref) == ("new:0", "")
    assert (create.payload["status"], create.payload["session_cm_id"]) == ("active", 1000101)
    assert "created" not in create.payload
    assert plan.share_creates == ["new:0"]  # its default payer share


def test_an_unchanged_household_plans_no_writes() -> None:
    s = spec()
    assert plan_intake(
        [household(s)], [app()], [record(s, "req000000000001")], {}, frozenset({"req000000000001"})
    ).is_empty


def test_an_existing_request_with_no_payer_share_gets_its_default_and_one_with_a_share_does_not() -> None:
    s, other = (
        spec(),
        spec(
            program="bmitzvah", text="B*Mitzvah Program Year 1 - North", session=1000301, enrolled=frozenset({1000301})
        ),
    )
    existing = [record(s, "req000000000001"), record(other, "req000000000002")]
    plan = plan_intake([household(s, other)], [app()], existing, {}, frozenset({"req000000000002"}))
    assert plan.share_creates == ["req000000000001"]


def test_a_duplicate_or_withdrawn_request_gets_no_payer_share() -> None:
    s = spec()
    marked = record(s, "req000000000002", status="duplicate", duplicate_of="req000000000001")
    gone = record(spec(text="Session 2a", session=1000102), "req000000000003", status="withdrawn")
    plan = plan_intake([household(s)], [app()], [marked, gone], {})
    assert plan.share_creates == []


_IDENTITY_AND_SYSTEM = {
    "created",
    "updated",
    "year",
    "application",
    "household_cm_id",
    "person_cm_id",
    "program_key",
    "program_option_key",
}


def test_a_rebuild_never_rewrites_created_or_a_requests_identity() -> None:
    s = spec()
    stale = record(s, "req000000000001", ask=900.0, status="withdrawn", flags=({"code": "x", "detail": {}},))
    plan = plan_intake([household(s)], [app()], [stale], {}, frozenset({"req000000000001"}))
    (update,) = plan.request_updates
    assert update[1]
    assert not (_IDENTITY_AND_SYSTEM & update[1].keys())


def test_a_staff_resolved_session_survives_an_unmatched_rerun() -> None:
    s = spec(text="Session 2 (All-Gender Cabin)", session=0)
    staff = record(s, "req000000000001", session_cm_id=1000103, session_resolution="staff", status="active")
    plan = plan_intake([household(s)], [app()], [staff], {})
    (update,) = plan.request_updates
    assert update[0] == "req000000000001"
    assert "session_cm_id" not in update[1]
    assert "status" not in update[1]
    assert update[1]["flags"] == [{"code": "not_enrolled", "detail": {"session_cm_id": 1000103}}]


def test_a_request_whose_answer_is_gone_is_withdrawn_not_deleted() -> None:
    s = spec()
    plan = plan_intake(
        [
            household(
                spec(
                    program="bmitzvah",
                    text="B*Mitzvah Program Year 1 - North",
                    session=1000301,
                    enrolled=frozenset({1000301}),
                )
            )
        ],
        [app()],
        [record(s, "req000000000001")],
        {},
    )
    assert ("req000000000001", {"status": "withdrawn"}) in plan.request_updates
    assert StatusChange("aid_requests", "req000000000001", "active", "withdrawn") in plan.status_changes


def test_a_withdrawn_request_comes_back_when_its_answer_returns() -> None:
    s = spec()
    plan = plan_intake([household(s)], [app()], [record(s, "req000000000001", status="withdrawn")], {})
    assert plan.request_updates == [("req000000000001", {"status": "active"})]


def test_a_second_request_for_the_same_camper_and_session_waits_as_a_duplicate() -> None:
    holder = spec(text="Session 2")
    newcomer = spec(program="bmitzvah", text="Session 2 again", session=1000101)
    plan = plan_intake([household(holder, newcomer)], [app()], [record(holder, "req000000000001")], {})
    (create,) = plan.request_creates
    assert create.payload["status"] == "duplicate_pending"
    assert create.duplicate_of_ref == "req000000000001"


def test_two_new_colliding_family_requests_point_the_second_at_the_first() -> None:
    first = spec(person=0, program="family_camp", text="Family Camp 6", session=1000202, enrolled=frozenset({1000202}))
    second = spec(
        person=0, program="family_camp", text="Family Camp 6 weekend", session=1000202, enrolled=frozenset({1000202})
    )
    plan = plan_intake([household(first, second)], [], [], {})
    statuses = [(c.ref, c.payload["status"], c.duplicate_of_ref) for c in plan.request_creates]
    assert statuses == [("new:0", "active", ""), ("new:1", "duplicate_pending", "new:0")]


def test_a_staff_marked_duplicate_stays_a_duplicate() -> None:
    s = spec()
    marked = record(s, "req000000000002", status="duplicate", duplicate_of="req000000000001")
    plan = plan_intake([household(s)], [app()], [marked], {})
    assert all("status" not in changes for _, changes in plan.request_updates)


def test_billing_fills_a_family_request_headcount() -> None:
    s = spec(person=0, program="family_camp", text="Family Camp 6", session=1000202, enrolled=frozenset({1000202}))
    plan = plan_intake([household(s)], [], [], {(1000001, 1000202): BilledHeadcount(3, 1)})
    payload = plan.request_creates[0].payload
    assert (payload["headcount_non_infant"], payload["headcount_infant"], payload["headcount_source"]) == (
        3,
        1,
        "billed",
    )
    assert payload["flags"] == []


def test_a_staff_headcount_is_never_overwritten_and_a_disagreeing_bill_is_flagged() -> None:
    s = spec(person=0, program="family_camp", text="Family Camp 6", session=1000202, enrolled=frozenset({1000202}))
    staff = record(s, "req000000000001", headcount_non_infant=4, headcount_infant=0, headcount_source="declared")
    plan = plan_intake([household(s)], [app()], [staff], {(1000001, 1000202): BilledHeadcount(3, 1)})
    (update,) = plan.request_updates
    assert not {"headcount_non_infant", "headcount_infant", "headcount_source"} & update[1].keys()
    assert update[1]["flags"] == [{"code": "billing_disagrees", "detail": {"billed_non_infant": 3, "billed_infant": 1}}]


def test_a_bill_the_infant_cutoff_reclassed_is_flagged_for_staff() -> None:
    s = spec(person=0, program="family_camp", text="Family Camp 6", session=1000202, enrolled=frozenset({1000202}))
    billed = {(1000001, 1000202): BilledHeadcount(4, 0, reclassified=1)}
    payload = plan_intake([household(s)], [], [], billed).request_creates[0].payload
    assert (payload["headcount_non_infant"], payload["headcount_infant"], payload["headcount_source"]) == (
        4,
        0,
        "billed",
    )
    assert payload["flags"] == [{"code": "infant_age_reclassified", "detail": {"count": 1}}]


_WAITING = Flag("awaiting_approved_rules", {"sections": ["programs", "cost"]})


def test_without_approved_rules_a_request_is_still_created_and_waits_visibly() -> None:  # owner ruling Q4
    plan = plan_intake([household(spec())], [], [], {}, rules_check=lambda session_cm_id: [_WAITING])
    (create,) = plan.request_creates
    assert create.payload["status"] == "active"
    assert create.payload["flags"] == [_WAITING.to_json()]
    assert plan.share_creates == ["new:0"]


def test_the_waiting_flag_clears_once_the_rules_raise_nothing_and_the_request_is_kept() -> None:
    s = spec()
    waiting = record(s, "req000000000001", flags=(_WAITING.to_json(),))
    plan = plan_intake([household(s)], [app()], [waiting], {}, frozenset({"req000000000001"}), lambda session_cm_id: [])
    assert plan.request_updates == [("req000000000001", {"flags": []})]
    assert plan.request_creates == []


def test_an_unmatched_request_is_not_checked_against_the_rules() -> None:
    s = spec(text="Session 9", session=0)
    plan = plan_intake([household(s)], [], [], {}, rules_check=lambda session_cm_id: [_WAITING])
    assert [f["code"] for f in plan.request_creates[0].payload["flags"]] == ["unmatched_session"]


def test_missing_billing_leaves_the_headcount_unknown_and_flagged() -> None:
    s = spec(person=0, program="family_camp", text="Family Camp 6", session=1000202, enrolled=frozenset({1000202}))
    payload = plan_intake([household(s)], [], [], {}).request_creates[0].payload
    assert (payload["headcount_non_infant"], payload["headcount_infant"], payload["headcount_source"]) == (0, 0, "")
    assert payload["flags"] == [Flag("family_camp_headcount_missing", {}).to_json()]


def test_an_unmatched_request_lists_its_candidates() -> None:
    s = spec(text="Taste of Camp", session=0)
    s = RequestSpec(
        s.household_cm_id,
        s.person_cm_id,
        s.program_key,
        s.program_option_text,
        s.program_option_key,
        s.ask,
        SessionResolution(0, "unmatched", (1000104, 1000105)),
        s.enrolled_session_ids,
        (),
    )
    payload = plan_intake([household(s)], [], [], {}).request_creates[0].payload
    assert payload["status"] == "unmatched_session"
    assert payload["flags"] == [{"code": "unmatched_session", "detail": {"candidates": [1000104, 1000105]}}]


def test_a_changed_program_answer_withdraws_the_old_request_and_creates_a_new_one() -> None:  # Review Focus 5
    old = spec(text="Session 2")
    corrected = record(old, "req000000000001", session_resolution="staff", ask=1500.0)
    edited = spec(text="Session 2a", session=1000102, enrolled=frozenset({1000102}))
    plan = plan_intake([household(edited)], [app()], [corrected], {})
    assert plan.request_updates == [("req000000000001", {"status": "withdrawn"})]
    assert [c.payload["program_option_key"] for c in plan.request_creates] == ["session 2a"]


def test_a_household_with_no_requests_left_withdraws_its_application() -> None:
    plan = plan_intake([], [app()], [], {})
    assert plan.application_updates == [("app000000000001", {"status": "withdrawn"})]
    assert plan.status_changes == [StatusChange("aid_applications", "app000000000001", "active", "withdrawn")]
