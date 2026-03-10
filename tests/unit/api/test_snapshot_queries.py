"""Tests for snapshot querying with camp-day boundaries."""

from __future__ import annotations

import os
import sqlite3
from datetime import date

import pytest

os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.services.metrics_sql_repository import MetricsSQLRepository


@pytest.fixture
def snapshot_db():
    """Create an in-memory SQLite DB with enrollment_snapshots schema."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE enrollment_snapshots (
            snapshot_datetime TEXT NOT NULL,
            year INTEGER NOT NULL,
            session_cm_id INTEGER NOT NULL,
            session TEXT,
            enrolled_count INTEGER NOT NULL DEFAULT 0,
            waitlisted_count INTEGER NOT NULL DEFAULT 0,
            cancelled_count INTEGER NOT NULL DEFAULT 0,
            enrolled_male_count INTEGER,
            enrolled_female_count INTEGER,
            waitlisted_male_count INTEGER,
            waitlisted_female_count INTEGER,
            cancelled_male_count INTEGER,
            cancelled_female_count INTEGER
        )
    """)
    return conn


@pytest.fixture
def repo(snapshot_db):
    return MetricsSQLRepository(conn=snapshot_db)


class TestFetchSnapshotCountsForCampDay:
    """fetch_snapshot_counts_for_camp_day finds the last snapshot within a camp day window."""

    @pytest.mark.asyncio
    async def test_picks_post_boundary_snapshot(self, repo, snapshot_db):
        """With two snapshots (3am UTC and 5pm UTC), picks the 5pm one for the camp day."""
        # 3am UTC Jan 15 = 7pm PST Jan 14 → camp day Jan 14
        snapshot_db.execute(
            "INSERT INTO enrollment_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("2026-01-15 03:00:00.000Z", 2026, 1001, "s1", 100, 5, 3, 50, 50, 3, 2, 1, 2),
        )
        # 5pm UTC Jan 15 = 9am PST Jan 15 → camp day Jan 15
        snapshot_db.execute(
            "INSERT INTO enrollment_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("2026-01-15 17:00:00.000Z", 2026, 1001, "s1", 105, 6, 3, 52, 53, 3, 3, 1, 2),
        )
        snapshot_db.commit()

        result = await repo.fetch_snapshot_counts_for_camp_day(2026, date(2026, 1, 15))
        assert result is not None
        assert result[1001]["enrolled"] == 105
        assert result[1001]["enrolled_boys"] == 52
        assert result[1001]["enrolled_girls"] == 53

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_snapshots(self, repo):
        result = await repo.fetch_snapshot_counts_for_camp_day(2026, date(2026, 1, 15))
        assert result == {}

    @pytest.mark.asyncio
    async def test_falls_back_to_mid_day_snapshot(self, repo, snapshot_db):
        """If no post-boundary snapshot exists, uses the last snapshot of the camp day."""
        # Only a 3am UTC Jan 15 snapshot = 7pm PST Jan 14 → camp day Jan 14
        snapshot_db.execute(
            "INSERT INTO enrollment_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("2026-01-15 03:00:00.000Z", 2026, 1001, "s1", 100, 5, 3, 50, 50, 3, 2, 1, 2),
        )
        snapshot_db.commit()

        # Looking for camp day Jan 14 — the 3am Jan 15 UTC snapshot is during camp day Jan 14
        result = await repo.fetch_snapshot_counts_for_camp_day(2026, date(2026, 1, 14))
        assert result is not None
        assert result[1001]["enrolled"] == 100

    @pytest.mark.asyncio
    async def test_legacy_midnight_truncated_snapshots(self, repo, snapshot_db):
        """Old midnight-truncated snapshots still map correctly."""
        # Midnight UTC Jan 15 = 4pm PST Jan 14 → camp day Jan 14
        snapshot_db.execute(
            "INSERT INTO enrollment_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("2026-01-15 00:00:00.000Z", 2026, 1001, "s1", 95, 4, 2, None, None, None, None, None, None),
        )
        snapshot_db.commit()

        result = await repo.fetch_snapshot_counts_for_camp_day(2026, date(2026, 1, 14))
        assert result[1001]["enrolled"] == 95
        assert result[1001]["enrolled_boys"] is None
