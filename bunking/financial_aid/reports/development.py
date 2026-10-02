"""Reports › Development: development's report for one season (clean spec §5.7, §5.10, §5.11, §9.4; D87–D94, D99,
D101, D103, D142). Pure: no I/O.

ONE basis, all money (D87): the camp's awarded money (D80: Posted, net of clawback, on included requests) and every
live outside grant line (the CampMinder ledger, D55), together. The groups are the season's budget pools (D100's
reporting groups). The service resolves every input to a group first; this module only counts.

  who counts      campers who ATTENDED (CampMinder status 2) a session of the group and got money from any source,
                  once per group (D92); in a group that counts families (Family Camp and adult weekends), the
                  households that attended and got money. Money on a camper or household that didn't attend is
                  not development's (a cancelled camper is not counted).
  awards          (item 32) a distinct attendee/session combo that gets ANY aid, the camp's or an outside funder's:
                  a camper per session, a household per session or program in a families group. The camp's aid plus
                  a grant on one combo is one award; two sessions are two; a cancelled request is none.
  household-level a grant line on a household with no camper (D142: a never-applied household with more than one
                  eligible camper) counts in the money and the families, never in a camper cut; the report says how
                  much and how many (`household_level`).
  need (§5.10)    per request: the highest of (the camp's awards in the rounds before an ask + that ask), over its
                  asked rounds, so every ask is a floor; Total Requests = Σ need over attended requests. % of need
                  met (the summer group only) = Σ per camper min(all money the camper got, the camper's need) ÷ Σ
                  need.
  teens (D103)    the summer group's recipients aged 13–17 on the first day of their first session in the group;
                  youth 0–12; "18 and over"; "age unknown" when no birthdate.
  first-time      (D99, the default definition, stated on the line) summer: no summer-group attendance in any earlier
                  season loaded (2017 on); a family group: the household's first season in that group.
  gender (D94)    CampMinder's gender identity, "self-described" for a write-in, "not given" when blank; for the
                  summer group's recipients and for everyone enrolled in it.
  families (D93)  CampMinder households that got money, counted once; `shared_households` / `shared_campers` say how
                  many households share a camper (the camper's own household plus its linked households).
  not in a group money development counts but no group holds (NOT_REPORTED): a session that isn't a reported
                  program (Family School, "other"), a grant line no group claims (its source "needs a group", or it
                  funds two groups, D100). It is in Total Awards Granted and the families, shown as its own line, and
                  in no camper cut; its people attended anything at all.
  TLI + SCIT      (§5.11, D89: "stays a program line") the summer group's recipients who attended a teen-program
                  session (SCIT, TLI).
  appeals (D101)  requests with an ask in Round 2 or later, for a camper (or household) who attended, once per
                  request; approved = posted Round 2+ money above $0: in full when every appeal round posted at least
                  its own ask, else in part. Every cancel reason (D158, amending D101) counts every cancelled aid request, attended or not; "declined for
                  insufficient aid" is the aid_not_enough one.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import date
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.money import ZERO
from bunking.financial_aid.reports.facts import ReportRequest, average
from bunking.financial_aid.scenarios.committee import pct

GroupKind = Literal["summer", "families", "campers"]
AID_NOT_ENOUGH: Final = "aid_not_enough"  # D141's "declined: aid not enough / financial constraints"
NOT_RECORDED_REASON: Final = "not_recorded"  # a cancellation with no reason given (every one before 2027)
SELF_DESCRIBED: Final = "self-described"
NOT_GIVEN: Final = "not given"
TEEN, YOUTH, ADULT, AGE_UNKNOWN = "13–17", "0–12", "18 and over", "age unknown"
CAMP_SOURCE: Final = ""  # the camp's own awards' source key in `by_source`
NOT_REPORTED: Final = ""  # the group key of money development counts in its totals but in no group


@dataclass(frozen=True)
class DevGroup:
    key: str  # a budget pool of the season's rules
    label: str
    kind: GroupKind  # summer: counts campers and carries the summer-only lines; families: counts households


@dataclass(frozen=True)
class Attendance:
    """One status-2 registration (attended, as of the column's date) in a reported group."""

    person_cm_id: int
    household_cm_id: int
    group: str  # NOT_REPORTED: a session that isn't a reported program (still attended)
    start: date | None  # the session's first day
    teen_program: bool = False  # an SCIT or TLI session (§5.11's TLI + SCIT line)


@dataclass(frozen=True)
class Person:
    person_cm_id: int
    birthdate: date | None
    gender: str  # the label to count under (gender_label)


@dataclass(frozen=True)
class GrantMoney:
    """One live outside-grant line (the ledger, D55): on a camper (person > 0) or the household (person 0)."""

    source_key: str
    household_cm_id: int
    person_cm_id: int
    group: str | None  # None: no reported group (a program development doesn't report)
    amount: Decimal
    session_cm_id: int = 0  # the session the line is placed on; 0 when the ledger names none


@dataclass(frozen=True)
class DevelopmentInputs:
    groups: tuple[DevGroup, ...]
    requests: tuple[ReportRequest, ...]  # Part A's facts: the camp's money, asks, standing, cancel reasons
    grants: tuple[GrantMoney, ...]
    attendance: tuple[Attendance, ...]
    persons: Mapping[int, Person]
    earlier_summer: frozenset[int]  # persons with a summer-group attendance in an earlier season
    earlier_family_households: Mapping[str, frozenset[int]]  # family group key -> households seen in it before
    family_of: Mapping[int, str] = field(default_factory=dict)  # household -> its aid family (aid_household_links)
    incentive_sources: frozenset[str] = frozenset()  # sources flagged incentive (D88): a detail line


@dataclass(frozen=True)
class SourceLine:
    source_key: str  # CAMP_SOURCE for the camp's own awards
    group: str
    amount: Decimal
    awards: int


@dataclass(frozen=True)
class HouseholdLevel:
    lines: int
    households: int
    amount: Decimal


@dataclass(frozen=True)
class Appeals:
    submitted: int
    approved_in_full: int
    approved_in_part: int
    declined_insufficient_aid: int


@dataclass(frozen=True)
class GroupFigures:
    group: str
    total_awards: Decimal  # Total Awards Granted (all money)
    camp_awards: Decimal
    outside_awards: Decimal
    awards: int
    camp_award_count: int
    outside_award_count: int
    average_award: Decimal | None
    total_requests: Decimal  # Σ need (§5.10)
    recipients: int  # campers, or households in a family group
    families: int
    household_level: HouseholdLevel
    appeals: Appeals
    pct_need_met: Decimal | None = None  # the summer group only
    ages: Mapping[str, int] = field(default_factory=dict)  # the summer group only
    first_time: int | None = None
    returning: int | None = None
    gender_recipients: Mapping[str, int] = field(default_factory=dict)  # the summer group only
    gender_enrolled: Mapping[str, int] = field(default_factory=dict)  # the summer group only
    incentive_awards: Decimal = ZERO  # the incentive-flagged sources' money (D88's detail line)
    teen_programs: int | None = None  # the summer group only: recipients at a TLI or SCIT session
    cancelled_by_reason: Mapping[str, int] = field(default_factory=dict)  # D158: every cancelled aid request, by reason
    # Internal, for the ZIP read only: NEVER copied into a response (D66, D90: no family's row, ever).
    money_by_recipient: Mapping[int, Decimal] = field(default_factory=dict)  # camper (or household) -> all money
    household_level_by_household: Mapping[int, Decimal] = field(default_factory=dict)


@dataclass(frozen=True)
class NotInGroup:
    """Money development counts but no group holds (D100's "needs a group", Family School, "other")."""

    camp: Decimal
    outside: Decimal
    awards: int
    households: int
    cancelled_by_reason: Mapping[str, int] = field(default_factory=dict)

    @property
    def total(self) -> Decimal:
        return self.camp + self.outside


@dataclass(frozen=True)
class DevelopmentColumn:
    groups: tuple[GroupFigures, ...]
    total_awards: Decimal
    awards: int
    total_requests: Decimal
    recipients: int  # Σ of the groups' recipients (campers + families), as the sheet adds them
    families: int  # households across every group, once each
    shared_households: int
    shared_campers: int
    by_source: tuple[SourceLine, ...]
    not_in_group: NotInGroup = NotInGroup(ZERO, ZERO, 0, 0)


def gender_label(name: str, write_in: str) -> str:
    """D94: a write-in is "self-described", a blank "not given"; otherwise CampMinder's own label."""
    if write_in.strip():
        return SELF_DESCRIBED
    return name.strip() or NOT_GIVEN


def age_on(birthdate: date | None, day: date | None) -> int | None:
    if birthdate is None or day is None:
        return None
    return day.year - birthdate.year - ((day.month, day.day) < (birthdate.month, birthdate.day))


def age_band(age: int | None) -> str:
    if age is None:
        return AGE_UNKNOWN
    return YOUTH if age <= 12 else TEEN if age <= 17 else ADULT


def rebuilt_ages(
    stays: Iterable[tuple[int, int, date | None]],
    persons: Mapping[int, Person],
    money_people: Collection[int],
    money_households: Collection[int],
) -> dict[str, int]:
    """D158: a season with no P column counts its summer recipients by age all the same. `stays` are the season's
    attended summer-type registrations (person, household, session start). A recipient is a camper a live aid line
    names (`money_people`: the camp's or an outside funder's), or any summer camper of a household that a
    household-level line of the camp's own summer, Quest or teen aid names (`money_households`). Age is on the first day of the camper's
    first summer session (D103), as in a P column."""
    first: dict[int, date | None] = {}
    homes: dict[int, set[int]] = defaultdict(set)
    for person, household, start in stays:
        homes[person].add(household)
        known = first.get(person)
        first[person] = start if known is None else (min(known, start) if start is not None else known)
    named = set(money_people)
    households = set(money_households)
    ages: dict[str, int] = defaultdict(int)
    for person, homes_of in homes.items():
        # RULED (owner 2026-10-02), item 50: a household-level camp-aid line counts every attended summer camper of that
        # household (the alternative, only a sole summer camper, undercounts siblings who each had aid).
        if person in named or homes_of & households:
            who = persons.get(person)
            ages[age_band(age_on(who.birthdate if who is not None else None, first.get(person)))] += 1
    return dict(ages)


def need(request: ReportRequest) -> Decimal:
    """§5.10: the camp's awards in the rounds before an ask + that ask, at its highest over the asked rounds."""
    best = ZERO
    awarded_before = ZERO
    for n in (1, 2, 3):
        facts = request.round(n)
        if facts is None:
            continue
        if facts.ask is not None:
            best = max(best, awarded_before + facts.ask)
        awarded_before += facts.posted or ZERO
    return best


@dataclass
class _Awards:
    """Item 32 (owner rule 2026-10-02): an award is a distinct attendee/session combo that gets ANY aid, the camp's or
    an outside funder's. The attendee is the camper (a household in a families group; a household-level line in a
    camper group is its own household's). A line with no session joins the attendee's session combo when they have
    one and stands as the attendee's one award otherwise (most ledger lines name no session)."""

    placed: set[tuple[int, int]] = field(default_factory=set)
    unplaced: set[int] = field(default_factory=set)

    def add(self, group: DevGroup | None, person: int, household: int, session: int) -> None:
        who = person if person > 0 and (group is None or group.kind != "families") else -household
        if session > 0:
            self.placed.add((who, session))
        else:
            self.unplaced.add(who)

    def count(self) -> int:
        return len(self.placed) + len(self.unplaced - {who for who, _ in self.placed})


@dataclass
class _Tally:
    awards: _Awards = field(default_factory=_Awards)
    camp: Decimal = ZERO
    outside: Decimal = ZERO
    camp_count: int = 0
    outside_count: int = 0
    requests: Decimal = ZERO
    recipients: set[int] = field(default_factory=set)
    households: set[int] = field(default_factory=set)
    household_lines: int = 0
    household_level_households: set[int] = field(default_factory=set)
    household_amount: Decimal = ZERO
    household_money: dict[int, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    camper_money: dict[int, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    camper_need: dict[int, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    submitted: int = 0
    in_full: int = 0
    in_part: int = 0
    declined: int = 0
    incentive: Decimal = ZERO
    cancelled: dict[str, int] = field(default_factory=lambda: defaultdict(int))


def development_column(inputs: DevelopmentInputs) -> DevelopmentColumn:
    # Money is RULED as built (R2b): one basis, all money (the camp's awards plus every live outside grant line).
    # RULED (owner 2026-10-02), item 29b: Total Requests counts attended requests only.
    groups = {g.key: g for g in inputs.groups}
    attended_people: dict[str, set[int]] = defaultdict(set)
    attended_households: dict[str, set[int]] = defaultdict(set)
    first_start: dict[tuple[str, int], date] = {}
    camper_home: dict[tuple[str, int], int] = {}
    anyone: set[int] = set()  # everyone who attended anything: the not-in-a-group money's population
    any_household: set[int] = set()
    teen_program: dict[str, set[int]] = defaultdict(set)
    for a in inputs.attendance:
        anyone.add(a.person_cm_id)
        any_household.add(a.household_cm_id)
        if a.teen_program:
            teen_program[a.group].add(a.person_cm_id)
        camper_home.setdefault((a.group, a.person_cm_id), a.household_cm_id)
        attended_people[a.group].add(a.person_cm_id)
        attended_households[a.group].add(a.household_cm_id)
        if a.start is not None:
            key = (a.group, a.person_cm_id)
            first_start[key] = min(first_start.get(key, a.start), a.start)
    tallies: dict[str, _Tally] = {key: _Tally() for key in groups}
    # RULED: group by funder, done in Part C (C7); until then money by source is one line per source description.
    by_source: dict[tuple[str, str], tuple[Decimal, int]] = defaultdict(lambda: (ZERO, 0))
    outside_groups = _Tally()  # NOT_REPORTED's money

    def attended_anything(person: int, household: int) -> bool:
        return person in anyone if person > 0 else household in any_household

    def source(key: str, group: str, money: Decimal) -> None:
        amount, count = by_source[(key, group)]
        by_source[(key, group)] = (amount + money, count + 1)

    def attended(group: DevGroup, person: int, household: int) -> bool:
        if group.kind == "families" or person <= 0:
            return household in attended_households[group.key]
        return person in attended_people[group.key]

    for request in inputs.requests:
        group = groups.get(request.pool or NOT_REPORTED)
        if group is None:
            money = request.awarded()
            if money > 0 and attended_anything(request.person_cm_id, request.household_cm_id):
                outside_groups.camp += money
                outside_groups.camp_count += 1
                outside_groups.awards.add(None, request.person_cm_id, request.household_cm_id, request.session_cm_id)
                outside_groups.households.add(request.household_cm_id)
                source(CAMP_SOURCE, NOT_REPORTED, money)
            if request.standing == "cancelled":
                outside_groups.cancelled[request.cancel_reason or NOT_RECORDED_REASON] += 1
            continue
        tally = tallies[group.key]
        if request.standing == "cancelled":  # D158 (amends D101): every reason, attended or not, awarded or not
            tally.cancelled[request.cancel_reason or NOT_RECORDED_REASON] += 1
            if request.cancel_reason == AID_NOT_ENOUGH:
                tally.declined += 1
        if not attended(group, request.person_cm_id, request.household_cm_id):
            continue
        whom = request.household_cm_id if group.kind == "families" else request.person_cm_id
        money = request.awarded()
        tally.requests += need(request)
        tally.camper_need[whom] += need(request)
        if money > 0:
            tally.camp += money
            tally.camp_count += 1
            tally.awards.add(group, request.person_cm_id, request.household_cm_id, request.session_cm_id)
            tally.recipients.add(whom)
            tally.households.add(request.household_cm_id)
            tally.camper_money[whom] += money
            source(CAMP_SOURCE, group.key, money)
        asked = [f for n in (2, 3) if (f := request.round(n)) is not None and f.ask is not None]
        if asked:
            tally.submitted += 1
            if request.awarded((2, 3)) > 0:
                if all((f.posted or ZERO) >= (f.ask or ZERO) for f in asked):
                    tally.in_full += 1
                else:
                    tally.in_part += 1
    for line in inputs.grants:
        group = groups.get(line.group or NOT_REPORTED)
        if group is None:
            if attended_anything(line.person_cm_id, line.household_cm_id):
                outside_groups.outside += line.amount
                outside_groups.outside_count += 1
                outside_groups.awards.add(None, line.person_cm_id, line.household_cm_id, line.session_cm_id)
                outside_groups.households.add(line.household_cm_id)
                source(line.source_key, NOT_REPORTED, line.amount)
            continue
        if not attended(group, line.person_cm_id, line.household_cm_id):
            continue
        tally = tallies[group.key]
        tally.outside += line.amount
        tally.outside_count += 1
        tally.awards.add(group, line.person_cm_id, line.household_cm_id, line.session_cm_id)
        tally.households.add(line.household_cm_id)
        if line.source_key in inputs.incentive_sources:
            tally.incentive += line.amount
        source(line.source_key, group.key, line.amount)
        if group.kind == "families":
            tally.recipients.add(line.household_cm_id)
        elif line.person_cm_id > 0:
            tally.recipients.add(line.person_cm_id)
            tally.camper_money[line.person_cm_id] += line.amount
        else:
            tally.household_lines += 1
            tally.household_level_households.add(line.household_cm_id)
            tally.household_amount += line.amount
            tally.household_money[line.household_cm_id] += line.amount

    figures = tuple(_figures(groups[key], tallies[key], inputs, first_start, teen_program[key]) for key in groups)
    families = set().union(outside_groups.households, *(t.households for t in tallies.values()))
    recipient_campers = {
        camper: household
        for (group_key, camper), household in camper_home.items()
        if group_key in groups and groups[group_key].kind != "families" and camper in tallies[group_key].recipients
    }
    shared_households, shared_campers = _shared(inputs, families, recipient_campers)
    not_in_group = NotInGroup(
        camp=outside_groups.camp,
        outside=outside_groups.outside,
        awards=outside_groups.awards.count(),
        households=len(outside_groups.households),
        cancelled_by_reason=dict(outside_groups.cancelled),
    )
    return DevelopmentColumn(
        groups=figures,
        total_awards=sum((f.total_awards for f in figures), not_in_group.total),
        awards=sum(f.awards for f in figures) + not_in_group.awards,
        total_requests=sum((f.total_requests for f in figures), ZERO),
        recipients=sum(f.recipients for f in figures),
        families=len(families),
        shared_households=shared_households,
        shared_campers=shared_campers,
        by_source=tuple(
            SourceLine(source_key, group, amount, count)
            for (source_key, group), (amount, count) in sorted(by_source.items(), key=lambda kv: (kv[0][1], kv[0][0]))
        ),
        not_in_group=not_in_group,
    )


def _figures(
    group: DevGroup,
    tally: _Tally,
    inputs: DevelopmentInputs,
    first_start: Mapping[tuple[str, int], date],
    teen_program: Collection[int] = frozenset(),
) -> GroupFigures:
    total = tally.camp + tally.outside
    awards = tally.awards.count()
    out = GroupFigures(
        group=group.key,
        total_awards=total,
        camp_awards=tally.camp,
        outside_awards=tally.outside,
        awards=awards,
        camp_award_count=tally.camp_count,
        outside_award_count=tally.outside_count,
        average_award=average(total, awards),
        total_requests=tally.requests,
        recipients=len(tally.recipients),
        families=len(tally.households),
        household_level=HouseholdLevel(
            tally.household_lines, len(tally.household_level_households), tally.household_amount
        ),
        appeals=Appeals(tally.submitted, tally.in_full, tally.in_part, tally.declined),
        incentive_awards=tally.incentive,
        cancelled_by_reason=dict(tally.cancelled),
        money_by_recipient={k: v for k, v in tally.camper_money.items() if v > 0},
        household_level_by_household=dict(tally.household_money),
    )
    if group.kind == "families":
        earlier = inputs.earlier_family_households.get(group.key, frozenset())
        first = sum(1 for h in tally.recipients if h not in earlier)
        return replace(out, first_time=first, returning=len(tally.recipients) - first)
    if group.kind != "summer":
        return out
    met = sum(
        (min(tally.camper_money.get(c, ZERO), n) for c, n in tally.camper_need.items() if n > 0),
        ZERO,
    )
    needed = sum((n for n in tally.camper_need.values() if n > 0), ZERO)
    ages: dict[str, int] = defaultdict(int)
    genders: dict[str, int] = defaultdict(int)
    for camper in tally.recipients:
        person = inputs.persons.get(camper)
        ages[age_band(age_on(person.birthdate if person else None, first_start.get((group.key, camper))))] += 1
        genders[person.gender if person is not None else NOT_GIVEN] += 1
    enrolled: dict[str, int] = defaultdict(int)
    for camper in {a.person_cm_id for a in inputs.attendance if a.group == group.key}:
        person = inputs.persons.get(camper)
        enrolled[person.gender if person is not None else NOT_GIVEN] += 1
    first = sum(1 for c in tally.recipients if c not in inputs.earlier_summer)
    return replace(
        out,
        pct_need_met=pct(met, needed),
        ages=dict(ages),
        first_time=first,
        returning=len(tally.recipients) - first,
        teen_programs=sum(1 for camper in tally.recipients if camper in teen_program),
        gender_recipients=dict(genders),
        gender_enrolled=dict(enrolled),
    )


def _shared(inputs: DevelopmentInputs, families: Iterable[int], campers: Mapping[int, int]) -> tuple[int, int]:
    """D93's caption: the households among `families` that share an aid family (aid_household_links) with another of
    them, and the recipient campers (`campers`: camper -> their household) who live in one of those households."""
    groups: dict[str, set[int]] = defaultdict(set)
    for household in families:
        key = inputs.family_of.get(household)
        if key:
            groups[key].add(household)
    shared: set[int] = set()
    for members in groups.values():
        if len(members) > 1:
            shared |= members
    return len(shared), sum(1 for household in campers.values() if household in shared)
