"""Tests for 10th grader exclusion in retention metrics.

Verifies that:
- 10th graders are excluded from base year totals and all breakdowns
- aged_out_count is reported correctly in the response
- Grade 9 is NOT excluded
- The exclusion cascades to heatmap, session flow, prior session breakdowns
- Quest session 10th graders are also excluded
- Compare pool only counts summer session enrollments (not TLI/family/training)
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.retention_service import RetentionService

# ============================================================================
# Helpers
# ============================================================================


def _make_person(
    cm_id: int,
    grade: int | None = 7,
    gender: str = "M",
    years_at_camp: int = 2,
    school: str = "Riverside Elementary",
    normalized_school: str | None = None,
    normalized_city: str | None = None,
    normalized_congregation: str | None = None,
    address_city: str = "Springfield",
) -> Mock:
    p = Mock()
    p.cm_id = cm_id
    p.grade = grade
    p.gender = gender
    p.years_at_camp = years_at_camp
    p.school = school
    p.normalized_school = normalized_school
    p.normalized_city = normalized_city
    p.normalized_congregation = normalized_congregation
    p.address_city = address_city
    return p


def _make_session(
    cm_id: int,
    name: str = "Session 2",
    session_type: str = "main",
    parent_id: int | None = None,
    start_date: str = "2025-06-15",
    end_date: str = "2025-07-05",
) -> Mock:
    s = Mock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = parent_id
    s.start_date = start_date
    s.end_date = end_date
    return s


def _make_attendee(person_id: int, session: Mock) -> Mock:
    a = Mock()
    a.person_id = person_id
    a.expand = {"session": session}
    a.status = "enrolled"
    return a


def _make_bunk_assignment(person_id: int, session: Mock, bunk_name: str = "B-1") -> Mock:
    person_data = Mock()
    person_data.cm_id = person_id
    bunk_data = Mock()
    bunk_data.name = bunk_name
    record = Mock()
    record.expand = {"person": person_data, "session": session, "bunk": bunk_data}
    return record


# ============================================================================
# Tests
# ============================================================================


class TestRetentionAgedOutExclusion:
    """10th graders should be excluded from retention metrics."""

    @pytest.fixture
    def base_session(self) -> Mock:
        return _make_session(1001, "Session 2", "main")

    @pytest.fixture
    def compare_session(self) -> Mock:
        return _make_session(2001, "Session 2", "main", start_date="2026-06-15")

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup_repo(
        self,
        repo: AsyncMock,
        base_session: Mock,
        compare_session: Mock,
        persons_base: dict[int, Mock],
        attendees_base: list[Mock],
        attendees_compare: list[Mock],
        bunk_assignments: list[Mock] | None = None,
    ) -> None:
        """Wire up the mock repository for a standard retention calculation."""
        persons_compare: dict[int, Mock] = {}

        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: attendees_base if year == 2025 else attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: persons_base if year == 2025 else persons_compare)
        repo.fetch_bunk_assignments = AsyncMock(return_value=bunk_assignments or [])
        repo.fetch_sessions = AsyncMock(
            side_effect=lambda year, types: (
                {base_session.cm_id: base_session} if year == 2025 else {compare_session.cm_id: compare_session}
            )
        )
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_base_total(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """10th graders should not count in base_year_total."""
        persons = {
            1: _make_person(1, grade=9),
            2: _make_person(2, grade=10),  # aged out
            3: _make_person(3, grade=7),
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2, 3]]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Person 2 (grade 10) excluded: 2 in base, 1 returned
        assert result.base_year_total == 2
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_aged_out_count_reported(self, repo: AsyncMock, base_session: Mock, compare_session: Mock) -> None:
        """Response should include aged_out_count."""
        persons = {
            1: _make_person(1, grade=10),
            2: _make_person(2, grade=10),
            3: _make_person(3, grade=8),
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2, 3]]
        attendees_compare = [_make_attendee(3, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        assert result.aged_out_count == 2

    @pytest.mark.asyncio
    async def test_grade_9_not_excluded(self, repo: AsyncMock, base_session: Mock, compare_session: Mock) -> None:
        """Grade 9 should NOT be excluded from retention."""
        persons = {
            1: _make_person(1, grade=9),
            2: _make_person(2, grade=9),
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2]]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        assert result.base_year_total == 2
        assert result.returned_count == 1
        assert result.aged_out_count == 0

    @pytest.mark.asyncio
    async def test_none_grade_not_excluded(self, repo: AsyncMock, base_session: Mock, compare_session: Mock) -> None:
        """Persons with None grade should NOT be excluded."""
        persons = {
            1: _make_person(1, grade=None),
        }
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        assert result.base_year_total == 1
        assert result.aged_out_count == 0

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_gender_breakdown(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Gender breakdown should not include 10th graders."""
        persons = {
            1: _make_person(1, grade=7, gender="F"),
            2: _make_person(2, grade=10, gender="M"),  # aged out
            3: _make_person(3, grade=8, gender="M"),
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2, 3]]
        attendees_compare = [_make_attendee(1, compare_session), _make_attendee(3, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # M should have base_count=1 (person 3 only, not person 2)
        m_breakdown = next((g for g in result.by_gender if g.gender == "M"), None)
        assert m_breakdown is not None
        assert m_breakdown.base_count == 1

    @pytest.mark.asyncio
    async def test_10th_graders_present_in_grade_breakdown(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Grade breakdown ALWAYS includes grade-10 row (carve-out).

        Even though grade-10 is excluded from the headline (base_year_total /
        overall_retention_rate), by_grade always shows the grade-10 row so staff
        can see that cohort's retention rate (their only forward path is a teen
        program, so the rate is meaningful).  Graduating grades (≥12) still drop.
        """
        persons = {
            1: _make_person(1, grade=7),
            2: _make_person(2, grade=10),  # aged out from headline, but kept in by_grade
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2]]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Grade 10 ALWAYS appears in grade breakdown (carve-out from headline exclusion)
        grade_values = [g.grade for g in result.by_grade]
        assert 10 in grade_values
        assert 7 in grade_values

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_session_bunk_heatmap(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Bunk heatmap (session_bunk) should exclude 10th graders."""
        persons = {
            1: _make_person(1, grade=7),
            2: _make_person(2, grade=10),  # aged out
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2]]
        attendees_compare = [_make_attendee(1, compare_session)]
        bunk_assignments = [
            _make_bunk_assignment(1, base_session, "B-1"),
            _make_bunk_assignment(2, base_session, "B-1"),
        ]

        self._setup_repo(
            repo, base_session, compare_session, persons, attendees_base, attendees_compare, bunk_assignments
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # B-1 should have base_count=1 (only person 1)
        bunk = next((b for b in result.by_session_bunk if b.bunk == "B-1"), None)
        assert bunk is not None
        assert bunk.base_count == 1

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_session_flow(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Session flow (Sankey) should exclude 10th graders - they shouldn't appear in 'Did Not Return'."""
        persons = {
            1: _make_person(1, grade=7),
            2: _make_person(2, grade=10),  # aged out - should NOT appear as "Did Not Return"
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2]]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # The "Did Not Return" flow should NOT include person 2
        dnr_flow = [f for f in result.session_flow if f.target == "Did Not Return"]
        dnr_total = sum(f.value for f in dnr_flow)
        assert dnr_total == 0  # only person 1 returned, person 2 excluded entirely

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_prior_session_breakdown(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Prior session breakdown should exclude 10th graders."""
        persons = {
            1: _make_person(1, grade=7),
            2: _make_person(2, grade=10),  # aged out
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2]]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Prior session should only count person 1
        if result.by_prior_session:
            prior = result.by_prior_session[0]
            assert prior.base_count == 1

    @pytest.mark.asyncio
    async def test_overall_retention_rate_correct_after_exclusion(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Retention rate should be calculated from filtered base, not original."""
        persons = {
            1: _make_person(1, grade=7),
            2: _make_person(2, grade=10),  # aged out
            3: _make_person(3, grade=8),
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2, 3]]
        # Only person 1 returns (person 2 excluded, person 3 didn't return)
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Base = 2 (persons 1, 3), returned = 1 (person 1), rate = 50%
        assert result.base_year_total == 2
        assert result.returned_count == 1
        assert result.overall_retention_rate == pytest.approx(0.5)


class TestRetentionQuestAgedOut:
    """10th graders in quest sessions should also be excluded from retention."""

    @pytest.fixture
    def quest_session_base(self) -> Mock:
        return _make_session(1010, "Quest Adventure", "quest")

    @pytest.fixture
    def main_session_base(self) -> Mock:
        return _make_session(1001, "Session 2", "main")

    @pytest.fixture
    def compare_session(self) -> Mock:
        return _make_session(2001, "Session 2", "main", start_date="2026-06-15")

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup_repo_multi(
        self,
        repo: AsyncMock,
        sessions_base: dict[int, Mock],
        sessions_compare: dict[int, Mock],
        persons_base: dict[int, Mock],
        attendees_base: list[Mock],
        attendees_compare: list[Mock],
    ) -> None:
        """Wire up mock repository with multiple sessions."""
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: attendees_base if year == 2025 else attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: persons_base if year == 2025 else {})
        repo.fetch_bunk_assignments = AsyncMock(return_value=[])
        repo.fetch_sessions = AsyncMock(
            side_effect=lambda year, types: sessions_base if year == 2025 else sessions_compare
        )
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_quest_10th_graders_excluded_from_base_total(
        self, repo: AsyncMock, quest_session_base: Mock, compare_session: Mock
    ) -> None:
        """A quest-only 10th grader should be excluded from retention base."""
        persons = {
            1: _make_person(1, grade=10),  # aged out - quest only
            2: _make_person(2, grade=8),
        }
        attendees_base = [
            _make_attendee(1, quest_session_base),
            _make_attendee(2, quest_session_base),
        ]
        attendees_compare = [_make_attendee(2, compare_session)]

        self._setup_repo_multi(
            repo,
            {quest_session_base.cm_id: quest_session_base},
            {compare_session.cm_id: compare_session},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Person 1 (grade 10, quest) excluded: base=1, returned=1
        assert result.base_year_total == 1
        assert result.returned_count == 1
        assert result.aged_out_count == 1

    @pytest.mark.asyncio
    async def test_mixed_camp_quest_10th_grader_excluded(
        self,
        repo: AsyncMock,
        main_session_base: Mock,
        quest_session_base: Mock,
        compare_session: Mock,
    ) -> None:
        """A 10th grader in both camp + quest sessions should still be excluded."""
        persons = {
            1: _make_person(1, grade=10),  # aged out - in both main + quest
            2: _make_person(2, grade=7),
        }
        attendees_base = [
            _make_attendee(1, main_session_base),
            _make_attendee(1, quest_session_base),
            _make_attendee(2, main_session_base),
        ]
        attendees_compare = [_make_attendee(2, compare_session)]

        self._setup_repo_multi(
            repo,
            {main_session_base.cm_id: main_session_base, quest_session_base.cm_id: quest_session_base},
            {compare_session.cm_id: compare_session},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Person 1 (grade 10) excluded even though in main + quest
        assert result.base_year_total == 1
        assert result.returned_count == 1
        assert result.aged_out_count == 1

    @pytest.mark.asyncio
    async def test_quest_9th_graders_not_excluded(
        self, repo: AsyncMock, quest_session_base: Mock, compare_session: Mock
    ) -> None:
        """Quest 9th graders should NOT be excluded from retention."""
        persons = {
            1: _make_person(1, grade=9),
            2: _make_person(2, grade=9),
        }
        attendees_base = [
            _make_attendee(1, quest_session_base),
            _make_attendee(2, quest_session_base),
        ]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo_multi(
            repo,
            {quest_session_base.cm_id: quest_session_base},
            {compare_session.cm_id: compare_session},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        assert result.base_year_total == 2
        assert result.returned_count == 1
        assert result.aged_out_count == 0


class TestRetentionComparePoolFiltering:
    """Compare pool window-gates summer teen programs (SCIT/TLI).

    A teen session overlapping the summer window counts as "returned".
    A teen session outside the summer window (off-season) does NOT count.
    """

    @pytest.fixture
    def base_session(self) -> Mock:
        return _make_session(1001, "Session 2", "main")

    @pytest.fixture
    def compare_session_main(self) -> Mock:
        return _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")

    @pytest.fixture
    def compare_session_tli(self) -> Mock:
        # Overlaps the 2026 main window -> a summer teen program (gated IN).
        return _make_session(2099, "TLI", "tli", start_date="2026-06-20", end_date="2026-07-10")

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup_repo_multi(
        self,
        repo: AsyncMock,
        sessions_base: dict[int, Mock],
        sessions_compare: dict[int, Mock],
        persons_base: dict[int, Mock],
        attendees_base: list[Mock],
        attendees_compare: list[Mock],
        bunk_assignments: list[Mock] | None = None,
    ) -> None:
        """Wire up mock repository with multiple sessions."""
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: attendees_base if year == 2025 else attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: persons_base if year == 2025 else {})
        repo.fetch_bunk_assignments = AsyncMock(return_value=bunk_assignments or [])
        repo.fetch_sessions = AsyncMock(
            side_effect=lambda year, types: sessions_base if year == 2025 else sessions_compare
        )
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_tli_only_enrollment_counted_as_returned(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock, compare_session_tli: Mock
    ) -> None:
        """A 9th grader returning ONLY in a summer TLI now counts as returned (teens tracked)."""
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=8)}
        attendees_base = [_make_attendee(1, base_session), _make_attendee(2, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_tli)]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026)
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_summer_plus_tli_enrollment_counted_as_returned(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock, compare_session_tli: Mock
    ) -> None:
        """A 9th grader in both summer main + summer TLI counts as returned (unchanged)."""
        persons = {1: _make_person(1, grade=9)}
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_main), _make_attendee(1, compare_session_tli)]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026)
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_tli_returner_shows_as_flow_to_tli_not_dnr(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock, compare_session_tli: Mock
    ) -> None:
        """A 9th grader returning to summer TLI flows base->TLI in the Sankey (not 'Did Not Return')."""
        persons = {1: _make_person(1, grade=9)}
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_tli)]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026)
        dnr_flow = [f for f in result.session_flow if f.target == "Did Not Return"]
        assert sum(f.value for f in dnr_flow) == 0
        tli_flow = [f for f in result.session_flow if f.target == "TLI"]
        assert sum(f.value for f in tli_flow) == 1

    @pytest.mark.asyncio
    async def test_tli_returner_counted_in_heatmap(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock, compare_session_tli: Mock
    ) -> None:
        """Heatmap counts a base camper who returns to summer TLI as returned."""
        persons = {1: _make_person(1, grade=9)}
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_tli)]
        bunk_assignments = [_make_bunk_assignment(1, base_session, "B-1")]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
            bunk_assignments,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026)
        bunk = next((b for b in result.by_session_bunk if b.bunk == "B-1"), None)
        assert bunk is not None
        assert bunk.base_count == 1
        assert bunk.returned_count == 1

    @pytest.mark.asyncio
    async def test_tli_returner_counted_in_prior_session(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock, compare_session_tli: Mock
    ) -> None:
        """Prior-session chart counts a base camper who returns to summer TLI as returned."""
        persons = {1: _make_person(1, grade=9)}
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_tli)]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026)
        assert result.by_prior_session, "expected a prior-session row"
        prior = result.by_prior_session[0]
        assert prior.base_count == 1
        assert prior.returned_count == 1

    @pytest.mark.asyncio
    async def test_prior_session_breakdown_respects_session_types_scope(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock
    ) -> None:
        """Prior-session chart shows ONLY the user's selected session types (dropdown scoping)."""
        base_quest = _make_session(1010, "Quest Adventure", "quest")
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=9)}
        attendees_base = [_make_attendee(1, base_session), _make_attendee(2, base_quest)]
        attendees_compare = [
            _make_attendee(1, compare_session_main),
            _make_attendee(2, compare_session_main),
        ]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session, base_quest.cm_id: base_quest},
            {compare_session_main.cm_id: compare_session_main},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026, session_types=["main"])
        prior_names = {p.prior_session for p in result.by_prior_session}
        assert prior_names == {"Session 2"}  # quest excluded by the session_types scope

    @pytest.mark.asyncio
    async def test_offseason_teen_return_not_counted(
        self, repo: AsyncMock, base_session: Mock, compare_session_main: Mock
    ) -> None:
        """A return into a fall Family-Camp CIT (scit, outside summer window) does NOT count."""
        fall_cit = _make_session(2098, "Family Camp 5 CIT", "scit", start_date="2026-09-12", end_date="2026-09-15")
        persons = {1: _make_person(1, grade=9)}
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, fall_cit)]
        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, fall_cit.cm_id: fall_cit},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026)
        assert result.returned_count == 0


