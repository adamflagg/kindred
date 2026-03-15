"""Session availability service.

Computes the availability matrix: for each session × gender, determine
enrollment counts, capacity, and status (open/limited/waitlist).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, ClassVar

from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

from api.schemas.session_availability import (
    AGSessionAvailability,
    GenderAvailability,
    SessionAvailability,
    SessionAvailabilityResponse,
    WaitlistedPerson,
)
from api.utils.session_metrics import resolve_duration_sessions

logger = get_logger(__name__)


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

        # Build enrollment counts per session per gender
        enrollment = self._count_enrollment(sessions, attendees)

        # Build per-grade waitlist data and top-5 person lists
        waitlist_data = self._build_waitlist_data(sessions, attendees)

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
            limited_threshold=threshold,
        )

    async def _fetch_availability_config(self, year: int) -> list[Any]:
        """Fetch session_availability config records."""
        try:
            return await asyncio.to_thread(
                self.repository.pb.collection("config").get_full_list,
                query_params={"filter": f'category = "session_availability" && subcategory = "{year}"'},
            )
        except Exception:
            logger.warning("Could not fetch session availability config")
            return []

    def _parse_session_configs(self, config_records: list[Any]) -> dict[int, dict[str, Any]]:
        """Parse config records into a dict keyed by session cm_id."""
        result: dict[int, dict[str, Any]] = {}
        for rec in config_records:
            key = getattr(rec, "config_key", "")
            value = getattr(rec, "value", None)
            if key == "limited_threshold" or not value:
                continue
            try:
                cm_id = int(key)
            except (ValueError, TypeError):
                continue
            if isinstance(value, dict):
                result[cm_id] = value
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
        session_configs: dict[int, dict[str, Any]],
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

    def _normalize_gender_key(self, gender: str) -> str:
        """Normalize bunk gender to M, F, or mixed."""
        if not gender:
            return "M"
        g = gender.lower()
        if g in ("mixed", "ag", "all-gender", "nb"):
            return "mixed"
        if g == "f":
            return "F"
        return "M"

    def _count_enrollment(
        self,
        sessions: dict[int, Any],
        attendees: list[Any],
    ) -> dict[int, dict[str, int]]:
        """Count enrolled and waitlisted per session per gender.

        Returns dict: {session_cm_id: {
            'enrolled_M': n, 'enrolled_F': n, 'enrolled_total': n,
            'waitlisted_M': n, 'waitlisted_F': n, 'waitlisted_total': n,
        }}
        """
        result: dict[int, dict[str, int]] = {}

        for att in attendees:
            expand = getattr(att, "expand", {}) or {}
            person = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if not person or not session:
                continue

            session_cm_id = int(getattr(session, "cm_id", 0))
            if session_cm_id not in sessions:
                continue

            gender = getattr(person, "gender", "")
            status = getattr(att, "status", "enrolled")

            if session_cm_id not in result:
                result[session_cm_id] = {}

            counts = result[session_cm_id]

            if status == "waitlisted":
                counts[f"waitlisted_{gender}"] = counts.get(f"waitlisted_{gender}", 0) + 1
                counts["waitlisted_total"] = counts.get("waitlisted_total", 0) + 1
            else:
                # Treat all other statuses as enrolled
                counts[f"enrolled_{gender}"] = counts.get(f"enrolled_{gender}", 0) + 1
                counts["enrolled_total"] = counts.get("enrolled_total", 0) + 1

        return result

    def _build_waitlist_data(
        self,
        sessions: dict[int, Any],
        attendees: list[Any],
    ) -> dict[int, dict[str, Any]]:
        """Build per-grade waitlist counts and top-5 person lists per session.

        Returns dict: {session_cm_id: {
            'by_grade_F': {grade: count}, 'by_grade_M': {grade: count}, 'by_grade_total': {grade: count},
            'persons_F': [WaitlistedPerson...], 'persons_M': [WaitlistedPerson...],
            'persons_total': [WaitlistedPerson...],
        }}
        """
        # Collect waitlisted attendee details grouped by session and gender
        # Key: (session_cm_id, gender_key) where gender_key is "F", "M", or "total"
        grouped: dict[int, dict[str, list[dict[str, Any]]]] = {}

        for att in attendees:
            status = getattr(att, "status", "enrolled")
            if status != "waitlisted":
                continue

            expand = getattr(att, "expand", {}) or {}
            person = expand.get("person") if isinstance(expand, dict) else getattr(expand, "person", None)
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if not person or not session:
                continue

            session_cm_id = int(getattr(session, "cm_id", 0))
            if session_cm_id not in sessions:
                continue

            gender = getattr(person, "gender", "")
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

            if session_cm_id not in grouped:
                grouped[session_cm_id] = {}

            session_groups = grouped[session_cm_id]

            # Add to gender-specific group
            if gender not in session_groups:
                session_groups[gender] = []
            session_groups[gender].append(entry)

            # Add to "total" group (for AG sessions)
            if "total" not in session_groups:
                session_groups["total"] = []
            session_groups["total"].append(entry)

        # Build result: per-grade counts and top-5 person lists
        result: dict[int, dict[str, Any]] = {}

        for session_cm_id, session_groups in grouped.items():
            session_result: dict[str, Any] = {}

            for gender_key, entries in session_groups.items():
                # Build per-grade counts
                by_grade: dict[int, int] = {}
                for entry in entries:
                    grade = entry["grade"]
                    if grade is not None:
                        by_grade[grade] = by_grade.get(grade, 0) + 1

                # Sort by (effective_date, enrollment_date) for position ordering
                sorted_entries = sorted(entries, key=lambda e: (e["effective_date"], e["enrollment_date"]))

                # Build top-5 WaitlistedPerson list
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

            result[session_cm_id] = session_result

        return result
