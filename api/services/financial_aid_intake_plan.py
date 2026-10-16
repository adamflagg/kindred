"""Idempotent intake planning (campership sub-project 5; spec 9.1-9.2).

`plan_intake` compares what the FA mirror says a season should hold with what
aid_applications / aid_requests already hold, and returns the writes that
reconcile them. It is pure: the service applies the plan.

What a re-run may and may not change:

* The intake key (household, person, program, normalised option text) is the
  identity. The same FA answer always updates the same row. A family that EDITS
  its answer produces a new key: the old request is withdrawn (never deleted,
  so its corrections and any decision stay attached) and a new one is created.
* The session follows REGISTRATION (owner ruling 2026-09-27). Every request
  takes the fresh resolution on every run, so an early applicant lands once they
  enroll and a camper who switches sessions follows their registration. Only a
  STAFF resolution (session_resolution "staff") is kept; when that camper's
  enrollment moves, the request gains `not_enrolled` for staff and is never
  re-pointed under a decision. A request on a session other than the one its
  answer names gains `session_differs_from_answer`: information, never a hold.
* `duplicate` (a staff ruling) is kept. `withdrawn` is reversible when the
  answer returns.
* A `duplicate` is never left without a live request for its camper (or family)
  and session. After every run, judged by STATE (so a duplicate stranded by an
  earlier run heals too): one whose survivor is no longer active is re-pointed to
  the active end of its chain of duplicates, or to whoever holds the slot now,
  and stays `duplicate`; with the slot free it is revived (active, or unmatched
  when it names no session) with the sticky `duplicate_survivor_withdrawn` hold.
* ONE active request per camper x session, or household x session for family
  camp (spec 2 item 9). An existing active row that STAYS on its session keeps
  its slot; rows that move claim next (a vacated slot is free to them), then the
  rest. A later claimant becomes `duplicate_pending` and names its holder: an
  id, or `new:N` when the holder is created in the same run (the service swaps
  in the id). Two or more requests trading sessions in one run (a cycle) write
  through a third state instead of straight to their new session; see
  `_write_order`.
* A `declared` / `override` headcount is staff's and is never overwritten;
  billing only fills an unknown or `billed` one.
* answers, ask, option text and flags are the builder's own copy and are
  refreshed every run. Staff corrections live in aid_application_corrections
  and are not read or written here, except a re-homed request's own
  corrections, which follow it to its new application (below).
* every `active` / `unmatched_session` request carries a payer share (spec
  9.2): one with none is listed in `share_creates`, and the service gives it
  the default (100% for its own household). The split itself is staff's.
* `created` and a request's identity are never written by a rebuild: `created`
  is the only "requested on" date (spec 5). The one exception is a re-home
  (below), which rewrites a request's household and application in place.

A camper whose household changes (coordinator ruling, owner agreed 2026-10-16). CampMinder can move a camper
to another household id, the aid-form sync copies it onto the camper's form row, and the intake key would then
withdraw the request (its decisions still attached) and create a fresh one. When the old and the new household
are ONE aid family for the season (`same_family`: aid_household_links, staff links included, joined the way
family_household_set joins them), the request is MOVED instead: the same id, status and decisions, its
household re-keyed in place. A request moves only when the match is unambiguous: a live (not withdrawn)
camper-level request whose own key no answer names any more, and exactly one new answer of the same camper,
program and option on one other household of its family. Anything else keeps withdraw-and-create, and an
ambiguous one names its camper in `unmoved_campers` for the service to log. Family Camp's household-level
requests (person 0) never move: they have no camper to anchor them, and two households of one aid family
(co-parents) often apply separately. What rides with a move, each its own write logged "move_household":
* the application, re-keyed in place, when every request on it moves to one household that has no
  application this season and the old household is left with nothing; otherwise the request lands on the new
  household's application (created this run if need be), where its camper's form row now is, and its own
  request-level corrections follow it there (the service's plan_writes);
* intake's own 100% default payer share (source "intake_default", on the old household). A staff-set share is
  staff's and stays as it is;
* a moved camper's live additions on the old household (`addition_moves`), so the next run builds their
  requests where the camper now is.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from api.constants.collections import AID_APPLICATIONS, AID_REQUESTS
from api.services.financial_aid_billing import BilledHeadcount
from api.services.financial_aid_household import RequestSpec
from api.services.financial_aid_intake_types import (
    APPLICATION_ACTIVE,
    APPLICATION_WITHDRAWN,
    FLAG_DUPLICATE_SURVIVOR_WITHDRAWN,
    FLAG_SESSION_DIFFERS,
    HEADCOUNT_BILLED,
    HEADCOUNT_INFANT_MAX,
    HEADCOUNT_NON_INFANT_MAX,
    RESOLUTION_STAFF,
    SHARE_SOURCE_INTAKE,
    STAFF_HEADCOUNT_SOURCES,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    UNKNOWN_EQUITY,
    AdditionRecord,
    ApplicationRecord,
    EquityAnswers,
    Flag,
    PayerShareRecord,
    RequestKey,
    RequestRecord,
    equity_json,
)

_Slot = tuple[str, int, int]
_NEEDS_A_SHARE = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})
# A resolved session_cm_id -> the flags the season's approved rules raise for it.
RulesCheck = Callable[[int], list[Flag]]
# Whether two households are one aid family this season (the service builds it from aid_household_links).
SameFamily = Callable[[int, int], bool]


@dataclass(frozen=True)
class HouseholdIntake:
    household_cm_id: int
    member_person_cm_ids: tuple[int, ...]
    answers: Mapping[str, Any]
    flags: tuple[Flag, ...]
    requests: tuple[RequestSpec, ...]


@dataclass(frozen=True)
class PlannedRequestCreate:
    ref: str
    household_cm_id: int
    payload: Mapping[str, Any]
    duplicate_of_ref: str


@dataclass(frozen=True)
class StatusChange:
    collection: str
    record_ref: str
    before: str
    after: str


@dataclass(frozen=True)
class Move:
    """One record re-homed from a household to another of the same aid family (logged "move_household")."""

    record_id: str
    from_household: int
    to_household: int
    request_id: str = ""  # a payer share's request


@dataclass
class IntakePlan:
    application_creates: list[tuple[int, dict[str, Any]]] = field(default_factory=list)
    application_updates: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    request_creates: list[PlannedRequestCreate] = field(default_factory=list)
    request_updates: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    status_changes: list[StatusChange] = field(default_factory=list)
    share_creates: list[str] = field(default_factory=list)
    # A camper whose household changed within one aid family (see the module docstring). Each is written before
    # the run's other updates; request_updates are diffed against the moved record.
    request_moves: list[Move] = field(default_factory=list)
    application_moves: list[Move] = field(default_factory=list)
    share_moves: list[Move] = field(default_factory=list)
    addition_moves: list[Move] = field(default_factory=list)
    # Campers whose request looked moved but matched more than one household: kept as today, logged.
    unmoved_campers: list[int] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (
            self.application_creates
            or self.application_updates
            or self.request_creates
            or self.request_updates
            or self.share_creates
            or self.request_moves
            or self.application_moves
            or self.share_moves
            or self.addition_moves
        )


def _changed(before: Mapping[str, Any], target: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in target.items() if before.get(key) != value}


def application_fields(record: ApplicationRecord) -> dict[str, Any]:
    """An application's intake-owned fields as plain JSON values. The planner diffs
    against them; the service logs them as an update's `before` (sub-project 4a)."""
    return {
        "status": record.status,
        "answers": dict(record.answers),
        "member_person_cm_ids": list(record.member_person_cm_ids),
        "flags": [dict(f) for f in record.flags],
    }


