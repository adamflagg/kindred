"""Tests for PocketBaseWrapper

Tests cover:
1. WrappedRecordService - filter encoding fixes
2. PocketBaseWrapper - collection wrapping and delegation
"""

from __future__ import annotations

from unittest.mock import Mock

from bunking.sync.bunk_request_processor.data.pocketbase_wrapper import (
    PocketBaseWrapper,
    WrappedRecordService,
)


class TestWrappedRecordService:
    """Tests for WrappedRecordService"""

    def _create_mock_record_service(self):
        """Helper to create a mock RecordService"""
        mock_service = Mock()
        mock_service.client = Mock()
        mock_service.base_path = "/api/collections/test"
        mock_service.collection_id_or_name = "test"
        mock_service.base_crud_path = Mock(return_value="/api/collections/test/records")
        mock_service.decode = Mock(side_effect=lambda x: x)
        return mock_service

    def test_init_copies_original_service_attributes(self):
        """Should copy attributes from original service"""
        mock_service = self._create_mock_record_service()

        wrapped = WrappedRecordService(mock_service)

        assert wrapped.client == mock_service.client
        assert wrapped.base_path == mock_service.base_path
        assert wrapped._original_service == mock_service

    def test_base_crud_path_delegates_to_original(self):
        """Should delegate base_crud_path to original service"""
        mock_service = self._create_mock_record_service()

        wrapped = WrappedRecordService(mock_service)
        result = wrapped.base_crud_path()

        mock_service.base_crud_path.assert_called_once()
        assert result == "/api/collections/test/records"

    def test_decode_delegates_to_original(self):
        """Should delegate decode to original service"""
        mock_service = self._create_mock_record_service()
        test_data = {"id": "test1", "name": "Test"}

        wrapped = WrappedRecordService(mock_service)
        result = wrapped.decode(test_data)

        mock_service.decode.assert_called_once_with(test_data)
        assert result == test_data

    def test_get_list_sends_request_with_params(self):
        """Should send GET request with page and perPage params"""
        mock_service = self._create_mock_record_service()
        mock_service.client.send = Mock(
            return_value={
                "page": 1,
                "perPage": 30,
                "totalItems": 0,
                "totalPages": 0,
                "items": [],
            }
        )

        wrapped = WrappedRecordService(mock_service)
        wrapped.get_list(page=2, per_page=50)

        mock_service.client.send.assert_called_once()
        call_args = mock_service.client.send.call_args
        assert call_args[0][0] == "/api/collections/test/records"
        assert call_args[0][1]["method"] == "GET"
        assert call_args[0][1]["params"]["page"] == 2
        assert call_args[0][1]["params"]["perPage"] == 50

    def test_get_list_includes_filter_in_params(self):
        """Should include filter parameter in request"""
        mock_service = self._create_mock_record_service()
        mock_service.client.send = Mock(
            return_value={
                "page": 1,
                "perPage": 30,
                "totalItems": 0,
                "totalPages": 0,
                "items": [],
            }
        )

        wrapped = WrappedRecordService(mock_service)
        wrapped.get_list(query_params={"filter": "name = 'Test User'"})

        call_args = mock_service.client.send.call_args
        assert call_args[0][1]["params"]["filter"] == "name = 'Test User'"

    def test_get_list_returns_list_result_with_items(self):
        """Should return ListResult with decoded items"""
        mock_service = self._create_mock_record_service()
        mock_service.client.send = Mock(
            return_value={
                "page": 1,
                "perPage": 30,
                "totalItems": 2,
                "totalPages": 1,
                "items": [
                    {"id": "rec1", "name": "Test 1"},
                    {"id": "rec2", "name": "Test 2"},
                ],
            }
        )

        wrapped = WrappedRecordService(mock_service)
        result = wrapped.get_list()

        assert result.page == 1
        assert result.per_page == 30
        assert result.total_items == 2
        assert result.total_pages == 1
        assert len(result.items) == 2
        assert result.items[0]["id"] == "rec1"

    def test_get_list_falls_back_to_original_on_error(self):
        """Should fall back to original service on error"""
        mock_service = self._create_mock_record_service()
        mock_service.client.send = Mock(side_effect=Exception("API error"))
        mock_service.get_list = Mock(return_value=Mock(page=1, per_page=30, total_items=0, total_pages=0, items=[]))

        wrapped = WrappedRecordService(mock_service)
        wrapped.get_list()

        mock_service.get_list.assert_called_once()

    def test_get_full_list_uses_fixed_get_list(self):
        """Should use wrapped get_list for pagination"""
        mock_service = self._create_mock_record_service()

        # First page returns items, second page returns empty (signals end)
        call_count = [0]

        def mock_send(path, options):
            call_count[0] += 1
            if call_count[0] == 1:
                return {
                    "page": 1,
                    "perPage": 100,
                    "totalItems": 50,
                    "totalPages": 1,
                    "items": [{"id": f"rec{i}"} for i in range(50)],
                }
            else:
                return {
                    "page": 2,
                    "perPage": 100,
                    "totalItems": 50,
                    "totalPages": 1,
                    "items": [],
                }

        mock_service.client.send = Mock(side_effect=mock_send)

        wrapped = WrappedRecordService(mock_service)
        result = wrapped.get_full_list(batch=100)

        assert len(result) == 50

    def test_get_full_list_paginates_through_all_records(self):
        """Should fetch all pages until no more items"""
        mock_service = self._create_mock_record_service()

        call_count = [0]

        def mock_send(path, options):
            call_count[0] += 1
            page = options["params"]["page"]
            if page == 1:
                return {
                    "page": 1,
                    "perPage": 2,
                    "totalItems": 5,
                    "totalPages": 3,
                    "items": [{"id": "rec1"}, {"id": "rec2"}],
                }
            elif page == 2:
                return {
                    "page": 2,
                    "perPage": 2,
                    "totalItems": 5,
                    "totalPages": 3,
                    "items": [{"id": "rec3"}, {"id": "rec4"}],
                }
            else:
                return {
                    "page": 3,
                    "perPage": 2,
                    "totalItems": 5,
                    "totalPages": 3,
                    "items": [{"id": "rec5"}],
                }

        mock_service.client.send = Mock(side_effect=mock_send)

        wrapped = WrappedRecordService(mock_service)
        result = wrapped.get_full_list(batch=2)

        assert len(result) == 5
        assert call_count[0] == 3

    def test_getattr_delegates_to_original_service(self):
        """Should delegate unknown attributes to original service"""
        mock_service = self._create_mock_record_service()
        mock_service.custom_method = Mock(return_value="custom result")

        wrapped = WrappedRecordService(mock_service)
        result = wrapped.custom_method()

        assert result == "custom result"
        mock_service.custom_method.assert_called_once()


