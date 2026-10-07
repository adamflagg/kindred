"""Load 2026's award decisions from the 2026 sheet (D67 as amended by D145; owner rulings 2026-10-07).

2026 never ticked in Kindred (FIRST_TICKED_SEASON is 2027), so without this every 2026 request reads as a live Round 1
recalculation under "Needs an offer". This writes each request's rounds as aid_decisions rows, the rows the app would
have written had 2026 been run in it, read-only and labelled:

  * The ROUNDS come from the sheet, reproduced by the engine. Each included row (Aid Calculator "Include?" = Yes) is
    priced by the calculator from the sheet's own inputs, as parity_check does (494/494), one round at a time, each
    round locked before the next is priced (D43). The stage gives the round split and Accepted; the sheet's typed
    extra money becomes the rules' named types: a stage the parity config maps (a full-cost program outside the budget) keys that type,
    a "+ $300" stage keys the rules' top-up on Round 2, and any other extra money keys the rules' discretionary type.
    A hold the engine raises is released (2026's staff decided the row anyway); the receipt names it.
  * The POSTED dollars are CampMinder's (owner, 10-07: "needs to show campminder actuals"): each request's net
    unreversed camp aid in the synced ledger. Where that differs from the sheet's rounds, the DIFFERENCE GOES ON THE
    LATEST POSTED ROUND; if that would take it below $0, it stops at $0 and the rest goes on the round before. The
    sheet's own amount stays in each round's receipt (snapshot "decided", and snapshot "reproduced"). A household
    whose camp aid CampMinder could not place on one request keeps the sheet's amounts, and the report says so.
  * Every row is marked: actor `system:2026-sheet-load`, and each Posted row lock_source "reproduced", which the
    receipt reads as "2026, reproduced from the repaired sheet". There is no decision date (effective_on is unset).

It never invents: a sheet row with no CampMinder id, a session the config can't map, a person whose request is for
another session, no request at all, or two rows on one request, is reported and not loaded. CampMinder money on a
request the sheet doesn't load, and money CampMinder could not place, are reported too. A request staff have already
decided on is left alone. Nothing is ever "fixed": every difference goes to the report for a person to resolve.

Re-runnable: a run that would write exactly what a previous load wrote writes nothing; otherwise it deletes every row
the loader wrote before (found by its actor) and writes the new set, in one operation.

    uv run python -m scripts.financial_aid.load_2026_decisions \\
        (--workbook <export.xlsx> | --sheet-id <id> [--credentials <service account key>]) \\
        --config <parity config json> --report <report.csv> [--trackers <json>] [--year 2026] [--write]

--sheet-id exports the live Google Sheet as xlsx in memory through the service account's drive.readonly scope
(--credentials, default $GOOGLE_SERVICE_ACCOUNT_KEY_FILE else config/google_sheets.json); nothing is stored.

The console prints totals only, never a name, id or a family's amount; the --report CSV names CampMinder ids and
amounts for the person resolving it, so keep it out of every repository. --trackers optionally maps household
CampMinder ids to the staff trackers' letters ({"<household id>": "E"}), local and gitignored like the config.

Environment: as load_arrival_curve. --write refuses unless POCKETBASE_URL is set; POCKETBASE_URL,
POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD reach the superuser client. A dry run reads PocketBase too (the
season's requests, decisions, ledger and approved rules), read-only. Run it as a module from the repository root.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
import secrets
import string
import sys
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, BinaryIO, Final, Protocol

import jwt
import requests

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_reconciliation import CampLine
from api.services.financial_aid_rules_service import PRICING_SECTIONS, AidRulesRepository, FinancialAidRulesService
from bunking.financial_aid.calculator import ApplicationInputs, CalcResult, RequestInputs, calculate
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.decisions import DecisionEvent, EventKind, fold_rounds
from bunking.financial_aid.decisions.pricing import RequestToPrice, lock_snapshot, price_request
from bunking.financial_aid.decisions.rounds import REPRODUCED
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules import AidRules
from scripts.financial_aid.parity_check import (
    AID_CALCULATOR,
    Diagnostics,
    ParityConfig,
    SheetLayoutError,
    _build_request,
    _id_text,
    _number,
    _parse_row,
    _text,
    load_sheet,
)
from scripts.utils.auth import authenticate_pocketbase

LOADER: Final = "system:2026-sheet-load"
REASON: Final = "2026's awards, reproduced from the repaired sheet with CampMinder's posted money (D67, 10-07)"
AID_DECISIONS: Final = "aid_decisions"
_STAGE: Final = re.compile(r"^\s*([123])\b")
_TOP_UP_STAGE: Final = re.compile(r"\+\s*\$")
_UNMATCHED: Final = "unmatched"
_UNPLACED: Final = "Q-L12"
_OUTSIDE: Final = "outside"  # money outside the budget (D121); never a program's name
_UNCLASSIFIED: Final = "unclassified"
_ID_ALPHABET: Final = string.ascii_lowercase + string.digits


# --- inputs -------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SheetAward:
    """One included sheet row: its CampMinder keys, its stage, the engine's inputs as the sheet holds them (grants as
    the sheet applied them), and the sheet's own figures (Q, W, X; U the appeal ask)."""

    row: int
    person_cm_id: int | None
    household_cm_id: int | None
    session_cm_id: int | None
    stage: str
    application: ApplicationInputs
    request: RequestInputs
    ask: Decimal | None
    appeal: Decimal | None
    r1: Decimal | None
    r2: Decimal | None
    extra: Decimal
    decision_type: str | None


