"""Tests for bunking_validator module."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, cast

import pytest

from bunking.bunking_validator import (
    BunkingValidator,
    HistoricalBunkingRecord,
    ValidationResult,
    ValidationSeverity,
    ValidationStatistics,
)
from bunking.models import Bunk, BunkAssignment, BunkRequest, Person
from bunking.sync.bunk_request_processor.shared.constants import SourceField

# ---------------------------------------------------------------------------
# Protocols — structural interfaces that validate_bunking actually needs.
# Mock dataclasses below implement these protocols, allowing them to be passed
# without type suppressions.
# ---------------------------------------------------------------------------


class PersonLike(Protocol):
    campminder_id: str
    name: str
    grade: int | None
    age: float | None


class BunkLike(Protocol):
    campminder_id: str
    name: str
    max_size: int
    is_locked: bool
    gender: str


class BunkAssignmentLike(Protocol):
    person_cm_id: str
    bunk_cm_id: str
    session_cm_id: str | None


class BunkRequestLike(Protocol):
    requester_person_cm_id: str
    requested_person_cm_id: str | None
    request_type: str
    status: str
    source_field: str | None
    source: str | None
    ai_p1_reasoning: dict[str, Any] | None
    age_preference_target: str | None


class SessionLike(Protocol):
    campminder_id: str
    name: str


# Test fixtures
@dataclass
class MockPerson:
    """Mock Person object for testing. Structurally satisfies PersonLike."""

    campminder_id: str  # Use numeric string IDs like "10001"
    name: str
    grade: int | None = None
    age: float | None = None


@dataclass
class MockBunk:
    """Mock Bunk object for testing. Structurally satisfies BunkLike."""

    campminder_id: str  # Use numeric string IDs like "20001"
    name: str
    max_size: int = 12
    is_locked: bool = False
    gender: str = "M"


@dataclass
class MockBunkAssignment:
    """Mock BunkAssignment object for testing. Structurally satisfies BunkAssignmentLike."""

    person_cm_id: str  # Use numeric string IDs
    bunk_cm_id: str
    session_cm_id: str | None = None


@dataclass
class MockBunkRequest:
    """Mock BunkRequest object for testing. Structurally satisfies BunkRequestLike."""

    requester_person_cm_id: str  # Use numeric string IDs
    requested_person_cm_id: str | None
    request_type: str
    status: str = "resolved"
    source_field: str | None = None
    source: str | None = None  # "family" or "staff" (legacy column, derived via source_from_field post-#1142)
    ai_p1_reasoning: dict[str, Any] | None = None
    age_preference_target: str | None = None


@dataclass
class MockSession:
    """Mock Session object for testing. Structurally satisfies SessionLike."""

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

    def test_validate_bunk_over_capacity(self, validator, basic_session):
        """Test that over-capacity bunks are detected.

        Phase 2 cabin-capacity cleanup: ``bunk.max_size`` is no longer per-bunk
        (the field was a Pydantic-only fiction never backed by a PB column).
        Validation uses the global ``DEFAULT_BUNK_CAPACITY=12`` constant. So
        "over capacity" means ≥13 campers in a single bunk — only reachable
        via staff manual edits, since the solver hard-caps at 12.
        """
        bunk = MockBunk(campminder_id="30001", name="B-1")
        persons = [MockPerson(campminder_id=f"{10000 + i}", name=f"Camper {i}", age=10, grade=5) for i in range(13)]
        assignments = [MockBunkAssignment(person_cm_id=f"{10000 + i}", bunk_cm_id="30001") for i in range(13)]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[bunk],
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        assert result.statistics.bunks_over_capacity == 1
        capacity_issue = next((i for i in result.issues if i.type == "capacity_violation"), None)
        assert capacity_issue is not None
        assert capacity_issue.severity == ValidationSeverity.ERROR

    def test_validate_bunk_at_capacity(self, validator, basic_session):
        """Test tracking of bunks at capacity (= DEFAULT_BUNK_CAPACITY)."""
        bunk = MockBunk(campminder_id="30002", name="B-2")
        persons = [MockPerson(campminder_id=f"{10000 + i}", name=f"Camper {i}", age=10, grade=5) for i in range(12)]
        assignments = [MockBunkAssignment(person_cm_id=f"{10000 + i}", bunk_cm_id="30002") for i in range(12)]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=[bunk],
            assignments=assignments,
            persons=persons,
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
                # Bin into material_parent so total_requests reflects this row
                # (total = material + staff).
                source_field=SourceField.BUNK_REQUEST_FORM,
                source="family",
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
                # alerting bucket requires the row to bin into material_parent
                # (source_field=bunk_with) or staff. Production CSV import
                # always sets source_field, so the test mirrors real data.
                source_field=SourceField.BUNK_REQUEST_FORM,
                source="family",
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
                # Staff source so the row bins into staff_requests and
                # contributes to total_requests (= material + staff).
                source_field=SourceField.STAFF_NOT_BUNK_WITH,
                source="staff",
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
                # alerting bucket needs the row to bin into staff
                # (source_field=not_bunk_with, source=staff). In production the
                # CSV/sync path always sets these.
                source_field=SourceField.STAFF_NOT_BUNK_WITH,
                source="staff",
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
        """Test capacity utilization calculation.

        Phase 2 cabin-capacity cleanup: total capacity is now
        ``len(bunks) * DEFAULT_BUNK_CAPACITY`` (= 2 * 12 = 24), not the sum of
        per-bunk ``max_size``. Used capacity tracks assigned campers.
        """
        bunks = [
            MockBunk(campminder_id="20001", name="B-1"),
            MockBunk(campminder_id="20002", name="B-2"),
        ]
        persons = [MockPerson(campminder_id=f"{10000 + i}", name=f"Person {i}") for i in range(18)]
        assignments = [
            MockBunkAssignment(person_cm_id=f"{10000 + i}", bunk_cm_id="20001" if i < 9 else "20002") for i in range(18)
        ]

        result = validator.validate_bunking(
            session=basic_session,
            bunks=bunks,
            assignments=assignments,
            persons=persons,
            requests=[],
        )

        assert result.statistics.total_capacity == 24  # 2 bunks * DEFAULT_BUNK_CAPACITY (12)
        assert result.statistics.used_capacity == 18
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
        """SourceField.BUNK_REQUEST_FORM canonical value is counted in share_bunk_with stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.BUNK_REQUEST_FORM,  # "Share Bunk With"
            )
        ]

        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )

        assert self._get_field_total(result, "share_bunk_with") == 1

    def test_canonical_not_bunk_with_value(self, validator, session, bunks, persons, assignments):
        """SourceField.STAFF_NOT_BUNK_WITH canonical value is counted in do_not_share_with stats."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="not_bunk_with",
                source_field=SourceField.STAFF_NOT_BUNK_WITH,  # "Do Not Share Bunk With"
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

    def test_canonical_bunk_with_increments_material_parent_counters(
        self, validator, session, bunks, persons, assignments
    ):
        """A canonical SourceField.BUNK_REQUEST_FORM input must populate
        material_parent_requests (in addition to field_stats['share_bunk_with'])."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.BUNK_REQUEST_FORM,
                source="family",
            )
        ]
        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )
        assert result.statistics.material_parent_requests == 1, (
            f"canonical BUNK_REQUEST_FORM must increment material_parent_requests; "
            f"got {result.statistics.material_parent_requests}"
        )
        assert result.statistics.satisfied_material_parent_requests == 1
        assert result.statistics.best_effort_parent_requests == 0

    def test_canonical_socialize_with_increments_best_effort_counters(
        self, validator, session, bunks, persons, assignments
    ):
        """Canonical SourceField.SOCIALIZE_WITH must populate
        best_effort_parent_requests, NOT material_parent_requests."""
        requests = [
            MockBunkRequest(
                requester_person_cm_id="10001",
                requested_person_cm_id="10002",
                request_type="bunk_with",
                source_field=SourceField.SOCIALIZE_WITH,
                source="family",
            )
        ]
        result = validator.validate_bunking(
            session=session, bunks=bunks, assignments=assignments, persons=persons, requests=requests
        )
        assert result.statistics.best_effort_parent_requests == 1, (
            f"canonical SOCIALIZE_WITH must increment best_effort_parent_requests; "
            f"got {result.statistics.best_effort_parent_requests}"
        )
        assert result.statistics.material_parent_requests == 0, (
            f"SOCIALIZE_WITH must NOT bin to material_parent (best-effort only); "
            f"got material_parent_requests={result.statistics.material_parent_requests}"
        )


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


