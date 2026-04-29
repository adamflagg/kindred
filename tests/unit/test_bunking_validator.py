"""Tests for bunking_validator module."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from bunking.bunking_validator import (
    BunkingValidator,
    HistoricalBunkingRecord,
    ValidationResult,
    ValidationSeverity,
    ValidationStatistics,
)
from bunking.sync.bunk_request_processor.shared.constants import SourceField


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
    source: str | None = None  # "family" or "staff" (RequestSource enum value)
    ai_p1_reasoning: dict[str, Any] | None = None
    age_preference_target: str | None = None


@dataclass
class MockSession:
    """Mock Session object for testing."""

    campminder_id: str  # Use numeric string IDs
    name: str


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


class TestNormalizeSourceField:
    """Tests that normalize_source_field derives mappings from canonical SourceField constants.

    The validator's normalize_source_field must handle every canonical SourceField
    value (as stored in PocketBase) — not just hand-picked variations. This ensures
    new SourceField values automatically work without maintaining parallel mapping dicts.
    """

    @pytest.fixture
    def validator(self):
        return BunkingValidator()

    @pytest.fixture
    def session(self):
        return MockSession(campminder_id="1234567", name="Session 1")

    @pytest.fixture
    def bunks(self):
        return [MockBunk(campminder_id="20001", name="B-1")]

    @pytest.fixture
    def persons(self):
        return [
            MockPerson(campminder_id="10001", name="Emma Johnson", grade=5),
            MockPerson(campminder_id="10002", name="Liam Garcia", grade=5),
        ]

    @pytest.fixture
    def assignments(self):
        return [
            MockBunkAssignment(person_cm_id="10001", bunk_cm_id="20001"),
            MockBunkAssignment(person_cm_id="10002", bunk_cm_id="20001"),
        ]

    def _get_field_total(self, result: ValidationResult, field_key: str) -> int | float:
        """Get the total count for a given field_stats key."""
        return result.statistics.field_stats[field_key]["total"]

    def test_canonical_socialize_with_value(self, validator, session, bunks, persons, assignments):
        """SourceField.SOCIALIZE_WITH canonical value is counted in socialize_with stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.SOCIALIZE_WITH,  # "RetParent-Socializewithbest"
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "socialize_with") == 1

    def test_canonical_bunk_with_value(self, validator, session, bunks, persons, assignments):
        """SourceField.BUNK_WITH canonical value is counted in share_bunk_with stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.BUNK_WITH,  # "Share Bunk With"
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "share_bunk_with") == 1

    def test_canonical_not_bunk_with_value(self, validator, session, bunks, persons, assignments):
        """SourceField.NOT_BUNK_WITH canonical value is counted in do_not_share_with stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="not_bunk_with",
                source_field=SourceField.NOT_BUNK_WITH,  # "Do Not Share Bunk With"
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "do_not_share_with") == 1

    def test_canonical_bunking_notes_value(self, validator, session, bunks, persons, assignments):
        """SourceField.BUNKING_NOTES canonical value is counted in bunking_notes stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.BUNKING_NOTES,  # "BunkingNotes Notes"
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "bunking_notes") == 1

    def test_canonical_internal_notes_value(self, validator, session, bunks, persons, assignments):
        """SourceField.INTERNAL_NOTES canonical value is counted in internal_notes stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.INTERNAL_NOTES,  # "Internal Bunk Notes"
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "internal_notes") == 1

    def test_already_normalized_keys_still_work(self, validator, session, bunks, persons, assignments):
        """Already-normalized field keys (e.g., 'socialize_with') still map correctly."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field="socialize_with",
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "socialize_with") == 1

    def test_unknown_source_field_not_counted(self, validator, session, bunks, persons, assignments):
        """Unknown source fields produce no field_stats counts."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field="totally_unknown_field",
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        for field_data in result.statistics.field_stats.values():
            assert field_data["total"] == 0


