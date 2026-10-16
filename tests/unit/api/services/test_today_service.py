"""Analytics Today (#3207 PR 8): Session fill and Recent sign-ups.

Owner rulings this pins (2026-10-14 and 2026-10-15 ~22:00 PT):
- Session fill lists this year's sessions only (#14: a session not offered this year is not drawn), each
  compared with its own match last year (#15: matched by ``match_session_in_year``, teens by program), so
  the fill total compares only matched sessions. The prior-year figure per matched session lives in one
  function, ``prior_figure_for_session``.
- PR 8b, the embedded add (#15, #50, #51): a prior-year embedded session with no match this year folds, by
  dates, into the prior-year figure of the main session that contains it (shared start or end included), on
  Today only. A single-session headline counts the folded campers once (#51), and Pace's prior compares the
  same sessions as the fill total.
- Every comparison is "vs same point last year" while the season is live (decision 7): registered by that
  day and not cancelled by it.
- Recent sign-ups (decision 40, decision 37): the last 7 days by Enrolled on (``enrollment_date`` as a
  camp-time day), one line per camper per day, newest first, at most 6 lines.
"""

from datetime import date
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.session_availability import (
    AGSessionAvailability,
    GenderAvailability,
    SessionAvailability,
    SessionAvailabilityResponse,
    TeenSessionAvailability,
)
from api.services.today_service import (
    TodayService,
    build_pace_prior,
    build_recent_lines,
    build_session_fill_rows,
    count_prior_by_session,
    fold_embedded_sessions,
    headline_prior_campers,
    match_prior_sessions,
    prior_breakdown,
    prior_figure_for_program,
    prior_figure_for_session,
)
from tests.unit.api.conftest import create_mock_attendee, create_mock_session

# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------


def _prior_2026() -> dict[int, Any]:
    """2026: Taste of Camp 1 and 2, Session 2 with an AG cabin, Session 2b, a quest and SCIT/TLI."""
    return {
        1000101: create_mock_session(
            1000101,
            "Taste of Camp 1",
            year=2026,
            session_type="embedded",
            start_date="2026-06-14",
            end_date="2026-06-20",
        ),
        1000102: create_mock_session(
            1000102,
            "Taste of Camp 2",
            year=2026,
            session_type="embedded",
            start_date="2026-06-21",
            end_date="2026-06-27",
        ),
        1000200: create_mock_session(1000200, "Session 2", year=2026, start_date="2026-06-21", end_date="2026-07-11"),
        1000201: create_mock_session(
            1000201,
            "Session 2 AG",
            year=2026,
            session_type="ag",
            parent_id=1000200,
            start_date="2026-06-21",
            end_date="2026-07-11",
        ),
        1000202: create_mock_session(
            1000202, "Session 2b", year=2026, session_type="embedded", start_date="2026-07-05", end_date="2026-07-11"
        ),
        1000401: create_mock_session(
            1000401, "Quest 1", year=2026, session_type="quest", start_date="2026-06-14", end_date="2026-06-27"
        ),
        1000501: create_mock_session(
            1000501, "CIT", year=2026, session_type="scit", start_date="2026-06-14", end_date="2026-07-25"
        ),
        1000502: create_mock_session(
            1000502, "SIT", year=2026, session_type="scit", start_date="2026-06-14", end_date="2026-07-25"
        ),
    }


def _current_2027() -> dict[int, Any]:
    """2027: Taste of Camp (new id, no number), Session 2 (same id) with its AG cabin, Quest 1, SCIT."""
    return {
        1000901: create_mock_session(
            1000901, "Taste of Camp", year=2027, session_type="embedded", start_date="2027-06-13", end_date="2027-06-19"
        ),
        1000200: create_mock_session(1000200, "Session 2", year=2027, start_date="2027-06-20", end_date="2027-07-10"),
        1000211: create_mock_session(
            1000211,
            "Session 2 AG",
            year=2027,
            session_type="ag",
            parent_id=1000200,
            start_date="2027-06-20",
            end_date="2027-07-10",
        ),
        1000401: create_mock_session(
            1000401, "Quest 1", year=2027, session_type="quest", start_date="2027-06-13", end_date="2027-06-26"
        ),
        1000501: create_mock_session(
            1000501, "CIT", year=2027, session_type="scit", start_date="2027-06-13", end_date="2027-07-24"
        ),
    }


def _gender(enrolled: int, capacity: int | None, waitlisted: int = 0) -> GenderAvailability:
    return GenderAvailability(enrolled=enrolled, capacity=capacity, waitlisted=waitlisted)


