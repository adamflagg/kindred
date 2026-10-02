"""PocketBase reads for the campership ledger (sub-project 4).

Through FastAPI's superuser client: every aid_* collection has null rules, and
the router gates every call on a financial_aid.* permission before it gets
here. Every paged read ends its sort on `id` (see jotform_repository.py).
aid_postings reads are LIVE ROWS ONLY unless the caller asks for history.

READ-ONLY on purpose. Every staff write goes through sub-project 4a's
commit_aid_writes (financial_aid_write_service.py), which commits the record
and its aid_change_log row in one batch; a write method here would invite a
write whose log row could be lost.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any

from api.constants.collections import (
    AID_ATTRIBUTION_OVERRIDES,
    AID_FLAG_DISPOSITIONS,
    AID_GRANTORS,
    AID_HOUSEHOLD_LINKS,
    AID_POSTINGS,
    AID_SESSION_CAPACITY,
    AID_SOURCES,
    ATTENDEES,
    CAMP_SESSIONS,
    FINANCIAL_AID_APPLICATIONS,
    FINANCIAL_TRANSACTIONS,
    HOUSEHOLDS,
    PERSONS,
    USERS,
)
from api.services.lodging_repository import STABLE_SORT
from api.services.pb_precise_datetime import aid_collection
from api.utils.pb_filters import pb_escape

PAGE_SIZE = 1000
ID_CHUNK = 100
# A household's family filter is four terms (~145 characters). Eight households keep one filter near
# 1,200 characters, well under the 3,500-character limit below; 25 go over it and PocketBase answers
# 400. One query per household instead cost ~65 ms each (SP6-core T7).
HOUSEHOLD_CHUNK = 8
# An email term is under 100 characters, so 25 keep a filter well below the 3,500-character limit below.
USER_CHUNK = 25
_PERSON_HOUSEHOLD_RELATIONS = ("household", "primary_childhood_household", "alternate_childhood_household")
# PocketBase v0.40.4 refuses any filter over 3500 characters
# (tools/search/provider.go:31); keep a margin below it and a cap on term count
# per chunk so one emitted filter never approaches the hard limit.
AID_LIKE_FILTER_BUDGET = 3000
AID_LIKE_CHUNK_MAX_TERMS = 25
# The two aid categories. 3839 (Adjustments) is mostly staff discounts and work
# exchange; it holds aid only where aid_sources classifies a description so.
AID_CATEGORY_IDS = (3840, 19616)
# Generic words that make a description look like aid. An aid-like description
# outside the aid categories is a data-quality item, never dropped silently
# (spec §6.3). Generic on purpose: no camp or funder name belongs here.
AID_LIKE_WORDS = ("financial assistance", "financial aid", "campership", "scholarship", "grant", "incentive")


@dataclass(frozen=True)
class FaRequestRow:
    household_cm_id: int
    summer: float
    family_camp: float
    bmitzvah: float


def _any_of(field: str, ids: Sequence[int]) -> str:
    return " || ".join(f"{field} = {int(i)}" for i in ids)


def _positive_unique(ids: Collection[int]) -> list[int]:
    return sorted({int(i) for i in ids if int(i) > 0})


def chunk_filter_terms(
    base_len: int,
    terms: Sequence[str],
    budget: int = AID_LIKE_FILTER_BUDGET,
    max_terms: int = AID_LIKE_CHUNK_MAX_TERMS,
) -> list[list[str]]:
    """Groups already-escaped filter clauses so that a filter of `base_len`
    characters plus ` && (term || term || ...)` never crosses `budget`
    characters, and no group holds more than `max_terms` clauses."""
    wrapper_len = len(" && (") + len(")")
    separator_len = len(" || ")
    chunks: list[list[str]] = []
    current: list[str] = []
    current_len = 0
    for term in terms:
        added = len(term) if not current else separator_len + len(term)
        if current and (base_len + wrapper_len + current_len + added > budget or len(current) >= max_terms):
            chunks.append(current)
            current, current_len = [], 0
            added = len(term)
        current.append(term)
        current_len += added
    if current:
        chunks.append(current)
    return chunks


class FinancialAidRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await asyncio.to_thread(
            aid_collection(self.pb, collection).get_full_list, batch=PAGE_SIZE, query_params=query_params
        )
        return rows

    async def _by_ids(
        self, collection: str, base_filter: str, field: str, ids: Collection[int], extra: dict[str, Any] | None = None
    ) -> list[Any]:
        out: list[Any] = []
        unique = _positive_unique(ids)
        for start in range(0, len(unique), ID_CHUNK):
            chunk = unique[start : start + ID_CHUNK]
            params = {"filter": f"{base_filter} && ({_any_of(field, chunk)})", "sort": STABLE_SORT, **(extra or {})}
            out.extend(await self._page(collection, params))
        return out

    async def _one(self, collection: str, record_id: str) -> Any | None:
        rows = await self._page(collection, {"filter": f"id = '{pb_escape(record_id)}'", "sort": STABLE_SORT})
        return rows[0] if rows else None

    # --- postings, sources, links, overrides, dispositions ------------------

    async def fetch_postings(
        self, year: int, household_ids: Collection[int] | None = None, *, include_reversed: bool = False
    ) -> list[Any]:
        base = f"year = {int(year)}" if include_reversed else f"year = {int(year)} && is_reversed = false"
        if household_ids is None:
            return await self._page(AID_POSTINGS, {"filter": base, "sort": STABLE_SORT})
        return await self._by_ids(AID_POSTINGS, base, "household_cm_id", household_ids)

    async def fetch_posting_transaction_ids(self, year: int) -> set[int]:
        """Every transaction id with an aid_postings row this season, live or reversed."""
        rows = await self._page(
            AID_POSTINGS, {"filter": f"year = {int(year)}", "fields": "transaction_cm_id", "sort": STABLE_SORT}
        )
        return {int(r.transaction_cm_id) for r in rows}

    async def fetch_sources(self) -> list[Any]:
        return await self._page(AID_SOURCES, {"sort": f"description_key,{STABLE_SORT}"})

    async def get_source(self, source_id: str) -> Any | None:
        return await self._one(AID_SOURCES, source_id)

    async def fetch_grantors(self) -> list[Any]:
        return await self._page(AID_GRANTORS, {"sort": f"name,{STABLE_SORT}"})

    async def get_grantor(self, key: str) -> Any | None:
        rows = await self._page(AID_GRANTORS, {"filter": f"key = '{pb_escape(key)}'", "sort": STABLE_SORT})
        return rows[0] if rows else None

    async def fetch_links(self, year: int) -> list[Any]:
        return await self._page(AID_HOUSEHOLD_LINKS, {"filter": f"year = {int(year)}", "sort": STABLE_SORT})

    async def get_link(self, link_id: str) -> Any | None:
        return await self._one(AID_HOUSEHOLD_LINKS, link_id)

    async def fetch_overrides(self, year: int) -> list[Any]:
        return await self._page(AID_ATTRIBUTION_OVERRIDES, {"filter": f"year = {int(year)}", "sort": STABLE_SORT})

    async def fetch_dispositions(self, year: int) -> list[Any]:
        return await self._page(AID_FLAG_DISPOSITIONS, {"filter": f"year = {int(year)}", "sort": STABLE_SORT})

    # --- people, sessions, applications ------------------------------------

    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        return await self._by_ids(HOUSEHOLDS, f"year = {int(year)}", "cm_id", cm_ids)

    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]:
        return await self._by_ids(PERSONS, f"year = {int(year)}", "cm_id", cm_ids)

    async def fetch_session_counts(self, year: int, session_cm_ids: Collection[int]) -> dict[int, tuple[int, int]]:
        """Each session's enrolled (status 2, as the solver counts them) and waitlisted (status 8) registrations this
        season: Round 3's context (§6.3 item 4)."""
        rows = await self._by_ids(
            ATTENDEES,
            f"year = {int(year)} && (status_id = 2 || status_id = 8)",
            "session.cm_id",
            session_cm_ids,
            {"expand": "session", "fields": "status_id,expand.session.cm_id"},
        )
        counts = {s: [0, 0] for s in _positive_unique(session_cm_ids)}
        for row in rows:
            session = int(getattr((getattr(row, "expand", None) or {}).get("session"), "cm_id", 0) or 0)
            if session in counts:
                counts[session][0 if int(row.status_id) == 2 else 1] += 1
        return {s: (enrolled, waitlisted) for s, (enrolled, waitlisted) in counts.items()}

    async def fetch_capacities(self, year: int, session_cm_ids: Collection[int]) -> dict[int, Any]:
        """The capacity finance entered per session (aid_session_capacity), by session."""
        rows = await self._by_ids(AID_SESSION_CAPACITY, f"year = {int(year)}", "session_cm_id", session_cm_ids)
        return {int(r.session_cm_id): r for r in rows}

    async def fetch_household_persons(self, year: int, household_ids: Collection[int]) -> list[Any]:
        """Everyone the Go transform treats as a candidate for these households:
        own household, primary childhood household or alternate childhood household."""
        out: dict[str, Any] = {}
        for h in _positive_unique(household_ids):
            flt = (
                f"year = {int(year)} && (household_id = {h} || primary_childhood_household.cm_id = {h}"
                f" || alternate_childhood_household.cm_id = {h} || household.cm_id = {h})"
            )
            for p in await self._page(PERSONS, {"filter": flt, "sort": STABLE_SORT}):
                out[p.id] = p
        return list(out.values())

    async def fetch_household_persons_by_household(
        self, year: int, household_ids: Collection[int]
    ) -> dict[int, list[Any]]:
        """fetch_household_persons' pool for many households at once, split back per household:
        each person lands under every requested household that is their own or a primary or
        alternate childhood household. Households with nobody are left out."""
        wanted = _positive_unique(household_ids)
        wanted_set = set(wanted)
        found: dict[int, dict[str, Any]] = defaultdict(dict)
        for start in range(0, len(wanted), HOUSEHOLD_CHUNK):
            terms = " || ".join(
                f"household_id = {h} || primary_childhood_household.cm_id = {h}"
                f" || alternate_childhood_household.cm_id = {h} || household.cm_id = {h}"
                for h in wanted[start : start + HOUSEHOLD_CHUNK]
            )
            rows = await self._page(
                PERSONS,
                {
                    "filter": f"year = {int(year)} && ({terms})",
                    "sort": STABLE_SORT,
                    "expand": ",".join(_PERSON_HOUSEHOLD_RELATIONS),
                },
            )
            for p in rows:
                expand = getattr(p, "expand", None) or {}
                households = {int(getattr(p, "household_id", 0) or 0)} | {
                    int(getattr(expand.get(name), "cm_id", 0) or 0) for name in _PERSON_HOUSEHOLD_RELATIONS
                }
                for h in households & wanted_set:
                    found[h][str(p.id)] = p
        return {h: list(people.values()) for h, people in found.items()}

    async def fetch_enrollments(self, year: int, person_ids: Collection[int]) -> list[Any]:
        return await self._by_ids(ATTENDEES, f"year = {int(year)}", "person_id", person_ids, {"expand": "session"})

    async def fetch_session_ids(self, year: int) -> set[int]:
        rows = await self._page(
            CAMP_SESSIONS, {"filter": f"year = {int(year)}", "fields": "cm_id", "sort": STABLE_SORT}
        )
        return {int(r.cm_id) for r in rows}

    async def fetch_session_seasons(self, cm_ids: Collection[int]) -> dict[int, set[int]]:
        """The seasons each session id appears in, across every year."""
        out: dict[int, set[int]] = {}
        for r in await self._by_ids(CAMP_SESSIONS, "cm_id > 0", "cm_id", cm_ids, {"fields": "cm_id,year"}):
            out.setdefault(int(r.cm_id), set()).add(int(r.year))
        return out

    async def fetch_fa_requests(self, year: int, household_ids: Collection[int] | None = None) -> list[FaRequestRow]:
        """The FA mirror's per-program asks: the season's, or only these households' (spec §10: a single
        household's read must not pay for the whole season's mirror)."""
        asked = (
            f"year = {int(year)} && (summer_amount_requested > 0 || fc_amount_requested > 0"
            " || tbm_amount_requested > 0)"
        )
        params = {"expand": "household", "sort": STABLE_SORT}
        if household_ids is None:
            rows = await self._page(FINANCIAL_AID_APPLICATIONS, {"filter": asked, **params})
        else:
            rows = []
            wanted = _positive_unique(household_ids)
            for start in range(0, len(wanted), HOUSEHOLD_CHUNK):
                terms = _any_of("household.cm_id", wanted[start : start + HOUSEHOLD_CHUNK])
                rows += await self._page(FINANCIAL_AID_APPLICATIONS, {"filter": f"{asked} && ({terms})", **params})
        out: list[FaRequestRow] = []
        for r in rows:
            household = (getattr(r, "expand", None) or {}).get("household")
            if household is None:
                continue
            out.append(
                FaRequestRow(
                    household_cm_id=int(household.cm_id),
                    summer=float(r.summer_amount_requested or 0),
                    family_camp=float(r.fc_amount_requested or 0),
                    bmitzvah=float(r.tbm_amount_requested or 0),
                )
            )
        return out

    async def fetch_user_names(self, emails: Collection[str]) -> dict[str, str]:
        """Kindred users' display names by lowercased email, for the receipt label (§4.7): who ticked Posted, who
        decided a Round 3 amount. An actor that isn't a person (system:ledger) or has no name is left out."""
        # PocketBase's `=` is case-sensitive, so ask for the address as recorded and in lowercase; results are
        # keyed by lowercase.
        wanted = sorted({form for e in emails if "@" in e for form in (e.strip(), e.strip().lower())})
        out: dict[str, str] = {}
        for start in range(0, len(wanted), USER_CHUNK):
            terms = " || ".join(f"email = '{pb_escape(e)}'" for e in wanted[start : start + USER_CHUNK])
            for user in await self._page(USERS, {"filter": terms, "fields": "email,name", "sort": STABLE_SORT}):
                name = str(getattr(user, "name", "") or "").strip()
                if name:
                    out[str(user.email).strip().lower()] = name
        return out

    # --- raw transactions (data quality only) --------------------------------

    async def fetch_reversed_aid(self, year: int, household_ids: Collection[int] | None = None) -> list[Any]:
        categories = _any_of("financial_category_cm_id", AID_CATEGORY_IDS)
        base = f"year = {int(year)} && is_reversed = true && ({categories})"
        if household_ids is None:
            return await self._page(FINANCIAL_TRANSACTIONS, {"filter": base, "sort": STABLE_SORT})
        return await self._by_ids(FINANCIAL_TRANSACTIONS, base, "household_cm_id", household_ids)

    async def fetch_off_season_session_rows(self, year: int, season_session_ids: Collection[int]) -> list[Any]:
        """Live rows of the season whose session the season's camp_sessions do not
        hold. Nothing for a season with no synced sessions (SP1's rule).

        The season's sessions are excluded here, not in the filter: one `!=`
        clause per session would cross PocketBase's 3500-character filter limit
        (see AID_LIKE_FILTER_BUDGET) once a season holds ~120 sessions."""
        if not season_session_ids:
            return []
        season = {int(i) for i in season_session_ids}
        rows = await self._page(
            FINANCIAL_TRANSACTIONS,
            {
                "filter": f"year = {int(year)} && is_reversed = false && session_cm_id > 0",
                "fields": "cm_id,session_cm_id,amount",
                "sort": STABLE_SORT,
            },
        )
        return [r for r in rows if int(r.session_cm_id) not in season]

    async def _fetch_by_match_terms(self, year: int, outside: str, terms: Sequence[str]) -> list[Any]:
        return await self._page(
            FINANCIAL_TRANSACTIONS,
            {
                "filter": f"year = {int(year)} && is_reversed = false && {outside} && ({' || '.join(terms)})",
                "fields": "cm_id,financial_category_cm_id,description,amount",
                "sort": STABLE_SORT,
            },
        )

    async def fetch_aid_like_outside(self, year: int, aid_descriptions: Sequence[str]) -> list[Any]:
        """Live rows outside the two aid categories whose description has an aid
        word, or equals a description aid_sources classifies as aid.

        aid_sources is global, so as staff classify more descriptions this
        method's equality terms grow without bound; PocketBase v0.40.4 refuses
        any filter over ~3500 characters (tools/search/provider.go:31). The
        generic aid-word terms (always few) run as one query; the per-
        description equality terms are chunked to stay under that limit and
        the results are merged by transaction cm_id (a transaction's cm_id is
        unique within a season, and a row can legitimately match more than one
        query -- e.g. an aid word AND a chunked equality term).
        """
        outside = " && ".join(f"financial_category_cm_id != {c}" for c in AID_CATEGORY_IDS)
        word_terms = [f"description ~ '{pb_escape(w)}'" for w in AID_LIKE_WORDS]
        equality_terms = [f"description = '{pb_escape(d)}'" for d in aid_descriptions if d]

        merged: dict[int, Any] = {}
        for r in await self._fetch_by_match_terms(year, outside, word_terms):
            merged[int(r.cm_id)] = r
        base_len = len(f"year = {int(year)} && is_reversed = false && {outside}")
        for chunk in chunk_filter_terms(base_len, equality_terms):
            for r in await self._fetch_by_match_terms(year, outside, chunk):
                merged[int(r.cm_id)] = r
        return list(merged.values())
