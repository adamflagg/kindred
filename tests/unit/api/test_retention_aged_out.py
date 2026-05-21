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
) -> Mock:
    s = Mock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = parent_id
    s.start_date = start_date
    s.end_date = "2025-07-05"
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
    async def test_10th_graders_excluded_from_grade_breakdown(
        self, repo: AsyncMock, base_session: Mock, compare_session: Mock
    ) -> None:
        """Grade breakdown should not include 10th graders."""
        persons = {
            1: _make_person(1, grade=7),
            2: _make_person(2, grade=10),  # aged out
        }
        attendees_base = [_make_attendee(pid, base_session) for pid in [1, 2]]
        attendees_compare = [_make_attendee(1, compare_session)]

        self._setup_repo(repo, base_session, compare_session, persons, attendees_base, attendees_compare)
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Grade 10 should not appear in grade breakdown
        grade_values = [g.grade for g in result.by_grade]
        assert 10 not in grade_values
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
    """Compare pool should only count summer session enrollments.

    Non-summer sessions (TLI, family, training) should not count as "returned"
    in the heatmap, Sankey, or prior session charts.
    """

    @pytest.fixture
    def base_session(self) -> Mock:
        return _make_session(1001, "Session 2", "main")

    @pytest.fixture
    def compare_session_main(self) -> Mock:
        return _make_session(2001, "Session 2", "main", start_date="2026-06-15")

    @pytest.fixture
    def compare_session_tli(self) -> Mock:
        return _make_session(2099, "TLI", "tli", start_date="2026-06-01")

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
    async def test_tli_only_enrollment_not_counted_as_returned(
        self, repo: AsyncMock, base_session: Mock, compare_session_tli: Mock
    ) -> None:
        """A 9th grader enrolled ONLY in TLI for compare year should NOT count as returned."""
        persons = {
            1: _make_person(1, grade=9),
            2: _make_person(2, grade=8),
        }
        attendees_base = [
            _make_attendee(1, base_session),
            _make_attendee(2, base_session),
        ]
        # Person 1 only in TLI next year, person 2 not enrolled at all
        attendees_compare = [_make_attendee(1, compare_session_tli)]

        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Person 1's TLI enrollment should NOT count as "returned"
        assert result.returned_count == 0

    @pytest.mark.asyncio
    async def test_summer_plus_tli_enrollment_counted_as_returned(
        self,
        repo: AsyncMock,
        base_session: Mock,
        compare_session_main: Mock,
        compare_session_tli: Mock,
    ) -> None:
        """A 9th grader in both summer + TLI should count as returned (from summer)."""
        persons = {
            1: _make_person(1, grade=9),
        }
        attendees_base = [_make_attendee(1, base_session)]
        # Person 1 in both summer and TLI next year
        attendees_compare = [
            _make_attendee(1, compare_session_main),
            _make_attendee(1, compare_session_tli),
        ]

        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_main.cm_id: compare_session_main, compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Person 1 returned via summer enrollment
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_tli_only_returner_shows_as_did_not_return_in_sankey(
        self, repo: AsyncMock, base_session: Mock, compare_session_tli: Mock
    ) -> None:
        """A 9th grader who only enrolled in TLI should appear as 'Did Not Return' in Sankey."""
        persons = {
            1: _make_person(1, grade=9),
        }
        attendees_base = [_make_attendee(1, base_session)]
        # Person 1 only in TLI next year
        attendees_compare = [_make_attendee(1, compare_session_tli)]

        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Person 1 should show as "Did Not Return" since TLI doesn't count
        dnr_flow = [f for f in result.session_flow if f.target == "Did Not Return"]
        assert len(dnr_flow) == 1
        assert dnr_flow[0].value == 1

    @pytest.mark.asyncio
    async def test_tli_only_not_counted_in_heatmap(
        self, repo: AsyncMock, base_session: Mock, compare_session_tli: Mock
    ) -> None:
        """Heatmap should not count TLI-only enrollment as returned."""
        persons = {
            1: _make_person(1, grade=9),
        }
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_tli)]
        bunk_assignments = [_make_bunk_assignment(1, base_session, "B-1")]

        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
            bunk_assignments,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Heatmap: person 1 in B-1 but NOT returned (TLI doesn't count)
        bunk = next((b for b in result.by_session_bunk if b.bunk == "B-1"), None)
        assert bunk is not None
        assert bunk.base_count == 1
        assert bunk.returned_count == 0

    @pytest.mark.asyncio
    async def test_tli_only_not_counted_in_prior_session(
        self, repo: AsyncMock, base_session: Mock, compare_session_tli: Mock
    ) -> None:
        """Prior session chart should not count TLI-only enrollment as returned."""
        persons = {
            1: _make_person(1, grade=9),
        }
        attendees_base = [_make_attendee(1, base_session)]
        attendees_compare = [_make_attendee(1, compare_session_tli)]

        self._setup_repo_multi(
            repo,
            {base_session.cm_id: base_session},
            {compare_session_tli.cm_id: compare_session_tli},
            persons,
            attendees_base,
            attendees_compare,
        )
        svc = RetentionService(repo)
        result = await svc.calculate_retention(2025, 2026)

        # Prior session: person 1 in base but NOT returned via summer
        if result.by_prior_session:
            prior = result.by_prior_session[0]
            assert prior.base_count == 1
            assert prior.returned_count == 0
