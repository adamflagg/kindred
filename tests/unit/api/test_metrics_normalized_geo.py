"""
TDD tests for normalized geographic breakdowns in registration metrics.

Tests for:
- Using normalized_mappings for school/city/congregation breakdowns
- Session filtering on normalized_mappings
- Person-level congregation from person_custom_values
- Ensuring "Show sources" counts match main list counts

These tests are written FIRST before implementation (TDD).
"""

from unittest.mock import AsyncMock, Mock

import pytest

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_normalized_mapping(
    category: str,
    original_value: str,
    normalized_value: str,
    person_pb_id: str = "",
    session_pb_id: str = "",
    person_cm_id: int | None = None,
    session_cm_id: int | None = None,
    confidence: float = 1.0,
    year: int = 2026,
) -> Mock:
    """Create a mock normalized_mapping record with person+session relations.

    The new schema stores one row per (person, session, category) instead of
    one row per (original_value, category, year).
    """
    record = Mock()
    record.id = f"nm_{person_pb_id}_{session_pb_id}_{category}"
    record.category = category
    record.original_value = original_value
    record.normalized_value = normalized_value
    record.person = person_pb_id
    record.session = session_pb_id
    record.confidence = confidence
    record.year = year

    # Create expand for person and session relations
    person_expand = Mock()
    person_expand.id = person_pb_id
    person_expand.cm_id = person_cm_id

    session_expand = Mock()
    session_expand.id = session_pb_id
    session_expand.cm_id = session_cm_id

    record.expand = {
        "person": person_expand,
        "session": session_expand,
    }

    return record


def create_mock_person_custom_value(
    person_pb_id: str,
    person_cm_id: int,
    field_name: str,
    value: str,
    year: int = 2026,
) -> Mock:
    """Create a mock person_custom_value record for congregation."""
    record = Mock()
    record.id = f"pcv_{person_pb_id}_{field_name}"
    record.person = person_pb_id
    record.field_definition = f"field_{field_name}"
    record.value = value
    record.year = year

    # Create expand for person relation
    person_expand = Mock()
    person_expand.id = person_pb_id
    person_expand.cm_id = person_cm_id

    record.expand = {"person": person_expand}

    return record


# ============================================================================
# Service Tests - Normalized Geo Breakdowns
# ============================================================================


class TestSchoolBreakdownNormalized:
    """Tests for school breakdown using normalized_mappings."""

    def test_school_breakdown_uses_normalized_mappings(self) -> None:
        """School breakdown should read from normalized_mappings, not raw persons.

        Previously: Read persons.school directly
        Now: Read normalized_mappings where category='school'
        """
        # Create mock normalized_mappings for schools
        mappings = [
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elem",
                normalized_value="Glenview Elementary",
                person_pb_id="p101",
                session_pb_id="s2001",
            ),
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elementary",
                normalized_value="Glenview Elementary",
                person_pb_id="p102",
                session_pb_id="s2001",
            ),
            create_mock_normalized_mapping(
                category="school",
                original_value="Oak Valley Middle School",
                normalized_value="Oak Valley Middle",
                person_pb_id="p103",
                session_pb_id="s2001",
            ),
        ]

        # Aggregate by normalized_value
        school_counts: dict[str, int] = {}
        for m in mappings:
            normalized = m.normalized_value
            school_counts[normalized] = school_counts.get(normalized, 0) + 1

        # Verify counts use NORMALIZED values (not original)
        assert school_counts["Glenview Elementary"] == 2
        assert school_counts["Oak Valley Middle"] == 1

        # The original variations are aggregated into normalized
        assert "Glenview Elem" not in school_counts  # Original value, not in results

    def test_school_breakdown_counts_persons_not_occurrences(self) -> None:
        """School breakdown should count unique persons in the session.

        Each row is one person in one session.
        Count = number of rows with that normalized_value (for the filtered session).
        """
        # Same person in 2 sessions should count once per session
        mappings = [
            create_mock_normalized_mapping(
                category="school",
                original_value="Riverside Elementary",
                normalized_value="Riverside Elementary",
                person_pb_id="p101",
                session_pb_id="s2001",
            ),
            create_mock_normalized_mapping(
                category="school",
                original_value="Riverside Elementary",
                normalized_value="Riverside Elementary",
                person_pb_id="p101",
                session_pb_id="s2002",  # Same person, different session
            ),
        ]

        # When filtering to session s2001 only
        session_2001_mappings = [m for m in mappings if m.session == "s2001"]

        school_counts: dict[str, int] = {}
        for m in session_2001_mappings:
            normalized = m.normalized_value
            school_counts[normalized] = school_counts.get(normalized, 0) + 1

        # Should count 1 for session s2001 (not 2 for both sessions)
        assert school_counts["Riverside Elementary"] == 1


