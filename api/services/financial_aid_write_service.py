"""Campership ledger writes (sub-project 4): source classifications, staff
household links and reviewed attribution overrides.

Every write goes through sub-project 4a's commit_aid_writes, which sends the
record write and its aid_change_log row in ONE PocketBase batch: they commit
together or not at all. Nothing here writes through the repository (it is
read-only) and nothing logs afterwards. Each method is one staff action, so it
makes one commit_aid_writes call and every row it writes shares one
operation_id. actor is the real signed-in person (AuthUser.email), recorded
on every write.

A reason is required on every write (spec §14.4: overrides and exceptions; a
classification and a delete already require one at the API).

Classifications, links and overrides take effect on the next aid_postings run
(POST /api/custom/sync/aid-postings?year= runs it on demand). The Go sync never comes here: spec §14.4 does not log
the CampMinder sync.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

from api.constants.collections import (
    AID_ATTRIBUTION_OVERRIDES,
    AID_HOUSEHOLD_LINKS,
    AID_SOURCES,
)
from api.schemas.financial_aid import (
    AidSourceRow,
    AidSourceUpdate,
    BulkLoadResult,
    HouseholdLinkCreate,
    HouseholdLinkRow,
    LoadRejection,
    OverrideBulkLoad,
    SourceGrantorIn,
)
from api.services.financial_aid_ledger_service import (
    GRANT_FUNDER_TYPES,
    FinancialAidNotFoundError,
    FinancialAidValidationError,
    normalize_aid_label,
    source_row,
)
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.lodging_cache_warm import current_season_year
from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_log import AidWrite, AidWriteConflictError, commit_aid_writes
from bunking.pocketbase_batch import MAX_BATCH_REQUESTS, BatchRequestFailedError

# A bulk load is ONE atomic operation: each changed row is two batch requests
# (the record and its log row), all in one batch. A reviewed load is one finance
# decision, so it is never chunked: a load that would change more rows than one
# batch holds is refused whole, before anything is written, and the caller
# splits the file (each part its own reviewed operation).
MAX_ROWS_CHANGED_PER_LOAD = MAX_BATCH_REQUESTS // 2

SOURCE_FIELDS = (
    "source_name",
    "source_family",
    "funder_type",
    "counts_as_aid",
    "counts_toward_budget",
    "implied_program_families",
    "classified_by",
    "note",
)
LINK_FIELDS = ("year", "household_cm_id", "family_key", "source", "excluded", "note", "actor")
OVERRIDE_NUMBERS = ("transaction_cm_id", "year", "attributed_person_cm_id", "attributed_session_cm_id")
OVERRIDE_TEXT = ("program_family", "source_key_override", "source", "note")


def _snapshot(record: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    return {f: getattr(record, f, None) for f in fields}


def _typed_snapshot(record: Any, numbers: tuple[str, ...], text: tuple[str, ...]) -> dict[str, Any]:
    out: dict[str, Any] = {f: int(getattr(record, f, 0) or 0) for f in numbers}
    out.update({f: str(getattr(record, f, "") or "") for f in text})
    return out


def _unchanged(before: dict[str, Any], after: dict[str, Any]) -> bool:
    """The helper's own test for a no-op (it refuses to log one), applied first."""
    return changed_fields(before, after) == ({}, {})


def _refuse_oversized_load(result: BulkLoadResult) -> None:
    changed = result.created + result.updated
    if changed > MAX_ROWS_CHANGED_PER_LOAD:
        raise FinancialAidValidationError(
            f"this load would change {changed} rows; one load is one atomic operation of at most "
            f"{MAX_ROWS_CHANGED_PER_LOAD} changed rows, so split it into smaller loads"
        )


def _stage_upsert(
    *,
    writes: list[AidWrite],
    result: BulkLoadResult,
    collection: str,
    year: int,
    actor: str,
    payload: dict[str, Any],
    current: Any | None,
    numbers: tuple[str, ...],
    text: tuple[str, ...],
    reason: str | None,
) -> None:
    """Compare ``current`` (a repository row, or None) against the incoming
    ``payload``, skip a no-op via ``changed_fields``, and stage the create or
    update ``AidWrite``, recording it in ``result`` and ``writes``.

    Used by ``load_overrides``: it upserts a row
    by a key, logs only the placement (not who loaded it), and count
    created/updated/unchanged the same way.
    """
    if current is None:
        result.created += 1
        writes.append(
            AidWrite(
                collection=collection,
                action="create",
                year=year,
                data={**payload, "actor": actor},
                after=payload,
                reason=reason,
            )
        )
        return
    before = _typed_snapshot(current, numbers, text)
    if _unchanged(before, payload):
        result.unchanged += 1
        return
    result.updated += 1
    writes.append(
        AidWrite(
            collection=collection,
            action="update",
            year=year,
            record_id=str(current.id),
            before=before,
            data={**payload, "actor": actor},
            after=payload,
            reason=reason,
        )
    )


