"""The intake planner: idempotent, never wipes staff work (campership sub-project 5)."""

from __future__ import annotations

from typing import Any

from api.services.financial_aid_billing import BilledHeadcount
from api.services.financial_aid_household import RequestSpec
from api.services.financial_aid_intake_plan import HouseholdIntake, StatusChange, plan_intake
from api.services.financial_aid_intake_types import (
    ApplicationRecord,
    EquityAnswers,
    Flag,
    RequestRecord,
    SessionResolution,
)
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
    named: int = 0,
) -> RequestSpec:
    method = "enrollment" if session else "unmatched"
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
        named,
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
    s, kept = spec(), spec(household=1000002)  # the other parent's request, kept by staff
    survivor = record(kept, "req000000000001")
    marked = record(s, "req000000000002", status="duplicate", duplicate_of="req000000000001")
    gone = record(spec(text="Session 2a", session=1000102), "req000000000003", status="withdrawn")
    plan = plan_intake(
        [household(s), household(kept, household_cm_id=1000002)],
        [app()],
        [survivor, marked, gone],
        {},
        frozenset({"req000000000001"}),
    )
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
    s, kept = spec(), spec(household=1000002)  # the other parent's request, kept by staff
    survivor = record(kept, "req000000000001")
    marked = record(s, "req000000000002", status="duplicate", duplicate_of="req000000000001")
    plan = plan_intake([household(s), household(kept, household_cm_id=1000002)], [app()], [survivor, marked], {})
    assert all("status" not in changes and "duplicate_of" not in changes for _, changes in plan.request_updates)


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


# Registration first (owner ruling 2026-09-27): only a STAFF resolution is kept across rebuilds;
# every other request takes the fresh resolution, so it follows the camper's registration.


def test_a_request_re_resolves_when_the_campers_registration_changes() -> None:
    before = spec()
    moved = spec(text="Session 2", session=1000102, enrolled=frozenset({1000102}))
    plan = plan_intake(
        [household(moved)], [app()], [record(before, "req000000000001")], {}, frozenset({"req000000000001"})
    )
    assert plan.request_updates == [("req000000000001", {"session_cm_id": 1000102})]


def test_an_unmatched_request_lands_once_the_camper_enrolls() -> None:
    early = spec(session=0, enrolled=frozenset())
    waiting = record(
        early,
        "req000000000001",
        status="unmatched_session",
        flags=({"code": "unmatched_session", "detail": {"candidates": []}},),
    )
    plan = plan_intake([household(spec())], [app()], [waiting], {}, frozenset({"req000000000001"}))
    assert plan.request_updates == [
        (
            "req000000000001",
            {"session_cm_id": 1000101, "session_resolution": "enrollment", "status": "active", "flags": []},
        )
    ]


def test_a_request_whose_camper_cancels_goes_back_to_unmatched() -> None:
    cancelled = spec(session=0, enrolled=frozenset())
    plan = plan_intake(
        [household(cancelled)], [app()], [record(spec(), "req000000000001")], {}, frozenset({"req000000000001"})
    )
    ((rid, changes),) = plan.request_updates
    assert (rid, changes["session_cm_id"], changes["status"]) == ("req000000000001", 0, "unmatched_session")


def test_a_staff_resolved_request_keeps_its_session_and_gains_not_enrolled_when_registration_moves() -> None:
    moved = spec(session=1000102, enrolled=frozenset({1000102}))
    staff = record(spec(), "req000000000001", session_resolution="staff")
    plan = plan_intake([household(moved)], [app()], [staff], {}, frozenset({"req000000000001"}))
    assert plan.request_updates == [
        ("req000000000001", {"flags": [{"code": "not_enrolled", "detail": {"session_cm_id": 1000101}}]})
    ]


def test_a_request_moving_to_a_free_slot_takes_it_and_frees_its_old_one() -> None:
    mover = spec(session=1000102, enrolled=frozenset({1000101, 1000102}))
    newcomer = spec(household=1000002, session=1000101, enrolled=frozenset({1000101, 1000102}))
    existing = [record(spec(), "req000000000001")]
    plan = plan_intake(
        [household(mover), household(newcomer, household_cm_id=1000002)],
        [app()],
        existing,
        {},
        frozenset({"req000000000001"}),
    )
    assert plan.request_updates == [("req000000000001", {"session_cm_id": 1000102})]
    (create,) = plan.request_creates
    assert (create.payload["session_cm_id"], create.payload["status"], create.duplicate_of_ref) == (
        1000101,
        "active",
        "",
    )


