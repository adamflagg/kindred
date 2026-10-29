"""METRICS_READ_TABLES names every table the metrics repositories read: the sync notify scopes the metrics cache by
it, so a table missing here would leave a metrics figure stale for the cache's whole TTL after a sync rewrote it."""

from __future__ import annotations

import re
from pathlib import Path

import api.constants.collections as collections
from api.services.metrics_repository import METRICS_READ_TABLES

SERVICES = Path(__file__).resolve().parents[4] / "api" / "services"

# The relation each PocketBase-repository expand names, and the table it reads. An expand of a relation missing here
# fails the expand test below, so a new one has to be declared (and its table listed) before it ships.
EXPANDED_TABLES = {"person": collections.PERSONS, "session": collections.CAMP_SESSIONS, "bunk": collections.BUNKS}


def test_every_collection_the_pocketbase_repository_reads_is_declared() -> None:
    source = (SERVICES / "metrics_repository.py").read_text()
    read = {getattr(collections, name) for name in re.findall(r"\.collection\(([A-Z_]+)\)", source)}
    assert read  # the premise: the scan finds the repository's reads
    assert read <= METRICS_READ_TABLES, read - METRICS_READ_TABLES


def test_every_collection_read_names_a_constant_the_scan_can_see() -> None:
    """The scan above reads `.collection(CONSTANT)`; a literal or a variable would read a table it never sees."""
    source = (SERVICES / "metrics_repository.py").read_text()
    assert source.count(".collection(") == len(re.findall(r"\.collection\([A-Z_]+\)", source))


def test_every_table_the_pocketbase_repository_expands_is_declared() -> None:
    """An expand reads the related table too: the PocketBase repository reads `bunks` only that way."""
    source = (SERVICES / "metrics_repository.py").read_text()
    # `"expand": "a,b"`, `expand = "a,b"` and its conditional `... else "a"`, on the lines that set an expand.
    lines = [line for line in source.splitlines() if "expand" in line]
    values = [v for line in lines for v in re.findall(r'(?:"expand":\s*|expand\s*=\s*|else\s+)"([a-z_.,]+)"', line)]
    relations = {name for value in values for name in re.split(r"[.,]", value) if name}
    assert relations  # the premise: the scan finds the repository's expands
    assert relations <= EXPANDED_TABLES.keys(), relations - EXPANDED_TABLES.keys()
    read = {EXPANDED_TABLES[name] for name in relations}
    assert read <= METRICS_READ_TABLES, read - METRICS_READ_TABLES


def test_every_table_the_sql_repository_reads_is_declared() -> None:
    source = (SERVICES / "metrics_sql_repository.py").read_text()
    read = set(re.findall(r"\b(?:FROM|JOIN)\s+([a-z_]+)\b", source))
    assert read  # the premise: the scan finds the repository's reads
    assert read <= METRICS_READ_TABLES, read - METRICS_READ_TABLES
