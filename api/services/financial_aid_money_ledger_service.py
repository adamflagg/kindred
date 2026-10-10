"""Money > Ledger's family read and the lines behind its totals (campership slice 3, ask 1; clean spec §5.5, §8.1;
D21, D26, D54, D74, D97, D151). Reads only.

Both reads price the season (live, or as of a past day on the axis asked) for its requests, payer shares, sessions,
register and Kindred's placement of every camp-aid line, read every aid_postings line, and hand them to the pure
module (financial_aid_money_ledger). The footer totals are the rows' sums; the lines read lists what makes each up.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Protocol

from api.schemas.financial_aid_decisions import AsOfAxis
from api.schemas.financial_aid_money_ledger import (
    LedgerFamilyOut,
    LedgerLineOut,
    LedgerSessionOut,
    LedgerTotalOut,
    MoneyLedgerLinesOut,
    MoneyLedgerOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import (
    FIRST_TICKED_SEASON,
    FinancialAidDecisionsService,
    as_of_instant,
)
from api.services.financial_aid_intake_types import SessionRow
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_money_ledger import (
    NO_FILTERS,
    LedgerFilters,
    LedgerLine,
    Piece,
    as_recorded_lines,
    family_totals,
    ledger_pieces,
    total_lines,
)
from api.services.financial_aid_program_labels import program_labels
from api.services.financial_aid_reconciliation import SeasonLedger, camp_date
from api.services.financial_aid_to_place import LeftLine, SourceRow
from bunking.financial_aid.money import ZERO

if TYPE_CHECKING:
    from api.services.financial_aid_household_page import HouseholdLabeler


class MoneyLedgerStore(Protocol):
    async def fetch_ledger_lines(self, year: int) -> list[LedgerLine]: ...
    async def fetch_left_lines(self, year: int) -> dict[int, LeftLine]: ...
    async def fetch_source_rows(self) -> dict[str, SourceRow]: ...
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...


@dataclass(frozen=True)
class _Read:
    as_of: date | None  # the past day shown; None: live
    axis: AsOfAxis | None
    pieces: list[Piece]
    families: dict[int, str]
    persons: dict[int, str]
    sources: dict[str, SourceRow]
    program_labels: Mapping[str, str]  # the season's rules label for each program key
    sessions: Mapping[int, SessionRow]  # the season's sessions, for a household request's session


def _name(names: Mapping[int, str], household: int) -> str:
    return names.get(household, f"Household {household}")


def _session(sessions: Mapping[int, SessionRow], cm_id: int) -> LedgerSessionOut | None:
    found = sessions.get(cm_id)
    return LedgerSessionOut(name=found.name, session_type=found.session_type) if found is not None else None


def _household_sessions(sessions: Mapping[int, SessionRow], ids: Collection[int]) -> list[LedgerSessionOut]:
    """Each session once, by start day then id (a session the season doesn't know is left out)."""
    known = sorted((sessions[i] for i in set(ids) if i in sessions), key=lambda s: (s.start_date, s.cm_id))
    return [LedgerSessionOut(name=s.name, session_type=s.session_type) for s in known]


def _people(persons: Mapping[int, str], ids: Collection[int]) -> list[str]:
    return sorted(persons[p] for p in ids if persons.get(p))


class MoneyLedgerService:
    def __init__(
        self,
        decisions: FinancialAidDecisionsService,
        store: MoneyLedgerStore,
        *,
        labels: HouseholdLabeler,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._decisions = decisions
        self._store = store
        self._labels = labels  # names each family row as the household page does (ruling D, owner 10-06)
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    async def _read(self, year: int, as_of: date | None, axis: AsOfAxis, filters: LedgerFilters) -> _Read:
        """The season's pieces that pass the filters, and the names they show. A day today or later is the live read."""
        day = as_of if as_of is not None and as_of < self._today() else None
        season, lines, left, sources = await asyncio.gather(
            self._decisions.season(year) if day is None else self._decisions.past_season(year, day, axis),
            self._store.fetch_ledger_lines(year),
            self._store.fetch_left_lines(year),
            self._store.fetch_source_rows(),
        )
        at = as_of_instant(day) if day is not None else None
        if at is not None and axis == "recorded":
            lines = as_recorded_lines(lines, at)
        placed = season.ledger if at is None else (season.past_ledger or SeasonLedger())
        pieces = [
            piece
            for piece in ledger_pieces(
                lines,
                placed,
                season.requests,
                season.shares,
                season.sessions,
                season.register,
                left=left.keys(),
                at=at,
                levels=year >= FIRST_TICKED_SEASON,  # To place shows nothing before it (Owner question 7)
            )
            if filters.keeps(piece)
        ]
        families, persons = await self._store.fetch_names(
            year, {p.family[0] for p in pieces}, {p.person_cm_id for p in pieces if p.person_cm_id > 0}
        )
        labels = program_labels(season.rules.document if season.rules is not None else None)
        return _Read(
            day, axis if day is not None else None, pieces, families, persons, sources, labels, season.sessions
        )

    async def ledger(
        self,
        year: int,
        *,
        as_of: date | None = None,
        axis: AsOfAxis = "campminder",
        filters: LedgerFilters = NO_FILTERS,
    ) -> MoneyLedgerOut:
        """One row per family (D26), its two columns and its level (D151); the footer is the rows' sums."""
        read = await self._read(year, as_of, axis, filters)
        totals = family_totals(read.pieces)
        labels = await self._labels(year, {t.family[0] for t in totals})  # the rows' households

        def named(household: int) -> tuple[str, str]:
            found = labels.get(household)
            return (found.label, found.tiebreak) if found is not None else ("", "")

        rows = [
            LedgerFamilyOut(
                household_cm_id=t.family[0],
                family_households=list(t.family),
                display_name=_name(read.families, t.family[0]),
                label=named(t.family[0])[0],
                label_tiebreak=named(t.family[0])[1],
                campers=_people(read.persons, t.person_cm_ids),
                in_campminder_net=money(t.in_campminder_net),
                outside_grants=money(t.outside_grants),
                lines=t.lines,
                reversed_lines=t.reversed_lines,
                level=t.level,
                household_sessions=_household_sessions(read.sessions, t.household_session_cm_ids),
            )
            for t in totals
        ]
        rows.sort(key=lambda r: (r.display_name.casefold(), r.household_cm_id))
        return MoneyLedgerOut(
            year=year,
            as_of=read.as_of,
            as_of_axis=read.axis,
            rows=rows,
            in_campminder_net=money(sum((t.in_campminder_net for t in totals), ZERO)),
            outside_grants=money(sum((t.outside_grants for t in totals), ZERO)),
        )

    async def lines(
        self,
        year: int,
        total: LedgerTotalOut,
        *,
        as_of: date | None = None,
        axis: AsOfAxis = "campminder",
        filters: LedgerFilters = NO_FILTERS,
    ) -> MoneyLedgerLinesOut:
        """The lines behind one footer total, with the same filters: reversed lines listed, never summed (D74)."""
        read = await self._read(year, as_of, axis, filters)
        found = total_lines(read.pieces, total)

        def described(key: str) -> str:
            source = read.sources.get(key)
            return source.description if source is not None else key

        out = [
            LedgerLineOut(
                transaction_cm_id=lt.first.transaction_cm_id,
                household_cm_id=lt.first.household_cm_id,
                family_household_cm_id=lt.first.family[0],
                family_name=_name(read.families, lt.first.family[0]),
                camper=", ".join(_people(read.persons, lt.person_cm_ids)),
                description=described(lt.first.source_key),
                source_family=lt.first.source_family,
                program=lt.first.program,
                program_label=read.program_labels.get(lt.first.program, ""),
                amount=money(lt.amount),
                posted_on=camp_date(lt.first.post_date) if lt.first.post_date is not None else None,
                is_reversed=not lt.first.live,
                reversed_on=(
                    camp_date(lt.first.reversal_date)
                    if not lt.first.live and lt.first.reversal_date is not None
                    else None
                ),
                level=lt.display_level,
                household_session=_session(read.sessions, lt.household_session_cm_id),
            )
            for lt in found
        ]
        out.sort(key=lambda ln: (ln.family_name.casefold(), ln.posted_on or date.min, ln.transaction_cm_id))
        return MoneyLedgerLinesOut(
            year=year,
            as_of=read.as_of,
            as_of_axis=read.axis,
            total=total,
            amount=money(sum((lt.amount for lt in found if lt.first.live), ZERO)),
            lines=out,
        )