@dataclass(frozen=True)
class SheetTotals:
    """The sheet's own Budget Snapshot: Round 1 is column Q and Round 2 column W over the included rows, and Round 3
    is column X on the rows whose stage is a Round 3 one."""

    included: int = 0
    excluded: int = 0
    r1: Decimal = ZERO
    r2: Decimal = ZERO
    r3: Decimal = ZERO

    @property
    def total(self) -> Decimal:
        return self.r1 + self.r2 + self.r3


@dataclass(frozen=True)
class LoadRequest:
    id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    status: str


# --- the plan -----------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PlannedEvent:
    request_id: str
    round: int
    kind: EventKind
    amount: Decimal | None = None
    decision_type: str = ""
    lock_source: str = ""
    rules_version: int | None = None
    snapshot: Mapping[str, Any] | None = None
    note: str = ""
    effective_on: date | None = None

    def data(self, year: int) -> dict[str, Any]:
        body: dict[str, Any] = {
            "year": year,
            "request": self.request_id,
            "round": self.round,
            "event": self.kind,
            "actor": LOADER,
        }
        if self.amount is not None:
            body["amount"] = float(self.amount)
        if self.decision_type:
            body["decision_type"] = self.decision_type
        if self.lock_source:
            body["lock_source"] = self.lock_source
        if self.rules_version is not None:
            body["rules_version"] = self.rules_version
        if self.snapshot is not None:
            body["snapshot"] = dict(self.snapshot)
        if self.note:
            body["note"] = self.note
        return body

    def key(self) -> tuple[Any, ...]:
        return _key(
            self.request_id, self.round, self.kind, self.amount, self.decision_type, self.lock_source,
            self.rules_version, self.snapshot, self.note,
        )  # fmt: skip


def _key(
    request_id: str,
    n: int,
    kind: str,
    amount: Decimal | None,
    decision_type: str,
    lock_source: str,
    rules_version: int | None,
    snapshot: Mapping[str, Any] | None,
    note: str,
) -> tuple[Any, ...]:
    # PocketBase stores amounts as floats and snapshots as JSON: compare what reads back.
    money = None if amount is None else Decimal(str(float(amount)))
    shot = json.dumps(snapshot, sort_keys=True, default=str) if snapshot is not None else None
    return (request_id, n, kind, money, decision_type, lock_source, rules_version or None, shot, note)


def _event_key(event: DecisionEvent) -> tuple[Any, ...]:
    return _key(
        event.request_id, event.round, event.kind, event.amount, event.decision_type, event.lock_source,
        event.rules_version, event.snapshot, event.note,
    )  # fmt: skip


@dataclass(frozen=True)
class ReportRow:
    """One line for a person to resolve. Amounts are dollars; `difference` is posted − the sheet's rounds."""

    kind: str
    tracker: str
    household_cm_id: int | None = None
    person_cm_id: int | None = None
    session_cm_id: int | None = None
    sheet_row: int | None = None
    stage: str = ""
    sheet_amount: Decimal | None = None
    engine_amount: Decimal | None = None
    campminder_amount: Decimal | None = None
    posted_amount: Decimal | None = None
    note: str = ""

    @property
    def difference(self) -> Decimal | None:
        if self.posted_amount is None or self.sheet_amount is None:
            return None
        return self.posted_amount - self.sheet_amount


@dataclass(frozen=True)
class LoadedRequest:
    request_id: str
    household_cm_id: int
    sheet: Decimal  # the sheet's rounds, summed
    engine: Decimal  # the engine's rounds, summed
    posted: Decimal  # what the load posts (CampMinder's, where placed)
    outside: bool  # its money sits below the line (a type that doesn't count toward the budget)
    campminder: Decimal | None  # None: CampMinder's money in the household could not be placed on it


