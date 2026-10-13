"""Layer 1 of the Camperships cache: the season's SYNC-WRITTEN inputs, read whole and joined in Python.

Only the CampMinder sync writes these tables (the classification test pins it), so they change only when
a sync finishes -- `invalidate_server_caches` clears this cache through kindred#2803's job-to-table map.
A Camperships write never touches them, which is why a season rebuild after a post (layer 2,
aid_season_cache.py) reads none of them.

WHOLE-YEAR READS ON PURPOSE. This reverses fetch_enrollment_states' old rule ("never the whole season:
only the people the requests name"). Measured on the 2026-10-07 prod snapshot, one season is 2,676
persons, 3,042 attendees, 2,127 households and 2,456 equity values -- about a dozen paged reads -- while
the by-id reads it replaces made hundreds of chunked filters through relations (person.household_id,
person.cm_id, the four-way household OR), which SQLite cannot index: 85% of the PocketBase time in the
2026-10-12 smoke test. Do not "fix" this back to by-id chunks.

Expands are fine; FILTERS through relations are not. `expand=person` is a primary-key lookup per page;
`filter=person.cm_id = N` is a join on every candidate row.

SHARED RECORDS. Every request reads the same row objects, so nothing may write to one: a caller that needs
a changed row copies it first. Households are held with HOUSEHOLD_COLUMNS only, never the hidden adults list
(fetch_households(adults=True) still reads that itself), so a shared row cannot carry it to a reader that
was never meant to see it.

Single uvicorn process assumed (docker/Dockerfile.api): with workers this cache is per process.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from api.constants.collections import (
    ATTENDEES,
    CAMP_SESSIONS,
    CUSTOM_FIELD_DEFS,
    HOUSEHOLD_COLUMNS,
    HOUSEHOLDS,
    PERSON_CUSTOM_VALUES,
    PERSONS,
)
from api.dependencies import aid_inputs_cache
from api.dependencies import pb as default_pb
from api.services.lodging_cache import cached_by_year
from api.services.pb_precise_datetime import aid_collection
from api.services.pb_read import pb_read
from bunking.logging_config import get_logger

logger = get_logger(__name__)

AID_SYNC_INPUT_TABLES: Final[tuple[str, ...]] = (
    PERSONS,
    HOUSEHOLDS,
    ATTENDEES,
    PERSON_CUSTOM_VALUES,
    CUSTOM_FIELD_DEFS,
    CAMP_SESSIONS,
)
_PAGE: Final = 1000
_HOUSEHOLD_RELATIONS: Final = ("household", "primary_childhood_household", "alternate_childhood_household")


@dataclass(frozen=True)
class AidSyncInputs:
    """One season's inputs. Every tuple is in PocketBase-id order, the order a `sort=id` read returns."""

    year: int
    person_by_cm_id: Mapping[int, Any]
    household_by_cm_id: Mapping[int, Any]
    # Keyed on the person's own household_id column only.
    persons_by_household_id: Mapping[int, tuple[Any, ...]]
    # Go's attribution rule: own household_id, or the household / primary / alternate childhood relation.
    members_by_household: Mapping[int, tuple[Any, ...]]
    # Every status, each row with expand.person and expand.session.
    attendees_by_person_cm_id: Mapping[int, tuple[Any, ...]]
    # Only the allowlisted equity fields (EQUITY_FIELD_CM_IDS), each row with expand.person and
    # expand.field_definition.
    equity_values_by_person_cm_id: Mapping[int, tuple[Any, ...]]


def _cm(record: Any, relation: str) -> int:
    expanded = (getattr(record, "expand", None) or {}).get(relation)
    return int(getattr(expanded, "cm_id", 0) or 0)


