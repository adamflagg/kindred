"""Person repository for data access.

Handles all database operations related to Person entities.
When a TemporalNameCache is provided, uses O(1) cache lookups instead of DB queries."""

from __future__ import annotations

import logging
import warnings
from typing import TYPE_CHECKING, Any

from pocketbase import PocketBase

from ...core.interfaces import Repository
from ...core.models import Person
from ...shared import parse_date
from ...shared.name_utils import normalize_name
from ..pocketbase_wrapper import PocketBaseWrapper

if TYPE_CHECKING:
    from ..cache.temporal_name_cache import TemporalNameCache

logger = logging.getLogger(__name__)


def _escape_filter_value(value: str) -> str:
    """Escape a string value for use in PocketBase filter queries.

    Single quotes in values must be escaped by doubling them to prevent
    filter injection (e.g., O'Brien -> O''Brien).
    """
    return value.replace("'", "''")


class PersonRepository(Repository):
    """Repository for Person data access

    When name_cache is provided, uses O(1) cache lookups for name resolution,
    matching monolith's build_temporal_name_cache() behavior. This eliminates
    SQL queries and fixes issues like apostrophes in names breaking SQL syntax.

    NOTE: Prefer using DataAccessContext.persons instead of direct construction.
    """

    _from_factory: bool = False  # Set by RepositoryFactory to suppress warnings

    def __init__(
        self,
        pb_client: PocketBase | PocketBaseWrapper,
        cache: Any = None,
        name_cache: TemporalNameCache | None = None,
    ) -> None:
        """Initialize repository with PocketBase client.

        Args:
            pb_client: PocketBase client instance
            cache: Optional LRU cache for cm_id lookups
            name_cache: Optional TemporalNameCache for O(1) name lookups
        """
        if not getattr(self.__class__, "_from_factory", False):
            warnings.warn(
                "Direct PersonRepository construction is deprecated. Use DataAccessContext.persons instead.",
                DeprecationWarning,
                stacklevel=2,
            )
        self.pb = pb_client
        self.cache = cache
        self.name_cache = name_cache

    def find_by_id(self, id: int) -> Person | None:
        """Find person by CM ID"""
        return self.find_by_cm_id(id)

    def save(self, entity: Person) -> bool:
        """Save is not implemented for persons (read-only from CampMinder)"""
        raise NotImplementedError("Person records are read-only from CampMinder")

    def delete(self, id: int) -> bool:
        """Delete is not implemented for persons (read-only from CampMinder)"""
        raise NotImplementedError("Person records are read-only from CampMinder")

    def find_by_cm_id(self, cm_id: int) -> Person | None:
        """Find a person by their CampMinder ID

        Uses name_cache for O(1) lookup if available, otherwise falls back to DB query.
        """
        # Check name_cache first (O(1) lookup)
        if self.name_cache:
            return self.name_cache.get_person(cm_id)

        # Check LRU cache second
        if self.cache:
            cache_key = f"person:cm_id:{cm_id}"
            cached = self.cache.get(cache_key)
            if cached is not None:
                # Cache returns Any, but we know it's a Person
                person_from_cache: Person = cached
                return person_from_cache

        # Query database as fallback
        try:
            result = self.pb.collection("persons").get_list(query_params={"filter": f"cm_id = {cm_id}", "perPage": 1})

            if result.items:
                person = self._map_to_person(result.items[0])
                # Cache the result
                if self.cache and person:
                    self.cache.set(cache_key, person)
                if person is not None:
                    return person

        except Exception as e:
            logger.error("Error finding person by CM ID %s: %s", cm_id, e)

        return None

    def find_by_name(self, first_name: str, last_name: str, year: int | None = None) -> list[Person]:
        """Find all people with the given first and last name.

        When name_cache is available, uses O(1) cache lookup. This also handles
        names with apostrophes (O'Brien, D'Amato) that would break SQL syntax.

        Also matches preferred_name for parity with monolith's temporal name cache
        which indexes both first_name and preferred_name variations. This allows
        finding "Bobby Smith" when person has first_name="Robert", preferred_name="Bobby".

        Args:
            first_name: First name to search for
            last_name: Last name to search for
            year: Optional year to filter by. If provided, only returns persons
                  from that year's snapshot. This is important because persons
                  table has one record per year with potentially different grades.
        """
        # Use name_cache for O(1) lookup if available
        if self.name_cache:
            return self.name_cache.find_by_name(first_name, last_name, year)

        # Fall back to DB query
        try:
            # Escape names for filter syntax (handles apostrophes in O'Brien, D'Amato, etc.)
            escaped_first = _escape_filter_value(first_name)
            escaped_last = _escape_filter_value(last_name)
            # Check both first_name and preferred_name for the given name
            filter_str = f"(first_name = '{escaped_first}' || preferred_name = '{escaped_first}') && last_name = '{escaped_last}'"
            if year is not None:
                filter_str += f" && year = {year}"

            result = self.pb.collection("persons").get_list(query_params={"filter": filter_str, "perPage": 30})

            return [p for p in (self._map_to_person(item) for item in result.items) if p is not None]

        except Exception as e:
            logger.error("Error finding people by name %s %s: %s", first_name, last_name, e)
            return []

    def find_by_first_name(self, first_name: str, year: int | None = None) -> list[Person]:
        """Find all people with the given first name.

        When name_cache is available, uses O(1) cache lookup with FIRST: prefix pattern.

        Used for 'FirstName Initial' patterns like 'Joe C' where we need to find
        all people named Joe and then filter by last name initial.

        Also matches preferred_name for parity with monolith's temporal name cache
        which indexes "FIRST:preferredname" variations. This allows finding people
        when referred to by their preferred name (e.g., "Bobby" finds person with
        first_name="Robert", preferred_name="Bobby").

        Args:
            first_name: First name to search for
            year: Optional year to filter by. If provided, only returns persons
                  from that year's snapshot. This is important because persons
                  table has one record per year with potentially different grades.
        """
        # Use name_cache for O(1) lookup if available
        if self.name_cache:
            return self.name_cache.find_by_first_name(first_name, year)

        # Fall back to DB query
        try:
            # Escape name for filter syntax (handles apostrophes)
            escaped_first = _escape_filter_value(first_name)
            # Check both first_name and preferred_name for the given name
            filter_str = f"(first_name = '{escaped_first}' || preferred_name = '{escaped_first}')"
            if year is not None:
                filter_str += f" && year = {year}"

            result = self.pb.collection("persons").get_list(
                query_params={
                    "filter": filter_str,
                    "perPage": 100,  # Higher limit for first-name-only searches
                }
            )

            return [p for p in (self._map_to_person(item) for item in result.items) if p is not None]

        except Exception as e:
            logger.error("Error finding people by first name %s: %s", first_name, e)
            return []

    def find_by_first_and_parent_surname(
        self, first_name: str, parent_surname: str, year: int | None = None
    ) -> list[Person]:
        """Find people where first name matches and parent has this last name.

        Used for matching requests like "Emma Smith" when Emma's dad is John Smith,
        but Emma's last name is actually Johnson.

        When name_cache is available, uses O(1) parent surname index lookup.

        Args:
            first_name: First name to search for
            parent_surname: Parent's last name to search for
            year: Optional year to filter by.
        """
        # Use name_cache for O(1) lookup if available
        if self.name_cache:
            return self.name_cache.find_by_parent_surname(first_name, parent_surname, year)

        # Fall back to in-memory scan (parent_names is JSON, can't filter in SQL easily)
        try:
            # Escape name for filter syntax (handles apostrophes)
            escaped_first = _escape_filter_value(first_name)
            filter_str = f"first_name = '{escaped_first}'"
            if year is not None:
                filter_str += f" && year = {year}"

            # Get all with matching first name, then filter by parent surname
            result = self.pb.collection("persons").get_full_list(query_params={"filter": filter_str})

            matches = []
            parent_surname_lower = parent_surname.lower()
            for item in result:
                person = self._map_to_person(item)
                if person and parent_surname_lower in [s.lower() for s in person.parent_last_names]:
                    matches.append(person)

            return matches

        except Exception as e:
            logger.error("Error finding people by first name and parent surname: %s", e)
            return []

    def find_by_session(self, session_cm_id: int, year: int) -> list[Person]:
        """Find all people enrolled in a specific session and year"""
        try:
            # Get attendee records with session expanded (session_id field was deleted)
            attendees = self.pb.collection("attendees").get_full_list(
                query_params={"filter": f"year = {year}", "expand": "session"}
            )

            if not attendees:
                return []

            # Filter by session CM ID in Python (via expanded relation)
            # and extract person CM IDs (person_id still exists as direct field)
            person_cm_ids = []
            for a in attendees:
                # Get session CM ID from expanded relation
                if hasattr(a, "expand") and a.expand:
                    session = a.expand.get("session")
                    if session and session.cm_id == session_cm_id:
                        # person_id is a direct field with CM ID
                        if hasattr(a, "person_id") and a.person_id:
                            person_cm_ids.append(a.person_id)

            if not person_cm_ids:
                return []

            # Batch fetch all persons
            cm_ids_str = ", ".join(map(str, person_cm_ids))
            persons = self.pb.collection("persons").get_list(
                query_params={"filter": f"cm_id IN ({cm_ids_str})", "perPage": len(person_cm_ids)}
            )

            return [p for p in (self._map_to_person(item) for item in persons.items) if p is not None]

        except Exception as e:
            logger.error("Error finding people by session %s: %s", session_cm_id, e)
            return []

    def find_by_normalized_name(self, normalized_name: str, year: int | None = None) -> list[Person]:
        """Find people by normalized name (lowercase, no punctuation).
        This requires fetching persons and filtering in memory.

        Uses shared normalize_name() on BOTH search term and DB records to ensure
        consistent matching. This fixes the asymmetric normalization bug where
        names with apostrophes (O'Brien, D'Amato) would never match.

        - Strips whitespace, converts to lowercase
        - Collapses multiple whitespace
        - Removes punctuation: . , ' " ( )
        - Preserves hyphens (per monolith behavior)

        Args:
            normalized_name: Name to search for (will be normalized)
            year: Optional year to filter by. If provided, only returns persons
                  from that year's snapshot. This is important because persons
                  table has one record per year with potentially different grades.
        """
        try:
            # Get persons, optionally filtered by year
            if year is not None:
                all_persons = self.pb.collection("persons").get_full_list(query_params={"filter": f"year = {year}"})
            else:
                all_persons = self.pb.collection("persons").get_full_list()

            matches = []
            # Use normalize_name() for consistent normalization
            normalized_search = normalize_name(normalized_name)

            for person_data in all_persons:
                # Normalize the person's name using the SAME function
                fname = getattr(person_data, "first_name", "") or ""
                lname = getattr(person_data, "last_name", "") or ""
                full_name = normalize_name(f"{fname} {lname}")

                if full_name == normalized_search:
                    person = self._map_to_person(person_data)
                    if person is not None:
                        matches.append(person)

            return matches

        except Exception as e:
            logger.error("Error finding people by normalized name %s: %s", normalized_name, e)
            return []

    def bulk_find_by_cm_ids(self, cm_ids: list[int]) -> dict[int, Person]:
        """Find multiple people by their CM IDs in one query

        Uses name_cache for O(1) lookups when available.
        """
        if not cm_ids:
            return {}

        # Use name_cache for O(1) lookups if available
        if self.name_cache:
            result = {}
            for cm_id in cm_ids:
                person = self.name_cache.get_person(cm_id)
                if person:
                    result[cm_id] = person
            return result

        # Fall back to DB query
        try:
            # Build the IN clause
            cm_ids_str = ", ".join(map(str, cm_ids))

            query_result = self.pb.collection("persons").get_list(
                query_params={"filter": f"cm_id IN ({cm_ids_str})", "perPage": len(cm_ids)}
            )

            # Map to dictionary keyed by CM ID
            persons_dict: dict[int, Person] = {}
            for item in query_result.items:
                person = self._map_to_person(item)
                if person:
                    persons_dict[person.cm_id] = person

            return persons_dict

        except Exception as e:
            logger.error("Error bulk finding people by CM IDs: %s", e)
            return {}

    def find_siblings(self, cm_id: int, year: int) -> list[Person]:
        """Find siblings of a person by matching household_id.

        Returns all other persons with the same household_id, excluding
        the person themselves. Used for expanding SIBLING placeholders
        when parents say "bunk with twins" or "with sibling".

        Args:
            cm_id: CampMinder ID of the person whose siblings to find
            year: Year to filter by (persons table has year-specific records)

        Returns:
            List of sibling Person objects (empty if no siblings or no household_id)
        """
        # First get the person's household_id
        person = self.find_by_cm_id(cm_id)
        if not person or not person.household_id:
            logger.debug(f"No household_id found for person {cm_id}")
            return []

        try:
            # Query for other persons with same household_id
            result = self.pb.collection("persons").get_list(
                query_params={
                    "filter": f"household_id = {person.household_id} && cm_id != {cm_id} && year = {year}",
                    "perPage": 10,  # Most families have 2-3 kids max
                }
            )

            siblings = [p for p in (self._map_to_person(item) for item in result.items) if p is not None]

            logger.info(
                f"Found {len(siblings)} sibling(s) for person {cm_id} "
                f"(household {person.household_id}): {[s.full_name for s in siblings]}"
            )
            return siblings

        except Exception as e:
            logger.error(f"Error finding siblings for person {cm_id}: {e}")
            return []

    def get_all_for_phonetic_matching(self, year: int | None = None) -> list[Person]:
        """Get all persons for phonetic matching.

        When name_cache is available, returns all cached persons (O(1)).
        Otherwise falls back to paginated DB query.

        Args:
            year: Optional year to filter by. If provided, only returns persons
                  from that year's snapshot. This is important because persons
                  table has one record per year with potentially different grades.
                  Without year filtering, the same person may appear multiple times
                  (once per year they attended), causing false "ambiguous" results.

        Returns:
            List of Person objects (filtered by year if specified)
        """
        # Use name_cache for O(1) access if available
        if self.name_cache:
            # The cache is already filtered to current year during initialization
            # If year param matches cache year, return all cached persons
            if year is None or year == self.name_cache.year:
                return list(self.name_cache._person_cache.values())
            # If different year requested, we need DB query (rare case)

        # Fall back to DB query
        all_persons = []
        page = 1
        per_page = 500

        # Build filter for year if provided
        filter_param = f"year = {year}" if year is not None else None

        while True:
            query_params = {"sort": "cm_id", "page": page, "perPage": per_page}
            if filter_param:
                query_params["filter"] = filter_param

            result = self.pb.collection("persons").get_list(query_params=query_params)

            for item in result.items:
                person = self._map_to_person(item)
                if person:
                    all_persons.append(person)

            if page >= result.total_pages:
                break

            page += 1

        return all_persons

    def _map_to_person(self, db_record: Any) -> Person | None:
        """Map database record to Person model"""
        try:
            # Parse birth date
            birth_date = None
            if hasattr(db_record, "birthdate") and db_record.birthdate:
                birth_date = parse_date(db_record.birthdate)

            # Parse address JSON to extract city and state
            # Address format: {"city": "Oakland", "state": "CA"}
            city = None
            state = None
            if hasattr(db_record, "address") and db_record.address:
                addr = db_record.address
                # Handle both dict (already parsed) and string (JSON) formats
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
                        pass  # Invalid JSON, leave city/state as None

            # Parse CampMinder age (years.months format, e.g., 10.03)
            cm_age = None
            if hasattr(db_record, "age") and db_record.age:
                try:
                    cm_age = float(db_record.age)
                except (ValueError, TypeError):
                    pass  # Invalid age value, leave as None

            # Get parent_names JSON (for name resolution via parent surnames)
            parent_names = None
            if hasattr(db_record, "parent_names") and db_record.parent_names:
                parent_names = db_record.parent_names

            # Get household_id for sibling lookups
            household_id = None
            if hasattr(db_record, "household_id") and db_record.household_id:
                try:
                    household_id = int(db_record.household_id)
                except (ValueError, TypeError):
                    pass

            return Person(
                cm_id=db_record.cm_id,
                first_name=db_record.first_name,
                last_name=db_record.last_name,
                preferred_name=db_record.preferred_name if hasattr(db_record, "preferred_name") else None,
                birth_date=birth_date,
                grade=db_record.grade if hasattr(db_record, "grade") else None,
                school=db_record.school if hasattr(db_record, "school") else None,
                city=city,
                state=state,
                session_cm_id=None,  # Will be set from attendee data if needed
                age=cm_age,  # CampMinder's authoritative age field
                parent_names=parent_names,  # JSON of parent/guardian info
                household_id=household_id,  # For sibling lookups
            )
        except Exception as e:
            logger.error("Error mapping person record: %s", e)
            return None
