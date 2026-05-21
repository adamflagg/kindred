"""Tests for compress_pre_anchor_events — proportional Week 0 compression."""

from datetime import date

from api.services.reconstruction import compress_pre_anchor_events

ANCHOR = date(2025, 11, 12)  # Typical priority_reg_date


def _sum_field(events: dict[str, dict[str, int]], field: str) -> int:
    """Sum a single field across all date keys."""
    return sum(bucket[field] for bucket in events.values())


def _make_bucket(
    new: int = 0,
    cancelled: int = 0,
    new_boys: int = 0,
    new_girls: int = 0,
    canc_boys: int = 0,
    canc_girls: int = 0,
) -> dict[str, int]:
    return {
        "new": new,
        "cancelled": cancelled,
        "new_boys": new_boys,
        "new_girls": new_girls,
        "canc_boys": canc_boys,
        "canc_girls": canc_girls,
    }


class TestCompressPreAnchorEvents:
    """Unit tests for compress_pre_anchor_events."""

    def test_no_pre_anchor_events_returns_unchanged(self):
        """All dates >= anchor — dict returned as-is."""
        events = {
            "2025-11-12": _make_bucket(new=3),
            "2025-11-15": _make_bucket(new=1),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        assert result == events

    def test_fits_in_window_preserves_gaps(self):
        """5 real days before anchor — right-aligned, gaps preserved, totals match."""
        events = {
            "2025-11-07": _make_bucket(new=1),
            "2025-11-09": _make_bucket(new=2),
            "2025-11-11": _make_bucket(new=1),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        assert "2025-11-07" in result
        assert "2025-11-09" in result
        assert "2025-11-11" in result
        assert _sum_field(result, "new") == 4

    def test_single_event_at_anchor_minus_1_stays_put(self):
        """Single event day before anchor stays at anchor-1d, not shifted to anchor-7d."""
        events = {"2025-11-11": _make_bucket(new=1)}
        result = compress_pre_anchor_events(events, ANCHOR)
        assert list(result.keys()) == ["2025-11-11"]
        assert result["2025-11-11"]["new"] == 1

    def test_proportional_compression(self):
        """19 real days, 4 events — mapped proportionally into 7-day window."""
        events = {
            "2025-10-24": _make_bucket(new=1),
            "2025-11-01": _make_bucket(new=2),
            "2025-11-08": _make_bucket(new=1),
            "2025-11-11": _make_bucket(new=3),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        assert "2025-11-05" in result
        assert "2025-11-07" in result
        assert "2025-11-10" in result
        assert "2025-11-11" in result
        assert _sum_field(result, "new") == 7

    def test_multiple_events_same_display_day_sums_all_fields(self):
        """3 events that compress to the same day — all fields summed."""
        events = {
            "2025-10-22": _make_bucket(new=1, new_boys=1, cancelled=0),
            "2025-10-23": _make_bucket(new=2, new_girls=2, cancelled=1, canc_girls=1),
            "2025-10-24": _make_bucket(new=1, new_boys=1, cancelled=0),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        assert "2025-11-05" in result
        merged = result["2025-11-05"]
        assert merged["new"] == 4
        assert merged["new_boys"] == 2
        assert merged["new_girls"] == 2
        assert merged["cancelled"] == 1
        assert merged["canc_girls"] == 1

    def test_single_far_back_event(self):
        """1 event 30 days before anchor — maps to anchor-7d."""
        events = {"2025-10-13": _make_bucket(new=1)}
        result = compress_pre_anchor_events(events, ANCHOR)
        assert list(result.keys()) == ["2025-11-05"]
        assert result["2025-11-05"]["new"] == 1

    def test_totals_invariant(self):
        """Parametric check: output totals == input totals for all fields."""
        events = {
            "2025-10-15": _make_bucket(new=3, cancelled=1, new_boys=2, new_girls=1, canc_boys=1),
            "2025-10-20": _make_bucket(new=2, cancelled=0, new_girls=2),
            "2025-11-01": _make_bucket(new=1, cancelled=1, canc_girls=1),
            "2025-11-11": _make_bucket(new=4, new_boys=3, new_girls=1),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        for field in ("new", "cancelled", "new_boys", "new_girls", "canc_boys", "canc_girls"):
            assert _sum_field(result, field) == _sum_field(events, field), f"Mismatch on {field}"

    def test_mixed_pre_and_post_anchor(self):
        """Pre-anchor events compressed, post-anchor untouched."""
        events = {
            "2025-10-24": _make_bucket(new=1),
            "2025-11-12": _make_bucket(new=5),
            "2025-11-15": _make_bucket(new=2),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        assert "2025-11-05" in result
        assert result["2025-11-05"]["new"] == 1
        assert result["2025-11-12"]["new"] == 5
        assert result["2025-11-15"]["new"] == 2

    def test_pre_anchor_cancellation_compressed(self):
        """Pre-anchor cancellation fields are compressed alongside enrollments."""
        events = {
            "2025-11-10": _make_bucket(new=1, cancelled=1, canc_boys=1),
        }
        result = compress_pre_anchor_events(events, ANCHOR)
        assert "2025-11-10" in result
        assert result["2025-11-10"]["cancelled"] == 1
        assert result["2025-11-10"]["canc_boys"] == 1
