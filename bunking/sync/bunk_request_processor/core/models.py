"""Core domain models for the bunk request processing system.

These models represent the fundamental business concepts and are
independent of any external dependencies."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class RequestType(Enum):
    """Types of bunk requests"""

    BUNK_WITH = "bunk_with"
    NOT_BUNK_WITH = "not_bunk_with"
    AGE_PREFERENCE = "age_preference"


class SessionFamily(Enum):
    """Session family types"""

    MAIN = "main"
    AG = "ag"
    FAMILY = "family"


class Gender(Enum):
    """Gender options"""

    MALE = "M"
    FEMALE = "F"
    OTHER = "O"


class RequestSource(Enum):
    """Sources of bunk requests - simplified to two categories.

    Note: Values must match PocketBase schema (see migration 1754196925)

    FAMILY: Parent/family-submitted fields
      - share_bunk_with (bunk_with)
      - ret_parent_socialize_with_best (socialize_with)

    STAFF: Staff-written fields (staff validates family input)
      - do_not_share_bunk_with (not_bunk_with)
      - bunking_notes
      - internal_notes
    """

    FAMILY = "family"
    STAFF = "staff"


class RequestStatus(Enum):
    """Status of a bunk request

    Note: Values must match PocketBase schema (see migration 1500000009)
    - Use PENDING for requests needing manual review (unresolved names)
    """

    RESOLVED = "resolved"  # Successfully processed
    PENDING = "pending"  # Awaiting processing or needs manual review
    DECLINED = "declined"  # Cannot be processed


class AgePreference(Enum):
    """Age preference values"""

    OLDER = "older"
    YOUNGER = "younger"


@dataclass
class Session:
    """Represents a camp session"""

    id: str
    name: str
    family: SessionFamily
    start_date: datetime | None = None
    end_date: datetime | None = None


@dataclass
class Person:
    """Represents a camper or staff member"""

    cm_id: int
    first_name: str
    last_name: str
    preferred_name: str | None = None
    birth_date: datetime | None = None
    grade: int | None = None
    school: str | None = None
    city: str | None = None
    state: str | None = None
    session_cm_id: int | None = None
    age: float | None = None  # CampMinder's years.months format (e.g., 10.03 = 10 years, 3 months)
    parent_names: str | None = None  # JSON array of parent/guardian info
    household_id: int | None = None  # CampMinder household ID for sibling relationships
    metadata: dict[str, Any] = field(default_factory=dict)  # Additional metadata for social graph etc.

    @property
    def age_in_months(self) -> int | None:
        """Convert CampMinder age (years.months) to total months.

        CampMinder stores age as years.months format where:
        - Integer part = years
        - Decimal part = months (00-11)
        Example: 10.03 = 10 years, 3 months = 123 months

        Returns None if age is not set.
        """
        if self.age is None:
            return None

        # Parse years.months format
        years = int(self.age)
        # Get months from decimal part (e.g., 10.03 -> 03, 10.11 -> 11)
        months = round((self.age - years) * 100)
        return years * 12 + months

    def age_as_of(self, date: datetime) -> int:
        """Calculate age as of a specific date"""
        if not self.birth_date:
            return 0

        age = date.year - self.birth_date.year
        # Adjust if birthday hasn't occurred yet this year
        if (date.month, date.day) < (self.birth_date.month, self.birth_date.day):
            age -= 1
        return age

    @property
    def full_name(self) -> str:
        """Return first and last name"""
        return f"{self.first_name} {self.last_name}"

    @property
    def display_name(self) -> str:
        """Return preferred name if available, otherwise first name"""
        first = self.preferred_name or self.first_name
        return f"{first} {self.last_name}"

    @property
    def parents(self) -> list[dict[str, Any]]:
        """Parse and return the parent_names JSON as a list of dicts.

        Each dict contains:
        - first: parent's first name
        - last: parent's last name
        - relationship: 'Mother', 'Father', 'Guardian', etc.
        - is_primary: whether this is the primary contact
        """
        if not self.parent_names:
            return []
        try:
            import json

            parsed = json.loads(self.parent_names)
            return parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    @property
    def parent_last_names(self) -> list[str]:
        """Get unique last names from all parents/guardians.

        Useful for name resolution when requests use parent surnames.
        """
        last_names = set()
        for parent in self.parents:
            last = parent.get("last", "").strip()
            if last:
                last_names.add(last)
        return list(last_names)

    @property
    def parent_names_formatted(self) -> str | None:
        """Format parent names for display/AI context.

        Returns string like "Mother: Sarah Katz, Father: David Katz"
        """
        if not self.parents:
            return None
        parts = []
        for parent in self.parents:
            rel = parent.get("relationship", "Guardian")
            first = parent.get("first", "")
            last = parent.get("last", "")
            name = f"{first} {last}".strip()
            if name:
                parts.append(f"{rel}: {name}")
        return ", ".join(parts) if parts else None


@dataclass
class Camper(Person):
    """Represents a camper with additional camp-specific attributes"""

    session: Session | None = None
    gender: Gender | None = None
    grade_completed: int | None = None  # Grade they just completed
    campminder_age: Any | None = None  # CampMinderAge instance
    bunk: str | None = None

    @property
    def grade_entering(self) -> int | None:
        """Grade they're entering (completed + 1)"""
        return self.grade_completed + 1 if self.grade_completed is not None else None


