"""Temporal name cache for O(1) name lookups.

Matches monolith's build_temporal_name_cache() behavior:
- Pre-loads all persons and attendee session data
- Builds name-indexed dictionary with variations (full, first-only, preferred)
- Separates current year vs historical data
- Provides O(1) lookup methods

This eliminates SQL queries for name resolution and fixes the apostrophe bug
(where names like O'Brien caused SQL syntax errors)."""

from __future__ import annotations

import logging
from typing import Any

from ...core.models import Person
from ...shared import parse_date
from ...shared.name_utils import normalize_name

logger = logging.getLogger(__name__)


class TemporalNameCache:
    """Pre-built cache for O(1) name lookups.

    Structure matching monolith's name_to_cm_id:
    {
        "normalized_name": {
            "current": {
                "2025": [Person, ...]
            },
            "historical": {
                "2024": [Person, ...],
                "2023": [Person, ...]
            }
        },
        "FIRST:firstname": {...}  # First-name-only lookups
    }
    """

    def __init__(self, pb: Any, year: int) -> None:
        """Initialize the cache.

        Args:
            pb: PocketBase client
            year: Current processing year
        """
        self.pb = pb
        self.year = year

        self._person_cache: dict[int, Person] = {}  # cm_id -> Person
        self._attendees_with_sessions: dict[int, dict[str, Any]] = {}  # cm_id -> session info
        self._historical_bunking: dict[int, dict[int, dict[str, Any]]] = {}  # cm_id -> {year: info}

        # Name index (built from raw data)
        self._name_to_cm_id: dict[str, dict[str, dict[str, list[Person]]]] = {}

        # Parent surname index: PARENT:lastname -> [Person, ...]
        # Enables O(1) lookup when request uses parent's last name
        self._parent_surname_index: dict[str, list[Person]] = {}

        # Reverse index: session_cm_id -> [person_cm_id, ...]
        self._session_to_persons: dict[int, list[int]] = {}

        # Statistics
        self._stats = {
            "persons_loaded": 0,
            "attendees_loaded": 0,
            "historical_records": 0,
            "unique_names": 0,
        }

    def initialize(self) -> None:
        """Load all data and build the name index.

        Call this once at startup before using lookup methods.
        """
        logger.info("Initializing temporal name cache...")

        self._load_person_cache()
        self._load_attendees_with_sessions()
        self._load_historical_bunking()
        self._build_name_index()
        self._build_session_to_persons_index()

        logger.info(
            f"Temporal name cache initialized: "
            f"{self._stats['persons_loaded']} persons, "
            f"{self._stats['attendees_loaded']} attendees, "
            f"{self._stats['unique_names']} unique names"
        )

    def _load_person_cache(self) -> None:
        """Load all persons into cache."""
        logger.info("Loading persons cache...")

        try:
            # Load all persons for the current year

            # This is more efficient and prevents duplicate entries across years
            persons = self.pb.collection("persons").get_full_list(query_params={"filter": f"year = {self.year}"})

            for person_record in persons:
                cm_id = getattr(person_record, "cm_id", None)
                if cm_id:
                    person = self._map_to_person(person_record)
                    if person:
                        self._person_cache[cm_id] = person

            self._stats["persons_loaded"] = len(self._person_cache)
            logger.info(f"Loaded {len(self._person_cache)} persons into cache")

        except Exception as e:
            logger.error(f"Failed to load person cache: {e}")
            raise

    def _load_attendees_with_sessions(self) -> None:
        """Load attendees with full session information.

        Populates _attendees_with_sessions with session details.
        """
        logger.info("Loading attendees with session details...")

        try:
            # Get all sessions for name lookup
            sessions = self.pb.collection("camp_sessions").get_full_list()
            session_lookup = {
                getattr(s, "cm_id", None) or getattr(s, "campminder_id", None): getattr(s, "name", "") for s in sessions
            }

            # Build parent session map from session data
            # Parent session is determined by session's parent_id field
            parent_map = {}
            for s in sessions:
                cm_id = getattr(s, "cm_id", None) or getattr(s, "campminder_id", None)
                parent_cm_id = getattr(s, "parent_id", None)
                if cm_id:
                    if parent_cm_id:
                        parent_map[cm_id] = (parent_cm_id, session_lookup.get(parent_cm_id, f"Session {parent_cm_id}"))
                    else:
                        # Session is its own parent
                        parent_map[cm_id] = (cm_id, session_lookup.get(cm_id, f"Session {cm_id}"))

            # Load attendees for current year with session expanded
            attendees = self.pb.collection("attendees").get_full_list(
                query_params={
                    "filter": f"year = {self.year}",
                    "expand": "session",
                }
            )

            for attendee in attendees:
                # Get person CM ID (field name may vary)
                person_cm_id = getattr(attendee, "person_id", None) or getattr(attendee, "person_cm_id", None)

                # Get session CM ID from expanded relation or direct field
                session_cm_id = None
                expand = getattr(attendee, "expand", None) or {}
                if expand and "session" in expand:
                    session_data = expand["session"]
                    session_cm_id = getattr(session_data, "cm_id", None) or getattr(session_data, "campminder_id", None)
                if not session_cm_id:
                    session_cm_id = getattr(attendee, "session_cm_id", None)

                if person_cm_id and session_cm_id:
                    # Get parent session info
                    parent_id, parent_name = parent_map.get(
                        session_cm_id, (session_cm_id, session_lookup.get(session_cm_id, f"Session {session_cm_id}"))
                    )

                    self._attendees_with_sessions[person_cm_id] = {
                        "session_cm_id": session_cm_id,
                        "session_name": session_lookup.get(session_cm_id, f"Session {session_cm_id}"),
                        "parent_session_id": parent_id,
                        "parent_session_name": parent_name,
                    }

            self._stats["attendees_loaded"] = len(self._attendees_with_sessions)
            logger.info(f"Loaded session details for {len(self._attendees_with_sessions)} attendees")

        except Exception as e:
            logger.error(f"Failed to load attendees with sessions: {e}")
            raise

    def _load_historical_bunking(self) -> None:
        """Load historical bunking data from bunk_assignments table.

        Unlike monolith which queries non-existent 'historical_bunking' table,
        we use the modern schema: bunk_assignments with year < current_year.
        """
        logger.info("Loading historical bunking data...")

        try:
            # Get all sessions for name lookup
            sessions = self.pb.collection("camp_sessions").get_full_list()
            session_lookup = {
                getattr(s, "cm_id", None) or getattr(s, "campminder_id", None): getattr(s, "name", "") for s in sessions
            }

            # Query bunk_assignments for previous 2 years only
            # This limits memory usage while still providing useful historical context
            # For bunk request processing, 2 years is sufficient for name disambiguation
            min_year = self.year - 2
            assignments = self.pb.collection("bunk_assignments").get_full_list(
                query_params={
                    "filter": f"year >= {min_year} && year < {self.year}",
                    "expand": "person,bunk,session",
                }
            )

            for assignment in assignments:
                expand = getattr(assignment, "expand", {}) or {}
                person_data = expand.get("person")
                bunk_data = expand.get("bunk")
                session_data = expand.get("session")

                if not person_data:
                    continue

                person_cm_id = getattr(person_data, "cm_id", None)
                year = getattr(assignment, "year", None)
                session_cm_id = getattr(session_data, "cm_id", None) if session_data else None
                bunk_name = getattr(bunk_data, "name", "") if bunk_data else ""

                if person_cm_id and year:
                    if person_cm_id not in self._historical_bunking:
                        self._historical_bunking[person_cm_id] = {}

                    # Only store most recent assignment per year
                    # (in case of duplicates)
                    if year not in self._historical_bunking[person_cm_id]:
                        self._historical_bunking[person_cm_id][year] = {
                            "session_cm_id": session_cm_id,
                            "session_name": session_lookup.get(session_cm_id, f"Session {session_cm_id}")
                            if session_cm_id
                            else "",
                            "parent_session_id": session_cm_id,  # Simplified - no parent tracking for historical
                            "parent_session_name": session_lookup.get(session_cm_id, "") if session_cm_id else "",
                            "bunk": bunk_name,
                        }

            total_historical = sum(len(years) for years in self._historical_bunking.values())
            self._stats["historical_records"] = total_historical
            logger.info(
                f"Loaded historical bunking for {len(self._historical_bunking)} persons ({total_historical} year-records)"
            )

        except Exception as e:
            logger.warning(f"Failed to load historical bunking (non-fatal): {e}")
            # Historical data is optional - don't raise

    def _build_name_index(self) -> None:
        """Build the name-to-person index from loaded data.

        Creates entries for:
        - Full name (first + last)
        - First-name only (FIRST:firstname)
        - Preferred name + last (if preferred_name exists)
        """
        logger.info("Building temporal name cache index...")
        self._name_to_cm_id = {}

        for cm_id, person in self._person_cache.items():
            # Build name variations
            name_variations = []

            # Full name
            full_name = f"{person.first_name or ''} {person.last_name or ''}".strip()
            if full_name:
                name_variations.append(("full", full_name))

            # First name only (for partial matching)
            if person.first_name:
                name_variations.append(("first", f"FIRST:{person.first_name.lower()}"))

            # Preferred name combinations
            preferred_name = (person.preferred_name or "").strip()
            if preferred_name and person.last_name:
                # Preferred + last name
                preferred_full = f"{preferred_name} {person.last_name}".strip()
                name_variations.append(("preferred_full", preferred_full))
                # Preferred name only
                name_variations.append(("preferred_first", f"FIRST:{preferred_name.lower()}"))

            # Process each name variation
            for _name_type, name in name_variations:
                # Normalize (unless it's a FIRST: key which is already formatted)
                normalized = name if name.startswith("FIRST:") else normalize_name(name)

                # Initialize structure if needed
                if normalized not in self._name_to_cm_id:
                    self._name_to_cm_id[normalized] = {
                        "current": {},
                        "historical": {},
                    }

                # Check if person is a current year attendee
                if cm_id in self._attendees_with_sessions:
                    year_str = str(self.year)
                    if year_str not in self._name_to_cm_id[normalized]["current"]:
                        self._name_to_cm_id[normalized]["current"][year_str] = []

                    # Avoid duplicates
                    existing = self._name_to_cm_id[normalized]["current"][year_str]
                    if not any(p.cm_id == cm_id for p in existing):
                        self._name_to_cm_id[normalized]["current"][year_str].append(person)

                # Add historical data if available
                if cm_id in self._historical_bunking:
                    for year, _year_data in self._historical_bunking[cm_id].items():
                        year_str = str(year)
                        if year_str not in self._name_to_cm_id[normalized]["historical"]:
                            self._name_to_cm_id[normalized]["historical"][year_str] = []

                        existing = self._name_to_cm_id[normalized]["historical"][year_str]
                        if not any(p.cm_id == cm_id for p in existing):
                            self._name_to_cm_id[normalized]["historical"][year_str].append(person)

        self._stats["unique_names"] = len(self._name_to_cm_id)
        logger.info(f"Built cache with {len(self._name_to_cm_id)} unique name keys")

        # Build parent surname index
        self._build_parent_surname_index()

    def _build_parent_surname_index(self) -> None:
        """Build index from parent surnames to persons.

        Creates entries like PARENT:smith -> [Person1, Person2, ...]
        where Person1 and Person2 have a parent with last name 'Smith'.

        This enables O(1) lookup when a request uses a parent's last name
        instead of the camper's last name.
        """
        logger.info("Building parent surname index...")
        self._parent_surname_index = {}

        for cm_id, person in self._person_cache.items():
            # Only index current year attendees
            if cm_id not in self._attendees_with_sessions:
                continue

            # Get parent last names from the Person model
            for parent_surname in person.parent_last_names:
                # Normalize the parent surname
                normalized = normalize_name(parent_surname)
                key = f"PARENT:{normalized}"

                if key not in self._parent_surname_index:
                    self._parent_surname_index[key] = []

                # Avoid duplicates
                if not any(p.cm_id == cm_id for p in self._parent_surname_index[key]):
                    self._parent_surname_index[key].append(person)

        logger.info(f"Built parent surname index with {len(self._parent_surname_index)} unique surnames")

    def find_by_parent_surname(self, first_name: str, parent_surname: str, year: int | None = None) -> list[Person]:
        """Find persons by first name and parent's last name.

        O(1) lookup using the parent surname index.

        Args:
            first_name: First name to match
            parent_surname: Parent's last name to match
            year: Optional year filter (ignored since cache is year-filtered at init)

        Returns:
            List of matching Person objects
        """
        # Note: year param ignored - cache is pre-filtered to self.year during init
        normalized_surname = normalize_name(parent_surname)
        key = f"PARENT:{normalized_surname}"

        if key not in self._parent_surname_index:
            return []

        # Filter by first name match
        normalized_first = normalize_name(first_name)
        matches = []
        for person in self._parent_surname_index[key]:
            person_first = normalize_name(person.first_name or "")
            person_preferred = normalize_name(person.preferred_name or "") if person.preferred_name else ""

            if person_first == normalized_first or person_preferred == normalized_first:
                matches.append(person)

        return matches

    def find_by_name(self, first_name: str, last_name: str, year: int | None = None) -> list[Person]:
        """Find persons by first and last name.

        O(1) lookup - no SQL queries. Handles apostrophes and special chars.

        Args:
            first_name: First name to search
            last_name: Last name to search
            year: Optional year to filter by (defaults to current year)

        Returns:
            List of matching Person objects
        """
        full_name = f"{first_name} {last_name}"
        normalized = normalize_name(full_name)

        return self._get_matches(normalized, year)

    def find_by_first_name(self, first_name: str, year: int | None = None) -> list[Person]:
        """Find persons by first name only.

        Uses FIRST: prefix pattern matching monolith behavior.

        Args:
            first_name: First name to search
            year: Optional year to filter by (defaults to current year)

        Returns:
            List of matching Person objects
        """
        key = f"FIRST:{first_name.lower()}"
        return self._get_matches(key, year)

    def _get_matches(self, normalized_key: str, year: int | None = None) -> list[Person]:
        """Get matches for a normalized key.

        Args:
            normalized_key: Normalized name or FIRST: key
            year: Year to filter by (None means current year)

        Returns:
            List of matching persons
        """
        if normalized_key not in self._name_to_cm_id:
            return []

        data = self._name_to_cm_id[normalized_key]
        target_year = year or self.year
        year_str = str(target_year)

        # Check current year first
        if year_str in data.get("current", {}):
            return list(data["current"][year_str])

        # Check historical
        if year_str in data.get("historical", {}):
            return list(data["historical"][year_str])

        return []

    def get_person(self, cm_id: int) -> Person | None:
        """Get person by CM ID.

        O(1) lookup.

        Args:
            cm_id: CampMinder person ID

        Returns:
            Person object or None if not found
        """
        return self._person_cache.get(cm_id)

    def get_session_info(self, cm_id: int) -> dict[str, Any] | None:
        """Get session info for a person.

        Args:
            cm_id: CampMinder person ID

        Returns:
            Dict with session_cm_id, session_name, parent_session_id, parent_session_name
            or None if not found
        """
        return self._attendees_with_sessions.get(cm_id)

    def get_historical_info(self, cm_id: int, year: int) -> dict[str, Any] | None:
        """Get historical bunking info for a person in a specific year.

        Args:
            cm_id: CampMinder person ID
            year: Historical year to look up

        Returns:
            Dict with session and bunk info, or None if not found
        """
        person_history = self._historical_bunking.get(cm_id)
        if person_history:
            return person_history.get(year)
        return None

    def verify_bunk_together(self, requester_cm_id: int, target_cm_ids: list[int], year: int) -> tuple[bool, str]:
        """Verify if requester and all targets were in the same bunk in a given year.

        This matches monolith's verify_historical_bunk_together() behavior

        Args:
            requester_cm_id: The requester's CM ID
            target_cm_ids: List of target CM IDs to check
            year: Year to check

        Returns:
            Tuple of (were_together, bunk_name):
            - (True, bunk_name) if all were in same bunk
            - (False, "") if not all together or data missing
        """
        # Get requester's historical bunking for the year
        requester_data = self._historical_bunking.get(requester_cm_id, {})
        requester_year_data = requester_data.get(year, {})

        if not requester_year_data:
            return False, ""

        requester_bunk = requester_year_data.get("bunk_name", "")
        requester_session = requester_year_data.get("session_cm_id")

        if not requester_bunk:
            return False, ""

        # Empty target list is vacuously true (all zero targets were in same bunk)
        if not target_cm_ids:
            return True, requester_bunk

        # Check if all targets were in the same bunk AND session
        for target_id in target_cm_ids:
            target_data = self._historical_bunking.get(target_id, {})
            target_year_data = target_data.get(year, {})

            # Target has no history for this year
            if not target_year_data:
                return False, ""

            target_bunk = target_year_data.get("bunk_name", "")
            target_session = target_year_data.get("session_cm_id")

            # Both bunk name and session must match
            if target_bunk != requester_bunk or target_session != requester_session:
                return False, ""

        # All targets verified in same bunk
        return True, requester_bunk

    def get_stats(self) -> dict[str, int]:
        """Get cache statistics"""
        return dict(self._stats)

    # ========================================================================
    # ========================================================================

    def _build_session_to_persons_index(self) -> None:
        """Build reverse index: session_cm_id → [person_cm_id, ...].

        The monolith iterates over person_cache and attendees_cache
        to count people with same first name in same session.
        This index enables O(1) lookup instead of O(n) iteration.
        """
        self._session_to_persons = {}

        for person_cm_id, session_info in self._attendees_with_sessions.items():
            session_cm_id = session_info.get("session_cm_id")
            if session_cm_id:
                if session_cm_id not in self._session_to_persons:
                    self._session_to_persons[session_cm_id] = []
                self._session_to_persons[session_cm_id].append(person_cm_id)

        logger.debug(f"Built session→persons index: {len(self._session_to_persons)} sessions")

    def get_persons_in_session(self, session_cm_id: int) -> list[int]:
        """Get all person CM IDs attending a session.

        Args:
            session_cm_id: Session CampMinder ID

        Returns:
            List of person CM IDs in that session, or empty list if not found
        """
        return self._session_to_persons.get(session_cm_id, [])

    def count_session_peers_with_first_name(self, session_cm_id: int, first_name: str, exclude_cm_id: int) -> int:
        """Count peers in a session with the same first name.

        - Get all people in the requester's session
        - Count how many have the same first name
        - Exclude the requester from the count

        This is critical for self-reference detection:
        If count == 0, a first-name-only request matching the requester's
        name is likely self-referential.

        Args:
            session_cm_id: Session to search in
            first_name: First name to match (case-insensitive)
            exclude_cm_id: Person CM ID to exclude (the requester)

        Returns:
            Count of OTHER people in session with same first name
        """
        persons_in_session = self.get_persons_in_session(session_cm_id)

        if not persons_in_session:
            return 0

        normalized_first = normalize_name(first_name) if first_name else ""
        if not normalized_first:
            return 0

        count = 0
        for person_cm_id in persons_in_session:
            # Skip the requester
            if person_cm_id == exclude_cm_id:
                continue

            # Get person from cache
            person = self._person_cache.get(person_cm_id)
            if not person:
                continue

            # Compare normalized first names
            person_first = normalize_name(person.first_name or "")
            if person_first == normalized_first:
                count += 1

        return count

    def get_self_reference_context(self, requester_cm_id: int, session_cm_id: int) -> dict[str, Any] | None:
        """Get context needed for self-reference validation.

        Returns metadata that SelfReferenceRule uses to detect
        first-name-only self-referential requests.

        Args:
            requester_cm_id: The requester's CM ID
            session_cm_id: Session CM ID for the request

        Returns:
            Dict with:
                - requester_first_name: Normalized first name
                - session_peers_with_same_first_name: Count of other people
                  in session with same first name
            Or None if requester not found
        """
        person = self._person_cache.get(requester_cm_id)
        if not person:
            return None

        first_name = person.first_name or ""
        normalized_first = normalize_name(first_name)

        peer_count = self.count_session_peers_with_first_name(
            session_cm_id=session_cm_id, first_name=first_name, exclude_cm_id=requester_cm_id
        )

        return {
            "requester_first_name": normalized_first,
            "session_peers_with_same_first_name": peer_count,
        }

    def _map_to_person(self, db_record: Any) -> Person | None:
        """Map database record to Person model"""
        try:
            # Parse birth date
            birth_date = None
            if hasattr(db_record, "birthdate") and db_record.birthdate:
                birth_date = parse_date(db_record.birthdate)

            # Parse address JSON to extract city and state
            city = None
            state = None
            if hasattr(db_record, "address") and db_record.address:
                addr = db_record.address
                if isinstance(addr, dict):
                    city = addr.get("city")
                    state = addr.get("state")
                elif isinstance(addr, str) and addr.strip():
                    try:
                        import json

                        addr_dict = json.loads(addr)
                        city = addr_dict.get("city")
                        state = addr_dict.get("state")
                    except (json.JSONDecodeError, TypeError):
                        pass

            # Get parent_names JSON (for name resolution via parent surnames)
            parent_names = getattr(db_record, "parent_names", None)

            # Extract required fields with explicit type handling
            first_name: str = getattr(db_record, "first_name", None) or ""
            last_name: str = getattr(db_record, "last_name", None) or ""

            return Person(
                cm_id=db_record.cm_id,
                first_name=first_name,
                last_name=last_name,
                preferred_name=getattr(db_record, "preferred_name", None),
                birth_date=birth_date,
                grade=getattr(db_record, "grade", None),
                school=getattr(db_record, "school", None),
                city=city,
                state=state,
                session_cm_id=None,
                parent_names=parent_names,  # JSON of parent/guardian info
                household_id=getattr(db_record, "household_id", None),  # For sibling lookup
            )
        except Exception as e:
            logger.error(f"Error mapping person record: {e}")
            return None