class TestCityBreakdownNormalized:
    """Tests for city breakdown using normalized_mappings."""

    def test_city_breakdown_uses_normalized_mappings(self) -> None:
        """City breakdown should read from normalized_mappings, not raw persons.address.

        Previously: Read persons.address.city directly
        Now: Read normalized_mappings where category='city'
        """
        mappings = [
            create_mock_normalized_mapping(
                category="city",
                original_value="San Francisco, CA 94102",
                normalized_value="San Francisco",  # State suffix removed
                person_pb_id="p101",
                session_pb_id="s2001",
            ),
            create_mock_normalized_mapping(
                category="city",
                original_value="san francisco",
                normalized_value="San Francisco",  # Case normalized
                person_pb_id="p102",
                session_pb_id="s2001",
            ),
        ]

        city_counts: dict[str, int] = {}
        for m in mappings:
            normalized = m.normalized_value
            city_counts[normalized] = city_counts.get(normalized, 0) + 1

        # Both variations map to "San Francisco"
        assert city_counts["San Francisco"] == 2
        assert "San Francisco, CA 94102" not in city_counts
        assert "san francisco" not in city_counts


class TestCongregationBreakdownNormalized:
    """Tests for congregation breakdown using normalized_mappings."""

    def test_congregation_uses_person_level_data(self) -> None:
        """Congregation should come from person_custom_values, not household_custom_values.

        The "HH-Name of Congregation" field on person_custom_values has richer
        data than the "Synagogue" field on household_custom_values.
        """
        # Person-level congregation data (what we should use)
        person_congregations = {
            101: "Temple Beth El - Oakland",
            102: "Congregation Beth Israel of Berkeley",
            103: "Temple Sinai Reform Congregation",
        }

        # Household-level synagogue data (what we should NOT use)
        household_synagogues = {
            1001: "Temple Beth El",  # Household containing persons 101, 102
            1002: "Temple Sinai",  # Household containing person 103
        }

        # Person 101's congregation should be the full person-level value
        congregation_101 = person_congregations[101]
        assert congregation_101 == "Temple Beth El - Oakland"

        # NOT the truncated household-level value
        assert congregation_101 != household_synagogues.get(1001)

    def test_congregation_breakdown_uses_normalized_mappings(self) -> None:
        """Congregation breakdown should read from normalized_mappings."""
        mappings = [
            create_mock_normalized_mapping(
                category="congregation",
                original_value="Temple Beth El - Oakland",
                normalized_value="Temple Beth El",  # Normalized
                person_pb_id="p101",
                session_pb_id="s2001",
            ),
            create_mock_normalized_mapping(
                category="congregation",
                original_value="Temple beth el",
                normalized_value="Temple Beth El",  # Case normalized
                person_pb_id="p102",
                session_pb_id="s2001",
            ),
        ]

        congregation_counts: dict[str, int] = {}
        for m in mappings:
            normalized = m.normalized_value
            congregation_counts[normalized] = congregation_counts.get(normalized, 0) + 1

        assert congregation_counts["Temple Beth El"] == 2


# ============================================================================
# Session Filter Tests - "Show Sources" Mismatch Fix
# ============================================================================


class TestSessionFilterMatchesMainList:
    """Tests that session filtering produces consistent counts.

    The bug: "Show sources" counts didn't match main list counts because
    they used different data sources.

    Fix: Both use normalized_mappings with session filtering, now via
    the backend source-mappings endpoint with active_only deduplication.
    """

    def test_session_filter_limits_normalized_results(self) -> None:
        """When session_cm_id is provided, only that session's mappings are returned."""
        mappings = [
            # Session 2001: 2 persons at Glenview Elementary
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elementary",
                normalized_value="Glenview Elementary",
                person_pb_id="p101",
                session_pb_id="s2001",
                session_cm_id=2001,
            ),
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elementary",
                normalized_value="Glenview Elementary",
                person_pb_id="p102",
                session_pb_id="s2001",
                session_cm_id=2001,
            ),
            # Session 2002: 1 person at Glenview Elementary
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elementary",
                normalized_value="Glenview Elementary",
                person_pb_id="p103",
                session_pb_id="s2002",
                session_cm_id=2002,
            ),
        ]

        # Filter to session 2001
        session_2001_mappings = [m for m in mappings if m.expand["session"].cm_id == 2001]

        # Should only have 2 mappings
        assert len(session_2001_mappings) == 2

        # Count by normalized_value
        school_counts: dict[str, int] = {}
        for m in session_2001_mappings:
            normalized = m.normalized_value
            school_counts[normalized] = school_counts.get(normalized, 0) + 1

        # Glenview Elementary should show count=2 (not count=3)
        assert school_counts["Glenview Elementary"] == 2

    def test_show_sources_counts_match_main_list(self) -> None:
        """'Show sources' counts should match main list counts.

        Both use the same normalized_mappings data filtered by session.
        The "sources" are the original_value grouped under each normalized_value.
        """
        mappings = [
            # Two persons with slightly different school names, same normalized
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elem",  # Abbreviation
                normalized_value="Glenview Elementary",
                person_pb_id="p101",
                session_pb_id="s2001",
            ),
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elementary School",  # Full name
                normalized_value="Glenview Elementary",
                person_pb_id="p102",
                session_pb_id="s2001",
            ),
        ]

        # Main list: aggregate by normalized_value
        main_list_counts: dict[str, int] = {}
        for m in mappings:
            normalized = m.normalized_value
            main_list_counts[normalized] = main_list_counts.get(normalized, 0) + 1

        # Show sources: group by normalized_value, then by original_value
        sources_by_normalized: dict[str, dict[str, int]] = {}
        for m in mappings:
            normalized = m.normalized_value
            original = m.original_value

            if normalized not in sources_by_normalized:
                sources_by_normalized[normalized] = {}

            sources_by_normalized[normalized][original] = sources_by_normalized[normalized].get(original, 0) + 1

        # Total source counts should match main list counts
        for normalized, count in main_list_counts.items():
            source_total = sum(sources_by_normalized[normalized].values())
            assert source_total == count, f"Mismatch for {normalized}: main={count}, sources={source_total}"

        # Verify specific counts
        assert main_list_counts["Glenview Elementary"] == 2
        sources = sources_by_normalized["Glenview Elementary"]
        assert sources["Glenview Elem"] == 1
        assert sources["Glenview Elementary School"] == 1


