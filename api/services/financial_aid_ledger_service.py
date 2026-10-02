"""Campership ledger read service (sub-project 4).

Reads the aid_postings ledger the Go transform materializes and shapes it for
finance. Every figure is AID DOLLARS (positive), summed in Decimal and rounded
half-up to cents. The ambiguous bucket is shown and never split, and neither is
a family-level total.

Live and as of a date. aid_postings holds live rows and, as history, the credit
leg of every reversed pair with its reversal_date. With no date a posting counts
when it is not reversed. As of a date D it counts when it was posted before the
end of D in camp time and not reversed by then. The season is always the
posting's year, never derived from a date, and every as-of figure is POSTED
money (decided money belongs to sub-projects 10 and 11).

Flags. A flag is open unless aid_flag_dispositions holds a disposition for
(transaction, flag); an accepted flag stays visible.
"""

from __future__ import annotations

import asyncio
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final

from api.schemas.financial_aid import (
    AidLikeOutside,
    AidPostingLine,
    AidSourceRow,
    AidSourcesResponse,
    AidSourceTotal,
    DanglingDisposition,
    DataQualityResponse,
    FaRequested,
    HouseholdDetailResponse,
    HouseholdEnrollment,
    LedgerCamper,
    LedgerHouseholdRow,
    LedgerResponse,
    NetAidTotal,
    NetTotalsResponse,
    OrphanReversal,
    SessionMismatch,
    SourceChangeOut,
    StaleStaffLink,
    SummaryCell,
    SummaryResponse,
    UnclassifiedSource,
    WhoPaid,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_repository import FaRequestRow, FinancialAidRepository
from bunking.financial_aid.errors import FinancialAidError

_CENT = Decimal("0.01")
_ZERO = Decimal(0)
_WHITESPACE = re.compile(r"\s+")
_HYPHEN = re.compile(r"\s*-\s*")
_DASHES = str.maketrans({"–": "-", "—": "-", "−": "-"})  # en, em, minus

# The funder types whose aid_postings lines are grants (D55): outside grants and funds, and
# family incentives (JFAM). The camp's own aid is "camp"; an unclassified line is "unknown".
GRANT_FUNDER_TYPES: Final = frozenset({"outside", "incentive"})


def needs_group(source: Any) -> bool:
    """D100: an outside (or still-incentive) source with no reporting group (no implied program family), so the ledger
    has no program to place its household-level lines with. The same rule as Funding sources' needs_group (#2967)."""
    return str(source.funder_type) in GRANT_FUNDER_TYPES and not list(source.implied_program_families or [])


def who_paid(funder_type: str) -> WhoPaid | None:
    """D88's "who paid": the camp's own money, or another funder's; None while the description is unclassified."""
    if funder_type == "camp":
        return "the camp"
    if funder_type in GRANT_FUNDER_TYPES:
        return "another funder"
    return None


class FinancialAidNotFoundError(FinancialAidError, LookupError):
    """The requested ledger row, source, link or disposition does not exist."""


class FinancialAidValidationError(FinancialAidError, ValueError):
    """The request is well-formed but not allowed."""


def aid_dollars(amount: Any) -> Decimal:
    return -Decimal(str(amount or 0))


def money(value: Decimal) -> float:
    return float(value.quantize(_CENT, rounding=ROUND_HALF_UP))


def _net_posted(rows: Iterable[Any]) -> Decimal:
    """The net of raw CampMinder-signed ``amount`` values (no sign flip) —
    used for figures that stay in CampMinder's posted sign, not aid dollars."""
    return sum((Decimal(str(r.amount or 0)) for r in rows), _ZERO)


def program_bucket(posting: Any) -> str:
    family = str(posting.program_family or "")
    if family:
        return family
    return "unattributed" if posting.attribution_level == "none" else "ambiguous"


def normalize_aid_label(s: str) -> str:
    """Python twin of Go's normalizeAidLabel (sync/aid_program_family.go)."""
    s = s.strip().lower().translate(_DASHES)
    s = _WHITESPACE.sub(" ", s)
    return _HYPHEN.sub(" - ", s).strip()


def family_household_set(links: Iterable[Any], household_cm_id: int) -> list[int]:
    """Python twin of Go's aidFamilyIndex.HouseholdSet, which returns nothing
    for household <= 0."""
    household_cm_id = int(household_cm_id)
    if household_cm_id <= 0:
        return []
    keys_by_household: dict[int, set[str]] = defaultdict(set)
    households_by_key: dict[str, set[int]] = defaultdict(set)
    for link in links:
        if link.excluded:
            continue
        h = int(link.household_cm_id)
        keys_by_household[h].add(str(link.family_key))
        households_by_key[str(link.family_key)].add(h)
    seen = {household_cm_id}
    queue = [household_cm_id]
    while queue:
        current = queue.pop()
        for key in keys_by_household[current]:
            for other in households_by_key[key]:
                if other not in seen:
                    seen.add(other)
                    queue.append(other)
    return sorted(seen)


def as_of_cutoff(day: date) -> datetime:
    """The first instant after ``day`` ends in camp time, in UTC."""
    return datetime.combine(day + timedelta(days=1), time.min, tzinfo=CAMP_TZ).astimezone(UTC)


def parse_pb_datetime(value: Any) -> datetime | None:
    """A PocketBase date ("2026-03-02 17:00:00.000Z" or a datetime) as aware UTC; None when blank."""
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    text = str(value or "").strip()
    if not text:
        return None
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def live_at(posting: Any, cutoff: datetime | None) -> bool | None:
    """Whether the posting counts: live now (cutoff None) or live at the cutoff.
    None means it cannot be placed in time (no post date, or reversed with no
    reversal date)."""
    reversed_ = bool(posting.is_reversed)
    if cutoff is None:
        return not reversed_
    posted = parse_pb_datetime(posting.post_date)
    if posted is None:
        return None
    if posted >= cutoff:
        return False
    if not reversed_:
        return True
    reversal = parse_pb_datetime(posting.reversal_date)
    if reversal is None:
        return None
    return reversal >= cutoff


def _accepted_index(dispositions: Iterable[Any]) -> dict[tuple[int, str], str]:
    return {(int(d.transaction_cm_id), str(d.flag)): str(d.disposition) for d in dispositions}


accepted_index = _accepted_index  # public for the household page's posting lines (slice 1)


def _flags_of(posting: Any, accepted: Mapping[tuple[int, str], str]) -> tuple[list[str], dict[str, str]]:
    txn = int(posting.transaction_cm_id)
    flags = [str(f) for f in (posting.flags or [])]
    open_flags = sorted(f for f in flags if (txn, f) not in accepted)
    accepted_flags = {f: accepted[(txn, f)] for f in sorted(flags) if (txn, f) in accepted}
    return open_flags, accepted_flags


def posting_line(posting: Any, accepted: Mapping[tuple[int, str], str]) -> AidPostingLine:
    open_flags, accepted_flags = _flags_of(posting, accepted)
    return AidPostingLine(
        transaction_cm_id=int(posting.transaction_cm_id),
        household_cm_id=int(posting.household_cm_id or 0),
        amount=money(aid_dollars(posting.amount)),
        source_key=str(posting.source_key),
        effective_source_key=str(posting.effective_source_key or posting.source_key),
        source_family=str(posting.source_family or "unclassified"),
        funder_type=str(posting.funder_type or "unknown"),
        counts_toward_budget=bool(posting.counts_toward_budget),
        post_date=str(posting.post_date or ""),
        is_reversed=bool(posting.is_reversed),
        reversal_date=str(posting.reversal_date or ""),
        transaction_note=str(posting.transaction_note or ""),
        attribution_level=str(posting.attribution_level),
        attribution_method=str(posting.attribution_method),
        program_family=str(posting.program_family or ""),
        attributed_person_cm_id=int(posting.attributed_person_cm_id or 0),
        attributed_session_cm_id=int(posting.attributed_session_cm_id or 0),
        candidate_program_families=list(posting.candidate_program_families or []),
        open_flags=open_flags,
        accepted_flags=accepted_flags,
    )


def household_display_name(household: Any | None, cm_id: int) -> str:
    if household is not None:
        for field in ("mailing_title", "greeting"):
            value = str(getattr(household, field, "") or "").strip()
            if value:
                return value
    return f"Household {cm_id}"


def person_display_name(person: Any) -> str:
    first = str(getattr(person, "preferred_name", "") or "").strip() or str(person.first_name or "").strip()
    return f"{first} {str(person.last_name or '').strip()}".strip()


def _requested(rows: Iterable[FaRequestRow], family: Iterable[int]) -> FaRequested:
    members = set(family)
    picked = [r for r in rows if r.household_cm_id in members]
    return FaRequested(
        summer=max((r.summer for r in picked), default=0.0),
        family_camp=max((r.family_camp for r in picked), default=0.0),
        bmitzvah=max((r.bmitzvah for r in picked), default=0.0),
    )


def _total(postings: Iterable[Any]) -> Decimal:
    return sum((aid_dollars(p.amount) for p in postings), _ZERO)


def source_row(s: Any) -> AidSourceRow:
    return AidSourceRow(
        id=str(s.id),
        description_key=str(s.description_key),
        description=str(s.description or ""),
        source_name=str(s.source_name or ""),
        source_family=str(s.source_family),
        funder_type=str(s.funder_type),
        counts_as_aid=bool(s.counts_as_aid),
        counts_toward_budget=bool(s.counts_toward_budget),
        grantor_key=str(getattr(s, "grantor_key", "") or ""),
        implied_program_families=list(s.implied_program_families or []),
        classified_by=str(s.classified_by),
        note=str(s.note or ""),
        needs_group=needs_group(s),
        who_paid=who_paid(str(s.funder_type)),
    )


def source_lines(postings: Iterable[Any]) -> dict[str, tuple[int, Decimal]]:
    """Each description's live lines this season and their net in aid dollars, keyed by the description that
    classifies them now (effective_source_key: after a reclassifying override, the target's; §5.5). Reversed lines
    are out: fetch_postings reads live rows only."""
    counts: Counter[str] = Counter()
    amounts: dict[str, Decimal] = defaultdict(Decimal)
    for p in postings:
        key = str(p.effective_source_key or p.source_key)
        counts[key] += 1
        amounts[key] += aid_dollars(p.amount)
    return {key: (counts[key], amounts[key]) for key in counts}


def _logged_at(row: Any) -> tuple[datetime, str]:
    return (parse_pb_datetime(getattr(row, "created", None)) or datetime.min.replace(tzinfo=UTC), str(row.id))


def last_changes(rows: Iterable[Any]) -> dict[str, SourceChangeOut]:
    """Each aid_sources record's last logged edit (D105: who and why), by record id: the latest log row naming it."""
    out: dict[str, SourceChangeOut] = {}
    for row in sorted(rows, key=_logged_at):
        at = parse_pb_datetime(getattr(row, "created", None))
        if at is not None:
            out[str(row.entity_id)] = SourceChangeOut(by=str(row.actor or ""), at=at, note=str(row.reason or ""))
    return out


def _unclassified(postings: Iterable[Any], sources: Mapping[str, Any]) -> list[UnclassifiedSource]:
    """Live lines whose description aid_sources doesn't know, or knows as unclassified, by description."""
    unclassified: dict[str, list[Any]] = defaultdict(list)
    for p in postings:
        source = sources.get(str(p.source_key))
        if source is None or source.classified_by == "unclassified":
            unclassified[str(p.source_key)].append(p)
    return [
        UnclassifiedSource(
            source_key=key,
            description=str(sources[key].description) if key in sources else "",
            postings=len(items),
            amount=money(_total(items)),
        )
        for key, items in sorted(unclassified.items())
    ]


class FinancialAidLedgerService:
    def __init__(self, repo: FinancialAidRepository) -> None:
        self.repo = repo

    async def _sources_by_key(self) -> dict[str, Any]:
        return {str(s.description_key): s for s in await self.repo.fetch_sources()}

    async def _counted(self, year: int, as_of: date | None) -> tuple[list[Any], int]:
        """The postings that count now (as_of None) or as of the date, and how
        many were left out of an as-of figure for want of a date."""
        cutoff = as_of_cutoff(as_of) if as_of is not None else None
        if cutoff is None:
            postings = await self.repo.fetch_postings(year)
        else:
            postings = await self.repo.fetch_postings(year, include_reversed=True)
        counted: list[Any] = []
        undated = 0
        for p in postings:
            verdict = live_at(p, cutoff)
            if verdict is None:
                undated += 1
            elif verdict:
                counted.append(p)
        return counted, undated

    async def sources(self, year: int | None = None) -> AidSourcesResponse:
        """Money › Sources (§8.1): every description in the registry with its classification, D88's who paid (and
        the mapped grantor's name), D100's needs-a-group check and D105's last logged change; with `year`, also the
        season's live lines each description classifies and their net. Without it no postings are read."""
        sources, grantors, changes = await asyncio.gather(
            self.repo.fetch_sources(), self.repo.fetch_grantors(), self.repo.fetch_source_changes()
        )
        names = {str(g.key): str(g.name) for g in grantors}
        last = last_changes(changes)
        counted = source_lines(await self.repo.fetch_postings(year)) if year is not None else {}
        rows: list[AidSourceRow] = []
        for s in sources:
            row = source_row(s)
            update: dict[str, Any] = {"grantor_name": names.get(row.grantor_key, ""), "last_change": last.get(row.id)}
            if year is not None:
                lines, amount = counted.get(row.description_key, (0, _ZERO))
                update |= {"lines": lines, "amount": money(amount)}
            rows.append(row.model_copy(update=update))
        return AidSourcesResponse(year=year, sources=rows)

    async def ledger(
        self,
        year: int,
        *,
        program_family: str | None = None,
        source_family: str | None = None,
        level: str | None = None,
    ) -> LedgerResponse:
        postings, _ = await self._counted(year, None)
        sources = await self._sources_by_key()
        accepted = _accepted_index(await self.repo.fetch_dispositions(year))
        selected = [
            p
            for p in postings
            if (program_family is None or program_bucket(p) == program_family)
            and (source_family is None or str(p.source_family) == source_family)
            and (level is None or p.attribution_level == level)
        ]
        by_household: dict[int, list[Any]] = defaultdict(list)
        for p in selected:
            by_household[int(p.household_cm_id or 0)].append(p)
        household_ids = sorted(by_household)
        households = {int(h.cm_id): h for h in await self.repo.fetch_households(year, household_ids)}
        person_ids = sorted(
            {
                pid
                for p in selected
                for pid in (int(p.attributed_person_cm_id or 0), int(p.person_cm_id or 0))
                if pid > 0
            }
        )
        persons = {int(x.cm_id): x for x in await self.repo.fetch_persons(year, person_ids)}
        links = await self.repo.fetch_links(year)
        requests = await self.repo.fetch_fa_requests(year)

        rows = [
            self._row(h, by_household[h], households, persons, links, requests, sources, accepted)
            for h in household_ids
        ]
        rows.sort(key=lambda r: (-r.total_aid, r.household_cm_id))
        return LedgerResponse(year=year, total_aid=money(_total(selected)), rows=rows)

    def _row(
        self,
        household: int,
        postings: list[Any],
        households: dict[int, Any],
        persons: dict[int, Any],
        links: list[Any],
        requests: list[FaRequestRow],
        sources: dict[str, Any],
        accepted: Mapping[tuple[int, str], str],
    ) -> LedgerHouseholdRow:
        by_source: dict[str, list[Any]] = defaultdict(list)
        by_program: dict[str, Decimal] = defaultdict(Decimal)
        open_flags: set[str] = set()
        accepted_flags: set[str] = set()
        for p in postings:
            by_source[str(p.effective_source_key or p.source_key)].append(p)
            by_program[program_bucket(p)] += aid_dollars(p.amount)
            opened, closed = _flags_of(p, accepted)
            open_flags.update(opened)
            accepted_flags.update(closed.keys())
        source_totals = []
        for key, items in by_source.items():
            source = sources.get(key)
            source_totals.append(
                AidSourceTotal(
                    source_key=key,
                    source_name=str(source.source_name) if source is not None else key,
                    source_family=str(items[0].source_family or "unclassified"),
                    amount=money(_total(items)),
                    postings=len(items),
                )
            )
        source_totals.sort(key=lambda s: (-s.amount, s.source_key))
        camper_ids = sorted(
            {
                pid
                for p in postings
                for pid in (int(p.attributed_person_cm_id or 0), int(p.person_cm_id or 0))
                if pid in persons
            }
        )
        family = family_household_set(links, household)
        return LedgerHouseholdRow(
            household_cm_id=household,
            display_name=household_display_name(households.get(household), household),
            family_households=family,
            campers=sorted(
                (LedgerCamper(person_cm_id=i, name=person_display_name(persons[i])) for i in camper_ids),
                key=lambda c: (c.name, c.person_cm_id),
            ),
            total_aid=money(_total(postings)),
            by_source=source_totals,
            by_program={k: money(v) for k, v in by_program.items()},
            levels=dict(Counter(str(p.attribution_level) for p in postings)),
            fa_requested=_requested(requests, family),
            open_flags=sorted(open_flags),
            accepted_flags=sorted(accepted_flags),
        )

    async def household(self, year: int, household_cm_id: int) -> HouseholdDetailResponse:
        links = await self.repo.fetch_links(year)
        family = family_household_set(links, household_cm_id)
        postings = await self.repo.fetch_postings(year, family, include_reversed=True)
        if not postings:
            raise FinancialAidNotFoundError(f"household {household_cm_id} has no aid ledger rows in {year}")
        accepted = _accepted_index(await self.repo.fetch_dispositions(year))
        people = await self.repo.fetch_household_persons(year, family)
        names = {int(p.cm_id): person_display_name(p) for p in people}
        enrollments = await self.repo.fetch_enrollments(year, sorted(names))
        households = {int(h.cm_id): h for h in await self.repo.fetch_households(year, family)}
        requests = await self.repo.fetch_fa_requests(year, family)
        history = sorted(postings, key=lambda p: (str(p.post_date or ""), int(p.transaction_cm_id)))
        return HouseholdDetailResponse(
            year=year,
            household_cm_id=household_cm_id,
            display_name=household_display_name(households.get(household_cm_id), household_cm_id),
            family_households=family,
            total_aid=money(_total(p for p in postings if not p.is_reversed)),
            postings=[posting_line(p, accepted) for p in history],
            enrollments=sorted(
                (
                    HouseholdEnrollment(
                        person_cm_id=int(e.person_id),
                        name=names.get(int(e.person_id), ""),
                        session_cm_id=int(e.expand["session"].cm_id),
                        session_name=str(e.expand["session"].name),
                        session_type=str(e.expand["session"].session_type),
                        status=str(e.status or ""),
                    )
                    for e in enrollments
                    if (getattr(e, "expand", None) or {}).get("session") is not None
                ),
                key=lambda e: (e.person_cm_id, e.session_cm_id),
            ),
            fa_requested=_requested(requests, family),
        )

    async def summary(self, year: int, as_of: date | None = None) -> SummaryResponse:
        postings, undated = await self._counted(year, as_of)
        amounts: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
        counts: Counter[tuple[str, str]] = Counter()
        households: dict[tuple[str, str], set[int]] = defaultdict(set)
        by_level: dict[str, Decimal] = defaultdict(Decimal)
        total = budget = _ZERO
        for p in postings:
            dollars = aid_dollars(p.amount)
            key = (program_bucket(p), str(p.source_family or "unclassified"))
            amounts[key] += dollars
            counts[key] += 1
            households[key].add(int(p.household_cm_id or 0))
            by_level[str(p.attribution_level)] += dollars
            total += dollars
            if p.counts_toward_budget:
                budget += dollars
        cells = [
            SummaryCell(
                program=k[0],
                source_family=k[1],
                amount=money(amounts[k]),
                postings=counts[k],
                households=len(households[k]),
            )
            for k in sorted(amounts)
        ]
        return SummaryResponse(
            year=year,
            as_of=as_of.isoformat() if as_of else None,
            total_aid=money(total),
            counts_toward_budget=money(budget),
            by_level={k: money(v) for k, v in by_level.items()},
            cells=cells,
            undated_postings=undated,
        )

    async def net_totals(self, year: int, as_of: date | None = None) -> NetTotalsResponse:
        postings, undated = await self._counted(year, as_of)
        links = await self.repo.fetch_links(year)
        groups: dict[tuple[int, str, str, int, int], list[Any]] = defaultdict(list)
        for p in postings:
            key = (
                int(p.household_cm_id or 0),
                str(p.effective_source_key or p.source_key),
                program_bucket(p),
                int(p.attributed_person_cm_id or 0),
                int(p.attributed_session_cm_id or 0),
            )
            groups[key].append(p)
        rows = []
        for (household, source_key, program, person, session), items in groups.items():
            family = family_household_set(links, household) if household > 0 else []
            first = items[0]
            rows.append(
                NetAidTotal(
                    posting_household_cm_id=household,
                    family_id=min(family) if family else 0,
                    family_households=family,
                    effective_source_key=source_key,
                    source_family=str(first.source_family or "unclassified"),
                    funder_type=str(first.funder_type or "unknown"),
                    counts_toward_budget=bool(first.counts_toward_budget),
                    program=program,
                    attributed_person_cm_id=person,
                    attributed_session_cm_id=session,
                    amount=money(_total(items)),
                    postings=len(items),
                    levels=dict(Counter(str(p.attribution_level) for p in items)),
                    last_post_date=max(str(p.post_date or "") for p in items),
                )
            )
        rows.sort(
            key=lambda r: (
                r.family_id,
                r.posting_household_cm_id,
                r.effective_source_key,
                r.program,
                r.attributed_person_cm_id,
                r.attributed_session_cm_id,
            )
        )
        return NetTotalsResponse(
            year=year,
            as_of=as_of.isoformat() if as_of else None,
            total_aid=money(_total(postings)),
            undated_postings=undated,
            rows=rows,
        )

    async def needs_group_sources(self, year: int) -> list[str]:
        """The descriptions that need a reporting group and classify a live line this season (Today's finance line,
        D100), by key. A line counts under the description that classifies it now (effective_source_key)."""
        postings, sources = await asyncio.gather(self.repo.fetch_postings(year), self._sources_by_key())
        used = {str(p.effective_source_key or p.source_key) for p in postings}
        return sorted(key for key in used if key in sources and needs_group(sources[key]))

    async def unclassified_sources(self, year: int) -> list[UnclassifiedSource]:
        """Data quality's unclassified descriptions alone (slice 1's Today), from two reads."""
        postings, sources = await asyncio.gather(self.repo.fetch_postings(year), self._sources_by_key())
        return _unclassified(postings, sources)

    async def data_quality(self, year: int) -> DataQualityResponse:
        every = await self.repo.fetch_postings(year, include_reversed=True)
        postings = [p for p in every if not p.is_reversed]
        sources = await self._sources_by_key()
        overrides = await self.repo.fetch_overrides(year)
        dispositions = await self.repo.fetch_dispositions(year)
        links = await self.repo.fetch_links(year)
        reversed_rows = await self.repo.fetch_reversed_aid(year)
        accepted = _accepted_index(dispositions)

        legs: dict[int, list[Any]] = defaultdict(list)
        for r in reversed_rows:
            legs[int(r.cm_id)].append(r)
        orphans = []
        for txn, rows in sorted(legs.items()):
            net = _net_posted(rows)
            if net != 0:
                orphans.append(
                    OrphanReversal(
                        transaction_cm_id=txn, household_cm_id=int(rows[0].household_cm_id or 0), net_posted=money(net)
                    )
                )

        open_counts: Counter[str] = Counter()
        accepted_counts: Counter[str] = Counter()
        flagged = []
        for p in sorted(postings, key=lambda p: int(p.transaction_cm_id)):
            opened, closed = _flags_of(p, accepted)
            open_counts.update(opened)
            accepted_counts.update(closed.keys())
            if opened:
                flagged.append(posting_line(p, accepted))

        known = {int(p.transaction_cm_id) for p in every}
        active = [lk for lk in links if not lk.excluded]
        members_by_key: Counter[str] = Counter(str(lk.family_key) for lk in active)
        # An excluded staff row blocks an auto merge into its family_key. If that
        # key no longer exists among the auto links -- a re-keyed family -- the
        # exclusion is a no-op nobody is watching (item 7, final review ruling).
        auto_keys = {str(lk.family_key) for lk in links if lk.source == "auto"}
        cross, unknown = await self._off_season_sessions(year)
        return DataQualityResponse(
            year=year,
            unclassified_sources=_unclassified(postings, sources),
            orphan_reversal_legs=orphans,
            flag_counts=dict(open_counts),
            accepted_flag_counts=dict(accepted_counts),
            flagged_postings=flagged,
            no_enrollment_postings=sum(1 for p in postings if p.attribution_level == "none"),
            dangling_overrides=sorted(
                int(o.transaction_cm_id) for o in overrides if int(o.transaction_cm_id) not in known
            ),
            dangling_dispositions=[
                DanglingDisposition(transaction_cm_id=int(d.transaction_cm_id), flag=str(d.flag))
                for d in sorted(dispositions, key=lambda d: (int(d.transaction_cm_id), str(d.flag)))
                if int(d.transaction_cm_id) not in known
            ],
            stale_staff_links=[
                StaleStaffLink(id=str(lk.id), household_cm_id=int(lk.household_cm_id), family_key=str(lk.family_key))
                for lk in links
                if lk.source == "staff"
                and (
                    (not lk.excluded and members_by_key[str(lk.family_key)] < 2)
                    or (lk.excluded and str(lk.family_key) not in auto_keys)
                )
            ],
            cross_season_sessions=cross,
            unknown_sessions=unknown,
            aid_like_outside_categories=await self._aid_like_outside(year, sources, known),
        )

    async def _off_season_sessions(self, year: int) -> tuple[list[SessionMismatch], list[SessionMismatch]]:
        rows = await self.repo.fetch_off_season_session_rows(year, await self.repo.fetch_session_ids(year))
        by_session: dict[int, list[Any]] = defaultdict(list)
        for r in rows:
            by_session[int(r.session_cm_id)].append(r)
        seasons = await self.repo.fetch_session_seasons(sorted(by_session)) if by_session else {}
        cross: list[SessionMismatch] = []
        unknown: list[SessionMismatch] = []
        for session, items in sorted(by_session.items()):
            others = sorted(seasons.get(session, set()) - {year})
            mismatch = SessionMismatch(
                session_cm_id=session,
                transactions=len(items),
                other_seasons=others,
                net_posted=money(_net_posted(items)),
            )
            (cross if others else unknown).append(mismatch)
        return cross, unknown

    async def _aid_like_outside(self, year: int, sources: dict[str, Any], in_ledger: set[int]) -> list[AidLikeOutside]:
        aid_descriptions = sorted(
            {
                str(s.description)
                for s in sources.values()
                if s.counts_as_aid and s.classified_by != "unclassified" and s.description
            }
        )
        rows = await self.repo.fetch_aid_like_outside(year, aid_descriptions)
        groups: dict[tuple[int, str], list[Any]] = defaultdict(list)
        for r in rows:
            if int(r.cm_id) in in_ledger:
                continue  # a 3839 row classified as aid is already in the ledger
            source = sources.get(normalize_aid_label(str(r.description or "")))
            if source is not None and source.classified_by != "unclassified" and not source.counts_as_aid:
                continue  # staff or the config file already ruled this description is not aid
            groups[(int(r.financial_category_cm_id or 0), str(r.description or ""))].append(r)
        return [
            AidLikeOutside(
                category_cm_id=category,
                description=description,
                transactions=len(items),
                net_posted=money(_net_posted(items)),
            )
            for (category, description), items in sorted(groups.items())
        ]