@dataclass
class LoadPlan:
    creates: list[PlannedEvent] = field(default_factory=list)
    stale: list[DecisionEvent] = field(default_factory=list)
    unchanged: bool = False
    loaded: list[LoadedRequest] = field(default_factory=list)
    report: list[ReportRow] = field(default_factory=list)
    campminder_total: Decimal = ZERO
    campminder_on_loaded: Decimal = ZERO
    campminder_unloaded: Decimal = ZERO
    campminder_unplaced: Decimal = ZERO


# --- CampMinder's money per request -----------------------------------------------------------------------------------


Group = tuple[int, int]  # (household CampMinder id, session CampMinder id): the family x session (owner, 10-07)


def _group(request: LoadRequest) -> Group:
    return (request.household_cm_id, request.session_cm_id)


def _line_group(line: CampLine, requests: Sequence[LoadRequest]) -> tuple[Group | None, str]:
    """The family x session a live camp-aid line is for, from its own household's requests: Go's attributed session,
    else the session of the attributed camper's one request there, else the household's one session. ("", group) when
    found; else why not: "no_request" (a session the household asked no aid for) or "unplaced" (it can't be told)."""
    household = [r for r in requests if r.household_cm_id == line.household_cm_id and r.session_cm_id]
    session, person = line.attributed_session_cm_id, line.attributed_person_cm_id
    if session:
        if any(r.session_cm_id == session for r in household):
            return (line.household_cm_id, session), ""
        return (line.household_cm_id, session), "no_request"
    sessions = {r.session_cm_id for r in household if not person or r.person_cm_id in (person, 0)}
    if len(sessions) == 1:
        return (line.household_cm_id, sessions.pop()), ""
    return None, "unplaced"


def campminder_money(
    lines: Iterable[CampLine], requests: Sequence[LoadRequest]
) -> tuple[dict[Group, Decimal], dict[Group, Decimal], dict[int, Decimal]]:
    """CampMinder's net live camp aid per family x session that has an aid request; per family x session that has
    none; and per household, what no family x session could take."""
    placed: dict[Group, Decimal] = defaultdict(lambda: ZERO)
    no_request: dict[Group, Decimal] = defaultdict(lambda: ZERO)
    unplaced: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for line in lines:
        if not line.live():
            continue
        group, why = _line_group(line, requests)
        if group is None:
            unplaced[line.household_cm_id] += line.amount
        elif why:
            no_request[group] += line.amount
        else:
            placed[group] += line.amount
    return dict(placed), dict(no_request), dict(unplaced)


Slot = tuple[str, int]  # (request id, round)


def allocate(slots: Mapping[Slot, Decimal], target: Decimal) -> dict[Slot, Decimal]:
    """The rounds moved so they add up to `target` (owner ruling 10-07: the posted dollars are CampMinder's). The
    difference goes on the latest posted round; what would take it below $0 goes on the round before it. Within a
    family x session holding several requests, "latest" is the highest round, then the larger amount, then the request
    id, so the choice is the same on every run."""
    out = dict(slots)
    order = sorted(out, key=lambda slot: (slot[1], out[slot], slot[0]), reverse=True)
    delta = target - sum(out.values(), ZERO)
    for slot in order:
        if delta == 0:
            break
        moved = max(out[slot] + delta, ZERO)
        delta -= moved - out[slot]
        out[slot] = moved
    return out


# --- one request's rounds -----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Typed:
    key: str | None
    round: int | None
    amount: Decimal
    kind: str | None


def _named_type(award: SheetAward, rules: AidRules) -> tuple[_Typed, str]:
    """The named decision type the row's stage or extra money keys, and a problem with it ("" when none)."""
    types = rules.awards.decision_types
    if award.decision_type:
        decision = types.get(award.decision_type)
        if decision is None:
            return _Typed(None, None, ZERO, None), f"the rules have no decision type {award.decision_type!r}"
        # Its top-up is the engine's own, so no typed amount (as parity_check reads these rows).
        return _Typed(award.decision_type, decision.round, ZERO, decision.kind), ""
    kind = "top_up" if _TOP_UP_STAGE.search(award.stage) else "discretionary" if award.extra > 0 else None
    if kind is None:
        return _Typed(None, None, ZERO, None), ""
    key = next((k for k, t in types.items() if t.kind == kind), None)
    if key is None:
        return _Typed(None, None, ZERO, None), f"the rules have no {kind} decision type"
    amount = award.extra if kind == "discretionary" else ZERO
    return _Typed(key, types[key].round, amount, kind), ""