def _availability_2027() -> SessionAvailabilityResponse:
    return SessionAvailabilityResponse(
        sessions=[
            SessionAvailability(
                session_cm_id=1000200,
                session_name="Session 2",
                session_type="main",
                girls=_gender(134, 138, 10),
                boys=_gender(131, 138, 16),
            ),
            SessionAvailability(
                session_cm_id=1000901,
                session_name="Taste of Camp",
                session_type="embedded",
                girls=_gender(51, 54, 2),
                boys=_gender(47, 54, 4),
            ),
            SessionAvailability(
                session_cm_id=1000401,
                session_name="Quest 1",
                session_type="quest",
                girls=_gender(11, 12),
                boys=_gender(11, 12, 3),
            ),
        ],
        ag_sessions=[
            AGSessionAvailability(
                session_cm_id=1000211,
                session_name="Session 2 AG",
                parent_session_name="Session 2",
                enrolled=12,
                waitlisted=2,
                capacity=12,
            )
        ],
        teen_sessions=[
            TeenSessionAvailability(session_name="SCIT", session_type="scit", enrolled=38, waitlisted=4, capacity=40)
        ],
        limited_threshold=95,
    )


# Prior counts keyed (session cm_id, gender): F, M, or "" for anyone else.
PRIOR_COUNTS: dict[tuple[int, str], int] = {
    (1000101, "F"): 50,
    (1000101, "M"): 54,
    (1000102, "F"): 30,
    (1000102, "M"): 28,
    (1000200, "F"): 130,
    (1000200, "M"): 126,
    (1000201, "F"): 5,
    (1000201, "M"): 7,
    (1000202, "F"): 33,
    (1000202, "M"): 33,
    (1000401, "F"): 10,
    (1000401, "M"): 11,
    (1000501, "F"): 20,
    (1000502, "M"): 16,
}


# ---------------------------------------------------------------------------
# Matching and the prior-year figure (rulings #14, #15)
# ---------------------------------------------------------------------------


class TestMatchPriorSessions:
    def test_matches_by_id_then_alias_group(self) -> None:
        matched = match_prior_sessions(_current_2027(), _prior_2026())
        assert matched[1000200] == 1000200  # same id
        assert matched[1000901] == 1000101  # Taste of Camp ↔ Taste of Camp 1 (alias group)
        assert matched[1000401] == 1000401

    def test_ag_and_teen_sessions_are_not_matched_one_by_one(self) -> None:
        """AG cabins ride with their parent; teens match by program, not by session."""
        matched = match_prior_sessions(_current_2027(), _prior_2026())
        assert 1000211 not in matched
        assert 1000501 not in matched

    def test_an_id_match_wins_a_prior_session_over_a_rename(self) -> None:
        """Two current sessions landing on one prior session: the one keeping its id keeps it."""
        prior = {1000101: create_mock_session(1000101, "Taste of Camp 1", year=2026, session_type="embedded")}
        current = {
            1000101: create_mock_session(1000101, "Taste of Camp 1", year=2027, session_type="embedded"),
            1000901: create_mock_session(1000901, "Taste of Camp", year=2027, session_type="embedded"),
        }
        matched = match_prior_sessions(current, prior)
        assert matched == {1000101: 1000101}


class TestPriorFigureForSession:
    def test_no_match_reads_none(self) -> None:
        assert prior_figure_for_session(None, _prior_2026(), PRIOR_COUNTS) is None

    def test_a_session_counts_itself_and_its_ag_cabins(self) -> None:
        """Session 2 in 2026: 256 in the session itself plus 12 in its AG cabin."""
        assert prior_figure_for_session(1000200, _prior_2026(), PRIOR_COUNTS) == 268

    def test_nothing_is_added_unless_sessions_are_folded_in(self) -> None:
        """Taste of Camp 2 and Session 2b sit inside 2026's Session 2; they count only when passed as folded."""
        assert prior_figure_for_session(1000200, _prior_2026(), PRIOR_COUNTS) == 256 + 12

    def test_a_part_reads_one_cabin_group(self) -> None:
        assert prior_figure_for_session(1000200, _prior_2026(), PRIOR_COUNTS, part="F") == 130
        assert prior_figure_for_session(1000200, _prior_2026(), PRIOR_COUNTS, part="M") == 126
        assert prior_figure_for_session(1000200, _prior_2026(), PRIOR_COUNTS, part="AG") == 12

    def test_a_matched_session_with_nobody_reads_zero(self) -> None:
        assert prior_figure_for_session(1000401, _prior_2026(), {}) == 0


class TestPriorFigureForProgram:
    def test_teens_match_by_program(self) -> None:
        """SCIT last year is CIT plus SIT, whatever their ids."""
        assert prior_figure_for_program("scit", _prior_2026(), PRIOR_COUNTS) == 36

    def test_a_program_last_year_did_not_run_reads_none(self) -> None:
        assert prior_figure_for_program("tli", _prior_2026(), PRIOR_COUNTS) is None


