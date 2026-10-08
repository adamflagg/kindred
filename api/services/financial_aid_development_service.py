"""Reports › Development (Reports back end, Part B; clean spec §5.7, §5.10, §5.11, §9.4; D65, D66, D87–D94, D96,
D99–D103, D142): development's report, one aggregate read (D21), `financial_aid.view` or `financial_aid.summary`.

Rows are development's lines grouped Money · Counts · Appeals and cancellations; columns are seasons from 2022:
  r   what development reported (typed once into aid_reported_history, view "development"); a 2022–2025 column
      carries `basis_unconfirmed` while D96's premise is contested (O-930-1);
  P   Kindred's figures for a season it priced (from 2027; 2026 once its decisions load, D67): all money, the
      camp's awarded (D80) plus every live outside grant line (D87), on campers who attended (D92).
Kindred's approximate rebuild of 2022–2025 (≈) waits on the 2017–2024 backfill and is named in `not_built`.

Groups are the season's budget pools (D100). Each money line finds its group: the camp's awards by their request's
home pool; an outside line by its session's program, else by its program family's pool. A household-level line of a
never-applied household (D142) counts here even though the register doesn't count it for pricing ("Known limits":
development sums those itself); it is shown as household-level in every camper cut.

Nothing here is a family's row (D66, D90): the response carries aggregates only.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final, Literal, Protocol

from api.constants.collections import AID_REPORT_DEFINITIONS, AID_SOURCES
from api.schemas.financial_aid import SourceChangeOut
from api.schemas.financial_aid_reports import (
    GROUP_CHANGE_WARNING,
    DatedColumn,
    DevelopmentColumnOut,
    DevelopmentGroupOut,
    DevelopmentResponse,
    DevelopmentRowOut,
    DevelopmentSourceOut,
    FundingSourceIn,
    FundingSourceOut,
    FundingSourceRowOut,
    FundingSourcesResponse,
    NotBuiltOut,
    ReportColumnsResponse,
    ZipGroupOut,
    ZipResponse,
    ZipRowOut,
    ZipTableOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_calc_inputs import ag_parent_of
from api.services.financial_aid_cancellations import CANCEL_REASON_LABELS, CANCEL_REASONS
from api.services.financial_aid_decisions_service import (
    FIRST_TICKED_SEASON,
    DecisionsStore,
    FinancialAidDecisionsService,
    PricingRules,
    RegisterSource,
    Season,
)
from api.services.financial_aid_development_repository import (
    AttendanceRecord,
    GrantorRecord,
    PersonRecord,
    SourceRecord,
    StoredColumns,
)
from api.services.financial_aid_grants_register import PROGRAM_FAMILY_BY_SESSION_TYPE, RegisterRow
from api.services.financial_aid_intake_types import SessionRow
from api.services.financial_aid_ledger_service import (
    GRANT_FUNDER_TYPES,
    as_of_cutoff,
    money,
    needs_group,
    parse_pb_datetime,
)
from api.services.financial_aid_reports_facts import report_requests
from api.services.financial_aid_reports_service import ReportsRefusedError, ReportsStore
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.development import (
    ADULT,
    AGE_UNKNOWN,
    AID_NOT_ENOUGH,
    CAMP_SOURCE,
    NOT_RECORDED_REASON,
    NOT_REPORTED,
    TEEN,
    YOUTH,
    Attendance,
    DevelopmentColumn,
    DevelopmentInputs,
    DevGroup,
    GrantMoney,
    GroupFigures,
    GroupKind,
    Person,
    development_column,
    gender_label,
    rebuilt_ages,
)
from bunking.financial_aid.reports.facts import ReportRequest, average
from bunking.financial_aid.reports.history import ReportedFigure
from bunking.financial_aid.reports.zips import HouseholdAddress, ZipRow, ZipTable, every_camper, with_aid
from bunking.financial_aid.rules import AidRules, resolve_program

FIRST_DEVELOPMENT_SEASON: Final = 2022  # §9.4: columns are seasons from 2022
FIRST_REQUEST_SEASON: Final = 2026
LAST_UNCONFIRMED_SEASON: Final = 2025  # O-930-1: D96's premise (2022–2025's basis) is contested
SUMMER_TYPES: Final = frozenset({"main", "embedded", "ag", "quest", "scit", "tli", "teen"})
# The aid families whose camp aid a rebuilt age line counts (item 1): a source implying one of these is summer,
# Quest or teen aid; Family Camp, adult-weekend and other families (or none) are not.
SUMMER_AID_FAMILIES: Final = frozenset({"summer", "quest", "teen"})
TEEN_PROGRAM_TYPES: Final = frozenset({"scit", "tli"})  # §5.11: "TLI + SCIT stays a program line"
# Not camper programs development reports (queue "Known limits": B*Mitzvah is; Family School and "other" aren't).
NOT_REPORTED_FAMILIES: Final = frozenset({"family_school", "other"})
FAMILY_TYPES: Final = frozenset({"family", "adult"})
FIRST_TIME_SUMMER: Final = "No Summer Camp or Quest session at camp in any earlier season from 2017 (the default; D99)"
FIRST_TIME_FAMILY: Final = "The household's first weekend program: no earlier Family or Adult weekend session at camp since 2017 (the default; D99)"
AWARDS_DEFINITION: Final = (
    "An award is a distinct attendee and session combination that gets any aid, the camp's or an outside funder's "
    "(a household per session or program in a families group). The camp's aid plus a grant on the same session is "
    "one award; two sessions are two; a cancelled registration is none"
)
AVERAGE_AWARD_DEFINITION: Final = (
    "Total Awards Granted (the camp's aid plus outside grants) ÷ Number of awards, each a distinct attendee and "
    "session with any aid (D158, item 32)"
)
# D158: development sees every cancel reason. "aid not enough" keeps its own line (declined_insufficient).
_CANCEL_ROWS: Final[tuple[tuple[str, str], ...]] = (
    *((f"cancelled_{r}", f"Cancelled: {CANCEL_REASON_LABELS[r]}") for r in CANCEL_REASONS if r != AID_NOT_ENOUGH),
    (f"cancelled_{NOT_RECORDED_REASON}", "Cancelled: reason not recorded"),
)
# A past read carries no CampMinder cancellations (3c-1), so a dated column can't count who declined or cancelled, for
# any reason: those lines are null there and named, never a false zero.
DATED_NOT_REBUILT: Final = ("declined_insufficient", *(key for key, _ in _CANCEL_ROWS))
REPORT: Final = "development"  # aid_report_definitions' key for development's saved columns
NOT_BUILT: Final[Mapping[str, str]] = {
    "rebuild": (
        "The dashboard's approximate rebuild of 2022–2025 (≈) waits on the 2017–2024 ledger backfill; those seasons "
        "show as reported, except their age lines, which are the dashboard's by age (D158)"
    ),
    "need_met_history": "% of need met before 2026 is as reported only: no per-round asks exist to rebuild it",
}
Unit = Literal["dollars", "count", "percent"]
Section = Literal["money", "counts", "appeals"]


class DevelopmentStore(Protocol):
    """What development reads (DevelopmentRepository has it; tests use a fake)."""

    async def attendances(self, year: int) -> list[AttendanceRecord]: ...
    async def earlier_attendance(
        self, year: int, person_cm_ids: Collection[int], household_cm_ids: Collection[int]
    ) -> list[AttendanceRecord]: ...
    async def persons(self, year: int, person_cm_ids: Collection[int]) -> list[PersonRecord]: ...
    async def households(self, year: int, household_cm_ids: Collection[int]) -> dict[int, HouseholdAddress]: ...
    async def family_keys(self, year: int) -> dict[int, str]: ...
    async def sources(self) -> list[SourceRecord]: ...
    async def grantors(self) -> list[GrantorRecord]: ...
    async def source_lines(self, year: int) -> dict[str, tuple[int, Decimal]]: ...
    async def source_changes(self) -> dict[str, SourceChangeOut]: ...
    async def source(self, source_id: str) -> SourceRecord | None: ...
    async def report_columns(self, report: str) -> StoredColumns: ...
    async def commit(
        self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None
    ) -> AidOperationResult: ...


class FundingSourceNotFoundError(FinancialAidError, LookupError):
    """No aid_sources record with that id (404)."""


class FunderNotFoundError(FinancialAidError, LookupError):
    """No grantor with that key has an outside source description (404)."""


@dataclass(frozen=True)
class Grouping:
    """How a season's money and registrations find their development group (D100's reporting groups)."""

    groups: tuple[DevGroup, ...]
    by_session: Mapping[int, str]  # session -> pool, for every session a rules program claims
    by_family: Mapping[str, str]  # program family -> pool (the first program claiming that family's sessions)


def grouping(document: AidRules | None, sessions: Iterable[SessionRow]) -> Grouping:
    """Owner rule (2026-10-02, item 28): development counts only attendees of AID-ELIGIBLE sessions, those a program
    open to aid claims in the season's rules. A session no program claims, or one a program closed to aid claims, is
    in no group (and so in `by_session` not at all); an attendee of only those sessions counts nowhere."""
    if document is None:
        return Grouping((), {}, {})
    by_session: dict[int, str] = {}
    types_by_pool: dict[str, set[str]] = defaultdict(set)
    by_family: dict[str, str] = {}
    by_id = {session.cm_id: session for session in sessions}
    for cm_id, session in by_id.items():
        session_type = session.session_type
        family = PROGRAM_FAMILY_BY_SESSION_TYPE.get(session_type, "other")
        key = resolve_program(document, cm_id, session_type, ag_parent=ag_parent_of(session, by_id))
        program = document.programs[key] if key is not None else None
        if program is None or not program.open_to_aid:
            continue
        if family in NOT_REPORTED_FAMILIES:
            by_session[cm_id] = NOT_REPORTED  # an aid-eligible session of a program not reported (queue "Known limits")
            continue
        pool = program.budget_pool
        if pool is None:
            continue
        by_session[cm_id] = pool
        types_by_pool[pool].add(session_type)
        by_family.setdefault(family, pool)
    groups: list[DevGroup] = []
    for key, budget_pool in document.budget.pools.items():
        types = types_by_pool.get(key, set())
        kind: GroupKind = (
            "families" if types and types <= FAMILY_TYPES else "summer" if types & SUMMER_TYPES else "campers"
        )
        groups.append(DevGroup(key, budget_pool.label, kind))
    return Grouping(tuple(groups), by_session, by_family)


def _iso_day(text: str) -> date | None:
    try:
        return date.fromisoformat(text[:10]) if text else None
    except ValueError:
        return None


def _live_on(row: RegisterRow, as_of: date | None) -> bool:
    """A ledger line live now, or (a dated column) posted by `as_of` and not reversed by then."""
    if as_of is None:
        return not row.is_reversed
    posted = _iso_day(row.recorded_on)
    reversed_on = _iso_day(row.reversal_date)
    if posted is None or posted > as_of:
        return False
    return not row.is_reversed or (reversed_on is not None and reversed_on > as_of)


def grant_money(
    rows: Iterable[RegisterRow], grouping_: Grouping, *, as_of: date | None = None
) -> tuple[GrantMoney, ...]:
    """Every live outside or incentive ledger line (D87: every outside grant is money given; it counts as an award by item 32's distinct combos), placed or not: a
    commitment not yet posted is not money given out, and a reversed line isn't either. A dated column reads the
    lines as they stood at the end of `as_of`; which camper a line sits on is today's placement."""
    out: list[GrantMoney] = []
    for row in rows:
        if row.kind != "ledger" or not _live_on(row, as_of):
            continue
        if row.session_cm_id > 0 and row.session_cm_id in grouping_.by_session:
            group: str | None = grouping_.by_session[row.session_cm_id]
        else:
            group = grouping_.by_family.get(row.program_family)  # None: no group (D100's "needs a group")
        out.append(
            GrantMoney(row.source_key, row.household_cm_id, row.person_cm_id, group, row.amount, row.session_cm_id)
        )
    return tuple(out)


def attended_on(record: AttendanceRecord, as_of: date | None) -> bool:
    """Enrolled now (status 2); for a dated column, registered by `as_of` and enrolled then: still enrolled, or
    cancelled only after it (a cancelled row's day is CampMinder's PostDate)."""
    if as_of is None:
        return record.status_id == 2
    if record.registered_on is not None and record.registered_on > as_of:
        return False
    if record.status_id == 2:
        return True
    return record.changed_on is not None and record.changed_on > as_of


def attendance(
    records: Iterable[AttendanceRecord], grouping_: Grouping, *, as_of: date | None = None
) -> tuple[Attendance, ...]:
    """The season's registrations of every grouped (aid-eligible) session (NOT_REPORTED ones included: they
    attended) that count as attended, now or as of a dated column."""
    return tuple(
        Attendance(
            r.person_cm_id,
            r.household_cm_id,
            grouping_.by_session[r.session_cm_id],
            r.start,
            teen_program=r.session_type in TEEN_PROGRAM_TYPES,
        )
        for r in records
        if r.session_cm_id in grouping_.by_session and attended_on(r, as_of)
    )


def reported_requests(requests: Iterable[ReportRequest], grouping_: Grouping) -> tuple[ReportRequest, ...]:
    """A request on a session that isn't a reported program (Family School, "other"), or in no pool, is development's
    money in no group."""
    groups = {g.key for g in grouping_.groups}
    return tuple(
        r
        if r.pool in groups and grouping_.by_session.get(r.session_cm_id) != NOT_REPORTED
        else replace(r, pool=NOT_REPORTED)
        for r in requests
    )


@dataclass(frozen=True)
class _RowSpec:
    key: str
    section: Section
    label: str
    unit: Unit
    per_group: bool
    kinds: frozenset[GroupKind] | None  # the group kinds the line exists for; None: every kind
    typed: str | None  # the development metric typed history holds for it
    definition: str = ""


_ROWS: Final[tuple[_RowSpec, ...]] = (
    _RowSpec("total_awards", "money", "Total Awards Granted", "dollars", True, None, "total_awards"),
    _RowSpec("camp_awards", "money", "The camp's own awards", "dollars", True, None, None),
    _RowSpec("outside_awards", "money", "Grants from other funders", "dollars", True, None, None),
    _RowSpec("incentive_awards", "money", "of which incentive grants", "dollars", True, None, None),
    _RowSpec("awards", "money", "Number of awards", "count", True, None, "awards", AWARDS_DEFINITION),
    _RowSpec("average_award", "money", "Average award", "dollars", True, None, None, AVERAGE_AWARD_DEFINITION),
    _RowSpec("total_requests", "money", "Total Requests (demand)", "dollars", True, None, "total_requests"),
    _RowSpec("need_met", "money", "% of need met", "percent", True, frozenset({"summer"}), "need_met"),
    _RowSpec("recipients", "counts", "Applications (got money)", "count", True, None, "recipients"),
    _RowSpec("families", "counts", "Families receiving", "count", True, None, "families"),
    _RowSpec("shared_households", "counts", "of which households that share a camper", "count", False, None, None),
    _RowSpec("shared_campers", "counts", "campers those households share", "count", False, None, None),
    _RowSpec("teens", "counts", "Teens (13–17)", "count", True, frozenset({"summer"}), None),
    _RowSpec("youth", "counts", "Youth (0–12)", "count", True, frozenset({"summer"}), None),
    _RowSpec("adults", "counts", "18 and over", "count", True, frozenset({"summer"}), None),
    _RowSpec("age_unknown", "counts", "Age unknown", "count", True, frozenset({"summer"}), None),
    _RowSpec(
        "teen_programs", "counts", "TLI + SCIT (program line)", "count", True, frozenset({"summer"}), "teen_programs"
    ),
    _RowSpec("first_time", "counts", "First-time", "count", True, frozenset({"summer", "families"}), "first_time"),
    _RowSpec("returning", "counts", "Returning", "count", True, frozenset({"summer", "families"}), "returning"),
    _RowSpec("household_level_lines", "counts", "Household-level grants (no camper)", "count", True, None, None),
    _RowSpec("household_level_amount", "money", "Household-level grant dollars", "dollars", True, None, None),
    # Money no group holds (D100's "needs a group"; Family School and "other"): in the totals, its own line.
    _RowSpec("not_in_group_amount", "money", "Money in no group", "dollars", False, None, None),
    _RowSpec("not_in_group_awards", "money", "Awards in no group", "count", False, None, None),
    _RowSpec("appeals_submitted", "appeals", "Appeals submitted", "count", True, None, "appeals_submitted"),
    _RowSpec("appeals_in_full", "appeals", "Approved in full", "count", True, None, None),
    _RowSpec("appeals_in_part", "appeals", "Approved in part", "count", True, None, None),
    _RowSpec("appeals_approved", "appeals", "Approved", "count", True, None, "appeals_approved"),
    _RowSpec(
        "declined_insufficient",
        "appeals",
        "Declined enrollment for insufficient aid",
        "count",
        True,
        None,
        "declined_insufficient",
    ),
    *(_RowSpec(key, "appeals", label, "count", True, None, None) for key, label in _CANCEL_ROWS),
)


def _group_value(key: str, figures: GroupFigures) -> Decimal | int | None:
    if key.startswith("cancelled_"):
        return figures.cancelled_by_reason.get(key.removeprefix("cancelled_"), 0)
    simple: dict[str, Decimal | int | None] = {
        "total_awards": figures.total_awards,
        "camp_awards": figures.camp_awards,
        "outside_awards": figures.outside_awards,
        "incentive_awards": figures.incentive_awards,
        "awards": figures.awards,
        "average_award": figures.average_award,
        "total_requests": figures.total_requests,
        "need_met": figures.pct_need_met,
        "recipients": figures.recipients,
        "families": figures.families,
        "teens": figures.ages.get(TEEN, 0),
        "youth": figures.ages.get(YOUTH, 0),
        "adults": figures.ages.get(ADULT, 0),
        "age_unknown": figures.ages.get(AGE_UNKNOWN, 0),
        "first_time": figures.first_time,
        "returning": figures.returning,
        "teen_programs": figures.teen_programs,
        "household_level_lines": figures.household_level.lines,
        "household_level_amount": figures.household_level.amount,
        "appeals_submitted": figures.appeals.submitted,
        "appeals_in_full": figures.appeals.approved_in_full,
        "appeals_in_part": figures.appeals.approved_in_part,
        "appeals_approved": figures.appeals.approved_in_full + figures.appeals.approved_in_part,
        "declined_insufficient": figures.appeals.declined_insufficient_aid,
    }
    return simple.get(key)


def _total_value(key: str, column: DevelopmentColumn) -> Decimal | int | None:
    if key == "families":
        return column.families
    if key == "shared_households":
        return column.shared_households
    if key == "shared_campers":
        return column.shared_campers
    if key == "average_award":
        return average(column.total_awards, column.awards)
    if key in {"need_met", "teens", "youth", "adults", "age_unknown", "teen_programs"}:
        return None  # a summer-group line: its group row is the figure
    outside_groups: dict[str, Decimal | int] = {
        "total_awards": column.not_in_group.total,
        "camp_awards": column.not_in_group.camp,
        "outside_awards": column.not_in_group.outside,
        "awards": column.not_in_group.awards,
        "declined_insufficient": column.not_in_group.cancelled_by_reason.get(AID_NOT_ENOUGH, 0),
        **{f"cancelled_{r}": n for r, n in column.not_in_group.cancelled_by_reason.items()},
        "not_in_group_amount": column.not_in_group.total,
        "not_in_group_awards": column.not_in_group.awards,
    }
    if key.startswith("not_in_group"):
        return outside_groups[key]
    values = [_group_value(key, g) for g in column.groups]
    known = [v for v in values if v is not None]
    total = sum(known, Decimal(0)) if known else None
    extra = outside_groups.get(key)  # the totals hold the money no group holds (all money, D87)
    return total + extra if total is not None and extra is not None else total


_AGE_LINES: Final[Mapping[str, str]] = {"teens": TEEN, "youth": YOUTH, "adults": ADULT, "age_unknown": AGE_UNKNOWN}


def _rebuilt_age(
    ages: Mapping[str, int] | None, key: str, scope: DevGroup | None, groups: Sequence[DevGroup]
) -> int | None:
    """D158: an r column's age line is Kindred's rebuild by age, on the one summer group's row; None before the
    backfill (no ledger lines) or when there isn't exactly one summer group to put it on."""
    summer = [g for g in groups if g.kind == "summer"]
    if ages is None or scope is None or len(summer) != 1 or scope.key != summer[0].key:
        return None
    return ages.get(_AGE_LINES[key], 0)


def _number(value: Decimal | int | None, unit: Unit) -> float | None:
    if value is None:
        return None
    if unit == "dollars":
        return money(Decimal(value))
    return float(value)


def _keeps_group(body: FundingSourceIn, shown: str | None) -> bool:
    """The families stay as they are when the body leaves the group out (absent), or sends it as shown. An explicit
    null is a clear: it is told apart from absent by `model_fields_set`."""
    return "group" not in body.model_fields_set or body.group == shown


class FinancialAidDevelopmentService:
    def __init__(
        self,
        store: DecisionsStore,
        rules: PricingRules,
        register: RegisterSource,
        development: DevelopmentStore,
        history: ReportsStore,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._rules = rules
        self._development = development
        self._register = register
        self._history = history
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))
        self._decisions = FinancialAidDecisionsService(store, rules, register, clock=self._clock)

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    async def _season_grouping(self, year: int) -> Grouping:
        """The season's groups without pricing it: the newest approved programs and budget, and its sessions."""
        approved = await self._rules.latest_approved(year, ["programs", "budget"])
        sessions = await self._store.fetch_sessions(year)
        return grouping(approved.document if approved is not None else None, sessions)

    # --- dated columns (§9.4's "+ Add a dated column"; Part C) -----------------------------------------------

    async def report_columns(self) -> ReportColumnsResponse:
        stored = await self._development.report_columns(REPORT)
        return ReportColumnsResponse(
            report=REPORT, columns=[DatedColumn(season=season, as_of=day) for season, day in stored.columns]
        )

    async def save_report_columns(self, columns: Sequence[DatedColumn], *, actor: str) -> ReportColumnsResponse:
        """Replace development's dated columns, with its aid_change_log row; nothing changed, nothing written. A
        dated column needs dated decisions, so 2026 (reproduced, undated, D67) and earlier are refused."""
        today = self._today()
        wanted = sorted({(c.season, c.as_of) for c in columns})
        for season, day in wanted:
            if season < FIRST_TICKED_SEASON:
                raise ReportsRefusedError(
                    f"A dated column needs dated decisions: {season} has none (only {FIRST_TICKED_SEASON} on, D67)"
                )
            # Today is not past: development shows a column only once its day is.
            if not season - 1 <= day.year <= season or day >= today:
                raise ReportsRefusedError(f"{day} is not a past day of the {season} season")
        stored = await self._development.report_columns(REPORT)
        if tuple(wanted) == stored.columns:
            return await self.report_columns()
        data = {"report": REPORT, "columns": [{"season": season, "as_of": day.isoformat()} for season, day in wanted]}
        before = {"columns": [{"season": season, "as_of": day.isoformat()} for season, day in stored.columns]}
        write = (
            AidWrite(collection=AID_REPORT_DEFINITIONS, action="create", year=today.year, data=data, entity_id=REPORT)
            if not stored.id
            else AidWrite(
                collection=AID_REPORT_DEFINITIONS,
                action="update",
                year=today.year,
                record_id=stored.id,
                before=before,
                data={"columns": data["columns"]},
                entity_id=REPORT,
            )
        )
        await self._development.commit([write], actor=actor)
        return ReportColumnsResponse(report=REPORT, columns=[DatedColumn(season=s, as_of=d) for s, d in wanted])

    # --- ZIP codes (§9.4's second screen, D90; Part C) ---------------------------------------------------------

    async def zip_codes(self, year: int, group: str | None = None) -> ZipResponse:
        """Every enrolled camper of `group` (the summer group when omitted; `all` counts each person and household
        once) by ZIP, and (once the season's decisions exist) development's recipients there with all their money. Small groups as they are; never a family's row (D90). Both tables
        are built on `grouping`, so only attendees of aid-eligible sessions are counted (owner rule, item 28)."""
        today = self._today()
        season = await self._decisions.season(year)
        priced = year >= FIRST_TICKED_SEASON or any(
            view.status == "posted" for p in season.priced.values() for view in p.rounds
        )
        if priced:
            native = await self._native(season, await self._development.sources())
            found, attended, column = native.grouping, native.attended, native.column
        else:
            document = season.rules.document if season.rules is not None else None
            found = grouping(document, season.sessions.values())
            attended = attendance(await self._development.attendances(year), found)
            column = None
        chosen, group_key, group_label = _zip_groups(found.groups, group, year)
        wanted = {g.key for g in chosen}
        enrolled = {(a.person_cm_id, a.household_cm_id) for a in attended if a.group in wanted}
        # Camper-keyed money (camper groups) and household money (a household-level line, or a family group's
        # recipients: money there is a household's, so it lands on the household, not on a camper). Across groups
        # each line sits in exactly one, so summing never counts one twice; a person or household is a set member.
        camper_money: dict[int, Decimal] = defaultdict(lambda: ZERO)
        household_money: dict[int, Decimal] = defaultdict(lambda: ZERO)
        kinds = {g.key: g.kind for g in found.groups}
        built = column is not None and bool(chosen)
        for figures in column.groups if column is not None else ():
            if figures.group not in wanted:
                continue
            for recipient, amount in figures.money_by_recipient.items():
                (household_money if kinds[figures.group] == "families" else camper_money)[recipient] += amount
            for household, amount in figures.household_level_by_household.items():
                household_money[household] += amount
        household_of = dict(enrolled)
        homes = await self._development.households(year, {h for _, h in enrolled} | set(household_money))
        aid = with_aid(camper_money, household_of, household_money, homes) if built else None
        return ZipResponse(
            year=year,
            figures_on=today,
            group=group_key,
            group_label=group_label,
            groups=[ZipGroupOut(key=g.key, label=g.label) for g in found.groups]
            + ([ZipGroupOut(key=ALL_GROUPS, label=ALL_GROUPS_LABEL)] if found.groups else []),
            every_camper=_zip_table(every_camper(sorted(enrolled), homes)),
            with_aid=_zip_table(aid) if aid is not None else None,
            not_built=[]
            if aid is not None
            else [
                NotBuiltOut(
                    figure="with_aid",
                    reason=f"Campers who got aid by ZIP need {year}'s decisions (D67); the published page stands in",
                )
            ],
        )

    # --- Funding sources (D88, D100; Part C) -----------------------------------------------------------------

    async def funding_sources(self, year: int) -> FundingSourcesResponse:
        """Every source with its three facts and its reporting group under `year`'s pools: the outside sources (the
        per-description edit list) and the rows by funder (D159). Read-only rows follow: the unclassified (N3: listed,
        so staff can fix the classification) and the camp's own."""
        found = await self._season_grouping(year)
        every, grantor_rows, counted, changed = await asyncio.gather(
            self._development.sources(),
            self._development.grantors(),
            self._development.source_lines(year),
            self._development.source_changes(),
        )
        grantors = {g.key: g for g in grantor_rows}
        outside = [s for s in every if s.funder_type in GRANT_FUNDER_TYPES]
        unclassified = [s for s in every if s.funder_type not in GRANT_FUNDER_TYPES and s.funder_type != "camp"]
        own = [s for s in every if s.funder_type == "camp"]
        return FundingSourcesResponse(
            year=year,
            groups=[DevelopmentGroupOut(key=g.key, label=g.label, kind=g.kind) for g in found.groups],
            sources=[
                _funding_source(s, found, counted=counted.get(s.description_key, (0, ZERO)), last=changed.get(s.id))
                for s in sorted(outside, key=lambda s: (s.source_name.lower(), s.id))
            ],
            rows=[
                *funder_rows(outside, grantors, found, "outside", counted=counted, changed=changed),
                *funder_rows(unclassified, grantors, found, "unclassified", counted=counted, changed=changed),
                *funder_rows(own, grantors, found, "camp", counted=counted, changed=changed),
            ],
            group_change_warning=GROUP_CHANGE_WARNING,
        )

    def _planned(
        self, year: int, source: SourceRecord, body: FundingSourceIn, found: Grouping, *, keep_group: bool
    ) -> tuple[dict[str, Any], dict[str, Any], SourceRecord]:
        """Decision 43 for one description: its before, what changes, and the source after. `keep_group`: the group
        as shown, or a body that does not mention the group, so the families stay exactly (an incentive-only save
        never rewrites them); an explicit null group clears them."""
        families = list(source.implied_program_families)
        if keep_group:
            pass
        elif body.group is None:
            families = []
        else:
            if body.group not in {g.key for g in found.groups}:
                raise ReportsRefusedError(f"{body.group!r} is not one of {year}'s budget pools")
            families = sorted(f for f, pool in found.by_family.items() if pool == body.group)
            if not families:
                raise ReportsRefusedError(f"No program of {year} funds {body.group!r}: nothing to point the source at")
        before = {"implied_program_families": list(source.implied_program_families), "incentive": source.incentive}
        incentive = source.incentive if body.incentive is None else body.incentive  # None: this description's own
        after: dict[str, Any] = {"implied_program_families": families, "incentive": incentive}
        changed = {key: value for key, value in after.items() if before[key] != value}
        return before, changed, replace(source, implied_program_families=tuple(families), incentive=incentive)

    async def save_funding_source(
        self, year: int, source_id: str, body: FundingSourceIn, *, actor: str
    ) -> FundingSourceOut:
        """Set a source's reporting group (stored as the program families that `year`'s pool funds, D100's
        implied_program_families) and its incentive flag (D88), with its aid_change_log row. Only what changed is
        written: the families are rewritten only when the group itself changes, so finance's narrower program setting
        (D100: "specific programs within them") or a source over several groups survives an incentive-only save.
        Nothing changed: nothing written."""
        source = await self._development.source(source_id)
        if source is None:
            raise FundingSourceNotFoundError(f"No aid source {source_id}")
        if source.funder_type not in GRANT_FUNDER_TYPES:
            if source.funder_type == "camp":
                raise ReportsRefusedError("Only an outside source is a funding source: the camp's own aid has no group")
            raise ReportsRefusedError("Only an outside source has a group here: classify this source first (Sources)")
        found = await self._season_grouping(year)
        before, changed, updated = self._planned(
            year,
            source,
            body,
            found,
            keep_group=_keeps_group(body, _funding_source(source, found).group),
        )
        if changed:
            await self._development.commit(
                [
                    AidWrite(
                        collection=AID_SOURCES,
                        action="update",
                        year=year,
                        record_id=source_id,
                        before=before,
                        data=changed,
                        log_action="funding_source",
                    )
                ],
                actor=actor,
                reason=body.note or None,
            )
        return _funding_source(updated, found, families_changed="implied_program_families" in changed)

    async def save_funder(
        self, year: int, grantor_key: str, body: FundingSourceIn, *, actor: str
    ) -> FundingSourceRowOut:
        """Decision 48 (D159): a funder row's group and incentive flag, written to each of its outside descriptions in
        ONE logged operation, each writing only what changed (Decision 43). "The group as shown" is the row's: a row
        shown as several groups, saved with the group absent (or shown unchanged), keeps every description's families;
        an explicit null group clears them. Unclassified sources are
        never members (N3): they are listed read-only, and classifying them is the Sources route's."""
        grantors = {g.key: g for g in await self._development.grantors()}
        members = [
            s
            for s in await self._development.sources()
            if s.grantor_key == grantor_key and s.funder_type in GRANT_FUNDER_TYPES
        ]
        if grantor_key not in grantors or not members:
            raise FunderNotFoundError(f"No funder {grantor_key} with an outside source")
        found = await self._season_grouping(year)
        keep_group = _keeps_group(body, _row_of(grantors[grantor_key], members, found, "outside").group)
        writes: list[AidWrite] = []
        updated: list[SourceRecord] = []
        families_changed = False
        for source in members:
            before, changed, after = self._planned(year, source, body, found, keep_group=keep_group)
            updated.append(after)
            if changed:
                families_changed = families_changed or "implied_program_families" in changed
                writes.append(
                    AidWrite(
                        collection=AID_SOURCES,
                        action="update",
                        year=year,
                        record_id=source.id,
                        before=before,
                        data=changed,
                        log_action="funding_source",
                    )
                )
        if writes:
            await self._development.commit(writes, actor=actor, reason=body.note or None)
        return _row_of(grantors[grantor_key], updated, found, "outside", families_changed=families_changed)

    async def _native(
        self,
        season: Season,
        sources: Sequence[SourceRecord],
        *,
        as_of: date | None = None,
        register: Sequence[RegisterRow] | None = None,
    ) -> _Native:
        """One P column: `season` priced now, or (a dated column) `season` as of the end of `as_of` (3c-1's past
        read) with the live season's `register` cut to that day."""
        # Development's money is all money (the camp's awards plus every live outside grant line) on campers who
        # attended (D29, ruled as built: R2b).
        document = season.rules.document if season.rules is not None else None
        records = await self._development.attendances(season.year)
        grouping_ = grouping(document, season.sessions.values())
        attended = attendance(records, grouping_, as_of=as_of)
        kinds = {g.key: g.kind for g in grouping_.groups}
        summer_people = {a.person_cm_id for a in attended if kinds.get(a.group) == "summer"}
        family_households = {a.household_cm_id for a in attended if kinds.get(a.group) == "families"}
        earlier = await self._development.earlier_attendance(season.year, summer_people, family_households)
        people = await self._development.persons(season.year, summer_people)
        corrections = await self._store.fetch_corrections(season.year, None)
        if as_of is not None:
            cutoff = as_of_cutoff(as_of)
            corrections = [
                c for c in corrections if (made := parse_pb_datetime(c.created)) is not None and made < cutoff
            ]
        inputs = DevelopmentInputs(
            groups=grouping_.groups,
            requests=reported_requests(report_requests(season, received={}, corrections=corrections), grouping_),
            grants=grant_money(season.register if register is None else register, grouping_, as_of=as_of),
            attendance=attended,
            persons={
                p.person_cm_id: Person(
                    p.person_cm_id, p.birthdate, gender_label(p.gender_identity_name, p.gender_identity_write_in)
                )
                for p in people
            },
            earlier_summer=frozenset(r.person_cm_id for r in earlier if r.session_type in SUMMER_TYPES),
            earlier_family_households={
                g.key: frozenset(r.household_cm_id for r in earlier if r.session_type in FAMILY_TYPES)
                for g in grouping_.groups
                if g.kind == "families"
            },
            family_of=await self._development.family_keys(season.year),
            incentive_sources=frozenset(s.description_key for s in sources if s.incentive),
        )
        return _Native(development_column(inputs), grouping_, attended)

    async def _rebuilt_ages(self, year: int, sources: Sequence[SourceRecord] = ()) -> dict[str, int] | None:
        """D158: the summer recipients of a season with no P column, by age, rebuilt from that season's ledger. None
        when the season has no live aid line at all (2022-2024 until the 2017-2024 backfill)."""
        # RULED (owner 2026-10-02), item 51: a season with no ledger lines yet is blank (named once in not_built), never zero.
        camp = [line for line in await self._store.fetch_camp_lines(year) if line.live() and line.amount > 0]
        outside = [
            row
            for row in await self._register(year)
            if row.kind == "ledger" and not row.is_reversed and row.funder_type in GRANT_FUNDER_TYPES and row.amount > 0
        ]
        if not camp and not outside:
            return None
        # RULED (owner 2026-10-02), item 1: a household-level camp line counts only when its source implies summer aid.
        summer_sources = {s.description_key for s in sources if SUMMER_AID_FAMILIES & set(s.implied_program_families)}
        stays = [
            r for r in await self._development.attendances(year) if r.status_id == 2 and r.session_type in SUMMER_TYPES
        ]
        people = await self._development.persons(year, {r.person_cm_id for r in stays})
        return rebuilt_ages(
            ((r.person_cm_id, r.household_cm_id, r.start) for r in stays),
            {p.person_cm_id: Person(p.person_cm_id, p.birthdate, "") for p in people},
            {line.person_cm_id for line in camp if line.person_cm_id > 0}
            | {row.person_cm_id for row in outside if row.person_cm_id > 0},
            {
                line.household_cm_id
                for line in camp
                if line.person_cm_id <= 0 and line.description_key in summer_sources
            },
        )

    async def development(self, year: int) -> DevelopmentResponse:
        today = self._today()
        sources = await self._development.sources()
        natives: dict[int, DevelopmentColumn] = {}
        dated: dict[tuple[int, date], DevelopmentColumn] = {}
        saved = (await self.report_columns()).columns
        latest: Grouping | None = None
        for season_year in range(FIRST_REQUEST_SEASON, year + 1):
            season = await self._decisions.season(season_year)
            if season_year < FIRST_TICKED_SEASON and not any(
                view.status == "posted" for priced in season.priced.values() for view in priced.rounds
            ):
                continue  # 2026 before its decisions load (D67): as reported only
            native = await self._native(season, sources)
            natives[season_year], latest = native.column, native.grouping
            for wanted in (c for c in saved if c.season == season_year and c.as_of < today):
                past = await self._decisions.past_season(season_year, wanted.as_of, "campminder")
                dated[(season_year, wanted.as_of)] = (
                    await self._native(past, sources, as_of=wanted.as_of, register=season.register)
                ).column
        typed = [
            s.figure
            for s in await self._history.reported()
            if s.figure.view == "development" and FIRST_DEVELOPMENT_SEASON <= s.figure.year <= year
        ]
        if latest is None:
            season = await self._decisions.season(year)
            document = season.rules.document if season.rules is not None else None
            latest = grouping(document, season.sessions.values())
        columns = _columns(typed, natives, today, dated)
        ages = {
            season: await self._rebuilt_ages(season, sources)
            for season in sorted({f.year for f in typed} - set(natives))
        }
        not_built = [NotBuiltOut(figure=k, reason=v) for k, v in NOT_BUILT.items()]
        if waiting := sorted(season for season, found in ages.items() if found is None):
            not_built.append(
                NotBuiltOut(
                    figure="ages_before_backfill",
                    reason=(
                        f"Teens, youth and the other age lines for {', '.join(map(str, waiting))} are blank: "
                        "the dashboard has no classified camp-aid lines for those seasons (the 2017–2024 ledger "
                        "backfill is one cause; postings whose funder isn't classified yet are another)"
                    ),
                )
            )
        return DevelopmentResponse(
            year=year,
            figures_on=today,
            groups=[DevelopmentGroupOut(key=g.key, label=g.label, kind=g.kind) for g in latest.groups],
            columns=[c for c, _ in columns],
            rows=_rows(latest.groups, columns, ages),
            sources=_sources(
                natives.get(year), latest, sources, {g.key: g for g in await self._development.grantors()}
            ),
            not_built=not_built,
        )


