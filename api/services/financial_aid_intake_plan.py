"""Idempotent intake planning (campership sub-project 5; spec 9.1-9.2).

`plan_intake` compares what the FA mirror says a season should hold with what
aid_applications / aid_requests already hold, and returns the writes that
reconcile them. It is pure: the service applies the plan.

What a re-run may and may not change:

* The intake key (household, person, program, normalised option text) is the
  identity. The same FA answer always updates the same row. A family that EDITS
  its answer produces a new key: the old request is withdrawn (never deleted,
  so its corrections and any decision stay attached) and a new one is created.
* A resolved session is STICKY. Only an unmatched request is re-resolved. When
  the camper's enrollment moves, the request gains `not_enrolled` for staff and
  is never re-pointed under a decision.
* `duplicate` (a staff ruling) is kept. `withdrawn` is reversible when the
  answer returns.
* ONE active request per camper x session, or household x session for family
  camp (spec 2 item 9). Existing active rows keep their slot. A later claimant
  becomes `duplicate_pending` and names its holder: an id, or `new:N` when the
  holder is created in the same run (the service swaps in the id).
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
    HEADCOUNT_BILLED,
    STAFF_HEADCOUNT_SOURCES,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    ApplicationRecord,
    Flag,
    RequestKey,
    RequestRecord,
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
    }


def _slot(household_cm_id: int, person_cm_id: int, session_cm_id: int) -> _Slot:
    if person_cm_id:
        return ("person", person_cm_id, session_cm_id)
    return ("household", household_cm_id, session_cm_id)


def _headcount_target(
    record: RequestRecord | None, billed: BilledHeadcount | None, flags: list[Flag]
) -> dict[str, Any]:
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


def _request_target(
    record: RequestRecord | None,
    spec: RequestSpec | None,
    holders: dict[_Slot, str],
    billed: Mapping[tuple[int, int], BilledHeadcount],
    self_ref: str,
    rules_check: RulesCheck | None,
) -> dict[str, Any]:
    if spec is None:
        return {"status": STATUS_WITHDRAWN}
    kept = record is not None and record.session_cm_id > 0
    session = record.session_cm_id if record is not None and kept else spec.resolution.session_cm_id
    method = record.session_resolution if record is not None and kept else spec.resolution.method
    flags = list(spec.flags)
    if session == 0:
        flags.append(Flag("unmatched_session", {"candidates": list(spec.resolution.candidates)}))
    elif session not in spec.enrolled_session_ids:
        flags.append(Flag("not_enrolled", {"session_cm_id": session}))
    if session != 0 and rules_check is not None:
        flags.extend(rules_check(session))
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
    target["flags"] = [f.to_json() for f in flags]
    return target


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


def plan_intake(
    households: Sequence[HouseholdIntake],
    existing_applications: Sequence[ApplicationRecord],
    existing_requests: Sequence[RequestRecord],
    billed: Mapping[tuple[int, int], BilledHeadcount],
    requests_with_shares: frozenset[str] = frozenset(),
    rules_check: RulesCheck | None = None,
) -> IntakePlan:
    plan = IntakePlan()
    _plan_applications(plan, households, existing_applications)
    specs: dict[RequestKey, RequestSpec] = {s.key: s for h in households for s in h.requests}
    holders: dict[_Slot, str] = {}
    known: set[RequestKey] = set()
    for record in sorted(existing_requests, key=lambda r: (r.status != STATUS_ACTIVE, r.id)):
        known.add(record.key)
        target = _request_target(record, specs.get(record.key), holders, billed, record.id, rules_check)
        changes = _changed(request_fields(record), target)
        if changes:
            plan.request_updates.append((record.id, changes))
        if "status" in changes:
            plan.status_changes.append(StatusChange(AID_REQUESTS, record.id, record.status, changes["status"]))
        if changes.get("status", record.status) in _NEEDS_A_SHARE and record.id not in requests_with_shares:
            plan.share_creates.append(record.id)
    for key in sorted(k for k in specs if k not in known):
        spec = specs[key]
        ref = f"new:{len(plan.request_creates)}"
        target = _request_target(None, spec, holders, billed, ref, rules_check)
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