def test_a_request_moving_into_a_held_slot_waits_behind_its_holder() -> None:
    # req...1 sorts first, but req...2 already holds Session 2a and stays there: it keeps the slot.
    enrolled = frozenset({1000101, 1000102})
    mover = spec(session=1000102, enrolled=enrolled)
    resident = spec(household=1000002, session=1000102, enrolled=enrolled)
    existing = [record(spec(), "req000000000001"), record(resident, "req000000000002")]
    plan = plan_intake(
        [household(mover), household(resident, household_cm_id=1000002)],
        [app()],
        existing,
        {},
        frozenset({"req000000000001", "req000000000002"}),
    )
    assert plan.request_updates == [
        (
            "req000000000001",
            {"session_cm_id": 1000102, "status": "duplicate_pending", "duplicate_of": "req000000000002"},
        )
    ]


def test_two_requests_swapping_sessions_both_stay_active() -> None:
    # A cycle: req...1 moves onto req...2's session while req...2 moves onto req...1's.
    # Neither can be written straight to its new session first -- PocketBase's partial index
    # would refuse whichever one it is -- so the lower id gives up its slot through
    # `session_cm_id: 0` before the rest of the cycle writes, and takes its own final session
    # last.
    enrolled = frozenset({1000101, 1000102})
    first_now, second_now = (
        spec(session=1000102, enrolled=enrolled),
        spec(household=1000002, session=1000101, enrolled=enrolled),
    )
    existing = [
        record(spec(), "req000000000001"),
        record(spec(household=1000002, session=1000102), "req000000000002"),
    ]
    plan = plan_intake(
        [household(first_now), household(second_now, household_cm_id=1000002)],
        [app()],
        existing,
        {},
        frozenset({"req000000000001", "req000000000002"}),
    )
    assert plan.request_updates == [
        ("req000000000001", {"session_cm_id": 0}),
        ("req000000000002", {"session_cm_id": 1000101}),
        ("req000000000001", {"session_cm_id": 1000102}),
    ]


def test_a_swapping_request_without_a_share_gets_one_share_not_two() -> None:
    # The cycle-breaker writes req...1 twice (vacate, then final session). A request that lost
    # its default share (a chunked build that failed part-way) must still get exactly one share:
    # a second create for the same request and household breaks the unique index and the batch.
    enrolled = frozenset({1000101, 1000102})
    first_now, second_now = (
        spec(session=1000102, enrolled=enrolled),
        spec(household=1000002, session=1000101, enrolled=enrolled),
    )
    existing = [
        record(spec(), "req000000000001"),
        record(spec(household=1000002, session=1000102), "req000000000002"),
    ]
    plan = plan_intake(
        [household(first_now), household(second_now, household_cm_id=1000002)],
        [app()],
        existing,
        {},
        frozenset({"req000000000002"}),
    )
    assert plan.share_creates == ["req000000000001"]


def test_a_three_way_cycle_breaks_on_the_lowest_id_too() -> None:
    # req...1 -> 1000102 -> 1000103 -> 1000101 -> req...1: a longer cycle than a swap, same
    # problem. req...1 (lowest id) gives up its slot first; the rest resolves in dependency
    # order (req...3 first, since its target frees as soon as req...1 lets go), then req...1
    # takes its own final session once req...2 has moved off it.
    enrolled = frozenset({1000101, 1000102, 1000103})
    first_now, second_now, third_now = (
        spec(session=1000102, enrolled=enrolled),
        spec(household=1000002, session=1000103, enrolled=enrolled),
        spec(household=1000003, session=1000101, enrolled=enrolled),
    )
    existing = [
        record(spec(), "req000000000001"),
        record(spec(household=1000002, session=1000102), "req000000000002"),
        record(spec(household=1000003, session=1000103), "req000000000003"),
    ]
    plan = plan_intake(
        [
            household(first_now),
            household(second_now, household_cm_id=1000002),
            household(third_now, household_cm_id=1000003),
        ],
        [app()],
        existing,
        {},
        frozenset({"req000000000001", "req000000000002", "req000000000003"}),
    )
    assert plan.request_updates == [
        ("req000000000001", {"session_cm_id": 0}),
        ("req000000000003", {"session_cm_id": 1000101}),
        ("req000000000002", {"session_cm_id": 1000103}),
        ("req000000000001", {"session_cm_id": 1000102}),
    ]


