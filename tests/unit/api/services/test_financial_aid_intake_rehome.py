"""The intake planner re-homes a request when its camper's household changes within ONE aid family.

CampMinder can move a camper to another household id (a corrected household, a re-pointed relation). The aid-form
sync copies the new household onto the camper's form row, and intake keys a request on (household, camper, program,
option), so without a re-home the next run withdraws the request (its decisions still attached) and creates a fresh
one. When the two households are one aid family (aid_household_links, staff links included), the request is moved
in place instead: the same id, status and decisions (coordinator ruling, owner agreed 2026-10-16). Fictional ids.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from decimal import Decimal

from api.services.financial_aid_intake_plan import (
    Move,
    addition_moves,
    camper_moves,
    plan_intake,
)
from api.services.financial_aid_intake_types import AdditionRecord, ApplicationRecord, PayerShareRecord, RequestRecord
from tests.unit.api.services.test_financial_aid_intake_plan import ANSWERS, app, household, record, spec

OLD, NEW, OTHER = 1000001, 1000005, 1000009  # OLD and NEW are one aid family; OTHER is not
SIBLING_A, SIBLING_B = 1000011, 1000012


def family(*groups: frozenset[int]) -> Callable[[int, int], bool]:
    def same(a: int, b: int) -> bool:
        return any(a in g and b in g for g in groups)

    return same


ONE_FAMILY = family(frozenset({OLD, NEW}))


def share(
    request_id: str, household_cm_id: int = OLD, *, source: str = "intake_default", pct: int = 100
) -> PayerShareRecord:
    return PayerShareRecord(
        f"sh{request_id[-10:]}{household_cm_id % 1000:03d}",
        2027,
        request_id,
        household_cm_id,
        Decimal(pct),
        source,
        "system:intake" if source == "intake_default" else "registrar@example.com",
    )


def siblings_before() -> tuple[list[ApplicationRecord], list[RequestRecord], list[PayerShareRecord]]:
    """Two siblings on OLD's application, each with a request and its default share: the snapshot's pair."""
    a, b = spec(person=SIBLING_A, household=OLD), spec(person=SIBLING_B, household=OLD)
    old_app = ApplicationRecord("app000000000001", 2027, OLD, "active", ANSWERS, (SIBLING_A, SIBLING_B), ())
    records = [record(a, "req000000000001"), record(b, "req000000000002")]
    shares = [share("req000000000001"), share("req000000000002")]
    return [old_app], records, shares


def test_unchanged_data_plans_no_writes_with_the_family_known() -> None:
    apps, records, shares = siblings_before()
    a, b = spec(person=SIBLING_A, household=OLD), spec(person=SIBLING_B, household=OLD)
    plan = plan_intake(
        [household(a, b, household_cm_id=OLD)],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert plan.is_empty
    assert (plan.request_moves, plan.application_moves, plan.share_moves) == ([], [], [])


def test_both_siblings_moving_within_one_family_move_their_requests_application_and_default_shares() -> None:
    """Case 1 (the snapshot's pair): every camper on the application moves to one new household, which has no
    application yet. The application is re-keyed in place; nothing is withdrawn and nothing is created."""
    apps, records, shares = siblings_before()
    a, b = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_B, household=NEW)
    plan = plan_intake(
        [household(a, b, household_cm_id=NEW)],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert plan.request_moves == [Move("req000000000001", OLD, NEW), Move("req000000000002", OLD, NEW)]
    assert plan.application_moves == [Move("app000000000001", OLD, NEW)]
    assert plan.share_moves == [
        Move(shares[0].id, OLD, NEW, "req000000000001"),
        Move(shares[1].id, OLD, NEW, "req000000000002"),
    ]
    assert (plan.request_creates, plan.application_creates, plan.share_creates) == ([], [], [])
    assert plan.status_changes == []  # no withdrawal, of a request or of the application
    assert plan.request_updates == []  # status, session and decisions untouched
    assert plan.application_updates == []  # the same answers and members, now on NEW


def test_a_move_to_a_household_in_another_family_keeps_withdraw_and_create() -> None:
    apps, records, shares = siblings_before()
    a, b = spec(person=SIBLING_A, household=OTHER), spec(person=SIBLING_B, household=OTHER)
    plan = plan_intake(
        [household(a, b, household_cm_id=OTHER)],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert (plan.request_moves, plan.application_moves, plan.share_moves) == ([], [], [])
    assert [c.household_cm_id for c in plan.request_creates] == [OTHER, OTHER]
    assert [household_cm_id for household_cm_id, _ in plan.application_creates] == [OTHER]
    assert plan.request_updates == [
        ("req000000000001", {"status": "withdrawn"}),
        ("req000000000002", {"status": "withdrawn"}),
    ]
    assert ("app000000000001", {"status": "withdrawn"}) in plan.application_updates


def test_without_the_family_known_nothing_moves() -> None:
    """The default (no same_family) is today's behaviour exactly."""
    apps, records, shares = siblings_before()
    a, b = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_B, household=NEW)
    plan = plan_intake([household(a, b, household_cm_id=NEW)], apps, records, {}, frozenset(), payer_shares=shares)
    assert plan.request_moves == []
    assert len(plan.request_creates) == 2