def request_fields(record: RequestRecord) -> dict[str, Any]:
    """A request's editable fields as plain JSON values; see application_fields."""
    return {
        "session_cm_id": record.session_cm_id,
        "session_resolution": record.session_resolution,
        "status": record.status,
        "duplicate_of": record.duplicate_of,
        "ask": record.ask,
        "program_option_text": record.program_option_text,
        "headcount_non_infant": record.headcount_non_infant,
        "headcount_infant": record.headcount_infant,
        "headcount_source": record.headcount_source,
        "flags": [dict(f) for f in record.flags],
        "equity": equity_json(record.equity) if record.equity is not None else None,
    }


def _slot(household_cm_id: int, person_cm_id: int, session_cm_id: int) -> _Slot:
    if person_cm_id:
        return ("person", person_cm_id, session_cm_id)
    return ("household", household_cm_id, session_cm_id)


def _storable(billed: BilledHeadcount | None) -> BilledHeadcount | None:
    """A billed headcount aid_requests can hold, or None. One beyond the field limits is no
    billed headcount at all, so the request shows `family_camp_headcount_missing` for staff
    to declare, instead of PocketBase refusing the season's whole batch."""
    if billed is None:
        return None
    if 0 <= billed.non_infant <= HEADCOUNT_NON_INFANT_MAX and 0 <= billed.infant <= HEADCOUNT_INFANT_MAX:
        return billed
    return None


