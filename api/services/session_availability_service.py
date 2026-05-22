"""Session availability service.

Computes the availability matrix: for each session × gender, determine
enrollment counts, capacity, and status (open/limited/full).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, ClassVar

from api.constants.collections import CONFIG
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

from api.schemas.session_availability import (
    AGSessionAvailability,
    GenderAvailability,
    SessionAvailability,
    SessionAvailabilityResponse,
    TeenSessionAvailability,
    WaitlistedPerson,
)
from api.utils.session_metrics import (
    SUMMER_TEEN_TYPES,
    get_person_from_expand,
    get_session_from_expand,
    get_summer_window,
    is_summer_teen_session,
    resolve_duration_sessions,
)

logger = get_logger(__name__)

# Display labels for the merged teen availability rows (one row per teen session_type).
TEEN_AVAILABILITY_DISPLAY_NAMES: dict[str, str] = {"scit": "SCIT", "tli": "TLI"}


class SessionAvailabilityService:
    """Computes session availability matrix from enrollment/capacity data."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    def compute_status(
        self,
        enrolled: int,
        waitlisted: int,
        capacity: int | None,
        threshold_pct: int,
    ) -> str:
        """Compute availability status based on capacity only.

        Returns:
            'full' if enrollment >= 100% of capacity (includes overage),
            'limited' if enrollment >= threshold% of capacity,
            'open' otherwise (including when capacity is unknown).
        """
        if capacity and capacity > 0:
            pct = enrolled / capacity * 100
            if pct >= 100:
                return "full"
            if pct >= threshold_pct:
                return "limited"
        return "open"

    _DEFAULT_SESSION_TYPES: ClassVar[list[str]] = ["main", "embedded", "ag", "quest"]

    async def calculate_availability(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> SessionAvailabilityResponse:
        """Calculate session availability matrix for a year."""
        effective_types = session_types if session_types is not None else self._DEFAULT_SESSION_TYPES

        # Fetch all required data in parallel
        sessions_task = self.repository.fetch_sessions(year, session_types=effective_types)
        bunk_plans_task = self.repository.fetch_bunk_plans(year)
        capacity_config_task = self.repository.fetch_capacity_config()

        # Fetch enrolled + waitlisted attendees with person expansion
        enrolled_task = self.repository.fetch_attendees_with_persons(year, status_filter=["enrolled", "waitlisted"])

        sessions, bunk_plans, default_capacity, attendees = await asyncio.gather(
            sessions_task, bunk_plans_task, capacity_config_task, enrolled_task
        )

        # Window-gate teen sessions: scit/tli must overlap the year's main-camp
        # window (excludes fall Family-Camp CIT, year-round Teen Interns, etc.).
        if any(getattr(s, "session_type", "") in SUMMER_TEEN_TYPES for s in sessions.values()):
            window = get_summer_window(sessions)
            if window is None:
                # Requested scope had no main sessions (e.g. teens-only) — fetch mains.
                window = get_summer_window(await self.repository.fetch_sessions(year, ["main"]))
            sessions = {
                sid: s
                for sid, s in sessions.items()
                if getattr(s, "session_type", "") not in SUMMER_TEEN_TYPES or is_summer_teen_session(s, window)
            }

        # Filter sessions by duration category
        if duration:
            duration_session_ids = resolve_duration_sessions(sessions, duration)
            sessions = {sid: s for sid, s in sessions.items() if sid in duration_session_ids}

        # Fetch availability config from PocketBase
        config_records = await self._fetch_availability_config(year)
        session_configs = self._parse_session_configs(config_records)
        threshold = self._parse_threshold(config_records)

        # Build capacity per session per gender
        gender_capacity = self._calculate_gender_capacity(sessions, bunk_plans, default_capacity, session_configs)

        # Build enrollment counts and waitlist data in a single pass
        enrollment, waitlist_data = self._process_attendees(sessions, attendees)

        # Build response
        result_sessions: list[SessionAvailability] = []
        result_ag: list[AGSessionAvailability] = []

        # Sort sessions by start_date
        sorted_sessions = sorted(
            sessions.values(),
            key=lambda s: getattr(s, "start_date", "") or "",
        )

        for idx, session in enumerate(sorted_sessions):
            cm_id = int(getattr(session, "cm_id", 0))
            session_type = getattr(session, "session_type", "")
            name = getattr(session, "name", "")

            # Teen sessions are aggregated separately into teen_sessions rows.
            if session_type in SUMMER_TEEN_TYPES:
                continue

            if session_type == "ag":
                # AG session
                parent_id = getattr(session, "parent_id", None)
                parent_name = None
                if parent_id:
                    parent = sessions.get(int(parent_id))
                    if parent:
                        parent_name = getattr(parent, "name", None)

                ag_config = session_configs.get(cm_id, {})
                ag_cap = gender_capacity.get(cm_id, {}).get("mixed")
                ag_enrolled = enrollment.get(cm_id, {}).get("enrolled_total", 0)
                ag_waitlisted = enrollment.get(cm_id, {}).get("waitlisted_total", 0)

                # Hide defunct AG sessions: no capacity AND no enrollment
                if ag_cap is None and ag_enrolled == 0 and ag_waitlisted == 0:
                    continue

                wl = waitlist_data.get(cm_id, {})
                result_ag.append(
                    AGSessionAvailability(
                        session_cm_id=cm_id,
                        session_name=name,
                        parent_session_name=parent_name,
                        min_grade=ag_config.get("min_grade"),
                        max_grade=ag_config.get("max_grade"),
                        enrolled=ag_enrolled,
                        waitlisted=ag_waitlisted,
                        capacity=ag_cap,
                        status=self.compute_status(ag_enrolled, ag_waitlisted, ag_cap, threshold),
                        waitlisted_by_grade=wl.get("by_grade_total", {}),
                        waitlisted_persons=wl.get("persons_total", []),
                    )
                )
            else:
                # Main / embedded / quest session
                cfg = session_configs.get(cm_id, {})
                caps = gender_capacity.get(cm_id, {})
                boys_cap = caps.get("M")
                girls_cap = caps.get("F")

                boys_enrolled = enrollment.get(cm_id, {}).get("enrolled_M", 0)
                boys_waitlisted = enrollment.get(cm_id, {}).get("waitlisted_M", 0)
                girls_enrolled = enrollment.get(cm_id, {}).get("enrolled_F", 0)
                girls_waitlisted = enrollment.get(cm_id, {}).get("waitlisted_F", 0)

                wl = waitlist_data.get(cm_id, {})
                result_sessions.append(
                    SessionAvailability(
                        session_cm_id=cm_id,
                        session_name=name,
                        session_type=session_type,
                        sort_order=idx,
                        girls=GenderAvailability(
                            min_grade=cfg.get("min_grade"),
                            max_grade=cfg.get("max_grade"),
                            enrolled=girls_enrolled,
                            waitlisted=girls_waitlisted,
                            capacity=girls_cap,
                            status=self.compute_status(girls_enrolled, girls_waitlisted, girls_cap, threshold),
                            waitlisted_by_grade=wl.get("by_grade_F", {}),
                            waitlisted_persons=wl.get("persons_F", []),
                        ),
                        boys=GenderAvailability(
                            min_grade=cfg.get("min_grade"),
                            max_grade=cfg.get("max_grade"),
                            enrolled=boys_enrolled,
                            waitlisted=boys_waitlisted,
                            capacity=boys_cap,
                            status=self.compute_status(boys_enrolled, boys_waitlisted, boys_cap, threshold),
                            waitlisted_by_grade=wl.get("by_grade_M", {}),
                            waitlisted_persons=wl.get("persons_M", []),
                        ),
                    )
                )

        # Build aggregated teen rows (window-gated sessions already filtered above).
        # Suppressed on single-session drill-down: teens have no single-session
        # drill target (mirrors forecast_service's session_cm_id guard).
        teen_sessions = (
            self._build_teen_availability_rows(sessions, session_configs, enrollment, waitlist_data, threshold)
            if session_cm_id is None
            else []
        )

        # Filter by specific session if requested
        if session_cm_id is not None:
            result_sessions = [s for s in result_sessions if s.session_cm_id == session_cm_id]
            result_ag = [
                a
                for a in result_ag
                if a.session_cm_id == session_cm_id
                or getattr(sessions.get(a.session_cm_id), "parent_id", None) == session_cm_id
            ]

        return SessionAvailabilityResponse(
            sessions=result_sessions,
            ag_sessions=result_ag,
            teen_sessions=teen_sessions,
            limited_threshold=threshold,
        )

    async def _fetch_availability_config(self, year: int) -> list[Any]:
        """Fetch session_availability config records."""
        try:
            return await asyncio.to_thread(
                self.repository.pb.collection(CONFIG).get_full_list,
                query_params={"filter": f'category = "session_availability" && subcategory = "{year}"'},
            )
        except Exception:
            logger.warning("Could not fetch session availability config")
            return []

    def _parse_session_configs(self, config_records: list[Any]) -> dict[int | str, dict[str, Any]]:
        """Parse config records into a dict keyed by session cm_id or type string.

        Integer keys: per-session cm_id configs (grade range, capacity override).
        String keys of the form 'type:<name>': per-teen-type configs (type_scit → 'type:scit').
        """
        result: dict[int | str, dict[str, Any]] = {}
        for rec in config_records:
            key = getattr(rec, "config_key", "")
            value = getattr(rec, "value", None)
            if key == "limited_threshold" or not value or not isinstance(value, dict):
                continue
            if key.startswith("type_"):
                name = key.replace("type_", "", 1)
                if name:
                    result[f"type:{name}"] = value
                continue
            try:
                result[int(key)] = value
            except ValueError, TypeError:
                continue
        return result

    def _parse_threshold(self, config_records: list[Any]) -> int:
        """Extract limited_threshold from config records."""
        for rec in config_records:
            if getattr(rec, "config_key", "") == "limited_threshold":
                val = getattr(rec, "value", None)
                if isinstance(val, (int, float)):
                    return int(val)
        return 80

    def _calculate_gender_capacity(
        self,
        sessions: dict[int, Any],
        bunk_plans: list[Any],
        default_capacity: int,
        session_configs: dict[int | str, dict[str, Any]],
    ) -> dict[int, dict[str, int | None]]:
        """Calculate capacity per session per gender from bunk_plans.

        Returns dict: {session_cm_id: {'M': cap, 'F': cap, 'mixed': cap}}
        """
        # Build PB ID -> cm_id mapping
        pb_to_cm: dict[str, int] = {}
        for cm_id, session in sessions.items():
            pb_id = getattr(session, "id", None)
            if pb_id:
                pb_to_cm[pb_id] = int(cm_id)

        # Count bunks per session per gender
        bunk_counts: dict[int, dict[str, int]] = {}
        for bp in bunk_plans:
            session_pb_id = getattr(bp, "session", None)
            if not session_pb_id or session_pb_id not in pb_to_cm:
                continue

            cm_id = pb_to_cm[session_pb_id]
            expand = getattr(bp, "expand", {}) or {}
            bunk = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
            if not bunk:
                continue

            gender = getattr(bunk, "gender", "")
            gender_key = self._normalize_gender_key(gender)

            if gender_key is None:
                continue

            if cm_id not in bunk_counts:
                bunk_counts[cm_id] = {}
            bunk_counts[cm_id][gender_key] = bunk_counts[cm_id].get(gender_key, 0) + 1

        # Build capacity dict
        result: dict[int, dict[str, int | None]] = {}
        for cm_id in sessions:
            cm_id_int = int(cm_id)
            cfg = session_configs.get(cm_id_int, {})
            override = cfg.get("capacity_override")

            if override:
                # Capacity override: split evenly between genders
                half = override // 2
                result[cm_id_int] = {"M": half, "F": override - half, "mixed": override}
            else:
                counts = bunk_counts.get(cm_id_int, {})
                entry: dict[str, int | None] = {}
                for gk in ("M", "F", "mixed"):
                    cnt = counts.get(gk, 0)
                    entry[gk] = cnt * default_capacity if cnt > 0 else None
                result[cm_id_int] = entry

        return result

    def _normalize_gender_key(self, gender: str) -> str | None:
        """Normalize bunk gender to M, F, or mixed. Returns None for unknown."""
        if not gender:
            logger.warning("Bunk with empty gender skipped in capacity calculation")
            return None
        g = gender.lower()
        if g in ("mixed", "ag", "all-gender", "nb"):
            return "mixed"
        if g == "f":
            return "F"
        if g == "m":
            return "M"
        logger.warning("Bunk with unrecognized gender '%s' skipped in capacity calculation", gender)
        return None

    def _process_attendees(
        self,
        sessions: dict[int, Any],
        attendees: list[Any],
    ) -> tuple[dict[int, dict[str, int]], dict[int, dict[str, Any]]]:
        """Count enrollment and build waitlist data in a single pass.

        Returns tuple:
            - enrollment: {session_cm_id: {enrolled_M, enrolled_F, enrolled_total,
              waitlisted_M, waitlisted_F, waitlisted_total}}
            - waitlist_data: {session_cm_id: {by_grade_F, by_grade_M, by_grade_total,
              persons_F, persons_M, persons_total}}
        """
        enrollment: dict[int, dict[str, int]] = {}
        waitlist_grouped: dict[int, dict[str, list[dict[str, Any]]]] = {}

        for att in attendees:
            person = get_person_from_expand(att)
            session = get_session_from_expand(att)
            if not person or not session:
                continue

            session_cm_id = int(getattr(session, "cm_id", 0))
            if session_cm_id not in sessions:
                continue

            gender = getattr(person, "gender", "")
            status = getattr(att, "status", "enrolled")

            # --- Enrollment counting (all statuses) ---
            if session_cm_id not in enrollment:
                enrollment[session_cm_id] = {}
            counts = enrollment[session_cm_id]

            if status == "waitlisted":
                counts[f"waitlisted_{gender}"] = counts.get(f"waitlisted_{gender}", 0) + 1
                counts["waitlisted_total"] = counts.get("waitlisted_total", 0) + 1
            else:
                # Treat all other statuses as enrolled
                counts[f"enrolled_{gender}"] = counts.get(f"enrolled_{gender}", 0) + 1
                counts["enrolled_total"] = counts.get("enrolled_total", 0) + 1

            # --- Waitlist detail collection (waitlisted only) ---
            if status == "waitlisted":
                grade = getattr(person, "grade", None)
                effective_date = getattr(att, "effective_date", "") or ""
                enrollment_date = getattr(att, "enrollment_date", "") or ""

                entry = {
                    "person_id": int(getattr(person, "cm_id", 0)),
                    "first_name": getattr(person, "first_name", ""),
                    "last_name": getattr(person, "last_name", ""),
                    "preferred_name": getattr(person, "preferred_name", None),
                    "grade": grade,
                    "effective_date": effective_date,
                    "enrollment_date": enrollment_date,
                }

                if session_cm_id not in waitlist_grouped:
                    waitlist_grouped[session_cm_id] = {}
                session_groups = waitlist_grouped[session_cm_id]

                if gender not in session_groups:
                    session_groups[gender] = []
                session_groups[gender].append(entry)

                if "total" not in session_groups:
                    session_groups["total"] = []
                session_groups["total"].append(entry)

        # --- Post-process: build per-grade counts and top-5 person lists ---
        waitlist_data: dict[int, dict[str, Any]] = {}

        for session_cm_id, session_groups in waitlist_grouped.items():
            session_result: dict[str, Any] = {}

            for gender_key, entries in session_groups.items():
                by_grade: dict[int, int] = {}
                for entry in entries:
                    grade = entry["grade"]
                    if grade is not None:
                        by_grade[grade] = by_grade.get(grade, 0) + 1

                sorted_entries = sorted(entries, key=lambda e: (e["effective_date"], e["enrollment_date"]))

                persons: list[WaitlistedPerson] = []
                for idx, entry in enumerate(sorted_entries[:5]):
                    persons.append(
                        WaitlistedPerson(
                            person_id=entry["person_id"],
                            first_name=entry["first_name"],
                            last_name=entry["last_name"],
                            preferred_name=entry["preferred_name"],
                            grade=entry["grade"],
                            position=idx + 1,
                        )
                    )

                session_result[f"by_grade_{gender_key}"] = by_grade
                session_result[f"persons_{gender_key}"] = persons

            waitlist_data[session_cm_id] = session_result

        return enrollment, waitlist_data

    def _build_teen_availability_rows(
        self,
        sessions: dict[int, Any],
        session_configs: dict[int | str, dict[str, Any]],
        enrollment: dict[int, dict[str, int]],
        waitlist_data: dict[int, dict[str, Any]],
        threshold: int,
    ) -> list[TeenSessionAvailability]:
        """Aggregate window-gated teen sessions into one row per teen session_type.

        SCIT merges all CIT + SIT sub-sessions; TLI is its own row.
        Grade and capacity come from 'type:<name>' config keys.
        Emitted in SUMMER_TEEN_TYPES order (scit, then tli).
        """
        teen_cm_ids_by_type: dict[str, list[int]] = {}
        for sid, s in sessions.items():
            stype = getattr(s, "session_type", "")
            if stype in SUMMER_TEEN_TYPES:
                teen_cm_ids_by_type.setdefault(stype, []).append(int(getattr(s, "cm_id", sid)))

        rows: list[TeenSessionAvailability] = []
        for teen_type in SUMMER_TEEN_TYPES:  # deterministic order: scit, then tli
            cm_ids = teen_cm_ids_by_type.get(teen_type)
            if not cm_ids:
                continue
            cfg = session_configs.get(f"type:{teen_type}", {}) or {}
            enrolled = sum(enrollment.get(c, {}).get("enrolled_total", 0) for c in cm_ids)
            waitlisted = sum(enrollment.get(c, {}).get("waitlisted_total", 0) for c in cm_ids)

            by_grade: dict[int, int] = {}
            persons: list[Any] = []
            for c in cm_ids:
                wl = waitlist_data.get(c, {})
                for g, n in (wl.get("by_grade_total", {}) or {}).items():
                    by_grade[g] = by_grade.get(g, 0) + n
                # Approximate union: each sub-session contributes its own top-N list,
                # so merged positions can collide (not a globally-ordered queue).
                # Acceptable for the small teen cohort; a true global ordering would
                # need enrollment-date fields that WaitlistedPerson drops.
                persons.extend(wl.get("persons_total", []) or [])

            capacity = cfg.get("capacity_override")
            rows.append(
                TeenSessionAvailability(
                    session_cm_id=0,
                    session_name=TEEN_AVAILABILITY_DISPLAY_NAMES.get(teen_type, teen_type.upper()),
                    session_type=teen_type,
                    min_grade=cfg.get("min_grade"),
                    max_grade=cfg.get("max_grade"),
                    enrolled=enrolled,
                    waitlisted=waitlisted,
                    capacity=capacity,
                    status=self.compute_status(enrolled, waitlisted, capacity, threshold),
                    waitlisted_by_grade=by_grade,
                    waitlisted_persons=persons,
                )
            )
        return rows