def test_one_sibling_moving_re_homes_onto_a_new_application_on_the_new_household() -> None:
    """Case 2: the old application keeps the sibling who stayed. The moved camper's form row is on NEW, so NEW gets
    its own application (from that row's answers) and the request moves onto it, with its default share."""
    apps, records, shares = siblings_before()
    stays, moved = spec(person=SIBLING_A, household=OLD), spec(person=SIBLING_B, household=NEW)
    plan = plan_intake(
        [household(stays, household_cm_id=OLD), household(moved, household_cm_id=NEW)],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert plan.request_moves == [Move("req000000000002", OLD, NEW)]
    assert plan.application_moves == []
    assert [household_cm_id for household_cm_id, _ in plan.application_creates] == [NEW]
    assert plan.application_updates == [("app000000000001", {"member_person_cm_ids": [SIBLING_A]})]
    assert plan.share_moves == [Move(shares[1].id, OLD, NEW, "req000000000002")]
    assert (plan.request_creates, plan.request_updates, plan.status_changes, plan.share_creates) == ([], [], [], [])


def test_a_move_onto_a_household_with_its_own_application_re_homes_onto_that_application() -> None:
    """Case 3: NEW already has an application this season (its own camper's). The request moves onto it; OLD has no
    form left, so its application is withdrawn as today (its own corrections stay with it)."""
    apps, records, shares = siblings_before()
    own = spec(person=1000051, household=NEW, text="Session 2a", session=1000102, enrolled=frozenset({1000102}))
    new_app = ApplicationRecord("app000000000005", 2027, NEW, "active", ANSWERS, (1000051,), ())
    own_record = record(own, "req000000000005", application_id="app000000000005")
    a, b = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_B, household=NEW)
    plan = plan_intake(
        [household(a, b, own, household_cm_id=NEW)],
        [*apps, new_app],
        [*records, own_record],
        {},
        frozenset({*(s.request_id for s in shares), "req000000000005"}),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert plan.request_moves == [Move("req000000000001", OLD, NEW), Move("req000000000002", OLD, NEW)]
    assert plan.application_moves == []
    assert plan.application_creates == []
    assert ("app000000000001", {"status": "withdrawn"}) in plan.application_updates
    assert plan.request_creates == []
    assert [rid for rid, _ in plan.request_updates] == []


def test_a_staff_set_share_stays_and_a_default_share_moves() -> None:
    """Case 4: aid_payer_shares.source tells them apart ("intake_default" vs "staff", which every staff edit
    writes). A staff split stays exactly as staff left it; only intake's own 100% default moves."""
    apps, records, _ = siblings_before()
    staff_split = [
        share("req000000000001", OLD, source="staff", pct=60),
        share("req000000000001", NEW, source="staff", pct=40),
    ]
    default = share("req000000000002")
    a, b = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_B, household=NEW)
    plan = plan_intake(
        [household(a, b, household_cm_id=NEW)],
        apps,
        records,
        {},
        frozenset({"req000000000001", "req000000000002"}),
        same_family=ONE_FAMILY,
        payer_shares=[*staff_split, default],
    )
    assert plan.share_moves == [Move(default.id, OLD, NEW, "req000000000002")]
    assert len(plan.request_moves) == 2


