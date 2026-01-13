"""Staff Note Parser Service

Parses staff attribution patterns from bunking notes.

Staff notes often contain attribution patterns like:
- "MORGAN CHEN (May 2 2023 1:20PM)" - single staff entry
- Multi-line notes with different staff attributions per line

This service extracts these patterns to:
1. Clean the actual request content from staff metadata
2. Preserve staff attribution for auditing/tracking
3. Handle multi-line notes with multiple staff entries
"""

from __future__ import annotations

import re
from typing import Any

# Pattern for staff attribution at end of text: STAFFNAME (DATETIME)
# Matches: NAME (Month DD YYYY H:MMAM/PM)
# Example: MORGAN CHEN (May 2 2023 1:20PM)
STAFF_DATETIME_PATTERN = re.compile(
    r"\s*([A-Z][A-Z\s]+?)\s*\(([A-Za-z]+\s+\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2}(?:AM|PM))\)\s*$"
)

# Pattern for multi-line notes: FIRST LAST (Date Time)
# Staff names are always exactly 2 uppercase words
# This avoids false positives like "Alex T JORDAN RIVERS" capturing "T"
MULTI_LINE_STAFF_PATTERN = re.compile(r"([A-Z]+)\s+([A-Z]+)\s*\(([^)]+\d{4}[^)]*)\)$")

# Non-name words to filter out (Roman numerals from "SESSION II", etc.)
NON_NAME_WORDS = frozenset({"FALL", "SPRING", "SUMMER", "SESSION", "I", "II", "III", "IV"})


def extract_staff_pattern(text: str) -> tuple[str, dict[str, str] | None]:
    """
    Extract STAFFNAME (DATETIME) pattern from internal notes.

    This pattern appears at the end of internal notes when staff add notes.
    Example: "Wants to bunk with John Smith JDOE (2024-03-15 10:30:45)"

    Args:
        text: The internal notes text

    Returns:
        Tuple of (cleaned_text, staff_metadata)
        - cleaned_text: Text with staff pattern removed
        - staff_metadata: Dict with 'staff_name', 'timestamp', 'original_suffix' if found
    """
    match = STAFF_DATETIME_PATTERN.search(text)
    if match:
        staff_name = match.group(1)
        timestamp = match.group(2)

        # Remove the pattern from the text
        cleaned_text = text[: match.start()].strip()

        return cleaned_text, {
            "staff_name": staff_name,
            "timestamp": timestamp,
            "original_suffix": match.group(0).strip(),
        }

    # No pattern found, return original text
    return text, None


def parse_multi_staff_notes(note_text: str | None) -> list[dict[str, Any]]:
    """
    Parse notes that may contain multiple staff entries.

    Matches monolith parse_multi_staff_notes() behavior:
    - Splits notes by newlines
    - Extracts staff patterns from each line
    - Returns list of entries with content, staff, timestamp
    - Filters out non-name words (FALL, SPRING, etc.)
    - Proper-cases staff names

    Args:
        note_text: The note text, potentially with multiple lines

    Returns:
        List of dicts with 'content', 'staff', 'timestamp' keys
    """
    if not note_text:
        return []

    # Split by newlines to handle multiple entries
    entries = note_text.strip().split("\n")
    parsed_notes: list[dict[str, Any]] = []

    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue

        # Try to extract staff attribution from end of entry
        match = MULTI_LINE_STAFF_PATTERN.search(entry)
        if match:
            content = entry[: match.start()].strip()
            first_name = match.group(1).strip()
            last_name = match.group(2).strip()
            timestamp = match.group(3).strip()

            # Filter out non-name words (Roman numerals from "SESSION II", etc.)
            name_words = []
            for word in [first_name, last_name]:
                if word.upper() not in NON_NAME_WORDS:
                    name_words.append(word)

            if len(name_words) == 2:
                # Proper-case the staff name (FIRST LAST -> First Last)
                staff_name = " ".join(word.capitalize() for word in name_words)

                parsed_notes.append({"content": content, "staff": staff_name, "timestamp": timestamp})
            else:
                # No valid staff name found after filtering
                parsed_notes.append({"content": entry, "staff": None, "timestamp": None})
        else:
            # No staff attribution found
            parsed_notes.append({"content": entry, "staff": None, "timestamp": None})

    return parsed_notes


def extract_content_and_staff_metadata(note_text: str | None) -> tuple[str, dict[str, Any] | None]:
    """
    High-level function to extract content and staff metadata from notes.

    Parses multi-line notes, joins content, and extracts the most recent
    staff attribution.

    Args:
        note_text: The note text to parse

    Returns:
        Tuple of (cleaned_content, staff_metadata)
        - cleaned_content: Joined content from all note entries
        - staff_metadata: Dict with 'staff_name', 'timestamp' from most recent entry
    """
    if not note_text:
        return "", None

    parsed_notes = parse_multi_staff_notes(note_text)

    # Join all content
    content = " | ".join(n["content"] for n in parsed_notes if n["content"])

    # Extract staff metadata from most recent entry with staff attribution
    staff_entries = [n for n in parsed_notes if n["staff"]]
    staff_metadata = None
    if staff_entries:
        # Use the most recent staff entry (last in list)
        staff_metadata = {"staff_name": staff_entries[-1]["staff"], "timestamp": staff_entries[-1]["timestamp"]}

    return content, staff_metadata
