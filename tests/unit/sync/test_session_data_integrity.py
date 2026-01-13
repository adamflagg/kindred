from __future__ import annotations

#!/usr/bin/env python3
"""
Phase 1: Data Integrity Verification Tests
Validates session structure, attendee relationships, and bunk assignments.
"""

import logging
import os
import sys
from collections import defaultdict
from datetime import datetime

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


class SessionDataIntegrityTester:
    """Test data integrity for sessions, attendees, and bunk assignments."""

    def __init__(self):
        self.pb = setup_pocketbase()
        self.current_year = datetime.now().year
        self.errors = []
        self.warnings = []
        self.stats = defaultdict(int)

        # Define expected session types and their relationships
        self.session_type_map = {
            "main": ["Session 1", "Session 2", "Session 3", "Session 4"],
            "ag": ["All-Gender Cabin-Session 2", "All-Gender Cabin-Session 3", "All-Gender Cabin-Session 4"],
            "embedded": ["Session 2a", "Session 2b", "Session 3a"],
            "taste": ["Taste of Camp"],
            "family": [],  # Family sessions vary
            "other": [],  # Quest, training, etc.
        }

        # Parent-child session relationships (parent_id -> [child_ids])
        self.parent_child_map = {
            1000001: [],  # Taste - no children
            1000002: [1000023, 1000024, 1000021, 1000022],  # Session 2 -> AG2s, 2a, 2b
            1000003: [1000033, 1000031],  # Session 3 -> AG3, 3a
            1000004: [1000043],  # Session 4 -> AG4
        }

        # Reverse mapping for finding parent sessions
        self.child_parent_map = {}
        for parent, children in self.parent_child_map.items():
            for child in children:
                self.child_parent_map[child] = parent

    def run_all_tests(self):
        """Run all data integrity tests."""
        logger.info("=" * 80)
        logger.info("PHASE 1: DATA INTEGRITY VERIFICATION")
        logger.info("=" * 80)

        # 1.1 Session Structure Validation
        logger.info("\n1.1 Session Structure Validation")
        logger.info("-" * 40)
        self.validate_session_structure()

        # 1.2 Attendee-Session Relationship Validation
        logger.info("\n1.2 Attendee-Session Relationship Validation")
        logger.info("-" * 40)
        self.validate_attendee_relationships()

        # 1.3 Bunk Assignment Validation
        logger.info("\n1.3 Bunk Assignment Validation")
        logger.info("-" * 40)
        self.validate_bunk_assignments()

        # Summary
        self.print_summary()

        return len(self.errors) == 0

    def validate_session_structure(self):
        """Validate session types and structure."""
        try:
            # Get all sessions for current year
            sessions = self.pb.collection("sessions").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )

            logger.info(f"Found {len(sessions)} sessions for year {self.current_year}")
            self.stats["total_sessions"] = len(sessions)

            # Check session types
            session_by_type = defaultdict(list)
            for session in sessions:
                session_type = session.session_type
                session_by_type[session_type].append(session)

                # Validate required fields
                if not session.campminder_id:
                    self.errors.append(f"Session '{session.name}' missing campminder_id")
                if not session.persistent_id:
                    self.errors.append(f"Session '{session.name}' missing persistent_id")
                if session.year != self.current_year:
                    self.errors.append(f"Session '{session.name}' has wrong year: {session.year}")

                # Validate session type
                valid_types = ["main", "ag", "embedded", "taste", "family", "other"]
                if session_type not in valid_types:
                    self.errors.append(f"Session '{session.name}' has invalid type: {session_type}")

            # Report counts by type
            for stype, sessions_list in session_by_type.items():
                logger.info(f"  {stype}: {len(sessions_list)} sessions")
                self.stats[f"sessions_{stype}"] = len(sessions_list)

                # Log specific sessions for key types
                if stype in ["main", "ag", "embedded"]:
                    for session in sessions_list:
                        logger.info(
                            f"    - {session.name} (ID: {session.campminder_id}, persistent: {session.persistent_id})"
                        )

            # Validate AG sessions exist
            ag_sessions = session_by_type.get("ag", [])
            if len(ag_sessions) == 0:
                self.errors.append("No AG sessions found!")
            else:
                logger.info(f"✓ Found {len(ag_sessions)} AG sessions")

            # Validate parent-child relationships
            logger.info("\nValidating parent-child session relationships:")
            for parent_id, expected_children in self.parent_child_map.items():
                parent_session = next((s for s in sessions if s.campminder_id == parent_id), None)
                if not parent_session:
                    self.warnings.append(f"Parent session {parent_id} not found")
                    continue

                for child_id in expected_children:
                    child_session = next((s for s in sessions if s.campminder_id == child_id), None)
                    if not child_session:
                        self.warnings.append(f"Child session {child_id} of parent {parent_session.name} not found")
                    else:
                        logger.info(f"  ✓ {parent_session.name} -> {child_session.name}")

        except Exception as e:
            self.errors.append(f"Error validating session structure: {str(e)}")
            logger.error(f"Error validating session structure: {e}", exc_info=True)

    def validate_attendee_relationships(self):
        """Validate attendee-session relationships."""
        try:
            # Get all attendees for current year
            attendees = self.pb.collection("attendees").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )

            logger.info(f"Found {len(attendees)} attendees for year {self.current_year}")
            self.stats["total_attendees"] = len(attendees)

            # Get all sessions to create a lookup map
            sessions = self.pb.collection("sessions").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )
            session_map = {s.campminder_id: s for s in sessions}

            # Count by session type
            attendees_by_session_type = defaultdict(list)
            attendees_by_session_id = defaultdict(list)

            for attendee in attendees:
                if not attendee.session_cm_id:
                    self.errors.append(f"Attendee {attendee.person_cm_id} has no session assignment")
                    continue

                # Get session info from our map
                session = session_map.get(attendee.session_cm_id)
                if not session:
                    self.warnings.append(
                        f"Could not find session {attendee.session_cm_id} for attendee {attendee.person_cm_id}"
                    )
                    continue

                session_type = session.session_type
                attendees_by_session_type[session_type].append(attendee)
                attendees_by_session_id[session.campminder_id].append(attendee)

                # Validate year consistency
                if attendee.year != session.year:
                    self.errors.append(
                        f"Attendee {attendee.person_cm_id} year mismatch: attendee={attendee.year}, session={session.year}"
                    )

            # Report attendee counts by session type
            logger.info("\nAttendees by session type:")
            for stype, attendee_list in attendees_by_session_type.items():
                logger.info(f"  {stype}: {len(attendee_list)} attendees")
                self.stats[f"attendees_{stype}"] = len(attendee_list)

            # Specifically check AG attendees
            ag_attendees = attendees_by_session_type.get("ag", [])
            if len(ag_attendees) == 0:
                self.errors.append("No attendees found in AG sessions!")
            else:
                logger.info(f"\n✓ Found {len(ag_attendees)} AG attendees")

                # Show breakdown by specific AG session
                ag_sessions = self.pb.collection("sessions").get_full_list(
                    query_params={"filter": f"year = {self.current_year} && session_type = 'ag'"}
                )
                for ag_session in ag_sessions:
                    count = len(attendees_by_session_id.get(ag_session.campminder_id, []))
                    logger.info(f"  {ag_session.name}: {count} attendees")

        except Exception as e:
            self.errors.append(f"Error validating attendee relationships: {str(e)}")
            logger.error(f"Error validating attendee relationships: {e}", exc_info=True)

    def validate_bunk_assignments(self):
        """Validate bunk assignments for all session types."""
        try:
            # Get all bunk assignments for current year
            assignments = self.pb.collection("bunk_assignments").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )

            logger.info(f"Found {len(assignments)} bunk assignments for year {self.current_year}")
            self.stats["total_assignments"] = len(assignments)

            # Get lookup maps
            sessions = self.pb.collection("sessions").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )
            session_map = {s.campminder_id: s for s in sessions}

            attendees = self.pb.collection("attendees").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )
            attendee_map = {a.person_cm_id: a for a in attendees}

            bunks = self.pb.collection("bunks").get_full_list()
            bunk_map = {b.campminder_id: b for b in bunks}

            # Analyze assignments by session type
            assignments_by_session_type = defaultdict(list)
            ag_assignments = []

            for assignment in assignments:
                # Get session info
                session = session_map.get(assignment.session_cm_id)
                if not session:
                    self.warnings.append(
                        f"Assignment {assignment.id} has invalid session_cm_id: {assignment.session_cm_id}"
                    )
                    continue

                session_type = session.session_type
                assignments_by_session_type[session_type].append(assignment)

                # Get person info
                person = attendee_map.get(assignment.person_cm_id)
                bunk = bunk_map.get(assignment.bunk_cm_id)

                if session_type == "ag":
                    ag_assignments.append(
                        {"assignment": assignment, "person": person, "session": session, "bunk": bunk}
                    )

                # Validate year consistency
                if assignment.year != self.current_year:
                    self.errors.append(f"Assignment {assignment.id} has wrong year: {assignment.year}")

                # Validate person is in correct session
                if person and person.session_cm_id != session.campminder_id:
                    self.errors.append(
                        f"Assignment mismatch: person {person.person_cm_id} in session {person.session_cm_id} but assigned in session {session.campminder_id}"
                    )

            # Report assignment counts by session type
            logger.info("\nBunk assignments by session type:")
            for stype, assignment_list in assignments_by_session_type.items():
                logger.info(f"  {stype}: {len(assignment_list)} assignments")
                self.stats[f"assignments_{stype}"] = len(assignment_list)

            # Specifically analyze AG assignments
            if len(ag_assignments) == 0:
                self.errors.append("No bunk assignments found for AG sessions!")
            else:
                logger.info(f"\n✓ Found {len(ag_assignments)} AG bunk assignments")

                # Check if AG kids are in appropriate bunks
                ag_bunk_names = set()
                for ag_data in ag_assignments:
                    bunk = ag_data["bunk"]
                    if bunk:
                        ag_bunk_names.add(bunk.name)
                        # Verify bunk is appropriate for AG
                        if "all-gender" not in bunk.name.lower() and "ag" not in bunk.name.lower():
                            self.warnings.append(
                                f"AG camper {ag_data['person'].person_cm_id} assigned to non-AG bunk: {bunk.name}"
                            )

                logger.info(f"  AG bunks in use: {sorted(ag_bunk_names)}")

            # Check for orphaned assignments
            self.check_orphaned_assignments()

        except Exception as e:
            self.errors.append(f"Error validating bunk assignments: {str(e)}")
            logger.error(f"Error validating bunk assignments: {e}", exc_info=True)

    def check_orphaned_assignments(self):
        """Check for assignments without valid attendees."""
        try:
            # Get all person_cm_ids from attendees
            attendees = self.pb.collection("attendees").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )
            valid_person_ids = set(a.person_cm_id for a in attendees)

            # Get all assignments
            assignments = self.pb.collection("bunk_assignments").get_full_list(
                query_params={"filter": f"year = {self.current_year}"}
            )

            orphaned = []
            for assignment in assignments:
                if assignment.person_cm_id not in valid_person_ids:
                    orphaned.append(assignment)

            if orphaned:
                self.errors.append(f"Found {len(orphaned)} orphaned assignments (no matching attendee)")
                for assignment in orphaned[:5]:  # Show first 5
                    logger.error(
                        f"  Orphaned: person_cm_id={assignment.person_cm_id}, session={assignment.session_cm_id}"
                    )
                if len(orphaned) > 5:
                    logger.error(f"  ... and {len(orphaned) - 5} more")
            else:
                logger.info("  ✓ No orphaned assignments found")

        except Exception as e:
            self.warnings.append(f"Could not check orphaned assignments: {str(e)}")

    def print_summary(self):
        """Print test summary."""
        logger.info("\n" + "=" * 80)
        logger.info("SUMMARY")
        logger.info("=" * 80)

        # Statistics
        logger.info("\nStatistics:")
        for key, value in sorted(self.stats.items()):
            logger.info(f"  {key}: {value}")

        # Errors
        if self.errors:
            logger.error(f"\n❌ Found {len(self.errors)} ERRORS:")
            for error in self.errors[:10]:  # Show first 10
                logger.error(f"  - {error}")
            if len(self.errors) > 10:
                logger.error(f"  ... and {len(self.errors) - 10} more")
        else:
            logger.info("\n✅ No errors found!")

        # Warnings
        if self.warnings:
            logger.warning(f"\n⚠️  Found {len(self.warnings)} warnings:")
            for warning in self.warnings[:10]:  # Show first 10
                logger.warning(f"  - {warning}")
            if len(self.warnings) > 10:
                logger.warning(f"  ... and {len(self.warnings) - 10} more")

        # Final result
        if self.errors:
            logger.error("\n❌ DATA INTEGRITY CHECK FAILED")
        else:
            logger.info("\n✅ DATA INTEGRITY CHECK PASSED")


def main():
    """Run data integrity tests."""
    tester = SessionDataIntegrityTester()
    success = tester.run_all_tests()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