# ---------------------------------------------------------------------------
# The embedded add (PR 8b: rulings #15, #50, #51), Today only
# ---------------------------------------------------------------------------


def _embedded(cm_id: int, name: str, start: str, end: str, session_type: str = "embedded") -> Any:
    return create_mock_session(cm_id, name, year=2026, session_type=session_type, start_date=start, end_date=end)


def _matched_prior_ids() -> set[int]:
    return set(match_prior_sessions(_current_2027(), _prior_2026()).values())


class TestFoldEmbeddedSessions:
    def test_unmatched_embedded_sessions_fold_into_the_main_session_containing_them(self) -> None:
        """Taste of Camp 2 shares Session 2's start, 2b shares its end: both fold in, in date order."""
        folds = fold_embedded_sessions(_prior_2026(), _matched_prior_ids())
        assert folds == {1000200: [1000102, 1000202]}

    def test_an_embedded_session_matched_this_year_does_not_fold(self) -> None:
        """2026 Taste of Camp 1 matches 2027 Taste of Camp, so it never folds, even inside a main."""
        prior = _prior_2026()
        prior[1000300] = create_mock_session(
            1000300, "Session 1", year=2026, start_date="2026-06-14", end_date="2026-06-20"
        )
        folds = fold_embedded_sessions(prior, _matched_prior_ids() | {1000300})
        assert 1000101 not in folds.get(1000300, [])

    def test_a_session_outside_by_a_day_does_not_fold(self) -> None:
        prior = _prior_2026()
        prior[1000203] = _embedded(1000203, "Session 2c", "2026-06-20", "2026-06-26")  # starts the day before
        prior[1000204] = _embedded(1000204, "Session 2d", "2026-07-06", "2026-07-12")  # ends the day after
        folds = fold_embedded_sessions(prior, _matched_prior_ids())
        assert folds == {1000200: [1000102, 1000202]}

    def test_an_unmatched_session_that_is_not_embedded_does_not_fold(self) -> None:
        """Only embedded sessions fold: an unmatched quest inside Session 2's dates stays out."""
        prior = _prior_2026()
        prior[1000402] = _embedded(1000402, "Quest 2", "2026-06-28", "2026-07-04", session_type="quest")
        folds = fold_embedded_sessions(prior, _matched_prior_ids())
        assert folds == {1000200: [1000102, 1000202]}

    def test_an_embedded_session_with_no_dates_does_not_fold(self) -> None:
        prior = _prior_2026()
        prior[1000205] = _embedded(1000205, "Session 2e", "", "")
        assert fold_embedded_sessions(prior, _matched_prior_ids()) == {1000200: [1000102, 1000202]}

    def test_the_tightest_containing_main_session_takes_it(self) -> None:
        """Two main sessions containing it (a long session around a short one): the shorter one is its host."""
        prior = _prior_2026()
        prior[1000600] = create_mock_session(
            1000600, "Session 6", year=2026, start_date="2026-06-14", end_date="2026-07-25"
        )
        folds = fold_embedded_sessions(prior, _matched_prior_ids())
        assert folds[1000200] == [1000102, 1000202]
        assert 1000600 not in folds


class TestFoldedPriorFigure:
    FOLDED = (1000102, 1000202)

    def test_a_folded_figure_adds_the_embedded_sessions(self) -> None:
        """2026 Session 2 268 · Taste of Camp 2 58 · 2b 66 (the signed-off tooltip's example)."""
        assert prior_figure_for_session(1000200, _prior_2026(), PRIOR_COUNTS, folded=self.FOLDED) == 392

    def test_each_cabin_group_adds_the_same_group(self) -> None:
        prior = _prior_2026()
        assert prior_figure_for_session(1000200, prior, PRIOR_COUNTS, part="F", folded=self.FOLDED) == 193
        assert prior_figure_for_session(1000200, prior, PRIOR_COUNTS, part="M", folded=self.FOLDED) == 187
        assert prior_figure_for_session(1000200, prior, PRIOR_COUNTS, part="AG", folded=self.FOLDED) == 12

    def test_an_embedded_sessions_ag_cabins_fold_with_it(self) -> None:
        prior = _prior_2026()
        prior[1000206] = create_mock_session(1000206, "Session 2b AG", year=2026, session_type="ag", parent_id=1000202)
        counts = {**PRIOR_COUNTS, (1000206, "F"): 4}
        assert prior_figure_for_session(1000200, prior, counts, part="AG", folded=self.FOLDED) == 16
        assert prior_figure_for_session(1000200, prior, counts, folded=self.FOLDED) == 396