# Helpers for family/staff binning tests
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
    source,  # "family", "staff", or None — legacy column, derived via source_from_field post-#1142
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
    """material_parent (bunk_with source_field) and staff ("staff" via source_from_field) requests are counted separately."""
    session = _mock_session(cm_id="10000001", name="Test Session")
    persons = [_mock_person("20001"), _mock_person("20002")]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
    ]
    requests = [
        # Material parent: 20001 wants to bunk with 20002 (source_field=bunk_with) — satisfied (both in 30001)
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family"),
        # Staff: 20002 has a staff not_bunk_with entry for 20003 (20003 not present) — satisfied (20003 absent)
        _mock_request("20002", "20003", SourceField.STAFF_NOT_BUNK_WITH, "staff", request_type="not_bunk_with"),
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
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family"),
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
    """Requests with source_field=None (legacy records or unset) fall through all
    parent and staff bins. Since total_requests = material + staff, a
    null-source-field request also does NOT contribute to total_requests."""
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
        requests=cast(list[BunkRequest], requests),
    )
    stats = result.statistics

    # total = material + staff = 0 (null-source request bins nowhere)
    assert stats.total_requests == 0
    assert stats.satisfied_requests == 0
    assert stats.material_parent_requests == 0
    assert stats.best_effort_parent_requests == 0
    assert stats.staff_requests == 0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0
    assert stats.campers_with_unsatisfied_staff_requests == 0


def test_validator_source_field_drives_binning_regardless_of_source_enum():
    """source_field (not the legacy source string) determines material vs best-effort vs staff bin.
    A request with source_field=bunk_with and a legacy source="notes" value (no longer
    a recognized "family"/"staff" string post-#1142) still bins as material_parent
    because source_field is bunk_with."""
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
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "notes"),
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


