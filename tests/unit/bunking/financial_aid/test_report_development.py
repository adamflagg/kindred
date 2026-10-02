"""Reports › Development for one season (clean spec §5.7, §5.10, §5.11, §9.4; D87–D94, D99, D101, D103, D142): all
money, campers who attended, need, appeals. Fictional families, sources and figures only."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal

from bunking.financial_aid.reports.development import (
    ADULT,
    AGE_UNKNOWN,
    CAMP_SOURCE,
    NOT_GIVEN,
    NOT_RECORDED_REASON,
    NOT_REPORTED,
    SELF_DESCRIBED,
    TEEN,
    YOUTH,
    Attendance,
    DevelopmentColumn,
    DevelopmentInputs,
    DevGroup,
    GrantMoney,
    GroupFigures,
    Person,
    SourceLine,
    development_column,
    gender_label,
    need,
    rebuilt_ages,
)
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

CAMP = DevGroup("camp_pool", "Camp", "summer")
WEEKEND = DevGroup("weekend_pool", "Weekends", "families")
BMITZVAH = DevGroup("bmitzvah_pool", "B'mitzvah", "campers")
GROUPS = (CAMP, WEEKEND, BMITZVAH)
EMMA, LIAM, SAMUEL, OLIVIA = 1000011, 1000021, 1000031, 1000041
SESSION_START = date(2027, 6, 20)


def _went(person: int, household: int, group: str = "camp_pool", start: date = SESSION_START) -> Attendance:
    return Attendance(person, household, group, start)


def _inputs(**change: object) -> DevelopmentInputs:
    base = DevelopmentInputs(
        groups=GROUPS,
        requests=(),
        grants=(),
        attendance=(_went(EMMA, 1000001), _went(LIAM, 1000002)),
        persons={
            EMMA: Person(EMMA, date(2013, 7, 1), "Girl/woman"),  # 13 on June 20, 2027; 14 on July 1
            LIAM: Person(LIAM, date(2016, 1, 5), "Boy/man"),
        },
        earlier_summer=frozenset({LIAM}),
        earlier_family_households={},
    )
    return replace(base, **change)  # type: ignore[arg-type]


def _camp(column: DevelopmentColumn) -> GroupFigures:
    return next(g for g in column.groups if g.group == "camp_pool")


def test_all_money_counts_the_camps_awards_and_every_outside_grant_together() -> None:
    """D87: one basis; every outside grant is an award; a household-level line counts in money and families only."""
    column = development_column(
        _inputs(
            requests=(req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),),
            grants=(
                GrantMoney("regional grant", 1000001, EMMA, "camp_pool", Decimal(500)),
                GrantMoney("congregation grant", 1000002, 0, "camp_pool", Decimal(300)),
            ),
        )
    )
    camp = _camp(column)
    assert (camp.total_awards, camp.camp_awards, camp.outside_awards) == (Decimal(2300), Decimal(1500), Decimal(800))
    assert (camp.awards, camp.camp_award_count, camp.outside_award_count) == (3, 1, 2)
    assert camp.average_award == Decimal("766.67")
    assert (camp.recipients, camp.families) == (1, 2)
    assert (camp.household_level.lines, camp.household_level.households, camp.household_level.amount) == (
        1,
        1,
        Decimal(300),
    )
    assert column.by_source == (
        SourceLine(CAMP_SOURCE, "camp_pool", Decimal(1500), 1),
        SourceLine("congregation grant", "camp_pool", Decimal(300), 1),
        SourceLine("regional grant", "camp_pool", Decimal(500), 1),
    )


def test_a_camper_who_did_not_attend_is_not_counted_and_neither_is_their_money() -> None:
    """D92: campers who attended (status 2); a cancelled camper is not counted."""
    column = development_column(
        _inputs(
            requests=(req("reqsamuel000001", rnd(1, ask="4000", posted="1500"), person=SAMUEL, household=1000003),),
            grants=(GrantMoney("regional grant", 1000003, SAMUEL, "camp_pool", Decimal(500)),),
        )
    )
    camp = _camp(column)
    assert (camp.total_awards, camp.awards, camp.recipients, camp.total_requests) == (Decimal(0), 0, 0, Decimal(0))


def test_need_takes_the_highest_ask_over_the_rounds_with_the_awards_before_it() -> None:
    """§5.10's worked example: Round 1 ask 5,000 award 3,000; appeal ask 4,000 → need 7,000; Round 2 award 2,000;
    a Round 3 ask of 500 gives 5,500 on its own, so need stays 7,000."""
    request = req(
        "reqemma00000001",
        rnd(1, ask="5000", posted="3000"),
        rnd(2, ask="4000", posted="2000"),
        rnd(3, ask="500"),
        person=EMMA,
    )
    assert need(request) == Decimal(7000)
    assert need(req("reqemma00000002", rnd(1, ask="2000", posted="1450"), person=EMMA)) == Decimal(2000)


def test_percent_of_need_met_caps_each_camper_at_their_need() -> None:
    """D91: Σ min(all money, need) ÷ Σ need. Emma: need 7,000, money 6,000; Liam: need 1,000, money 1,500 → capped."""
    column = development_column(
        _inputs(
            requests=(
                req(
                    "reqemma00000001", rnd(1, ask="5000", posted="3000"), rnd(2, ask="4000", posted="2000"), person=EMMA
                ),
                req("reqliam00000001", rnd(1, ask="1000", posted="1000"), person=LIAM, household=1000002),
            ),
            grants=(
                GrantMoney("regional grant", 1000001, EMMA, "camp_pool", Decimal(1000)),
                GrantMoney("regional grant", 1000002, LIAM, "camp_pool", Decimal(500)),
            ),
        )
    )
    camp = _camp(column)
    assert camp.total_requests == Decimal(8000)
    assert camp.pct_need_met == Decimal("87.5")  # (6,000 + 1,000) ÷ 8,000


def test_a_family_group_counts_households_and_their_first_weekend() -> None:
    """D92: Weekend counts families; D99's default: a family's first weekend program."""
    column = development_column(
        _inputs(
            attendance=(_went(0, 1000005, "weekend_pool"), _went(0, 1000006, "weekend_pool")),
            requests=(
                req(
                    "reqfam000000005",
                    rnd(1, ask="900", posted="600", pool="weekend_pool"),
                    person=0,
                    household=1000005,
                    pool="weekend_pool",
                    table="family",
                ),
            ),
            grants=(GrantMoney("family incentive", 1000006, 0, "weekend_pool", Decimal(250)),),
            earlier_family_households={"weekend_pool": frozenset({1000005})},
        )
    )
    weekend = next(g for g in column.groups if g.group == "weekend_pool")
    assert (weekend.recipients, weekend.families, weekend.total_awards) == (2, 2, Decimal(850))
    assert (weekend.first_time, weekend.returning) == (1, 1)
    assert weekend.household_level.lines == 0  # a family group's grant is its household's, never "unplaced"


def test_ages_are_on_the_first_day_of_the_campers_first_session_in_the_group() -> None:
    """D103 (supersedes one date per season): Emma is 13 on June 20 (14 on July 1), so a teen."""
    column = development_column(
        _inputs(
            attendance=(
                _went(EMMA, 1000001),
                _went(EMMA, 1000001, start=date(2027, 7, 25)),
                _went(LIAM, 1000002),
                _went(OLIVIA, 1000004),
            ),
            persons={
                EMMA: Person(EMMA, date(2013, 7, 1), "Girl/woman"),
                LIAM: Person(LIAM, date(2016, 1, 5), "Boy/man"),
                OLIVIA: Person(OLIVIA, None, "Girl/woman"),
            },
            requests=(
                req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),
                req("reqliam00000001", rnd(1, ask="4000", posted="1500"), person=LIAM, household=1000002),
                req("reqolivia000001", rnd(1, ask="4000", posted="1500"), person=OLIVIA, household=1000004),
            ),
        )
    )
    assert _camp(column).ages == {TEEN: 1, YOUTH: 1, AGE_UNKNOWN: 1}
    assert ADULT not in _camp(column).ages


def test_first_time_and_gender_are_the_summer_groups_lines() -> None:
    column = development_column(
        _inputs(
            requests=(
                req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),
                req("reqliam00000001", rnd(1, ask="4000", posted="1500"), person=LIAM, household=1000002),
            ),
            attendance=(_went(EMMA, 1000001), _went(LIAM, 1000002), _went(SAMUEL, 1000003)),
            persons={
                EMMA: Person(EMMA, None, "Girl/woman"),
                LIAM: Person(LIAM, None, SELF_DESCRIBED),
                SAMUEL: Person(SAMUEL, None, NOT_GIVEN),
            },
        )
    )
    camp = _camp(column)
    assert (camp.first_time, camp.returning) == (1, 1)  # Liam was at camp in an earlier season
    assert camp.gender_recipients == {"Girl/woman": 1, SELF_DESCRIBED: 1}
    assert camp.gender_enrolled == {"Girl/woman": 1, SELF_DESCRIBED: 1, NOT_GIVEN: 1}
    bmitzvah = next(g for g in column.groups if g.group == "bmitzvah_pool")
    assert (bmitzvah.first_time, bmitzvah.gender_recipients, bmitzvah.pct_need_met) == (None, {}, None)


def test_gender_label_reads_the_write_in_first() -> None:
    """D94: a write-in shows as "self-described" and a blank as "not given"; no fallback to the binary field."""
    assert gender_label("", "my own words") == SELF_DESCRIBED
    assert gender_label("", "") == NOT_GIVEN
    assert gender_label("Non-binary", "") == "Non-binary"


def test_appeals_count_once_per_request_in_full_or_in_part_and_declines_include_non_attenders() -> None:
    """D101: approved = posted Round 2+ money above $0; declined for insufficient aid is the one count that includes
    campers who did not attend."""
    column = development_column(
        _inputs(
            requests=(
                req("reqemma00000001", rnd(1, ask="4000", posted="1500"), rnd(2, ask="800", posted="800"), person=EMMA),
                req(
                    "reqliam00000001",
                    rnd(1, ask="4000", posted="1500"),
                    rnd(2, ask="800", posted="300"),
                    rnd(3, ask="200"),
                    person=LIAM,
                    household=1000002,
                ),
                req(
                    "reqsamuel000001",
                    rnd(1, ask="4000", posted="1500"),
                    person=SAMUEL,
                    household=1000003,
                    standing="cancelled",
                    reason="aid_not_enough",
                ),
                req(
                    "reqolivia000001",
                    rnd(1, ask="4000", posted="1500"),
                    rnd(2, ask="500", posted="500"),
                    rnd(3, ask="200"),
                    person=OLIVIA,
                    household=1000004,
                ),
            ),
            attendance=(_went(EMMA, 1000001), _went(LIAM, 1000002), _went(OLIVIA, 1000004)),
        )
    )
    appeals = _camp(column).appeals
    # Olivia's Round 2 was granted in full but her Round 3 ask wasn't: in part, as Liam's.
    assert (appeals.submitted, appeals.approved_in_full, appeals.approved_in_part) == (3, 1, 2)
    assert appeals.declined_insufficient_aid == 1


def test_the_caption_counts_households_that_share_an_aid_family_and_their_campers() -> None:
    """D93: "N households, including H households that share C campers" (aid_household_links)."""
    column = development_column(
        _inputs(
            attendance=(_went(EMMA, 1000001), _went(LIAM, 1000002)),
            requests=(
                req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),
                req("reqliam00000001", rnd(1, ask="4000", posted="1500"), person=LIAM, household=1000002),
            ),
            grants=(GrantMoney("regional grant", 1000009, EMMA, "camp_pool", Decimal(200)),),
            family_of={1000001: "hh-1000001", 1000009: "hh-1000001", 1000002: "hh-1000002"},
        )
    )
    assert (column.families, column.shared_households, column.shared_campers) == (3, 2, 1)


def test_incentive_sources_are_a_detail_line_inside_the_total() -> None:
    """D88: an incentive-flagged source's money is shown as a detail line, never the headline."""
    column = development_column(
        _inputs(
            grants=(GrantMoney("years-at-camp grant", 1000001, EMMA, "camp_pool", Decimal(400)),),
            incentive_sources=frozenset({"years-at-camp grant"}),
        )
    )
    camp = _camp(column)
    assert (camp.total_awards, camp.incentive_awards) == (Decimal(400), Decimal(400))


