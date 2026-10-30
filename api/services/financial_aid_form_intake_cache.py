"""Requests › Form intake in the Camperships season cache (follow-up B to PR 3).

Form intake's explain service (financial_aid_form_intake.py) reads a whole season -- the FA mirror and the season's
people through layer 1, the sessions and registrations, every request, addition, decision and cancellation, the camp
aid lines and household links, the intake rules, and (2027 on) the dated registration asks with every registration's
dates and the adult aid Google Form's responses and last pull -- and explains every row, on every read. Four reads make that build: the Requests band count
(/intake/{year}/summary), the page (/forms), Season's D170 line opened in place (/aid-on-no-request) and Today's
form_intake line (needs_a_look), and Today and the Requests band are read on every Camperships page load. This
wraps the service from the outside, so the explain code itself is unchanged:

  - `rows`: the explained season and its unnamed rows, built once and shared by all four reads, so the band's count,
    the page's counts, Today's line and the D170 total are one computation;
  - `summary`, `forms`, `look`, `aid`: each response as its read builds it from those rows. Each names its own
    households (the labels' tie-break is scoped to the households a response names), so each is its own entry; the
    summary only counts the rows, and is held so a repeat read returns the one response too.

Find a Camper Not Listed… (/unlisted) is a search, a different query every time, and reads the season itself.

Keyed and cleared like the priced season (aid_season_cache.py), on its own singleton (api.dependencies
form_intake_cache) so its entries never evict a priced season:
  - (year, camp-time day, part), so one season never serves the other;
  - every Camperships write clears its own year (on_aid_commit, commit_aid_writes' listener: add, remove, Mark
    Reviewed, a Q5 Round 1, intake's own run), or every year for a write to a season-spanning table;
  - a sync job's completion clears it when the job writes a table these reads read (FORM_INTAKE_SYNC_TABLES, pinned
    by test_the_form_intake_sync_scope_is_exactly_what_its_reads_read, which records a cold build's reads);
  - the layer-1 refresher's six-hour backstop clears it with layer 1, which the rows were built from;
  - its five-minute TTL caps any missed clear.

SHARED VALUE. Every request reads the same rows and responses, so nothing may write into one (the explain code
copies a row with model_copy before naming it). test_the_reads_that_share_a_cached_season_never_change_it holds that.

Single uvicorn process assumed (docker/Dockerfile.api), as for every Camperships cache."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from api.constants.collections import (
    AID_FORM_RESPONSES,
    AID_GOOGLE_FORMS,
    AID_HOUSEHOLD_LINKS,
    AID_POSTINGS,
    AID_SOURCES,
    ATTENDEES,
    CAMP_SESSIONS,
    CUSTOM_FIELD_DEFS,
    FINANCIAL_AID_APPLICATIONS,
    HOUSEHOLDS,
    PERSON_CUSTOM_VALUES,
    PERSONS,
)
from api.constants.sync_job_writes import sync_writes_any
from api.schemas.financial_aid_form_intake import (
    AidOnNoRequestResponse,
    FormIntakeResponse,
    FormIntakeRowOut,
    FormIntakeSummaryOut,
)
from api.services.aid_season_cache import AidSeasonCache
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_form_intake import FormIntakeLook, FormIntakeService, FormIntakeStore, _Season
from api.services.financial_aid_registration_ask import ASK_HISTORY_COLLECTION

# The sync-written collections Form intake's cached reads read: layer 1's (the people, households, registrations,
# equity answers and the FA mirror, which fetch_fa_rows reads through it), the sessions and registrations it reads
# itself, the camp aid lines and household links the aid_postings job writes, and the funding sources Grants' "Needs a
# camper" count reads beside the page, and (2027 on) the dated registration asks the custom-values and FA jobs append
# (PR 4b's why-nots), and (2027 on) the adult aid Google Form's responses and last pull (PR 2). The aid_* tables
# nothing but commit_aid_writes writes are cleared by its listener (on_aid_commit). Derived, not guessed: see this module's docstring.
FORM_INTAKE_SYNC_TABLES: frozenset[str] = frozenset(
    {
        PERSONS,
        HOUSEHOLDS,
        ATTENDEES,
        PERSON_CUSTOM_VALUES,
        CUSTOM_FIELD_DEFS,
        CAMP_SESSIONS,
        FINANCIAL_AID_APPLICATIONS,
        AID_POSTINGS,
        AID_SOURCES,
        AID_HOUSEHOLD_LINKS,
        ASK_HISTORY_COLLECTION,
        # The adult aid Google Form mirror and its season row (PR 2), which the hourly form job writes.
        AID_FORM_RESPONSES,
        AID_GOOGLE_FORMS,
    }
)


def sync_changes_form_intake(sync_type: str | None) -> bool:
    """Whether a finished `sync_type` changes what Form intake reads, so must clear its cache. Fails safe like every
    server cache's scope (sync_writes_any): no job named, an empty name, or an unclassified job clears."""
    return sync_writes_any(sync_type, FORM_INTAKE_SYNC_TABLES)


class CachedFormIntakeService(FormIntakeService):
    """The explain service, its season reads served from `cache` (the process's form_intake_cache)."""

    def __init__(
        self,
        store: FormIntakeStore,
        *,
        cache: AidSeasonCache,
        clock: Callable[[], datetime] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(store, **kwargs)
        self._cache = cache
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    async def _rows(self, year: int) -> tuple[_Season, list[FormIntakeRowOut]]:
        build = super()._rows
        return await self._cache.get_or_build_part(int(year), self._today(), "rows", lambda: build(int(year)))

    async def summary(self, year: int) -> FormIntakeSummaryOut:
        build = super().summary
        return await self._cache.get_or_build_part(int(year), self._today(), "summary", lambda: build(int(year)))

    async def forms(self, year: int) -> FormIntakeResponse:
        build = super().forms
        return await self._cache.get_or_build_part(int(year), self._today(), "forms", lambda: build(int(year)))

    async def needs_a_look(self, year: int) -> FormIntakeLook:
        build = super().needs_a_look
        return await self._cache.get_or_build_part(int(year), self._today(), "look", lambda: build(int(year)))

    async def aid_on_no_request(self, year: int) -> AidOnNoRequestResponse:
        build = super().aid_on_no_request
        return await self._cache.get_or_build_part(int(year), self._today(), "aid", lambda: build(int(year)))