def test_a_move_onto_a_slot_is_written_after_the_request_leaving_it() -> None:
    # One camper, filed for by two households: req...1 moves 101 -> 102 in the run that req...2
    # moves 102 -> 103. PocketBase checks the one-active-request index on every statement, so
    # req...2's move must reach it first although req...1 sorts first.
    enrolled = frozenset({1000101, 1000102, 1000103})
    first = spec(session=1000102, enrolled=enrolled)
    second = spec(household=1000002, session=1000103, enrolled=enrolled)
    existing = [
        record(spec(), "req000000000001"),
        record(spec(household=1000002, session=1000102), "req000000000002"),
    ]
    plan = plan_intake(
        [household(first), household(second, household_cm_id=1000002)],
        [app()],
        existing,
        {},
        frozenset({"req000000000001", "req000000000002"}),
    )
    assert plan.request_updates == [
        ("req000000000002", {"session_cm_id": 1000103}),
        ("req000000000001", {"session_cm_id": 1000102}),
    ]


_DIFFERS = {"code": "session_differs_from_answer", "detail": {"named_session_cm_id": 1000101}}


def test_a_session_other_than_the_one_the_answer_names_is_flagged_for_staff() -> None:
    s = spec(session=1000102, enrolled=frozenset({1000102}), named=1000101)
    (create,) = plan_intake([household(s)], [], [], {}).request_creates
    assert (create.payload["status"], create.payload["flags"]) == ("active", [_DIFFERS])


def test_no_difference_flag_when_the_answer_names_the_session_or_names_none() -> None:
    same = spec(named=1000101)
    none = spec(program="bmitzvah", text="Taste of Camp", session=1000104, enrolled=frozenset({1000104}))
    unmatched = spec(program="summer", person=1000012, session=0, enrolled=frozenset(), named=1000101)
    plan = plan_intake([household(same, none, unmatched)], [], [], {})
    flags = [f["code"] for c in plan.request_creates for f in c.payload["flags"]]
    assert "session_differs_from_answer" not in flags


def test_a_staff_session_other_than_the_one_named_is_flagged_too() -> None:
    s = spec(named=1000101)
    staff = record(s, "req000000000001", session_cm_id=1000103, session_resolution="staff")
    plan = plan_intake([household(s)], [app()], [staff], {}, frozenset({"req000000000001"}))
    ((_, changes),) = plan.request_updates
    codes = [f["code"] for f in changes["flags"]]
    assert codes == ["not_enrolled", "session_differs_from_answer"]


