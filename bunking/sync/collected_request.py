"""
Collected Request dataclass - shared between sync modules
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass
class CollectedRequest:
    """Represents a request collected from any source before database creation"""

    requester_cm_id: int
    request_type: str  # 'bunk_with', 'not_bunk_with', 'age_preference', etc.
    year: int
    source: str  # 'csv', 'friend_group', 'manual', 'conflict_resolution'

    # Optional fields
    requested_cm_id: int | None = None
    session_cm_id: int | None = None
    priority: int = 5
    confidence_score: float = 0.0
    original_text: str = ""
    parse_notes: str = ""
    target_name: str = ""  # Name before resolution to cm_id

    # Metadata
    source_field: str = ""  # Which CSV field it came from
    source_detail: str | None = None  # For age_preference: 'explicit', 'social', 'observation'
    ai_parsed: bool = False
    is_reciprocal: bool = False
    requires_manual_review: bool = False
    manual_review_reason: str = ""

    # Complex fields
    metadata: dict[str, Any] = field(default_factory=dict)
    keywords_found: list[str] = field(default_factory=list)

    # Friend group specific
    friend_group_id: str | None = None

    # Tracking
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_db_dict(self) -> dict[str, Any] | None:
        """Convert to dictionary for database creation"""
        # Skip special_notes as it's not a valid request type
        if self.request_type == "special_notes":
            return None

        # Determine status based on confidence, request type, and validation
        # Two-tier threshold system:
        #   >= resolved_threshold (0.85): Mark as 'resolved'
        #   < resolved_threshold (0.85): Mark as 'pending' (needs manual review)
        # The auto_accept threshold (0.95) is used by frontend for filtering:
        #   - High confidence (>=95%): shown with ✓✓, no review needed
        #   - Standard confidence (85-94%): shown with ✓, staff may spot-check
        resolved_threshold = self.metadata.get("resolved_threshold", 0.85)

        # Check if request was marked for manual review explicitly
        if self.requires_manual_review:
            status = "pending"
        # Check if request was declined due to validation issues
        elif self.metadata.get("declined", False):
            status = "declined"
        # Age preferences don't need a requested_cm_id to be valid
        elif (
            self.request_type == "age_preference"
            and self.confidence_score >= resolved_threshold
            or self.requested_cm_id
            and self.confidence_score >= resolved_threshold
        ):
            status = "resolved"
        else:
            # Low confidence or no target - needs manual review
            status = "pending"

        db_dict = {
            "requester_person_cm_id": self.requester_cm_id,
            "requested_person_cm_id": self.requested_cm_id,
            "requested_person_name": self.target_name[:200] if self.target_name else "",  # Store the target name
            "request_type": self.request_type,
            "priority": self.priority,
            "year": self.year,
            "session_cm_id": self.session_cm_id,
            "status": status,
            "original_text": self.original_text[:500] if self.original_text else "",
            "confidence_score": self.confidence_score,
            "parse_notes": self.parse_notes[:500] if self.parse_notes else "",
            "resolution_notes": "",
            # Enhanced fields
            "keywords_found": self.keywords_found,
            "conflict_group_id": "",
            "requires_family_decision": False,
            "request_source": self.source,
            "is_reciprocal": self.is_reciprocal,
            "ai_parsed": self.ai_parsed,
            "source_field": self.source_field[:100] if self.source_field else "",
            "source_detail": self.source_detail,
            "requires_manual_review": self.requires_manual_review,
            "manual_review_reason": self.manual_review_reason[:200] if self.manual_review_reason else "",
            "metadata": self.metadata,
            # Spread tracking
            "can_be_dropped": False,
            "was_dropped_for_spread": False,
        }

        # For age preference requests, populate the age_preference_target field from metadata
        if self.request_type == "age_preference" and self.metadata.get("target"):
            db_dict["age_preference_target"] = self.metadata["target"]

        # Only include friend_group_id if we have a valid ID
        # PocketBase relation fields should be omitted if empty
        if self.friend_group_id:
            db_dict["friend_group_id"] = self.friend_group_id

        # Store csv_source_field in ai_reasoning if available
        if "csv_source_field" in self.metadata:
            ai_reasoning = db_dict.get("ai_reasoning")
            if ai_reasoning is None or not isinstance(ai_reasoning, dict):
                db_dict["ai_reasoning"] = {}
            # Safe to cast since we just ensured it's a dict
            ai_dict = db_dict["ai_reasoning"]
            if isinstance(ai_dict, dict):
                ai_dict["csv_source_field"] = self.metadata["csv_source_field"]

        return db_dict