def _expected(award: SheetAward, typed: _Typed, rounds: Iterable[int]) -> dict[int, Decimal]:
    """The sheet's own amount for each round: Q and W, with the typed extra money X on the round its type belongs to."""
    out = {n: (award.r1 if n == 1 else award.r2 if n == 2 else None) or ZERO for n in rounds}
    if typed.round is not None and typed.round in out:
        out[typed.round] += award.extra
    return out


def _event(rid: str, n: int, kind: EventKind, i: int, **fields: Any) -> DecisionEvent:
    return DecisionEvent(
        id=f"plan{i:011d}", request_id=rid, round=n, kind=kind, created=datetime(2000, 1, 1, tzinfo=UTC) + timedelta(i)
    , **fields)  # fmt: skip


@dataclass(frozen=True)
class _Reproduced:
    events: list[PlannedEvent]
    engine: dict[int, Decimal]
    expected: dict[int, Decimal]
    outside: bool
    released: tuple[str, ...]


def _hold_codes(award: SheetAward, request: RequestInputs, rules: AidRules) -> frozenset[str]:
    result: CalcResult = calculate(award.application, request, rules)
    return frozenset(i.code for i in result.issues if i.severity == "hold")


def reproduce(award: SheetAward, request: LoadRequest, rules: AidRules, version: int) -> _Reproduced:
    """The request's rounds as the app would have locked them: its keyed type and appeal ask first, then each round
    priced and posted in turn at the engine's amount (the amounts move to CampMinder's afterwards)."""
    typed, _ = _named_type(award, rules)
    planned: list[PlannedEvent] = []
    if typed.key is not None and typed.round is not None:
        planned.append(PlannedEvent(request.id, typed.round, "award", typed.amount, decision_type=typed.key))
    if award.appeal is not None:
        planned.append(PlannedEvent(request.id, 2, "ask", award.appeal))
    rounds = [1]
    if award.appeal is not None or typed.round == 2:
        rounds.append(2)
    if typed.round == 3:
        rounds.append(3)
    expected = _expected(award, typed, rounds)
    sheet_request = award.request.model_copy(
        update={"decision_type": typed.key, "discretionary_amount": typed.amount, "appeal_amount": award.appeal}
    )
    released = _hold_codes(award, sheet_request, rules)
    engine: dict[int, Decimal] = {}
    outside = False
    for n in rounds:
        events = [_event(request.id, e.round, e.kind, i, amount=e.amount, decision_type=e.decision_type,
                         lock_source=e.lock_source, rules_version=e.rules_version, snapshot=e.snapshot)
                  for i, e in enumerate(planned)]  # fmt: skip
        item = RequestToPrice(
            request_id=request.id,
            household_cm_id=request.household_cm_id,
            live=True,
            application=award.application,
            request=award.request,
            blocked="",
            issues=(),
            rounds=fold_rounds(events).get(request.id, {}),
            r1_ask=award.ask,
            grants=tuple(award.request.grants_applicable),
            released_holds=released,
        )
        priced = price_request(item, rules)
        view = priced.view(n)
        if view is None or view.decided is None:
            decided = expected[n]
            snapshot: dict[str, Any] = {"round": n, "decided": str(decided), "result": None, "inputs": None}
            snapshot["pool"] = priced.pool
            snapshot["counts_toward_budget"] = view.counts_toward_budget if view is not None else True
            engine_amount = None
        else:
            decided = view.decided
            snapshot = lock_snapshot(priced, n, version)
            engine_amount = decided
        outside = outside or not snapshot.get("counts_toward_budget", True)
        snapshot["reproduced"] = {
            "sheet_row": award.row,
            "stage": award.stage,
            "sheet": str(expected[n]),
            "engine": None if engine_amount is None else str(engine_amount),
            "released_holds": sorted(released),
        }
        engine[n] = decided
        planned.append(
            PlannedEvent(
                request.id, n, "post", decided, lock_source=REPRODUCED, rules_version=version, snapshot=snapshot
            )
        )
    return _Reproduced(planned, engine, expected, outside, tuple(sorted(released)))


# --- matching the sheet to the season's requests ------------------------------------------------------------------------


def _match(award: SheetAward, requests: Sequence[LoadRequest]) -> tuple[LoadRequest | None, str]:
    if award.person_cm_id is None:
        return None, "no_campminder_id"
    if award.session_cm_id is None:
        return None, "session_unmatched"
    found = [r for r in requests if r.session_cm_id == award.session_cm_id and r.person_cm_id == award.person_cm_id]
    if len(found) > 1:  # the camper on two households' applications: the sheet's family decides
        found = [r for r in found if r.household_cm_id == award.household_cm_id]
    if not found and award.household_cm_id is not None:
        found = [
            r
            for r in requests
            if r.session_cm_id == award.session_cm_id
            and r.person_cm_id == 0
            and r.household_cm_id == award.household_cm_id
        ]
    if len(found) == 1:
        return found[0], ""
    if len(found) > 1:
        return None, "request_ambiguous"
    if any(r.person_cm_id == award.person_cm_id for r in requests):
        return None, "session_mismatch"
    return None, "no_request"


