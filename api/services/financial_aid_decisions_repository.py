"""aid_decisions and aid_hold_events reads, and the names the Requests grid shows (campership sub-project
10a, follow-up 3b).

Extends the intake repository, so the decisions service reads the applications, requests,
corrections, sessions, payer shares and equity answers casework reads, converted the same way, and
writes through the same `commit` (sub-project 4a's commit_aid_writes)."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Collection
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_ATTRIBUTION_OVERRIDES,
    AID_CANCELLATIONS,
    AID_DECISIONS,
    AID_GRANT_PLACEMENTS,
    AID_GRANTORS,
    AID_GRANTS,
    AID_HOLD_EVENTS,
    AID_HOUSEHOLD_LINKS,
    AID_PAYER_SHARES,
    AID_POSTINGS,
    AID_REQUESTS,
    AID_SOURCES,
    ATTENDEES,
    CAMP_SESSIONS,
    PERSON_CUSTOM_VALUES,
    PERSONS,
    SYNC_RUNS,
)
from api.services.financial_aid_cancellations import CancelEvent, EnrollmentState, parse_reason
from api.services.financial_aid_change_log_reads import fetch_change_log
from api.services.financial_aid_grant_placements import PlacementRecord, placement_record
from api.services.financial_aid_grants_register import Placement
from api.services.financial_aid_intake_repository import (
    EQUITY_FIELD_CM_IDS,
    PERSON_FILTER_CHUNK,
    FinancialAidIntakeRepository,
    allowlist_filter,
)
from api.services.financial_aid_ledger_service import (
    aid_dollars,
    household_display_name,
    parse_pb_datetime,
    person_display_name,
)
from api.services.financial_aid_reconciliation import (
    CampLine,
    LineOverride,
    SplitPart,
    camp_date,
    override_placement,
    override_split,
)
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_to_place import (
    LEFT_DISPOSITION,
    REMOVAL_SERVICES,
    TO_PLACE_FLAG,
    GrantLineRow,
    LeftLine,
    LineDetail,
    LinkRow,
    OverrideRow,
    SinceCorrection,
    SinceLog,
    SinceRecords,
    SourceRow,
    Synced,
    SyncRemoval,
)
from api.services.pb_precise_datetime import aid_collection
from bunking.financial_aid.change_log import COLLECTION as AID_CHANGE_LOG
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import EVENT_KINDS, HOLD_EVENT_KINDS, DecisionEvent, HoldEvent

# Events that carry no amount: PocketBase stores 0 for an unset number, which must not read as $0.
_NO_AMOUNT: Final = frozenset({"approve", "refuse", "unpost", "accept", "unaccept"})
_PB_ID: Final = re.compile(r"^[a-z0-9]{15}$")


def _date(value: Any) -> date | None:
    text = str(value or "").strip()
    return date.fromisoformat(text[:10]) if text else None


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, str):
        value = json.loads(value) if value.strip() else None
    return list(value) if value else []


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


def ledger_run_covers(trigger: str, recorded_year: int, season: int) -> bool:
    """Whether a successful aid_postings or financial_transactions run counts for `season`: a
    scheduled (window) run recorded within season-1..season+1, or any other run (manual, pinned)
    recorded as that season."""
    if trigger in _SCHEDULED_TRIGGERS:
        return abs(recorded_year - season) <= 1
    return recorded_year == season


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
        recorded_at=parse_pb_datetime(getattr(record, "created", None)),
        updated_at=parse_pb_datetime(getattr(record, "updated", None)),
    )


def line_override(record: Any) -> LineOverride:
    """An aid_attribution_overrides record: what it places, with the id its log rows carry, and the
    parts of a split (SP11-rest)."""
    return LineOverride(
        id=str(getattr(record, "id", "")),
        transaction_cm_id=int(record.transaction_cm_id),
        attributed_person_cm_id=int(record.attributed_person_cm_id or 0),
        attributed_session_cm_id=int(record.attributed_session_cm_id or 0),
        program_family=str(record.program_family or ""),
        split=override_split({"split": getattr(record, "split", None)}),
    )


def line_placement(record: Any) -> Placement | None:
    """An aid_attribution_overrides record as a placement; None for a reclassify-only override.
    Unlike the grants read, an override naming only a session places a line too (a Family Camp
    placement names no person)."""
    return override_placement(line_override(record).fields())


_CANCEL_KINDS: Final = frozenset({"cancel", "reopen"})
# Enrolled, cancelled, withdrawn: the only attendee statuses a cancellation turns on.
_ENROLLMENT_FILTER: Final = "status_id = 2 || status_id = 32 || status_id = 256"
_ENROLLMENT_FIELDS: Final = "id,person_id,status_id,enrollment_date,expand.person.household_id,expand.session.cm_id"


def cancel_event(record: Any) -> CancelEvent:
    """One aid_cancellations record as an event (sub-project 10b-2)."""
    kind = str(record.event)
    if kind not in _CANCEL_KINDS:
        raise ValueError(f"aid_cancellations {record.id}: unknown event {kind!r}")
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        raise ValueError(f"aid_cancellations {record.id} has no created time")
    return CancelEvent(
        id=str(record.id),
        request_id=str(record.request),
        kind="cancel" if kind == "cancel" else "reopen",
        created=created,
        reason=parse_reason(getattr(record, "reason", "")),
        in_kindred=bool(getattr(record, "in_kindred", False)),
        note=str(getattr(record, "note", "") or ""),
        actor=str(getattr(record, "actor", "") or ""),
    )


def enrollment_state(record: Any) -> EnrollmentState:
    """One attendees record (expanded person and session) as an enrollment state."""
    expand = getattr(record, "expand", None) or {}
    changed = parse_pb_datetime(getattr(record, "enrollment_date", None))
    return EnrollmentState(
        person_cm_id=int(record.person_id or 0),
        household_cm_id=int(getattr(expand.get("person"), "household_id", 0) or 0),
        session_cm_id=int(getattr(expand.get("session"), "cm_id", 0) or 0),
        status_id=int(record.status_id or 0),
        changed_on=camp_date(changed) if changed is not None else None,
    )


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


_LINE_FIELDS = (
    "transaction_cm_id,household_cm_id,person_cm_id,amount,post_date,is_reversed,reversal_date,"
    "attributed_person_cm_id,attributed_session_cm_id,program_family"
)
# sync_runs.trigger values a current-season queue records (sync/orchestrator.go). Only `daily` runs
# aid_postings and financial_transactions today; each such run spans seasons N-1..N+1, but Go records it
# with year = the configured season N (UsesSeasonWindow; the rolling transactions sync).
_SCHEDULED_TRIGGERS: Final = frozenset({"hourly", "daily", "weekly"})
# The ledger's syncs: aid_postings rebuilds from the financial_transactions mirror (sync/aid_postings.go).
_LEDGER_SERVICE: Final = "aid_postings"
_TRANSACTIONS_SERVICE: Final = "financial_transactions"
_RUN_PAGE = 100
_HOLD_SEASON_FIELDS = "id,request,event,code,note,actor,created"
# D16b: the aid_change_log entities whose rows say something that prices a request changed. aid_rules is read
# apart (approved_as_of_each); aid_sources and auto household links are read from their own `updated`, and so are
# grantors as well (their log rows carry the season configured when saved, not necessarily the placement's).
_SINCE_PLAIN: Final = (
    AID_REQUESTS,
    AID_APPLICATIONS,
    AID_PAYER_SHARES,
    AID_DECISIONS,
    AID_HOLD_EVENTS,
    AID_CANCELLATIONS,
    AID_GRANTORS,
)
# ...and those whose rows must be read with their before and after, which name a grant's household or person.
_SINCE_NAMED: Final = (AID_ATTRIBUTION_OVERRIDES, AID_GRANTS, AID_HOUSEHOLD_LINKS)


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

    async def fetch_grant_placements(self, year: int) -> list[PlacementRecord]:
        """The season's grant placement log (3c-2), in recorded order."""
        rows = await self._page(AID_GRANT_PLACEMENTS, {"filter": f"year = {int(year)}", "sort": "created,id"})
        return [placement_record(row) for row in rows]

    async def fetch_request_hold_events(self, request_id: str) -> list[HoldEvent]:
        if not _PB_ID.fullmatch(request_id):
            raise ValueError(f"{request_id!r} is not a record id")
        rows = await self._page(AID_HOLD_EVENTS, {"filter": f'request = "{request_id}"', "sort": "created,id"})
        return [hold_event(row) for row in rows]

    async def fetch_cancellations(self, year: int) -> list[CancelEvent]:
        rows = await self._page(AID_CANCELLATIONS, {"filter": f"year = {int(year)}", "sort": "created,id"})
        return [cancel_event(row) for row in rows]

    async def fetch_request_cancellations(self, request_id: str) -> list[CancelEvent]:
        if not _PB_ID.fullmatch(request_id):
            raise ValueError(f"{request_id!r} is not a record id")
        rows = await self._page(AID_CANCELLATIONS, {"filter": f'request = "{request_id}"', "sort": "created,id"})
        return [cancel_event(row) for row in rows]

    async def fetch_enrollment_states(
        self, year: int, person_cm_ids: Collection[int], household_cm_ids: Collection[int]
    ) -> list[EnrollmentState]:
        """The enrolled, cancelled and withdrawn registrations of these campers (camper-level requests)
        and of everyone in these households (household-level, Family Camp, requests), with each person's
        household and session. Never the whole season: only the people the requests name. The chunks
        are read concurrently."""
        chunks: list[str] = []
        for field, ids in (("person_id", person_cm_ids), ("person.household_id", household_cm_ids)):
            wanted = sorted({int(i) for i in ids if int(i) > 0})
            chunks.extend(
                " || ".join(f"{field} = {i}" for i in wanted[start : start + PERSON_FILTER_CHUNK])
                for start in range(0, len(wanted), PERSON_FILTER_CHUNK)
            )
        found = await asyncio.gather(
            *(
                self._page(
                    ATTENDEES,
                    {
                        "filter": f"year = {int(year)} && ({_ENROLLMENT_FILTER}) && ({chunk})",
                        "expand": "person,session",
                        "fields": _ENROLLMENT_FIELDS,
                        "sort": "id",
                    },
                )
                for chunk in chunks
            )
        )
        # A household member may also be named: one row each.
        rows: dict[str, Any] = {str(row.id): row for batch in found for row in batch}
        return [enrollment_state(row) for row in rows.values()]

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

    async def fetch_camp_lines(self, year: int, *, recorded_times: bool = False) -> list[CampLine]:
        """The season's camp-aid lines, live and reversed (spec §5.5: the camp's own aid, after any
        reclassification, which aid_postings materializes in funder_type). `recorded_times` also reads
        when Kindred recorded and last wrote each row, which only a past read needs (as_recorded)."""
        rows = await self._page(
            AID_POSTINGS,
            {
                "filter": f"year = {int(year)} && funder_type = 'camp'",
                "sort": "transaction_cm_id,id",
                "fields": f"{_LINE_FIELDS},created,updated" if recorded_times else _LINE_FIELDS,
            },
        )
        return [camp_line(row) for row in rows]

    async def fetch_line_placements(self, year: int) -> dict[int, Placement]:
        placements = (line_placement(row) for row in await FinancialAidRepository(self.pb).fetch_overrides(year))
        return {p.transaction_cm_id: p for p in placements if p is not None}

    async def fetch_line_splits(self, year: int) -> dict[int, tuple[SplitPart, ...]]:
        """The lines a person split across requests (SP11-rest, D12), each with its parts."""
        overrides = (line_override(row) for row in await FinancialAidRepository(self.pb).fetch_overrides(year))
        return {o.transaction_cm_id: o.split for o in overrides if o.split}

    async def fetch_line_details(self, year: int) -> dict[int, LineDetail]:
        """Each camp-aid line's description after any reclassification, and Go's posting flags (To place)."""
        rows = await self._page(
            AID_POSTINGS,
            {
                "filter": f"year = {int(year)} && funder_type = 'camp'",
                "sort": "transaction_cm_id,id",
                "fields": "transaction_cm_id,effective_source_key,flags",
            },
        )
        details: dict[int, LineDetail] = {}
        for row in rows:  # one row per transaction today; two would keep the first description, every flag
            txn = int(row.transaction_cm_id)
            known = details.get(txn)
            flags = {str(flag) for flag in _json_list(getattr(row, "flags", None))}
            details[txn] = LineDetail(
                txn,
                known.description_key if known is not None else str(row.effective_source_key or ""),
                tuple(sorted(flags | set(known.flags if known is not None else ()))),
            )
        return details

    async def fetch_override_rows(self, year: int) -> dict[int, OverrideRow]:
        """Every override in full, as To place's writes read and log it. Not `line_override`: that one omits
        the source, source_key_override and note, which a rewrite must carry."""
        return {
            int(row.transaction_cm_id): OverrideRow(
                id=str(row.id),
                transaction_cm_id=int(row.transaction_cm_id),
                attributed_person_cm_id=int(row.attributed_person_cm_id or 0),
                attributed_session_cm_id=int(row.attributed_session_cm_id or 0),
                program_family=str(row.program_family or ""),
                source_key_override=str(row.source_key_override or ""),
                source=str(row.source or ""),
                note=str(row.note or ""),
                split=override_split({"split": getattr(row, "split", None)}),
            )
            for row in await FinancialAidRepository(self.pb).fetch_overrides(year)
        }

    async def fetch_left_lines(self, year: int) -> dict[int, LeftLine]:
        """The lines left at family level (D58): To place's own aid_flag_dispositions rows."""
        return {
            int(row.transaction_cm_id): LeftLine(str(row.id), int(row.transaction_cm_id), str(row.note or ""))
            for row in await FinancialAidRepository(self.pb).fetch_dispositions(year)
            if str(row.flag) == TO_PLACE_FLAG and str(row.disposition) == LEFT_DISPOSITION
        }

    async def fetch_source_rows(self) -> dict[str, SourceRow]:
        """The description registry, as Reclassify checks it and To place names a line's description."""
        return {
            str(row.description_key): SourceRow(
                description_key=str(row.description_key),
                description=str(row.description or row.description_key),
                classified=str(row.classified_by) != "unclassified",
                counts_as_aid=bool(row.counts_as_aid),
                funder_type=str(row.funder_type or ""),
            )
            for row in await FinancialAidRepository(self.pb).fetch_sources()
        }

    async def fetch_changed_since(self, year: int, floor: datetime, *, persons: bool) -> SinceRecords:
        """Everything that prices a request recorded or changed after `floor` (D16b), one bounded read per
        collection, year-scoped and trimmed to the fields the check reads, run concurrently. `persons` reads
        the people CampMinder changed too, only when the rules weigh a camper answer kept there (its
        `updated` churns daily). Every household link of the season is read: the family is today's."""
        at = floor.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S.") + f"{floor.astimezone(UTC).microsecond // 1000:03d}Z"
        after = f"created > '{at}'"
        touched = f"(created > '{at}' || updated > '{at}')"
        season = f"year = {int(year)}"

        def entities(names: Collection[str]) -> str:
            return " || ".join(f"entity = '{name}'" for name in names)

        def page(collection: str, filter_: str, fields: str, **extra: str) -> Any:
            return self._page(collection, {"filter": filter_, "fields": fields, "sort": "id", **extra})

        services = " || ".join(f"service = '{name}'" for name in sorted(REMOVAL_SERVICES))
        reads = [
            page(
                AID_CHANGE_LOG, f"{season} && {after} && ({entities(_SINCE_PLAIN)})", "entity,entity_id,action,created"
            ),
            page(
                AID_CHANGE_LOG,
                f"{season} && {after} && ({entities(_SINCE_NAMED)})",
                "entity,entity_id,action,created,before,after",
            ),
            # `field` too: PocketBase returns only the fields asked for, and SinceCorrection carries it.
            page(AID_APPLICATION_CORRECTIONS, f"{season} && {after}", "application,request,field,created"),
            page(
                ATTENDEES,
                f"{season} && {touched}",
                "person_id,created,updated,expand.person.household_id,expand.session.cm_id",
                expand="person,session",
            ),
            page(
                PERSON_CUSTOM_VALUES,
                f"{season} && ({allowlist_filter(EQUITY_FIELD_CM_IDS)}) && {touched}",
                "created,updated,expand.person.cm_id",
                expand="person",
            ),
            page(CAMP_SESSIONS, f"{season} && {touched}", "cm_id,created,updated"),
            page(
                AID_POSTINGS,
                f"{season} && {touched}",  # every funder type: a line moved into camp aid is a grant that moved
                "transaction_cm_id,household_cm_id,person_cm_id,attributed_person_cm_id,effective_source_key,"
                "created,updated",
            ),
            page(AID_SOURCES, touched, "description_key,created,updated"),
            # The grantor directory spans seasons, and its log rows carry the season configured when each was
            # saved, which a late placement's may not be: the record's own `updated` dates it whatever the season.
            page(AID_GRANTORS, touched, "key,created,updated"),
            page(AID_HOUSEHOLD_LINKS, season, "household_cm_id,family_key,excluded,created,updated"),
            page(
                SYNC_RUNS,
                f"year >= {int(year) - 1} && year <= {int(year) + 1} && deleted_count > 0 && ended > '{at}' && "
                f"({services})",
                "service,ended",
            ),
        ]
        if persons:
            reads.append(page(PERSONS, f"{season} && {touched}", "cm_id,household_id,created,updated"))
        (
            plain,
            named,
            corrections,
            attendees,
            equity,
            sessions,
            postings,
            sources,
            grantors,
            links,
            runs,
            *people,
        ) = await asyncio.gather(*reads)

        def when(row: Any) -> datetime:
            stamps = [parse_pb_datetime(getattr(row, f, None)) for f in ("created", "updated")]
            dated = [s for s in stamps if s is not None]
            if not dated:  # as log() does: an undated record can't be placed against the floor, so say so
                raise ValueError(
                    f"{type(row).__name__} record {getattr(row, 'id', '')!r} has no created or updated time"
                )
            return max(dated)

        def expanded(row: Any, name: str) -> Any:
            expand = getattr(row, "expand", None) or {}
            return expand.get(name) if isinstance(expand, dict) else None

        def log(row: Any) -> SinceLog:
            created = parse_pb_datetime(row.created)
            if created is None:
                raise ValueError(f"aid_change_log {row.entity_id} has no created time")
            return SinceLog(
                str(row.entity),
                str(row.entity_id),
                str(row.action or ""),
                created,
                _json_object(getattr(row, "before", None)),
                _json_object(getattr(row, "after", None)),
            )

        synced = [
            *(
                Synced(
                    "attendees",
                    when(r),
                    person_cm_id=int(r.person_id or 0),
                    household_cm_id=int(getattr(expanded(r, "person"), "household_id", 0) or 0),
                    session_cm_id=int(getattr(expanded(r, "session"), "cm_id", 0) or 0),
                )
                for r in attendees
            ),
            *(
                Synced(
                    "person_custom_values", when(r), person_cm_id=int(getattr(expanded(r, "person"), "cm_id", 0) or 0)
                )
                for r in equity
            ),
            *(Synced("camp_sessions", when(r), session_cm_id=int(r.cm_id or 0)) for r in sessions),
            *(Synced("aid_sources", when(r), key=str(r.description_key)) for r in sources),
            *(Synced("aid_grantors", when(r), key=str(r.key)) for r in grantors),
            *(
                Synced("persons", when(r), person_cm_id=int(r.cm_id or 0), household_cm_id=int(r.household_id or 0))
                for rows in people
                for r in rows
            ),
        ]
        return SinceRecords(
            log=tuple(log(r) for r in (*plain, *named)),
            corrections=tuple(
                SinceCorrection(
                    str(r.application or ""),
                    str(getattr(r, "request", "") or ""),
                    when(r),
                    str(getattr(r, "field", "") or ""),
                )
                for r in corrections
            ),
            synced=tuple(synced),
            grant_lines=tuple(
                GrantLineRow(
                    int(r.transaction_cm_id),
                    int(r.household_cm_id or 0),
                    int(r.person_cm_id or 0),
                    int(r.attributed_person_cm_id or 0),
                    str(r.effective_source_key or ""),
                    parse_pb_datetime(getattr(r, "created", None)),
                    parse_pb_datetime(getattr(r, "updated", None)),
                )
                for r in postings
            ),
            links=tuple(LinkRow(int(r.household_cm_id), str(r.family_key), bool(r.excluded), when(r)) for r in links),
            removals=tuple(
                SyncRemoval(str(r.service), ended) for r in runs if (ended := parse_pb_datetime(r.ended)) is not None
            ),
        )

    async def fetch_line_overrides(self, year: int) -> list[LineOverride]:
        """Every override as it stands now: the replay's `current` for a past read (3c-1)."""
        return [line_override(row) for row in await FinancialAidRepository(self.pb).fetch_overrides(year)]

    async def fetch_last_ledger_sync(self, year: int) -> datetime | None:
        """When the season's ledger was last read from CampMinder: a tick after it awaits tonight's sync
        (D59). aid_postings rebuilds from the financial_transactions mirror, so after a failed
        transactions run it rebuilds stale rows with a clean success (aid_postings.go's F2 case). The
        time is therefore the OLDER of the starts of the last successful covering run of each; None
        (awaiting) while either has none. A start, not an end: a posting made during a run may have
        been read before it was made.

        This errs toward "awaiting" a little longer after a manual run of the window, which Go records
        under the one season it named. TODO(owner): exact coverage needs Go to record the seasons a run
        covered (sync_runs has only `year`)."""
        ledger, transactions = await asyncio.gather(
            self._last_covering_run(_LEDGER_SERVICE, year), self._last_covering_run(_TRANSACTIONS_SERVICE, year)
        )
        if ledger is None or transactions is None:
            return None
        return min(ledger, transactions)

    async def _last_covering_run(self, service: str, year: int) -> datetime | None:
        """The start of `service`'s newest successful run covering the season (`ledger_run_covers`), of
        its newest `_RUN_PAGE` successful runs in the season's window."""
        result = await asyncio.to_thread(
            aid_collection(self.pb, SYNC_RUNS).get_list,
            1,
            _RUN_PAGE,
            query_params={
                "filter": (
                    f'service = "{service}" && status = "success" && year >= {int(year) - 1} && year <= {int(year) + 1}'
                ),
                "sort": "-started,-id",
                "fields": "started,trigger,year",
            },
        )
        for run in result.items:
            if ledger_run_covers(str(getattr(run, "trigger", "")), int(getattr(run, "year", 0) or 0), year):
                return parse_pb_datetime(getattr(run, "started", None))
        return None