class TestPocketBaseWrapper:
    """Tests for PocketBaseWrapper"""

    def test_init_stores_client(self):
        """Should store the original client"""
        mock_client = Mock()

        wrapper = PocketBaseWrapper(mock_client)

        assert wrapper._client == mock_client

    def test_collection_returns_wrapped_service(self):
        """Should return WrappedRecordService for collection"""
        mock_client = Mock()
        mock_service = Mock()
        mock_service.client = mock_client
        mock_service.base_path = "/api/collections/test"
        mock_client.collection = Mock(return_value=mock_service)

        wrapper = PocketBaseWrapper(mock_client)
        result = wrapper.collection("test_collection")

        assert isinstance(result, WrappedRecordService)
        mock_client.collection.assert_called_once_with("test_collection")

    def test_collection_caches_wrapped_services(self):
        """Should cache wrapped services to avoid re-wrapping"""
        mock_client = Mock()
        mock_service = Mock()
        mock_service.client = mock_client
        mock_service.base_path = "/api/collections/test"
        mock_client.collection = Mock(return_value=mock_service)

        wrapper = PocketBaseWrapper(mock_client)
        result1 = wrapper.collection("test_collection")
        result2 = wrapper.collection("test_collection")

        # Same instance should be returned
        assert result1 is result2
        # Original collection should only be called once
        assert mock_client.collection.call_count == 1

    def test_collection_creates_separate_wrappers_per_collection(self):
        """Should create separate wrappers for different collections"""
        mock_client = Mock()

        def create_mock_service(name):
            mock = Mock()
            mock.client = mock_client
            mock.base_path = f"/api/collections/{name}"
            return mock

        mock_client.collection = Mock(side_effect=create_mock_service)

        wrapper = PocketBaseWrapper(mock_client)
        result1 = wrapper.collection("collection1")
        result2 = wrapper.collection("collection2")

        assert result1 is not result2
        assert mock_client.collection.call_count == 2

    def test_getattr_delegates_to_original_client(self):
        """Should delegate unknown attributes to original client"""
        mock_client = Mock()
        mock_client.auth_store = Mock(token="test-token")
        mock_client.base_url = "http://localhost:8090"

        wrapper = PocketBaseWrapper(mock_client)

        assert wrapper.auth_store.token == "test-token"
        assert wrapper.base_url == "http://localhost:8090"

    def test_getattr_delegates_methods_to_original_client(self):
        """Should delegate method calls to original client"""
        mock_client = Mock()
        mock_client.health = Mock(return_value={"code": 200, "message": "OK"})

        wrapper = PocketBaseWrapper(mock_client)
        result = wrapper.health()

        assert result == {"code": 200, "message": "OK"}
        mock_client.health.assert_called_once()


