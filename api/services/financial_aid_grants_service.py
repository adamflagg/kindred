"""Grants (campership sub-project 6-core): the grantor directory, the register read, camper
placements and hand-entered commitments (spec §8.2; D55–D57, D86).

Every write goes through sub-project 4a's commit_aid_writes: the record and its aid_change_log
row in ONE PocketBase batch. Each method is one staff action and one operation. A save that
changes nothing writes nothing (the helper refuses to log a no-op, which would be a 500).
actor is the real signed-in person (AuthUser.email).

The grantor directory is global, like aid_sources (Decision 7); its writes are logged under the
current season with entity_id = the grantor key.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from api.constants.collections import AID_GRANTORS
from api.schemas.financial_aid_grants import (
    GrantorCreate,
    GrantorDescription,
    GrantorOut,
    GrantorSave,
    GrantorsResponse,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from api.services.lodging_cache_warm import current_season_year
from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes

GRANTOR_FIELDS = ("name", "aliases", "full_coverage", "covers_canteen", "eligibility", "contacts")


class GrantorKeyTakenError(FinancialAidValidationError):
    """A grantor with that key already exists (409)."""


def _grantor_snapshot(record: Any) -> dict[str, Any]:
    return {
        "name": str(record.name or ""),
        "aliases": list(record.aliases or []),
        "full_coverage": bool(record.full_coverage),
        "covers_canteen": str(record.covers_canteen or "unknown"),
        "eligibility": str(record.eligibility or ""),
        "contacts": str(record.contacts or ""),
    }


def _descriptions_by_grantor(sources: list[Any]) -> dict[str, list[GrantorDescription]]:
    out: dict[str, list[GrantorDescription]] = defaultdict(list)
    for s in sources:
        key = str(getattr(s, "grantor_key", "") or "")
        if key:
            out[key].append(
                GrantorDescription(
                    source_id=str(s.id),
                    description_key=str(s.description_key),
                    description=str(s.description or ""),
                    source_family=str(s.source_family),
                )
            )
    return {k: sorted(v, key=lambda d: d.description_key) for k, v in out.items()}


def _grantor_out(key: str, fields: dict[str, Any], descriptions: list[GrantorDescription]) -> GrantorOut:
    return GrantorOut(key=key, descriptions=descriptions, **fields)


class GrantsService:
    def __init__(self, repo: GrantsRepository, *, clock: Callable[[], datetime] | None = None) -> None:
        self.repo = repo
        self._clock = clock or (lambda: datetime.now(UTC))

    def _today(self) -> date:
        """Today in camp time (a commitment's days waiting; spec §6.2's camp-time dates)."""
        return self._clock().astimezone(CAMP_TZ).date()

    async def _commit(
        self, writes: list[AidWrite], *, actor: str, reason: str | None, require_reason: bool = False
    ) -> AidOperationResult:
        return await asyncio.to_thread(
            commit_aid_writes, self.repo.pb, writes, actor=actor, reason=reason, require_reason=require_reason
        )

    # --- the grantor directory (rules) ------------------------------------------

    async def list_grantors(self) -> GrantorsResponse:
        grantors = await self.repo.fetch_grantors()
        descriptions = _descriptions_by_grantor(await self.repo.fetch_sources())
        rows = [_grantor_out(str(g.key), _grantor_snapshot(g), descriptions.get(str(g.key), [])) for g in grantors]
        return GrantorsResponse(grantors=sorted(rows, key=lambda g: (g.name.lower(), g.key)))

    async def create_grantor(self, body: GrantorCreate, actor: str) -> GrantorOut:
        if await self.repo.get_grantor(body.key) is not None:
            raise GrantorKeyTakenError(f"a grantor with key {body.key!r} already exists")
        fields = body.model_dump(include=set(GRANTOR_FIELDS))
        season = await current_season_year(self.repo.pb)  # the directory spans seasons; log the current one
        write = AidWrite(
            collection=AID_GRANTORS,
            action="create",
            year=season,
            data={"key": body.key, **fields, "note": body.note},
            after={"key": body.key, **fields},
            entity_id=body.key,
        )
        await self._commit([write], actor=actor, reason=body.note)
        return _grantor_out(body.key, fields, [])

    async def save_grantor(self, key: str, body: GrantorSave, actor: str) -> GrantorOut:
        current = await self.repo.get_grantor(key)
        if current is None:
            raise FinancialAidNotFoundError(f"grantor {key!r} not found")
        before = _grantor_snapshot(current)
        after = body.model_dump(include=set(GRANTOR_FIELDS))
        descriptions = _descriptions_by_grantor(await self.repo.fetch_sources()).get(key, [])
        if changed_fields(before, after) == ({}, {}):
            return _grantor_out(key, before, descriptions)  # nothing to write, nothing to log
        season = await current_season_year(self.repo.pb)
        write = AidWrite(
            collection=AID_GRANTORS,
            action="update",
            year=season,
            record_id=str(current.id),
            before=before,
            data={**after, "note": body.note},
            after=after,
            entity_id=key,
        )
        await self._commit([write], actor=actor, reason=body.note)
        return _grantor_out(key, after, descriptions)