def test_total_requests_excludes_best_effort():
    """Aggregate total_requests / satisfied_requests narrow to
    material_parent + staff. A best-effort socialize_with row is reported
    in best_effort_parent_requests only, NOT in total_requests.

    Earlier iterations aggregated over valid_requests_by_person which
    included best-effort.
    """
    session = _mock_session(cm_id="10000001", name="Test Session")
    persons = [_mock_person("20001"), _mock_person("20002"), _mock_person("20003")]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
        _mock_assignment("20003", "30001"),
    ]
    requests = [
        # Material parent: 20001 wants to bunk with 20002 (bunk_with) — satisfied
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family"),
        # Best-effort parent: 20001 wants to socialize with 20003 — satisfied (same bunk)
        _mock_request("20001", "20003", SourceField.SOCIALIZE_WITH, "family"),
        # Staff: 20002 has internal note bunk_with 20003 — satisfied (same bunk)
        _mock_request("20002", "20003", SourceField.INTERNAL_NOTES, "staff"),
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

    # Slice counts: material=1, best_effort=1, staff=1.
    assert stats.material_parent_requests == 1
    assert stats.satisfied_material_parent_requests == 1
    assert stats.best_effort_parent_requests == 1
    assert stats.satisfied_best_effort_parent_requests == 1
    assert stats.staff_requests == 1
    assert stats.satisfied_staff_requests == 1

    # total_requests = material_parent + staff (best-effort is excluded).
    assert stats.total_requests == 2, (
        f"total_requests must be material_parent + staff = 1 + 1 = 2, "
        f"got {stats.total_requests}. Best-effort must NOT contribute."
    )
    assert stats.satisfied_requests == 2, (
        f"satisfied_requests must be material_parent + staff satisfied = 1 + 1 = 2, got {stats.satisfied_requests}."
    )


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
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        )
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
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
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
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
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )
    stats = result.statistics

    # best_effort request is unsatisfied (alone in bunk) but Riley is NOT a material violator
    assert stats.best_effort_parent_requests == 1
    assert stats.satisfied_best_effort_parent_requests == 0
    assert stats.campers_with_unsatisfied_material_parent_requests == 0


def test_best_effort_only_camper_does_not_trigger_unsatisfied_valid_requests_warning():
    """A camper whose only resolved requests are best-effort socialize_with
    rows must NOT appear in `campers_with_unsatisfied_valid_requests` — the
    alerting bucket excludes best-effort. Otherwise socialize_with-only
    campers trip a spurious warning whenever the request can't be honored."""
    session = _mock_session(cm_id="10000005", name="Test Session 5")
    persons = [
        MockPerson(campminder_id="3501", name="Riley Sam", grade=5),
    ]
    bunks = [_mock_bunk("9501")]
    assignments = [
        _mock_assignment("3501", "9501"),  # Riley alone — age preference cannot satisfy
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="3501",
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
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    summary_issue = next(
        (i for i in result.issues if i.type == "campers_with_unsatisfied_valid_requests"),
        None,
    )
    assert summary_issue is None, (
        "best-effort-only camper must not trigger the unsatisfied-valid-requests "
        f"summary; got issue with details={summary_issue.details if summary_issue else None}"
    )

    valid_request_issues = [i for i in result.issues if i.type == "valid_request_unsatisfied"]
    assert valid_request_issues == [], (
        f"best-effort-only camper must not produce valid_request_unsatisfied "
        f"WARNINGs; got {[i.details for i in valid_request_issues]}"
    )


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
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        )
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
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


def test_three_grade_bunk_age_preference_evaluation():
    """End-to-end: validator's is_request_satisfied uses the real-grades logic
    on three-grade bunks. Tied second-place → satisfied.

    Bunk 9001 contains:
    - 8 sixth-graders (cm_ids 3001-3008)
    - 2 fifth-graders (3010-3011)
    - 2 seventh-graders (3020-3021)

    Camper Liam Garcia (cm_id=3001, grade 6) has a resolved age_preference
    request with target=older. Distribution 8/2/2 with tied second place
    → satisfied per Task 1 real-grades rule.

    Expected: stats.best_effort_parent_requests == 1,
    satisfied_best_effort_parent_requests == 1, satisfaction_rate == 1.0.
    """
    session = _mock_session(cm_id="10000005", name="Test Session 5")
    persons = [
        # 8 sixth-graders (most common)
        MockPerson(campminder_id="3001", name="Liam Garcia", grade=6),
        MockPerson(campminder_id="3002", name="Sixth Grader 2", grade=6),
        MockPerson(campminder_id="3003", name="Sixth Grader 3", grade=6),
        MockPerson(campminder_id="3004", name="Sixth Grader 4", grade=6),
        MockPerson(campminder_id="3005", name="Sixth Grader 5", grade=6),
        MockPerson(campminder_id="3006", name="Sixth Grader 6", grade=6),
        MockPerson(campminder_id="3007", name="Sixth Grader 7", grade=6),
        MockPerson(campminder_id="3008", name="Sixth Grader 8", grade=6),
        # 2 fifth-graders (tied for second)
        MockPerson(campminder_id="3010", name="Fifth Grader 1", grade=5),
        MockPerson(campminder_id="3011", name="Fifth Grader 2", grade=5),
        # 2 seventh-graders (tied for second)
        MockPerson(campminder_id="3020", name="Seventh Grader 1", grade=7),
        MockPerson(campminder_id="3021", name="Seventh Grader 2", grade=7),
    ]
    bunks = [_mock_bunk("9001", max_size=12)]
    assignments = [
        _mock_assignment("3001", "9001"),
        _mock_assignment("3002", "9001"),
        _mock_assignment("3003", "9001"),
        _mock_assignment("3004", "9001"),
        _mock_assignment("3005", "9001"),
        _mock_assignment("3006", "9001"),
        _mock_assignment("3007", "9001"),
        _mock_assignment("3008", "9001"),
        _mock_assignment("3010", "9001"),
        _mock_assignment("3011", "9001"),
        _mock_assignment("3020", "9001"),
        _mock_assignment("3021", "9001"),
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="3001",
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
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )
    stats = result.statistics

    # Distribution 8/2/2 with tied second place → satisfied
    assert stats.best_effort_parent_requests == 1
    assert stats.satisfied_best_effort_parent_requests == 1
    # Aggregate request_satisfaction_rate excludes best-effort, so verify
    # the slice-specific rate instead.
    assert stats.best_effort_parent_request_satisfaction_rate == 1.0
    assert stats.material_parent_requests == 0


