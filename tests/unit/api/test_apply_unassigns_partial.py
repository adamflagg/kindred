"""apply_solver_results must un-bunk campers the partial re-solve left unassigned (#1609, Option B).

A partial cabin re-solve runs with relaxed ``<= 1`` cardinality, so the solver can
legitimately leave a camper unplaced (e.g. it bumped them out of an unlocked cabin
and there was no room left). Those campers are ABSENT from the results' ``assignments``
map, so the per-camper upsert never touches them. Without an explicit delete, the
bumped camper keeps their stale assignment — the board would disagree with the
"N unassigned" toast and the vacated cabin could end up over capacity.

The solver emits ``stats.partial_resolve.unassigned_person_cm_ids``; apply must delete
exactly those rows (live or scenario). A full solve never populates that list, so this
is a no-op outside partial re-solve.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.routers.solver as solver_mod


def _run_record(unassigned_cm_ids: list[int] | None, *, assignments: dict[str, str] | None = None) -> dict[str, Any]:
    partial: dict[str, Any] = {"unassigned_count": len(unassigned_cm_ids or []), "cross_boundary_request_count": 0}
    if unassigned_cm_ids is not None:
        partial["unassigned_person_cm_ids"] = unassigned_cm_ids
    return {
        "status": "completed",
        "scenario": None,
        "session_cm_id": 1000001,
        "config": {"year": 2026},
        "results": {
            "assignments": assignments or {},  # placed campers (none here → upsert loop is a no-op)
            "stats": {"partial_resolve": partial},
        },
    }


@pytest.fixture
def patched_pb():
    """Patch the module-level collaborators apply_solver_results reaches for."""
    mock_pb = MagicMock()
    # get_full_list returns one stale row for the unassigned camper; delete is recorded.
    mock_pb.collection.return_value.get_full_list.return_value = [{"id": "row-stale-1"}]

    ctx = MagicMock()
    ctx.related_session_ids = [1000001]
    ctx.session_relation_filter = "session.cm_id = 1000001"
    ctx.year = 2026

    with (
        patch.object(solver_mod, "pb", mock_pb),
        patch.object(solver_mod, "build_session_context", AsyncMock(return_value=ctx)),
        patch.object(solver_mod, "IDLookupCache", MagicMock()),
        patch.object(solver_mod, "graph_cache", MagicMock()),
    ):
        yield mock_pb


@pytest.mark.asyncio
async def test_apply_deletes_unassigned_rows(patched_pb, monkeypatch):
    mock_pb = patched_pb
    monkeypatch.setattr(solver_mod, "solver_runs", {"run-1": _run_record([4242])})

    await solver_mod.apply_solver_results("run-1", user=MagicMock())

    # The stale assignment for the unassigned camper (cm_id 4242) is deleted.
    mock_pb.collection.return_value.delete.assert_called_once_with("row-stale-1")
    # And the lookup was scoped to that camper.
    filter_str = mock_pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]["filter"]
    assert "person.cm_id = 4242" in filter_str
    assert "year = 2026" in filter_str


@pytest.mark.asyncio
async def test_apply_no_delete_when_nothing_unassigned(patched_pb, monkeypatch):
    mock_pb = patched_pb
    # No partial_resolve list at all (ordinary full solve path).
    monkeypatch.setattr(solver_mod, "solver_runs", {"run-2": _run_record(None)})

    await solver_mod.apply_solver_results("run-2", user=MagicMock())

    mock_pb.collection.return_value.delete.assert_not_called()