class TestPriorBreakdown:
    FOLDED = (1000102, 1000202)

    def test_the_main_session_first_then_what_folded_in(self) -> None:
        parts = prior_breakdown(1000200, self.FOLDED, _prior_2026(), PRIOR_COUNTS)
        assert parts is not None
        assert [(p.name, p.prior) for p in parts] == [("Session 2", 268), ("Taste of Camp 2", 58), ("Session 2b", 66)]

    def test_a_cabin_group_breaks_down_its_own_figures(self) -> None:
        parts = prior_breakdown(1000200, self.FOLDED, _prior_2026(), PRIOR_COUNTS, part="F")
        assert parts is not None
        assert [(p.name, p.prior) for p in parts] == [("Session 2", 130), ("Taste of Camp 2", 30), ("Session 2b", 33)]

    def test_nothing_folded_has_no_breakdown(self) -> None:
        assert prior_breakdown(1000200, (), _prior_2026(), PRIOR_COUNTS) is None

    def test_a_group_the_folded_sessions_add_nothing_to_has_no_breakdown(self) -> None:
        """No embedded AG cabins: the AG figure is unchanged, so it is a plain figure."""
        assert prior_breakdown(1000200, self.FOLDED, _prior_2026(), PRIOR_COUNTS, part="AG") is None


class TestFoldedFillRows:
    def _rows(self) -> dict[str, Any]:
        rows = build_session_fill_rows(
            availability=_availability_2027(),
            current_sessions=_current_2027(),
            goals={},
            prior_sessions=_prior_2026(),
            prior_counts=PRIOR_COUNTS,
        )
        return {r.session_name: r for r in rows}

    def test_the_host_row_carries_its_breakdown(self) -> None:
        s2 = self._rows()["Session 2"]
        assert s2.prior_parts is not None
        assert [(p.name, p.prior) for p in s2.prior_parts] == [
            ("Session 2", 268),
            ("Taste of Camp 2", 58),
            ("Session 2b", 66),
        ]
        assert [p.prior_parts is not None for p in s2.parts] == [True, True, False]

    def test_rows_with_nothing_folded_carry_no_breakdown(self) -> None:
        rows = self._rows()
        assert rows["Taste of Camp"].prior_parts is None
        assert rows["Quest 1"].prior_parts is None
        assert rows["SCIT"].prior_parts is None


class TestHeadlinePriorCampers:
    def test_the_union_counts_each_camper_once(self) -> None:
        """#51: Session 2 ∪ Taste of Camp 2 ∪ 2b, a camper in two of them counted once."""

        def att(pid: int, sid: int) -> Any:
            a = create_mock_attendee(pid, sid, year=2026)
            a.expand["session"] = _prior_2026()[sid]
            return a

        attendees = [
            att(1000001, 1000200),
            att(1000002, 1000200),
            att(1000002, 1000102),  # in Session 2 and Taste of Camp 2: once
            att(1000003, 1000202),
            att(1000004, 1000201),  # Session 2's AG cabin counts with it
            att(1000005, 1000101),  # Taste of Camp 1 is not folded in
        ]
        assert headline_prior_campers(attendees, {1000200, 1000201, 1000102, 1000202}) == 4


class TestCountPriorBySession:
    def test_counts_camper_sessions_by_session_and_gender(self) -> None:
        def att(pid: int, sid: int, gender: str) -> Any:
            a = create_mock_attendee(pid, sid, year=2026, gender=gender)
            a.expand["session"] = create_mock_session(sid, "x", year=2026)
            return a

        counts = count_prior_by_session(
            [
                att(1000001, 1000200, "F"),
                att(1000002, 1000200, "M"),
                att(1000003, 1000200, "F"),
                att(1000004, 1000401, "X"),
            ]
        )
        assert counts[(1000200, "F")] == 2
        assert counts[(1000200, "M")] == 1
        assert counts[(1000401, "")] == 1


# ---------------------------------------------------------------------------
# Session fill rows
# ---------------------------------------------------------------------------


