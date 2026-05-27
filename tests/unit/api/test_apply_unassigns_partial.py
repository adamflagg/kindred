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


@pytest.mark.asyncio
async def test_apply_deletes_scoped_by_session(patched_pb, monkeypatch):
    """The live-path delete filter must include a session.cm_id clause so it only
    removes rows belonging to the resolved session(s), not unrelated sessions.
    This pins the existing session-scoping behavior (#1609)."""
    mock_pb = patched_pb
    monkeypatch.setattr(solver_mod, "solver_runs", {"run-3": _run_record([4242])})

    await solver_mod.apply_solver_results("run-3", user=MagicMock())

    filter_str = mock_pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]["filter"]
    # Must scope by person cm_id and year (already tested), AND by session.
    assert "session.cm_id =" in filter_str, (
        f"Delete filter must include session.cm_id scoping to prevent cross-session deletes; got: {filter_str!r}"
    )


def _run_record_with_scenario(
    unassigned_cm_ids: list[int],
    *,
    scenario: str = "scen-1",
) -> dict:
    """Run record that looks like a scenario (draft) run."""
    return {
        "status": "completed",
        "scenario": scenario,
        "session_cm_id": 1000001,
        "config": {"year": 2026},
        "results": {
            "assignments": {},
            "stats": {
                "partial_resolve": {
                    "unassigned_count": len(unassigned_cm_ids),
                    "unassigned_person_cm_ids": unassigned_cm_ids,
                    "cross_boundary_request_count": 0,
                }
            },
        },
    }


@pytest.fixture
def patched_pb_scenario():
    """Patch collaborators for a scenario (draft) run.

    The IDLookupCache must return a person_pb_id so the draft branch proceeds
    to the delete instead of hitting the early-continue guard.
    """
    mock_pb = MagicMock()
    mock_pb.collection.return_value.get_full_list.return_value = [{"id": "draft-row-1"}]

    ctx = MagicMock()
    ctx.related_session_ids = [1000001]
    ctx.session_relation_filter = "session.cm_id = 1000001"
    ctx.year = 2026

    mock_cache = MagicMock()
    # get_person_pb_id is async; return a valid PB id string
    mock_cache.get_person_pb_id = AsyncMock(return_value="pb-person-abc")

    with (
        patch.object(solver_mod, "pb", mock_pb),
        patch.object(solver_mod, "build_session_context", AsyncMock(return_value=ctx)),
        # IDLookupCache constructor returns our pre-configured cache
        patch.object(solver_mod, "IDLookupCache", return_value=mock_cache),
        patch.object(solver_mod, "graph_cache", MagicMock()),
    ):
        yield mock_pb


@pytest.mark.asyncio
async def test_apply_draft_deletes_from_bunk_assignments_draft(patched_pb_scenario, monkeypatch):
    """When the run has a scenario (draft mode), deletion must target
    bunk_assignments_draft, not bunk_assignments. (#1609)"""
    mock_pb = patched_pb_scenario
    monkeypatch.setattr(solver_mod, "solver_runs", {"run-4": _run_record_with_scenario([4242], scenario="scen-1")})

    await solver_mod.apply_solver_results("run-4", user=MagicMock())

    # Find which collection names pb.collection() was called with.
    collection_calls = [c.args[0] for c in mock_pb.collection.call_args_list]
    # At least one call must target the draft table (delete path).
    assert "bunk_assignments_draft" in collection_calls, (
        f"Expected pb.collection('bunk_assignments_draft') for draft-mode deletion; actual calls: {collection_calls}"
    )
    # And the live assignments table must NOT be used for the deletion.
    # (It may appear in other calls, but the delete must not go to bunk_assignments.)
    # We verify by checking the collection used for the actual delete call.
    # Since mock_pb.collection(x) always returns the same sub-mock, the delete
    # was called — confirm the draft table was in the call list and the stale row
    # from get_full_list was deleted.
    mock_pb.collection.return_value.delete.assert_called_once_with("draft-row-1")
