from __future__ import annotations

#!/usr/bin/env python3
"""
Phase 4: Solver Integration Testing
Verifies solver respects session boundaries and properly handles AG, embedded, and main sessions.
"""

import logging
import os
import sys
from collections import defaultdict
from datetime import datetime
from typing import Any

import requests

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scripts.utils.auth import authenticate_pocketbase


def setup_pocketbase():
    """Setup PocketBase client."""
    try:
        return authenticate_pocketbase("http://127.0.0.1:8090")
    except Exception as e:
        print(f"Warning: Could not authenticate as admin: {e}")
        raise


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class SolverSessionBoundaryTester:
    """Test solver respects session boundaries for all session types."""

    def __init__(self):
        self.pb = setup_pocketbase()
        self.api_base = "http://localhost:8000"
        self.current_year = datetime.now().year
        self.test_scenarios = []
        self.errors = []
        self.warnings = []
        self.stats = defaultdict(int)

        # Test sessions
        self.test_sessions = {
            "main": {"id": 1000002, "name": "Session 2", "type": "main"},
            "ag": {"id": 1000023, "name": "All-Gender Cabin-Session 2 (9th & 10th grades)", "type": "ag"},
            "embedded_a": {"id": 1000021, "name": "Session 2a", "type": "embedded"},
            "embedded_b": {"id": 1000022, "name": "Session 2b", "type": "embedded"},
        }

    def run_all_tests(self):
        """Run all solver session boundary tests."""
        logger.info("=" * 80)
        logger.info("PHASE 4: SOLVER INTEGRATION TESTING")
        logger.info("=" * 80)

        try:
            # 4.1 Session-Specific Solving
            logger.info("\n4.1 Session-Specific Solving")
            logger.info("-" * 40)
            self.test_session_specific_solving()

            # 4.2 Constraint Validation
            logger.info("\n4.2 Constraint Validation")
            logger.info("-" * 40)
            self.test_constraint_validation()

            # 4.3 Scenario-Based Solving
            logger.info("\n4.3 Scenario-Based Solving")
            logger.info("-" * 40)
            self.test_scenario_based_solving()

        finally:
            # Cleanup
            self.cleanup_test_scenarios()

        # Summary
        self.print_summary()

        return len(self.errors) == 0

    def test_session_specific_solving(self):
        """Test solver on individual session types."""

        for session_key, session_info in self.test_sessions.items():
            logger.info(f"\nTesting solver for {session_key}: {session_info['name']}")

            # Create test scenario
            scenario = self.create_test_scenario(session_info)
            if not scenario:
                continue

            # Clear assignments to start fresh
            self.clear_scenario_assignments(scenario["id"])

            # Run solver
            self.run_solver_test(scenario, session_info)

    def create_test_scenario(self, session_info: dict[str, Any]) -> dict[str, Any] | None:
        """Create a test scenario for the given session."""
        try:
            response = requests.post(
                f"{self.api_base}/scenarios",
                json={
                    "name": f"Solver Test {session_info['name']} - {datetime.now().strftime('%Y%m%d%H%M%S')}",
                    "session_cm_id": session_info["id"],
                    "description": f"Solver boundary test for {session_info['type']} session",
                    "copy_from_production": False,
                },
            )

            if response.status_code == 200:
                scenario: dict[str, Any] = response.json()
                self.test_scenarios.append(scenario["id"])
                logger.info(f"  ✓ Created test scenario: {scenario['id']}")
                return scenario
            else:
                self.errors.append(f"Failed to create scenario for {session_info['name']}: {response.text}")
                return None

        except Exception as e:
            self.errors.append(f"Error creating scenario for {session_info['name']}: {str(e)}")
            return None

    def clear_scenario_assignments(self, scenario_id: str) -> None:
        """Clear all assignments in a scenario."""
        try:
            response = requests.post(f"{self.api_base}/scenarios/{scenario_id}/clear", json={})
            if response.status_code == 200:
                logger.info("  ✓ Cleared scenario assignments")
            else:
                self.warnings.append(f"Failed to clear scenario: {response.text}")
        except Exception as e:
            self.warnings.append(f"Error clearing scenario: {str(e)}")

    def run_solver_test(self, scenario: dict[str, Any], session_info: dict[str, Any]) -> None:
        """Run solver on the scenario and validate results."""
        try:
            # Get session attendees
            attendees = self.pb.collection("attendees").get_full_list(
                query_params={
                    "filter": f"session_cm_id = {session_info['id']} && year = {self.current_year}",
                    "expand": "person_cm_id",
                }
            )

            if len(attendees) == 0:
                logger.warning(f"  No attendees found for {session_info['name']}")
                return

            logger.info(f"  Found {len(attendees)} attendees to assign")

            # Get available bunks for this session
            bunks = self.get_session_bunks(session_info)
            logger.info(f"  Found {len(bunks)} available bunks")

            # Run solver
            logger.info("  Running solver...")
            response = requests.post(
                f"{self.api_base}/solver/run",
                json={"session_cm_id": session_info["id"], "scenario_id": scenario["id"], "time_limit": 30},
            )

            if response.status_code == 200:
                result = response.json()
                run_id = result.get("run_id")
                logger.info(f"  ✓ Solver started: run_id={run_id}")

                # Poll for completion
                max_polls = 30  # 30 seconds max
                poll_interval = 1  # 1 second
                completed = False

                for i in range(max_polls):
                    import time

                    time.sleep(poll_interval)

                    status_response = requests.get(f"{self.api_base}/solver/run/{run_id}")
                    if status_response.status_code == 200:
                        status = status_response.json()
                        if status["status"] == "completed":
                            logger.info(f"  ✓ Solver completed after {i + 1} seconds")
                            completed = True
                            break
                        elif status["status"] == "failed":
                            self.errors.append(f"Solver failed: {status.get('error_message', 'Unknown error')}")
                            return
                    else:
                        self.warnings.append(f"Could not check solver status: {status_response.text}")

                if not completed:
                    self.errors.append(f"Solver did not complete within {max_polls} seconds")
                    return

                # Validate assignments
                self.validate_solver_assignments(scenario["id"], session_info, attendees, bunks)

            else:
                self.errors.append(f"Solver failed to start for {session_info['name']}: {response.text}")

        except Exception as e:
            self.errors.append(f"Error running solver for {session_info['name']}: {str(e)}")

    def get_session_bunks(self, session_info: dict[str, Any]) -> list[Any]:
        """Get appropriate bunks for the session type."""
        bunks: list[Any]

        # For AG sessions, only get AG bunks
        if session_info["type"] == "ag":
            bunks = self.pb.collection("bunks").get_full_list(
                query_params={"filter": "name ~ 'AG' || name ~ 'All-Gender'"}
            )
        # For embedded sessions, get bunks for that specific subsession
        elif session_info["type"] == "embedded":
            # Just get all bunks for now - real system would filter better
            bunks = self.pb.collection("bunks").get_full_list()
            # Filter in Python instead
            if "2a" in session_info["name"]:
                bunks = [b for b in bunks if "Boys" in getattr(b, "area", "") and "AG" not in b.name]
            elif "2b" in session_info["name"]:
                bunks = [b for b in bunks if "Girls" in getattr(b, "area", "") and "AG" not in b.name]
        else:
            # Main sessions get regular bunks (not AG)
            bunks = self.pb.collection("bunks").get_full_list(
                query_params={"filter": "name !~ 'AG' && name !~ 'All-Gender'"}
            )

        return bunks

    def validate_solver_assignments(
        self, scenario_id: str, session_info: dict[str, Any], attendees: list[Any], bunks: list[Any]
    ) -> None:
        """Validate that solver assignments respect session boundaries."""

        # Get assignments created by solver
        assignments = self.pb.collection("bunk_assignments_draft").get_full_list(
            query_params={"filter": f'scenario_id = "{scenario_id}"', "expand": "person_cm_id,bunk_cm_id"}
        )

        logger.info(f"  Solver created {len(assignments)} assignments")

        # Track stats
        assigned_count = len(assignments)
        unassigned_count = len(attendees) - assigned_count

        self.stats[f"solver_{session_info['type']}_assigned"] = assigned_count
        self.stats[f"solver_{session_info['type']}_unassigned"] = unassigned_count

        # Validate each assignment
        valid_bunk_ids = set(b.campminder_id for b in bunks)
        attendee_ids = set(a.person_cm_id for a in attendees)

        for assignment in assignments:
            # Check person is in correct session
            if assignment.person_cm_id not in attendee_ids:
                self.errors.append(
                    f"Solver assigned person {assignment.person_cm_id} who is not in session {session_info['name']}"
                )

            # Check bunk is appropriate for session type
            if assignment.bunk_cm_id not in valid_bunk_ids:
                bunk = getattr(assignment.expand, "bunk_cm_id", None)
                bunk_name = bunk.name if bunk else f"ID:{assignment.bunk_cm_id}"
                self.errors.append(f"Solver assigned {session_info['type']} camper to inappropriate bunk: {bunk_name}")

        # Special validation for AG sessions
        if session_info["type"] == "ag":
            self.validate_ag_assignments(assignments)

        if not self.errors:
            logger.info("  ✓ All assignments respect session boundaries")

    def validate_ag_assignments(self, assignments: list[Any]) -> None:
        """Special validation for AG session assignments."""

        for assignment in assignments:
            bunk = getattr(assignment.expand, "bunk_cm_id", None)
            if bunk and "ag" not in bunk.name.lower() and "all-gender" not in bunk.name.lower():
                person = getattr(assignment.expand, "person_cm_id", None)
                person_name = f"{person.first_name} {person.last_name}" if person else f"ID:{assignment.person_cm_id}"
                self.errors.append(f"AG camper {person_name} assigned to non-AG bunk: {bunk.name}")

    def test_constraint_validation(self):
        """Test specific constraints for session boundaries."""

        logger.info("\nTesting cross-session assignment prevention...")

        # Create a scenario for main session
        main_scenario = self.create_test_scenario(self.test_sessions["main"])
        if not main_scenario:
            return

        # Try to manually assign an AG kid to a main session bunk (should fail)
        ag_attendees = self.pb.collection("attendees").get_full_list(
            query_params={
                "filter": f"session_cm_id = {self.test_sessions['ag']['id']} && year = {self.current_year}",
                "limit": 1,
            }
        )

        if ag_attendees:
            ag_person = ag_attendees[0]
            main_bunks = self.get_session_bunks(self.test_sessions["main"])

            if main_bunks:
                # Attempt invalid assignment
                try:
                    response = requests.put(
                        f"{self.api_base}/scenarios/{main_scenario['id']}/assignments",
                        json={"person_cm_id": ag_person.person_cm_id, "bunk_cm_id": main_bunks[0].campminder_id},
                    )

                    if response.status_code == 200:
                        self.errors.append("System allowed AG camper to be assigned to main session bunk!")
                    else:
                        logger.info("  ✓ System correctly prevented cross-session assignment")
                        self.stats["cross_session_prevention"] = "success"

                except Exception as e:
                    self.warnings.append(f"Could not test cross-session assignment: {str(e)}")

    def test_scenario_based_solving(self):
        """Test solving with existing assignments and locks."""

        logger.info("\nTesting scenario-based solving with locks...")

        # Create scenario with some assignments
        session_info = self.test_sessions["main"]
        scenario = self.create_test_scenario(session_info)
        if not scenario:
            return

        # Get some attendees
        attendees = self.pb.collection("attendees").get_full_list(
            query_params={"filter": f"session_cm_id = {session_info['id']} && year = {self.current_year}", "limit": 10}
        )

        if len(attendees) < 2:
            logger.warning("  Not enough attendees for lock test")
            return

        # Manually assign and lock first two attendees
        bunks = self.get_session_bunks(session_info)
        if len(bunks) < 2:
            logger.warning("  Not enough bunks for lock test")
            return

        # Create locked assignments
        for i in range(2):
            try:
                response = requests.put(
                    f"{self.api_base}/scenarios/{scenario['id']}/assignments",
                    json={
                        "person_cm_id": attendees[i].person_cm_id,
                        "bunk_cm_id": bunks[i].campminder_id,
                        "locked": True,
                    },
                )

                if response.status_code == 200:
                    logger.info(f"  ✓ Created locked assignment for {attendees[i].person_cm_id}")
                else:
                    self.warnings.append(f"Failed to create locked assignment: {response.text}")

            except Exception as e:
                self.warnings.append(f"Error creating locked assignment: {str(e)}")

        # Run solver
        logger.info("  Running solver with locked assignments...")
        response = requests.post(
            f"{self.api_base}/solver/run",
            json={"session_cm_id": session_info["id"], "scenario_id": scenario["id"], "time_limit": 30},
        )

        if response.status_code == 200:
            result = response.json()
            run_id = result.get("run_id")
            logger.info(f"  ✓ Solver started with locks: run_id={run_id}")

            # Poll for completion
            max_polls = 30
            poll_interval = 1
            completed = False

            for i in range(max_polls):
                import time

                time.sleep(poll_interval)

                status_response = requests.get(f"{self.api_base}/solver/run/{run_id}")
                if status_response.status_code == 200:
                    status = status_response.json()
                    if status["status"] == "completed":
                        logger.info(f"  ✓ Solver with locks completed after {i + 1} seconds")
                        completed = True
                        break
                    elif status["status"] == "failed":
                        self.errors.append(f"Solver with locks failed: {status.get('error_message', 'Unknown error')}")
                        return

            if not completed:
                self.errors.append(f"Solver with locks did not complete within {max_polls} seconds")
                return

            # Verify locked assignments weren't changed
            locked_assignments = self.pb.collection("bunk_assignments_draft").get_full_list(
                query_params={"filter": f'scenario_id = "{scenario["id"]}" && locked = true'}
            )

            if len(locked_assignments) >= 2:
                logger.info(f"  ✓ Solver respected {len(locked_assignments)} locked assignments")
                self.stats["solver_respects_locks"] = "success"
            else:
                self.errors.append("Solver may have modified locked assignments")

        else:
            self.errors.append(f"Solver failed to start with locks: {response.text}")

    def cleanup_test_scenarios(self):
        """Clean up test scenarios."""
        logger.info("\nCleaning up test scenarios...")

        for scenario_id in self.test_scenarios:
            try:
                response = requests.delete(f"{self.api_base}/scenarios/{scenario_id}")
                if response.status_code == 200:
                    logger.info(f"  ✓ Deleted test scenario: {scenario_id}")
            except Exception as e:
                logger.warning(f"  Error deleting scenario {scenario_id}: {str(e)}")

    def print_summary(self):
        """Print test summary."""
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)

        # Statistics
        logger.info("\nTest Results:")
        for key, value in sorted(self.stats.items()):
            logger.info(f"  {key}: {value}")

        # Errors
        if self.errors:
            logger.error(f"\n❌ Found {len(self.errors)} ERRORS:")
            for error in self.errors[:10]:
                logger.error(f"  - {error}")
            if len(self.errors) > 10:
                logger.error(f"  ... and {len(self.errors) - 10} more")
        else:
            logger.info("\n✅ No errors found!")

        # Warnings
        if self.warnings:
            logger.warning(f"\n⚠️  Found {len(self.warnings)} warnings:")
            for warning in self.warnings[:5]:
                logger.warning(f"  - {warning}")
            if len(self.warnings) > 5:
                logger.warning(f"  ... and {len(self.warnings) - 5} more")

        # Final result
        if self.errors:
            logger.error("\n❌ SOLVER INTEGRATION TEST FAILED")
        else:
            logger.info("\n✅ SOLVER INTEGRATION TEST PASSED")


def main():
    """Run solver session boundary tests."""
    tester = SolverSessionBoundaryTester()
    success = tester.run_all_tests()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
