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

# Teen session window: 2025 base + 2026 compare both overlap the main camp window.
_BASE_TEEN_SESSION = _make_session(1002, "SCIT", session_type="scit")
_BASE_MAIN_SESSION = _make_session(1001, "Session 2", session_type="main")
_COMPARE_TEEN_SESSION = _make_session(2002, "SCIT", session_type="scit")
_COMPARE_MAIN_SESSION = _make_session(2001, "Session 2", session_type="main")


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
        base_session = _make_session(1001, "Session 2", session_type="main")
        compare_session = _make_session(2001, "Session 2", session_type="main")

    base_main = _make_session(1001, "Session 2", session_type="main")
    compare_main = _make_session(2001, "Session 2", session_type="main")

    persons = {1: _make_person(1, grade=grade)}
    base_attendees = [_make_attendee(1, base_session)]
    compare_attendees = [_make_attendee(1, compare_session)]

    sessions_base = {base_main.cm_id: base_main, base_session.cm_id: base_session}
    sessions_compare = {compare_main.cm_id: compare_main, compare_session.cm_id: compare_session}

    repo = AsyncMock()
    repo.fetch_attendees = AsyncMock(
        side_effect=lambda year, *a, **kw: base_attendees if year == 2025 else compare_attendees
    )
    repo.fetch_persons = AsyncMock(return_value=persons)
    repo.fetch_sessions = AsyncMock(
        side_effect=lambda year, types=None: sessions_base if year == 2025 else sessions_compare
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
