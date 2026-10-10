"""Season › History's reads, the opened line's Round column included (owner 2026-10-10, option B).

The Round a grant placement counts in is the Grants Register's rule (share_offset) replayed at the placement row's own
instant, so an opened operation with placement rows reads three more things, each once: its shares' requests' Posted
and undo ticks (chunked under PocketBase's filter limit), the season's sessions (the rules give a request its program
from its session), and the rules that priced the season at each placement (the rules service's own as-of replay). The
page list reads none of them. Kept apart from financial_aid_change_log_reads, which the decisions repository imports.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Collection
from datetime import datetime
from typing import Any, Final, Protocol

from api.constants.collections import AID_DECISIONS
from api.services.financial_aid_change_log_reads import PAGE_SIZE, HistoryLogReads
from api.services.financial_aid_decisions_repository import decision_event
from api.services.financial_aid_intake_repository import FinancialAidIntakeRepository
from api.services.financial_aid_intake_types import SessionRow
from api.services.financial_aid_repository import chunk_filter_terms
from api.services.financial_aid_rules_service import PRICING_SECTIONS, AidRulesRepository, FinancialAidRulesService
from api.services.pb_precise_datetime import aid_collection
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.rules import AidRules

_PB_ID: Final = re.compile(r"^[a-z0-9]{15}$")
# A round's Posted instant is all the Round column folds (fold_rounds: locked_at), so only these two kinds, and no
# snapshot JSON.
_TICK_FIELDS: Final = "id,request,round,event,created,amount,effective_on"


async def fetch_decision_events(pb: Any, year: int, request_ids: Collection[str]) -> list[DecisionEvent]:
    """Some requests' Posted and undo ticks, a chunk of request ids per read: a log run that places every grant of the
    season at once asks for hundreds."""
    wanted = sorted(set(request_ids))
    for request_id in wanted:
        if not _PB_ID.fullmatch(request_id):
            raise ValueError(f"{request_id!r} is not a record id")
    if not wanted:
        return []
    base = f'year = {int(year)} && (event = "post" || event = "unpost")'
    rows: dict[str, Any] = {}
    for chunk in chunk_filter_terms(len(base), [f'request = "{r}"' for r in wanted]):
        found: list[Any] = await asyncio.to_thread(
            aid_collection(pb, AID_DECISIONS).get_full_list,
            batch=PAGE_SIZE,
            query_params={"filter": f"{base} && ({' || '.join(chunk)})", "sort": "created,id", "fields": _TICK_FIELDS},
        )
        rows.update({str(r.id): r for r in found})
    return [decision_event(r) for r in rows.values()]


class _RulesAsOf(Protocol):
    async def approved_as_of_each(
        self, year: int, sections: Collection[Any], ats: Collection[datetime]
    ) -> tuple[dict[datetime, Any], frozenset[datetime]]: ...


class SeasonHistoryReads(HistoryLogReads):
    """Season › History's HistoryReads over one PocketBase client: the log reads, and the Round column's three."""

    def __init__(self, pb: Any, *, rules: _RulesAsOf | None = None) -> None:
        super().__init__(pb)
        self._rules: _RulesAsOf = rules or FinancialAidRulesService(AidRulesRepository(pb, read_only=True))

    async def fetch_decision_events(self, year: int, request_ids: Collection[str]) -> list[DecisionEvent]:
        return await fetch_decision_events(self.pb, year, request_ids)

    async def fetch_sessions(self, year: int) -> list[SessionRow]:
        return await FinancialAidIntakeRepository(self.pb).fetch_sessions(year)

    async def fetch_pricing_rules_at(self, year: int, ats: Collection[datetime]) -> dict[datetime, AidRules | None]:
        """The rules that priced the season at each instant; None where none were approved, or where the rules'
        history can't be replayed to it (never an older version in its place)."""
        if not ats:
            return {}
        found, _unknown = await self._rules.approved_as_of_each(year, PRICING_SECTIONS, ats)
        out: dict[datetime, AidRules | None] = {}
        for at in ats:
            version = found.get(at)
            out[at] = version.document if version is not None else None
        return out
