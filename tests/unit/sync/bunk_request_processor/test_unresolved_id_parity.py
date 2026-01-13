"""Test parity of unresolved person ID generation between monolith and modular.

The monolith generates IDs using:
    hash_hex = hash_object.hexdigest()
    hash_int = int(hash_hex[:8], 16)  # 8 hex chars = 32-bit

The modular SHOULD match this behavior for backward compatibility."""

from __future__ import annotations

import hashlib

import pytest


def monolith_generate_unresolved_person_id(name_text: str) -> int:
    """
    This is the CORRECT implementation we need to match.
    """
    # Normalize the name text
    normalized = name_text.strip().lower()

    # Create a hash of the normalized name
    hash_object = hashlib.md5(normalized.encode())
    hash_hex = hash_object.hexdigest()

    # Take first 8 characters of hex and convert to int
    # This gives us a number between 0 and 4,294,967,295
    hash_int = int(hash_hex[:8], 16)

    # Make it negative and ensure it's in a reasonable range
    # Use range -1,000,000 to -1,000,000,000 for unresolved names
    unresolved_id = -(1_000_000 + (hash_int % 999_000_000))

    return unresolved_id


class TestUnresolvedIdParity:
    """Verify modular generate_unresolved_person_id matches monolith."""

    def test_basic_parity(self):
        """Same name should produce same ID in monolith and modular."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            generate_unresolved_person_id,
        )

        test_names = [
            "Unknown Person",
            "John Doe",
            "jane doe",
            "MIKE SMITH",
            "Bobby",
            "a",
            "   spaced name   ",
        ]

        for name in test_names:
            monolith_id = monolith_generate_unresolved_person_id(name)
            modular_id = generate_unresolved_person_id(name)

            assert monolith_id == modular_id, f"ID mismatch for '{name}': monolith={monolith_id}, modular={modular_id}"

    def test_empty_name_handling(self):
        """Empty name should return default value."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            generate_unresolved_person_id,
        )

        # Modular has explicit empty name handling
        result = generate_unresolved_person_id("")
        assert result == -1_000_000

    def test_idempotency(self):
        """Same name should always produce same ID."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            generate_unresolved_person_id,
        )

        name = "Consistent Name"
        id1 = generate_unresolved_person_id(name)
        id2 = generate_unresolved_person_id(name)

        assert id1 == id2

    def test_case_insensitivity(self):
        """Case differences should produce same ID (both normalize to lowercase)."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            generate_unresolved_person_id,
        )

        id_lower = generate_unresolved_person_id("john doe")
        id_upper = generate_unresolved_person_id("JOHN DOE")
        id_mixed = generate_unresolved_person_id("John Doe")

        assert id_lower == id_upper == id_mixed

    def test_negative_range(self):
        """All IDs should be in the negative range -1,000,000 to -1,000,000,000."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            generate_unresolved_person_id,
        )

        test_names = ["Person A", "Person B", "Long Name Here", "x"]

        for name in test_names:
            result = generate_unresolved_person_id(name)
            assert result < 0, f"ID for '{name}' should be negative"
            assert result >= -1_000_000_000, f"ID for '{name}' below minimum"
            assert result <= -1_000_000, f"ID for '{name}' above maximum"

    def test_known_values(self):
        """Verify against pre-computed monolith values for regression detection.

        These values were computed using the monolith algorithm.
        """
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            generate_unresolved_person_id,
        )

        # normalized = "john doe"
        # MD5 = 320b8e6bef45211f0f57b618925f4193
        # First 8 hex = 320b8e6b = 839618155
        # ID = -(1_000_000 + (839618155 % 999_000_000)) = -840618155
        expected_john_doe = -840618155

        # normalized = "unknown person"
        # MD5 = some_hash...
        # ID = -691178157
        expected_unknown = -691178157

        assert generate_unresolved_person_id("John Doe") == expected_john_doe
        assert generate_unresolved_person_id("Unknown Person") == expected_unknown


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
