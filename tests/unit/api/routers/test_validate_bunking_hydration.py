"""Regression test for the post-check capacity-by-gender denominator bug.

The `/api/validate-bunking` route hydrated each PocketBase bunk record into a
validator `Bunk` WITHOUT copying `gender`, so every bunk reached the validator
with `gender=None`. That zeroed the "Capacity by gender" denominator (`N / 0`)
regardless of session — the DB had gender set on summer B-/G- cabins, but the
field was dropped at hydration. Issue #1481 mis-filed this as "unreachable via
GUI" by checking the DB data instead of the hydration path.

This pins the hydration seam so the field can't be silently dropped again.
"""

from __future__ import annotations

from types import SimpleNamespace

from api.routers.validation import _build_validator_bunks


def _rec(**kw):
    """A PocketBase-record-like object (attribute access) for one bunk."""
    base = {
        "id": "x",
        "cm_id": 0,
        "name": "",
        "area": None,
        "division_id": None,
        "is_locked": False,
        "gender": None,
    }
    base.update(kw)
    return SimpleNamespace(**base)


def test_build_validator_bunks_carries_gender():
    """Hydration must copy gender ("M"/"F"/"Mixed"/"") onto the validator Bunk."""
    records = [
        _rec(id="b1", cm_id=3001, name="B-1", gender="M"),
        _rec(id="b2", cm_id=3002, name="G-1", gender="F"),
        _rec(id="b3", cm_id=3003, name="AG-8", gender="Mixed"),
        _rec(id="b4", cm_id=3004, name="Azaleas", gender=""),
    ]
    bunks = _build_validator_bunks(records)
    assert [b.gender for b in bunks] == ["M", "F", "Mixed", ""]


def test_build_validator_bunks_preserves_core_fields():
    """The other fields the validator relies on still round-trip."""
    records = [_rec(id="b1", cm_id=3001, name="B-1", is_locked=True, gender="M")]
    bunks = _build_validator_bunks(records)
    assert bunks[0].campminder_id == "3001"
    assert bunks[0].name == "B-1"
    assert bunks[0].is_locked is True