def test_a_default_share_already_beside_a_share_for_the_new_household_stays() -> None:
    """The unique index (request, household) would refuse the move; intake never writes a second share there."""
    apps, records, _ = siblings_before()
    shares = [share("req000000000001"), share("req000000000001", NEW, source="staff", pct=0), share("req000000000002")]
    a, b = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_B, household=NEW)
    plan = plan_intake(
        [household(a, b, household_cm_id=NEW)],
        apps,
        records,
        {},
        frozenset({"req000000000001", "req000000000002"}),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert plan.share_moves == [Move(shares[2].id, OLD, NEW, "req000000000002")]


def test_a_family_camp_household_request_is_left_out_and_keeps_withdraw_and_create() -> None:
    """Case 5: a household-level request (person 0) CAN be re-keyed by a household change, when the family-camp
    answer's form row moves. It has no camper to anchor it, and two households of one aid family (co-parents) often
    apply separately, so a withdrawn household request and a new one beside it are not taken for one moving."""
    old_fc = spec(
        person=0,
        household=OLD,
        program="family_camp",
        text="Family Camp 6",
        session=1000202,
        enrolled=frozenset({1000202}),
    )
    new_fc = spec(
        person=0,
        household=NEW,
        program="family_camp",
        text="Family Camp 6",
        session=1000202,
        enrolled=frozenset({1000202}),
    )
    plan = plan_intake(
        [household(new_fc, household_cm_id=NEW)],
        [app(household_cm_id=OLD)],
        [record(old_fc, "req000000000003")],
        {},
        frozenset({"req000000000003"}),
        same_family=ONE_FAMILY,
        payer_shares=[share("req000000000003")],
    )
    assert plan.request_moves == []
    assert plan.request_updates == [("req000000000003", {"status": "withdrawn"})]
    assert [c.household_cm_id for c in plan.request_creates] == [NEW]


def test_two_households_of_one_family_claiming_the_same_camper_answer_move_nothing() -> None:
    """Ambiguous: the camper's answer appears on two other households of the family. Nothing is guessed."""
    apps, records, shares = siblings_before()
    third = 1000006
    same = family(frozenset({OLD, NEW, third}))
    a_new, a_third = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_A, household=third)
    b = spec(person=SIBLING_B, household=OLD)
    plan = plan_intake(
        [
            household(b, household_cm_id=OLD),
            household(a_new, household_cm_id=NEW),
            household(a_third, household_cm_id=third),
        ],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=same,
        payer_shares=shares,
    )
    assert plan.request_moves == []
    assert plan.unmoved_campers == [SIBLING_A]  # the service logs a warning naming them


def test_a_moved_camper_who_also_changes_session_moves_and_then_takes_the_session() -> None:
    """The move is its own write; the run's other changes to the request are diffed against the moved record."""
    apps, records, shares = siblings_before()
    b = spec(person=SIBLING_B, household=NEW)
    moved_a = spec(person=SIBLING_A, household=NEW, session=1000102, enrolled=frozenset({1000102}))
    plan = plan_intake(
        [household(moved_a, b, household_cm_id=NEW)],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=ONE_FAMILY,
        payer_shares=shares,
    )
    assert Move("req000000000001", OLD, NEW) in plan.request_moves
    assert plan.request_updates == [("req000000000001", {"session_cm_id": 1000102})]


def test_camper_moves_names_each_camper_whose_requests_move_to_one_household() -> None:
    apps, records, _ = siblings_before()
    stays, moved = spec(person=SIBLING_A, household=OLD), spec(person=SIBLING_B, household=NEW)
    moves = camper_moves(
        [household(stays, household_cm_id=OLD), household(moved, household_cm_id=NEW)], records, ONE_FAMILY
    )
    assert moves == {SIBLING_B: (OLD, NEW)}


def _addition(person: int, household_cm_id: int, session: int = 1000501, *, retired_at: str = "") -> AdditionRecord:
    return AdditionRecord(
        id=f"add{person:08d}{session % 10000:04d}",
        year=2027,
        household_cm_id=household_cm_id,
        person_cm_id=person,
        program_key="summer",
        session_cm_id=session,
        ask=600.0,
        source="staff",
        reason="Second program, staff added",
        actor="registrar@example.com",
        retired_at=retired_at,
    )


def test_a_moved_campers_live_additions_on_the_old_household_follow_the_camper() -> None:
    """Case 6: an addition is keyed on its household too. It follows its camper's move, or the next run would
    rebuild its request on the old household and withdraw the moved one."""
    live = _addition(SIBLING_B, OLD)
    retired = _addition(SIBLING_B, OLD, 1000502, retired_at="2027-02-01 00:00:00.000Z")
    elsewhere = _addition(SIBLING_A, OLD)  # SIBLING_A did not move
    moves = addition_moves([live, retired, elsewhere], {SIBLING_B: (OLD, NEW)})
    assert moves == [Move(live.id, OLD, NEW)]


