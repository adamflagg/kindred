"""Tests for 10th grader exclusion in retention drilldowns.

Verifies that:
- retention_all card drilldown excludes 10th graders
- retention_not_returned card drilldown excludes 10th graders
- retention_session drilldown excludes 10th graders
- Non-retention drilldowns are NOT affected
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.drilldown_service import DrilldownService
from api.services.retention_service import RetentionService

# ============================================================================
# Helpers
# ============================================================================


def _make_person(
    cm_id: int,
    grade: int | None = 7,
    gender: str = "M",
    first_name: str = "Emma",
    last_name: str = "Johnson",
) -> Mock:
    p = Mock()
    p.cm_id = cm_id
    p.grade = grade
    p.gender = gender
    p.first_name = first_name
    p.last_name = last_name
    p.preferred_name = None
    p.age = 12
    p.years_at_camp = 2
    p.school = "Riverside Elementary"
    p.normalized_school = None
    p.normalized_city = None
    p.normalized_congregation = None
    p.address_city = "Springfield"
    p.address_state = "IL"
    return p


def _make_session(
    cm_id: int,
    name: str = "Session 2",
    session_type: str = "main",
    parent_id: int | None = None,
) -> Mock:
    s = Mock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = parent_id
    s.start_date = "2025-06-15"
    s.end_date = "2025-07-05"
    return s


def _make_attendee(person_id: int, session: Mock, status: str = "enrolled") -> Mock:
    a = Mock()
    a.person_id = person_id
    a.expand = {"session": session}
    a.status = status
    return a


class TestDrilldownRetentionCardAgedOut:
    """10th graders should be excluded from retention card drilldowns."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    @pytest.fixture
    def base_session(self) -> Mock:
        return _make_session(1001, "Session 2")

    @pytest.fixture
    def compare_session(self) -> Mock:
        return _make_session(2001, "Session 2")

    @pytest.mark.asyncio
    async def test_retention_all_excludes_10th_graders(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """retention_all card should not include 10th graders."""
        persons = {
            1: _make_person(1, grade=7, first_name="Emma", last_name="Johnson"),
            2: _make_person(2, grade=10, first_name="Liam", last_name="Garcia"),  # aged out
        }
        base_attendees = [_make_attendee(1, base_session), _make_attendee(2, base_session)]
        compare_attendees = [_make_attendee(1, compare_session)]

        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, status=None: base_attendees if year == 2025 else compare_attendees
        )
        repo.fetch_persons = AsyncMock(return_value=persons)
        repo.fetch_sessions = AsyncMock(return_value={base_session.cm_id: base_session})

        svc = DrilldownService(repo)
        result = await svc.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_all",
            breakdown_value="all",
            compare_year=2026,
        )

        person_ids = {a.person_id for a in result}
        assert 1 in person_ids
        assert 2 not in person_ids  # grade 10 excluded

    @pytest.mark.asyncio
    async def test_retention_all_keeps_11th_graders(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Drilldowns now track grade 11 (teen-pipeline aware), unlike grade 10.

        The legacy grade>=10 ceiling has been replaced by effective_pipeline, which
        mirrors the retention card: grade 11 returns to a teen program so it is always
        tracked; only grade 10 is gated by the flag and graduating grades (>=12) drop.
        """
        persons = {
            1: _make_person(1, grade=7, first_name="Emma", last_name="Johnson"),
            2: _make_person(2, grade=11, first_name="Olivia", last_name="Chen"),  # tracked
        }
        base_attendees = [_make_attendee(1, base_session), _make_attendee(2, base_session)]
        compare_attendees = [_make_attendee(1, compare_session)]

        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, status=None: base_attendees if year == 2025 else compare_attendees
        )
        repo.fetch_persons = AsyncMock(return_value=persons)
        repo.fetch_sessions = AsyncMock(return_value={base_session.cm_id: base_session})

        svc = DrilldownService(repo)
        result = await svc.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_all",
            breakdown_value="all",
            compare_year=2026,
        )

        person_ids = {a.person_id for a in result}
        assert 1 in person_ids
        assert 2 in person_ids  # grade 11 tracked (no longer aged out)

    @pytest.mark.asyncio
    async def test_retention_not_returned_excludes_10th_graders(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """retention_not_returned should not include 10th graders."""
        persons = {
            1: _make_person(1, grade=7),  # doesn't return
            2: _make_person(2, grade=10),  # aged out - should NOT show as "not returned"
        }
        base_attendees = [_make_attendee(1, base_session), _make_attendee(2, base_session)]
        compare_attendees: list[Mock] = []

        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, status=None: base_attendees if year == 2025 else compare_attendees
        )
        repo.fetch_persons = AsyncMock(return_value=persons)
        repo.fetch_sessions = AsyncMock(return_value={base_session.cm_id: base_session})

        svc = DrilldownService(repo)
        result = await svc.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_not_returned",
            breakdown_value="all",
            compare_year=2026,
        )

        person_ids = {a.person_id for a in result}
        assert 1 in person_ids  # genuinely didn't return
        assert 2 not in person_ids  # excluded (aged out)


class TestDrilldownRetentionSessionAgedOut:
    """10th graders should be excluded from retention session drilldowns."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    @pytest.mark.asyncio
    async def test_retention_session_excludes_10th_graders(self, repo: AsyncMock) -> None:
        """retention_session drilldown should not include 10th graders."""
        base_session = _make_session(1001, "Session 2")
        compare_session = _make_session(2001, "Session 2")

        persons = {
            1: _make_person(1, grade=7, first_name="Emma", last_name="Johnson"),
            2: _make_person(2, grade=10, first_name="Liam", last_name="Garcia"),  # aged out
        }
        base_attendees = [_make_attendee(1, base_session), _make_attendee(2, base_session)]
        compare_attendees = [_make_attendee(1, compare_session), _make_attendee(2, compare_session)]

        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, status=None: base_attendees if year == 2025 else compare_attendees
        )
        repo.fetch_persons = AsyncMock(return_value=persons)
        repo.fetch_sessions = AsyncMock(return_value={base_session.cm_id: base_session})

        svc = DrilldownService(repo)
        result = await svc.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_session",
            breakdown_value=str(compare_session.cm_id),
            compare_year=2026,
        )

        person_ids = {a.person_id for a in result}
        assert 1 in person_ids
        assert 2 not in person_ids  # excluded