def test_the_column_totals_add_the_groups() -> None:
    column = development_column(
        _inputs(
            attendance=(_went(EMMA, 1000001), _went(0, 1000005, "weekend_pool")),
            requests=(req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),),
            grants=(GrantMoney("family incentive", 1000005, 0, "weekend_pool", Decimal(250)),),
        )
    )
    assert (column.total_awards, column.awards, column.recipients, column.families) == (Decimal(1750), 2, 2, 2)


def test_money_no_group_holds_is_in_the_total_and_its_own_line_never_dropped() -> None:
    """D100's "needs a group" and a non-reported program (Family School): the money is all-money (D87), so it counts
    in Total Awards Granted and the families; it is shown as "not in a group", and in no camper cut."""
    column = development_column(
        _inputs(
            attendance=(_went(EMMA, 1000001), _went(OLIVIA, 1000004, NOT_REPORTED)),
            requests=(
                req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),
                req(
                    "reqolivia000001",
                    rnd(1, ask="900", posted="600"),
                    person=OLIVIA,
                    household=1000004,
                    pool=NOT_REPORTED,
                ),
            ),
            grants=(
                GrantMoney("ungrouped grant", 1000001, EMMA, None, Decimal(250)),
                GrantMoney("ungrouped grant", 1000099, 0, None, Decimal(70)),  # nobody there attended: not counted
            ),
        )
    )
    assert (column.not_in_group.camp, column.not_in_group.outside, column.not_in_group.awards) == (
        Decimal(600),
        Decimal(250),
        2,
    )
    assert (column.total_awards, column.awards, column.families) == (Decimal(2350), 3, 2)
    assert _camp(column).recipients == 1  # Olivia is in no camper cut
    assert SourceLine("ungrouped grant", NOT_REPORTED, Decimal(250), 1) in column.by_source


