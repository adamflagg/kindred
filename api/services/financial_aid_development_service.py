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

from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Final, Literal, Protocol

from api.schemas.financial_aid_reports import (
    DevelopmentColumnOut,
    DevelopmentGroupOut,
    DevelopmentResponse,
    DevelopmentRowOut,
    DevelopmentSourceOut,
    NotBuiltOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_cancellations import CANCEL_REASON_LABELS, CANCEL_REASONS
from api.services.financial_aid_decisions_service import (
    FIRST_TICKED_SEASON,
    DecisionsStore,
    FinancialAidDecisionsService,
    PricingRules,
    RegisterSource,
    Season,
)
from api.services.financial_aid_development_repository import AttendanceRecord, PersonRecord, SourceRecord
from api.services.financial_aid_grants_register import PROGRAM_FAMILY_BY_SESSION_TYPE, RegisterRow
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_reports_facts import report_requests
from api.services.financial_aid_reports_service import ReportsStore
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
)
from bunking.financial_aid.reports.facts import ReportRequest
from bunking.financial_aid.reports.history import ReportedFigure
from bunking.financial_aid.rules import AidRules, resolve_program

FIRST_DEVELOPMENT_SEASON: Final = 2022  # §9.4: columns are seasons from 2022
FIRST_REQUEST_SEASON: Final = 2026
LAST_UNCONFIRMED_SEASON: Final = 2025  # O-930-1: D96's premise (2022–2025's basis) is contested
SUMMER_TYPES: Final = frozenset({"main", "embedded", "ag", "quest", "scit", "tli", "teen"})
TEEN_PROGRAM_TYPES: Final = frozenset({"scit", "tli"})  # §5.11: "TLI + SCIT stays a program line"
# Not camper programs development reports (queue "Known limits": B*Mitzvah is; Family School and "other" aren't).
NOT_REPORTED_FAMILIES: Final = frozenset({"family_school", "other"})
FAMILY_TYPES: Final = frozenset({"family", "adult"})
FIRST_TIME_SUMMER: Final = "No Summer Camp or Quest session at camp in any earlier season from 2017 (the default; D99)"
FIRST_TIME_FAMILY: Final = "The household's first season in this group's programs since 2017 (the default; D99)"
AVERAGE_AWARD_DEFINITION: Final = "Total Awards Granted (the camp's aid plus outside grants) ÷ Number of awards (D158)"
# D158: development sees every cancel reason. "aid not enough" keeps its own line (declined_insufficient).
_CANCEL_ROWS: Final[tuple[tuple[str, str], ...]] = (
    *((f"cancelled_{r}", f"Cancelled: {CANCEL_REASON_LABELS[r]}") for r in CANCEL_REASONS if r != AID_NOT_ENOUGH),
    (f"cancelled_{NOT_RECORDED_REASON}", "Cancelled: reason not recorded"),
)
NOT_BUILT: Final[Mapping[str, str]] = {
    "rebuild": (
        "Kindred's approximate rebuild of 2022–2025 (≈) waits on the 2017–2024 ledger backfill; those seasons show "
        "as reported"
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
    async def family_keys(self, year: int) -> dict[int, str]: ...
    async def sources(self) -> list[SourceRecord]: ...


@dataclass(frozen=True)
class Grouping:
    """How a season's money and registrations find their development group (D100's reporting groups)."""

    groups: tuple[DevGroup, ...]
    by_session: Mapping[int, str]  # session -> pool, for every session a rules program claims
    by_family: Mapping[str, str]  # program family -> pool (the first program claiming that family's sessions)


def grouping(document: AidRules | None, session_types: Mapping[int, str]) -> Grouping:
    if document is None:
        return Grouping((), {}, {})
    by_session: dict[int, str] = {}
    types_by_pool: dict[str, set[str]] = defaultdict(set)
    by_family: dict[str, str] = {}
    for cm_id, session_type in session_types.items():
        family = PROGRAM_FAMILY_BY_SESSION_TYPE.get(session_type, "other")
        if family in NOT_REPORTED_FAMILIES:
            by_session[cm_id] = NOT_REPORTED  # attended, counted in no group (queue "Known limits", D107)
            continue
        program = resolve_program(document, cm_id, session_type)
        pool = document.programs[program].budget_pool if program is not None else None
        if pool is None:
            continue
        by_session[cm_id] = pool
        types_by_pool[pool].add(session_type)
        by_family.setdefault(family, pool)
    # A session no rules program claims (one not open to aid) still has campers development reports, so it joins the
    # pool its program family's claimed sessions use; a family no claimed session uses joins nothing.
    for cm_id, session_type in session_types.items():
        family = PROGRAM_FAMILY_BY_SESSION_TYPE.get(session_type, "other")
        if cm_id not in by_session and family in by_family:
            by_session[cm_id] = by_family[family]
    groups: list[DevGroup] = []
    for key, budget_pool in document.budget.pools.items():
        types = types_by_pool.get(key, set())
        kind: GroupKind = (
            "families" if types and types <= FAMILY_TYPES else "summer" if types & SUMMER_TYPES else "campers"
        )
        groups.append(DevGroup(key, budget_pool.label, kind))
    return Grouping(tuple(groups), by_session, by_family)


def grant_money(rows: Iterable[RegisterRow], grouping_: Grouping) -> tuple[GrantMoney, ...]:
    """Every live outside or incentive ledger line (D87: every outside grant is an award), placed or not: a
    commitment not yet posted is not money given out, and a reversed line isn't either."""
    out: list[GrantMoney] = []
    for row in rows:
        if row.kind != "ledger" or row.is_reversed:
            continue
        if row.session_cm_id > 0 and row.session_cm_id in grouping_.by_session:
            group: str | None = grouping_.by_session[row.session_cm_id]
        else:
            group = grouping_.by_family.get(row.program_family)  # None: no group (D100's "needs a group")
        out.append(GrantMoney(row.source_key, row.household_cm_id, row.person_cm_id, group, row.amount))
    return tuple(out)


def attendance(records: Iterable[AttendanceRecord], grouping_: Grouping) -> tuple[Attendance, ...]:
    """The season's status-2 registrations of every grouped session (NOT_REPORTED ones included: they attended)."""
    return tuple(
        Attendance(
            r.person_cm_id,
            r.household_cm_id,
            grouping_.by_session[r.session_cm_id],
            r.start,
            teen_program=r.session_type in TEEN_PROGRAM_TYPES,
        )
        for r in records
        if r.status_id == 2 and r.session_cm_id in grouping_.by_session
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
    _RowSpec("awards", "money", "Number of awards", "count", True, None, "awards"),
    _RowSpec("average_award", "money", "Average award", "dollars", True, None, None, AVERAGE_AWARD_DEFINITION),
    _RowSpec("total_requests", "money", "Total Requests (demand)", "dollars", True, None, "total_requests"),
    _RowSpec("need_met", "money", "% of need met", "percent", True, frozenset({"summer"}), "need_met"),
    _RowSpec("recipients", "counts", "Applications (got money)", "count", True, None, "recipients"),
    _RowSpec("families", "counts", "Families receiving", "count", True, None, "families"),
    _RowSpec("shared_households", "counts", "of which households that share a camper", "count", False, None, None),
    _RowSpec("shared_campers", "counts", "campers those households share", "count", False, None, None),
    _RowSpec("teens", "counts", "Teens (13–17)", "count", True, frozenset({"summer"}), "teens"),
    _RowSpec("youth", "counts", "Youth (0–12)", "count", True, frozenset({"summer"}), "youth"),
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
        return (column.total_awards / column.awards).quantize(Decimal("0.01")) if column.awards else None
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


def _number(value: Decimal | int | None, unit: Unit) -> float | None:
    if value is None:
        return None
    if unit == "dollars":
        return money(Decimal(value))
    return float(value)


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
        self._development = development
        self._history = history
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))
        self._decisions = FinancialAidDecisionsService(store, rules, register, clock=self._clock)

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    async def _native(self, season: Season, sources: Sequence[SourceRecord]) -> tuple[DevelopmentColumn, Grouping]:
        # OWNER ITEM D29 NOT RULED: Development's money is all money (the camp's awards plus every live outside grant
        # line) on campers who attended, as the plan builds it.
        document = season.rules.document if season.rules is not None else None
        records = await self._development.attendances(season.year)
        grouping_ = grouping(document, {cm_id: s.session_type for cm_id, s in season.sessions.items()})
        attended = attendance(records, grouping_)
        kinds = {g.key: g.kind for g in grouping_.groups}
        summer_people = {a.person_cm_id for a in attended if kinds.get(a.group) == "summer"}
        family_households = {a.household_cm_id for a in attended if kinds.get(a.group) == "families"}
        earlier = await self._development.earlier_attendance(season.year, summer_people, family_households)
        people = await self._development.persons(season.year, summer_people)
        corrections = await self._store.fetch_corrections(season.year, None)
        inputs = DevelopmentInputs(
            groups=grouping_.groups,
            requests=reported_requests(report_requests(season, received={}, corrections=corrections), grouping_),
            grants=grant_money(season.register, grouping_),
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
        return development_column(inputs), grouping_

    async def development(self, year: int) -> DevelopmentResponse:
        today = self._today()
        sources = await self._development.sources()
        natives: dict[int, DevelopmentColumn] = {}
        latest: Grouping | None = None
        for season_year in range(FIRST_REQUEST_SEASON, year + 1):
            season = await self._decisions.season(season_year)
            if season_year < FIRST_TICKED_SEASON and not any(
                view.status == "posted" for priced in season.priced.values() for view in priced.rounds
            ):
                continue  # 2026 before its decisions load (D67): as reported only
            natives[season_year], latest = await self._native(season, sources)
        typed = [
            s.figure
            for s in await self._history.reported()
            if s.figure.view == "development" and FIRST_DEVELOPMENT_SEASON <= s.figure.year <= year
        ]
        if latest is None:
            season = await self._decisions.season(year)
            document = season.rules.document if season.rules is not None else None
            latest = grouping(document, {cm_id: s.session_type for cm_id, s in season.sessions.items()})
        columns = _columns(typed, natives, today)
        return DevelopmentResponse(
            year=year,
            figures_on=today,
            groups=[DevelopmentGroupOut(key=g.key, label=g.label, kind=g.kind) for g in latest.groups],
            columns=[c for c, _ in columns],
            rows=_rows(latest.groups, columns),
            sources=_sources(natives.get(year), latest, sources),
            not_built=[NotBuiltOut(figure=k, reason=v) for k, v in NOT_BUILT.items()],
        )


ColumnData = DevelopmentColumn | list[ReportedFigure]


def _columns(
    typed: Sequence[ReportedFigure], natives: Mapping[int, DevelopmentColumn], today: date
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
                        season=season, basis="P", as_of=today, basis_unconfirmed=False, label=str(season)
                    ),
                    natives[season],
                )
            )
    return out