class TestDrilldownNonRetentionNotAffected:
    """Non-retention drilldowns should NOT exclude 10th graders."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    @pytest.mark.asyncio
    async def test_grade_drilldown_keeps_10th_graders(self, repo: AsyncMock) -> None:
        """Regular grade drilldown (without compare_year) should keep 10th graders."""
        session = _make_session(1001, "Session 2")
        persons = {
            1: _make_person(1, grade=10, first_name="Emma", last_name="Johnson"),
        }
        attendees = [_make_attendee(1, session)]

        repo.fetch_attendees = AsyncMock(return_value=attendees)
        repo.fetch_persons = AsyncMock(return_value=persons)
        repo.fetch_sessions = AsyncMock(return_value={session.cm_id: session})

        svc = DrilldownService(repo)
        result = await svc.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="grade",
            breakdown_value="10",
            compare_year=None,  # No retention context
        )

        assert len(result) == 1
        assert result[0].person_id == 1


# ============================================================================
# Teen-pipeline (effective_pipeline) aged-out gating
# ============================================================================


def _build_drilldown_service(grade: int, session: str) -> DrilldownService:
    """Build a DrilldownService backed by a single base camper of ``grade``.

    The camper is enrolled in a ``session`` ("scit" or "main") session in the
    base year (2025) and re-enrolled in the equivalent compare-year (2026)
    session, so they count as returned. The base year also carries a main
    session so the summer window resolves for teen-window gating.
    """
    if session == "scit":
        base_session = _make_session(1002, "SCIT", session_type="scit")
        compare_session = _make_session(2002, "SCIT", session_type="scit")
    else:
        base_session = _make_session(1003, "Session 2", session_type="main")
        compare_session = _make_session(2003, "Session 2", session_type="main")

    base_main = _make_session(1001, "Session 2", session_type="main")
    compare_main = _make_session(2001, "Session 2", session_type="main")

    persons = {1: _make_person(1, grade=grade)}
    base_attendees = [_make_attendee(1, base_session)]
    compare_attendees = [_make_attendee(1, compare_session)]

    sessions_base = {base_main.cm_id: base_main, base_session.cm_id: base_session}
    sessions_compare = {compare_main.cm_id: compare_main, compare_session.cm_id: compare_session}

    def _filter_sessions(sessions: dict[int, Mock], types: list[str] | None) -> dict[int, Mock]:
        if not types:
            return sessions
        return {cid: s for cid, s in sessions.items() if getattr(s, "session_type", None) in types}

    repo = AsyncMock()
    repo.fetch_attendees = AsyncMock(
        side_effect=lambda year, *a, **kw: base_attendees if year == 2025 else compare_attendees
    )
    repo.fetch_persons = AsyncMock(return_value=persons)
    repo.fetch_sessions = AsyncMock(
        side_effect=lambda year, types=None: _filter_sessions(
            sessions_base if year == 2025 else sessions_compare, types
        )
    )
    return DrilldownService(repo)


class TestDrilldownEffectivePipeline:
    """include_teen_pipeline gating mirrors the retention card's effective_pipeline."""

    @pytest.mark.asyncio
    async def test_drilldown_grade11_always_listed_teen_scope(self) -> None:
        svc = _build_drilldown_service(grade=11, session="scit")
        off = await svc.get_attendees_for_breakdown(
            2025,
            "retention_all",
            "all",
            session_types=["scit", "tli"],
            compare_year=2026,
            include_teen_pipeline=False,
        )
        on = await svc.get_attendees_for_breakdown(
            2025,
            "retention_all",
            "all",
            session_types=["scit", "tli"],
            compare_year=2026,
            include_teen_pipeline=True,
        )
        assert len(off) == 1
        assert len(on) == 1

    @pytest.mark.asyncio
    async def test_drilldown_grade10_gated_by_flag(self) -> None:
        svc = _build_drilldown_service(grade=10, session="main")
        off = await svc.get_attendees_for_breakdown(
            2025,
            "retention_all",
            "all",
            session_types=["main", "scit", "tli"],
            compare_year=2026,
            include_teen_pipeline=False,
        )
        on = await svc.get_attendees_for_breakdown(
            2025,
            "retention_all",
            "all",
            session_types=["main", "scit", "tli"],
            compare_year=2026,
            include_teen_pipeline=True,
        )
        assert len(off) == 0
        assert len(on) == 1

    @pytest.mark.asyncio
    async def test_drilldown_non_teen_scope_flag_inert(self) -> None:
        svc = _build_drilldown_service(grade=10, session="main")
        on = await svc.get_attendees_for_breakdown(
            2025,
            "retention_all",
            "all",
            session_types=["main", "quest"],
            compare_year=2026,
            include_teen_pipeline=True,
        )
        assert len(on) == 0  # no teen destination in scope -> grade 10 still aged out


