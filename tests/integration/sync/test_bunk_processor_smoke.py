"""Smoke tests for bunk request processor component integration.

These tests verify that all components can be instantiated together
without mocks, catching interface mismatches early.

Requires: SKIP_POCKETBASE_TESTS=false or running PocketBase instance
"""

from __future__ import annotations

import os

import pytest

# Skip if PocketBase not available
pytestmark = pytest.mark.skipif(
    os.environ.get("SKIP_POCKETBASE_TESTS", "true").lower() == "true",
    reason="PocketBase integration tests skipped",
)


class TestDataAccessContextSmoke:
    """Smoke tests for DataAccessContext integration."""

    def test_data_access_context_initializes(self) -> None:
        """DataAccessContext can initialize and provide repositories."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        ctx = DataAccessContext(year=2025)
        ctx.initialize_sync()

        try:
            # Verify all repositories accessible
            assert ctx.persons is not None
            assert ctx.attendees is not None
            assert ctx.requests is not None
            assert ctx.sessions is not None
            assert ctx.pb_client is not None
        finally:
            ctx.close()

    def test_data_access_context_manager_protocol(self) -> None:
        """DataAccessContext works as context manager."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )

        with DataAccessContext(year=2025) as ctx:
            ctx.initialize_sync()
            assert ctx.pb_client is not None


class TestTemporalNameCacheSmoke:
    """Smoke tests for TemporalNameCache integration."""

    def test_temporal_name_cache_initializes(self) -> None:
        """TemporalNameCache can load data from PocketBase."""
        from bunking.sync.bunk_request_processor.data.cache.temporal_name_cache import (
            TemporalNameCache,
        )
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )

        manager = ConnectionManager.get_instance()
        pb = manager.get_client()

        cache = TemporalNameCache(pb, year=2025)
        cache.initialize()  # Should not raise

        stats = cache.get_stats()
        assert "persons_loaded" in stats
        assert "unique_names" in stats


class TestRepositoryFactorySmoke:
    """Smoke tests for RepositoryFactory integration."""

    def test_repository_factory_creates_all_repositories(self) -> None:
        """RepositoryFactory creates all repository types."""
        from bunking.sync.bunk_request_processor.data.connection_manager import (
            ConnectionManager,
        )
        from bunking.sync.bunk_request_processor.data.repository_factory import (
            RepositoryFactory,
        )

        manager = ConnectionManager.get_instance()
        pb = manager.get_client()

        factory = RepositoryFactory(pb, year=2025)
        factory.initialize()

        try:
            assert factory.get_person_repository() is not None
            assert factory.get_attendee_repository() is not None
            assert factory.get_request_repository() is not None
            assert factory.get_session_repository() is not None
        finally:
            factory.cleanup()


class TestOrchestratorSmoke:
    """Smoke tests for RequestOrchestrator integration."""

    def test_orchestrator_initializes_with_data_context(self) -> None:
        """RequestOrchestrator accepts DataAccessContext."""
        from bunking.sync.bunk_request_processor.data.data_access_context import (
            DataAccessContext,
        )
        from bunking.sync.bunk_request_processor.orchestrator import (
            RequestOrchestrator,
        )

        ctx = DataAccessContext(year=2025)
        ctx.initialize_sync()

        try:
            orchestrator = RequestOrchestrator(
                year=2025,
                session_cm_ids=[1000001],
                data_context=ctx,
            )
            assert orchestrator is not None
        finally:
            ctx.close()


class TestFullPipelineSmoke:
    """Smoke tests for the full processing pipeline."""

    @pytest.mark.asyncio
    async def test_full_pipeline_dry_run(self) -> None:
        """Full pipeline can execute with dry_run=True."""
        from bunking.sync.bunk_request_processor.process_requests import (
            process_bunk_requests,
        )

        result = await process_bunk_requests(
            data_source="database",
            year=2025,
            session_cm_ids=[1000001],
            test_limit=1,
            dry_run=True,
        )

        assert result["success"] is True
        assert "statistics" in result