def test_validation_statistics_has_parent_staff_breakdown_fields():
    """ValidationStatistics declares material_parent/best_effort_parent/staff breakdown fields defaulting to 0/0.0."""
    stats = ValidationStatistics()

    # Material parent breakdown — bunk_with source_field requests
    assert stats.material_parent_requests == 0
    assert stats.satisfied_material_parent_requests == 0
    assert stats.material_parent_request_satisfaction_rate == 0.0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0

    # Best-effort parent breakdown — socialize_with source_field requests
    assert stats.best_effort_parent_requests == 0
    assert stats.satisfied_best_effort_parent_requests == 0
    assert stats.best_effort_parent_request_satisfaction_rate == 0.0

    # Staff breakdown — campers with staff-source requests (not_bunk_with, bunking_notes, internal_notes)
    assert stats.staff_requests == 0
    assert stats.satisfied_staff_requests == 0
    assert stats.staff_request_satisfaction_rate == 0.0
    assert stats.campers_with_unsatisfied_staff_requests == 0


# Helpers for RequestSource binning tests
# Use numeric string IDs per existing fixture convention


# Return types omitted intentionally — these helpers feed into validate_bunking()
# which expects the real Session/Bunk/Person/BunkAssignment/BunkRequest Pydantic
# models. The pre-existing class-level fixtures (basic_session, basic_bunks, etc.)
# also omit annotations for the same reason; mypy can't narrow the return and
# treats it as Any-ish at the call site, mirroring the existing test convention.
def _mock_session(cm_id="1", name="Test"):
    return MockSession(campminder_id=cm_id, name=name)


def _mock_person(cm_id, grade=5):
    return MockPerson(campminder_id=cm_id, name=f"Camper{cm_id}", grade=grade)


def _mock_bunk(cm_id, max_size=8):
    return MockBunk(campminder_id=cm_id, name=f"Bunk-{cm_id}", max_size=max_size)


def _mock_assignment(person_cm_id, bunk_cm_id):
    return MockBunkAssignment(person_cm_id=person_cm_id, bunk_cm_id=bunk_cm_id)


def _mock_request(
    requester,
    target,
    source_field,
    source,  # "family", "staff", or None — RequestSource enum value
    request_type="bunk_with",
    status="resolved",
):
    return MockBunkRequest(
        requester_person_cm_id=requester,
        requested_person_cm_id=target,
        request_type=request_type,
        status=status,
        source_field=source_field,
        source=source,
    )