# ============================================================================
# Reconciliation: drilldown returned count == retention card returned count
# ============================================================================


def _dated_session(
    cm_id: int,
    name: str,
    session_type: str,
    start_date: str,
    end_date: str,
) -> Mock:
    """Build a session with explicit start/end dates (for window gating)."""
    s = _make_session(cm_id, name, session_type=session_type)
    s.start_date = start_date
    s.end_date = end_date
    return s


class _SharedTeenFixtures:
    """In-memory repo data shared by a real RetentionService AND DrilldownService.

    A single AsyncMock repository serves both services so a reconciliation test
    exercises the IDENTICAL underlying data. Includes the off-season edge: a base
    summer SCIT teen whose ONLY compare-year enrollment is an off-season scit
    session (dates outside the summer window).
    """

    def __init__(self) -> None:
        # 2025 base: main session (defines summer window) + summer SCIT.
        base_main = _dated_session(1001, "Session 2", "main", "2025-06-15", "2025-07-05")
        base_scit = _dated_session(1002, "SCIT", "scit", "2025-06-15", "2025-07-05")
        # 2026 compare: main session (defines window) + an OFF-SEASON scit
        # (Feb L.A. trip) that does NOT overlap the summer window.
        compare_main = _dated_session(2001, "Session 2", "main", "2026-06-15", "2026-07-05")
        compare_offseason_scit = _dated_session(2002, "SCIT L.A. Trip", "scit", "2026-02-10", "2026-02-14")

        # Person 1: rising-12th (grade 11) summer SCIT teen, tracked under teen scope.
        # Returns ONLY to the off-season scit -> NOT a summer return.
        self.persons_base = {1: _make_person(1, grade=11)}

        self.attendees_base = [_make_attendee(1, base_scit)]
        self.attendees_compare = [_make_attendee(1, compare_offseason_scit)]

        self.sessions_base = {base_main.cm_id: base_main, base_scit.cm_id: base_scit}
        self.sessions_compare = {
            compare_main.cm_id: compare_main,
            compare_offseason_scit.cm_id: compare_offseason_scit,
        }

    def repo(self) -> AsyncMock:
        """Build an AsyncMock repository wired to this fixture's data.

        fetch_sessions honors the session_types filter (so the off-season scit
        is still returned by fetch_sessions(year, None) and the type-scoped
        fetch alike — the window gate is applied by the services, not the repo).
        """
        repo = AsyncMock()
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: self.attendees_base if year == 2025 else self.attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: self.persons_base if year == 2025 else {})
        repo.fetch_bunk_assignments = AsyncMock(return_value=[])
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        def _fetch_sessions(year: int, types: list[str] | None = None) -> dict[int, Mock]:
            all_sessions = self.sessions_base if year == 2025 else self.sessions_compare
            if not types:
                return all_sessions
            return {cid: s for cid, s in all_sessions.items() if getattr(s, "session_type", None) in types}

        repo.fetch_sessions = AsyncMock(side_effect=_fetch_sessions)
        return repo


