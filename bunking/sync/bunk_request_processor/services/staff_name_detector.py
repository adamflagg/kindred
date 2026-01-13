"""Staff Name Detector Service

Extracts and tracks staff/parent names from bunking notes to prevent them
from being incorrectly parsed as camper bunk targets.

This service:
1. Extracts staff/parent names from conversational notes using regex patterns
2. Builds a global set of detected names for filtering during resolution
3. Provides lookup to check if a target name matches a detected staff name
4. Loads known staff names from config/staff_list.json for dynamic pattern generation"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Default path for staff list config
DEFAULT_STAFF_LIST_PATH = Path(__file__).parent.parent.parent.parent.parent / "config" / "staff_list.json"


class StaffNameDetector:
    """Detects and tracks staff/parent names from bunking notes.

    These names should be filtered from bunk targets to prevent false matches
    where staff/parent names mentioned in notes are incorrectly treated as
    camper bunking requests.

    Staff names are loaded from config/staff_list.json for dynamic pattern generation,
    allowing new staff to be added without code changes.
    """

    STOP_WORDS = frozenset(
        [
            "the",
            "they",
            "them",
            "their",
            "this",
            "that",
            "these",
            "those",
            "all",
            "info",
            "bunking",
            "session",
            "camp",
            "counselor",
            "counselors",
            "staff",
            "parent",
            "parents",
        ]
    )

    STAFF_PATTERNS = [
        r"(\w+(?:\s+\w+)?)\s+(?:called|spoke|discussed|mentioned)",
        r"(?:call|speak\s+to|discuss\s+with|talked\s+to)\s+(\w+(?:\s+\w+)?)",
        r"(\w+(?:\s+\w+)?)\s+(?:forgot\s+to|wanted\s+to|asked\s+to|requested)",
        r"(?:plan\s+to\s+call|should\s+call|will\s+call)\s+(\w+(?:\s+\w+)?)",
        r"per\s+(\w+(?:\s+\w+)?)",
        r"according\s+to\s+(\w+(?:\s+\w+)?)",
        r"(\w+(?:\s+\w+)?)\s+(?:says?|said|notes?|noted)",
        r"ensure\s+(?:we\s+)?(?:have|get)\s+.*?(?:call|discuss).*?(\w+(?:\s+\w+)?)",
    ]

    def __init__(self, staff_list_path: Path | None = None):
        """Initialize the detector with staff list from config.

        Args:
            staff_list_path: Optional path to staff list JSON file.
                           Defaults to config/staff_list.json.
        """
        self.detected_staff_names: set[str] = set()
        self.staff_list: list[dict[str, Any]] = []
        self._known_staff_patterns: list[str] = []
        self._known_staff_names: set[str] = set()

        # Load staff list from config
        config_path = staff_list_path or DEFAULT_STAFF_LIST_PATH
        self._load_staff_list(config_path)
        self._generate_staff_patterns()

    def _load_staff_list(self, config_path: Path) -> None:
        """Load staff list from JSON config file."""
        try:
            if config_path.exists():
                with open(config_path) as f:
                    data = json.load(f)
                    self.staff_list = data.get("staff", [])
                    if self.staff_list:
                        names = [s.get("first_name", "") for s in self.staff_list]
                        logger.debug(f"Loaded {len(self.staff_list)} staff from config: {names}")
            else:
                logger.debug(f"Staff list not found at {config_path}, using empty list")
                self.staff_list = []
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to load staff list from {config_path}: {e}")
            self.staff_list = []

    def _generate_staff_patterns(self) -> None:
        """Generate detection patterns for each known staff member."""
        self._known_staff_patterns = []
        self._known_staff_names = set()

        for staff in self.staff_list:
            first_name = staff.get("first_name", "")
            if not first_name:
                continue

            self._known_staff_names.add(first_name)

            # Generate patterns (same style as old hardcoded patterns)
            # Pattern 1: "Name should/will/to (plan to)? call/discuss"
            self._known_staff_patterns.append(
                rf"{re.escape(first_name)}\s+(?:should|will|to)\s+(?:plan\s+to\s+)?(?:call|discuss)"
            )
            # Pattern 2: "call/discuss with ... Name"
            self._known_staff_patterns.append(rf"(?:call|discuss\s+with)\s+.*?{re.escape(first_name)}")

    def extract_staff_names(self, notes_text: str) -> set[str]:
        """Extract likely staff/parent names from bunking notes.

        Args:
            notes_text: The bunking notes text to analyze

        Returns:
            Set of extracted staff/parent names
        """
        if not notes_text:
            return set()

        staff_names: set[str] = set()

        # Apply all staff patterns
        for pattern in self.STAFF_PATTERNS:
            matches = re.finditer(pattern, notes_text, re.IGNORECASE)
            for match in matches:
                name = match.group(1).strip()

                if name and len(name) > 2 and name.lower() not in self.STOP_WORDS:
                    if name[0].isupper():
                        staff_names.add(name)

        # Check for known staff names from config (replaces hardcoded SHOSHIE_PATTERNS)
        for pattern in self._known_staff_patterns:
            if re.search(pattern, notes_text, re.IGNORECASE):
                # Find which staff name matched
                for name in self._known_staff_names:
                    if re.search(rf"\b{re.escape(name)}\b", notes_text, re.IGNORECASE):
                        staff_names.add(name)

        return staff_names

    def build_global_set(self, notes_texts: list[str | None]) -> set[str]:
        """Build a combined set of detected staff names from multiple notes texts.

        where all notes are processed first to build a global detection set.

        Args:
            notes_texts: List of combined bunking_notes + internal_notes strings

        Returns:
            Set of all detected staff/parent names
        """
        combined_set: set[str] = set()

        for text in notes_texts:
            if text and text.strip():
                extracted = self.extract_staff_names(text)
                combined_set.update(extracted)

        if combined_set:
            logger.info(f"Detected likely staff/parent names: {sorted(combined_set)}")

        return combined_set

    def is_staff_name(self, name: str | None) -> bool:
        """Check if a name matches a detected staff/parent name.

        This is used during resolution to filter out staff names from targets.

        Args:
            name: The name to check

        Returns:
            True if name is in detected_staff_names, False otherwise
        """
        if not name:
            return False
        return name in self.detected_staff_names