@dataclass
class ParsedRequest:
    """Represents a parsed bunk request from CSV data.
    This is the intermediate format between raw CSV and final BunkRequest.
    """

    raw_text: str
    request_type: RequestType
    target_name: str | None  # For bunk_with/not_bunk_with
    age_preference: AgePreference | None  # For age_preference type
    source_field: str  # Which CSV field it came from
    source: RequestSource
    confidence: float
    csv_position: int  # Position in the CSV field (0-based)
    metadata: dict[str, Any]
    notes: str | None = None

    # Temporal conflict handling fields
    temporal_date: datetime | None = None
    """Parsed date from temporal_info.date_mentioned (e.g., datetime(2025, 6, 5))."""

    is_superseded: bool = False
    """True if this request is superseded by a later request (from AI temporal_info)."""

    supersedes_reason: str | None = None
    """Why this request was superseded (e.g., 'changed minds on 6/5')."""


@dataclass
class ResolvedName:
    """Result of name resolution attempt"""

    original_name: str
    matched_cm_id: int | None
    matched_person: Person | None
    confidence: float
    resolution_method: str  # "exact", "fuzzy", "phonetic", etc.
    alternate_matches: list[tuple[Person, float]]  # Other candidates with scores


@dataclass
class BunkRequest:
    """Final bunk request ready for persistence.
    This is what gets saved to the database.
    """

    requester_cm_id: int
    requested_cm_id: int | None  # None for age_preference and placeholders
    request_type: RequestType
    session_cm_id: int  # EXACT session (not family)
    priority: int  # 1-4 scale
    confidence_score: float
    source: RequestSource
    source_field: str  # Which CSV field it came from
    csv_position: int  # Position in the field
    year: int
    status: RequestStatus
    is_placeholder: bool  # True for LAST_YEAR_BUNKMATES
    metadata: dict[str, Any]  # All tracking info

    # Additional fields for business logic
    requester_name: str | None = None
    requested_name: str | None = None
    requester: Camper | None = None  # Full camper object if available
    requested: Camper | None = None  # Full camper object if available

    # Database ID (set when loading from DB, used for updates)
    id: str | None = None

    # Tracks all source fields that contributed to this request (set during merge or DB load)
    # During initial parsing this is None; after save/merge it contains all contributing fields
    source_fields: list[str] | None = None


# Three-Phase Processing Models


@dataclass
class ParseRequest:
    """Request to be parsed in Phase 1"""

    request_text: str
    field_name: str
    requester_name: str
    requester_cm_id: int
    requester_grade: str
    session_cm_id: int
    session_name: str
    year: int
    row_data: dict[str, Any]
    staff_metadata: dict[str, Any] | None = None
    """Staff attribution extracted from bunking_notes.

    Contains:
    - staff_name: The staff member's name (proper-cased)
    - timestamp: The date/time of the note
    - all_staff: List of all staff entries if multiple
    """


@dataclass
class ParseResult:
    """Result from Phase 1 parsing"""

    parsed_requests: list[ParsedRequest] = field(default_factory=list)
    needs_historical_context: bool = False
    is_valid: bool = True
    parse_request: ParseRequest | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        pass  # metadata is already initialized via default_factory

    @property
    def parsed_request(self) -> ParsedRequest | None:
        """DEPRECATED: Use `parsed_requests` list instead. This property will be removed.
        It returns the first request for limited backward compatibility during transition.
        """
        import warnings

        warnings.warn(
            "`ParseResult.parsed_request` is deprecated. Update to handle `parsed_requests` list.",
            DeprecationWarning,
            stacklevel=2,
        )
        if not self.parsed_requests:
            return None
        return self.parsed_requests[0]

    @property
    def request_count(self) -> int:
        """Number of parsed requests"""
        return len(self.parsed_requests)