def _shared_teen_fixtures_with_offseason_return() -> _SharedTeenFixtures:
    return _SharedTeenFixtures()


def _retention_service(fixtures: _SharedTeenFixtures) -> RetentionService:
    return RetentionService(fixtures.repo())


def _drilldown_service(fixtures: _SharedTeenFixtures) -> DrilldownService:
    return DrilldownService(fixtures.repo())


class TestDrilldownReconcilesWithRetentionCard:
    """The retention_returned drilldown count must equal the card's returned_count."""

    @pytest.mark.asyncio
    async def test_drilldown_reconciles_with_retention_card_teen_scope(self) -> None:
        fixtures = _shared_teen_fixtures_with_offseason_return()
        for flag in (False, True):
            card = await _retention_service(fixtures).calculate_retention(
                2025, 2026, session_types=["scit", "tli"], include_teen_pipeline=flag
            )
            returned = await _drilldown_service(fixtures).get_attendees_for_breakdown(
                2025,
                "retention_returned",
                "returned",
                session_types=["scit", "tli"],
                compare_year=2026,
                include_teen_pipeline=flag,
            )
            assert len(returned) == card.returned_count, f"flag={flag}"


class _DurationFixtures:
    """Shared repo data for a duration-filter reconciliation test.

    A grade-7 camper does a 2-week base session, then returns ONLY to a 1-week
    compare session. Under duration="2-week", the retention card counts them as
    NOT returned (their compare-year enrollment is the wrong length), so the
    retention_returned drilldown must agree: the returned set has to carry the
    same duration gate the card applies to its compare pool.
    """

    def __init__(self) -> None:
        base_2wk = _dated_session(1001, "Session A", "main", "2025-06-15", "2025-06-28")  # 14d -> 2-week
        compare_2wk = _dated_session(2001, "Session A", "main", "2026-06-15", "2026-06-28")  # window + 2-week
        compare_1wk = _dated_session(2002, "Session B", "main", "2026-06-15", "2026-06-21")  # 7d -> 1-week

        self.persons_base = {1: _make_person(1, grade=7)}
        self.attendees_base = [_make_attendee(1, base_2wk)]
        self.attendees_compare = [_make_attendee(1, compare_1wk)]  # returns to the WRONG length
        self.sessions_base = {base_2wk.cm_id: base_2wk}
        self.sessions_compare = {compare_2wk.cm_id: compare_2wk, compare_1wk.cm_id: compare_1wk}

    def repo(self) -> AsyncMock:
        repo = AsyncMock()
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: self.attendees_base if year == 2025 else self.attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: self.persons_base if year == 2025 else {})
        repo.fetch_bunk_assignments = AsyncMock(return_value=[])
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        def _fetch_sessions(year: int, types: list[str] | None = None) -> dict[int, Mock]:
            all_sessions = self.sessions_base if year == 2025 else self.sessions_compare
            if not types:
                return all_sessions
            return {cid: s for cid, s in all_sessions.items() if getattr(s, "session_type", None) in types}

        repo.fetch_sessions = AsyncMock(side_effect=_fetch_sessions)
        return repo


class TestDrilldownReconcilesWithDurationFilter:
    """retention_returned drilldown must equal the card returned_count under a duration filter."""

    @pytest.mark.asyncio
    async def test_returned_drilldown_respects_duration_filter(self) -> None:
        fixtures = _DurationFixtures()
        card = await RetentionService(fixtures.repo()).calculate_retention(2025, 2026, duration="2-week")
        returned = await DrilldownService(fixtures.repo()).get_attendees_for_breakdown(
            2025,
            "retention_returned",
            "returned",
            compare_year=2026,
            duration="2-week",
        )
        # Compare-year enrollment is a 1-week session, so the camper is NOT a
        # 2-week returner; the card and the drilldown must both report zero.
        assert card.returned_count == 0
        assert len(returned) == card.returned_count