def _headcount_target(
    record: RequestRecord | None, billed: BilledHeadcount | None, flags: list[Flag]
) -> dict[str, Any]:
    billed = _storable(billed)
    if billed is not None and billed.reclassified:
        flags.append(Flag("infant_age_reclassified", {"count": billed.reclassified}))
    source = record.headcount_source if record is not None else ""
    if record is not None and source in STAFF_HEADCOUNT_SOURCES:
        if billed is not None and (billed.non_infant, billed.infant) != (
            record.headcount_non_infant,
            record.headcount_infant,
        ):
            flags.append(
                Flag("billing_disagrees", {"billed_non_infant": billed.non_infant, "billed_infant": billed.infant})
            )
        return {}
    if billed is None:
        flags.append(Flag("family_camp_headcount_missing", {}))
        return {"headcount_non_infant": 0, "headcount_infant": 0, "headcount_source": ""}
    return {
        "headcount_non_infant": billed.non_infant,
        "headcount_infant": billed.infant,
        "headcount_source": HEADCOUNT_BILLED,
    }


def _session_choice(record: RequestRecord | None, spec: RequestSpec) -> tuple[int, str]:
    """The session a request takes this run: a staff resolution is kept, anything else
    takes the fresh resolution from registration."""
    if record is not None and record.session_resolution == RESOLUTION_STAFF and record.session_cm_id > 0:
        return record.session_cm_id, record.session_resolution
    return spec.resolution.session_cm_id, spec.resolution.method


def _request_target(
    record: RequestRecord | None,
    spec: RequestSpec | None,
    holders: dict[_Slot, str],
    billed: Mapping[tuple[int, int], BilledHeadcount],
    self_ref: str,
    rules_check: RulesCheck | None,
    equity: EquityAnswers | None = None,
) -> dict[str, Any]:
    if spec is None:
        return {"status": STATUS_WITHDRAWN}
    session, method = _session_choice(record, spec)
    flags = list(spec.flags)
    if session == 0:
        flags.append(Flag("unmatched_session", {"candidates": list(spec.resolution.candidates)}))
    elif session not in spec.enrolled_session_ids:
        flags.append(Flag("not_enrolled", {"session_cm_id": session}))
    if session != 0 and spec.named_session_cm_id not in (0, session):
        flags.append(Flag(FLAG_SESSION_DIFFERS, {"named_session_cm_id": spec.named_session_cm_id}))
    if session != 0 and rules_check is not None:
        flags.extend(rules_check(session))
    if record is not None:  # a revival's hold outlives the run that raised it
        flags.extend(
            Flag(str(f["code"]), dict(f.get("detail", {})))
            for f in record.flags
            if f.get("code") == FLAG_DUPLICATE_SURVIVOR_WITHDRAWN
        )
    if record is not None and record.status == STATUS_DUPLICATE:
        status, duplicate_of = STATUS_DUPLICATE, record.duplicate_of
    elif session == 0:
        status, duplicate_of = STATUS_UNMATCHED, ""
    else:
        slot = _slot(spec.household_cm_id, spec.person_cm_id, session)
        holder = holders.get(slot)
        if holder is None:
            holders[slot] = self_ref
            status, duplicate_of = STATUS_ACTIVE, ""
        else:
            status, duplicate_of = STATUS_DUPLICATE_PENDING, holder
    target: dict[str, Any] = {
        "session_cm_id": session,
        "session_resolution": method,
        "status": status,
        "duplicate_of": duplicate_of,
        "ask": spec.ask,
        "program_option_text": spec.program_option_text,
    }
    if spec.person_cm_id == 0:
        target.update(_headcount_target(record, billed.get((spec.household_cm_id, session)), flags))
    if equity is not None:
        target["equity"] = equity_json(equity)
    target["flags"] = [f.to_json() for f in flags]
    return target


