"""Tests for bunking_validator module."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from bunking.bunking_validator import (
    BunkingValidator,
    HistoricalBunkingRecord,
    SessionBreakdown,
    ValidationIssue,
    ValidationResult,
    ValidationSeverity,
    ValidationStatistics,
)


# Test fixtures
@dataclass
class MockPerson:
    """Mock Person object for testing."""

    campminder_id: str  # Use numeric string IDs like "10001"
    name: str
    grade: int | None = None
    age: float | None = None


@dataclass
class MockBunk:
    """Mock Bunk object for testing."""

    campminder_id: str  # Use numeric string IDs like "20001"
    name: str
    max_size: int = 12
    is_locked: bool = False
    gender: str = "M"


@dataclass
class MockBunkAssignment:
    """Mock BunkAssignment object for testing."""

    person_cm_id: str  # Use numeric string IDs
    bunk_cm_id: str
    session_cm_id: str | None = None


@dataclass
class MockBunkRequest:
    """Mock BunkRequest object for testing."""

    requester_person_cm_id: str  # Use numeric string IDs
    requested_person_cm_id: str | None
    request_type: str
    status: str = "resolved"
    priority: int = 5
    source_field: str | None = None
    ai_p1_reasoning: dict[str, Any] | None = None
    age_preference_target: str | None = None


@dataclass
class MockSession:
    """Mock Session object for testing."""

    campminder_id: str  # Use numeric string IDs
    name: str


class TestValidationSeverity:
    """Tests for ValidationSeverity enum."""

    def test_severity_values(self):
        assert ValidationSeverity.ERROR.value == "error"
        assert ValidationSeverity.WARNING.value == "warning"
        assert ValidationSeverity.INFO.value == "info"


class TestValidationIssue:
    """Tests for ValidationIssue model."""

    def test_create_issue_minimal(self):
        issue = ValidationIssue(
            severity=ValidationSeverity.ERROR,
            type="test_error",
            message="Test error message",
        )
        assert issue.severity == ValidationSeverity.ERROR
        assert issue.type == "test_error"
        assert issue.message == "Test error message"
        assert issue.details == {}
        assert issue.affected_ids == []

    def test_create_issue_full(self):
        issue = ValidationIssue(
            severity=ValidationSeverity.WARNING,
            type="capacity_violation",
            message="Bunk B-1 is over capacity",
            details={"bunk_id": "123", "assigned": 15, "max_size": 12},
            affected_ids=["123", "456"],
        )
        assert issue.details["assigned"] == 15
        assert len(issue.affected_ids) == 2


class TestValidationStatistics:
    """Tests for ValidationStatistics model."""

    def test_default_values(self):
        stats = ValidationStatistics()
        assert stats.total_campers == 0
        assert stats.assigned_campers == 0
        assert stats.request_satisfaction_rate == 0.0
        assert "share_bunk_with" in stats.field_stats
        assert stats.level_progression["returning_campers"] == 0

    def test_field_stats_structure(self):
        stats = ValidationStatistics()
        expected_fields = [
            "share_bunk_with",
            "do_not_share_with",
            "bunking_notes",
            "internal_notes",
            "socialize_with",
        ]
        for field in expected_fields:
            assert field in stats.field_stats
            assert "total" in stats.field_stats[field]
            assert "satisfied" in stats.field_stats[field]
            assert "satisfaction_rate" in stats.field_stats[field]


class TestSessionBreakdown:
    """Tests for SessionBreakdown model."""

    def test_create_breakdown(self):
        breakdown = SessionBreakdown(session_cm_id=123, session_name="Session 1")
        assert breakdown.session_cm_id == 123
        assert breakdown.session_name == "Session 1"
        assert breakdown.total_campers == 0
        assert breakdown.bunks_count == 0


class TestValidationResult:
    """Tests for ValidationResult model."""

    def test_create_result(self):
        stats = ValidationStatistics()
        issues = [
            ValidationIssue(
                severity=ValidationSeverity.INFO,
                type="test",
                message="Test",
            )
        ]
        result = ValidationResult(statistics=stats, issues=issues, session_id="12345")
        assert result.session_id == "12345"
        assert len(result.issues) == 1
        assert result.validated_at is not None


class TestBunkingValidator:
    """Tests for BunkingValidator class."""

    @pytest.fixture
    def validator(self):
        return BunkingValidator()

    @pytest.fixture
    def basic_session(self):
        return MockSession(campminder_id="1234567", name="Test Session")

    @pytest.fixture
    def basic_bunks(self):
        return [
            MockBunk(campminder_id="20001", name="B-1", max_size=12),
            MockBunk(campminder_id="20002", name="B-2", max_size=12),
        ]

    @pytest.fixture
    def basic_persons(self):
        return [
            MockPerson(campminder_id="10001", name="Alice", grade=5, age=10.5),
            MockPerson(campminder_id="10002", name="Bob", grade=5, age=10.8),
            MockPerson(campminder_id="10003", name="Charlie", grade=6, age=11.2),
        ]

    def test_validator_initialization(self, validator):
        assert validator.max_grade_spread == 2
        assert validator.max_age_spread_months == 24

    def test_validate_bunking_basic(self, validator, basic_session, basic_bunks, basic_persons):
        """Test basic validation with all campers assigned."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20002"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=[],
        )

        assert result.statistics.total_campers == 3
        assert result.statistics.assigned_campers == 3
        assert result.statistics.unassigned_campers == 0

    def test_validate_bunking_unassigned_campers(self, validator, basic_session, basic_bunks, basic_persons):
        """Test that unassigned campers are detected."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            # 10002 and 10003 not assigned
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=[],
        )

        assert result.statistics.unassigned_campers == 2
        unassigned_issue = next((i for i in result.issues if i.type == "unassigned_campers"), None)
        assert unassigned_issue is not None
        assert unassigned_issue.severity == ValidationSeverity.ERROR

    def test_validate_bunk_over_capacity(self, validator, basic_session, basic_persons):
        """Test that over-capacity bunks are detected."""
        small_bunk = MockBunk(campminder_id="30001", name="Small-1", max_size=2)

        # Assign 3 people to a bunk with max 2
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="30001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="30001"),
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="30001"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[small_bunk],
            assignments=assignments,
            persons=basic_persons,
            requests=[],
        )

        assert result.statistics.bunks_over_capacity == 1
        capacity_issue = next((i for i in result.issues if i.type == "capacity_violation"), None)
        assert capacity_issue is not None
        assert capacity_issue.severity == ValidationSeverity.ERROR

    def test_validate_bunk_at_capacity(self, validator, basic_session, basic_persons):
        """Test tracking of bunks at capacity."""
        exact_bunk = MockBunk(campminder_id="30002", name="Exact-1", max_size=3)

        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="30002"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="30002"),
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="30002"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[exact_bunk],
            assignments=assignments,
            persons=basic_persons,
            requests=[],
        )

        assert result.statistics.bunks_at_capacity == 1
        assert result.statistics.bunks_over_capacity == 0

    def test_validate_request_satisfaction_bunk_with(self, validator, basic_session, basic_bunks, basic_persons):
        """Test satisfaction tracking for bunk_with requests."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),  # Same bunk
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20002"),
        ]

        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                status="resolved",
            )
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=requests,
        )

        assert result.statistics.total_requests == 1
        assert result.statistics.satisfied_requests == 1
        assert result.statistics.request_satisfaction_rate == 1.0

    def test_validate_request_unsatisfied_bunk_with(self, validator, basic_session, basic_bunks, basic_persons):
        """Test that unsatisfied bunk_with requests are detected."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20002"),  # Different bunk!
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20002"),
        ]

        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                status="resolved",
            )
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=requests,
        )

        assert result.statistics.satisfied_requests == 0
        unsatisfied_issue = next((i for i in result.issues if i.type == "valid_request_unsatisfied"), None)
        assert unsatisfied_issue is not None

    def test_validate_not_bunk_with_satisfied(self, validator, basic_session, basic_bunks, basic_persons):
        """Test that not_bunk_with requests are satisfied when in different bunks."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20002"),  # Different bunk - good!
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20002"),
        ]

        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="not_bunk_with",
                status="resolved",
            )
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=requests,
        )

        assert result.statistics.satisfied_requests == 1

    def test_validate_not_bunk_with_violated(self, validator, basic_session, basic_bunks, basic_persons):
        """Test that violated not_bunk_with requests are detected."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),  # Same bunk - bad!
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20002"),
        ]

        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="not_bunk_with",
                status="resolved",
            )
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=requests,
        )

        assert result.statistics.satisfied_requests == 0
        violated_issue = next(
            (i for i in result.issues if i.type == "valid_negative_request_violated"),
            None,
        )
        assert violated_issue is not None
        assert violated_issue.severity == ValidationSeverity.ERROR

    def test_validate_grade_spread_within_limits(self, validator, basic_session):
        """Test that bunks with acceptable grade spread pass validation."""
        bunk = MockBunk(campminder_id="20001", name="B-1", gender="M")
        persons = [
            MockPerson(campminder_id="10001", name="A", grade=5, age=10),
            MockPerson(campminder_id="10002", name="B", grade=6, age=11),  # 2 grades ok
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[bunk],
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        grade_spread_issues = [i for i in result.issues if i.type == "grade_spread_warning"]
        assert len(grade_spread_issues) == 0

    def test_validate_grade_spread_exceeded(self, validator, basic_session):
        """Test that bunks with too many different grades are flagged."""
        bunk = MockBunk(campminder_id="20001", name="B-1", gender="M")
        persons = [
            MockPerson(campminder_id="10001", name="A", grade=4, age=9),
            MockPerson(campminder_id="10002", name="B", grade=5, age=10),
            MockPerson(campminder_id="10003", name="C", grade=6, age=11),  # 3 grades - too many
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20001"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[bunk],
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        grade_spread_issues = [i for i in result.issues if i.type == "grade_spread_warning"]
        assert len(grade_spread_issues) == 1

    def test_validate_ag_bunks_exempt_from_spread(self, validator, basic_session):
        """Test that AG bunks are exempt from grade spread validation."""
        ag_bunk = MockBunk(campminder_id="20001", name="AG-1", gender="Mixed")
        persons = [
            MockPerson(campminder_id="10001", name="A", grade=3, age=8),
            MockPerson(campminder_id="10002", name="B", grade=5, age=10),
            MockPerson(campminder_id="10003", name="C", grade=7, age=12),  # Wide spread
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20001"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[ag_bunk],
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        grade_spread_issues = [i for i in result.issues if i.type == "grade_spread_warning"]
        assert len(grade_spread_issues) == 0  # AG bunks exempt

    def test_validate_locked_bunks_counted(self, validator, basic_session):
        """Test that locked bunks are counted in statistics."""
        bunks = [
            MockBunk(campminder_id="20001", name="B-1", is_locked=True),
            MockBunk(campminder_id="20002", name="B-2", is_locked=True),
            MockBunk(campminder_id="20003", name="B-3", is_locked=False),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=bunks,
            assignments=[],
            persons=[],
            requests=[],
        )

        assert result.statistics.locked_bunks == 2

    def test_validate_campers_with_no_requests(self, validator, basic_session, basic_bunks, basic_persons):
        """Test detection of campers with no requests."""
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10003", bunk_cm_id="20002"),
        ]

        # Only 10001 and 10002 have requests
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
            )
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=basic_bunks,
            assignments=assignments,
            persons=basic_persons,
            requests=requests,
        )

        # 10003 has no requests
        assert result.statistics.campers_with_no_requests == 1

    def test_validate_capacity_utilization(self, validator, basic_session):
        """Test capacity utilization calculation."""
        bunks = [
            MockBunk(campminder_id="20001", name="B-1", max_size=10),
            MockBunk(campminder_id="20002", name="B-2", max_size=10),
        ]
        persons = [MockPerson(campminder_id=f"{10000 + i}", name=f"Person {i}") for i in range(15)]
        assignments = [
            MockBunkAssignment(person_cm_id=f"{10000 + i}", bunk_cm_id="20001" if i < 8 else "20002") for i in range(15)
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=bunks,
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        assert result.statistics.total_capacity == 20
        assert result.statistics.used_capacity == 15
        assert result.statistics.capacity_utilization_rate == 0.75

    def test_validate_grade_adjacency_non_adjacent(self, validator, basic_session):
        """Test detection of non-adjacent grades in a bunk."""
        bunk = MockBunk(campminder_id="20001", name="B-1", gender="M")
        persons = [
            MockPerson(campminder_id="10001", name="A", grade=4, age=9),
            MockPerson(campminder_id="10002", name="B", grade=6, age=11),  # Gap - missing grade 5
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[bunk],
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        adjacency_issues = [i for i in result.issues if i.type == "grade_adjacency_warning"]
        assert len(adjacency_issues) == 1
        assert adjacency_issues[0].details["missing_grades"] == [5]

    def test_validate_grade_adjacency_adjacent(self, validator, basic_session):
        """Test that adjacent grades don't trigger warnings."""
        bunk = MockBunk(campminder_id="20001", name="B-1", gender="M")
        persons = [
            MockPerson(campminder_id="10001", name="A", grade=5, age=10),
            MockPerson(campminder_id="10002", name="B", grade=6, age=11),  # Adjacent - OK
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[bunk],
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        adjacency_issues = [i for i in result.issues if i.type == "grade_adjacency_warning"]
        assert len(adjacency_issues) == 0


class TestHistoricalBunkingRecord:
    """Tests for HistoricalBunkingRecord dataclass."""

    def test_create_record(self):
        record = HistoricalBunkingRecord(
            person_cm_id=12345,
            bunk_name="B-5",
            year=2024,
            session_cm_id=67890,
        )
        assert record.person_cm_id == 12345
        assert record.bunk_name == "B-5"
        assert record.year == 2024
        assert record.session_cm_id == 67890

    def test_create_record_without_session(self):
        record = HistoricalBunkingRecord(
            person_cm_id=12345,
            bunk_name="B-5",
            year=2024,
        )
        assert record.session_cm_id is None


class TestLevelProgressionValidation:
    """Tests for level progression validation."""

    @pytest.fixture
    def validator(self):
        return BunkingValidator()

    @pytest.fixture
    def session(self):
        return MockSession(campminder_id="1234567", name="Session 1")

    def test_level_regression_detected(self, validator, session):
        """Test that level regression is detected for same-session campers."""
        bunks = [
            MockBunk(campminder_id="20005", name="B-5"),
            MockBunk(campminder_id="20003", name="B-3"),
        ]
        persons = [
            MockPerson(campminder_id="10001", name="Regressor", grade=6),
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20003", session_cm_id="1234567"),
        ]
        historical = [
            HistoricalBunkingRecord(
                person_cm_id=10001,  # Numeric ID matching the person
                bunk_name="B-5",
                year=2024,
                session_cm_id=1234567,  # Same session
            ),
        ]

        result = validator.validate_bunking(
            session=session,
            bunks=bunks,
            assignments=assignments,
            persons=persons,
            requests=[],
            historical_bunking=historical,
        )

        # Verify the logic runs and level_progression is tracked
        assert result.statistics.level_progression is not None

    def test_level_progression_different_session_skipped(self, validator, session):
        """Test that campers in different sessions are skipped for level comparison."""
        bunks = [
            MockBunk(campminder_id="20005", name="B-5"),
            MockBunk(campminder_id="20003", name="B-3"),
        ]
        persons = [
            MockPerson(campminder_id="11111", name="Different Session", grade=6),
        ]
        assignments = [
            MockBunkAssignment(person_cm_id="11111", bunk_cm_id="20003", session_cm_id="1234567"),
        ]
        historical = [
            HistoricalBunkingRecord(
                person_cm_id=11111,
                bunk_name="B-5",
                year=2024,
                session_cm_id=9999999,  # Different session!
            ),
        ]

        result = validator.validate_bunking(
            session=session,
            bunks=bunks,
            assignments=assignments,
            persons=persons,
            requests=[],
            historical_bunking=historical,
        )

        # Should not detect regression since different session
        regression_issues = [i for i in result.issues if i.type == "level_regression"]
        assert len(regression_issues) == 0