class TestRetentionTeenPipeline:
    """The include_teen_pipeline flag credits the grade-10 -> teen bridge,
    and teen-scope retention tracks grade-11 (aged out only at grade 12)."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup(
        self,
        repo: AsyncMock,
        sessions_base: dict[int, Mock],
        sessions_compare: dict[int, Mock],
        persons_base: dict[int, Mock],
        attendees_base: list[Mock],
        attendees_compare: list[Mock],
    ) -> None:
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: attendees_base if year == 2025 else attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: persons_base if year == 2025 else {})
        repo.fetch_bunk_assignments = AsyncMock(return_value=[])
        repo.fetch_sessions = AsyncMock(
            side_effect=lambda year, types: sessions_base if year == 2025 else sessions_compare
        )
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_grade_10_aged_out_when_flag_off(self, repo: AsyncMock) -> None:
        """Flag OFF (legacy): a grade-10 main camper who returns only to a teen program is aged out."""
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_scit = _make_session(2002, "SCIT", "scit", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=10), 2: _make_person(2, grade=8)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_scit), _make_attendee(2, compare_main)]
        self._setup(
            repo,
            {base_main.cm_id: base_main},
            {compare_main.cm_id: compare_main, compare_scit.cm_id: compare_scit},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026, include_teen_pipeline=False)
        assert result.aged_out_count == 1
        assert result.base_year_total == 1
        assert result.returned_count == 1  # person 2 (grade 8) returned to compare main

    @pytest.mark.asyncio
    async def test_grade_10_bridge_credited_when_flag_on(self, repo: AsyncMock) -> None:
        """Flag ON: the same grade-10 camper is kept and credited for continuing to SCIT."""
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_scit = _make_session(2002, "SCIT", "scit", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=10), 2: _make_person(2, grade=8)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_scit), _make_attendee(2, compare_main)]
        self._setup(
            repo,
            {base_main.cm_id: base_main},
            {compare_main.cm_id: compare_main, compare_scit.cm_id: compare_scit},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026, include_teen_pipeline=True)
        assert result.aged_out_count == 0
        assert result.base_year_total == 2  # grade-10 person kept
        assert result.returned_count == 2  # both returned (person 1 -> SCIT)

    @pytest.mark.asyncio
    async def test_teen_scope_tracks_grade_11_ages_out_grade_12(self, repo: AsyncMock) -> None:
        """Teen-scope (base = summer teens): grade-11 tracked (SCIT->TLI), grade-12 aged out."""
        base_scit = _make_session(1002, "SCIT", "scit", start_date="2025-06-15", end_date="2025-07-05")
        compare_tli = _make_session(2003, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        persons = {
            1: _make_person(1, grade=11),  # SCIT -> TLI, tracked + returns
            2: _make_person(2, grade=12),  # graduating, aged out
        }
        attendees_base = [_make_attendee(1, base_scit), _make_attendee(2, base_scit)]
        attendees_compare = [_make_attendee(1, compare_tli)]
        self._setup(
            repo,
            # base year needs a main session so the base summer-window exists to gate base SCIT
            {base_scit.cm_id: base_scit, 1001: _make_session(1001, "Session 2", "main")},
            {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        result = await RetentionService(repo).calculate_retention(2025, 2026, session_types=["scit", "tli"])
        assert result.aged_out_count == 1  # grade-12 aged out
        assert result.base_year_total == 1  # only grade-11 remains
        assert result.returned_count == 1  # grade-11 returned to TLI

    @pytest.mark.asyncio
    async def test_main_quest_numbers_unchanged_by_flag(self, repo: AsyncMock) -> None:
        """Flag ON vs OFF leaves main+quest retention identical (no grade-11 in main/quest)."""
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=8), 2: _make_person(2, grade=9)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_main)]
        sessions_base = {base_main.cm_id: base_main}
        sessions_compare = {compare_main.cm_id: compare_main}
        self._setup(repo, sessions_base, sessions_compare, persons, attendees_base, attendees_compare)
        off = await RetentionService(repo).calculate_retention(
            2025, 2026, session_types=["main", "quest"], include_teen_pipeline=False
        )
        self._setup(repo, sessions_base, sessions_compare, persons, attendees_base, attendees_compare)
        on = await RetentionService(repo).calculate_retention(
            2025, 2026, session_types=["main", "quest"], include_teen_pipeline=True
        )
        assert (off.base_year_total, off.returned_count, off.aged_out_count) == (
            on.base_year_total,
            on.returned_count,
            on.aged_out_count,
        )


class TestRetentionFlagCarveOuts:
    """by_grade always shows grade-10; 'by 2026 session' hides TLI when flag off."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup(
        self,
        repo: AsyncMock,
        sessions_base: dict[int, Mock],
        sessions_compare: dict[int, Mock],
        persons_base: dict[int, Mock],
        attendees_base: list[Mock],
        attendees_compare: list[Mock],
    ) -> None:
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, *a, **kw: attendees_base if year == 2025 else attendees_compare
        )
        repo.fetch_persons = AsyncMock(side_effect=lambda year: persons_base if year == 2025 else {})
        repo.fetch_bunk_assignments = AsyncMock(return_value=[])
        repo.fetch_sessions = AsyncMock(
            side_effect=lambda year, types: sessions_base if year == 2025 else sessions_compare
        )
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_grade_10_row_always_present_in_by_grade(self, repo: AsyncMock) -> None:
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_tli = _make_session(2099, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=10)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_main), _make_attendee(2, compare_tli)]
        sessions_compare = {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli}
        for flag in (False, True):
            self._setup(
                repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare
            )
            result = await RetentionService(repo).calculate_retention(2025, 2026, include_teen_pipeline=flag)
            grades = {g.grade for g in result.by_grade}
            assert 10 in grades, f"grade-10 row missing when flag={flag}"
            assert 9 in grades
            row10 = next(g for g in result.by_grade if g.grade == 10)
            assert row10.base_count == 1
            assert row10.returned_count == 1

    @pytest.mark.asyncio
    async def test_grade_10_excluded_from_overall_rate_when_flag_off(self, repo: AsyncMock) -> None:
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_tli = _make_session(2099, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=10)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_main), _make_attendee(2, compare_tli)]
        sessions_compare = {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli}
        self._setup(repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare)
        result = await RetentionService(repo).calculate_retention(2025, 2026, include_teen_pipeline=False)
        assert result.base_year_total == 1
        assert result.aged_out_count == 1

    @pytest.mark.asyncio
    async def test_by_2026_session_hides_tli_when_flag_off_shows_when_on(self, repo: AsyncMock) -> None:
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_tli = _make_session(2099, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=10)}
        attendees_base = [_make_attendee(1, base_main)]
        attendees_compare = [_make_attendee(1, compare_tli)]
        sessions_compare = {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli}
        self._setup(repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare)
        off = await RetentionService(repo).calculate_retention(2025, 2026, include_teen_pipeline=False)
        assert "TLI" not in {s.session_name for s in off.by_session}
        self._setup(repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare)
        on = await RetentionService(repo).calculate_retention(2025, 2026, include_teen_pipeline=True)
        tli_row = next((s for s in on.by_session if s.session_name == "TLI"), None)
        assert tli_row is not None
        assert tli_row.base_count == 1
        assert tli_row.returned_count == 1

    @pytest.mark.asyncio
    async def test_by_2026_session_scit_shown_regardless_of_flag(self, repo: AsyncMock) -> None:
        base_tli = _make_session(1002, "TLI", "tli", start_date="2025-06-15", end_date="2025-07-05")
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_scit = _make_session(2002, "SCIT", "scit", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=11)}
        attendees_base = [_make_attendee(1, base_tli)]
        attendees_compare = [_make_attendee(1, compare_scit)]
        sessions_base = {base_main.cm_id: base_main, base_tli.cm_id: base_tli}
        sessions_compare = {compare_main.cm_id: compare_main, compare_scit.cm_id: compare_scit}
        for flag in (False, True):
            self._setup(repo, sessions_base, sessions_compare, persons, attendees_base, attendees_compare)
            result = await RetentionService(repo).calculate_retention(
                2025, 2026, session_types=["scit", "tli"], include_teen_pipeline=flag
            )
            assert "SCIT" in {s.session_name for s in result.by_session}, f"SCIT missing when flag={flag}"

    @pytest.mark.asyncio
    async def test_grade_10_row_hidden_in_nonteen_scope(self, repo: AsyncMock) -> None:
        """At Camp / Quests scope: no teen destination, so grade-10 must NOT appear in by_grade."""
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_tli = _make_session(2099, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=10)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_main), _make_attendee(2, compare_tli)]
        sessions_compare = {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli}
        for flag in (False, True):
            self._setup(
                repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare
            )
            result = await RetentionService(repo).calculate_retention(
                2025, 2026, session_types=["main", "embedded", "ag", "quest"], include_teen_pipeline=flag
            )
            grades = {g.grade for g in result.by_grade}
            assert 10 not in grades, f"grade-10 must be hidden in non-teen scope (flag={flag})"
            assert 9 in grades

    @pytest.mark.asyncio
    async def test_grade_10_row_shown_in_allsummer_scope(self, repo: AsyncMock) -> None:
        """All Summer scope (session_types includes scit/tli): grade-10 row IS shown."""
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_tli = _make_session(2099, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=10)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_main), _make_attendee(2, compare_tli)]
        sessions_compare = {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli}
        self._setup(repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare)
        result = await RetentionService(repo).calculate_retention(
            2025, 2026, session_types=["main", "embedded", "ag", "quest", "scit", "tli"], include_teen_pipeline=False
        )
        assert 10 in {g.grade for g in result.by_grade}

    @pytest.mark.asyncio
    async def test_flag_inert_in_nonteen_scope(self, repo: AsyncMock) -> None:
        """In a non-teen scope, toggling the flag does nothing (grade-10 always aged out)."""
        base_main = _make_session(1001, "Session 2", "main")
        compare_main = _make_session(2001, "Session 2", "main", start_date="2026-06-15", end_date="2026-07-05")
        compare_tli = _make_session(2099, "TLI", "tli", start_date="2026-06-15", end_date="2026-07-05")
        persons = {1: _make_person(1, grade=9), 2: _make_person(2, grade=10)}
        attendees_base = [_make_attendee(1, base_main), _make_attendee(2, base_main)]
        attendees_compare = [_make_attendee(1, compare_main), _make_attendee(2, compare_tli)]
        sessions_compare = {compare_main.cm_id: compare_main, compare_tli.cm_id: compare_tli}
        self._setup(repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare)
        off = await RetentionService(repo).calculate_retention(
            2025, 2026, session_types=["main", "quest"], include_teen_pipeline=False
        )
        self._setup(repo, {base_main.cm_id: base_main}, sessions_compare, persons, attendees_base, attendees_compare)
        on = await RetentionService(repo).calculate_retention(
            2025, 2026, session_types=["main", "quest"], include_teen_pipeline=True
        )
        assert (off.base_year_total, off.aged_out_count) == (on.base_year_total, on.aged_out_count)
        assert off.aged_out_count == 1  # the grade-10 is aged out in both