def _equity_for(spec: RequestSpec | None, equity: Mapping[int, EquityAnswers] | None) -> EquityAnswers | None:
    """The answers to record on a camper-level request; a camper who answered nothing is recorded as
    unknown. None when the caller read no answers (nothing is written) or the request is household-level."""
    if equity is None or spec is None or not spec.person_cm_id:
        return None
    return equity.get(spec.person_cm_id, UNKNOWN_EQUITY)


def planned_request(
    spec: RequestSpec,
    billed: Mapping[tuple[int, int], BilledHeadcount],
    rules_check: RulesCheck | None,
    equity: Mapping[int, EquityAnswers] | None,
    record: RequestRecord | None = None,
) -> dict[str, Any]:
    """The fields a rebuild would give `spec`'s request when no other request holds its slot: the one planning rule,
    shared with casework's add (financial_aid_casework_service.add_request), so a request staff add is the request
    intake's next run finds already matched and leaves alone. The caller checks the slot is free first."""
    return _request_target(record, spec, {}, billed, "", rules_check, _equity_for(spec, equity))


def application_payload(
    member_person_cm_ids: Sequence[int], answers: Mapping[str, Any], flags: Sequence[Flag]
) -> dict[str, Any]:
    """An application's intake-owned fields as a rebuild writes them (see _plan_applications)."""
    return {
        "status": APPLICATION_ACTIVE,
        "answers": dict(answers),
        "member_person_cm_ids": list(member_person_cm_ids),
        "flags": [f.to_json() for f in flags],
    }


def _pair_moves(
    spec_keys: Collection[RequestKey], existing: Sequence[RequestRecord], same_family: SameFamily | None
) -> tuple[dict[str, int], list[int]]:
    """Which existing requests move, to which household: request id -> new household. And the campers left
    unmoved because their match was ambiguous. See the module docstring for the rule."""
    if same_family is None:
        return {}, []
    known = {r.key for r in existing}
    orphans: dict[tuple[int, str, str], list[RequestRecord]] = defaultdict(list)
    for r in existing:
        if r.person_cm_id > 0 and r.status != STATUS_WITHDRAWN and r.key not in spec_keys:
            orphans[(r.person_cm_id, r.program_key, r.program_option_key)].append(r)
    claims: dict[str, list[int]] = defaultdict(list)
    ambiguous: set[int] = set()
    for key in sorted(spec_keys):
        household_cm_id, person_cm_id, program_key, option_key = key
        if person_cm_id <= 0 or key in known:
            continue
        found = [
            r
            for r in orphans.get((person_cm_id, program_key, option_key), ())
            if r.household_cm_id != household_cm_id and same_family(r.household_cm_id, household_cm_id)
        ]
        if len(found) == 1:
            claims[found[0].id].append(household_cm_id)
        elif found:
            ambiguous.add(person_cm_id)
    by_id = {r.id: r for r in existing}
    moves: dict[str, int] = {}
    for record_id, targets in claims.items():
        if len(targets) == 1:
            moves[record_id] = targets[0]
        else:
            ambiguous.add(by_id[record_id].person_cm_id)
    return moves, sorted(ambiguous)


def camper_moves(
    households: Sequence[HouseholdIntake], existing: Sequence[RequestRecord], same_family: SameFamily | None
) -> dict[int, tuple[int, int]]:
    """Each camper whose requests move this run, all of them to one household: person -> (old, new). The service
    reads it before planning, to move the camper's additions (addition_moves) and build their requests anew."""
    keys = {s.key for h in households for s in h.requests}
    moves, _ = _pair_moves(keys, existing, same_family)
    by_id = {r.id: r for r in existing}
    found: dict[int, set[tuple[int, int]]] = defaultdict(set)
    for record_id, to in moves.items():
        record = by_id[record_id]
        found[record.person_cm_id].add((record.household_cm_id, to))
    return {person: next(iter(pairs)) for person, pairs in sorted(found.items()) if len(pairs) == 1}


def addition_moves(additions: Sequence[AdditionRecord], moves: Mapping[int, tuple[int, int]]) -> list[Move]:
    """The live additions a moved camper holds on the household they left. One whose slot is already taken by a live
    addition on the new household stays (idx_aid_request_additions_live)."""
    taken = {(a.household_cm_id, a.person_cm_id, a.session_cm_id) for a in additions if a.live}
    result: list[Move] = []
    for a in sorted(additions, key=lambda a: a.id):
        old_new = moves.get(a.person_cm_id)
        if not a.live or old_new is None or a.household_cm_id != old_new[0]:
            continue
        if (old_new[1], a.person_cm_id, a.session_cm_id) not in taken:
            result.append(Move(a.id, old_new[0], old_new[1]))
    return result