class TestBuildSessionFillRows:
    def _rows(self, goals: dict[Any, dict[str, Any]] | None = None) -> list[Any]:
        return build_session_fill_rows(
            availability=_availability_2027(),
            current_sessions=_current_2027(),
            goals=goals if goals is not None else {},
            prior_sessions=_prior_2026(),
            prior_counts=PRIOR_COUNTS,
        )

    def test_rows_follow_session_order(self) -> None:
        """Ruling 1 (B): summer by start date, then quests, then TLI, then SCIT."""
        assert [r.session_name for r in self._rows()] == ["Taste of Camp", "Session 2", "Quest 1", "SCIT"]

    def test_unoffered_prior_sessions_are_not_rows(self) -> None:
        """Ruling #14: Taste of Camp 2 and Session 2b ran in 2026 only, so they are not drawn."""
        names = {r.session_name for r in self._rows()}
        assert "Taste of Camp 2" not in names
        assert "Session 2b" not in names

    def test_ag_cabins_fold_into_their_session(self) -> None:
        s2 = next(r for r in self._rows() if r.session_name == "Session 2")
        assert s2.enrolled == 134 + 131 + 12
        assert s2.waitlisted == 10 + 16 + 2
        assert s2.beds == 138 + 138 + 12
        assert [(p.label, p.enrolled, p.beds) for p in s2.parts] == [
            ("Girls", 134, 138),
            ("Boys", 131, 138),
            ("AG", 12, 12),
        ]

    def test_each_row_compares_with_its_own_match(self) -> None:
        rows = {r.session_name: r for r in self._rows()}
        assert rows["Taste of Camp"].prior == 104  # 2026's Taste of Camp 1
        # 2026's Session 2 (268) plus the embedded sessions it contains, Taste of Camp 2 (58) and 2b (66) (#15)
        assert rows["Session 2"].prior == 268 + 58 + 66
        assert rows["Quest 1"].prior == 21
        assert rows["SCIT"].prior == 36

    def test_parts_carry_their_own_prior(self) -> None:
        """Each cabin group adds the same group of the folded sessions; nothing folds into AG here."""
        s2 = next(r for r in self._rows() if r.session_name == "Session 2")
        assert [p.prior for p in s2.parts] == [130 + 30 + 33, 126 + 28 + 33, 12]

    def test_quests_and_teens_are_one_part(self) -> None:
        rows = {r.session_name: r for r in self._rows()}
        assert [(p.label, p.enrolled, p.beds) for p in rows["Quest 1"].parts] == [("", 22, 24)]
        assert rows["SCIT"].session_cm_id == 0
        assert [(p.label, p.enrolled, p.beds) for p in rows["SCIT"].parts] == [("", 38, 40)]

    def test_a_session_new_this_year_has_no_prior(self) -> None:
        avail = _availability_2027()
        avail.sessions.append(
            SessionAvailability(
                session_cm_id=1000950,
                session_name="Session 5",
                session_type="main",
                girls=_gender(10, 20),
                boys=_gender(10, 20),
            )
        )
        current = _current_2027()
        current[1000950] = create_mock_session(
            1000950, "Session 5", year=2027, start_date="2027-08-01", end_date="2027-08-14"
        )
        rows = build_session_fill_rows(
            availability=avail,
            current_sessions=current,
            goals={},
            prior_sessions=_prior_2026(),
            prior_counts=PRIOR_COUNTS,
        )
        assert next(r for r in rows if r.session_name == "Session 5").prior is None

    def test_beds_are_none_when_no_gender_has_any(self) -> None:
        avail = _availability_2027()
        avail.sessions[0] = SessionAvailability(
            session_cm_id=1000200,
            session_name="Session 2",
            session_type="main",
            girls=_gender(134, None),
            boys=_gender(131, None),
        )
        avail.ag_sessions = []
        rows = build_session_fill_rows(
            availability=avail,
            current_sessions=_current_2027(),
            goals={},
            prior_sessions=_prior_2026(),
            prior_counts=PRIOR_COUNTS,
        )
        assert next(r for r in rows if r.session_name == "Session 2").beds is None

    def test_goals_come_from_the_budget_config(self) -> None:
        """Teens read their goal from the program's type key, as Forecast does."""
        rows = {
            r.session_name: r
            for r in self._rows({1000200: {"participant_goal": 285}, "type:scit": {"participant_goal": 38}})
        }
        assert rows["Session 2"].goal == 285
        assert rows["SCIT"].goal == 38
        assert rows["Taste of Camp"].goal is None


# ---------------------------------------------------------------------------
# Same point last year (decision 7) in the async read
# ---------------------------------------------------------------------------


def _repo_for_fill(prior_dated: list[Any], reg_dates: dict[int, dict[str, str]]) -> MagicMock:
    repo = MagicMock()
    current = _current_2027()
    prior = _prior_2026()

    async def fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
        source = current if year == 2027 else prior
        if session_types is None:
            return dict(source)
        return {k: v for k, v in source.items() if v.session_type in session_types}

    async def fetch_registration_dates(year: int) -> dict[str, str]:
        return reg_dates.get(year, {})

    repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
    repo.fetch_registration_dates = AsyncMock(side_effect=fetch_registration_dates)
    repo.fetch_attendees_with_dates = AsyncMock(return_value=prior_dated)
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_budget_config = AsyncMock(return_value={})
    repo.fetch_bunk_plans = AsyncMock(return_value=[])
    repo.fetch_capacity_config = AsyncMock(return_value=8)
    repo.fetch_attendees_with_persons = AsyncMock(return_value=[])
    repo.fetch_availability_config = AsyncMock(return_value=[])
    return repo