# ---------------------------------------------------------------------------
# Stage 3b.1 §2.8 — Backend parity: slice classification truth table
# ---------------------------------------------------------------------------
# Each parametrize entry maps one row of the §2.8 truth table to the
# validator slice counter that must increment. We test classification only —
# satisfaction doesn't matter, so we don't bother building satisfying bunks.
#
# "material"     → stats.material_parent_requests   == 1
# "best_effort"  → stats.best_effort_parent_requests == 1
# "staff"        → stats.staff_requests              == 1
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("request_type", "source_field", "source", "expected_slice"),
    [
        # row 1: bunk_with / bunk_with / family → materialParent
        ("bunk_with", SourceField.BUNK_REQUEST_FORM, "family", "material"),
        # row 2: bunk_with / bunking_notes / staff → staff
        ("bunk_with", SourceField.BUNKING_NOTES, "staff", "staff"),
        # row 3: bunk_with / internal_notes / staff → staff
        ("bunk_with", SourceField.INTERNAL_NOTES, "staff", "staff"),
        # row 4: not_bunk_with / bunk_with / family → materialParent  (bug-fix parity)
        ("not_bunk_with", SourceField.BUNK_REQUEST_FORM, "family", "material"),
        # row 5: not_bunk_with / not_bunk_with / staff → staff
        ("not_bunk_with", SourceField.STAFF_NOT_BUNK_WITH, "staff", "staff"),
        # row 6: not_bunk_with / bunking_notes / staff → staff
        ("not_bunk_with", SourceField.BUNKING_NOTES, "staff", "staff"),
        # row 7: not_bunk_with / internal_notes / staff → staff
        ("not_bunk_with", SourceField.INTERNAL_NOTES, "staff", "staff"),
        # row 8: age_preference / bunk_with / family → materialParent
        ("age_preference", SourceField.BUNK_REQUEST_FORM, "family", "material"),
        # row 9: age_preference / socialize_with / family → bestEffortParent
        ("age_preference", SourceField.SOCIALIZE_WITH, "family", "best_effort"),
        # row 10: age_preference / null / family → not binned (#1086 fallback removed)
        ("age_preference", None, "family", "none"),
        # row 11: age_preference / bunking_notes / staff → staff
        ("age_preference", SourceField.BUNKING_NOTES, "staff", "staff"),
        # row 12: age_preference / internal_notes / staff → staff
        ("age_preference", SourceField.INTERNAL_NOTES, "staff", "staff"),
    ],
    ids=[
        "bunk_with__bunk_with__family",
        "bunk_with__bunking_notes__staff",
        "bunk_with__internal_notes__staff",
        "not_bunk_with__bunk_with__family",
        "not_bunk_with__not_bunk_with__staff",
        "not_bunk_with__bunking_notes__staff",
        "not_bunk_with__internal_notes__staff",
        "age_preference__bunk_with__family",
        "age_preference__socialize_with__family",
        "age_preference__null__family",
        "age_preference__bunking_notes__staff",
        "age_preference__internal_notes__staff",
    ],
)
def test_validator_slice_classification(
    request_type: str,
    source_field: str | None,
    source: str,
    expected_slice: str,
) -> None:
    """Backend slice classification must match the bucket policy in
    bunking.satisfaction.bucket._BUCKET_MAP (the post-#1041 single source of truth).

    We test classification (which counter increments) not satisfaction. Both campers
    are placed in the same bunk; not_bunk_with rows will therefore be unsatisfied, but
    that doesn't affect which slice counter receives the request.
    """
    session = _mock_session(cm_id="10000099", name="Parity Test")
    persons = [
        MockPerson(campminder_id="9901", name="Emma Johnson", grade=5),
        MockPerson(campminder_id="9902", name="Liam Garcia", grade=6),
    ]
    bunks = [_mock_bunk("8801")]
    assignments = [
        _mock_assignment("9901", "8801"),
        _mock_assignment("9902", "8801"),
    ]

    # For age_preference rows the target is None (no concrete person); for all
    # others it points to the second camper.
    target = None if request_type == "age_preference" else "9902"

    request = MockBunkRequest(
        requester_person_cm_id="9901",
        requested_person_cm_id=target,
        request_type=request_type,
        status="resolved",
        source_field=source_field,
        source=source,
        age_preference_target="older" if request_type == "age_preference" else None,
    )

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], [request]),
    )
    stats = result.statistics

    material = stats.material_parent_requests
    best_effort = stats.best_effort_parent_requests
    staff = stats.staff_requests

    if expected_slice == "material":
        assert material == 1, (
            f"Expected material_parent_requests=1 for "
            f"(request_type={request_type!r}, source_field={source_field!r}, source={source!r}); "
            f"got material={material}, best_effort={best_effort}, staff={staff}"
        )
        assert best_effort == 0
        assert staff == 0
    elif expected_slice == "best_effort":
        assert best_effort == 1, (
            f"Expected best_effort_parent_requests=1 for "
            f"(request_type={request_type!r}, source_field={source_field!r}, source={source!r}); "
            f"got material={material}, best_effort={best_effort}, staff={staff}"
        )
        assert material == 0
        assert staff == 0
    elif expected_slice == "staff":
        assert staff == 1, (
            f"Expected staff_requests=1 for "
            f"(request_type={request_type!r}, source_field={source_field!r}, source={source!r}); "
            f"got material={material}, best_effort={best_effort}, staff={staff}"
        )
        assert material == 0
        assert best_effort == 0
    elif expected_slice == "none":
        # #1086: null source_field rows are never binned — fall through all buckets.
        assert material == 0, (
            f"Expected no material bin for (request_type={request_type!r}, "
            f"source_field={source_field!r}, source={source!r}); got material={material}"
        )
        assert best_effort == 0, (
            f"Expected no best_effort bin for (request_type={request_type!r}, "
            f"source_field={source_field!r}, source={source!r}); got best_effort={best_effort}"
        )
        assert staff == 0, (
            f"Expected no staff bin for (request_type={request_type!r}, "
            f"source_field={source_field!r}, source={source!r}); got staff={staff}"
        )