def _rekeyed_applications(
    plan: IntakePlan,
    wanted: Collection[int],
    existing: Sequence[ApplicationRecord],
    requests: Sequence[RequestRecord],
    moved_to: Mapping[str, int],
) -> dict[int, ApplicationRecord]:
    """The season's applications by household after this run's re-keys (the module docstring's first rider: every
    request on an application the old household no longer needs moves to one household that has none)."""
    by_household = {a.household_cm_id: a for a in existing}
    taken = set(by_household)
    for application in sorted(existing, key=lambda a: a.id):
        if application.household_cm_id in wanted:
            continue
        targets = {moved_to.get(r.id) for r in requests if r.application_id == application.id}
        if len(targets) != 1:
            continue
        (to,) = targets
        if to is None or to not in wanted or to in taken:
            continue
        taken.add(to)
        plan.application_moves.append(Move(application.id, application.household_cm_id, to))
        del by_household[application.household_cm_id]
        by_household[to] = replace(application, household_cm_id=to)
    return by_household


def _plan_applications(
    plan: IntakePlan,
    households: Sequence[HouseholdIntake],
    existing: Sequence[ApplicationRecord],
    requests: Sequence[RequestRecord] = (),
    moved_to: Mapping[str, int] | None = None,
) -> None:
    wanted = {h.household_cm_id for h in households}
    by_household = _rekeyed_applications(plan, wanted, existing, requests, moved_to or {})
    for household in sorted(households, key=lambda h: h.household_cm_id):
        payload = application_payload(household.member_person_cm_ids, household.answers, household.flags)
        record = by_household.get(household.household_cm_id)
        if record is None:
            plan.application_creates.append((household.household_cm_id, payload))
            continue
        changes = _changed(application_fields(record), payload)
        if changes:
            plan.application_updates.append((record.id, changes))
        if "status" in changes:
            plan.status_changes.append(StatusChange(AID_APPLICATIONS, record.id, record.status, APPLICATION_ACTIVE))
    for household_cm_id, record in sorted(by_household.items()):
        if household_cm_id not in wanted and record.status != APPLICATION_WITHDRAWN:
            plan.application_updates.append((record.id, {"status": APPLICATION_WITHDRAWN}))
            plan.status_changes.append(StatusChange(AID_APPLICATIONS, record.id, record.status, APPLICATION_WITHDRAWN))


def _active_end(start: str, targets: Mapping[str, Mapping[str, Any]]) -> str | None:
    """Follow a chain of duplicates from `start` to the request it ends at, if that one is
    active after this run; None when the chain ends anywhere else (or loops)."""
    seen: set[str] = set()
    current = start
    while current and current not in seen:
        seen.add(current)
        target = targets.get(current)
        if target is None:
            return None
        if target["status"] == STATUS_ACTIVE:
            return current
        if target["status"] != STATUS_DUPLICATE:
            return None
        current = str(target["duplicate_of"])
    return None


def _heal_stranded_duplicates(
    requests: Sequence[tuple[RequestRecord, dict[str, Any]]],
    creates: Mapping[str, Mapping[str, Any]],
    holders: dict[_Slot, str],
) -> None:
    """Every `duplicate` whose survivor is no longer active, after this run's other targets
    are settled: re-point it along its chain or to the slot's holder, or revive it."""
    targets: dict[str, Mapping[str, Any]] = {record.id: target for record, target in requests}
    targets.update(creates)
    for record, target in requests:
        if target["status"] != STATUS_DUPLICATE:
            continue
        survivor = str(target["duplicate_of"])
        session = int(target["session_cm_id"])
        slot = _slot(record.household_cm_id, record.person_cm_id, session)
        found = _active_end(survivor, targets) or (holders.get(slot) if session else None)
        if found is not None:
            target["duplicate_of"] = found
            continue
        if session:
            holders[slot] = record.id  # the one revival per slot: a second stranded one re-points to it
        target["status"] = STATUS_ACTIVE if session else STATUS_UNMATCHED
        target["duplicate_of"] = ""
        revived = Flag(FLAG_DUPLICATE_SURVIVOR_WITHDRAWN, {"withdrawn_survivor": survivor})
        kept = [f for f in target["flags"] if f.get("code") != FLAG_DUPLICATE_SURVIVOR_WITHDRAWN]
        target["flags"] = [*kept, revived.to_json()]


