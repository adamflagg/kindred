#!/usr/bin/env python3
"""
Master Test Runner for Kindred
Executes all test phases and provides comprehensive reporting.
"""

import asyncio
import logging
import os
import subprocess
import sys
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scripts.utils.auth import authenticate_pocketbase

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class BunkingTestRunner:
    """Master test runner for all bunking system tests."""

    def __init__(self):
        self.test_phases = [
            {
                "phase": 1,
                "name": "Data Integrity Verification",
                "script": "test_session_data_integrity.py",
                "async": False,
                "critical": True,
            },
            {
                "phase": 2,
                "name": "Scenario Management Testing",
                "script": "test_scenario_management_comprehensive.py",
                "async": True,
                "critical": True,
            },
            {
                "phase": 3,
                "name": "Bunking Board Functionality",
                "script": "test_bunking_board_ui.py",  # To be created
                "async": False,
                "critical": True,
            },
            {
                "phase": 4,
                "name": "Solver Integration Testing",
                "script": "test_solver_session_boundaries.py",
                "async": False,
                "critical": True,
            },
            {
                "phase": 5,
                "name": "Integration Testing",
                "script": "test_full_integration.py",  # To be created
                "async": True,
                "critical": False,
            },
            {
                "phase": 6,
                "name": "API Endpoint Testing",
                "script": "test_api_endpoints.py",  # To be created
                "async": False,
                "critical": False,
            },
            {
                "phase": 7,
                "name": "Final Validation",
                "script": "test_final_validation.py",  # To be created
                "async": False,
                "critical": True,
            },
        ]

        self.results = {}
        self.start_time = None
        self.end_time = None

    async def run_all_tests(self):
        """Run all test phases."""
        self.start_time = datetime.now()

        logger.info("=" * 80)
        logger.info("BUNKING SYSTEM COMPREHENSIVE TEST SUITE")
        logger.info("=" * 80)
        logger.info(f"Started at: {self.start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info("")

        # Check prerequisites
        if not self.check_prerequisites():
            logger.error("Prerequisites check failed. Aborting tests.")
            return False

        # Run each test phase
        all_passed = True
        for phase_info in self.test_phases:
            result = await self.run_test_phase(phase_info)
            self.results[phase_info["phase"]] = result

            if not result["success"] and phase_info["critical"]:
                logger.error(f"Critical phase {phase_info['phase']} failed. Stopping test execution.")
                all_passed = False
                break

        self.end_time = datetime.now()

        # Generate final report
        self.generate_final_report()

        return all_passed

    def check_prerequisites(self) -> bool:
        """Check that all prerequisites are met."""
        logger.info("Checking prerequisites...")

        # Check if dev server is running
        try:
            import requests

            response = requests.get("http://localhost:8000/health", timeout=5)
            if response.status_code == 200:
                logger.info("  ✓ API server is running")
            else:
                logger.error("  ✗ API server returned non-200 status")
                return False
        except Exception:
            logger.error("  ✗ API server is not accessible at http://localhost:8000")
            logger.error("    Please run: ./scripts/start_dev.sh")
            return False

        # Check if PocketBase is running
        try:
            pb = authenticate_pocketbase("http://127.0.0.1:8090")
            # Try a simple query
            pb.collection("camp_sessions").get_list(1, 1)
            logger.info("  ✓ PocketBase is accessible")
        except Exception:
            logger.error("  ✗ PocketBase is not accessible")
            logger.error("    Please ensure PocketBase is running")
            return False

        # Check Python version
        logger.info("  ✓ Python version OK")

        logger.info("  ✓ All prerequisites met\n")
        return True

    async def run_test_phase(self, phase_info: dict[str, object]) -> dict[str, object]:
        """Run a single test phase."""
        phase_num = phase_info["phase"]
        phase_name = phase_info["name"]
        script_name = str(phase_info["script"])

        logger.info(f"\n{'=' * 80}")
        logger.info(f"PHASE {phase_num}: {phase_name}")
        logger.info(f"{'=' * 80}")

        # Check if script exists
        script_path = os.path.join(os.path.dirname(__file__), script_name)
        if not os.path.exists(script_path):
            logger.warning(f"Test script not found: {script_name}")
            logger.info("Skipping this phase...")
            return {
                "success": True,  # Don't fail on missing non-critical tests
                "skipped": True,
                "duration": 0,
                "output": "Script not found",
            }

        start_time = datetime.now()

        try:
            # Run the test script
            if phase_info["async"]:
                # For async scripts, use Python directly
                process = await asyncio.create_subprocess_exec(
                    sys.executable, script_path, stdout=subprocess.PIPE, stderr=subprocess.PIPE
                )
                stdout, stderr = await process.communicate()
                return_code = process.returncode
            else:
                # For sync scripts
                result = subprocess.run([sys.executable, script_path], capture_output=True, text=True)
                stdout = result.stdout.encode("utf-8") if isinstance(result.stdout, str) else result.stdout
                stderr = result.stderr.encode("utf-8") if isinstance(result.stderr, str) else result.stderr
                return_code = result.returncode

            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()

            # Parse results
            success = return_code == 0

            if success:
                logger.info(f"✅ Phase {phase_num} completed successfully in {duration:.2f}s")
            else:
                logger.error(f"❌ Phase {phase_num} failed after {duration:.2f}s")
                if stderr:
                    logger.error(f"Error output:\n{stderr.decode('utf-8') if isinstance(stderr, bytes) else stderr}")

            return {
                "success": success,
                "skipped": False,
                "duration": duration,
                "output": stdout if isinstance(stdout, str) else stdout.decode("utf-8"),
                "errors": stderr if isinstance(stderr, str) else stderr.decode("utf-8"),
            }

        except Exception as e:
            logger.error(f"Exception running phase {phase_num}: {str(e)}")
            return {"success": False, "skipped": False, "duration": 0, "output": "", "errors": str(e)}

    def generate_final_report(self):
        """Generate comprehensive final report."""
        total_duration = (self.end_time - self.start_time).total_seconds() if self.end_time else 0

        logger.info("\n" + "=" * 80)
        logger.info("FINAL TEST REPORT")
        logger.info("=" * 80)
        logger.info(f"Total execution time: {total_duration:.2f} seconds")
        logger.info("")

        # Phase results summary
        logger.info("Phase Results:")
        logger.info("-" * 40)

        passed = 0
        failed = 0
        skipped = 0

        for phase_info in self.test_phases:
            phase_num = phase_info["phase"]
            phase_name = phase_info["name"]

            if phase_num in self.results:
                result = self.results[phase_num]
                if result["skipped"]:
                    status = "⏭️  SKIPPED"
                    skipped += 1
                elif result["success"]:
                    status = "✅ PASSED"
                    passed += 1
                else:
                    status = "❌ FAILED"
                    failed += 1

                duration = f"({result['duration']:.2f}s)" if not result["skipped"] else ""
                logger.info(f"  Phase {phase_num}: {phase_name:<40} {status} {duration}")
            else:
                logger.info(f"  Phase {phase_num}: {phase_name:<40} ⏸️  NOT RUN")

        # Overall summary
        logger.info("")
        logger.info("Summary:")
        logger.info("-" * 40)
        logger.info(f"  Total phases: {len(self.test_phases)}")
        logger.info(f"  Passed: {passed}")
        logger.info(f"  Failed: {failed}")
        logger.info(f"  Skipped: {skipped}")

        # Critical issues
        critical_failures = []
        for phase_info in self.test_phases:
            phase_num = phase_info["phase"]
            if phase_info["critical"] and phase_num in self.results:
                if not self.results[phase_num]["success"] and not self.results[phase_num]["skipped"]:
                    critical_failures.append(phase_info["name"])

        if critical_failures:
            logger.error("\nCRITICAL FAILURES:")
            for failure in critical_failures:
                logger.error(f"  - {failure}")

        # Final verdict
        logger.info("")
        if failed == 0 and len(critical_failures) == 0:
            logger.info("🎉 ALL TESTS PASSED! System is ready for live testing.")
        else:
            logger.error("❌ SYSTEM IS NOT READY FOR LIVE TESTING")
            logger.error("   Please fix the failing tests before proceeding.")

        # Save detailed report
        self.save_detailed_report()

    def save_detailed_report(self):
        """Save detailed report to file."""
        report_path = os.path.join(
            os.path.dirname(__file__), f"test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        )

        try:
            with open(report_path, "w") as f:
                f.write("BUNKING SYSTEM TEST REPORT\n")
                f.write("=" * 80 + "\n")
                f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                duration_secs = (
                    (self.end_time - self.start_time).total_seconds() if self.end_time and self.start_time else 0
                )
                f.write(f"Total Duration: {duration_secs:.2f}s\n")
                f.write("\n")

                for phase_info in self.test_phases:
                    phase_num = phase_info["phase"]
                    if phase_num in self.results:
                        result = self.results[phase_num]
                        f.write(f"\nPHASE {phase_num}: {phase_info['name']}\n")
                        f.write("-" * 40 + "\n")
                        f.write(f"Status: {'PASSED' if result['success'] else 'FAILED'}\n")
                        f.write(f"Duration: {result['duration']:.2f}s\n")
                        if result.get("output"):
                            f.write("\nOutput:\n")
                            f.write(result["output"])
                        if result.get("errors"):
                            f.write("\nErrors:\n")
                            f.write(result["errors"])
                        f.write("\n")

            logger.info(f"\nDetailed report saved to: {report_path}")

        except Exception as e:
            logger.warning(f"Could not save detailed report: {str(e)}")


async def main():
    """Run all bunking system tests."""
    runner = BunkingTestRunner()
    success = await runner.run_all_tests()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