def test_an_addition_whose_slot_is_already_taken_on_the_new_household_stays() -> None:
    """idx_aid_request_additions_live: one live row per (season, household, camper, session)."""
    live, there = _addition(SIBLING_B, OLD), _addition(SIBLING_B, NEW)
    there = replace(there, id="addnew000000001")
    assert addition_moves([live, there], {SIBLING_B: (OLD, NEW)}) == []


def test_addition_moves_ride_in_the_plan() -> None:
    apps, records, shares = siblings_before()
    a, b = spec(person=SIBLING_A, household=NEW), spec(person=SIBLING_B, household=NEW)
    moved = [Move("add000000000001", OLD, NEW)]
    plan = plan_intake(
        [household(a, b, household_cm_id=NEW)],
        apps,
        records,
        {},
        frozenset(s.request_id for s in shares),
        same_family=ONE_FAMILY,
        payer_shares=shares,
        addition_moves=moved,
    )
    assert plan.addition_moves == moved
    assert not plan.is_empty


def one_camper_with_a_withdrawn_request() -> tuple[ApplicationRecord, RequestRecord, RequestRecord, PayerShareRecord]:
    """One camper alone on OLD's application: a live request, and an earlier request withdrawn when the family changed
    the form's answer (another option), still on that application."""
    live = record(spec(person=SIBLING_A, household=OLD), "req000000000001")
    gone = record(
        spec(person=SIBLING_A, household=OLD), "req000000000009", status="withdrawn", program_option_key="other"
    )
    old_app = ApplicationRecord("app000000000001", 2027, OLD, "active", ANSWERS, (SIBLING_A,), ())
    return old_app, live, gone, share(live.id)


def test_a_withdrawn_request_on_the_application_still_lets_it_move_in_place_and_rides_with_it() -> None:
    """Owner ruling (2026-10-16): only live requests decide whether the application is re-keyed in place. A withdrawn
    one moves with its application, one move of its own, so the household page stays coherent; it stays withdrawn.
    Without this the move fell back to a new application, and staff's application-level corrections were stranded on
    the old, withdrawn one."""
    old_app, live, gone, default = one_camper_with_a_withdrawn_request()
    plan = plan_intake(
        [household(spec(person=SIBLING_A, household=NEW), household_cm_id=NEW)],
        [old_app],
        [live, gone],
        {},
        frozenset({live.id}),
        same_family=ONE_FAMILY,
        payer_shares=[default],
    )
    assert plan.application_moves == [Move(old_app.id, OLD, NEW)]
    assert plan.request_moves == [Move(live.id, OLD, NEW), Move(gone.id, OLD, NEW)]
    assert plan.share_moves == [Move(default.id, OLD, NEW, live.id)]
    assert (plan.application_creates, plan.request_creates, plan.share_creates) == ([], [], [])
    assert plan.application_updates == []  # nothing withdrawn: not the application
    assert plan.request_updates == []  # nor a request: the withdrawn one stays so
    assert plan.status_changes == []

    moved = [replace(r, household_cm_id=NEW) for r in (live, gone)]
    again = plan_intake(
        [household(spec(person=SIBLING_A, household=NEW), household_cm_id=NEW)],
        [replace(old_app, household_cm_id=NEW)],
        moved,
        {},
        frozenset({live.id}),
        same_family=ONE_FAMILY,
        payer_shares=[replace(default, household_cm_id=NEW)],
    )
    assert again.is_empty


def test_a_withdrawn_request_whose_key_is_taken_on_the_new_household_keeps_the_application_where_it_is() -> None:
    """The intake key is unique (idx_aid_requests_intake_key): a withdrawn request that would land on a key the new
    household already holds can't ride, so the application is not re-keyed and the move lands on a new application,
    as for a partial move."""
    old_app, live, gone, default = one_camper_with_a_withdrawn_request()
    holder = replace(gone, id="req000000000010", household_cm_id=NEW, application_id="app000000000002")
    plan = plan_intake(
        [household(spec(person=SIBLING_A, household=NEW), household_cm_id=NEW)],
        [old_app],
        [live, gone, holder],
        {},
        frozenset({live.id}),
        same_family=ONE_FAMILY,
        payer_shares=[default],
    )
    assert plan.application_moves == []
    assert plan.request_moves == [Move(live.id, OLD, NEW)]
    assert [h for h, _ in plan.application_creates] == [NEW]