def _prior_attendee(pid: int, sid: int, registered: str, status: str = "enrolled", left: str | None = None) -> Any:
    status_id = {"enrolled": 2, "cancelled": 32}[status]
    a = create_mock_attendee(
        pid,
        sid,
        year=2026,
        status=status,
        status_id=status_id,
        gender="F",
        effective_date=registered,
        enrollment_date=left or f"{registered} 18:00:00.000Z",
    )
    a.expand["session"] = _prior_2026()[sid]
    return a


class TestSessionFillSamePoint:
    @pytest.mark.asyncio
    async def test_prior_is_read_at_the_same_registration_day(self) -> None:
        """2027 day 10 reads 2026 at its day 10 (2025-11-22): the basis and the cutoff day.

        What counts at that cutoff (registered by then, not cancelled by then) is pinned by
        test_counts_only_what_stood_at_the_cutoff, on the same four attendees.
        """
        prior_dated = [
            _prior_attendee(1000001, 1000200, "2025-11-12"),  # registered day 1: counts
            _prior_attendee(1000002, 1000200, "2026-01-05"),  # registered later: not yet
            # registered day 1, cancelled day 30: still enrolled at day 10
            _prior_attendee(1000003, 1000200, "2025-11-12", status="cancelled", left="2025-12-12 18:00:00.000Z"),
            # registered day 1, cancelled day 3: gone by day 10
            _prior_attendee(1000004, 1000200, "2025-11-12", status="cancelled", left="2025-11-14 18:00:00.000Z"),
        ]
        reg_dates = {2027: {"priority_reg_date": "2026-11-11"}, 2026: {"priority_reg_date": "2025-11-12"}}
        service = TodayService(_repo_for_fill(prior_dated, reg_dates))
        result = await service.session_fill(2027, ["main", "embedded", "ag", "quest"], today=date(2026, 11, 21))
        assert result.prior_basis == "same_point"
        assert result.day_offset == 10
        assert result.as_of_date == "2025-11-22"
        assert result.prior_year == 2026

    @pytest.mark.asyncio
    async def test_counts_only_what_stood_at_the_cutoff(self) -> None:
        prior_dated = [
            _prior_attendee(1000001, 1000200, "2025-11-12"),
            _prior_attendee(1000002, 1000200, "2026-01-05"),
            _prior_attendee(1000003, 1000200, "2025-11-12", status="cancelled", left="2025-12-12 18:00:00.000Z"),
            _prior_attendee(1000004, 1000200, "2025-11-12", status="cancelled", left="2025-11-14 18:00:00.000Z"),
        ]
        reg_dates = {2027: {"priority_reg_date": "2026-11-11"}, 2026: {"priority_reg_date": "2025-11-12"}}
        service = TodayService(_repo_for_fill(prior_dated, reg_dates))
        avail = _availability_2027()
        service._availability = AsyncMock(return_value=avail)  # type: ignore[method-assign]
        result = await service.session_fill(2027, ["main", "embedded", "ag", "quest"], today=date(2026, 11, 21))
        s2 = next(r for r in result.rows if r.session_name == "Session 2")
        assert s2.prior == 2

    @pytest.mark.asyncio
    async def test_no_anchor_compares_with_last_years_final(self) -> None:
        prior_enrolled = [_prior_attendee(1000001, 1000200, "2026-01-05")]
        repo = _repo_for_fill([], {})
        repo.fetch_attendees = AsyncMock(return_value=prior_enrolled)
        service = TodayService(repo)
        service._availability = AsyncMock(return_value=_availability_2027())  # type: ignore[method-assign]
        result = await service.session_fill(2027, ["main", "embedded", "ag", "quest"], today=date(2026, 11, 21))
        assert result.prior_basis == "final"
        assert result.as_of_date is None
        assert next(r for r in result.rows if r.session_name == "Session 2").prior == 1


# ---------------------------------------------------------------------------
# Recent sign-ups (decisions 37, 40)
# ---------------------------------------------------------------------------


def _enrolled(
    pid: int, sid: int, enrolled_at: str, *, first: str = "Emma", last: str = "Johnson", years: int = 2
) -> Any:
    a = create_mock_attendee(
        pid,
        sid,
        year=2027,
        gender="F",
        first_name=first,
        last_name=last,
        years_at_camp=years,
        enrollment_date=enrolled_at,
    )
    a.expand["session"] = _current_2027()[sid]
    return a


TODAY = date(2027, 2, 9)