def _typed_value(figures: Sequence[ReportedFigure], metric: str | None, pool: str) -> Decimal | None:
    if metric is None:
        return None
    found = [f for f in figures if f.metric == metric and f.pool == pool and f.tier == 0 and f.phase == 0]
    return found[0].value if found else None


def _rows(
    groups: Sequence[DevGroup], columns: Sequence[tuple[DevelopmentColumnOut, ColumnData]]
) -> list[DevelopmentRowOut]:
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
                if isinstance(data, DevelopmentColumn):
                    if scope is None:
                        value = _total_value(spec.key, data)
                    else:
                        figures = next((g for g in data.groups if g.group == scope.key), None)
                        value = _group_value(spec.key, figures) if figures is not None else None
                else:
                    pool = scope.key if scope is not None else ""
                    if spec.key == "average_award":
                        total = _typed_value(data, "total_awards", pool)
                        count = _typed_value(data, "awards", pool)
                        value = (total / count).quantize(Decimal("0.01")) if total is not None and count else None
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


def _sources(
    column: DevelopmentColumn | None, grouping_: Grouping, sources: Sequence[SourceRecord]
) -> list[DevelopmentSourceOut]:
    if column is None:
        return []
    # OWNER ITEM 52 NOT RULED: one line per source description, not grouped by funder; grouping them as the Funding
    # sources list does is a later change.
    labels = {g.key: g.label for g in grouping_.groups}
    by_key = {s.description_key: s for s in sources}
    out: list[DevelopmentSourceOut] = []
    for line in column.by_source:
        source = by_key.get(line.source_key)
        camp = line.source_key == CAMP_SOURCE
        out.append(
            DevelopmentSourceOut(
                source_key=line.source_key,
                name="The camp's awards" if camp else (source.source_name if source is not None else line.source_key),
                who_paid="the camp" if camp else "another funder",
                incentive=bool(source is not None and source.incentive),
                group=line.group,
                group_label=labels.get(line.group, line.group),
                amount=money(line.amount),
                awards=line.awards,
            )
        )
    return out