def _sheet_total(award: SheetAward) -> Decimal:
    return (award.r1 or ZERO) + (award.r2 or ZERO) + award.extra


def plan_load(
    awards: Sequence[SheetAward],
    requests: Sequence[LoadRequest],
    lines: Sequence[CampLine],
    existing: Sequence[DecisionEvent],
    rules: AidRules,
    *,
    rules_version: int,
    trackers: Mapping[int, str],
) -> LoadPlan:
    plan = LoadPlan()

    def report(award: SheetAward | None, kind: str, tracker: str = _UNMATCHED, **fields: Any) -> None:
        if award is not None:
            fields = {
                "household_cm_id": award.household_cm_id,
                "person_cm_id": award.person_cm_id,
                "session_cm_id": award.session_cm_id,
                "sheet_row": award.row,
                "stage": award.stage,
                "sheet_amount": _sheet_total(award),
                **fields,
            }
        plan.report.append(ReportRow(kind=kind, tracker=tracker, **fields))

    matched: dict[str, list[SheetAward]] = defaultdict(list)
    for award in awards:
        request, why = _match(award, requests)
        if request is None:
            report(award, why)
        else:
            matched[request.id].append(award)
    staff = {e.request_id for e in existing if e.actor != LOADER}
    by_id = {r.id: r for r in requests}
    money, no_request, unplaced = campminder_money(lines, requests)
    plan.campminder_total = sum((line.amount for line in lines if line.live()), ZERO)
    plan.campminder_unplaced = sum(unplaced.values(), ZERO)
    for household, amount in sorted(unplaced.items()):
        report(None, "campminder_unplaced", _UNPLACED, household_cm_id=household, campminder_amount=amount)

    # Each request the sheet loads, reproduced by the engine; then CampMinder's money per family x session.
    made: dict[str, tuple[SheetAward, _Reproduced]] = {}
    for rid, found in matched.items():
        if len(found) > 1:
            for award in found:
                report(award, "duplicate")
            continue
        (award,) = found
        if rid in staff:
            report(award, "staff_rows", note="staff have already decided on this request; left as it is")
            continue
        made[rid] = (award, reproduce(award, by_id[rid], rules, rules_version))

    groups: dict[Group, list[str]] = defaultdict(list)
    for rid in made:
        groups[_group(by_id[rid])].append(rid)
    posted: dict[Slot, Decimal] = {}
    source: dict[str, Decimal | None] = {}
    for group, rids in sorted(groups.items()):
        household, session = group
        engine = {(rid, n): amount for rid in rids for n, amount in made[rid][1].engine.items()}
        cm: Decimal | None = money.get(group, ZERO if household not in unplaced else None)
        posted.update(engine if cm is None else allocate(engine, cm))
        sheet_total = sum((sum(made[rid][1].expected.values(), ZERO) for rid in rids), ZERO)
        posted_total = sum((posted[slot] for slot in engine), ZERO)
        outside = any(made[rid][1].outside for rid in rids)
        tracker = _OUTSIDE if outside else trackers.get(household, _UNCLASSIFIED)
        one = made[rids[0]][0] if len(rids) == 1 else None
        fields: dict[str, Any] = {
            "household_cm_id": household,
            "person_cm_id": one.person_cm_id if one else None,
            "session_cm_id": session,
            "sheet_row": one.row if one else None,
            "stage": one.stage if one else "",
            "sheet_amount": sheet_total,
            "engine_amount": sum(engine.values(), ZERO),
            "posted_amount": posted_total,
        }
        if cm is None:
            report(None, "campminder_unmatched", _UNPLACED, **fields,
                   note="CampMinder's money in this household could not be placed by session: the sheet's stands")  # fmt: skip
        elif posted_total != sheet_total:
            report(None, "campminder_differs", tracker, campminder_amount=cm, **fields,
                   note="" if one else f"{len(rids)} requests in this family x session")  # fmt: skip
        if cm is not None:
            plan.campminder_on_loaded += cm
        for rid in rids:
            source[rid] = cm

    for rid, (award, reproduced) in made.items():
        request = by_id[rid]
        for n, engine_amount in reproduced.engine.items():
            if engine_amount != reproduced.expected[n]:
                tracker = _OUTSIDE if reproduced.outside else trackers.get(request.household_cm_id, _UNCLASSIFIED)
                report(award, "engine_differs", tracker, sheet_amount=reproduced.expected[n],
                       engine_amount=engine_amount, note=f"Round {n}")  # fmt: skip
        cm = source[rid]
        words = "the sheet's (CampMinder's could not be placed)" if cm is None else "CampMinder's"
        for event in reproduced.events:
            if event.kind == "post":
                amount = posted[(rid, event.round)]
                snapshot = {**(event.snapshot or {})}
                snapshot["reproduced"] = {**snapshot["reproduced"], "campminder": None if cm is None else str(amount)}
                event = replace(
                    event,
                    amount=amount,
                    snapshot=snapshot,
                    note=f"Reproduced from the 2026 sheet; posted at {words} money",
                )
            plan.creates.append(event)
        if "accepted" in award.stage.lower():
            plan.creates.extend(PlannedEvent(rid, n, "accept") for n in reproduced.engine)
        plan.loaded.append(
            LoadedRequest(
                rid,
                request.household_cm_id,
                sum(reproduced.expected.values(), ZERO),
                sum(reproduced.engine.values(), ZERO),
                sum((posted[(rid, n)] for n in reproduced.engine), ZERO),
                reproduced.outside,
                cm,
            )
        )

    loaded_groups = set(groups)
    for group, amount in sorted([*money.items(), *no_request.items()]):
        if group in loaded_groups:
            continue
        plan.campminder_unloaded += amount
        household, session = group
        statuses = sorted({r.status for r in requests if _group(r) == group})
        report(None, "campminder_without_load", _UNMATCHED, household_cm_id=household, session_cm_id=session,
               campminder_amount=amount, note=f"requests here: {', '.join(statuses) or 'none'}")  # fmt: skip

    # A request staff have since written on is left as it is, the loader's own rows on it too (its staff_rows row).
    previous = [e for e in existing if e.actor == LOADER and e.request_id not in staff]
    plan.unchanged = sorted(map(_event_key, previous)) == sorted(e.key() for e in plan.creates)
    if not plan.unchanged:
        plan.stale = previous
    return plan


