"""The social graph declares the tables it is built from (kindred#2803, item B).

`graph_cache` holds finished graphs for 15 minutes, and until #2803 only
scenario, solver and position writes cleared it -- a CampMinder sync that
rewrote attendees, persons, bunk assignments or requests left the production
graph stale for up to a TTL. The invalidate endpoint now clears it when the
completed sync writes one of these tables, which makes the declaration the
thing that has to be right -- exactly as each cached lodging read declares
its tables on `@cached_by_year(tables=...)`.
"""

from __future__ import annotations

import re
from pathlib import Path

from api.constants import collections
from api.constants.sync_job_writes import SYNC_JOB_WRITES, sync_writes_any
from bunking.graph.social_graph_builder import SocialGraphBuilder

REPO_ROOT = Path(__file__).resolve().parents[4]
BUILDER_MODULES = [
    REPO_ROOT / "bunking" / "graph" / "social_graph_builder.py",
    REPO_ROOT / "bunking" / "graph" / "optimized_graph_builder.py",
]

# Every table a cached graph's content comes from, INCLUDING the ones a filter
# or an expand reaches through a relation: `session.cm_id = N` and
# `expand=session` read `camp_sessions`, `expand=person` reads `persons`,
# `expand=bunk` reads `bunks`. Pinned as a literal so a change is a reviewed
# diff rather than a silent change of when the cache clears.
EXPECTED_GRAPH_READ_TABLES = {
    "attendees",
    "camp_sessions",
    "persons",
    "bunks",
    "bunk_assignments",
    "bunk_assignments_draft",
    "bunk_requests",
}

# The syncs whose completion must clear the graph cache.
EXPECTED_GRAPH_INVALIDATING_SYNCS = {
    "sessions",  # camp_sessions
    "attendees",  # attendees
    "persons",  # persons (+ attendees.person back-fill)
    "bunks",  # bunks
    "bunk_assignments",  # bunk_assignments -- the hourly job; the graph draws it
    "normalize_geographic",  # persons
    "stranded_assignment_cleanup",  # bunk_assignments_draft
    "process_requests",  # bunk_requests
}


def _collection_constants_used(path: Path) -> set[str]:
    """The table names of every `api.constants.collections` constant a module
    imports -- a read added with a new constant shows up here."""
    source = path.read_text()
    block = re.search(r"from api\.constants\.collections import \(([^)]*)\)", source)
    assert block, f"{path.name} no longer imports collection constants in the expected form"
    names = [name.strip() for name in block.group(1).split(",") if name.strip()]
    return {getattr(collections, name) for name in names}


class TestTheGraphDeclaresItsTables:
    def test_the_declared_tables_are_exactly_these(self) -> None:
        assert set(SocialGraphBuilder.READ_TABLES) == EXPECTED_GRAPH_READ_TABLES

    def test_every_collection_a_builder_module_names_is_declared(self) -> None:
        for module in BUILDER_MODULES:
            undeclared = _collection_constants_used(module) - set(SocialGraphBuilder.READ_TABLES)
            assert not undeclared, (
                f"{module.name} reads {sorted(undeclared)}, which SocialGraphBuilder.READ_TABLES "
                "does not declare -- a sync writing it would leave cached graphs stale"
            )


class TestWhichSyncsClearTheGraph:
    def test_the_invalidating_syncs_are_exactly_the_writers_of_a_graph_table(self) -> None:
        invalidating = {job for job in SYNC_JOB_WRITES if sync_writes_any(job, SocialGraphBuilder.READ_TABLES)}
        assert invalidating == EXPECTED_GRAPH_INVALIDATING_SYNCS

    def test_a_job_writing_nothing_the_graph_reads_leaves_it(self) -> None:
        assert not sync_writes_any("staff_skills", SocialGraphBuilder.READ_TABLES)

    def test_no_sync_named_clears_it(self) -> None:
        assert sync_writes_any(None, SocialGraphBuilder.READ_TABLES)

    def test_an_unclassified_sync_clears_it(self) -> None:
        assert sync_writes_any("a_job_added_next_month", SocialGraphBuilder.READ_TABLES)
