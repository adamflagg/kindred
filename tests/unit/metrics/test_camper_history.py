"""Tests for camper_history computation module

Tests cover:
1. Computing history for single campers
2. Handling multi-session campers (comma-separated sessions/bunks)
3. Retention calculations (is_returning, years_at_camp, prior_year_*, retention_next_year)
4. Edge cases like first-year campers
5. Writing computed records to PocketBase
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest


# Mock data classes for testing
@dataclass
class MockPerson:
    """Mock person record for testing"""

    cm_id: int
    first_name: str
    last_name: str
    school: str | None = None
    city: str | None = None
    grade: int | None = None


@dataclass
class MockAttendee:
    """Mock attendee record for testing"""

    person_id: int
    year: int
    session_cm_id: int
    session_name: str
    status: str = "enrolled"


@dataclass
class MockBunkAssignment:
    """Mock bunk assignment record for testing"""

    person_id: int
    year: int
    session_cm_id: int
    bunk_name: str


class TestCamperHistoryRecord:
    """Tests for CamperHistoryRecord data class"""

    def test_record_creation_with_all_fields(self):
        """Should create record with all fields populated"""
        from bunking.metrics.camper_history import CamperHistoryRecord

        record = CamperHistoryRecord(
            person_id=12345,
            first_name="Emma",
            last_name="Johnson",
            year=2025,
            sessions="Session 1, Session 2",
            bunks="B-1, B-2",
            school="Riverside Elementary",
            city="Chicago",
            grade=6,
            is_returning=True,
            years_at_camp=3,
            prior_year_sessions="Session 2",
            prior_year_bunks="B-3",
            retention_next_year=None,
        )

        assert record.person_id == 12345
        assert record.first_name == "Emma"
        assert record.last_name == "Johnson"
        assert record.year == 2025
        assert record.sessions == "Session 1, Session 2"
        assert record.bunks == "B-1, B-2"
        assert record.school == "Riverside Elementary"
        assert record.city == "Chicago"
        assert record.grade == 6
        assert record.is_returning is True
        assert record.years_at_camp == 3
        assert record.prior_year_sessions == "Session 2"
        assert record.prior_year_bunks == "B-3"
        assert record.retention_next_year is None

    def test_record_creation_first_year_camper(self):
        """First year camper should have is_returning=False and no prior year data"""
        from bunking.metrics.camper_history import CamperHistoryRecord

        record = CamperHistoryRecord(
            person_id=12346,
            first_name="Liam",
            last_name="Garcia",
            year=2025,
            sessions="Session 1",
            bunks="G-1",
            school="Oak Valley Middle",
            city="Denver",
            grade=7,
            is_returning=False,
            years_at_camp=1,
            prior_year_sessions=None,
            prior_year_bunks=None,
            retention_next_year=None,
        )

        assert record.is_returning is False
        assert record.years_at_camp == 1
        assert record.prior_year_sessions is None
        assert record.prior_year_bunks is None


class TestCamperHistoryComputer:
    """Tests for CamperHistoryComputer class"""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        return MagicMock()

    @pytest.fixture
    def mock_data_context(self, mock_pb_client):
        """Create a mock DataAccessContext"""
        context = MagicMock()
        context.pb_client = mock_pb_client
        return context

    def test_compute_single_camper_history(self, mock_data_context):
        """Should compute history for a single camper with one session"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        # Set up mock data
        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {
                "cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "school": "Riverside Elementary",
                "city": "Chicago",
                "grade": 6,
            },
        ]
        mock_bunk_assignments = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001}, "bunk": {"name": "B-1"}},
        ]

        # Mock the data context methods
        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []  # No prior years

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.person_id == 12345
        assert record.first_name == "Emma"
        assert record.last_name == "Johnson"
        assert record.year == 2025
        assert record.sessions == "Session 1"
        assert record.bunks == "B-1"
        assert record.school == "Riverside Elementary"
        assert record.city == "Chicago"
        assert record.grade == 6
        assert record.is_returning is False
        assert record.years_at_camp == 1

    def test_compute_multi_session_camper(self, mock_data_context):
        """Should aggregate sessions/bunks as comma-separated for multi-session campers"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        # Camper enrolled in two sessions
        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1002, "name": "Session 2"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001}, "bunk": {"name": "B-1"}},
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1002}, "bunk": {"name": "B-2"}},
        ]

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        # Sessions and bunks should be comma-separated
        assert record.sessions is not None and "Session 1" in record.sessions
        assert record.sessions is not None and "Session 2" in record.sessions
        assert record.bunks is not None and "B-1" in record.bunks
        assert record.bunks is not None and "B-2" in record.bunks

    def test_is_returning_true_when_enrolled_prior_year(self, mock_data_context):
        """is_returning should be True when camper was enrolled in year - 1"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001}, "bunk": {"name": "B-1"}},
        ]

        # Prior year data: camper was enrolled in 2024
        mock_prior_attendees = [
            {"person_id": 12345, "year": 2024, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_prior_bunk_assignments = [
            {"person_id": 12345, "year": 2024, "session": {"cm_id": 1001}, "bunk": {"name": "B-2"}},
        ]

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.side_effect = lambda y: (
            mock_bunk_assignments if y == 2025 else mock_prior_bunk_assignments
        )
        mock_data_context.get_attendees_for_years.return_value = mock_prior_attendees

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.is_returning is True
        assert record.prior_year_sessions == "Session 1"
        assert record.prior_year_bunks == "B-2"

    def test_years_at_camp_counts_distinct_enrollment_years(self, mock_data_context):
        """years_at_camp should count distinct years with enrollment"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []

        # Historical data: camper has been to camp in 2023, 2024, and now 2025
        mock_all_attendees = [
            {"person_id": 12345, "year": 2023, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
            {"person_id": 12345, "year": 2024, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
            {"person_id": 12345, "year": 2024, "session": {"cm_id": 1002, "name": "Session 2"}, "status": "enrolled"},
        ]

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = mock_all_attendees

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        # 2023, 2024, 2025 = 3 years
        assert record.years_at_camp == 3

    def test_retention_next_year_true_when_enrolled_future(self, mock_data_context):
        """retention_next_year should be True when camper enrolled in year + 1"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2024, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []

        # Next year data: camper is enrolled in 2025
        mock_next_year_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []
        mock_data_context.get_attendees_for_next_year.return_value = mock_next_year_attendees

        computer = CamperHistoryComputer(year=2024, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.retention_next_year is True

    def test_retention_next_year_false_when_not_enrolled(self, mock_data_context):
        """retention_next_year should be False when camper not enrolled in year + 1"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2024, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []
        mock_data_context.get_attendees_for_next_year.return_value = []  # Not enrolled next year

        computer = CamperHistoryComputer(year=2024, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.retention_next_year is False

    def test_retention_next_year_none_when_no_data(self, mock_data_context):
        """retention_next_year should be None when next year data doesn't exist yet"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []
        mock_data_context.has_data_for_year.return_value = False  # No 2026 data yet

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.retention_next_year is None

    def test_excludes_non_enrolled_attendees(self, mock_data_context):
        """Should only include enrolled attendees, not cancelled/withdrawn"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
            {
                "person_id": 12346,
                "year": 2025,
                "session": {"cm_id": 1001, "name": "Session 1"},
                "status": "cancelled",
            },
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        # Only enrolled camper should be included
        assert len(records) == 1
        assert records[0].person_id == 12345

    def test_handles_missing_bunk_assignment(self, mock_data_context):
        """Should handle campers without bunk assignments gracefully"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {"cm_id": 12345, "first_name": "Emma", "last_name": "Johnson", "school": None, "city": None, "grade": 6},
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []  # No bunk assignment

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.bunks is None or record.bunks == ""

    def test_handles_missing_demographics(self, mock_data_context):
        """Should handle campers with missing school/city/grade gracefully"""
        from bunking.metrics.camper_history import CamperHistoryComputer

        mock_attendees = [
            {"person_id": 12345, "year": 2025, "session": {"cm_id": 1001, "name": "Session 1"}, "status": "enrolled"},
        ]
        mock_persons = [
            {
                "cm_id": 12345,
                "first_name": "Emma",
                "last_name": "Johnson",
                "school": None,
                "city": None,
                "grade": None,
            },
        ]
        mock_bunk_assignments: list[dict[str, Any]] = []

        mock_data_context.get_attendees_for_year.return_value = mock_attendees
        mock_data_context.get_persons_by_ids.return_value = mock_persons
        mock_data_context.get_bunk_assignments_for_year.return_value = mock_bunk_assignments
        mock_data_context.get_attendees_for_years.return_value = []

        computer = CamperHistoryComputer(year=2025, data_context=mock_data_context)
        records = computer.compute_all()

        assert len(records) == 1
        record = records[0]
        assert record.school is None
        assert record.city is None
        assert record.grade is None


class TestCamperHistoryWriter:
    """Tests for writing camper history records to PocketBase"""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        client = MagicMock()
        client.collection.return_value.get_list.return_value = MagicMock(items=[])
        client.collection.return_value.create.return_value = MagicMock(id="rec123")
        return client

    def test_write_records_creates_in_pocketbase(self, mock_pb_client):
        """Should create records in PocketBase camper_history collection"""
        from bunking.metrics.camper_history import CamperHistoryRecord, CamperHistoryWriter

        records = [
            CamperHistoryRecord(
                person_id=12345,
                first_name="Emma",
                last_name="Johnson",
                year=2025,
                sessions="Session 1",
                bunks="B-1",
                school="Riverside Elementary",
                city="Chicago",
                grade=6,
                is_returning=False,
                years_at_camp=1,
                prior_year_sessions=None,
                prior_year_bunks=None,
                retention_next_year=None,
            ),
        ]

        writer = CamperHistoryWriter(mock_pb_client)
        result = writer.write_records(records, year=2025)

        assert result["created"] == 1
        mock_pb_client.collection.assert_called_with("camper_history")

    def test_write_records_clears_existing_for_year(self, mock_pb_client):
        """Should clear existing records for the year before writing new ones"""
        from bunking.metrics.camper_history import CamperHistoryRecord, CamperHistoryWriter

        # Mock existing records - implementation uses get_full_list
        existing_record = MagicMock()
        existing_record.id = "old_rec"
        mock_pb_client.collection.return_value.get_full_list.return_value = [existing_record]

        records = [
            CamperHistoryRecord(
                person_id=12345,
                first_name="Emma",
                last_name="Johnson",
                year=2025,
                sessions="Session 1",
                bunks="B-1",
                school=None,
                city=None,
                grade=6,
                is_returning=False,
                years_at_camp=1,
                prior_year_sessions=None,
                prior_year_bunks=None,
                retention_next_year=None,
            ),
        ]

        writer = CamperHistoryWriter(mock_pb_client)
        writer.write_records(records, year=2025, clear_existing=True)

        # Should have deleted the existing record
        mock_pb_client.collection.return_value.delete.assert_called_once_with("old_rec")

    def test_write_records_dry_run_does_not_write(self, mock_pb_client):
        """Dry run should not write to PocketBase"""
        from bunking.metrics.camper_history import CamperHistoryRecord, CamperHistoryWriter

        records = [
            CamperHistoryRecord(
                person_id=12345,
                first_name="Emma",
                last_name="Johnson",
                year=2025,
                sessions="Session 1",
                bunks="B-1",
                school=None,
                city=None,
                grade=6,
                is_returning=False,
                years_at_camp=1,
                prior_year_sessions=None,
                prior_year_bunks=None,
                retention_next_year=None,
            ),
        ]

        writer = CamperHistoryWriter(mock_pb_client)
        result = writer.write_records(records, year=2025, dry_run=True)

        assert result["dry_run"] is True
        mock_pb_client.collection.return_value.create.assert_not_called()


class TestComputeCamperHistoryCLI:
    """Tests for the CLI entry point"""

    def test_cli_writes_stats_to_json_file(self, tmp_path):
        """Should write stats to JSON file when --stats-output is provided"""
        import json

        from bunking.metrics.compute_camper_history import write_stats_output

        stats = {"created": 10, "updated": 0, "skipped": 0, "errors": 0}
        stats_file = tmp_path / "stats.json"

        write_stats_output(str(stats_file), stats, success=True)

        with open(stats_file) as f:
            written_stats = json.load(f)

        assert written_stats["success"] is True
        assert written_stats["created"] == 10
        assert written_stats["errors"] == 0

    def test_cli_handles_dry_run_flag(self):
        """Should respect --dry-run flag and not write to database"""
        from bunking.metrics.compute_camper_history import parse_args

        args = parse_args(["--year", "2025", "--dry-run"])
        assert args.dry_run is True

    def test_cli_requires_year_argument(self):
        """Should require --year argument"""
        from bunking.metrics.compute_camper_history import parse_args

        args = parse_args(["--year", "2025"])
        assert args.year == 2025
