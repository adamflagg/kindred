"""The shared session order (owner Q8, 2026-10-09: "listing them by start date, longest before shortest, just how the
summer session dashboard does ... AG can be listed below its parent session. Quest next, then TLI, then SCIT (SIT and
CIT) and, then FC by number"). Fictional sessions; the frontend mirror is `utils/sessionOrder.ts`."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from bunking.session_order import session_order, session_rank


@dataclass(frozen=True)
class S:
    cm_id: int
    name: str
    session_type: str
    start_date: str = ""
    end_date: str = ""
    parent_cm_id: int = 0


def names(sessions: list[S]) -> list[str]:
    by_id = {s.cm_id: s.name for s in sessions}
    return [by_id[i] for i in session_order(sessions)]


def test_summer_sessions_run_by_start_date_and_a_longer_session_comes_before_a_shorter_one_on_the_same_day() -> None:
    sessions = [
        S(3, "Session 3", "main", "2027-07-05", "2027-07-24"),
        S(1, "Taste One", "main", "2027-06-07", "2027-06-12"),
        S(2, "Session 2a", "embedded", "2027-06-14", "2027-06-26"),
        S(4, "Session 2", "main", "2027-06-14", "2027-07-03"),
    ]
    assert names(sessions) == ["Taste One", "Session 2", "Session 2a", "Session 3"]


def test_an_embedded_session_after_its_parent_starts_sits_by_its_own_start_date() -> None:
    sessions = [
        S(1, "Session 2", "main", "2027-06-14", "2027-07-03"),
        S(2, "Taste Two", "embedded", "2027-06-28", "2027-07-03", parent_cm_id=1),
        S(3, "Session 2a", "embedded", "2027-06-14", "2027-06-26", parent_cm_id=1),
        S(4, "Session 3", "main", "2027-07-05", "2027-07-24"),
    ]
    assert names(sessions) == ["Session 2", "Session 2a", "Taste Two", "Session 3"]


def test_an_ag_session_goes_right_under_its_parent() -> None:
    sessions = [
        S(1, "Session 2", "main", "2027-06-14", "2027-07-03"),
        S(2, "Session 2a", "embedded", "2027-06-14", "2027-06-26", parent_cm_id=1),
        S(3, "AG Cabin 2", "ag", "2027-06-14", "2027-07-03", parent_cm_id=1),
        S(4, "Session 3", "main", "2027-07-05", "2027-07-24"),
        S(5, "AG Cabin 3", "ag", "2027-07-05", "2027-07-24", parent_cm_id=4),
    ]
    assert names(sessions) == ["Session 2", "AG Cabin 2", "Session 2a", "Session 3", "AG Cabin 3"]


def test_an_ag_session_with_no_parent_in_the_list_sits_by_its_own_dates() -> None:
    sessions = [
        S(1, "Session 3", "main", "2027-07-05", "2027-07-24"),
        S(2, "Lone AG", "ag", "2027-06-14", "2027-07-03", parent_cm_id=99),
    ]
    assert names(sessions) == ["Lone AG", "Session 3"]


def test_quest_then_tli_then_scit_then_the_teen_retreat_after_all_the_summer_sessions() -> None:
    sessions = [
        S(1, "Winter Retreat", "teen", "2027-12-20", "2027-12-22"),
        S(2, "Leadership Institute", "tli", "2027-07-10", "2027-08-02"),
        S(3, "Counselor Training", "scit", "2027-06-07", "2027-07-03"),
        S(4, "Rock Quest", "quest", "2027-07-12", "2027-07-24"),
        S(5, "Surf Quest", "quest", "2027-06-14", "2027-06-26"),
        S(6, "Session 4", "main", "2027-07-26", "2027-08-07"),
    ]
    assert names(sessions) == [
        "Session 4",
        "Surf Quest",
        "Rock Quest",
        "Leadership Institute",
        "Counselor Training",
        "Winter Retreat",
    ]


def test_family_camp_runs_by_number_then_the_unnumbered_family_sessions_by_date_then_adult_weekends() -> None:
    sessions = [
        S(1, "Family Camp 7: Weekend", "family", "2027-10-01", "2027-10-04"),
        S(2, "Family Camp 10", "family", "2027-11-01", "2027-11-03"),
        S(3, "Mens Weekend", "adult", "2027-10-22", "2027-10-25"),
        S(4, "Winter Family Camp", "family", "2027-12-27", "2027-12-29"),
        S(5, "Family Camp 2: Weekend", "family", "2027-08-20", "2027-08-23"),
        S(6, "Ready Weekend", "family", "2027-04-24", "2027-04-26"),
    ]
    assert names(sessions) == [
        "Family Camp 2: Weekend",
        "Family Camp 7: Weekend",
        "Family Camp 10",
        "Ready Weekend",
        "Winter Family Camp",
        "Mens Weekend",
    ]


def test_the_rank_numbers_the_order_and_ties_break_on_name_then_id() -> None:
    sessions = [S(9, "B", "other", "2027-01-01"), S(8, "A", "other", "2027-01-01"), S(7, "A", "other", "2027-01-01")]
    assert session_order(sessions) == [7, 8, 9]
    assert session_rank(sessions) == {7: 0, 8: 1, 9: 2}


def test_a_session_with_no_dates_goes_last_in_its_kind() -> None:
    sessions = [S(1, "Undated", "main"), S(2, "Dated", "main", "2027-06-14", "2027-07-03")]
    assert names(sessions) == ["Dated", "Undated"]


def test_a_numbered_b_mitzvah_or_hebrew_program_goes_by_its_number_before_its_start_date() -> None:
    """Coordinator (2026-10-10), for the pools the owner gave no rule: a number in the name (Year N, Hebrew N) sorts
    first, then start date, so Year 1 reads before Year 2 though Year 2 starts first, and Hebrew 1 before Hebrew 2."""
    sessions = [
        S(1, "B*Mitzvah Program Year 2 - San Francisco", "bmitzvah", "2027-08-27", "2028-05-26"),
        S(2, "B*Mitzvah Program Year 2 - East Bay", "bmitzvah", "2027-08-27", "2028-05-26"),
        S(3, "B*Mitzvah Program Year 1 - San Francisco", "bmitzvah", "2027-08-29", "2028-05-28"),
        S(4, "B*Mitzvah Program Year 1 - East Bay", "bmitzvah", "2027-08-29", "2028-05-28"),
        S(5, "Hebrew 2 - Wednesdays", "hebrew", "2027-01-09", "2027-03-27"),
        S(6, "Hebrew 1 - Wednesdays", "hebrew", "2027-10-09", "2027-12-04"),
    ]
    assert session_order(sessions) == [4, 3, 2, 1, 6, 5]


def test_a_number_in_a_quest_name_is_not_an_order_number() -> None:
    """Only Family Camp, B*Mitzvah and Hebrew go by a number in the name: a quest's "H20" is part of its name."""
    sessions = [S(1, "Quest H20", "quest", "2027-07-05", "2027-07-24"), S(2, "Rock Quest", "quest", "2027-06-14")]
    assert session_order(sessions) == [2, 1]


FIXTURE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "session_order_cases.json"


def test_the_order_matches_the_fixture_the_frontend_mirror_also_runs() -> None:
    """The drift test (the pattern of PROGRAM_FAMILY_BY_SESSION_TYPE's): `utils/sessionOrder.ts` must give this same
    order for these same sessions. Change one implementation and this file together, or one of the two tests fails."""
    data = json.loads(FIXTURE.read_text())
    sessions = [S(**row) for row in data["sessions"]]
    assert session_order(sessions) == data["order"]
