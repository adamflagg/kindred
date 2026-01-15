#!/usr/bin/env python3
# mypy: ignore-errors
# NOTE: This is an outdated diagnostic script (not a pytest test file).
# It uses deprecated APIs and is excluded from mypy checking.
# Consider moving to scripts/debug/ or updating to current APIs.
"""Diagnostic Test Script for Bunk Request Processor Flow

This script tests each component of the bunk request processor
to identify where hangs occur.

Usage:
    uv run python scripts/test/bunk_request_processor/test_processor_flow.py"""

import asyncio
import sys
import time
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class DiagnosticRunner:
    """Runs diagnostic tests with timeouts and logging"""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.pb = None
        self.results = {}

    def log(self, msg: str, level: str = "INFO") -> None:
        """Log with timestamp"""
        ts = time.strftime("%H:%M:%S")
        print(f"[{ts}] [{level}] {msg}")

    def step_start(self, step: str) -> float:
        """Mark step start"""
        self.log(f">>> STARTING: {step}")
        return time.time()

    def step_end(self, step: str, start: float, success: bool = True) -> None:
        """Mark step end"""
        elapsed = time.time() - start
        status = "SUCCESS" if success else "FAILED"
        self.log(f"<<< {status}: {step} ({elapsed:.2f}s)")
        self.results[step] = {"success": success, "elapsed": elapsed}

    async def run_with_timeout(self, coro, step_name: str):
        """Run coroutine with timeout"""
        try:
            return await asyncio.wait_for(coro, timeout=self.timeout)
        except TimeoutError:
            self.log(f"TIMEOUT after {self.timeout}s in {step_name}", "ERROR")
            raise

    # ============= STEP 1: PocketBase Connectivity =============
    def test_pocketbase_connection(self) -> bool:
        """Test basic PocketBase connectivity"""
        step = "PocketBase Connection"
        start = self.step_start(step)

        try:
            import os

            from pocketbase import Client

            self.pb = Client("http://127.0.0.1:8090")
            self.log("Connected to PocketBase")

            # Authenticate as admin
            pb_email = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
            pb_password = os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123")
            self.log(f"Authenticating as {pb_email}...")
            self.pb.collection("_superusers").auth_with_password(pb_email, pb_password)
            self.log("Authenticated with PocketBase")

            # Test basic query
            result = self.pb.collection("persons").get_list(1, 1)
            self.log(f"Persons collection: {result.total_items} total records")

            # Test original_bunk_requests
            result = self.pb.collection("original_bunk_requests").get_list(1, 1)
            self.log(f"Original bunk requests: {result.total_items} total records")

            # Test attendees
            result = self.pb.collection("attendees").get_list(1, 1)
            self.log(f"Attendees collection: {result.total_items} total records")

            self.step_end(step, start, True)
            return True

        except Exception as e:
            self.log(f"Error: {e}", "ERROR")
            self.step_end(step, start, False)
            return False

    # ============= STEP 2: Original Requests Loader =============
    async def test_original_requests_loader(self) -> bool:
        """Test loading original requests"""
        step = "Original Requests Loader"
        start = self.step_start(step)

        try:
            from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
                OriginalRequestsLoader,
            )

            loader = OriginalRequestsLoader(self.pb, year=2025)
            self.log("Created OriginalRequestsLoader")

            # Test loading persons cache (often hangs here)
            self.log("Loading persons cache...")
            await self.run_with_timeout(asyncio.to_thread(loader.load_persons_cache), "load_persons_cache")
            self.log(f"Loaded {len(loader._person_cache)} persons, {len(loader._person_sessions)} with sessions")

            # Test fetching requests (limit to 5 for speed)
            self.log("Fetching requests (limit 5)...")
            requests = await self.run_with_timeout(
                asyncio.to_thread(loader.fetch_requests_needing_processing, None, 5), "fetch_requests"
            )
            self.log(f"Fetched {len(requests)} requests")

            if requests:
                req = requests[0]
                self.log(f"Sample: {req.first_name} {req.last_name} - {req.field}: '{req.content[:50]}...'")

            self.step_end(step, start, True)
            return True

        except TimeoutError:
            self.step_end(step, start, False)
            return False
        except Exception as e:
            self.log(f"Error: {e}", "ERROR")
            import traceback

            traceback.print_exc()
            self.step_end(step, start, False)
            return False

    # ============= STEP 3: Orchestrator Initialization =============
    async def test_orchestrator_init(self) -> bool:
        """Test orchestrator initialization"""
        step = "Orchestrator Initialization"
        start = self.step_start(step)

        try:
            from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
                RequestOrchestrator,
            )

            self.log("Creating RequestOrchestrator...")
            orch = RequestOrchestrator(
                pb=self.pb,
                year=2025,
                session_cm_ids=None,  # All sessions
            )
            self.log("RequestOrchestrator created (init components done)")

            # Check components
            self.log(f"AI provider: {type(orch.ai_provider).__name__}")
            self.log(f"Batch processor: {type(orch.batch_processor).__name__}")
            self.log(f"Resolution pipeline: {type(orch.resolution_pipeline).__name__}")

            self.step_end(step, start, True)
            return True

        except TimeoutError:
            self.step_end(step, start, False)
            return False
        except Exception as e:
            self.log(f"Error: {e}", "ERROR")
            import traceback

            traceback.print_exc()
            self.step_end(step, start, False)
            return False

    # ============= STEP 4: Social Graph Initialization =============
    async def test_social_graph_init(self) -> bool:
        """Test social graph initialization (often hangs)"""
        step = "Social Graph Initialization"
        start = self.step_start(step)

        try:
            from bunking.sync.bunk_request_processor.social.social_graph import (
                SocialGraph,
            )

            self.log("Creating SocialGraph...")
            social_graph = SocialGraph(
                pb=self.pb,
                year=2025,
                session_cm_ids=None,  # All sessions
            )
            self.log("SocialGraph created")

            # Initialize (loads data)
            self.log("Initializing social graph (loads attendees)...")
            await self.run_with_timeout(social_graph.initialize(), "social_graph.initialize()")
            self.log(f"Social graph initialized with {len(social_graph.session_cm_ids)} sessions")

            self.step_end(step, start, True)
            return True

        except TimeoutError:
            self.step_end(step, start, False)
            return False
        except Exception as e:
            self.log(f"Error: {e}", "ERROR")
            import traceback

            traceback.print_exc()
            self.step_end(step, start, False)
            return False

    # ============= STEP 5: Phase 1 Service (AI Parse) =============
    async def test_phase1_service(self) -> bool:
        """Test Phase 1 AI parsing with a single request"""
        step = "Phase 1 Service (AI Parse)"
        start = self.step_start(step)

        try:
            import os

            from bunking.sync.bunk_request_processor.integration.ai_service import (
                AIServiceConfig,
            )
            from bunking.sync.bunk_request_processor.integration.batch_processor import (
                BatchProcessor,
            )
            from bunking.sync.bunk_request_processor.integration.provider_factory import (
                ProviderFactory,
            )
            from bunking.sync.bunk_request_processor.services.context_builder import (
                ContextBuilder,
            )
            from bunking.sync.bunk_request_processor.services.phase1_parse_service import (
                Phase1ParseService,
            )

            # Create AI provider
            factory = ProviderFactory()
            config = AIServiceConfig(
                provider=os.getenv("AI_PROVIDER", "openai"),
                api_key=os.getenv("AI_API_KEY"),
                model=os.getenv("AI_MODEL", "gpt-4o-mini"),
            )
            ai_provider = factory.create(config)
            self.log(f"AI provider: {type(ai_provider).__name__}")

            # Create batch processor
            batch_processor = BatchProcessor(
                ai_provider=ai_provider, config={"batch_processing": {"batch_size": 5, "max_concurrent_batches": 1}}
            )

            # Create context builder and phase 1 service
            context_builder = ContextBuilder()
            phase1 = Phase1ParseService(
                ai_service=ai_provider, context_builder=context_builder, batch_processor=batch_processor
            )

            # Create a test request
            from bunking.sync.bunk_request_processor.core.models import ParseRequest

            test_request = ParseRequest(
                requester_cm_id=12345,
                requester_first_name="Test",
                requester_last_name="User",
                source_field="share_bunk_with",
                raw_text="John Smith",
                year=2025,
            )

            self.log("Parsing test request...")
            result = await self.run_with_timeout(phase1.parse_single(test_request), "phase1.parse_single()")

            if result:
                self.log(f"Parse result: {len(result.parsed_names)} names parsed")
                for name in result.parsed_names[:3]:
                    self.log(f"  - {name.first_name} {name.last_name} ({name.request_type})")
            else:
                self.log("No parse result returned", "WARN")

            self.step_end(step, start, True)
            return True

        except TimeoutError:
            self.step_end(step, start, False)
            return False
        except Exception as e:
            self.log(f"Error: {e}", "ERROR")
            import traceback

            traceback.print_exc()
            self.step_end(step, start, False)
            return False

    # ============= STEP 6: Phase 2 Service (Local Resolution) =============
    async def test_phase2_service(self) -> bool:
        """Test Phase 2 local resolution"""
        step = "Phase 2 Service (Local Resolution)"
        start = self.step_start(step)

        try:
            from bunking.sync.bunk_request_processor.data.repositories.attendee_repository import (
                AttendeeRepository,
            )
            from bunking.sync.bunk_request_processor.data.repositories.person_repository import (
                PersonRepository,
            )
            from bunking.sync.bunk_request_processor.resolution.resolution_pipeline import (
                ResolutionPipeline,
            )
            from bunking.sync.bunk_request_processor.resolution.strategies.exact_match import (
                ExactMatchStrategy,
            )
            from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
                Phase2ResolutionService,
            )

            person_repo = PersonRepository(self.pb)
            attendee_repo = AttendeeRepository(self.pb)

            pipeline = ResolutionPipeline(person_repo, attendee_repo)
            pipeline.add_strategy(ExactMatchStrategy(person_repo, attendee_repo))

            phase2 = Phase2ResolutionService(resolution_pipeline=pipeline, confidence_scorer=None)

            self.log("Phase 2 service created")

            # Create a test parsed request
            from bunking.sync.bunk_request_processor.core.models import (
                ParsedName,
                ParsedRequest,
                RequestType,
            )

            test_parsed = ParsedRequest(
                requester_cm_id=12345,
                requester_first_name="Test",
                requester_last_name="User",
                source_field="share_bunk_with",
                raw_text="John Smith",
                year=2025,
                parsed_names=[ParsedName(first_name="John", last_name="Smith", request_type=RequestType.BUNK_WITH)],
            )

            self.log("Resolving test request...")
            result = await self.run_with_timeout(
                asyncio.to_thread(phase2.resolve_single, test_parsed), "phase2.resolve_single()"
            )

            self.log(f"Resolution results: {len(result.resolved)} resolved, {len(result.ambiguous)} ambiguous")

            self.step_end(step, start, True)
            return True

        except TimeoutError:
            self.step_end(step, start, False)
            return False
        except Exception as e:
            self.log(f"Error: {e}", "ERROR")
            import traceback

            traceback.print_exc()
            self.step_end(step, start, False)
            return False

    # ============= MAIN =============
    async def run_all(self) -> None:
        """Run all diagnostic tests"""
        self.log("=" * 60)
        self.log("BUNK REQUEST PROCESSOR DIAGNOSTIC TEST")
        self.log("=" * 60)

        # Step 1: PocketBase
        if not self.test_pocketbase_connection():
            self.log("Cannot continue without PocketBase connection", "ERROR")
            return

        # Step 2: Original Requests Loader
        await self.test_original_requests_loader()

        # Step 3: Orchestrator Init
        await self.test_orchestrator_init()

        # Step 4: Social Graph
        await self.test_social_graph_init()

        # Step 5: Phase 1 (AI Parse)
        await self.test_phase1_service()

        # Step 6: Phase 2 (Local Resolution)
        await self.test_phase2_service()

        # Summary
        self.log("=" * 60)
        self.log("SUMMARY")
        self.log("=" * 60)

        for step, result in self.results.items():
            status = "PASS" if result["success"] else "FAIL"
            self.log(f"  [{status}] {step}: {result['elapsed']:.2f}s")

        failed = [s for s, r in self.results.items() if not r["success"]]
        if failed:
            self.log(f"\nFailed steps: {', '.join(failed)}", "ERROR")
            self.log("\nThe hang is likely in the FIRST failed step above.")
        else:
            self.log("\nAll steps passed! The hang may be in phase coordination.")


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Diagnostic test for bunk request processor")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per step in seconds")
    args = parser.parse_args()

    runner = DiagnosticRunner(timeout=args.timeout)
    asyncio.run(runner.run_all())


if __name__ == "__main__":
    main()
