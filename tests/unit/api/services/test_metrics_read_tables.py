"""METRICS_READ_TABLES names every table the metrics repositories read: the sync notify scopes the metrics cache by
it, so a table missing here would leave a metrics figure stale for the cache's whole TTL after a sync rewrote it."""

from __future__ import annotations

import re
from pathlib import Path

import api.constants.collections as collections
from api.services.metrics_repository import METRICS_READ_TABLES

SERVICES = Path(__file__).resolve().parents[4] / "api" / "services"


def test_every_collection_the_pocketbase_repository_reads_is_declared() -> None:
    source = (SERVICES / "metrics_repository.py").read_text()
    read = {getattr(collections, name) for name in re.findall(r"\.collection\(([A-Z_]+)\)", source)}
    assert read  # the premise: the scan finds the repository's reads
    assert read <= METRICS_READ_TABLES, read - METRICS_READ_TABLES


def test_every_table_the_sql_repository_reads_is_declared() -> None:
    source = (SERVICES / "metrics_sql_repository.py").read_text()
    read = set(re.findall(r"\b(?:FROM|JOIN)\s+([a-z_]+)\b", source))
    assert read  # the premise: the scan finds the repository's reads
    assert read <= METRICS_READ_TABLES, read - METRICS_READ_TABLES