def test_tli_and_scit_stay_a_program_line_of_the_summer_group() -> None:
    """§5.11, D89: teens are by age; TLI + SCIT stays a program line."""
    column = development_column(
        _inputs(
            attendance=(_went(EMMA, 1000001), Attendance(LIAM, 1000002, "camp_pool", SESSION_START, teen_program=True)),
            requests=(
                req("reqemma00000001", rnd(1, ask="4000", posted="1500"), person=EMMA),
                req("reqliam00000001", rnd(1, ask="4000", posted="1500"), person=LIAM, household=1000002),
            ),
        )
    )
    assert _camp(column).teen_programs == 1


def test_every_cancel_reason_counts_every_cancelled_request_attended_or_not() -> None:
    """D158 (amends D101): development sees every reason; each counts every cancelled aid request in its group,
    awarded or not, attended or not. A cancellation with no reason given is "not recorded"."""
    column = development_column(
        _inputs(
            requests=(
                req("reqemma00000001", rnd(1, ask="4000"), person=EMMA, standing="cancelled", reason="medical"),
                req(
                    "reqliam00000001",
                    rnd(1, ask="4000", posted="1500"),
                    person=LIAM,
                    household=1000002,
                    standing="cancelled",
                    reason="aid_not_enough",
                ),
                req("reqsamuel000001", rnd(1, ask="4000"), person=SAMUEL, household=1000003, standing="cancelled"),
                req("reqolivia000001", rnd(1, ask="4000", posted="1500"), person=OLIVIA, household=1000004),
            ),
            attendance=(_went(OLIVIA, 1000004),),
        )
    )
    camp = _camp(column)
    assert camp.cancelled_by_reason == {"medical": 1, "aid_not_enough": 1, NOT_RECORDED_REASON: 1}
    assert camp.appeals.declined_insufficient_aid == 1  # the aid_not_enough line keeps its own count


def test_rebuilt_ages_count_recipients_by_age_on_their_first_summer_session() -> None:
    """D158 (B4c): a recipient is a camper a live line names, or a summer camper of a household a household-level camp
    line names (RULED (owner 2026-10-02), item 50: every such camper counts); age is on the first day of the first summer
    session (D103)."""
    stays = [
        (EMMA, 1000001, date(2025, 6, 20)),
        (LIAM, 1000002, date(2025, 7, 10)),
        (SAMUEL, 1000002, date(2025, 6, 20)),
        (OLIVIA, 1000004, None),
    ]
    persons = {
        EMMA: Person(EMMA, date(2015, 1, 1), ""),
        LIAM: Person(LIAM, date(2012, 1, 1), ""),
        SAMUEL: Person(SAMUEL, date(2007, 1, 1), ""),
    }
    ages = rebuilt_ages(stays, persons, money_people={EMMA, OLIVIA}, money_households={1000002})
    assert ages == {YOUTH: 1, TEEN: 1, ADULT: 1, AGE_UNKNOWN: 1}  # Emma 10, Liam 13, Samuel 18, Olivia no birthdate
