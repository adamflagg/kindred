"""Interface contract tests for bunk request processor components.

These tests verify critical behavioral contracts that type checking alone
cannot catch (e.g., sync vs async, raises on misuse).

These would have caught the bugs fixed in commit eb9d928:
- async/sync mismatch in initialize() method
- Missing DataAccessContext.initialize_sync() call
"""

import asyncio
from unittest.mock import Mock

import pytest


class TestTemporalNameCacheInterface:
    """Verify TemporalNameCache sync/async contract."""

    def test_initialize_is_synchronous(self) -> None:
        """initialize() must be sync (not async) for RepositoryFactory compatibility."""
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )

        cache = TemporalNameCache(Mock(), year=2025)
        assert not asyncio.iscoroutinefunction(cache.initialize), "initialize() must be synchronous, not async"


class TestDataAccessContextInterface:
    """Verify DataAccessContext behavioral contracts."""

    def test_raises_when_not_initialized(self) -> None:
        """Accessing repositories before initialize_sync() must raise RuntimeError."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        ctx = DataAccessContext(year=2025)

        with pytest.raises(RuntimeError, match="not initialized"):
            _ = ctx.pb_client


class TestOrchestratorInterface:
    """Verify RequestOrchestrator async contract."""

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
