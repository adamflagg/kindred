"""Campership intake: rebuild one season's applications and requests
(sub-project 5; spec 9.1-9.2).

`build(year)` reads the FA mirror, sessions, registrations, billing,
the season's rules (for the infant cutoff) and what aid_* already holds; plans
(financial_aid_intake_plan); and commits the plan as ONE operation through
sub-project 4a's commit_aid_writes (spec 14.4): each write and its
aid_change_log row in one batch, every row under the run's operation_id, actor
"system:intake". It is idempotent: a build on unchanged data writes nothing.
Every read names the build year, so a season N+1 build never sees season N
(#2844 runs both from mid-November).

Settled: intake's writes ARE logged (spec 14.4). Intake is neither a staff
write nor the CampMinder sync that spec 14.4 exempts -- it is Kindred's own
derivation onto Kindred-owned case records, so it goes through the one write
path every other aid_* change does. Each row carries actor "system:intake",
one operation_id per run, and a rebuild on unchanged data logs nothing.

A run over the batch limit (about 1,000 writes: a first build of a whole
season) is chunked, deliberately: intake derives everything from the mirror,
so a run left part-done is what the next run finishes.

Called by the Go FA sync after it writes (POST /api/internal/financial-aid/intake).
Every build re-resolves each request's session from registration, so a camper who
enrolls or switches sessions is picked up on the next run. One build per season runs
at a time in this process. The unique indexes on aid_requests are the backstop
across processes.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Final, Protocol

from api.constants.collections import AID_APPLICATIONS, AID_PAYER_SHARES, AID_REQUESTS
from api.services.financial_aid_billing import AgeRule, billed_headcounts
from api.services.financial_aid_household import build_request_specs, choose_household_answers
from api.services.financial_aid_intake_plan import (
    HouseholdIntake,
    IntakePlan,
    RulesCheck,
    application_fields,
    plan_intake,
    request_fields,
    share_entity_id,
)
from api.services.financial_aid_intake_types import (
    FLAG_AWAITING_RULES,
    FLAG_NO_PROGRAM,
    INTAKE_ACTOR,
    INTAKE_RULES_SECTIONS,
    SHARE_SOURCE_INTAKE,
    STATUS_DUPLICATE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    ApplicationRecord,
    AttendeeRow,
    BillingLine,
    EquityAnswers,
    FaRow,
    Flag,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, new_record_id
from bunking.financial_aid.headcount import is_infant
from bunking.financial_aid.rules import resolve_program
from bunking.financial_aid.rules.lookup import is_dependents_criterion
from bunking.financial_aid.rules.schema import YES_NO_ANSWER_FIELDS, AidRules
from bunking.logging_config import get_logger

logger = get_logger(__name__)

_LOCKS: dict[tuple[int, int], asyncio.Lock] = {}


def season_lock(year: int) -> asyncio.Lock:
    """The one lock per season that intake's build and the casework writers share: a staff
    write that lands between a build's read and its commit would be overwritten by it.

    It lives in this process only. That holds today because docker/Dockerfile.api runs a single
    uvicorn worker; more worker processes would each have their own lock and void it (the unique
    indexes on aid_requests stay the only backstop across processes). Not reentrant: a holder
    must release it before it triggers a build.
    """
    # Keyed by event loop as well as season. An asyncio.Lock binds to the first
    # loop that contends for it, and a test run creates a fresh loop per test.
    return _LOCKS.setdefault((id(asyncio.get_running_loop()), year), asyncio.Lock())


class IntakeStore(Protocol):
    async def fetch_fa_rows(self, year: int) -> list[FaRow]: ...
    async def fetch_sessions(self, year: int) -> list[SessionRow]: ...
    async def fetch_registered_attendees(self, year: int) -> list[AttendeeRow]: ...
    async def fetch_family_camp_billing(self, year: int) -> list[BillingLine]: ...
    async def fetch_applications(self, year: int) -> list[ApplicationRecord]: ...
    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]: ...
    async def fetch_payer_shares(
        self, year: int, request_ids: Sequence[str] | None = None
    ) -> list[PayerShareRecord]: ...
    async def fetch_birthdates(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, str]: ...
    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]: ...
    async def load_intake_rules(self, year: int) -> AidRules | None: ...
    async def load_equity_rules(self, year: int) -> AidRules | None: ...
    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        operation_id: str | None = None,
        reason: str | None = None,
        require_reason: bool = False,
        allow_chunking: bool = False,
    ) -> AidOperationResult: ...


@dataclass(frozen=True)
class IntakeReport:
    year: int
    households: int
    applications_created: int
    applications_updated: int
    requests_created: int
    requests_updated: int
    unmatched_sessions: int
    duplicates_pending: int
    rows_without_household: int
    rows_without_request: int
    payer_shares_created: int = 0
    # Requests recorded but waiting for finance to approve the programs and cost sections.
    awaiting_approved_rules: int = 0
    # The aid_change_log operation this run's writes share; "" when it wrote nothing.
    operation_id: str = ""
    # Season-level notes for staff and admins. They never hold a request (spec 10.5): a hold
    # is per request, and these are about the season's form. See never_true_warnings.
    warnings: tuple[str, ...] = ()


INTAKE_REASON: Final = "intake rebuild"
_CLOSED_STATUSES = frozenset({STATUS_DUPLICATE, STATUS_WITHDRAWN})
_DEFAULT_SHARE_REASON = "intake default: one share of 100% for the application's household"


def plan_writes(
    year: int, plan: IntakePlan, applications: Sequence[ApplicationRecord], requests: Sequence[RequestRecord]
) -> list[AidWrite]:
    """The plan as sub-project 4a writes, in dependency order: applications, request
    updates, request creates, then default payer shares. New records get their ids here, so
    a request names its new application, a pending duplicate its new holder and a share its
    new request, all in one operation.

    Updates go before creates because PocketBase checks the one-active-request-per-slot
    index on every statement: a run frees a slot by withdrawing its active holder, moving it
    with registration, or stepping it down, and that must land before a new request claims it
    (a family correcting its answer to the session staff already resolved). Within the
    updates, the planner (`_write_order`) writes each row leaving a slot before the one that
    claims it: a withdrawn or moved holder before the request moving in, the pending
    duplicate it promotes or the stranded duplicate it revives. One update may name a
    request created in this run: a stranded duplicate re-pointed to its survivor's reworded
    replacement. `duplicate_of` is a text field, not a relation, so the order does not
    matter there; the new id is swapped in.

    An update logs the record's fields before it as `before`; the helper keeps only what
    changed. A status move is logged as action "status" (spec 12.1 as-of)."""
    application_ids = {a.household_cm_id: a.id for a in applications}
    applications_by_id = {a.id: a for a in applications}
    requests_by_id = {r.id: r for r in requests}
    household_of = {r.id: r.household_cm_id for r in requests}
    status_moves = {change.record_ref for change in plan.status_changes}
    refs = {create.ref: new_record_id() for create in plan.request_creates}
    writes: list[AidWrite] = []
    for household_cm_id, payload in plan.application_creates:
        application_ids[household_cm_id] = new_record_id()
        writes.append(
            AidWrite(
                collection=AID_APPLICATIONS,
                action="create",
                year=year,
                record_id=application_ids[household_cm_id],
                data={**payload, "year": year, "household_cm_id": household_cm_id},
            )
        )
    for record_id, changes in plan.application_updates:
        writes.append(
            AidWrite(
                collection=AID_APPLICATIONS,
                action="update",
                year=year,
                record_id=record_id,
                before=application_fields(applications_by_id[record_id]),
                data=changes,
                log_action="status" if record_id in status_moves else None,
            )
        )
    for record_id, changes in plan.request_updates:
        writes.append(
            AidWrite(
                collection=AID_REQUESTS,
                action="update",
                year=year,
                record_id=record_id,
                before=request_fields(requests_by_id[record_id]),
                data={k: refs.get(v, v) if k == "duplicate_of" else v for k, v in changes.items()},
                log_action="status" if record_id in status_moves else None,
            )
        )
    for create in plan.request_creates:
        request_id = refs[create.ref]
        household_of[request_id] = create.household_cm_id
        data = {
            **create.payload,
            "duplicate_of": refs.get(create.duplicate_of_ref, create.duplicate_of_ref),
            "year": year,
            "application": application_ids[create.household_cm_id],
        }
        writes.append(AidWrite(collection=AID_REQUESTS, action="create", year=year, record_id=request_id, data=data))
    for ref in plan.share_creates:
        request_id = refs.get(ref, ref)
        household_cm_id = household_of[request_id]
        writes.append(
            AidWrite(
                collection=AID_PAYER_SHARES,
                action="create",
                year=year,
                data={
                    "year": year,
                    "request": request_id,
                    "household_cm_id": household_cm_id,
                    "share_pct": 100,
                    "source": SHARE_SOURCE_INTAKE,
                    "actor": INTAKE_ACTOR,
                    "note": "",
                },
                entity_id=share_entity_id(request_id, household_cm_id),
                reason=_DEFAULT_SHARE_REASON,
            )
        )
    return writes


def _rules_check(rules: AidRules | None, sessions: Sequence[SessionRow]) -> RulesCheck:
    """What the approved rules say about a resolved session (owner ruling Q4). No approved
    programs and cost sections yet: the request waits, visibly, and nothing is resolved."""
    if rules is None:
        waiting = Flag(FLAG_AWAITING_RULES, {"sections": list(INTAKE_RULES_SECTIONS)})
        return lambda session_cm_id: [waiting]
    approved: AidRules = rules
    session_types = {s.cm_id: s.session_type for s in sessions}

    def check(session_cm_id: int) -> list[Flag]:
        if resolve_program(approved, session_cm_id, session_types.get(session_cm_id)) is None:
            return [Flag(FLAG_NO_PROGRAM, {"session_cm_id": session_cm_id})]
        return []

    return check


def _day(text: str) -> date | None:
    """A PocketBase date or date-time string ("2027-08-20 00:00:00.000Z"), or None."""
    try:
        return date.fromisoformat(text[:10]) if text else None
    except ValueError:
        return None


def _awaiting(plan: IntakePlan, existing: Sequence[RequestRecord]) -> int:
    """Live requests whose flags, after this run, say they wait for approved rules."""
    state: dict[str, tuple[str, list[Any]]] = {r.id: (r.status, [dict(f) for f in r.flags]) for r in existing}
    for record_id, changes in plan.request_updates:
        status, flags = state[record_id]
        state[record_id] = (str(changes.get("status", status)), list(changes.get("flags", flags)))
    rows = [*state.values(), *((str(c.payload["status"]), list(c.payload["flags"])) for c in plan.request_creates)]
    return sum(
        1
        for status, flags in rows
        if status not in _CLOSED_STATUSES and any(f.get("code") == FLAG_AWAITING_RULES for f in flags)
    )


FIELD_NEVER_TRUE: Final = "equity_field_never_true"


def never_true_fields(rules: AidRules | None, fa_rows: Sequence[FaRow]) -> tuple[str, ...]:
    """The yes/no fields the approved equity rules weight that no applicant this season answered yes (spec 18 U-C7).
    Today shows them (§6.4); the intake run logs them (never_true_warnings)."""
    if rules is None or not fa_rows:
        return ()
    weighted = {key for weights in rules.equity.weights.values() for key, weight in weights.items() if weight > 0}
    fields = dict.fromkeys(
        field
        for criterion in rules.equity.criteria
        if criterion.key in weighted and criterion.source == "household" and not is_dependents_criterion(criterion)
        for field in (criterion.field, *criterion.also_fields)
        if field in YES_NO_ANSWER_FIELDS
    )
    return tuple(field for field in fields if not any(bool(row.answers.get(field)) for row in fa_rows))


def never_true_warnings(rules: AidRules | None, fa_rows: Sequence[FaRow]) -> tuple[str, ...]:
    """A yes/no answer the approved equity rules weight that no applicant this season answered
    yes (spec 18 U-C7: warn when no one answered).

    The mirror stores a blank yes/no as False, so "answered No" and "never asked" look the same
    on any one row. Across a whole season they do not: a weighted question nobody answered yes
    was most likely dropped from the form, and its weight silently reaches no family. Staff and
    finance should look at the form or the weight. Nothing is held."""
    return tuple(
        f"{FIELD_NEVER_TRUE}: {field} (0 of {len(fa_rows)} applicants)" for field in never_true_fields(rules, fa_rows)
    )


def _final_statuses(plan: IntakePlan, existing: Sequence[RequestRecord]) -> list[str]:
    changed = {rid: changes.get("status") for rid, changes in plan.request_updates}
    statuses = [str(changed.get(r.id) or r.status) for r in existing]
    statuses.extend(str(create.payload["status"]) for create in plan.request_creates)
    return statuses


class FinancialAidIntakeService:
    def __init__(self, store: IntakeStore) -> None:
        self._store = store

    async def build(self, year: int) -> IntakeReport:
        async with season_lock(year):
            return await self._build(year)

    async def _age_rule(
        self, year: int, rules: AidRules | None, sessions: Sequence[SessionRow], billing: Sequence[BillingLine]
    ) -> AgeRule | None:
        """Infant or not on each session's first day, under the season's cutoff (Task 4).
        None when the season has no rules or no cutoff: billing's labels then stand."""
        if rules is None or rules.cost.infant_age_cutoff_months is None:
            return None
        season_rules: AidRules = rules
        first_days = {s.cm_id: _day(s.start_date) for s in sessions}
        people = [line.person_cm_id for line in billing if line.person_cm_id > 0]
        births = {p: _day(text) for p, text in (await self._store.fetch_birthdates(year, people)).items()}

        def rule(person_cm_id: int, session_cm_id: int) -> bool | None:
            return is_infant(births.get(person_cm_id), first_days.get(session_cm_id), season_rules)

        return rule

    async def _build(self, year: int) -> IntakeReport:
        store = self._store
        # Two gathers, not one: typeshed types asyncio.gather precisely for at most six
        # awaitables; beyond that every result becomes a union and mypy strict fails.
        fa_rows, sessions, attendees, billing, rules = await asyncio.gather(
            store.fetch_fa_rows(year),
            store.fetch_sessions(year),
            store.fetch_registered_attendees(year),
            store.fetch_family_camp_billing(year),
            store.load_intake_rules(year),
        )
        applications, requests, shares, equity_rules = await asyncio.gather(
            store.fetch_applications(year),
            store.fetch_requests(year),
            store.fetch_payer_shares(year),
            store.load_equity_rules(year),
        )
        by_household: dict[int, list[FaRow]] = defaultdict(list)
        without_household = 0
        for row in fa_rows:
            if row.household_cm_id <= 0:
                without_household += 1
            else:
                by_household[row.household_cm_id].append(row)
        attendees_by_household: dict[int, list[AttendeeRow]] = defaultdict(list)
        attendees_by_person: dict[int, list[AttendeeRow]] = defaultdict(list)
        for attendee in attendees:
            attendees_by_household[attendee.household_cm_id].append(attendee)
            attendees_by_person[attendee.person_cm_id].append(attendee)

        households: list[HouseholdIntake] = []
        without_request = 0
        for household_cm_id, rows in sorted(by_household.items()):
            relevant = {id(a): a for a in attendees_by_household[household_cm_id]}
            for row in rows:
                relevant.update({id(a): a for a in attendees_by_person[row.person_cm_id]})
            specs = build_request_specs(household_cm_id, rows, sessions, list(relevant.values()))
            if not specs:
                without_request += len(rows)
                continue
            answers, flags = choose_household_answers(rows)
            members = tuple(sorted({row.person_cm_id for row in rows}))
            households.append(HouseholdIntake(household_cm_id, members, answers, flags, specs))

        family_households = [h.household_cm_id for h in households if any(s.person_cm_id == 0 for s in h.requests)]
        billed = billed_headcounts(billing, family_households, await self._age_rule(year, rules, sessions, billing))
        # 3c-2: each camper-level request records its camper's equity answers, so a past date can price
        # them as they stood. Live pricing keeps reading the synced answers (owner ruling 2026-09-30).
        people = sorted({s.person_cm_id for h in households for s in h.requests if s.person_cm_id > 0})
        equity = await self._store.fetch_equity_answers(year, people)
        plan = plan_intake(
            households,
            applications,
            requests,
            billed,
            frozenset(s.request_id for s in shares),
            _rules_check(rules, sessions),
            equity=equity,
        )
        operation_id = await self._commit(year, plan, applications, requests)
        statuses = _final_statuses(plan, requests)
        report = IntakeReport(
            year=year,
            households=len(households),
            applications_created=len(plan.application_creates),
            applications_updated=len(plan.application_updates),
            requests_created=len(plan.request_creates),
            requests_updated=len(plan.request_updates),
            unmatched_sessions=statuses.count(STATUS_UNMATCHED),
            duplicates_pending=statuses.count(STATUS_DUPLICATE_PENDING),
            rows_without_household=without_household,
            rows_without_request=without_request,
            payer_shares_created=len(plan.share_creates),
            awaiting_approved_rules=_awaiting(plan, requests),
            operation_id=operation_id,
            warnings=never_true_warnings(equity_rules, fa_rows),
        )
        for warning in report.warnings:
            logger.warning("Financial-aid intake season warning year=%s %s", year, warning)
        logger.info(
            "Financial-aid intake built year=%s households=%s created=%s updated=%s unmatched=%s pending=%s "
            "awaiting_approved_rules=%s operation_id=%s",
            year,
            report.households,
            report.requests_created,
            report.requests_updated,
            report.unmatched_sessions,
            report.duplicates_pending,
            report.awaiting_approved_rules,
            report.operation_id,
        )
        return report

    async def _commit(
        self,
        year: int,
        plan: IntakePlan,
        applications: Sequence[ApplicationRecord],
        requests: Sequence[RequestRecord],
    ) -> str:
        """One run is one operation (spec 14.4). Chunking is allowed on purpose: a run over
        the batch limit is a first build of a whole season, and the next run finishes one
        left part-done. A run under the limit is still one atomic batch."""
        writes = plan_writes(year, plan, applications, requests)
        if not writes:
            return ""
        result = await self._store.commit(writes, actor=INTAKE_ACTOR, reason=INTAKE_REASON, allow_chunking=True)
        return result.operation_id
