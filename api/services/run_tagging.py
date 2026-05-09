"""Compose the details JSON blob persisted on each solver_run.

Captures everything needed to make a run interpretable years later — the code
that ran (git_sha), the knobs that ran (config_snapshot), the source it ran
against (source_label, source_kind, scenario_id_at_run), the size of the
session at that moment (session_attendee_count), and any sweep grouping
(sweep_id, sweep_label).

Source labels are pre-rendered at run time so historical rows survive
scenario rename or deletion.
"""

from __future__ import annotations

from typing import Any

from .config_snapshot import snapshot_solver_config
from .git_sha import get_git_sha


def _compose_source_label(
    session_label: str,
    scenario_id: str | None,
    scenario_name: str | None,
) -> tuple[str, str]:
    """Pre-render ``(source_label, source_kind)`` so historical rows survive
    scenario rename/deletion. Pure — no I/O — so it's safe to call from the
    failure-path fallback before/without PocketBase access."""
    if scenario_id is None:
        return f"{session_label} · Production", "production"
    display = scenario_name or scenario_id
    return f'{session_label} · scenario "{display}"', "scenario"


def compose_minimal_run_details(
    session_label: str,
    scenario_id: str | None,
    scenario_name: str | None,
    sweep_id: str | None,
    sweep_label: str | None,
    time_limit_seconds: int,
    session_attendee_count: int | None = None,
) -> dict[str, Any]:
    """Synchronous, no-PocketBase version of :func:`build_run_details`.

    Used as the fallback dict when the solver fails before run-tagging can
    fetch the config snapshot — keeps failure-path rows from showing blank
    git_sha / source_label / source_kind columns alongside their successful
    siblings in the impact-analysis sweep view. ``config_snapshot`` is
    intentionally ``{}`` since we can't reach PocketBase here.
    """
    source_label, source_kind = _compose_source_label(session_label, scenario_id, scenario_name)
    return {
        "git_sha": get_git_sha(),
        "config_snapshot": {},
        "source_label": source_label,
        "source_kind": source_kind,
        "scenario_id_at_run": scenario_id,
        "session_attendee_count": session_attendee_count,
        "sweep_id": sweep_id,
        "sweep_label": sweep_label,
        "time_limit_seconds": time_limit_seconds,
    }


async def build_run_details(
    pb: Any,
    session_label: str,
    scenario_id: str | None,
    scenario_name: str | None,
    session_attendee_count: int,
    sweep_id: str | None,
    sweep_label: str | None,
) -> dict[str, Any]:
    """Return the dict written to ``solver_runs.details`` for one run."""
    config_snapshot = await snapshot_solver_config(pb)
    source_label, source_kind = _compose_source_label(session_label, scenario_id, scenario_name)

    return {
        "git_sha": get_git_sha(),
        "config_snapshot": config_snapshot,
        "source_label": source_label,
        "source_kind": source_kind,
        "scenario_id_at_run": scenario_id,
        "session_attendee_count": session_attendee_count,
        "sweep_id": sweep_id,
        "sweep_label": sweep_label,
    }
