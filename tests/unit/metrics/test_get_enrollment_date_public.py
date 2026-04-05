"""Test that get_enrollment_date is publicly importable from reconstruction module.

TDD: This test is written BEFORE the rename to verify the public API contract.
"""

from types import SimpleNamespace


def test_get_enrollment_date_is_public_import():
    """get_enrollment_date (no underscore) should be importable from reconstruction."""
    from api.services.reconstruction import get_enrollment_date

    assert callable(get_enrollment_date)


def test_get_enrollment_date_prefers_effective_date():
    """get_enrollment_date should prefer effective_date over enrollment_date."""
    from api.services.reconstruction import get_enrollment_date

    att = SimpleNamespace(effective_date="2025-06-01T00:00:00Z", enrollment_date="2025-01-15")
    assert get_enrollment_date(att) == "2025-06-01"


def test_get_enrollment_date_falls_back_to_enrollment_date():
    """get_enrollment_date should fall back to enrollment_date when effective_date is empty."""
    from api.services.reconstruction import get_enrollment_date

    att = SimpleNamespace(effective_date="", enrollment_date="2025-01-15T10:30:00Z")
    assert get_enrollment_date(att) == "2025-01-15"


def test_get_enrollment_date_returns_none_when_both_empty():
    """get_enrollment_date should return None when both dates are empty."""
    from api.services.reconstruction import get_enrollment_date

    att = SimpleNamespace(effective_date="", enrollment_date="")
    assert get_enrollment_date(att) is None