ColumnData = DevelopmentColumn | list[ReportedFigure]


@dataclass(frozen=True)
class _Native:
    column: DevelopmentColumn
    grouping: Grouping
    attended: tuple[Attendance, ...]


def _columns(
    typed: Sequence[ReportedFigure],
    natives: Mapping[int, DevelopmentColumn],
    today: date,
    dated: Mapping[tuple[int, date], DevelopmentColumn] | None = None,
) -> list[tuple[DevelopmentColumnOut, ColumnData]]:
    """Every season from 2022 with anything to show: its typed column (one per as-of date), then its P column."""
    out: list[tuple[DevelopmentColumnOut, ColumnData]] = []
    by_season: dict[tuple[int, date], list[ReportedFigure]] = defaultdict(list)
    for figure in typed:
        by_season[(figure.year, figure.as_of)].append(figure)
    seasons = sorted({y for y, _ in by_season} | set(natives))
    for season in seasons:
        for (year, as_of), figures in sorted(by_season.items()):
            if year == season:
                out.append(
                    (
                        DevelopmentColumnOut(
                            season=season,
                            basis="r",
                            as_of=as_of,
                            basis_unconfirmed=season <= LAST_UNCONFIRMED_SEASON,
                            label=f"{season} (as reported)",
                        ),
                        figures,
                    )
                )
        if season in natives:
            out.append(
                (
                    DevelopmentColumnOut(
                        season=season,
                        basis="P",
                        as_of=today,
                        basis_unconfirmed=False,
                        label=str(season),
                        asks_left_out=natives[season].asks_left_out,
                    ),
                    natives[season],
                )
            )
        for (year, as_of), column in sorted((dated or {}).items()):
            if year == season:
                out.append(
                    (
                        DevelopmentColumnOut(
                            season=season,
                            basis="P",
                            as_of=as_of,
                            basis_unconfirmed=False,
                            label=f"{season} as of {as_of:%b} {as_of.day}",
                            not_rebuilt=list(DATED_NOT_REBUILT),
                            asks_left_out=column.asks_left_out,
                        ),
                        column,
                    )
                )
    return out