def _held_slot(household_cm_id: int, person_cm_id: int, session_cm_id: int, status: str) -> _Slot | None:
    """The slot a row occupies in PocketBase's partial one-active-request indexes, if any."""
    if status != STATUS_ACTIVE or session_cm_id <= 0:
        return None
    return _slot(household_cm_id, person_cm_id, session_cm_id)


def _write_order(
    requests: Sequence[tuple[RequestRecord, dict[str, Any]]],
) -> list[tuple[RequestRecord, dict[str, Any]]]:
    """The existing requests in an order PocketBase accepts. It checks the one-active-request
    indexes on every statement, and a session now moves with registration, so a request may
    claim a slot only once the row leaving it is written: a withdrawal, a move elsewhere or a
    step down to pending. Rows that claim nothing new keep their planned order and go first;
    each claimant follows once its slot is free.

    A cycle -- two or more requests trading sessions, each waiting on the next to move first
    -- has no such order: nothing in it frees a slot before something else needs one. Breaking
    it needs a third state. One member of the cycle (the lowest id, for a stable order) is
    written to `session_cm_id: 0` first: excluded from both partial indexes, which require
    `session_cm_id > 0` (pocketbase/pb_migrations/1500000201), so it lets go of its slot
    without yet claiming its real one. The rest of the cycle then writes in dependency order
    like any chain, and the broken member's own final write lands last, once its target slot
    is free. Both writes are ordinary entries here, so they carry this run's operation id and
    reason like everything else: history shows one operation even though the record moved
    twice."""

    def before(record: RequestRecord) -> _Slot | None:
        return _held_slot(record.household_cm_id, record.person_cm_id, record.session_cm_id, record.status)

    def after(record: RequestRecord, target: Mapping[str, Any]) -> _Slot | None:
        # A withdrawal's target carries only its status.
        session = int(target.get("session_cm_id", record.session_cm_id))
        return _held_slot(record.household_cm_id, record.person_cm_id, session, str(target["status"]))

    held = {slot: record.id for record, _ in requests if (slot := before(record)) is not None}
    ordered: list[tuple[RequestRecord, dict[str, Any]]] = []
    waiting = list(requests)
    while waiting:
        ready = [
            (record, target)
            for record, target in waiting
            if (claim := after(record, target)) is None or held.get(claim, record.id) == record.id
        ]
        if not ready:
            # Every request left is part of a cycle: each is waiting on another to vacate a
            # slot, and none of them will on their own. `candidates` are the ones still holding
            # the slot they came in with (a record already broken this way holds nothing, so it
            # can never be picked twice); a cycle always has at least one.
            candidates = [
                (record, slot)
                for record, _ in waiting
                if (slot := before(record)) is not None and held.get(slot) == record.id
            ]
            if not candidates:
                raise AssertionError("_write_order: a request is blocked on a slot nothing left in this run holds")
            record, slot = min(candidates, key=lambda item: item[0].id)
            del held[slot]
            ordered.append((record, {"session_cm_id": 0}))
            continue
        for record, target in ready:
            old, new = before(record), after(record, target)
            if old is not None and held.get(old) == record.id:
                del held[old]
            if new is not None:
                held[new] = record.id
        ordered.extend(ready)
        done = {record.id for record, _ in ready}
        waiting = [item for item in waiting if item[0].id not in done]
    return ordered


