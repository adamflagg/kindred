"""Interface contract tests for bunk request processor components.

These tests verify that components expose expected interfaces,
catching method renames and signature changes early.

These would have caught the bugs fixed in commit eb9d928:
- TemporalNameCache.populate() vs .initialize() mismatch
- async/sync mismatch in initialize() method
- Missing DataAccessContext.initialize_sync() call
- WrappedRecordService.base_path attribute missing
"""

from __future__ import annotations

import asyncio
from unittest.mock import Mock

import pytest


class TestTemporalNameCacheInterface:
    """Verify TemporalNameCache exposes expected interface."""

    def test_has_initialize_method(self) -> None:
        """TemporalNameCache must have initialize() method."""
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        cache = TemporalNameCache(Mock(), year=2025)
        assert hasattr(cache, "initialize"), "Missing initialize() method"
        assert callable(cache.initialize), "initialize must be callable"

    def test_initialize_is_synchronous(self) -> None:
        """initialize() must be sync (not async) for RepositoryFactory compatibility."""
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        cache = TemporalNameCache(Mock(), year=2025)
        assert not asyncio.iscoroutinefunction(cache.initialize), "initialize() must be synchronous, not async"

    def test_has_lookup_methods(self) -> None:
        """TemporalNameCache must have all lookup methods."""
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        cache = TemporalNameCache(Mock(), year=2025)

        required_methods = [
            "find_by_name",
            "find_by_first_name",
            "find_by_parent_surname",
            "get_person",
            "get_session_info",
            "get_historical_info",
            "get_stats",
            "verify_bunk_together",
        ]

        for method in required_methods:
            assert hasattr(cache, method), f"Missing method: {method}"
            assert callable(getattr(cache, method)), f"{method} must be callable"


class TestDataAccessContextInterface:
    """Verify DataAccessContext exposes expected interface."""

    def test_has_lifecycle_methods(self) -> None:
        """DataAccessContext must have initialize_sync() and close() methods."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        ctx = DataAccessContext(year=2025)

        assert hasattr(ctx, "initialize_sync"), "Missing initialize_sync() method"
        assert callable(ctx.initialize_sync), "initialize_sync must be callable"

        assert hasattr(ctx, "close"), "Missing close() method"
        assert callable(ctx.close), "close must be callable"

    def test_has_repository_properties(self) -> None:
        """DataAccessContext must expose repository properties."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        # Check class-level property definitions
        required_properties = ["persons", "attendees", "requests", "sessions", "pb_client"]

        for prop in required_properties:
            assert hasattr(DataAccessContext, prop), f"Missing property: {prop} on DataAccessContext class"

    def test_supports_context_manager(self) -> None:
        """DataAccessContext must support context manager protocol."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        ctx = DataAccessContext(year=2025)

        # Sync context manager
        assert hasattr(ctx, "__enter__"), "Missing __enter__ for context manager"
        assert hasattr(ctx, "__exit__"), "Missing __exit__ for context manager"

        # Async context manager
        assert hasattr(ctx, "__aenter__"), "Missing __aenter__ for async context manager"
        assert hasattr(ctx, "__aexit__"), "Missing __aexit__ for async context manager"

    def test_raises_when_not_initialized(self) -> None:
        """Accessing repositories before initialize_sync() must raise RuntimeError."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        ctx = DataAccessContext(year=2025)

        with pytest.raises(RuntimeError, match="not initialized"):
            _ = ctx.pb_client