# --- writes -------------------------------------------------------------------------------------------------------------


def _ids(count: int) -> list[str]:
    """15-character PocketBase ids that sort in the order given, so rows created in one instant fold in plan order."""
    stem = "".join(secrets.choice(_ID_ALPHABET) for _ in range(4))
    return [f"l{stem}{i:06d}{''.join(secrets.choice(_ID_ALPHABET) for _ in range(4))}" for i in range(count)]


def plan_writes(plan: LoadPlan, year: int) -> list[AidWrite]:
    if plan.unchanged:
        return []
    deletes = [
        AidWrite(
            collection=AID_DECISIONS,
            action="delete",
            year=year,
            record_id=e.id,
            before={"request": e.request_id, "round": e.round, "event": e.kind, "actor": e.actor},
            entity_id=f"{e.request_id}:{e.round}",
        )
        for e in plan.stale
    ]
    creates = [
        AidWrite(
            collection=AID_DECISIONS,
            action="create",
            year=year,
            data=event.data(year),
            record_id=record_id,
            entity_id=f"{event.request_id}:{event.round}",
            log_action=event.kind,
        )
        for event, record_id in zip(plan.creates, _ids(len(plan.creates)), strict=True)
    ]
    return [*deletes, *creates]


# --- the workbook -------------------------------------------------------------------------------------------------------


def _int(value: Any) -> int | None:
    text = _id_text(value)
    return int(text) if text and text.isdigit() else None


def read_awards(path: Path | BinaryIO, config: ParityConfig, rules: AidRules) -> tuple[list[SheetAward], SheetTotals]:
    sheet = load_sheet(path, config)
    diagnostics = Diagnostics()
    awards: list[SheetAward] = []
    included = excluded = 0
    r1 = r2 = r3 = ZERO
    for row in sheet.rows:
        if (_text(row.calc["include"]) or "").strip().lower() != "yes":
            excluded += 1
            continue
        included += 1
        parsed = _parse_row(row, sheet, rules, config, diagnostics)
        q, w, x = (_number(row.calc[key]) for key in ("r1", "r2", "discretionary"))
        stage = (_text(row.calc["stage"]) or "").strip()
        r1 += q or ZERO
        r2 += w or ZERO
        if (m := _STAGE.match(stage)) and m.group(1) == "3":
            r3 += x or ZERO
        request = _build_request(parsed, row, sheet, "sheet").model_copy(
            update={"person_cm_id": _int(row.raw["personal_id"]), "decision_type": None, "discretionary_amount": ZERO}
        )
        awards.append(
            SheetAward(
                row=row.row,
                person_cm_id=_int(row.raw["personal_id"]),
                household_cm_id=_int(row.raw["family_id"]),
                session_cm_id=parsed.session_cm_id,
                stage=stage,
                application=parsed.application,
                request=request.model_copy(update={"appeal_amount": None}),
                ask=parsed.ask,
                appeal=parsed.appeal_amount,
                r1=q,
                r2=w,
                extra=x or ZERO,
                decision_type=parsed.decision_type,
            )
        )
    return awards, SheetTotals(included, excluded, r1, r2, r3)


