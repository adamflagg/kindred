"""aid_decisions and aid_hold_events reads, and the names the Requests grid shows (campership sub-project 10a, follow-up 3b).

Extends the intake repository, so the decisions service reads the applications, requests,
corrections, sessions, payer shares and equity answers casework reads, converted the same way, and
writes through the same `commit` (sub-project 4a's commit_aid_writes)."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Collection
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import AID_DECISIONS, AID_HOLD_EVENTS, AID_POSTINGS, SYNC_RUNS
from api.services.financial_aid_change_log_reads import fetch_change_log
from api.services.financial_aid_grants_register import Placement
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_ledger_service import (
    aid_dollars,
    household_display_name,
    parse_pb_datetime,
    person_display_name,
)
from api.services.financial_aid_reconciliation import CampLine
from api.services.financial_aid_repository import FinancialAidRepository
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import EVENT_KINDS, HOLD_EVENT_KINDS, DecisionEvent, HoldEvent

# Events that carry no amount: PocketBase stores 0 for an unset number, which must not read as $0.
_NO_AMOUNT: Final = frozenset({"approve", "refuse", "unpost", "accept", "unaccept"})
_PB_ID: Final = re.compile(r"^[a-z0-9]{15}$")


def _date(value: Any) -> date | None:
    text = str(value or "").strip()
    return date.fromisoformat(text[:10]) if text else None


def _json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, str):
        value = json.loads(value) if value.strip() else None
    return dict(value) if value else None


def decision_event(record: Any) -> DecisionEvent:
    """One aid_decisions record as an event."""
    kind = str(record.event)
    if kind not in EVENT_KINDS:
        raise ValueError(f"aid_decisions {record.id}: unknown event {kind!r}")
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        raise ValueError(f"aid_decisions {record.id} has no created time")
    version = int(getattr(record, "rules_version", 0) or 0)
    return DecisionEvent(
        id=str(record.id),
        request_id=str(record.request),
        round=int(record.round),
        kind=kind,
        created=created,
        amount=None if kind in _NO_AMOUNT else Decimal(str(getattr(record, "amount", 0) or 0)),
        effective_on=_date(getattr(record, "effective_on", "")),
        statement_of_need=str(getattr(record, "statement_of_need", "") or ""),
        decision_type=str(getattr(record, "decision_type", "") or ""),
        needs_approval=bool(getattr(record, "needs_approval", False)),
        lock_source=str(getattr(record, "lock_source", "") or ""),
        rules_version=version or None,
        snapshot=_json_object(getattr(record, "snapshot", None)),
        note=str(getattr(record, "note", "") or ""),
        actor=str(getattr(record, "actor", "") or ""),
    )


def camp_line(record: Any) -> CampLine:
    """One camp-aid aid_postings record as a line, in aid dollars (CampMinder's sign flipped)."""
    return CampLine(
        transaction_cm_id=int(record.transaction_cm_id),
        household_cm_id=int(record.household_cm_id or 0),
        person_cm_id=int(record.person_cm_id or 0),
        amount=aid_dollars(record.amount),
        post_date=parse_pb_datetime(getattr(record, "post_date", None)),
        is_reversed=bool(record.is_reversed),
        reversal_date=parse_pb_datetime(getattr(record, "reversal_date", None)),
        attributed_person_cm_id=int(getattr(record, "attributed_person_cm_id", 0) or 0),
        attributed_session_cm_id=int(getattr(record, "attributed_session_cm_id", 0) or 0),
        program_family=str(getattr(record, "program_family", "") or ""),
    )


def line_placement(record: Any) -> Placement | None:
    """An aid_attribution_overrides record as a placement; None for a reclassify-only override.
    Unlike the grants read, an override naming only a session places a line too (a Family Camp
    placement names no person)."""
    person = int(record.attributed_person_cm_id or 0)
    session = int(record.attributed_session_cm_id or 0)
    if person <= 0 and session <= 0:
        return None
    return Placement(int(record.transaction_cm_id), person, session, str(record.program_family or ""))


def hold_event(record: Any) -> HoldEvent:
    """One aid_hold_events record as an event (follow-up 3b)."""
    kind = str(record.event)
    if kind not in HOLD_EVENT_KINDS:
        raise ValueError(f"aid_hold_events {record.id}: unknown event {kind!r}")
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        raise ValueError(f"aid_hold_events {record.id} has no created time")
    return HoldEvent(
        id=str(record.id),
        request_id=str(record.request),
        kind=kind,
        code=str(record.code),
        created=created,
        note=str(getattr(record, "note", "") or ""),
        actor=str(getattr(record, "actor", "") or ""),
        fact=_json_object(getattr(record, "fact", None)),
    )


_HOLD_SEASON_FIELDS = "id,request,event,code,note,actor,created"


class FinancialAidDecisionsRepository(FinancialAidIntakeRepository):
    async def fetch_change_log(self, year: int, entity: str) -> list[LogRow]:
        return await fetch_change_log(self.pb, year, entity)

    async def fetch_decision_events(self, year: int) -> list[DecisionEvent]:
        rows = await self._page(AID_DECISIONS, {"filter": f"year = {int(year)}", "sort": "created,id"})
        return [decision_event(row) for row in rows]

    async def fetch_request_events(self, request_id: str) -> list[DecisionEvent]:
        if not _PB_ID.fullmatch(request_id):
            raise ValueError(f"{request_id!r} is not a record id")
        rows = await self._page(AID_DECISIONS, {"filter": f'request = "{request_id}"', "sort": "created,id"})
        return [decision_event(row) for row in rows]

    async def fetch_hold_events(self, year: int) -> list[HoldEvent]:
        # No `fact`: only the write path reads a release's snapshot, and the season read runs often.
        rows = await self._page(
            AID_HOLD_EVENTS,
            {"filter": f"year = {int(year)}", "fields": _HOLD_SEASON_FIELDS, "sort": "created,id"},
        )
        return [hold_event(row) for row in rows]

    async def fetch_request_hold_events(self, request_id: str) -> list[HoldEvent]:
        if not _PB_ID.fullmatch(request_id):
            raise ValueError(f"{request_id!r} is not a record id")
        rows = await self._page(AID_HOLD_EVENTS, {"filter": f'request = "{request_id}"', "sort": "created,id"})
        return [hold_event(row) for row in rows]

    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]:
        """The grid's family and camper names, the way the ledger and grants reads name them."""
        ledger = FinancialAidRepository(self.pb)
        households, persons = await asyncio.gather(
            ledger.fetch_households(year, household_cm_ids), ledger.fetch_persons(year, person_cm_ids)
        )
        return (
            {int(h.cm_id): household_display_name(h, int(h.cm_id)) for h in households},
            {int(p.cm_id): person_display_name(p) for p in persons},
        )

    async def fetch_camp_lines(self, year: int) -> list[CampLine]:
        """The season's camp-aid lines, live and reversed (spec §5.5: the camp's own aid, after any
        reclassification, which aid_postings materializes in funder_type)."""
        rows = await self._page(
            AID_POSTINGS, {"filter": f"year = {int(year)} && funder_type = 'camp'", "sort": "transaction_cm_id,id"}
        )
        return [camp_line(row) for row in rows]

    async def fetch_line_placements(self, year: int) -> dict[int, Placement]:
        rows = await FinancialAidRepository(self.pb).fetch_overrides(year)
        placements = (line_placement(row) for row in rows)
        return {p.transaction_cm_id: p for p in placements if p is not None}

    async def fetch_last_ledger_sync(self) -> datetime | None:
        """When the aid ledger (aid_postings) last finished a successful run: a tick after it awaits
        tonight's sync (D59). One row, sorted as sync_runs' other readers sort it."""
        result = await asyncio.to_thread(
            self.pb.collection(SYNC_RUNS).get_list,
            1,
            1,
            query_params={
                "filter": 'service = "aid_postings" && status = "success"',
                "sort": "-started,-id",
                "fields": "ended",
            },
        )
        items = list(result.items)
        return parse_pb_datetime(getattr(items[0], "ended", None)) if items else None