class TestRepositoryFactoryInterface:
    """Verify RepositoryFactory exposes expected interface."""

    def test_has_initialize_method(self) -> None:
        """RepositoryFactory must have initialize() method."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(Mock(), year=2025)

        assert hasattr(factory, "initialize"), "Missing initialize() method"
        assert callable(factory.initialize), "initialize must be callable"

    def test_has_cleanup_method(self) -> None:
        """RepositoryFactory must have cleanup() method."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(Mock(), year=2025)

        assert hasattr(factory, "cleanup"), "Missing cleanup() method"
        assert callable(factory.cleanup), "cleanup must be callable"

    def test_has_repository_getters(self) -> None:
        """RepositoryFactory must have all repository getter methods."""
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        factory = RepositoryFactory(Mock(), year=2025)

        required_getters = [
            "get_person_repository",
            "get_attendee_repository",
            "get_request_repository",
            "get_session_repository",
        ]

        for getter in required_getters:
            assert hasattr(factory, getter), f"Missing getter: {getter}"
            assert callable(getattr(factory, getter)), f"{getter} must be callable"


class TestOrchestratorInterface:
    """Verify RequestOrchestrator exposes expected interface."""

    def test_process_requests_is_async(self) -> None:
        """process_requests() must be async."""
        from bunking.sync.bunk_request_processor.orchestrator import RequestOrchestrator

        assert asyncio.iscoroutinefunction(RequestOrchestrator.process_requests), "process_requests must be async"

    def test_close_is_async(self) -> None:
        """close() must be async."""
        from bunking.sync.bunk_request_processor.orchestrator import RequestOrchestrator

        assert asyncio.iscoroutinefunction(RequestOrchestrator.close), "close must be async"


class TestPocketBaseWrapperInterface:
    """Verify PocketBaseWrapper works with current SDK version."""

    def test_wrapper_provides_collection_method(self) -> None:
        """PocketBaseWrapper must have collection() method."""
        from bunking.sync.bunk_request_processor.data.pocketbase_wrapper import (
            PocketBaseWrapper,
        )
        from pocketbase import PocketBase

        pb = PocketBase("http://127.0.0.1:8090")
        wrapper = PocketBaseWrapper(pb)

        assert hasattr(wrapper, "collection"), "Missing collection() method"
        assert callable(wrapper.collection), "collection must be callable"

    def test_wrapped_record_service_has_crud_methods(self) -> None:
        """WrappedRecordService must expose CRUD methods."""
        from bunking.sync.bunk_request_processor.data.pocketbase_wrapper import (
            PocketBaseWrapper,
        )
        from pocketbase import PocketBase

        pb = PocketBase("http://127.0.0.1:8090")
        wrapper = PocketBaseWrapper(pb)

        collection = wrapper.collection("test")

        required_methods = ["get_list", "get_full_list", "get_one", "create", "update", "delete"]

        for method in required_methods:
            assert hasattr(collection, method), f"Missing method: {method}"

    def test_wrapped_service_does_not_require_base_path(self) -> None:
        """WrappedRecordService must not require base_path attribute.

        This was the bug in PocketBase SDK 0.15.0 - the SDK removed base_path
        but the wrapper tried to copy it.
        """
        from bunking.sync.bunk_request_processor.data.pocketbase_wrapper import (
            WrappedRecordService,
        )
        from pocketbase import PocketBase

        pb = PocketBase("http://127.0.0.1:8090")
        original_service = pb.collection("test")

        # This should not raise AttributeError
        try:
            wrapped = WrappedRecordService(original_service)
            assert wrapped is not None
        except AttributeError as e:
            pytest.fail(f"WrappedRecordService failed to initialize: {e}")


class TestConnectionManagerInterface:
    """Verify ConnectionManager exposes expected interface."""

    def test_has_singleton_pattern(self) -> None:
        """ConnectionManager must implement singleton pattern."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )

        assert hasattr(ConnectionManager, "get_instance"), "Missing get_instance() class method"
        assert hasattr(ConnectionManager, "reset"), "Missing reset() class method"

    def test_has_client_methods(self) -> None:
        """ConnectionManager must provide client access methods."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )

        # Reset to get fresh instance
        ConnectionManager.reset()
        manager = ConnectionManager.get_instance()

        assert hasattr(manager, "get_client"), "Missing get_client() method"
        assert hasattr(manager, "create_isolated_client"), "Missing create_isolated_client() method"

        # Cleanup
        ConnectionManager.reset()
