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

    if scenario_id is None:
        source_label = f"{session_label} · Production"
        source_kind = "production"
    else:
        display = scenario_name or scenario_id
        source_label = f'{session_label} · scenario "{display}"'
        source_kind = "scenario"

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