def _typed_value(figures: Sequence[ReportedFigure], metric: str | None, pool: str) -> Decimal | None:
    if metric is None:
        return None
    found = [f for f in figures if f.metric == metric and f.pool == pool and f.tier == 0 and f.phase == 0]
    return found[0].value if found else None


def _rows(
    groups: Sequence[DevGroup],
    columns: Sequence[tuple[DevelopmentColumnOut, ColumnData]],
    ages: Mapping[int, Mapping[str, int] | None] | None = None,
) -> list[DevelopmentRowOut]:
    by_season = ages or {}
    out: list[DevelopmentRowOut] = []
    for spec in _ROWS:
        scopes: list[DevGroup | None] = [
            g for g in groups if spec.per_group and (spec.kinds is None or g.kind in spec.kinds)
        ]
        if spec.kinds is None:
            scopes.append(None)
        for scope in scopes:
            values: list[float | None] = []
            for column, data in columns:
                if spec.key in column.not_rebuilt:
                    value = None
                elif isinstance(data, DevelopmentColumn):
                    if scope is None:
                        value = _total_value(spec.key, data)
                    else:
                        figures = next((g for g in data.groups if g.group == scope.key), None)
                        value = _group_value(spec.key, figures) if figures is not None else None
                else:
                    pool = scope.key if scope is not None else ""
                    if spec.key in _AGE_LINES:
                        value = _rebuilt_age(by_season.get(column.season), spec.key, scope, groups)
                    elif spec.key == "average_award":
                        total = _typed_value(data, "total_awards", pool)
                        count = _typed_value(data, "awards", pool)
                        # facts.average's rule (ROUND_HALF_UP), kept inline: a typed count is a Decimal.
                        value = (
                            (total / count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                            if total is not None and count
                            else None
                        )
                    else:
                        value = _typed_value(data, spec.typed, pool)
                values.append(_number(value, spec.unit))
            definition = spec.definition
            if spec.key in {"first_time", "returning"} and scope is not None:
                definition = FIRST_TIME_SUMMER if scope.kind == "summer" else FIRST_TIME_FAMILY
            out.append(
                DevelopmentRowOut(
                    key=spec.key,
                    section=spec.section,
                    label=spec.label,
                    group=scope.key if scope is not None else None,
                    unit=spec.unit,
                    definition=definition,
                    values=values,
                )
            )
    return [*out, *_gender_rows(groups, columns)]


def _gender_rows(
    groups: Sequence[DevGroup], columns: Sequence[tuple[DevelopmentColumnOut, ColumnData]]
) -> list[DevelopmentRowOut]:
    """D94: one row per gender identity label, for the summer group's recipients and for everyone enrolled in it.
    Kindred's columns only: development never typed these."""
    out: list[DevelopmentRowOut] = []
    for group in (g for g in groups if g.kind == "summer"):
        for key, label in (
            ("gender_recipients", "Gender, campers who got money"),
            ("gender_enrolled", "Gender, every camper"),
        ):
            found: list[Mapping[str, int]] = []
            for _, data in columns:
                figures = (
                    next((f for f in data.groups if f.group == group.key), None)
                    if isinstance(data, DevelopmentColumn)
                    else None
                )
                found.append(
                    (figures.gender_recipients if key == "gender_recipients" else figures.gender_enrolled)
                    if figures is not None
                    else {}
                )
            out.extend(
                DevelopmentRowOut(
                    key=key,
                    section="counts",
                    label=f"{label}: {name}",
                    group=group.key,
                    unit="count",
                    definition="",
                    values=[
                        float(f.get(name, 0)) if isinstance(data, DevelopmentColumn) else None
                        for f, (_, data) in zip(found, columns, strict=True)
                    ],
                )
                for name in sorted(set().union(*found) if found else set())
            )
    return out


ALL_GROUPS: Final = "all"
ALL_GROUPS_LABEL: Final = "All groups"


def _zip_groups(
    groups: Sequence[DevGroup], asked: str | None, year: int
) -> tuple[tuple[DevGroup, ...], str | None, str]:
    """Which groups the ZIP tables count, as (groups, key, label). Omitted: the summer group (the tables' default).
    A pool key of the season's rules: that group. `all`: every group of the rules, a household once. Else refused."""
    if asked is None:
        summer = next((g for g in groups if g.kind == "summer"), None)
        return ((summer,), summer.key, summer.label) if summer else ((), None, "")
    if asked == ALL_GROUPS and groups:
        return tuple(groups), ALL_GROUPS, ALL_GROUPS_LABEL
    found = next((g for g in groups if g.key == asked), None)
    if found is None:
        raise ReportsRefusedError(f"{asked!r} is not a group of {year}'s rules")
    return (found,), found.key, found.label


def _zip_table(table: ZipTable) -> ZipTableOut:
    def row(r: ZipRow) -> ZipRowOut:
        return ZipRowOut(
            zip=r.zip,
            kind=r.kind,
            campers=r.campers,
            families=r.families,
            dollars=money(r.dollars) if r.dollars is not None else None,
        )

    return ZipTableOut(rows=[row(r) for r in table.rows], total=row(table.total), zips=table.zips)


_FUNDER_TYPES: Final[Mapping[str, Literal["outside", "incentive", "camp", "unknown"]]] = {
    "outside": "outside",
    "incentive": "incentive",
    "camp": "camp",
}


def _funding_source(
    source: SourceRecord,
    found: Grouping,
    *,
    families_changed: bool = False,
    counted: tuple[int, Decimal] | None = None,
    last: SourceChangeOut | None = None,
) -> FundingSourceOut:
    pools = {found.by_family[f] for f in source.implied_program_families if f in found.by_family}
    labels = {g.key: g.label for g in found.groups}
    group = next(iter(pools)) if len(pools) == 1 else None
    return FundingSourceOut(
        source_id=source.id,
        description_key=source.description_key,
        name=source.source_name,
        funder_type=_FUNDER_TYPES.get(source.funder_type, "unknown"),
        editable=source.funder_type in GRANT_FUNDER_TYPES,
        families_changed=families_changed,
        incentive=source.incentive,
        group=group,
        group_label=labels.get(group, group) if group is not None else ("several groups" if pools else ""),
        needs_group=needs_group(source),  # the ledger's rule (D100): outside or incentive with no group, never camp's
        families=list(source.implied_program_families),
        lines=counted[0] if counted is not None else None,
        amount=money(counted[1]) if counted is not None else None,
        last_change=last,
    )


RowSection = Literal["outside", "camp", "unclassified"]


def _row_of(
    grantor: GrantorRecord | None,
    members: Sequence[SourceRecord],
    found: Grouping,
    section: RowSection,
    *,
    families_changed: bool = False,
    counted: Mapping[str, tuple[int, Decimal]] | None = None,
    changed: Mapping[str, SourceChangeOut] | None = None,
) -> FundingSourceRowOut:
    ordered = sorted(members, key=lambda s: (s.source_name.lower(), s.id))
    tallies = None if counted is None else [counted.get(s.description_key, (0, ZERO)) for s in ordered]
    descriptions = [
        _funding_source(
            s,
            found,
            counted=None if tallies is None else tallies[i],
            last=None if changed is None else changed.get(s.id),
        )
        for i, s in enumerate(ordered)
    ]
    latest = max((d.last_change for d in descriptions if d.last_change is not None), key=lambda c: c.at, default=None)
    groups = {d.group for d in descriptions}
    labels = {d.group_label for d in descriptions}
    incentives = {d.incentive for d in descriptions}
    return FundingSourceRowOut(
        kind="funder" if grantor is not None else "description",
        section=section,
        grantor_key=grantor.key if grantor is not None else "",
        name=grantor.name if grantor is not None else descriptions[0].name,
        retired=grantor.retired if grantor is not None else False,
        editable=all(d.editable for d in descriptions),
        incentive=next(iter(incentives)) if len(incentives) == 1 else None,
        group=next(iter(groups)) if len(groups) == 1 else None,
        group_label=next(iter(labels)) if len(labels) == 1 else "several groups",
        needs_group=all(d.needs_group for d in descriptions),
        descriptions=descriptions,
        families_changed=families_changed,
        lines=sum(n for n, _ in tallies) if tallies is not None else None,
        amount=money(sum((a for _, a in tallies), ZERO)) if tallies is not None else None,  # Decimals, rounded once
        last_change=latest,
    )


def funder_rows(
    sources: Sequence[SourceRecord],
    grantors: Mapping[str, GrantorRecord],
    found: Grouping,
    section: RowSection,
    *,
    counted: Mapping[str, tuple[int, Decimal]] | None = None,
    changed: Mapping[str, SourceChangeOut] | None = None,
) -> list[FundingSourceRowOut]:
    """D159: one row per funder where the grantor directory groups descriptions (a retired grantor still names its
    row, for history), else one row per description; by name. Funding sources and Development's money by source both
    group through this one helper."""
    by_funder: dict[str, list[SourceRecord]] = defaultdict(list)
    singles: list[SourceRecord] = []
    for source in sources:
        if source.grantor_key and source.grantor_key in grantors:
            by_funder[source.grantor_key].append(source)
        else:
            singles.append(source)
    rows = [
        _row_of(grantors[key], members, found, section, counted=counted, changed=changed)
        for key, members in by_funder.items()
    ]
    rows += [_row_of(None, [source], found, section, counted=counted, changed=changed) for source in singles]
    return sorted(rows, key=lambda r: (r.name.lower(), r.grantor_key, r.descriptions[0].source_id))


def _sources(
    column: DevelopmentColumn | None,
    grouping_: Grouping,
    sources: Sequence[SourceRecord],
    grantors: Mapping[str, GrantorRecord],
) -> list[DevelopmentSourceOut]:
    """Money by source (D88), one line per funder where the grantor directory groups descriptions, else one per
    description (owner item 52): the same grouping Funding sources shows, through `funder_rows`. A funder's incentive
    and need-based money stay on separate lines (D88's three facts); an unclassified source is its own line (N3)."""
    if column is None:
        return []
    labels = {g.key: g.label for g in grouping_.groups}
    by_key = {s.description_key: s for s in sources}
    funder_of = {
        d.description_key: row
        for row in funder_rows(
            [s for s in sources if s.funder_type in GRANT_FUNDER_TYPES], grantors, grouping_, "outside"
        )
        if row.kind == "funder"
        for d in row.descriptions
    }
    merged: dict[tuple[str, str, bool], DevelopmentSourceOut] = {}
    totals: dict[tuple[str, str, bool], Decimal] = {}
    for line in column.by_source:
        source = by_key.get(line.source_key)
        camp = line.source_key == CAMP_SOURCE
        funder = funder_of.get(line.source_key)
        incentive = bool(source is not None and source.incentive)
        source_key = f"funder:{funder.grantor_key}" if funder is not None else line.source_key
        key = (source_key, line.group, incentive)
        totals[key] = totals.get(key, ZERO) + line.amount  # summed exactly, rounded once
        if key in merged:
            merged[key] = merged[key].model_copy(update={"awards": merged[key].awards + line.awards})
            continue
        if camp:
            name = "The camp's awards"
        elif funder is not None:
            name = funder.name
        else:
            name = source.source_name if source is not None else line.source_key
        merged[key] = DevelopmentSourceOut(
            source_key=source_key,
            name=name,
            who_paid="the camp" if camp else "another funder",
            incentive=incentive,
            group=line.group,
            group_label=labels.get(line.group, line.group),
            amount=money(line.amount),
            awards=line.awards,
        )
    return [out.model_copy(update={"amount": money(totals[key])}) for key, out in merged.items()]