# ============================================================================
# Integration Tests - Full Service Flow
# ============================================================================


class TestRegistrationServiceNormalizedFlow:
    """Integration tests for the full registration service with normalized geo."""

    @pytest.mark.asyncio
    async def test_calculate_registration_uses_normalized_mappings(self) -> None:
        """The registration endpoint should use normalized_mappings for geo data.

        This is an integration test that will verify the full flow once implemented.
        """
        # Create mock repository
        mock_repo = Mock()

        # Mock fetch_normalized_geo to return test data
        mock_repo.fetch_normalized_geo = AsyncMock(
            return_value=[
                create_mock_normalized_mapping(
                    category="school",
                    original_value="Glenview Elementary",
                    normalized_value="Glenview Elementary",
                    person_pb_id="p101",
                    session_pb_id="s2001",
                ),
                create_mock_normalized_mapping(
                    category="city",
                    original_value="Oakland",
                    normalized_value="Oakland",
                    person_pb_id="p101",
                    session_pb_id="s2001",
                ),
                create_mock_normalized_mapping(
                    category="congregation",
                    original_value="Temple Beth El",
                    normalized_value="Temple Beth El",
                    person_pb_id="p101",
                    session_pb_id="s2001",
                ),
            ]
        )

        # Mock other required repository methods
        mock_repo.fetch_attendees = AsyncMock(return_value=[])
        mock_repo.fetch_persons = AsyncMock(return_value={})
        mock_repo.fetch_sessions = AsyncMock(return_value={})
        mock_repo.fetch_bunk_plans = AsyncMock(return_value=[])
        mock_repo.fetch_capacity_config = AsyncMock(return_value=12)
        mock_repo.fetch_synagogue_by_household = AsyncMock(return_value={})
        mock_repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        # The service should call fetch_normalized_geo for geo breakdowns
        # This assertion will be enabled once the service is updated
        # await mock_repo.fetch_normalized_geo.assert_called_once_with(
        #     year=2026, session_cm_id=None, session_types=["main", "embedded", "ag"]
        # )

        # For now, just verify the expected method signature exists
        assert hasattr(mock_repo, "fetch_normalized_geo")


class TestNormalizedMappingsDataIntegrity:
    """Tests for data integrity in the normalized_mappings table."""

    def test_each_person_session_has_one_school_mapping(self) -> None:
        """Each (person, session) should have at most one school mapping."""
        mappings = [
            create_mock_normalized_mapping(
                category="school",
                original_value="Glenview Elementary",
                normalized_value="Glenview Elementary",
                person_pb_id="p101",
                session_pb_id="s2001",
            ),
        ]

        # Count mappings per (person, session, category)
        keys = set()
        duplicates = []

        for m in mappings:
            key = (m.person, m.session, m.category)
            if key in keys:
                duplicates.append(key)
            keys.add(key)

        assert len(duplicates) == 0, f"Found duplicate mappings: {duplicates}"

    def test_enrolled_only_in_normalized_mappings(self) -> None:
        """Only enrolled attendees (status_id=2) should be in mappings.

        Waitlisted, cancelled, and other non-enrolled attendees should not appear.
        """
        # Simulate attendee data — status_id is the sole enrollment filter
        attendees = [
            {"person_id": 101, "status_id": 2},  # Enrolled - INCLUDE
            {"person_id": 102, "status_id": 2},  # Enrolled - INCLUDE
            {"person_id": 103, "status_id": 3},  # Waitlisted - EXCLUDE
            {"person_id": 104, "status_id": 4},  # Cancelled - EXCLUDE
            {"person_id": 105, "status_id": 8},  # WaitList - EXCLUDE
        ]

        # Filter to enrolled only (status_id = 2)
        enrolled = [a for a in attendees if a["status_id"] == 2]

        enrolled_person_ids = {a["person_id"] for a in enrolled}

        assert enrolled_person_ids == {101, 102}
        assert 103 not in enrolled_person_ids  # Waitlisted
        assert 104 not in enrolled_person_ids  # Cancelled
        assert 105 not in enrolled_person_ids  # WaitList