def test_validator_warns_when_resolved_age_preference_has_null_source_field(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A resolved age_preference request with source_field=None must emit a WARNING.

    The legacy best-effort fallback (issue #1086) is removed; callers should see
    a warning so the data gap can be investigated.
    """
    import logging

    session = _mock_session()
    persons = [_mock_person("20001"), _mock_person("20002")]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
    ]
    requests = [
        MockBunkRequest(
            requester_person_cm_id="20001",
            requested_person_cm_id=None,
            request_type="age_preference",
            status="resolved",
            source_field=None,
            source="family",
            age_preference_target="older",
        ),
    ]

    with caplog.at_level(logging.WARNING, logger="bunking.bunking_validator"):
        validator = BunkingValidator()
        validator.validate_bunking(
            session=session,
            bunks=bunks,
            assignments=assignments,
            persons=cast(list[Person], persons),
            requests=cast(list[BunkRequest], requests),
        )

    warning_messages = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    assert any("source_field" in msg and "age_preference" in msg for msg in warning_messages), (
        f"Expected warning about null source_field on resolved age_preference; got: {warning_messages}"
    )


# ---------------------------------------------------------------------------
# #1105: unsatisfied_material_parent_persons drill-down list
# ---------------------------------------------------------------------------


def test_unsatisfied_material_parent_persons_empty_when_all_satisfied():
    """When all material parent requests are satisfied, the drill-down list is empty."""
    session = _mock_session()
    persons = [_mock_person("20001"), _mock_person("20002")]
    bunks = [_mock_bunk("30001")]
    assignments = [_mock_assignment("20001", "30001"), _mock_assignment("20002", "30001")]
    requests = [_mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family")]

    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    assert result.statistics.unsatisfied_material_parent_persons == []


def test_unsatisfied_material_parent_persons_populated_when_request_unmet():
    """When a material parent request is not satisfied, the person appears in the drill-down list."""
    session = _mock_session()
    persons = [_mock_person("20001"), _mock_person("20002"), _mock_person("20003")]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30002"),  # NOT with 20001 — request unsatisfied
        _mock_assignment("20003", "30001"),
    ]
    requests = [_mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family")]

    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    unmet = result.statistics.unsatisfied_material_parent_persons
    assert len(unmet) == 1
    assert unmet[0]["cm_id"] == 20001
    assert unmet[0]["name"] == "Camper20001"


def test_unsatisfied_material_parent_persons_excludes_partial_satisfaction():
    """Camper with 2 parent requests where ≥1 is satisfied is NOT in the drill-down list.

    Per the canonical satisfaction policy in `bunking/satisfaction/aggregate.bucket_status`,
    a bucket is "unsatisfied" only when total > 0 AND satisfied == 0. Partial satisfaction
    (≥1 of N) classifies as "satisfied", so such campers must not appear in the unmet list
    — otherwise the drill-down contradicts the modal header scalar
    (`campers_with_unsatisfied_material_parent_requests`).
    """
    session = _mock_session()
    persons = [_mock_person("20001"), _mock_person("20002"), _mock_person("20003")]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),  # satisfied: 20001 bunked with 20002
        _mock_assignment("20003", "30002"),  # unsatisfied: 20001 NOT bunked with 20003
    ]
    requests = [
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family"),  # satisfied
        _mock_request("20001", "20003", SourceField.BUNK_REQUEST_FORM, "family"),  # unsatisfied
    ]

    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    unmet = result.statistics.unsatisfied_material_parent_persons
    assert unmet == [], (
        "Camper 20001 has 1 of 2 parent requests satisfied — per canonical policy this is "
        "the 'satisfied' bucket, so they must NOT appear in the drill-down list."
    )
    # Sanity: scalar must agree.
    assert result.statistics.campers_with_unsatisfied_material_parent_requests == 0


def test_unsatisfied_material_parent_persons_sorted_alphabetically():
    """Drill-down list is sorted alphabetically by name for deterministic UI rendering."""
    session = _mock_session()
    # Names chosen so insertion-order (request order) differs from alphabetical order.
    persons = [
        MockPerson(campminder_id="20001", name="Zoe Smith", grade=5),
        MockPerson(campminder_id="20002", name="Anna Brown", grade=5),
        MockPerson(campminder_id="20003", name="Mara Lee", grade=5),
        _mock_person("20099"),
    ]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    # All requesters in their own bunk so no parent requests are satisfied.
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
        _mock_assignment("20003", "30001"),
        _mock_assignment("20099", "30002"),
    ]
    requests = [
        _mock_request("20001", "20099", SourceField.BUNK_REQUEST_FORM, "family"),  # Zoe Smith
        _mock_request("20002", "20099", SourceField.BUNK_REQUEST_FORM, "family"),  # Anna Brown
        _mock_request("20003", "20099", SourceField.BUNK_REQUEST_FORM, "family"),  # Mara Lee
    ]

    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    unmet = result.statistics.unsatisfied_material_parent_persons
    names = [entry["name"] for entry in unmet]
    assert names == sorted(names), f"Expected alphabetical ordering, got: {names}"


def test_unsatisfied_material_parent_persons_falls_back_when_person_missing():
    """When a request's requester_id has no matching person row, fall back to 'Person {pid}'.

    The requester (20999) IS assigned to a bunk so the request is processed, but is
    absent from the persons list so `person_by_id.get(20999)` returns None and the
    fallback name path executes.
    """
    session = _mock_session()
    # 20999 is referenced as a requester but NOT in the persons list.
    persons = [_mock_person("20002")]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    assignments = [
        _mock_assignment("20999", "30001"),  # requester assigned (so request is processed)
        _mock_assignment("20002", "30002"),  # target in different bunk → unsatisfied
    ]
    requests = [_mock_request("20999", "20002", SourceField.BUNK_REQUEST_FORM, "family")]

    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    unmet = result.statistics.unsatisfied_material_parent_persons
    fallback_entries = [entry for entry in unmet if entry["name"] == "Person 20999"]
    assert len(fallback_entries) == 1, f"Expected fallback entry for unknown person; got: {unmet}"
    assert fallback_entries[0]["cm_id"] == 20999


# ---------------------------------------------------------------------------
# #1170 — Validator must consume bunking.satisfaction.predicate, not maintain a
# local duplicate. The drift was surfaced when #1169 introduced
# unsatisfied_material_parent_persons, whose initial classification contradicted
# the canonical bucket_status policy because the validator's satisfaction logic
# wasn't grounded in the canonical predicate.
# ---------------------------------------------------------------------------


def test_validator_imports_canonical_predicate_and_drops_local_duplicate():
    """The validator module must import is_request_satisfied from
    bunking.satisfaction.predicate and must NOT define its own local duplicate.
    """
    import inspect

    import bunking.bunking_validator as v

    src = inspect.getsource(v)
    assert "from bunking.satisfaction.predicate import is_request_satisfied" in src, (
        "validator must import is_request_satisfied from bunking.satisfaction.predicate"
    )
    # Local duplicate must be removed — single source of truth.
    assert "def is_request_satisfied(" not in src, (
        "validator still defines a local is_request_satisfied; drop it and use the canonical import"
    )


def test_validator_satisfied_counts_match_canonical_predicate_on_mixed_fixture():
    """Behavioral pin: satisfied_material_parent_requests and satisfied counts
    must match what bunking.satisfaction.predicate.is_request_satisfied would
    compute for the same fixture. Guards against drift during the migration.

    The validator bins by source_field, not source — so a fixture exercising the
    binning + satisfaction split needs varied source_fields. This test sticks to
    bunk_with parent requests because those drive the material_parent bucket
    that #1170's drift surfaced.
    """
    session = _mock_session(cm_id="10000001", name="MixedFixture")
    persons = [_mock_person(str(cm), grade=5) for cm in (20001, 20002, 20003, 20004)]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    # 20001, 20002 in bunk 30001; 20003, 20004 in bunk 30002.
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),
        _mock_assignment("20003", "30002"),
        _mock_assignment("20004", "30002"),
    ]
    requests = [
        # satisfied bunk_with parent: 20001 → 20002 (same bunk)
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family"),
        # unsatisfied bunk_with parent: 20001 → 20003 (different bunks)
        _mock_request("20001", "20003", SourceField.BUNK_REQUEST_FORM, "family"),
        # unsatisfied bunk_with parent: 20003 → 20001 (different bunks)
        _mock_request("20003", "20001", SourceField.BUNK_REQUEST_FORM, "family"),
    ]

    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )
    stats = result.statistics

    # Material parent (bunk_with source_field): 3 total, 1 satisfied (20001→20002).
    # The exact counts must hold across the predicate migration — they pin
    # behavior that downstream metrics + UI depend on.
    assert stats.material_parent_requests == 3
    assert stats.satisfied_material_parent_requests == 1
    # 20001 has ≥1 satisfied → bucket "satisfied" under canonical policy → NOT
    # in unmet. 20003 has 0 satisfied → bucket "unsatisfied" → IS in unmet.
    assert stats.campers_with_unsatisfied_material_parent_requests == 1
    unmet_ids = {entry["cm_id"] for entry in stats.unsatisfied_material_parent_persons}
    assert unmet_ids == {20003}


def test_validator_is_satisfied_returns_false_on_non_numeric_grade():
    """CR2 — defensive: the _is_satisfied adapter must absorb int() failures across
    the FULL row construction (requested_person_cm_id, requester_grade), not just
    the requester id. Currently a non-numeric grade would raise inside the adapter
    and abort validation; legacy local predicate returned False on data-hygiene
    gaps, and the adapter should mirror that.
    """
    session = _mock_session(cm_id="10000001", name="GradeHygieneFixture")
    # Person with a non-numeric grade (corrupt CSV, schema migration gap, etc.).
    # _mock_person normally takes int grade; cast to bypass the helper's typing.
    bad_grade_person = MockPerson(campminder_id="20001", name="Camper20001", grade=cast(Any, "K"))
    persons = [bad_grade_person, _mock_person("20002", grade=5)]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30002"),
    ]
    # An age_preference request — needs requester_grade. Bad grade should NOT 500.
    requests = [
        _mock_request(
            "20001",
            "0",
            SourceField.SOCIALIZE_WITH,
            "family",
            request_type="age_preference",
        ),
    ]

    # Must not raise — adapter swallows ValueError, treats as unsatisfied.
    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )
    # Validation completed without crashing — that's the contract.
    assert result.statistics is not None


def test_unsatisfied_material_parent_persons_skips_non_numeric_requester_id():
    """Non-numeric requester_id in unmet drill-down must NOT crash validation.

    `unsatisfied_material_parent_persons` calls `int(pid)` directly on the
    `material_parent_by_person` keys. If a request carries a malformed
    requester_id (corrupt CSV, schema migration gap, manual edit), this
    raises mid-`sorted()` and tanks the entire validation summary. The
    surrounding canonical predicate already absorbs the same bad-data class;
    the drill-down must mirror that contract.
    """
    session = _mock_session(cm_id="10000001", name="UnmetDrillNonNumericPidFixture")
    # Non-numeric requester has no Person/Assignment record — matches real production
    # data hygiene gaps (orphaned request rows pointing at a deleted/typo'd cm_id).
    persons = [
        _mock_person("20001", grade=5),
        _mock_person("20002", grade=5),
    ]
    bunks = [_mock_bunk("30001"), _mock_bunk("30002")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30002"),
    ]
    # age_preference requests still classify as material-parent (source_field=bunk_with,
    # source=family) but bypass the bunk_with-only isolation-risk pass. That keeps this
    # test surgically scoped to the unmet-parent drill-down code path.
    requests = [
        # Bad requester — should be skipped by the drill-down without crashing.
        _mock_request("abc", "20002", SourceField.BUNK_REQUEST_FORM, "family", request_type="age_preference"),
        # Good requester — should still appear in unmet list.
        _mock_request("20001", "20002", SourceField.BUNK_REQUEST_FORM, "family", request_type="age_preference"),
    ]

    # Must not raise.
    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )

    unmet_ids = {entry["cm_id"] for entry in result.statistics.unsatisfied_material_parent_persons}
    # 20001 still surfaces; "abc" is silently skipped.
    assert 20001 in unmet_ids
    assert all(isinstance(entry["cm_id"], int) for entry in result.statistics.unsatisfied_material_parent_persons)


def test_validator_handles_non_numeric_bunkmate_grade():
    """Non-numeric bunkmate grade in canonical precompute must NOT crash validation.

    `bunkmate_grades_canon[pid_int] = [int(bunkmate.grade) ...]` runs BEFORE
    `_is_satisfied()` gets a chance to absorb bad data. One non-numeric
    bunkmate grade ("K", "Pre-K", null-as-string) currently aborts the
    whole validation pass instead of degrading to "unsatisfied".
    """
    session = _mock_session(cm_id="10000001", name="BunkmateGradeHygieneFixture")
    # Requester has a valid grade; its bunkmate has a non-numeric grade.
    requester = _mock_person("20001", grade=5)
    bad_grade_bunkmate = MockPerson(campminder_id="20002", name="Camper20002", grade=cast(Any, "K"))
    persons = [requester, bad_grade_bunkmate]
    bunks = [_mock_bunk("30001")]
    assignments = [
        _mock_assignment("20001", "30001"),
        _mock_assignment("20002", "30001"),  # bunkmate of 20001
    ]
    # An age_preference request — exercises the bunkmate_grades_canon precompute path.
    requests = [
        _mock_request(
            "20001",
            "0",
            SourceField.SOCIALIZE_WITH,
            "family",
            request_type="age_preference",
        ),
    ]

    # Must not raise — bad grade should be skipped, not aborted.
    result = BunkingValidator().validate_bunking(
        session=session,
        bunks=bunks,
        assignments=assignments,
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )
    assert result.statistics is not None


# ─── TG-6: camper-level two-tier MP coverage ─────────────────────────────────


def test_mp_camper_level_coverage_at_least_one_and_all() -> None:
    """Camper-level two-tier MP coverage: at-least-one vs all satisfied.

    3 campers (Emma Johnson, Liam Garcia, Olivia Chen), each with 2 MP requests.
    - Emma Johnson (pid=1): 2/2 satisfied → counts in BOTH tiers
    - Liam Garcia  (pid=4): 1/2 satisfied → counts in "at least one" only
    - Olivia Chen  (pid=7): 0/2 satisfied → counts in NEITHER tier

    Expected:
        mp_campers_total                     = 3
        mp_campers_with_at_least_one_satisfied = 2  (Emma + Liam)
        mp_campers_with_all_satisfied          = 1  (Emma only)
    """
    session = _mock_session(cm_id="10000001", name="Test Session")

    # Three campers + their request targets (targets just need to exist as persons
    # so the validator can resolve them; their own assignments don't matter).
    persons = [
        MockPerson(campminder_id="1", name="Emma Johnson"),
        MockPerson(campminder_id="2", name="Riley Sam"),
        MockPerson(campminder_id="3", name="Samuel Johnson"),
        MockPerson(campminder_id="4", name="Liam Garcia"),
        MockPerson(campminder_id="5", name="Alex Kim"),
        MockPerson(campminder_id="6", name="Jordan Lee"),
        MockPerson(campminder_id="7", name="Olivia Chen"),
        MockPerson(campminder_id="8", name="Casey Morgan"),
        MockPerson(campminder_id="9", name="Taylor Reed"),
    ]

    # Two bunks: alpha holds Emma + her two targets, beta holds Liam + one target.
    bunks = [
        MockBunk(campminder_id="100", name="Alpha"),
        MockBunk(campminder_id="200", name="Beta"),
    ]

    assignments = [
        # Emma Johnson (pid=1): both targets in same bunk → 2/2 satisfied
        MockBunkAssignment(person_cm_id="1", bunk_cm_id="100"),
        MockBunkAssignment(person_cm_id="2", bunk_cm_id="100"),
        MockBunkAssignment(person_cm_id="3", bunk_cm_id="100"),
        # Liam Garcia (pid=4): only first target in same bunk → 1/2 satisfied
        MockBunkAssignment(person_cm_id="4", bunk_cm_id="200"),
        MockBunkAssignment(person_cm_id="5", bunk_cm_id="200"),
        MockBunkAssignment(person_cm_id="6", bunk_cm_id="100"),  # different bunk → unsatisfied
        # Olivia Chen (pid=7): neither target in same bunk → 0/2 satisfied
        MockBunkAssignment(person_cm_id="7", bunk_cm_id="200"),
        MockBunkAssignment(person_cm_id="8", bunk_cm_id="100"),  # different bunk
        MockBunkAssignment(person_cm_id="9", bunk_cm_id="100"),  # different bunk
    ]

    requests = [
        # Emma Johnson: req 1 → Riley Sam (satisfied — both in alpha)
        MockBunkRequest(
            requester_person_cm_id="1",
            requested_person_cm_id="2",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        ),
        # Emma Johnson: req 2 → Samuel Johnson (satisfied — both in alpha)
        MockBunkRequest(
            requester_person_cm_id="1",
            requested_person_cm_id="3",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        ),
        # Liam Garcia: req 1 → Alex Kim (satisfied — both in beta)
        MockBunkRequest(
            requester_person_cm_id="4",
            requested_person_cm_id="5",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        ),
        # Liam Garcia: req 2 → Jordan Lee (unsatisfied — Jordan in alpha, Liam in beta)
        MockBunkRequest(
            requester_person_cm_id="4",
            requested_person_cm_id="6",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        ),
        # Olivia Chen: req 1 → Casey Morgan (unsatisfied — Casey in alpha, Olivia in beta)
        MockBunkRequest(
            requester_person_cm_id="7",
            requested_person_cm_id="8",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        ),
        # Olivia Chen: req 2 → Taylor Reed (unsatisfied — Taylor in alpha, Olivia in beta)
        MockBunkRequest(
            requester_person_cm_id="7",
            requested_person_cm_id="9",
            request_type="bunk_with",
            status="resolved",
            source_field=SourceField.BUNK_REQUEST_FORM,
            source="family",
        ),
    ]

    validator = BunkingValidator()
    result = validator.validate_bunking(
        session=session,
        bunks=cast(list[Bunk], bunks),
        assignments=cast(list[BunkAssignment], assignments),
        persons=cast(list[Person], persons),
        requests=cast(list[BunkRequest], requests),
    )
    stats = result.statistics

    assert stats.mp_campers_total == 3
    assert stats.mp_campers_with_at_least_one_satisfied == 2  # Emma + Liam
    assert stats.mp_campers_with_all_satisfied == 1  # Emma only
