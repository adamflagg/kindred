#!/usr/bin/env python3
"""Module-Level Test Script for Bunk Request Processor

Tests each phase independently with configurable limits to identify failures.

Usage:
    ./venv/bin/python scripts/test/bunk_request_processor/test_modules.py --limit 5
    ./venv/bin/python scripts/test/bunk_request_processor/test_modules.py --phase 1 --limit 10
    ./venv/bin/python scripts/test/bunk_request_processor/test_modules.py --all --limit 3"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Add project root to path
project_root = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(project_root))


@dataclass
class PhaseTestResult:
    """Result from a test phase"""

    name: str
    success: bool
    elapsed: float
    input_count: int
    output_count: int
    details: dict[str, Any]
    error: str | None = None


class ModuleTester:
    """Tests bunk request processor modules independently"""

    def __init__(self, limit: int = 5, session: int = 2):
        self.limit = limit
        self.session = session
        self.pb: Any = None
        self.results: list[PhaseTestResult] = []

        # Session CM ID mapping
        self.session_map = {
            1: 1000001,  # Taste of Camp
            2: 1000002,  # Session 2
            3: 1000003,  # Session 3
            4: 1000004,  # Session 4
        }
        self.session_cm_id = self.session_map.get(session, 1000002)

    def log(self, msg: str, level: str = "INFO") -> None:
        """Log with timestamp"""
        ts = time.strftime("%H:%M:%S")
        print(f"[{ts}] [{level}] {msg}")

    def setup(self) -> bool:
        """Setup PocketBase connection and authentication"""
        try:
            from pocketbase import Client  # type: ignore[attr-defined]

            self.pb = Client("http://127.0.0.1:8090")

            pb_email = os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local")
            pb_password = os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123")
            self.pb.collection("_superusers").auth_with_password(pb_email, pb_password)
            self.log("Authenticated with PocketBase")

            # Verify data exists
            persons = self.pb.collection("persons").get_list(1, 1)
            requests = self.pb.collection("original_bunk_requests").get_list(1, 1)
            self.log(f"Database: {persons.total_items} persons, {requests.total_items} requests")

            return True
        except Exception as e:
            self.log(f"Setup failed: {e}", "ERROR")
            return False

    # ============= TEST: Data Loading =============
    async def test_data_loading(self) -> PhaseTestResult:
        """Test loading original requests from database"""
        name = "Data Loading"
        self.log(f">>> Testing {name}")
        start = time.time()

        try:
            from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
                OriginalRequestsLoader,
            )

            loader = OriginalRequestsLoader(self.pb, year=2025)

            # Load persons cache
            loader.load_persons_cache()
            persons_count = len(loader._person_sessions)
            sessions_count = len(loader._person_sessions)
            self.log(f"  Cached {persons_count} persons, {sessions_count} with sessions")

            # Fetch requests with limit
            requests = loader.fetch_requests_needing_processing(limit=self.limit)
            self.log(f"  Fetched {len(requests)} requests")

            # Show sample
            for i, req in enumerate(requests[:3]):
                self.log(f"    [{i}] {req.first_name} {req.last_name}: {req.field}")
                self.log(f'        Content: "{req.content[:60]}..."')
                self.log(f"        CM ID: {req.requester_cm_id}")
                # Check if in session mapping
                in_sessions = req.requester_cm_id in loader._person_sessions
                self.log(f"        In session map: {in_sessions}")

            elapsed = time.time() - start
            return PhaseTestResult(
                name=name,
                success=True,
                elapsed=elapsed,
                input_count=self.limit,
                output_count=len(requests),
                details={
                    "persons_cached": persons_count,
                    "persons_with_sessions": sessions_count,
                    "requests_loaded": len(requests),
                    "sample_requests": [
                        {
                            "name": f"{r.first_name} {r.last_name}",
                            "field": r.field,
                            "cm_id": r.requester_cm_id,
                            "in_session_map": r.requester_cm_id in loader._person_sessions,
                        }
                        for r in requests[:5]
                    ],
                },
            )

        except Exception as e:
            import traceback

            return PhaseTestResult(
                name=name,
                success=False,
                elapsed=time.time() - start,
                input_count=self.limit,
                output_count=0,
                details={},
                error=f"{e}\n{traceback.format_exc()}",
            )

    # ============= TEST: Orchestrator Prepare =============
    async def test_orchestrator_prepare(self) -> PhaseTestResult:
        """Test orchestrator's _prepare_parse_requests method"""
        name = "Orchestrator Prepare"
        self.log(f">>> Testing {name}")
        start = time.time()

        try:
            from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
                OriginalRequestsLoader,
            )
            from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
                RequestOrchestrator,
            )

            # Load requests
            loader = OriginalRequestsLoader(self.pb, year=2025)
            loader.load_persons_cache()
            requests = loader.fetch_requests_needing_processing(limit=self.limit)

            # Convert to orchestrator format
            rows = []
            for req in requests:
                if req.requester_cm_id in loader._person_sessions:
                    session_cm_id = loader._person_sessions[req.requester_cm_id][0]
                    rows.append(req.to_orchestrator_format(session_cm_id))
            self.log(f"  Converted {len(requests)} requests to {len(rows)} rows")

            # Create orchestrator
            orch = RequestOrchestrator(pb=self.pb, year=2025, session_cm_ids=[self.session_cm_id])
            self.log(f"  Orchestrator person_sessions: {len(orch._person_sessions)} entries")

            # Test _prepare_parse_requests
            parse_requests, pre_parsed = await orch._prepare_parse_requests(rows)
            self.log(f"  Parse requests: {len(parse_requests)}")
            self.log(f"  Pre-parsed: {len(pre_parsed)}")

            # Show why some might be skipped
            skipped = len(rows) - len(parse_requests) - len(pre_parsed)
            if skipped > 0:
                self.log(f"  SKIPPED: {skipped} rows (not in orchestrator's session filter)")

                # Debug: check which persons are in orchestrator's mapping
                for row in rows[:5]:
                    cm_id = row.get("requester_cm_id")
                    in_orch = cm_id in orch._person_sessions
                    self.log(f"    Row cm_id={cm_id}: in_orch_sessions={in_orch}")

            elapsed = time.time() - start
            return PhaseTestResult(
                name=name,
                success=True,
                elapsed=elapsed,
                input_count=len(rows),
                output_count=len(parse_requests),
                details={
                    "rows_input": len(rows),
                    "parse_requests": len(parse_requests),
                    "pre_parsed": len(pre_parsed),
                    "skipped": skipped,
                    "orchestrator_persons": len(orch._person_sessions),
                },
            )

        except Exception as e:
            import traceback

            return PhaseTestResult(
                name=name,
                success=False,
                elapsed=time.time() - start,
                input_count=0,
                output_count=0,
                details={},
                error=f"{e}\n{traceback.format_exc()}",
            )

    # ============= TEST: Phase 1 (AI Parse) =============
    async def test_phase1(self) -> PhaseTestResult:
        """Test Phase 1 AI parsing"""
        name = "Phase 1 (AI Parse)"
        self.log(f">>> Testing {name}")
        start = time.time()

        try:
            from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
                OriginalRequestsLoader,
            )
            from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
                RequestOrchestrator,
            )

            # Setup
            loader = OriginalRequestsLoader(self.pb, year=2025)
            loader.load_persons_cache()
            requests = loader.fetch_requests_needing_processing(limit=self.limit)

            rows = []
            for req in requests:
                if req.requester_cm_id in loader._person_sessions:
                    session_cm_id = loader._person_sessions[req.requester_cm_id][0]
                    rows.append(req.to_orchestrator_format(session_cm_id))

            orch = RequestOrchestrator(pb=self.pb, year=2025, session_cm_ids=[self.session_cm_id])

            parse_requests, pre_parsed = await orch._prepare_parse_requests(rows)

            if not parse_requests:
                self.log("  No parse requests to process!", "WARN")
                return PhaseTestResult(
                    name=name,
                    success=True,
                    elapsed=time.time() - start,
                    input_count=len(rows),
                    output_count=0,
                    details={"reason": "No parse requests after filtering"},
                )

            self.log(f"  Sending {len(parse_requests)} requests to Phase 1")

            # Run Phase 1
            parse_results = await orch.phase1_service.batch_parse(parse_requests)

            valid_count = sum(1 for r in parse_results if r.is_valid)
            self.log(f"  Results: {len(parse_results)} total, {valid_count} valid")

            # Show sample results
            for i, result in enumerate(parse_results[:3]):
                self.log(f"    [{i}] valid={result.is_valid}, parsed_requests={len(result.parsed_requests)}")
                for pr in result.parsed_requests[:2]:
                    self.log(f"        - {pr.target_name} ({pr.request_type.value})")

            elapsed = time.time() - start
            return PhaseTestResult(
                name=name,
                success=True,
                elapsed=elapsed,
                input_count=len(parse_requests),
                output_count=valid_count,
                details={
                    "total_results": len(parse_results),
                    "valid_results": valid_count,
                    "sample_parsed": [
                        {
                            "valid": r.is_valid,
                            "parsed_count": len(r.parsed_requests),
                            "names": [pr.target_name for pr in r.parsed_requests[:3]],
                        }
                        for r in parse_results[:5]
                    ],
                },
            )

        except Exception as e:
            import traceback

            return PhaseTestResult(
                name=name,
                success=False,
                elapsed=time.time() - start,
                input_count=0,
                output_count=0,
                details={},
                error=f"{e}\n{traceback.format_exc()}",
            )

    # ============= TEST: Phase 2 (Local Resolution) =============
    async def test_phase2(self) -> PhaseTestResult:
        """Test Phase 2 local resolution"""
        name = "Phase 2 (Local Resolution)"
        self.log(f">>> Testing {name}")
        start = time.time()

        try:
            from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
                OriginalRequestsLoader,
            )
            from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
                RequestOrchestrator,
            )

            # Setup and run Phase 1 first
            loader = OriginalRequestsLoader(self.pb, year=2025)
            loader.load_persons_cache()
            requests = loader.fetch_requests_needing_processing(limit=self.limit)

            rows = []
            for req in requests:
                if req.requester_cm_id in loader._person_sessions:
                    session_cm_id = loader._person_sessions[req.requester_cm_id][0]
                    rows.append(req.to_orchestrator_format(session_cm_id))

            orch = RequestOrchestrator(pb=self.pb, year=2025, session_cm_ids=[self.session_cm_id])

            parse_requests, pre_parsed = await orch._prepare_parse_requests(rows)

            if not parse_requests:
                return PhaseTestResult(
                    name=name,
                    success=True,
                    elapsed=time.time() - start,
                    input_count=0,
                    output_count=0,
                    details={"reason": "No parse requests"},
                )

            # Phase 1
            self.log(f"  Running Phase 1 first ({len(parse_requests)} requests)...")
            parse_results = await orch.phase1_service.batch_parse(parse_requests)
            all_results = parse_results + pre_parsed
            self.log(f"  Phase 1 complete: {len(all_results)} results")

            # Initialize social graph (needed for Phase 2)
            self.log("  Initializing social graph...")
            assert orch.social_graph is not None, "Social graph not initialized"
            await orch.social_graph.initialize()

            # Phase 2
            self.log("  Running Phase 2...")
            resolution_results = await orch.phase2_service.batch_resolve(all_results)

            resolved = 0
            ambiguous = 0
            for pr, res_list in resolution_results:
                for rr in res_list:
                    if rr.is_resolved:
                        resolved += 1
                    elif rr.is_ambiguous:
                        ambiguous += 1

            self.log(f"  Results: {resolved} resolved, {ambiguous} ambiguous")

            # Show sample
            for i, (pr, res_list) in enumerate(resolution_results[:3]):
                self.log(f"    [{i}] {len(res_list)} resolutions for {len(pr.parsed_requests)} parsed requests")
                for j, rr in enumerate(res_list[:2]):
                    if rr is None:
                        self.log(f"        - [{j}] None result!")
                        continue
                    status = "resolved" if rr.is_resolved else ("ambiguous" if rr.is_ambiguous else "failed")
                    person_name = rr.person.full_name if rr.person else "N/A"
                    self.log(
                        f"        - [{j}] {status} -> {person_name} (method: {rr.method}, conf: {rr.confidence:.2f})"
                    )

            elapsed = time.time() - start
            return PhaseTestResult(
                name=name,
                success=True,
                elapsed=elapsed,
                input_count=len(all_results),
                output_count=resolved,
                details={"total_resolutions": len(resolution_results), "resolved": resolved, "ambiguous": ambiguous},
            )

        except Exception as e:
            import traceback

            return PhaseTestResult(
                name=name,
                success=False,
                elapsed=time.time() - start,
                input_count=0,
                output_count=0,
                details={},
                error=f"{e}\n{traceback.format_exc()}",
            )

    # ============= TEST: Full Pipeline =============
    async def test_full_pipeline(self) -> PhaseTestResult:
        """Test the full processing pipeline"""
        name = "Full Pipeline"
        self.log(f">>> Testing {name}")
        start = time.time()

        try:
            from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
                OriginalRequestsLoader,
            )
            from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
                RequestOrchestrator,
            )

            # Load data
            loader = OriginalRequestsLoader(self.pb, year=2025)
            loader.load_persons_cache()
            requests = loader.fetch_requests_needing_processing(limit=self.limit)

            rows = []
            for req in requests:
                if req.requester_cm_id in loader._person_sessions:
                    session_cm_id = loader._person_sessions[req.requester_cm_id][0]
                    rows.append(req.to_orchestrator_format(session_cm_id))

            self.log(f"  Processing {len(rows)} rows through full pipeline")

            # Create orchestrator and run
            orch = RequestOrchestrator(pb=self.pb, year=2025, session_cm_ids=[self.session_cm_id])

            result = await orch.process_requests(rows)

            # Get stats - check if method exists
            if hasattr(orch, "get_statistics"):
                stats = orch.get_statistics()
            else:
                stats = orch._stats if hasattr(orch, "_stats") else {}

            self.log(f"  Stats: {json.dumps(stats, indent=2)}")
            self.log(f"  Result: {json.dumps({k: v for k, v in result.items() if k != 'requests_created'}, indent=2)}")

            elapsed = time.time() - start
            return PhaseTestResult(
                name=name,
                success=result.get("success", False),
                elapsed=elapsed,
                input_count=len(rows),
                output_count=stats.get("requests_created", 0),
                details=stats,
            )

        except Exception as e:
            import traceback

            return PhaseTestResult(
                name=name,
                success=False,
                elapsed=time.time() - start,
                input_count=0,
                output_count=0,
                details={},
                error=f"{e}\n{traceback.format_exc()}",
            )

    # ============= MAIN =============
    async def run(self, phase: str = "all") -> None:
        """Run tests"""
        self.log("=" * 70)
        self.log(f"MODULE-LEVEL TEST (limit={self.limit}, session={self.session})")
        self.log("=" * 70)

        if not self.setup():
            return

        if phase in ("all", "load"):
            self.results.append(await self.test_data_loading())

        if phase in ("all", "prepare"):
            self.results.append(await self.test_orchestrator_prepare())

        if phase in ("all", "1", "phase1"):
            self.results.append(await self.test_phase1())

        if phase in ("all", "2", "phase2"):
            self.results.append(await self.test_phase2())

        if phase in ("all", "full"):
            self.results.append(await self.test_full_pipeline())

        # Summary
        self.log("=" * 70)
        self.log("SUMMARY")
        self.log("=" * 70)

        for r in self.results:
            status = "PASS" if r.success else "FAIL"
            self.log(f"  [{status}] {r.name}: {r.input_count} in -> {r.output_count} out ({r.elapsed:.2f}s)")
            if r.error:
                self.log(f"      Error: {r.error[:100]}", "ERROR")

        # Check for zero output issues
        for r in self.results:
            if r.success and r.input_count > 0 and r.output_count == 0:
                self.log(f"\n  WARNING: {r.name} had {r.input_count} inputs but 0 outputs!", "WARN")
                self.log(f"    Details: {json.dumps(r.details, indent=4)}")


def main():
    parser = argparse.ArgumentParser(description="Module-level test for bunk request processor")
    parser.add_argument("--limit", type=int, default=5, help="Number of requests to process")
    parser.add_argument("--session", type=int, default=2, help="Session number (1-4)")
    parser.add_argument(
        "--phase",
        type=str,
        default="all",
        choices=["all", "load", "prepare", "1", "phase1", "2", "phase2", "full"],
        help="Which phase to test",
    )
    args = parser.parse_args()

    tester = ModuleTester(limit=args.limit, session=args.session)
    asyncio.run(tester.run(phase=args.phase))


if __name__ == "__main__":
    main()