class TestBuildRecentLines:
    def test_one_line_per_camper_per_day_newest_first(self) -> None:
        attendees = [
            _enrolled(1000002, 1000901, "2027-02-09T18:42:00Z", first="Liam", last="Garcia", years=1),
            _enrolled(1000002, 1000200, "2027-02-09T18:43:00Z", first="Liam", last="Garcia", years=1),
            _enrolled(1000003, 1000200, "2027-02-08T23:20:00Z", first="Olivia", last="Chen"),
        ]
        lines, enrollments = build_recent_lines(attendees, _current_2027(), TODAY)
        assert [(ln.first_name, ln.day, ln.sessions) for ln in lines] == [
            ("Liam", "2027-02-09", ["Taste of Camp", "Session 2"]),
            ("Olivia", "2027-02-08", ["Session 2"]),
        ]
        assert enrollments == 3

    def test_the_day_is_enrolled_on_in_camp_time(self) -> None:
        """03:30 UTC on Feb 9 is still Feb 8 in camp time (Pacific)."""
        attendees = [_enrolled(1000003, 1000200, "2027-02-09T03:30:00Z")]
        lines, _ = build_recent_lines(attendees, _current_2027(), TODAY)
        assert lines[0].day == "2027-02-08"

    def test_the_window_is_the_last_seven_days(self) -> None:
        attendees = [
            _enrolled(1000001, 1000200, "2027-02-03T20:00:00Z"),  # Feb 3: in (today − 6)
            _enrolled(1000003, 1000200, "2027-02-02T20:00:00Z", first="Olivia", last="Chen"),  # Feb 2: out
        ]
        lines, enrollments = build_recent_lines(attendees, _current_2027(), TODAY)
        assert [ln.first_name for ln in lines] == ["Emma"]
        assert enrollments == 1

    def test_at_most_six_lines(self) -> None:
        attendees = [_enrolled(1000001 + i, 1000200, f"2027-02-0{3 + (i % 6)}T20:0{i}:00Z") for i in range(9)]
        lines, enrollments = build_recent_lines(attendees, _current_2027(), TODAY)
        assert len(lines) == 6
        assert enrollments == 9

    def test_new_marks_a_first_summer_camper(self) -> None:
        attendees = [
            _enrolled(1000002, 1000200, "2027-02-09T18:00:00Z", first="Liam", last="Garcia", years=1),
            _enrolled(1000003, 1000200, "2027-02-08T18:00:00Z", first="Olivia", last="Chen", years=3),
        ]
        lines, _ = build_recent_lines(attendees, _current_2027(), TODAY)
        assert [ln.is_new for ln in lines] == [True, False]

    def test_second_marks_a_camper_who_already_held_a_session_from_an_earlier_day(self) -> None:
        attendees = [
            _enrolled(1000001, 1000200, "2027-02-09T18:00:00Z"),
            _enrolled(1000001, 1000401, "2026-12-01T18:00:00Z"),  # outside the window, an earlier day
            _enrolled(1000003, 1000200, "2027-02-08T18:00:00Z", first="Olivia", last="Chen"),
        ]
        lines, _ = build_recent_lines(attendees, _current_2027(), TODAY)
        assert [(ln.first_name, ln.is_second) for ln in lines] == [("Emma", True), ("Olivia", False)]

    def test_ties_break_by_name(self) -> None:
        attendees = [
            _enrolled(1000003, 1000200, "2027-02-09T18:00:00Z", first="Olivia", last="Chen"),
            _enrolled(1000002, 1000200, "2027-02-09T18:00:00Z", first="Liam", last="Garcia"),
        ]
        lines, _ = build_recent_lines(attendees, _current_2027(), TODAY)
        assert [ln.first_name for ln in lines] == ["Olivia", "Liam"]  # Chen before Garcia

    def test_a_record_with_no_enrolled_on_date_is_skipped(self) -> None:
        a = _enrolled(1000001, 1000200, "")
        lines, enrollments = build_recent_lines([a], _current_2027(), TODAY)
        assert lines == []
        assert enrollments == 0


class TestRecentSignupsScope:
    @pytest.mark.asyncio
    async def test_only_enrollments_in_scope_are_listed(self) -> None:
        repo = MagicMock()
        current = _current_2027()

        async def fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
            return dict(current)

        repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
        repo.fetch_attendees_with_persons = AsyncMock(
            return_value=[
                _enrolled(1000001, 1000200, "2027-02-09T18:00:00Z"),
                _enrolled(1000003, 1000401, "2027-02-09T19:00:00Z", first="Olivia", last="Chen"),
            ]
        )
        service = TodayService(repo)
        result = await service.recent_signups(2027, ["main", "embedded", "ag"], today=TODAY)
        assert [ln.first_name for ln in result.lines] == ["Emma"]
        assert result.enrollments == 1
        assert result.since == "2027-02-03"
        assert result.today == "2027-02-09"


# ---------------------------------------------------------------------------
# The embedded add in the async read: the headline (#51) and Pace (PR 8b)
# ---------------------------------------------------------------------------


