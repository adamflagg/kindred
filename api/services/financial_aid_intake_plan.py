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
  and are not read or written here.
* every `active` / `unmatched_session` request carries a payer share (spec
  9.2): one with none is listed in `share_creates`, and the service gives it
  the default (100% for its own household). The split itself is staff's.
* `created` and a request's identity are never written by a rebuild: `created`
  is the only "requested on" date (spec 5).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
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
    STAFF_HEADCOUNT_SOURCES,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    UNKNOWN_EQUITY,
    ApplicationRecord,
    EquityAnswers,
    Flag,
    RequestKey,
    RequestRecord,
    equity_json,
)

_Slot = tuple[str, int, int]
_NEEDS_A_SHARE = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})
# A resolved session_cm_id -> the flags the season's approved rules raise for it.
RulesCheck = Callable[[int], list[Flag]]


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


@dataclass
class IntakePlan:
    application_creates: list[tuple[int, dict[str, Any]]] = field(default_factory=list)
    application_updates: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    request_creates: list[PlannedRequestCreate] = field(default_factory=list)
    request_updates: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    status_changes: list[StatusChange] = field(default_factory=list)
    share_creates: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (
            self.application_creates
            or self.application_updates
            or self.request_creates
            or self.request_updates
            or self.share_creates
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


def _plan_applications(
    plan: IntakePlan, households: Sequence[HouseholdIntake], existing: Sequence[ApplicationRecord]
) -> None:
    by_household = {a.household_cm_id: a for a in existing}
    wanted = {h.household_cm_id for h in households}
    for household in sorted(households, key=lambda h: h.household_cm_id):
        payload: dict[str, Any] = {
            "status": APPLICATION_ACTIVE,
            "answers": dict(household.answers),
            "member_person_cm_ids": list(household.member_person_cm_ids),
            "flags": [f.to_json() for f in household.flags],
        }
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
) -> IntakePlan:
    plan = IntakePlan()
    _plan_applications(plan, households, existing_applications)
    specs: dict[RequestKey, RequestSpec] = {s.key: s for h in households for s in h.requests}
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


def share_entity_id(request_id: str, household_cm_id: int) -> str:
    """The aid_change_log entity_id of one payer share: "<request id>:<household_cm_id>".
    It names the request, so a request's History finds its shares, deleted ones
    included, and the household, since an update logs only the fields it changed."""
    return f"{request_id}:{household_cm_id}"