# --- the live sheet through the service account (--sheet-id) ------------------------------------------------------------

DRIVE_READONLY: Final = "https://www.googleapis.com/auth/drive.readonly"
XLSX: Final = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_JWT_BEARER: Final = "urn:ietf:params:oauth:grant-type:jwt-bearer"


def export_sheet(sheet_id: str, credentials: Path, *, http: Any = None) -> bytes:
    """The Google Sheet exported as xlsx, in memory: the service account's drive.readonly token (a signed JWT
    exchanged at its token_uri), then Drive's export. Read-only by scope; nothing is written anywhere."""
    http = http if http is not None else requests
    account = json.loads(credentials.read_text(encoding="utf-8"))
    now = int(datetime.now(UTC).timestamp())
    assertion = jwt.encode(
        {
            "iss": account["client_email"],
            "scope": DRIVE_READONLY,
            "aud": account["token_uri"],
            "iat": now,
            "exp": now + 600,
        },
        account["private_key"],
        algorithm="RS256",
    )
    token = http.post(account["token_uri"], data={"grant_type": _JWT_BEARER, "assertion": assertion}, timeout=30)
    token.raise_for_status()
    export = http.get(
        f"https://www.googleapis.com/drive/v3/files/{sheet_id}/export",
        params={"mimeType": XLSX},
        headers={"Authorization": f"Bearer {token.json()['access_token']}"},
        timeout=120,
    )
    export.raise_for_status()
    return bytes(export.content)


# --- PocketBase ---------------------------------------------------------------------------------------------------------


class LoadStore(Protocol):
    async def rules(self, year: int) -> tuple[AidRules, int] | None: ...
    async def requests(self, year: int) -> list[LoadRequest]: ...
    async def events_of(self, year: int) -> list[DecisionEvent]: ...
    async def camp_lines(self, year: int) -> list[CampLine]: ...
    async def commit(self, writes: Sequence[AidWrite]) -> None: ...


class PocketBaseStore:
    """The superuser client's reads and the one write (4a's helper: each row with its aid_change_log row)."""

    def __init__(self) -> None:
        pb = authenticate_pocketbase(os.getenv("POCKETBASE_URL", "http://localhost:8090"))
        self._repo = FinancialAidDecisionsRepository(pb)
        self._rules = AidRulesRepository(pb, read_only=True)

    async def rules(self, year: int) -> tuple[AidRules, int] | None:
        approved = await FinancialAidRulesService(self._rules).latest_approved(year, PRICING_SECTIONS)
        return (approved.document, approved.version) if approved is not None else None

    async def requests(self, year: int) -> list[LoadRequest]:
        return [
            LoadRequest(r.id, r.household_cm_id, r.person_cm_id, r.session_cm_id, r.status)
            for r in await self._repo.fetch_requests(year)
        ]

    async def events_of(self, year: int) -> list[DecisionEvent]:
        return await self._repo.fetch_decision_events(year)

    async def camp_lines(self, year: int) -> list[CampLine]:
        return await self._repo.fetch_camp_lines(year)

    async def commit(self, writes: Sequence[AidWrite]) -> None:
        await self._repo.commit(writes, actor=LOADER, reason=REASON, allow_chunking=True)


def open_store() -> LoadStore:
    return PocketBaseStore()


# --- the report and the console ------------------------------------------------------------------------------------------


_REPORT_FIELDS: Final = (
    "kind", "tracker", "household_cm_id", "person_cm_id", "session_cm_id", "sheet_row", "stage", "sheet_amount",
    "engine_amount", "campminder_amount", "posted_amount", "difference", "note",
)  # fmt: skip