def plan_intake(
    households: Sequence[HouseholdIntake],
    existing_applications: Sequence[ApplicationRecord],
    existing_requests: Sequence[RequestRecord],
    billed: Mapping[tuple[int, int], BilledHeadcount],
    requests_with_shares: frozenset[str] = frozenset(),
    rules_check: RulesCheck | None = None,
    equity: Mapping[int, EquityAnswers] | None = None,
    *,
    same_family: SameFamily | None = None,
    payer_shares: Sequence[PayerShareRecord] = (),
    addition_moves: Sequence[Move] = (),
) -> IntakePlan:
    """`same_family`, when given, lets a camper's request move within its aid family (module docstring);
    `payer_shares` are the season's, read for the default share that rides with a move; `addition_moves` are the
    service's (from addition_moves), carried into the plan."""
    plan = IntakePlan()
    specs: dict[RequestKey, RequestSpec] = {s.key: s for h in households for s in h.requests}
    moved_to, plan.unmoved_campers = _pair_moves(set(specs), existing_requests, same_family)
    _plan_applications(plan, households, existing_applications, existing_requests, moved_to)
    _plan_moves(plan, existing_requests, moved_to, payer_shares)
    plan.addition_moves = list(addition_moves)
    # The rest of the run plans each moved request as it stands after its move.
    existing_requests = [
        replace(r, household_cm_id=moved_to[r.id]) if r.id in moved_to else r for r in existing_requests
    ]
    holders: dict[_Slot, str] = {}
    known: set[RequestKey] = set()
    # Targets first, writes after: a stranded duplicate can only be judged once every other
    # request's place in this run is known, new ones included.
    targets: list[tuple[RequestRecord, dict[str, Any]]] = []

    def stays(record: RequestRecord) -> bool:
        spec = specs.get(record.key)
        return (
            spec is not None
            and record.status == STATUS_ACTIVE
            and _session_choice(record, spec)[0] == record.session_cm_id
        )

    for record in sorted(existing_requests, key=lambda r: (not stays(r), r.status != STATUS_ACTIVE, r.id)):
        known.add(record.key)
        targets.append(
            (
                record,
                _request_target(
                    record,
                    specs.get(record.key),
                    holders,
                    billed,
                    record.id,
                    rules_check,
                    _equity_for(specs.get(record.key), equity),
                ),
            )
        )
    new_targets: dict[str, dict[str, Any]] = {}
    for key in sorted(k for k in specs if k not in known):
        ref = f"new:{len(new_targets)}"
        new_targets[ref] = _request_target(
            None, specs[key], holders, billed, ref, rules_check, _equity_for(specs[key], equity)
        )
    _heal_stranded_duplicates(targets, new_targets, holders)
    # A cycle-breaker writes one request twice (vacate, then its final session): give it one share, not two.
    shared: set[str] = set(requests_with_shares)
    for record, target in _write_order(targets):
        changes = _changed(request_fields(record), target)
        if changes:
            plan.request_updates.append((record.id, changes))
        if "status" in changes:
            plan.status_changes.append(StatusChange(AID_REQUESTS, record.id, record.status, changes["status"]))
        if changes.get("status", record.status) in _NEEDS_A_SHARE and record.id not in shared:
            shared.add(record.id)
            plan.share_creates.append(record.id)
    for key, (ref, target) in zip(sorted(k for k in specs if k not in known), new_targets.items(), strict=True):
        spec = specs[key]
        duplicate_of_ref = str(target.pop("duplicate_of"))
        payload = {
            "household_cm_id": spec.household_cm_id,
            "person_cm_id": spec.person_cm_id,
            "program_key": spec.program_key,
            "program_option_key": spec.program_option_key,
            **target,
        }
        plan.request_creates.append(PlannedRequestCreate(ref, spec.household_cm_id, payload, duplicate_of_ref))
        if payload["status"] in _NEEDS_A_SHARE:
            plan.share_creates.append(ref)
    return plan


def _plan_moves(
    plan: IntakePlan,
    existing: Sequence[RequestRecord],
    moved_to: Mapping[str, int],
    payer_shares: Sequence[PayerShareRecord],
) -> None:
    shares: dict[str, list[PayerShareRecord]] = defaultdict(list)
    for share in payer_shares:
        shares[share.request_id].append(share)
    for record in sorted(existing, key=lambda r: r.id):
        to = moved_to.get(record.id)
        if to is None:
            continue
        plan.request_moves.append(Move(record.id, record.household_cm_id, to))
        own = shares.get(record.id, [])
        if any(s.household_cm_id == to for s in own):
            continue  # the new household already pays a share of it: never a second row there
        plan.share_moves.extend(
            Move(s.id, record.household_cm_id, to, record.id)
            for s in sorted(own, key=lambda s: s.id)
            if s.source == SHARE_SOURCE_INTAKE and s.household_cm_id == record.household_cm_id
        )


def share_entity_id(request_id: str, household_cm_id: int) -> str:
    """The aid_change_log entity_id of one payer share: "<request id>:<household_cm_id>".
    It names the request, so a request's History finds its shares, deleted ones
    included, and the household, since an update logs only the fields it changed."""
    return f"{request_id}:{household_cm_id}"
