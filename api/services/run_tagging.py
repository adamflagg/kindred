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

import asyncio
import re
from typing import Any

from bunking.logging_config import get_logger

from .config_snapshot import snapshot_solver_config
from .git_sha import get_git_sha

logger = get_logger(__name__)


def _shorten_session_name(session_name: str) -> str:
    """Mirror of frontend/src/utils/sessionDisplay.ts:getSessionShorthand.

    Numbered → "2" / "2a"; Quest → "Quest"; Taste → "Taste";
    AG → parent session number; fallback → first number found, else first word.
    """
    if not session_name:
        return ""
    lower = session_name.lower()
    # Order matters: check special types BEFORE the generic "Session N" pattern
    # (a session named "Quest Session 1" must short to "Quest", not "1").
    if "quest" in lower:
        return "Quest"
    if "taste" in lower:
        # When the camp runs split cohorts ("Taste of Camp 1" / "Taste of Camp 2"),
        # preserve the trailing index so solver-debug source labels are distinguishable.
        # 1-2 digit match (with whitespace prefix) avoids interpreting 4-digit year suffixes as cohorts.
        m = re.search(r"\s(\d{1,2})\s*$", session_name)
        if m:
            return f"Taste {m.group(1)}"
        return "Taste"
    m = re.search(r"Session\s*(\d+[a-z]?)", session_name, re.IGNORECASE)
    if m:
        return m.group(1)
    if "all-gender" in lower or "ag session" in lower:
        for pattern in (
            r"ag\s*session\s*(\d+)",
            r"all-gender.*session\s*(\d+)",
            r"session\s*(\d+).*all-gender",
        ):
            m = re.search(pattern, session_name, re.IGNORECASE)
            if m:
                return m.group(1)
    m = re.search(r"(\d+[a-z]?)", session_name)
    if m:
        return m.group(1)
    return session_name.split(" ")[0] if session_name else ""


async def _lookup_session_short_name(pb: Any, session_cm_id: int, year: int) -> str:
    """Look up a session's friendly name from PocketBase and shorten it.

    Falls back to the raw ``{cm_id}`` (e.g. ``"1235406"``) when the lookup
    fails so the solver run still records — a cosmetic source-label
    divergence is preferable to a failed run.
    """
    try:
        record = await asyncio.to_thread(
            pb.collection("camp_sessions").get_first_list_item,
            f"cm_id = {session_cm_id} && year = {year}",
        )
    except Exception as e:  # cosmetic field, never crash a run
        logger.warning(
            "Session name lookup failed for cm_id=%s year=%s: %s — falling back to %s",
            session_cm_id,
            year,
            e,
            session_cm_id,
        )
        return f"{session_cm_id}"
    return _shorten_session_name(record.name)


# Truncation budget for scenario display names in source_label. Keeps the
# composed label readable in the solver-debug Source column without
# tooltips. The ``…`` is one character, so 24 includes it.
_SCENARIO_NAME_MAX = 24


def _truncate_scenario_name(name: str) -> str:
    if len(name) <= _SCENARIO_NAME_MAX:
        return name
    return name[: _SCENARIO_NAME_MAX - 1] + "…"


def _compose_source_label(
    session_label: str,
    scenario_id: str | None,
    scenario_name: str | None,
) -> tuple[str, str]:
    """Pre-render ``(source_label, source_kind)`` so historical rows survive
    scenario rename/deletion. Pure — no I/O — so it's safe to call from the
    failure-path fallback before/without PocketBase access."""
    if scenario_id is None:
        return f"{session_label} · CM", "production"
    display = _truncate_scenario_name(scenario_name or scenario_id)
    return f"{session_label} · {display}", "scenario"


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
    session_cm_id: int,
    year: int,
    scenario_id: str | None,
    scenario_name: str | None,
    session_attendee_count: int,
    sweep_id: str | None,
    sweep_label: str | None,
) -> dict[str, Any]:
    """Return the dict written to ``solver_runs.details`` for one run.

    Takes session_cm_id + year (instead of pre-formatted session_label) so it
    can look up the friendly short name from PB and compose ``2 · CM``.
    """
    config_snapshot = await snapshot_solver_config(pb)
    short = await _lookup_session_short_name(pb, session_cm_id, year)
    source_label, source_kind = _compose_source_label(short, scenario_id, scenario_name)

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