def test_validator_bins_parent_requests_separately_from_staff():
    """material_parent (bunk_with source_field) and staff (RequestSource.STAFF) requests are counted separately."""
    session = _mock_session(cm_id="10000001", name="Test Session")
    persons = [_mock_person("20001"), _mock_person("20002")]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
    ]
    requests = [
        # Material parent: 20001 wants to bunk with 20002 (source_field=bunk_with) — satisfied (both in 30001)
        _mock_request("20001", "20002", SourceField.BUNK_WITH, "family"),
        # Staff: 20002 has an internal note not_bunk_with 20003 (20003 not present) — satisfied (20003 absent)
        _mock_request("20002", "20003", SourceField.NOT_BUNK_WITH, "staff", request_type="not_bunk_with"),
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    assert stats.material_parent_requests == 1
    assert stats.satisfied_material_parent_requests == 1
    assert stats.material_parent_request_satisfaction_rate == 1.0
    assert stats.staff_requests == 1
    assert stats.satisfied_staff_requests == 1
    assert stats.staff_request_satisfaction_rate == 1.0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0
    assert stats.campers_with_unsatisfied_staff_requests == 0


def test_validator_flags_camper_with_unsatisfied_parent_but_satisfied_staff():
    """A camper with a material parent request unsatisfied but staff requests satisfied
    should appear in campers_with_unsatisfied_material_parent_requests but NOT in the
    staff equivalent. Stage 4 uses this binning for the solver minimum-one rule."""
    session = _mock_session(cm_id="10000001", name="Test Session")
    persons = [_mock_person("20001"), _mock_person("20002"), _mock_person("20003")]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30002"),  # NOT in 20001's bunk
        _mock_assignment("20003", "30002"),
    ]
    requests = [
        # Material parent: 20001 wants to bunk with 20002 (source_field=bunk_with) — UNSATISFIED
        _mock_request("20001", "20002", SourceField.BUNK_WITH, "family"),
        # Staff: 20001 should not bunk with 20003 — SATISFIED (20003 in 30002, 20001 in 30001)
        _mock_request("20001", "20003", SourceField.INTERNAL_NOTES, "staff", request_type="not_bunk_with"),
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    assert stats.material_parent_requests == 1
    assert stats.satisfied_material_parent_requests == 0
    assert stats.staff_requests == 1
    assert stats.satisfied_staff_requests == 1
    assert stats.campers_with_unsatisfied_material_parent_requests == 1  # 20001
    assert stats.campers_with_unsatisfied_staff_requests == 0  # 20001's staff is satisfied


def test_validator_skips_binning_for_requests_with_null_source_field():
    """Requests with source_field=None (legacy records or unset) count toward
    total_requests but fall through all parent and staff bins. Only the source_field
    determines material vs best-effort vs staff bucketing."""
    session = _mock_session()
    persons = [_mock_person("20001"), _mock_person("20002")]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
    ]
    requests = [
        # No source_field — satisfied (both in 30001) but binned nowhere in breakdown stats
        MockBunkRequest(
            requester_person_cm_id="20001",
            requested_person_cm_id="20002",
            request_type="bunk_with",
            status="resolved",
            source_field=None,
            source=None,
        ),
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    assert stats.total_requests == 1
    assert stats.satisfied_requests == 1
    assert stats.material_parent_requests == 0
    assert stats.best_effort_parent_requests == 0
    assert stats.staff_requests == 0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0
    assert stats.campers_with_unsatisfied_staff_requests == 0


def test_validator_source_field_drives_binning_regardless_of_source_enum():
    """source_field (not source enum) determines material vs best-effort vs staff bin.
    A request with source_field=bunk_with and a legacy source="notes" value (not in
    RequestSource enum) still bins as material_parent because source_field is bunk_with."""
    session = _mock_session()
    persons = [_mock_person("20001"), _mock_person("20002")]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
    ]
    requests = [
        # source_field=bunk_with, source=notes (legacy/unknown enum value)
        # bins as material_parent because source_field drives binning
        _mock_request("20001", "20002", SourceField.BUNK_WITH, "notes"),
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    assert stats.total_requests == 1
    assert stats.satisfied_requests == 1
    assert stats.material_parent_requests == 1  # bins by source_field, not source enum
    assert stats.staff_requests == 0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0
    assert stats.campers_with_unsatisfied_staff_requests == 0


# ---------------------------------------------------------------------------
# Stage 3a: material_parent_* and best_effort_parent_* field tests
# ---------------------------------------------------------------------------


def test_validation_statistics_no_legacy_parent_fields():
    """Stage 1 parent_* fields are deleted from ValidationStatistics."""
    stats = ValidationStatistics()
    assert not hasattr(stats, "parent_requests")
    assert not hasattr(stats, "satisfied_parent_requests")
    assert not hasattr(stats, "parent_request_satisfaction_rate")
    assert not hasattr(stats, "campers_with_unsatisfied_parent_requests")


def test_validation_statistics_no_explicit_csv_fields():
    """explicit_csv_* fields are deleted from ValidationStatistics."""
    stats = ValidationStatistics()
    assert not hasattr(stats, "explicit_csv_requests")
    assert not hasattr(stats, "satisfied_explicit_csv_requests")
    assert not hasattr(stats, "explicit_csv_request_satisfaction_rate")
    assert not hasattr(stats, "campers_with_unsatisfied_explicit_requests")


def test_bunk_with_request_counts_as_material_parent():
    """A resolved bunk_with request with source_field=bunk_with counts as
    material_parent_requests. Emma (1001) requests Liam (1002), both in same bunk."""
    session = _mock_session(cm_id="10000001", name="Test Session")
    # Emma grade 5, Liam grade 5 — same bunk
    persons = [
        MockPerson(campminder_id="1001", name="Emma Johnson", grade=5),
        MockPerson(campminder_id="1002", name="Liam Garcia", grade=5),
    ]
    bunks = [_mock_bunk("9001")]
    assignments = [
        _mock_assignment("1001", "9001"),
        _mock_assignment("1002", "9001"),
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="1001",
            requested_person_cm_id="1002",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_WITH,
            source="family",
        )
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    assert stats.material_parent_requests == 1
    assert stats.satisfied_material_parent_requests == 1
    assert stats.material_parent_request_satisfaction_rate == 1.0
    assert stats.best_effort_parent_requests == 0


def test_socialize_with_request_counts_as_best_effort():
    """A resolved age_preference request (socialize_with source) counts as
    best_effort_parent_requests only, not material_parent_requests.
    Olivia (1003) requests older bunkmates; Samuel (1005) is older and in same bunk."""
    session = _mock_session(cm_id="10000002", name="Test Session 2")
    persons = [
        MockPerson(campminder_id="1003", name="Olivia Chen", grade=5),
        MockPerson(campminder_id="1005", name="Samuel Johnson", grade=6),  # older
    ]
    bunks = [_mock_bunk("9002")]
    assignments = [
        _mock_assignment("1003", "9002"),
        _mock_assignment("1005", "9002"),
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="1003",
            requested_person_cm_id=None,
            request_type="age_preference",
            status="resolved",
            source_field=SourceField.SOCIALIZE_WITH,
            source="family",
            age_preference_target="older",
        )
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    assert stats.best_effort_parent_requests == 1
    assert stats.satisfied_best_effort_parent_requests == 1
    assert stats.material_parent_requests == 0


def test_camper_with_only_best_effort_does_not_appear_in_min_one_violators():
    """A camper with only best_effort (socialize_with) requests does NOT appear in
    campers_with_unsatisfied_material_parent_requests even when the preference is
    unsatisfied (Riley is alone, no bunkmates to compare age with)."""
    session = _mock_session(cm_id="10000003", name="Test Session 3")
    persons = [
        MockPerson(campminder_id="1004", name="Riley Sam", grade=5),
    ]
    bunks = [_mock_bunk("9003")]
    assignments = [
        _mock_assignment("1004", "9003"),  # Riley alone in bunk
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="1004",
            requested_person_cm_id=None,
            request_type="age_preference",
            status="resolved",
            source_field=SourceField.SOCIALIZE_WITH,
            source="family",
            age_preference_target="older",
        )
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    # best_effort request is unsatisfied (alone in bunk) but Riley is NOT a material violator
    assert stats.best_effort_parent_requests == 1
    assert stats.satisfied_best_effort_parent_requests == 0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0


def test_unassigned_requester_excluded_from_all_buckets():
    """A camper without a bunk assignment whose requests are resolved should
    contribute 0 to material_parent, best_effort_parent, and staff totals.
    The request is excluded entirely — not counted as unsatisfied."""
    # Emma exists in persons but has NO BunkAssignment.
    # Liam is bunked in bunk 9001.
    # Emma has a resolved bunk_with request for Liam.
    # Validator output should show all bucket totals are 0 and Emma is NOT a violator.
    session = _mock_session(cm_id="10000004", name="Test Session 4")
    persons = [
        MockPerson(campminder_id="2001", name="Emma Johnson", grade=5),
        MockPerson(campminder_id="2002", name="Liam Garcia", grade=5),
    ]
    bunks = [_mock_bunk("9001")]
    assignments = [
        # Liam is assigned; Emma is NOT assigned
        _mock_assignment("2002", "9001"),
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="2001",  # Emma — no bunk assignment
            requested_person_cm_id="2002",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_WITH,
            source="family",
        )
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=persons,
        requests=requests,
    )
    stats = result.statistics

    # Emma's request is excluded entirely — not counted in any bucket
    assert stats.material_parent_requests == 0
    assert stats.satisfied_material_parent_requests == 0
    assert stats.best_effort_parent_requests == 0
    assert stats.staff_requests == 0
    # Emma does NOT appear as a violator (request was skipped, not marked unsatisfied)
    assert stats.campers_with_unsatisfied_material_parent_requests == 0
    assert stats.total_requests == 0  # excluded from valid totals, not just buckets
    assert stats.satisfied_requests == 0