class TestFilterEncodingFix:
    """Tests specifically for the URL encoding issue fix"""

    def test_filter_with_spaces_is_preserved(self):
        """Filter with spaces should be sent correctly"""
        mock_service = Mock()
        mock_service.client = Mock()
        mock_service.base_path = "/api/collections/test"
        mock_service.base_crud_path = Mock(return_value="/api/collections/test/records")
        mock_service.decode = Mock(side_effect=lambda x: x)
        mock_service.client.send = Mock(
            return_value={
                "page": 1,
                "perPage": 30,
                "totalItems": 0,
                "totalPages": 0,
                "items": [],
            }
        )

        wrapped = WrappedRecordService(mock_service)
        wrapped.get_list(query_params={"filter": "name = 'Test User'"})

        call_args = mock_service.client.send.call_args
        # The filter should be passed to the client - the client handles encoding
        assert call_args[0][1]["params"]["filter"] == "name = 'Test User'"

    def test_filter_with_special_characters_is_preserved(self):
        """Filter with special characters should be preserved"""
        mock_service = Mock()
        mock_service.client = Mock()
        mock_service.base_path = "/api/collections/test"
        mock_service.base_crud_path = Mock(return_value="/api/collections/test/records")
        mock_service.decode = Mock(side_effect=lambda x: x)
        mock_service.client.send = Mock(
            return_value={
                "page": 1,
                "perPage": 30,
                "totalItems": 0,
                "totalPages": 0,
                "items": [],
            }
        )

        wrapped = WrappedRecordService(mock_service)
        complex_filter = "year = 2025 && (field = 'bunk_with' || field = 'not_bunk_with')"
        wrapped.get_list(query_params={"filter": complex_filter})

        call_args = mock_service.client.send.call_args
        assert call_args[0][1]["params"]["filter"] == complex_filter

    def test_multiple_query_params_are_preserved(self):
        """Multiple query params should all be preserved"""
        mock_service = Mock()
        mock_service.client = Mock()
        mock_service.base_path = "/api/collections/test"
        mock_service.base_crud_path = Mock(return_value="/api/collections/test/records")
        mock_service.decode = Mock(side_effect=lambda x: x)
        mock_service.client.send = Mock(
            return_value={
                "page": 1,
                "perPage": 30,
                "totalItems": 0,
                "totalPages": 0,
                "items": [],
            }
        )

        wrapped = WrappedRecordService(mock_service)
        wrapped.get_list(
            page=2,
            per_page=50,
            query_params={
                "filter": "year = 2025",
                "expand": "requester",
                "sort": "-updated",
            },
        )

        call_args = mock_service.client.send.call_args
        params = call_args[0][1]["params"]
        assert params["page"] == 2
        assert params["perPage"] == 50
        assert params["filter"] == "year = 2025"
        assert params["expand"] == "requester"
        assert params["sort"] == "-updated"
