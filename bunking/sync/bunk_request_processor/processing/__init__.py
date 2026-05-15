"""Processing components for bunk requests.

This module contains components for processing parsed requests:
- First-request detection (slot-0 boost flag)
- Reciprocal detection
- Batch signal detection
- Deduplication"""

from __future__ import annotations

from .deduplicator import DeduplicationResult, Deduplicator, DuplicateGroup
from .first_request_detector import is_first_requested
from .reciprocal_detector import ReciprocalDetector, ReciprocalPair

__all__ = [
    "DeduplicationResult",
    "Deduplicator",
    "DuplicateGroup",
    "ReciprocalDetector",
    "ReciprocalPair",
    "is_first_requested",
]