def test_a_session_swap_logged_through_the_commit_replays_to_the_records() -> None:
    """3c: the cycle-breaker's two same-instant writes to one request replay to the record now."""
    from collections.abc import Sequence
    from datetime import UTC, datetime, timedelta
    from unittest.mock import patch

    from api.services.financial_aid_intake_plan import request_fields
    from api.services.financial_aid_intake_service import plan_writes
    from bunking.financial_aid.change_log import commit_aid_writes
    from bunking.financial_aid.change_replay import LogRow, replay
    from bunking.pocketbase_batch import BatchRequest, BatchResult

    enrolled = frozenset({1000101, 1000102})
    first_now, second_now = (
        spec(session=1000102, enrolled=enrolled),
        spec(household=1000002, session=1000101, enrolled=enrolled),
    )
    existing = [
        record(spec(), "req000000000001"),
        record(spec(household=1000002, session=1000102), "req000000000002"),
    ]
    plan = plan_intake(
        [household(first_now), household(second_now, household_cm_id=1000002)],
        [app()],
        existing,
        {},
        frozenset({"req000000000001", "req000000000002"}),
    )
    writes = plan_writes(2027, plan, [app()], existing)
    sent: list[BatchRequest] = []

    def send(pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        sent.extend(requests)
        return [BatchResult(status=200, body=dict(r.body or {})) for r in requests]

    with patch("bunking.financial_aid.change_log.send_batch", side_effect=send):
        commit_aid_writes(object(), writes, actor="intake@example.com")  # type: ignore[arg-type]

    created = datetime(2027, 1, 10, 18, 0, tzinfo=UTC)
    then = datetime(2027, 1, 10, 19, 0, tzinfo=UTC)  # the whole batch shares one instant
    bodies = [r.body or {} for r in sent if r.url.endswith("/aid_change_log/records")]
    vacate = next(n for n, b in enumerate(bodies) if (b["after"] or {}).get("session_cm_id") == 0)
    assert [b["entity_id"] for b in bodies].count("req000000000001") == 2  # vacate, then the final session

    def logged(ids: Sequence[int]) -> list[LogRow]:
        return [
            LogRow(f"log{i:012d}", b["entity"], b["entity_id"], b["before"], b["after"], then)
            for i, b in zip(ids, bodies, strict=True)
        ]

    # Rows sharing an instant replay in id order. Labelled in reverse, req...1's vacate replays after
    # its final session, so id order alone would leave it in session 0: only settling the clash
    # from the record now gives 1000102.
    forward, backward = logged(range(len(bodies))), logged(range(len(bodies) - 1, -1, -1))
    mine = [row for row in backward if row.entity_id == "req000000000001"]
    assert max(mine, key=lambda row: row.id) is backward[vacate]
    starts = [
        LogRow(f"crt{n:012d}", "aid_requests", r.id, None, request_fields(r), created) for n, r in enumerate(existing)
    ]
    now = {"req000000000001": {"session_cm_id": 1000102}, "req000000000002": {"session_cm_id": 1000101}}
    for rows in ([*starts, *forward], [*starts, *backward]):
        replayed = replay(rows, current=now)
        for rid, session in ((r, s["session_cm_id"]) for r, s in now.items()):
            assert replayed[rid].complete is True
            assert replayed[rid].state is not None
            assert replayed[rid].state["session_cm_id"] == session  # type: ignore[index]
        # Without the record now nothing settles req...1's clash: it is incomplete, never guessed.
        assert replay(rows)["req000000000001"].complete is False
        # Just before the batch, both requests are as they were: the swap hasn't happened.
        before = replay(rows, as_of=then - timedelta(milliseconds=1))
        for r in existing:
            assert (before[r.id].state or {})["session_cm_id"] == r.session_cm_id
            assert before[r.id].complete is True
    assert [r.session_cm_id for r in existing] == [1000101, 1000102]


# --- 3c-2: intake records each camper's equity answers (owner ruling 2026-09-30) ---------------------

_SHE = EquityAnswers(bipoc=True, gender_identity="", pronouns="she/her")


def test_intake_records_a_campers_equity_answers_and_writes_nothing_when_they_are_unchanged() -> None:
    s = spec()
    (create,) = plan_intake([household(s)], [], [], {}, equity={1000011: _SHE}).request_creates
    assert create.payload["equity"] == {"bipoc": True, "gender_identity": "", "pronouns": "she/her"}
    recorded = record(s, "req000000000001", equity=_SHE)
    again = plan_intake([household(s)], [app()], [recorded], {}, frozenset({"req000000000001"}), equity={1000011: _SHE})
    assert again.is_empty


def test_a_changed_answer_is_one_logged_update_and_a_camper_who_answered_nothing_is_recorded_as_unknown() -> None:
    s = spec()
    recorded = record(s, "req000000000001", equity=_SHE)
    plan = plan_intake([household(s)], [app()], [recorded], {}, frozenset({"req000000000001"}), equity={})
    assert plan.request_updates == [
        ("req000000000001", {"equity": {"bipoc": None, "gender_identity": "", "pronouns": ""}})
    ]


def test_a_household_level_request_records_no_equity_and_a_run_that_read_no_answers_writes_none() -> None:
    family = spec(person=0, program="family_camp", text="Family Camp 6", session=1000202, enrolled=frozenset({1000202}))
    (create,) = plan_intake([household(family)], [], [], {}, equity={}).request_creates
    assert "equity" not in create.payload
    (camper,) = plan_intake([household(spec())], [], [], {}).request_creates
    assert "equity" not in camper.payload