REG_DATES = {2027: {"priority_reg_date": "2026-11-11"}, 2026: {"priority_reg_date": "2025-11-12"}}


def _folding_attendees() -> list[Any]:
    """2026 at day 10 (cutoff 2025-11-22): Session 2, Taste of Camp 2, 2b, Taste of Camp 1 and an unoffered quest."""
    prior = _prior_2026()
    prior[1000402] = _embedded(1000402, "Quest 2", "2026-06-28", "2026-07-04", session_type="quest")

    def att(pid: int, sid: int, registered: str = "2025-11-12") -> Any:
        a = _prior_attendee(pid, 1000200, registered)
        a.expand["session"] = prior[sid]
        a.session_cm_id = sid
        return a

    return [
        att(1000001, 1000200),
        att(1000002, 1000200),
        att(1000002, 1000102),  # one camper in Session 2 and Taste of Camp 2
        att(1000003, 1000202),
        att(1000006, 1000202, "2026-01-05"),  # registered after the cutoff: not yet
        att(1000004, 1000101),  # Taste of Camp 1: its own row
        att(1000005, 1000402),  # Quest 2: not offered in 2027, never compared
    ]


def _folding_service() -> TodayService:
    repo = _repo_for_fill(_folding_attendees(), REG_DATES)
    prior = _prior_2026()
    prior[1000402] = _embedded(1000402, "Quest 2", "2026-06-28", "2026-07-04", session_type="quest")
    current = _current_2027()

    async def fetch_sessions(year: int, session_types: Any = None) -> dict[int, Any]:
        return dict(current if year == 2027 else prior)

    repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
    service = TodayService(repo)
    service._availability = AsyncMock(return_value=_availability_2027())  # type: ignore[method-assign]
    return service


class TestFoldedSessionFill:
    @pytest.mark.asyncio
    async def test_one_session_headline_counts_the_folded_campers_once(self) -> None:
        """#51: 2026 Session 2 ∪ Taste of Camp 2 ∪ 2b at the same point is 3 campers, not 4 camper-sessions."""
        service = _folding_service()
        avail = _availability_2027()
        avail.sessions = [s for s in avail.sessions if s.session_cm_id == 1000200]
        avail.teen_sessions = []
        service._availability = AsyncMock(return_value=avail)  # type: ignore[method-assign]
        result = await service.session_fill(2027, None, session_cm_id=1000200, today=date(2026, 11, 21))
        assert result.headline_prior == 3
        assert result.rows[0].prior == 4

    @pytest.mark.asyncio
    async def test_whole_scope_views_have_no_headline_override(self) -> None:
        result = await _folding_service().session_fill(
            2027, ["main", "embedded", "ag", "quest"], today=date(2026, 11, 21)
        )
        assert result.headline_prior is None

    @pytest.mark.asyncio
    async def test_a_session_with_nothing_folded_has_no_headline_override(self) -> None:
        service = _folding_service()
        avail = _availability_2027()
        avail.sessions = [s for s in avail.sessions if s.session_cm_id == 1000901]
        avail.ag_sessions = []
        avail.teen_sessions = []
        service._availability = AsyncMock(return_value=avail)  # type: ignore[method-assign]
        result = await service.session_fill(2027, None, session_cm_id=1000901, today=date(2026, 11, 21))
        assert result.headline_prior is None

    @pytest.mark.asyncio
    async def test_pace_prior_compares_the_same_sessions_as_the_fill_total(self) -> None:
        """Pace's 2026 curve counts matched sessions plus folded ones: Quest 2 (unoffered) never counts."""
        result = await _folding_service().session_fill(
            2027, ["main", "embedded", "ag", "quest"], today=date(2026, 11, 21)
        )
        assert result.pace_prior is not None
        at = {p.day_offset: p.enrolled for p in result.pace_prior}
        fill_total = sum(r.prior or 0 for r in result.rows)
        assert result.prior_day_offset is not None
        assert at[result.prior_day_offset] == fill_total == 5  # Session 2 4 + Taste of Camp 1
        # The camper registered on 2026-01-05 (day 54) joins the curve then; Quest 2's never does.
        assert at[60] == 6


class TestBuildPacePrior:
    def test_counts_the_given_sessions_by_registration_day(self) -> None:
        points = build_pace_prior(_folding_attendees(), date(2025, 11, 12), {1000200, 1000102})
        at = {p.day_offset: p.enrolled for p in points}
        assert at[0] == 3
        assert points[-1].day_offset == 41 * 7 - 1

    def test_no_sessions_draw_nothing(self) -> None:
        assert all(p.enrolled == 0 for p in build_pace_prior(_folding_attendees(), date(2025, 11, 12), set()))