def write_report(path: Path, rows: Sequence[ReportRow]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(_REPORT_FIELDS)
        for row in rows:
            values = {name: getattr(row, name) for name in _REPORT_FIELDS}
            writer.writerow(["" if values[name] is None else values[name] for name in _REPORT_FIELDS])


def _money(value: Decimal) -> str:
    return f"${value:,.0f}" if value == value.to_integral_value() else f"${value:,.2f}"


def summary_lines(plan: LoadPlan, totals: SheetTotals) -> list[str]:
    loaded = plan.loaded
    inside = [r for r in loaded if not r.outside]
    sheet_in = sum((r.sheet for r in inside), ZERO)
    posted_in = sum((r.posted for r in inside), ZERO)
    lines = [
        f"sheet: {totals.included} included rows ({totals.excluded} not included) · Budget Snapshot "
        f"R1 {_money(totals.r1)} + R2 {_money(totals.r2)} + R3 {_money(totals.r3)} = {_money(totals.total)}",
        f"loaded: {len(loaded)} requests · {sum(1 for e in plan.creates if e.kind == 'post')} posted rounds · "
        f"sheet rounds {_money(sum((r.sheet for r in loaded), ZERO))} · engine {_money(sum((r.engine for r in loaded), ZERO))}"
        f" · posted {_money(sum((r.posted for r in loaded), ZERO))}",
        f"  counting toward the budget: sheet {_money(sheet_in)} → posted {_money(posted_in)}",
        f"  outside the budget ({len(loaded) - len(inside)} requests): posted "
        f"{_money(sum((r.posted for r in loaded if r.outside), ZERO))}",
        f"CampMinder live camp aid {_money(plan.campminder_total)}: on loaded requests "
        f"{_money(plan.campminder_on_loaded)} · on requests the sheet doesn't load {_money(plan.campminder_unloaded)}"
        f" · not placeable on one request {_money(plan.campminder_unplaced)}",
    ]
    by_kind: dict[tuple[str, str], list[ReportRow]] = defaultdict(list)
    for row in plan.report:
        by_kind[(row.kind, row.tracker)].append(row)
    lines.append(f"report: {len(plan.report)} rows")
    for (kind, tracker), rows in sorted(by_kind.items()):
        diff = sum((r.difference or ZERO for r in rows), ZERO)
        sheet = sum((r.sheet_amount or ZERO for r in rows), ZERO)
        cm = sum((r.campminder_amount or ZERO for r in rows), ZERO)
        lines.append(
            f"  {kind:<24} {tracker:<12} {len(rows):>4} rows · sheet {_money(sheet)} · CampMinder {_money(cm)}"
            f" · posted − sheet {_money(diff)}"
        )
    return lines


# --- the command --------------------------------------------------------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Load 2026's award decisions from the 2026 sheet (re-runnable).")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--workbook", type=Path, help="an xlsx export of the sheet (the default path)")
    source.add_argument("--sheet-id", help="the live Google Sheet, exported in memory through the service account")
    parser.add_argument(
        "--credentials",
        type=Path,
        default=Path(os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "config/google_sheets.json")),
        help="the service account's key file (read with --sheet-id only)",
    )
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--trackers", type=Path, default=None)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--write", action="store_true")
    return parser


async def _run(args: argparse.Namespace, store: LoadStore) -> int:
    approved = await store.rules(args.year)
    if approved is None:
        print(f"{args.year}'s pricing rules are not approved. Nothing was written.", file=sys.stderr)
        return 2
    rules, version = approved
    config = ParityConfig.model_validate_json(args.config.read_text(encoding="utf-8"))
    try:
        book = args.workbook if args.workbook is not None else BytesIO(export_sheet(args.sheet_id, args.credentials))
        awards, totals = read_awards(book, config, rules)
    except SheetLayoutError as exc:
        print(f"{exc}. Nothing was written.", file=sys.stderr)
        return 2
    trackers: dict[int, str] = {}
    if args.trackers is not None:
        trackers = {int(k): str(v) for k, v in json.loads(args.trackers.read_text(encoding="utf-8")).items()}
    requests, existing, lines = await asyncio.gather(
        store.requests(args.year), store.events_of(args.year), store.camp_lines(args.year)
    )
    plan = plan_load(awards, requests, lines, existing, rules, rules_version=version, trackers=trackers)
    write_report(args.report, plan.report)
    print(f"rules: {args.year} v{version}")
    for line in summary_lines(plan, totals):
        print(line)
    print(f"report written: {len(plan.report)} rows")
    if plan.unchanged:
        print(f"{args.year}'s decisions are already loaded with these figures. Nothing was written.")
        return 0
    writes = plan_writes(plan, args.year)
    if not args.write:
        print(
            f"Dry run: nothing written (would delete {len(plan.stale)} and write {len(plan.creates)} rows; add --write)."
        )
        return 0
    await store.commit(writes)
    print(
        f"Replaced {len(plan.stale)} rows with {len(plan.creates)} ({AID_CALCULATOR} rows loaded: {len(plan.loaded)})."
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.write and not os.getenv("POCKETBASE_URL"):
        print("Set POCKETBASE_URL to the PocketBase to write to. Nothing was written.", file=sys.stderr)
        return 2
    return asyncio.run(_run(args, open_store()))


if __name__ == "__main__":
    sys.exit(main())