def build_inputs(
    year: int, persons: list[Any], households: list[Any], attendees: list[Any], values: list[Any]
) -> AidSyncInputs:
    """The Python joins. Membership is Go's attribution rule (fetch_household_persons_by_household):
    own household_id, or the household / primary / alternate childhood relation -- every one that applies."""
    by_own: dict[int, list[Any]] = defaultdict(list)
    members: dict[int, list[Any]] = defaultdict(list)
    for p in persons:
        own = int(getattr(p, "household_id", 0) or 0)
        if own > 0:
            by_own[own].append(p)
        # Sorted so a person lands under each household in a fixed order; each list stays in id order regardless.
        for h in sorted({own, *(_cm(p, r) for r in _HOUSEHOLD_RELATIONS)} - {0}):
            members[h].append(p)
    by_person: dict[int, list[Any]] = defaultdict(list)
    for a in attendees:
        by_person[int(getattr(a, "person_id", 0) or 0)].append(a)
    equity: dict[int, list[Any]] = defaultdict(list)
    for v in values:
        equity[_cm(v, "person")].append(v)
    return AidSyncInputs(
        year=year,
        person_by_cm_id={int(p.cm_id): p for p in persons},
        household_by_cm_id={int(h.cm_id): h for h in households},
        persons_by_household_id={k: tuple(v) for k, v in by_own.items()},
        members_by_household={k: tuple(v) for k, v in members.items()},
        attendees_by_person_cm_id={k: tuple(v) for k, v in by_person.items()},
        equity_values_by_person_cm_id={k: tuple(v) for k, v in equity.items()},
    )


class _Loader:
    """`cached_by_year` wraps a `(self, year)` method, hence the class."""

    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _all(self, collection: str, params: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await pb_read(
            aid_collection(self.pb, collection).get_full_list, batch=_PAGE, query_params={"sort": "id", **params}
        )
        return rows

    @cached_by_year(aid_inputs_cache, tables=AID_SYNC_INPUT_TABLES)
    async def load(self, year: int) -> AidSyncInputs:
        # The intake repository reads through this module, so its allowlist is looked up here, at fill time.
        from api.services import financial_aid_intake_repository as intake  # noqa: PLC0415 - circular

        y = int(year)
        # custom_field_defs has no year: one definition per CampMinder field.
        defs = await self._all(
            CUSTOM_FIELD_DEFS,
            {"filter": " || ".join(f"cm_id = {c}" for c in intake.EQUITY_FIELD_CM_IDS), "fields": "id,cm_id"},
        )
        field_ids = " || ".join(f'field_definition = "{d.id}"' for d in defs) or 'field_definition = ""'
        persons, households, attendees, values = await asyncio.gather(
            self._all(PERSONS, {"filter": f"year = {y}", "expand": ",".join(_HOUSEHOLD_RELATIONS)}),
            self._all(HOUSEHOLDS, {"filter": f"year = {y}", "fields": HOUSEHOLD_COLUMNS}),
            self._all(ATTENDEES, {"filter": f"year = {y}", "expand": "person,session"}),
            self._all(
                PERSON_CUSTOM_VALUES, {"filter": f"year = {y} && ({field_ids})", "expand": "person,field_definition"}
            ),
        )
        return build_inputs(y, persons, households, attendees, values)


async def aid_sync_inputs(pb: Any, year: int) -> AidSyncInputs:
    """The season's sync-written inputs: cached per year, and filled once however many callers ask at once."""
    return await _Loader(pb).load(year)


# The in-flight background warm, if any, held as a strong reference (the event loop holds only a weak one), and
# whether another warm was asked for while it ran -- the coalescing schedule_lodging_warm uses.
_warm_task: asyncio.Task[None] | None = None
_rerun_requested = False


async def _warm_current_season() -> None:
    """Fill layer 1 for the dashboard's configured season. Never raises: nobody is waiting on it."""
    # financial_aid_rules_service reaches the repositories that read through this module.
    from api.services.financial_aid_rules_service import configured_season_year  # noqa: PLC0415 - circular

    try:
        await aid_sync_inputs(default_pb, await configured_season_year(default_pb))
    except Exception as exc:  # a failed warm costs a log line; the next request reads for itself
        logger.warning(f"Camperships sync-input warm failed: {exc}")


async def _warm_until_settled() -> None:
    global _rerun_requested
    while True:
        _rerun_requested = False
        await _warm_current_season()
        if not _rerun_requested:
            return


def schedule_aid_warm() -> None:
    """Start a background fill of the configured season, and return at once. One warm at a time: a request that
    lands mid-warm becomes a single rerun after it (see schedule_lodging_warm)."""
    global _rerun_requested, _warm_task
    loop = asyncio.get_running_loop()
    # A task from another event loop (a finished pytest loop) can never complete here.
    if _warm_task is not None and not _warm_task.done() and _warm_task.get_loop() is loop:
        _rerun_requested = True
        return
    _warm_task = loop.create_task(_warm_until_settled())