class FinancialAidWriteService:
    def __init__(self, repo: FinancialAidRepository) -> None:
        self.repo = repo

    async def classify_source(self, source_id: str, body: AidSourceUpdate, actor: str) -> AidSourceRow:
        current = await self.repo.get_source(source_id)
        if current is None:
            raise FinancialAidNotFoundError(f"aid source {source_id} not found")
        patch = body.model_dump()
        patch["implied_program_families"] = sorted(set(body.implied_program_families))
        patch["classified_by"] = "staff"
        current_grantor_key = str(getattr(current, "grantor_key", "") or "")
        # A grantor is named only by an outside grant or incentive description (D58): reclassifying
        # one as the camp's own aid (or back to unknown) drops its grantor in the same write.
        if current_grantor_key and body.funder_type not in GRANT_FUNDER_TYPES:
            patch["grantor_key"] = ""
        before = _snapshot(current, SOURCE_FIELDS)
        # An unset json field reads back as None; [] is the same classification, not a change to log.
        before["implied_program_families"] = list(before["implied_program_families"] or [])
        before["grantor_key"] = current_grantor_key
        after = {**before, **patch}
        if _unchanged(before, after):
            return source_row(current)  # nothing to write, nothing to log
        season = await current_season_year(self.repo.pb)  # aid_sources span seasons; log the current one
        write = AidWrite(
            collection=AID_SOURCES, action="update", year=season, record_id=source_id, before=before, data=patch
        )
        await asyncio.to_thread(
            commit_aid_writes,
            self.repo.pb,
            [write],
            actor=actor,
            reason=body.note,
            require_reason=True,
        )
        return source_row(
            SimpleNamespace(
                id=source_id, description_key=current.description_key, description=current.description, **after
            )
        )

    async def map_source_grantor(self, source_id: str, body: SourceGrantorIn, actor: str) -> AidSourceRow:
        """Names (or clears) the grantor a CampMinder description belongs to (spec §8.2, D58).
        Writes only grantor_key: a mapping is not a classification, so classified_by stays as it was
        (Decision 9). The file never rewrites a row that exists (D105), so nothing else touches it."""
        current = await self.repo.get_source(source_id)
        if current is None:
            raise FinancialAidNotFoundError(f"aid source {source_id} not found")
        key = body.grantor_key or ""
        if key:
            if str(current.funder_type) not in GRANT_FUNDER_TYPES:
                raise FinancialAidValidationError(
                    "only an outside grant or incentive description names a grantor; classify it first"
                )
            if await self.repo.get_grantor(key) is None:
                raise FinancialAidNotFoundError(f"grantor {key!r} not found")
        fields = {f: getattr(current, f, None) for f in SOURCE_FIELDS}
        before = {"grantor_key": str(getattr(current, "grantor_key", "") or "")}
        row = SimpleNamespace(
            id=source_id, description_key=current.description_key, description=current.description, **fields
        )
        if before["grantor_key"] == key:
            return source_row(SimpleNamespace(**vars(row), grantor_key=key))  # nothing to write, nothing to log
        season = await current_season_year(self.repo.pb)
        write = AidWrite(
            collection=AID_SOURCES,
            action="update",
            year=season,
            record_id=source_id,
            before=before,
            data={"grantor_key": key},
            log_action="map_grantor",
        )
        await asyncio.to_thread(
            commit_aid_writes, self.repo.pb, [write], actor=actor, reason=body.note, require_reason=True
        )
        return source_row(SimpleNamespace(**vars(row), grantor_key=key))

    async def create_link(self, body: HouseholdLinkCreate, actor: str) -> HouseholdLinkRow:
        rows = await self.repo.fetch_links(body.year)
        same = [r for r in rows if int(r.household_cm_id) == body.household_cm_id and r.family_key == body.family_key]
        payload: dict[str, Any] = {
            "year": body.year,
            "household_cm_id": body.household_cm_id,
            "family_key": body.family_key,
            "source": "staff",
            "excluded": body.excluded,
            "note": body.note,
            "actor": actor,
        }
        if same:
            existing = same[0]
            if existing.source == "staff":
                raise FinancialAidValidationError("a staff link for this household and family key already exists")
            if not body.excluded:
                raise FinancialAidValidationError("this household is already linked to that family automatically")
            write = AidWrite(
                collection=AID_HOUSEHOLD_LINKS,
                action="update",
                year=body.year,
                record_id=str(existing.id),
                before=_snapshot(existing, LINK_FIELDS),
                data=payload,
            )
        else:
            if body.excluded:
                raise FinancialAidValidationError("nothing to exclude: no automatic link joins these")
            write = AidWrite(collection=AID_HOUSEHOLD_LINKS, action="create", year=body.year, data=payload)
        try:
            result = await asyncio.to_thread(
                commit_aid_writes,
                self.repo.pb,
                [write],
                actor=actor,
                reason=body.note,
                require_reason=True,
            )
        except BatchRequestFailedError as exc:
            # G6 (Ruling 2026-10-01): the aid_postings sync swept this automatic row after we read it, so the
            # in-place conversion found nothing (404). Refused whole, like every other G6 conflict: reload.
            if write.action == "update" and exc.status == 404:
                raise AidWriteConflictError(collection=AID_HOUSEHOLD_LINKS, record_id=str(write.record_id)) from exc
            # The mirror race: the sync created the automatic row after we read none, so the staff create hits the
            # (household, family key, year) unique index. Same refusal: reload.
            if (
                write.action == "create"
                and exc.index == 0
                and exc.status == 400
                and any("unique" in message.lower() for message in exc.field_errors.values())
            ):
                raise AidWriteConflictError(collection=AID_HOUSEHOLD_LINKS, record_id="") from exc
            raise
        return HouseholdLinkRow(id=result.record_ids[0], **payload)

    async def delete_link(self, link_id: str, actor: str, reason: str) -> None:
        current = await self.repo.get_link(link_id)
        if current is None:
            raise FinancialAidNotFoundError(f"household link {link_id} not found")
        if current.source != "staff":
            raise FinancialAidValidationError("automatic links are recomputed on every sync; add an exclusion instead")
        write = AidWrite(
            collection=AID_HOUSEHOLD_LINKS,
            action="delete",
            year=int(current.year),
            record_id=str(current.id),
            before=_snapshot(current, LINK_FIELDS),
        )
        await asyncio.to_thread(
            commit_aid_writes, self.repo.pb, [write], actor=actor, reason=reason, require_reason=True
        )

    def _source_target_problem(self, key: str, sources: dict[str, Any]) -> str | None:
        target = sources.get(key)
        if target is None:
            return f"source {key!r} is not in aid_sources"
        if target.classified_by == "unclassified" or not target.counts_as_aid:
            return f"source {key!r} is not classified as aid"
        return None

    async def load_overrides(self, body: OverrideBulkLoad, actor: str) -> BulkLoadResult:
        postings = await self.repo.fetch_posting_transaction_ids(body.year)
        sessions = await self.repo.fetch_session_ids(body.year)
        sources = {str(s.description_key): s for s in await self.repo.fetch_sources()}
        existing = {int(o.transaction_cm_id): o for o in await self.repo.fetch_overrides(body.year)}
        result = BulkLoadResult(year=body.year, dry_run=body.dry_run)
        writes: list[AidWrite] = []
        for row in body.rows:
            if row.transaction_cm_id not in postings:
                result.rejected.append(
                    LoadRejection(
                        transaction_cm_id=row.transaction_cm_id,
                        reason=f"no aid posting with this transaction id in {body.year}",
                    )
                )
                continue
            if row.attributed_session_cm_id is not None and row.attributed_session_cm_id not in sessions:
                result.rejected.append(
                    LoadRejection(
                        transaction_cm_id=row.transaction_cm_id,
                        reason=f"session {row.attributed_session_cm_id} does not exist in {body.year}",
                    )
                )
                continue
            target = normalize_aid_label(row.source_key_override) if row.source_key_override else ""
            if target and (problem := self._source_target_problem(target, sources)):
                result.rejected.append(LoadRejection(transaction_cm_id=row.transaction_cm_id, reason=problem))
                continue
            payload: dict[str, Any] = {
                "transaction_cm_id": row.transaction_cm_id,
                "year": body.year,
                "attributed_person_cm_id": row.attributed_person_cm_id or 0,
                "attributed_session_cm_id": row.attributed_session_cm_id or 0,
                "program_family": row.program_family or "",
                "source_key_override": target,
                "source": body.source,
                "note": row.note,
            }
            # The record also stores who loaded it; the log row's actor column says
            # that, so the logged diff is the placement alone (after=payload).
            _stage_upsert(
                writes=writes,
                result=result,
                collection=AID_ATTRIBUTION_OVERRIDES,
                year=body.year,
                actor=actor,
                payload=payload,
                current=existing.get(row.transaction_cm_id),
                numbers=OVERRIDE_NUMBERS,
                text=OVERRIDE_TEXT,
                reason=row.note or None,
            )
        _refuse_oversized_load(result)
        if writes and not body.dry_run:
            committed = await asyncio.to_thread(
                commit_aid_writes,
                self.repo.pb,
                writes,
                actor=actor,
                reason=body.reason,
                require_reason=True,
            )
            result.operation_id = committed.operation_id
        return result
