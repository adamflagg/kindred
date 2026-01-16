"""Tests for OriginalRequestsLoader

Tests cover:
1. Person session cache loading
2. Request fetching with filters
3. Conversion to orchestrator format
4. Mark as processed functionality
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import Mock, patch

from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
    OriginalRequest,
    OriginalRequestsLoader,
)


class TestOriginalRequest:
    """Tests for OriginalRequest dataclass"""

    def test_source_field_maps_correctly(self):
        """Should map internal field names to source field names"""
        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name=None,
            grade=5,
            year=2025,
            field="bunk_with",
            content="wants to bunk with Sarah",
            processed=None,
            created=datetime.now(),
            updated=datetime.now(),
        )

        # Verify field mapping - bunk_with maps to "Share Bunk With" per constants.py
        assert req.source_field == "Share Bunk With"

    def test_needs_processing_when_never_processed(self):
        """Should return True when processed is None"""
        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name=None,
            grade=5,
            year=2025,
            field="bunk_with",
            content="wants to bunk with Sarah",
            processed=None,
            created=datetime.now(),
            updated=datetime.now(),
        )

        assert req.needs_processing is True

    def test_needs_processing_when_updated_after_processed(self):
        """Should return True when updated > processed"""
        processed_time = datetime(2025, 1, 1, 12, 0, 0)
        updated_time = datetime(2025, 1, 2, 12, 0, 0)  # Later

        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name=None,
            grade=5,
            year=2025,
            field="bunk_with",
            content="wants to bunk with Sarah",
            processed=processed_time,
            created=datetime.now(),
            updated=updated_time,
        )

        assert req.needs_processing is True

    def test_does_not_need_processing_when_processed_after_updated(self):
        """Should return False when processed >= updated"""
        updated_time = datetime(2025, 1, 1, 12, 0, 0)
        processed_time = datetime(2025, 1, 2, 12, 0, 0)  # Later

        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name=None,
            grade=5,
            year=2025,
            field="bunk_with",
            content="wants to bunk with Sarah",
            processed=processed_time,
            created=datetime.now(),
            updated=updated_time,
        )

        assert req.needs_processing is False

    def test_to_orchestrator_format_includes_required_fields(self):
        """Should convert to orchestrator dict format with all required fields"""
        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name="Testy",
            grade=5,
            year=2025,
            field="bunk_with",
            content="wants to bunk with Sarah",
            processed=None,
            created=datetime.now(),
            updated=datetime.now(),
        )

        result = req.to_orchestrator_format(session_cm_id=9876543)

        assert result["requester_cm_id"] == 12345
        assert result["first_name"] == "Test"
        assert result["last_name"] == "User"
        assert result["preferred_name"] == "Testy"
        assert result["Grade"] == 5
        assert result["year"] == 2025
        assert result["share_bunk_with"] == "wants to bunk with Sarah"
        assert result["_original_request_id"] == "test1"
        assert result["_field"] == "bunk_with"

    def test_to_orchestrator_format_maps_not_bunk_with(self):
        """Should map not_bunk_with to do_not_share_bunk_with"""
        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name=None,
            grade=5,
            year=2025,
            field="not_bunk_with",
            content="not with Jake",
            processed=None,
            created=datetime.now(),
            updated=datetime.now(),
        )

        result = req.to_orchestrator_format(session_cm_id=9876543)

        assert result["do_not_share_bunk_with"] == "not with Jake"

    def test_to_orchestrator_format_maps_bunking_notes(self):
        """Should map bunking_notes to bunking_notes_notes"""
        req = OriginalRequest(
            id="test1",
            _requester_ref="person_123",
            requester_cm_id=12345,
            first_name="Test",
            last_name="User",
            preferred_name=None,
            grade=5,
            year=2025,
            field="bunking_notes",
            content="prefers quiet cabin",
            processed=None,
            created=datetime.now(),
            updated=datetime.now(),
        )

        result = req.to_orchestrator_format(session_cm_id=9876543)

        assert result["bunking_notes_notes"] == "prefers quiet cabin"


class TestOriginalRequestsLoader:
    """Tests for OriginalRequestsLoader class"""

    def _create_mock_pocketbase(self):
        """Helper to create a mock PocketBase client"""
        mock_pb = Mock()
        mock_collection = Mock()
        mock_pb.collection = Mock(return_value=mock_collection)
        return mock_pb, mock_collection

    def test_init_sets_year_and_session_filter(self):
        """Should store year and session filter on initialization"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch.object(OriginalRequestsLoader, "__init__", lambda self, pb, year, session_cm_ids=None: None):
            loader = OriginalRequestsLoader.__new__(OriginalRequestsLoader)
            loader.pb = mock_pb
            loader.year = 2025
            loader.session_cm_ids = [1234567, 1234568]

        assert loader.year == 2025
        assert loader.session_cm_ids == [1234567, 1234568]

    def test_load_persons_cache_builds_session_mapping(self):
        """Should build person_sessions dict from attendees"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        # Create mock attendee records with expand data
        mock_person = Mock()
        mock_person.cm_id = 12345
        mock_person.first_name = "Test"
        mock_person.last_name = "User"

        mock_session = Mock()
        mock_session.cm_id = 9876543

        mock_attendee = Mock()
        mock_attendee.year = 2025
        mock_attendee.expand = {"person": mock_person, "session": mock_session}

        mock_collection.get_full_list = Mock(return_value=[mock_attendee])

        # Create loader with mocked SessionRepository
        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {9876543}

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.load_persons_cache()

        assert 12345 in loader._person_sessions
        assert 9876543 in loader._person_sessions[12345]

    def test_load_persons_cache_tracks_previous_year_sessions(self):
        """Should track previous year sessions for disambiguation"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        # Create mock attendee for previous year
        mock_person = Mock()
        mock_person.cm_id = 12345

        mock_session = Mock()
        mock_session.cm_id = 9876543

        mock_attendee = Mock()
        mock_attendee.year = 2024  # Previous year
        mock_attendee.expand = {"person": mock_person, "session": mock_session}

        mock_collection.get_full_list = Mock(return_value=[mock_attendee])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {9876543}

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.load_persons_cache()

        assert 12345 in loader._person_previous_year_sessions
        assert 9876543 in loader._person_previous_year_sessions[12345]

    def test_fetch_requests_filters_by_year_and_unprocessed(self):
        """Should filter for year and processed = ''"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.load_persons_cache()
            loader.fetch_requests_needing_processing(fields=["bunk_with"])

        # Verify filter includes year and processed checks
        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "year = 2025" in filter_str
        assert "processed = ''" in filter_str
        assert "bunk_with" in filter_str

    def test_fetch_requests_with_limit_uses_get_list(self):
        """Should use get_list with per_page when limit is specified"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_list_result = Mock()
        mock_list_result.items = []
        mock_collection.get_list = Mock(return_value=mock_list_result)
        mock_collection.get_full_list = Mock(return_value=[])  # For load_persons_cache

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.load_persons_cache()
            loader.fetch_requests_needing_processing(fields=["bunk_with"], limit=10)

        mock_collection.get_list.assert_called_once()
        call_args = mock_collection.get_list.call_args
        assert call_args[1]["per_page"] == 10

    def test_fetch_requests_filters_by_session_when_specified(self):
        """Should filter requests to only persons in target sessions"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        # Create mock record with expand data
        mock_person = Mock()
        mock_person.cm_id = 12345
        mock_person.first_name = "Test"
        mock_person.last_name = "User"
        mock_person.preferred_name = None
        mock_person.grade = 5

        mock_record = Mock()
        mock_record.id = "rec1"
        mock_record.requester = "person_ref"
        mock_record.year = 2025
        mock_record.field = "bunk_with"
        mock_record.content = "wants Sarah"
        mock_record.processed = ""
        mock_record.created = "2025-01-01T12:00:00Z"
        mock_record.updated = "2025-01-01T12:00:00Z"
        mock_record.expand = {"requester": mock_person}

        mock_collection.get_full_list = Mock(return_value=[mock_record])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {1234567}

            loader = OriginalRequestsLoader(mock_pb, year=2025, session_cm_ids=[1234567])
            loader._person_sessions = {12345: [1234567]}  # Person in target session

            results = loader.fetch_requests_needing_processing(fields=["bunk_with"])

        assert len(results) == 1
        assert results[0].requester_cm_id == 12345

    def test_convert_to_orchestrator_input_groups_by_person(self):
        """Should group multiple fields for same person into one row"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {9876543}

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader._person_sessions = {12345: [9876543]}

            # Create two requests for same person (different fields)
            req1 = OriginalRequest(
                id="rec1",
                _requester_ref="person_ref",
                requester_cm_id=12345,
                first_name="Test",
                last_name="User",
                preferred_name=None,
                grade=5,
                year=2025,
                field="bunk_with",
                content="wants Sarah",
                processed=None,
                created=datetime.now(),
                updated=datetime.now(),
            )
            req2 = OriginalRequest(
                id="rec2",
                _requester_ref="person_ref",
                requester_cm_id=12345,
                first_name="Test",
                last_name="User",
                preferred_name=None,
                grade=5,
                year=2025,
                field="not_bunk_with",
                content="not Jake",
                processed=None,
                created=datetime.now(),
                updated=datetime.now(),
            )

            result = loader.convert_to_orchestrator_input([req1, req2])

        assert len(result) == 1  # Grouped into one row
        assert result[0]["share_bunk_with"] == "wants Sarah"
        assert result[0]["do_not_share_bunk_with"] == "not Jake"
        assert result[0]["_original_request_ids"]["bunk_with"] == "rec1"
        assert result[0]["_original_request_ids"]["not_bunk_with"] == "rec2"

    def test_convert_to_orchestrator_skips_persons_not_in_sessions(self):
        """Should skip persons not enrolled in target sessions"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {9876543}

            loader = OriginalRequestsLoader(
                mock_pb,
                year=2025,
                session_cm_ids=[9999999],  # Different session
            )
            loader._person_sessions = {12345: [9876543]}  # Person in different session

            req = OriginalRequest(
                id="rec1",
                _requester_ref="person_ref",
                requester_cm_id=12345,
                first_name="Test",
                last_name="User",
                preferred_name=None,
                grade=5,
                year=2025,
                field="bunk_with",
                content="wants Sarah",
                processed=None,
                created=datetime.now(),
                updated=datetime.now(),
            )

            result = loader.convert_to_orchestrator_input([req])

        assert len(result) == 0  # Skipped because not in target session

    def test_mark_as_processed_updates_timestamp(self):
        """Should update processed timestamp for each record"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.update = Mock()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            count = loader.mark_as_processed(["rec1", "rec2", "rec3"])

        assert count == 3
        assert mock_collection.update.call_count == 3

    def test_mark_as_processed_returns_zero_for_empty_list(self):
        """Should return 0 when no IDs provided"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            count = loader.mark_as_processed([])

        assert count == 0

    def test_mark_as_processed_handles_errors_gracefully(self):
        """Should continue on error and return partial success count"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        # First call succeeds, second fails, third succeeds
        mock_collection.update = Mock(side_effect=[None, Exception("Update failed"), None])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            count = loader.mark_as_processed(["rec1", "rec2", "rec3"])

        assert count == 2  # Only 2 succeeded

    def test_get_session_for_person_returns_first_session(self):
        """Should return first session for person"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader._person_sessions = {12345: [111, 222]}

            result = loader.get_session_for_person(12345)

        assert result == 111

    def test_get_session_for_person_returns_none_when_not_found(self):
        """Should return None when person has no sessions"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader._person_sessions = {}

            result = loader.get_session_for_person(99999)

        assert result is None

    def test_get_previous_year_session_returns_session(self):
        """Should return previous year session for disambiguation"""
        mock_pb, _ = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader._person_previous_year_sessions = {12345: [333]}

            result = loader.get_previous_year_session(12345)

        assert result == 333

    def test_mark_row_as_processed_uses_original_request_ids(self):
        """Should mark all original requests from row metadata"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.update = Mock()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)

            row = {
                "requester_cm_id": 12345,
                "_original_request_ids": {
                    "bunk_with": "rec1",
                    "not_bunk_with": "rec2",
                },
            }

            count = loader.mark_row_as_processed(row)

        assert count == 2
        assert mock_collection.update.call_count == 2


class TestClearProcessedFlags:
    """Tests for clear_processed_flags() method (mirrors Go's clearProcessedFlags).

    This method clears the 'processed' field on original_bunk_requests to force
    reprocessing. It uses the same filter/sort/limit logic as Go.
    """

    def _create_mock_pocketbase(self):
        """Helper to create a mock PocketBase client"""
        mock_pb = Mock()
        mock_collection = Mock()
        mock_pb.collection = Mock(return_value=mock_collection)
        return mock_pb, mock_collection

    def _create_mock_record(self, record_id: str, field: str = "bunk_with", cm_id: int = 12345) -> Mock:
        """Helper to create a mock record with expand data"""
        mock_person = Mock()
        mock_person.cm_id = cm_id

        mock_record = Mock()
        mock_record.id = record_id
        mock_record.field = field
        mock_record.expand = {"requester": mock_person}
        return mock_record

    def test_clears_processed_flags_and_returns_count(self):
        """Should clear processed field on matching records and return count"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        # Create mock records that have been processed
        mock_records = [
            self._create_mock_record("rec1"),
            self._create_mock_record("rec2"),
            self._create_mock_record("rec3"),
        ]
        mock_collection.get_full_list = Mock(return_value=mock_records)
        mock_collection.update = Mock()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            cleared = loader.clear_processed_flags(fields=["bunk_with"])

        assert cleared == 3
        assert mock_collection.update.call_count == 3
        # Verify each update sets processed to empty string
        for call in mock_collection.update.call_args_list:
            assert call[0][1] == {"processed": ""}

    def test_filters_by_processed_not_empty(self):
        """Should only clear records where processed != '' (already processed)"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.clear_processed_flags(fields=["bunk_with"])

        # Verify filter includes processed != ''
        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "processed != ''" in filter_str
        assert "year = 2025" in filter_str

    def test_filters_by_specified_fields(self):
        """Should filter to only specified source fields"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.clear_processed_flags(fields=["bunk_with", "not_bunk_with"])

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        assert "field = 'bunk_with'" in filter_str
        assert "field = 'not_bunk_with'" in filter_str

    def test_filters_by_session_when_specified(self):
        """Should filter to persons in target sessions"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {1234567}

            loader = OriginalRequestsLoader(mock_pb, year=2025, session_cm_ids=[1234567])
            loader._person_sessions = {12345: [1234567], 67890: [1234567]}
            loader.clear_processed_flags(fields=["bunk_with"])

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        # Should include requester.cm_id filter for persons in sessions
        assert "requester.cm_id = 12345" in filter_str or "requester.cm_id = 67890" in filter_str

    def test_respects_limit_parameter(self):
        """Should only clear up to limit records"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        # Return 10 records but limit to 5
        mock_records = [self._create_mock_record(f"rec{i}") for i in range(10)]
        mock_list_result = Mock()
        mock_list_result.items = mock_records[:5]  # get_list returns limited
        mock_collection.get_list = Mock(return_value=mock_list_result)
        mock_collection.update = Mock()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            cleared = loader.clear_processed_flags(fields=["bunk_with"], limit=5)

        assert cleared == 5
        assert mock_collection.update.call_count == 5

    def test_sorts_by_updated_descending(self):
        """Should sort by -updated (most recently updated first)"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.clear_processed_flags(fields=["bunk_with"])

        call_args = mock_collection.get_full_list.call_args
        assert call_args[1]["query_params"]["sort"] == "-updated"

    def test_returns_zero_when_no_records_match(self):
        """Should return 0 when no records match the filter"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            cleared = loader.clear_processed_flags(fields=["bunk_with"])

        assert cleared == 0

    def test_continues_on_update_error(self):
        """Should continue clearing other records if one update fails"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        mock_records = [
            self._create_mock_record("rec1"),
            self._create_mock_record("rec2"),
            self._create_mock_record("rec3"),
        ]
        mock_collection.get_full_list = Mock(return_value=mock_records)
        # Second update fails
        mock_collection.update = Mock(side_effect=[None, Exception("Update failed"), None])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            cleared = loader.clear_processed_flags(fields=["bunk_with"])

        assert cleared == 2  # Only 2 succeeded

    def test_returns_zero_when_no_persons_in_sessions(self):
        """Should return 0 if session filter yields no valid persons"""
        mock_pb, mock_collection = self._create_mock_pocketbase()

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = {9999999}

            loader = OriginalRequestsLoader(mock_pb, year=2025, session_cm_ids=[9999999])
            loader._person_sessions = {}  # No persons in that session
            cleared = loader.clear_processed_flags(fields=["bunk_with"])

        assert cleared == 0

    def test_uses_default_fields_when_none_specified(self):
        """Should use AI_PROCESSING_FIELDS when fields is None"""
        mock_pb, mock_collection = self._create_mock_pocketbase()
        mock_collection.get_full_list = Mock(return_value=[])

        with patch(
            "bunking.sync.bunk_request_processor.integration.original_requests_loader.SessionRepository"
        ) as mock_session_repo:
            mock_session_repo.return_value.get_valid_bunking_session_ids.return_value = set()

            loader = OriginalRequestsLoader(mock_pb, year=2025)
            loader.clear_processed_flags()  # No fields specified

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args[1]["query_params"]["filter"]
        # Should include all default fields
        assert "bunk_with" in filter_str
        assert "not_bunk_with" in filter_str
        assert "bunking_notes" in filter_str
        assert "internal_notes" in filter_str
        assert "socialize_with" in filter_str
