"""
Geo management service - business logic for geographic data gaps, canonicals, sources, and overrides.

This service provides:
- Three-tier gap classification (canonical_no_coords, non_canonical_grouped, non_canonical_ungrouped)
- Canonical search with source badges and location metadata
- Source inspection (original_value grouping for a canonical name)
- Override CRUD with optional Nominatim geocoding
"""

from __future__ import annotations

import asyncio
import json
import time
from importlib.resources import files
from typing import Any

import httpx

from api.schemas.geo import (
    CanonicalEntry,
    CanonicalSearchResponse,
    GapItem,
    GapsResponse,
    OverrideCreate,
    OverrideResponse,
    SourceItem,
    SourceMappingItem,
    SourceMappingsResponse,
    SourcesResponse,
)
from api.utils.session_metrics import resolve_duration_sessions
from bunking.logging_config import get_logger
from pocketbase import PocketBase

logger = get_logger(__name__)


# ============================================================================
# Static data loading (cached at module level)
# ============================================================================

_STATIC_CACHE: dict[str, dict[str, Any]] = {}


def _load_json_file(category: str) -> dict[str, Any]:
    """Load and cache a static JSON data file for the given category."""
    if category in _STATIC_CACHE:
        return _STATIC_CACHE[category]

    file_map = {
        "school": "schools.json",
        "congregation": "congregations.json",
        "city": "us_cities.json",
    }
    filename = file_map.get(category)
    if not filename:
        raise ValueError(f"Unknown category: {category}")

    data_file = files("bunking.geo_normalizer.data").joinpath(filename)
    data: dict[str, Any] = json.loads(data_file.read_text())
    _STATIC_CACHE[category] = data
    return data


def _load_static_lookup(category: str) -> dict[str, str]:
    """Load the static lookup dict (raw_lower -> canonical_name) for a category."""
    data = _load_json_file(category)
    result: dict[str, str] = data.get("lookup", {})
    return result


def _load_static_coords(category: str) -> dict[str, list[float]]:
    """Load the static coords dict (canonical_name -> [lat, lng]) for a category."""
    data = _load_json_file(category)
    result: dict[str, list[float]] = data.get("coords", {})
    return result


def _load_static_location(category: str) -> dict[str, dict[str, str]]:
    """Load the static location dict (canonical_name -> {city, state}) for a category."""
    data = _load_json_file(category)
    result: dict[str, dict[str, str]] = data.get("location", {})
    return result


def _get_source_badge(category: str, canonical_name: str) -> str:
    """Determine the data source badge for a canonical name.

    Returns one of: 'nces', 'pss', 'simplemaps', 'curated', or empty string.
    """
    lookup = _load_static_lookup(category)
    canonical_values = set(lookup.values())

    if canonical_name not in canonical_values:
        return ""

    # Map category to source badge
    badge_map = {"school": "nces", "city": "simplemaps", "congregation": "curated"}
    return badge_map.get(category, "")


async def geocode_location(name: str, city: str, state: str) -> tuple[float, float] | None:
    """Geocode a location using Nominatim (OpenStreetMap).

    Args:
        name: The place name (school, congregation, etc.)
        city: City name
        state: State abbreviation

    Returns:
        (lat, lng) tuple if successful, None otherwise.
    """
    query = f"{name} {city} {state}".strip()
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": query, "format": "json", "limit": 1},
                headers={"User-Agent": "Kindred/1.0"},
                timeout=10.0,
            )
            results = response.json()
            if results:
                lat = float(results[0]["lat"])
                lng = float(results[0]["lon"])
                return (lat, lng)
            return None
    except Exception:
        logger.warning("Geocoding failed for %s", query, exc_info=True)
        return None


# ============================================================================
# Override record conversion
# ============================================================================


def _override_to_response(record: Any) -> OverrideResponse:
    """Convert a PocketBase override record to an OverrideResponse."""
    return OverrideResponse(
        id=record.id,
        category=record.category,
        override_type=record.override_type,
        raw_value=record.raw_value or None,
        canonical_name=record.canonical_name,
        city=record.city or None,
        state=record.state or None,
        lat=record.lat if record.lat is not None else None,
        lng=record.lng if record.lng is not None else None,
        merged_into=record.merged_into or None,
        notes=record.notes or None,
        year=record.year,
        nominatim_status=record.nominatim_status or None,
    )


# ============================================================================
# Service class
# ============================================================================


class GeoService:
    """Business logic for geo management - fully testable with mocked PocketBase."""

    def __init__(self, pb: PocketBase) -> None:
        self.pb = pb
        self._person_id_cache: dict[tuple[int, tuple[str, ...], int | None, str | None], tuple[set[str], float]] = {}

    async def _fetch_active_person_pb_ids(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> set[str]:
        """Fetch PB IDs of persons with active enrolled attendee records.

        Results are cached for 60 seconds keyed by (year, session_types, session_cm_id, duration).
        """
        cache_key = (year, tuple(session_types or []), session_cm_id, duration)
        now = time.monotonic()

        cached = self._person_id_cache.get(cache_key)
        if cached is not None:
            result, cached_at = cached
            if now - cached_at < 60.0:
                return result

        att_filter = f"year = {year} && is_active = 1 && status_id = 2"
        if session_cm_id is not None:
            att_filter += f" && session.cm_id = {session_cm_id}"
        elif session_types:
            clauses = [f'session.session_type = "{t}"' for t in session_types]
            att_filter += f" && ({' || '.join(clauses)})"

        # Apply duration filter by resolving to matching session cm_ids
        if duration:
            sessions_raw: list[Any] = await asyncio.to_thread(
                self.pb.collection("sessions").get_full_list,
                query_params={"filter": f"year = {year}"},
            )
            sessions_dict = {int(s.cm_id): s for s in sessions_raw if getattr(s, "cm_id", None)}
            duration_ids = resolve_duration_sessions(sessions_dict, duration)
            if duration_ids:
                id_clauses = [f"session.cm_id = {sid}" for sid in duration_ids]
                att_filter += f" && ({' || '.join(id_clauses)})"
            else:
                # No sessions match the duration — return empty set
                self._person_id_cache[cache_key] = (set(), now)
                return set()

        attendees: list[Any] = await asyncio.to_thread(
            self.pb.collection("attendees").get_full_list,
            query_params={"filter": att_filter, "fields": "person"},
        )
        result = {a.person for a in attendees if a.person}
        self._person_id_cache[cache_key] = (result, now)
        return result

    async def _fetch_duration_person_pb_ids(
        self,
        year: int,
        duration: str,
    ) -> set[str]:
        """Fetch PB IDs of ALL persons attending sessions matching the given duration.

        Unlike _fetch_active_person_pb_ids, this does NOT filter by is_active/status_id.
        Used when duration is specified but active_only is False.

        Results are cached for 60 seconds keyed by (year, (), None, duration).
        """
        cache_key = (year, ("__duration_only__",), None, duration)
        now = time.monotonic()

        cached = self._person_id_cache.get(cache_key)
        if cached is not None:
            result, cached_at = cached
            if now - cached_at < 60.0:
                return result

        sessions_raw: list[Any] = await asyncio.to_thread(
            self.pb.collection("sessions").get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        sessions_dict = {int(s.cm_id): s for s in sessions_raw if getattr(s, "cm_id", None)}
        duration_ids = resolve_duration_sessions(sessions_dict, duration)

        if not duration_ids:
            self._person_id_cache[cache_key] = (set(), now)
            return set()

        id_clauses = [f"session.cm_id = {sid}" for sid in duration_ids]
        att_filter = f"year = {year} && ({' || '.join(id_clauses)})"

        attendees: list[Any] = await asyncio.to_thread(
            self.pb.collection("attendees").get_full_list,
            query_params={"filter": att_filter, "fields": "person"},
        )
        result = {a.person for a in attendees if a.person}
        self._person_id_cache[cache_key] = (result, now)
        return result

    @staticmethod
    def _infer_location_from_mappings(mappings: list[Any], normalized_value: str) -> dict[str, str]:
        """Infer city/state/country from majority of mappings for a normalized value."""
        state_counts: dict[str, int] = {}
        country_counts: dict[str, int] = {}
        for m in mappings:
            if m.normalized_value != normalized_value:
                continue
            state = getattr(m, "address_state", "") or ""
            country = getattr(m, "address_country", "") or ""
            if state:
                state_counts[state] = state_counts.get(state, 0) + 1
            if country:
                country_counts[country] = country_counts.get(country, 0) + 1

        result: dict[str, str] = {}
        if state_counts:
            result["state"] = max(state_counts, key=state_counts.get)  # type: ignore[arg-type]
        if country_counts:
            result["country"] = max(country_counts, key=country_counts.get)  # type: ignore[arg-type]
        return result

    @staticmethod
    def _filter_and_dedup_mappings(
        mappings: list[Any],
        active_person_ids: set[str] | None,
    ) -> list[Any]:
        """Filter mappings to active persons and deduplicate by (person, normalized_value)."""
        if active_person_ids is None:
            return mappings
        seen: set[tuple[str, str]] = set()
        result: list[Any] = []
        for m in mappings:
            if not m.person or m.person not in active_person_ids:
                continue
            key = (m.person, m.normalized_value)
            if key in seen:
                continue
            seen.add(key)
            result.append(m)
        return result

    async def get_gaps(
        self,
        category: str,
        year: int,
        active_only: bool = False,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> GapsResponse:
        """Classify normalized values without coordinates into three tiers.

        1. canonical_no_coords: In static lookup values but missing coords
        2. non_canonical_grouped: Not in lookup but clustered (multiple source variants)
        3. non_canonical_ungrouped: Single raw value, not in lookup
        """
        # Load static data
        lookup = _load_static_lookup(category)
        coords = _load_static_coords(category)
        canonical_values = set(lookup.values())

        # Fetch all PB data in parallel
        mappings_task = asyncio.to_thread(
            self.pb.collection("normalized_mappings").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year}'},
        )
        overrides_task = asyncio.to_thread(
            self.pb.collection("geo_overrides").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year}'},
        )

        if active_only:
            active_ids_task = self._fetch_active_person_pb_ids(year, session_types, session_cm_id, duration)
            mappings_raw, overrides_raw, active_ids = await asyncio.gather(
                mappings_task, overrides_task, active_ids_task
            )
            mappings: list[Any] = mappings_raw
            overrides: list[Any] = overrides_raw
            mappings = self._filter_and_dedup_mappings(mappings, active_ids)
        elif duration:
            duration_ids_task = self._fetch_duration_person_pb_ids(year, duration)
            mappings_raw, overrides_raw, duration_person_ids = await asyncio.gather(
                mappings_task, overrides_task, duration_ids_task
            )
            mappings = list(mappings_raw)
            overrides = list(overrides_raw)
            mappings = self._filter_and_dedup_mappings(mappings, duration_person_ids)
        else:
            mappings_raw, overrides_raw = await asyncio.gather(mappings_task, overrides_task)
            mappings = list(mappings_raw)
            overrides = list(overrides_raw)

        # Build set of canonical names that have override coords
        override_coord_names: set[str] = set()
        for ov in overrides:
            if ov.lat is not None and ov.lng is not None:
                override_coord_names.add(ov.canonical_name)

        # Group mappings by normalized_value
        groups: dict[str, dict[str, Any]] = {}
        for m in mappings:
            nv: str = m.normalized_value
            if nv not in groups:
                groups[nv] = {"count": 0, "sources": set(), "states": {}}
            groups[nv]["count"] += 1
            groups[nv]["sources"].add(m.original_value)
            state_key = getattr(m, "address_state", "") or ""
            country_key = getattr(m, "address_country", "") or ""
            label = state_key if country_key in ("", "US", "USA") else country_key
            if label:
                groups[nv]["states"][label] = groups[nv]["states"].get(label, 0) + 1

        # Classify each group
        canonical_no_coords: list[GapItem] = []
        non_canonical_grouped: list[GapItem] = []
        non_canonical_ungrouped: list[GapItem] = []

        total_gap_count = 0

        for nv, info in groups.items():
            count = info["count"]
            source_count = len(info["sources"])

            # Has coords in static data or overrides? -> not a gap
            if nv in coords or nv in override_coord_names:
                continue

            total_gap_count += count

            state_dist = info["states"]

            # Is it a canonical value (in lookup values)?
            if nv in canonical_values:
                canonical_no_coords.append(
                    GapItem(
                        name=nv, count=count, percentage=0.0, source_count=source_count, state_distribution=state_dist
                    )
                )
            elif source_count > 1:
                non_canonical_grouped.append(
                    GapItem(
                        name=nv, count=count, percentage=0.0, source_count=source_count, state_distribution=state_dist
                    )
                )
            else:
                non_canonical_ungrouped.append(
                    GapItem(
                        name=nv, count=count, percentage=0.0, source_count=source_count, state_distribution=state_dist
                    )
                )

        # Sort each list by count descending
        canonical_no_coords.sort(key=lambda x: -x.count)
        non_canonical_grouped.sort(key=lambda x: -x.count)
        non_canonical_ungrouped.sort(key=lambda x: -x.count)

        # Calculate percentages
        if total_gap_count > 0:
            for item in [*canonical_no_coords, *non_canonical_grouped, *non_canonical_ungrouped]:
                item.percentage = round(item.count / total_gap_count * 100, 1)

        total_gaps = len(canonical_no_coords) + len(non_canonical_grouped) + len(non_canonical_ungrouped)

        return GapsResponse(
            canonical_no_coords=canonical_no_coords,
            non_canonical_grouped=non_canonical_grouped,
            non_canonical_ungrouped=non_canonical_ungrouped,
            total_gaps=total_gaps,
        )

    async def search_canonicals(
        self,
        category: str,
        query: str,
        year: int,
        *,
        in_use_only: bool = False,
        active_only: bool = False,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> CanonicalSearchResponse:
        """Search canonical entries by name, city, or state.

        Returns entries from both static lookup and geo_overrides.
        """
        lookup = _load_static_lookup(category)
        coords = _load_static_coords(category)
        location = _load_static_location(category)

        # Fetch PB data in parallel
        mappings_task = asyncio.to_thread(
            self.pb.collection("normalized_mappings").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year}'},
        )
        overrides_task = asyncio.to_thread(
            self.pb.collection("geo_overrides").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year} && override_type = "canonical"'},
        )

        if active_only:
            active_ids_task = self._fetch_active_person_pb_ids(year, session_types, session_cm_id, duration)
            mappings_raw, overrides_raw, active_ids = await asyncio.gather(
                mappings_task, overrides_task, active_ids_task
            )
            mappings: list[Any] = mappings_raw
            overrides: list[Any] = overrides_raw
            mappings = self._filter_and_dedup_mappings(mappings, active_ids)
        elif duration:
            duration_ids_task = self._fetch_duration_person_pb_ids(year, duration)
            mappings_raw, overrides_raw, duration_person_ids = await asyncio.gather(
                mappings_task, overrides_task, duration_ids_task
            )
            mappings = list(mappings_raw)
            overrides = list(overrides_raw)
            mappings = self._filter_and_dedup_mappings(mappings, duration_person_ids)
        else:
            mappings_raw, overrides_raw = await asyncio.gather(mappings_task, overrides_task)
            mappings = list(mappings_raw)
            overrides = list(overrides_raw)

        # Build camper counts per normalized_value
        camper_counts: dict[str, int] = {}
        for m in mappings:
            nv: str = m.normalized_value
            camper_counts[nv] = camper_counts.get(nv, 0) + 1

        # Collect all canonical names from lookup values
        all_canonicals: dict[str, CanonicalEntry] = {}
        badge_map = {"school": "nces", "city": "simplemaps", "congregation": "curated"}
        source_badge = badge_map.get(category, "")
        for canonical_name in set(lookup.values()):
            loc = location.get(canonical_name, {})
            has_coords = canonical_name in coords
            all_canonicals[canonical_name] = CanonicalEntry(
                canonical_name=canonical_name,
                city=loc.get("city", ""),
                state=loc.get("state", ""),
                source=source_badge,
                has_coords=has_coords,
                camper_count=camper_counts.get(canonical_name, 0),
            )

        # Add non-canonical entries that have camper data (suggested canonicals)
        for nv, count in camper_counts.items():
            if nv not in all_canonicals:
                inferred = self._infer_location_from_mappings(mappings, nv)
                has_coords = nv in coords
                all_canonicals[nv] = CanonicalEntry(
                    canonical_name=nv,
                    city=inferred.get("city", ""),
                    state=inferred.get("state", ""),
                    country=inferred.get("country", ""),
                    source="suggested",
                    has_coords=has_coords,
                    camper_count=count,
                )

        # Add override canonical entries
        for ov in overrides:
            has_coords = ov.lat is not None and ov.lng is not None
            all_canonicals[ov.canonical_name] = CanonicalEntry(
                canonical_name=ov.canonical_name,
                city=ov.city or "",
                state=ov.state or "",
                source="manual",
                has_coords=has_coords,
                camper_count=camper_counts.get(ov.canonical_name, 0),
            )

        # Filter by in_use_only (entries with camper data)
        if in_use_only:
            all_canonicals = {k: v for k, v in all_canonicals.items() if v.camper_count > 0}

        # Filter by query (case-insensitive substring)
        query_lower = query.lower()
        if query_lower:
            results: list[CanonicalEntry] = [
                entry
                for entry in all_canonicals.values()
                if query_lower in entry.canonical_name.lower()
                or query_lower in entry.city.lower()
                or query_lower in entry.state.lower()
            ]
        else:
            results = list(all_canonicals.values())

        # Sort by camper_count descending, then name
        results.sort(key=lambda x: (-x.camper_count, x.canonical_name))

        return CanonicalSearchResponse(results=results)

    async def get_sources(
        self,
        category: str,
        canonical_name: str,
        year: int,
        active_only: bool = False,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> SourcesResponse:
        """Get raw value variants that map to a canonical name.

        Groups by original_value with row counts and confidence scores.
        """
        location = _load_static_location(category)

        # Fetch normalized_mappings for this canonical
        mappings: list[Any] = await asyncio.to_thread(
            self.pb.collection("normalized_mappings").get_full_list,
            query_params={
                "filter": (f'category = "{category}" && year = {year} && normalized_value = "{canonical_name}"')
            },
        )

        # Filter to active attendees if requested, or by duration sessions
        if active_only:
            active_ids = await self._fetch_active_person_pb_ids(year, session_types, session_cm_id, duration)
            mappings = self._filter_and_dedup_mappings(mappings, active_ids)
        elif duration:
            duration_person_ids = await self._fetch_duration_person_pb_ids(year, duration)
            mappings = self._filter_and_dedup_mappings(mappings, duration_person_ids)

        # Group by original_value, counting rows and tracking min confidence
        source_groups: dict[str, dict[str, Any]] = {}
        for m in mappings:
            ov: str = m.original_value
            if ov not in source_groups:
                source_groups[ov] = {"count": 0, "confidence": m.confidence, "states": {}}
            source_groups[ov]["count"] += 1
            source_groups[ov]["confidence"] = min(source_groups[ov]["confidence"], m.confidence)
            # Aggregate state/country distribution
            state_key = getattr(m, "address_state", "") or ""
            country_key = getattr(m, "address_country", "") or ""
            # For US entries, show state; for international, show country code
            label = state_key if country_key in ("", "US", "USA") else country_key
            if label:
                source_groups[ov]["states"][label] = source_groups[ov]["states"].get(label, 0) + 1

        sources: list[SourceItem] = [
            SourceItem(
                original_value=ov,
                count=g["count"],
                confidence=g["confidence"],
                state_distribution=g["states"],
            )
            for ov, g in source_groups.items()
        ]

        # Sort by count descending
        sources.sort(key=lambda x: -x.count)

        loc = location.get(canonical_name, {})

        return SourcesResponse(
            canonical_name=canonical_name,
            city=loc.get("city", ""),
            state=loc.get("state", ""),
            sources=sources,
        )

    async def get_source_mappings(
        self,
        category: str,
        year: int,
        active_only: bool = False,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
    ) -> SourceMappingsResponse:
        """Get all source mappings grouped by normalized_value, then by original_value."""
        mappings: list[Any] = await asyncio.to_thread(
            self.pb.collection("normalized_mappings").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year}'},
        )

        if active_only:
            active_ids = await self._fetch_active_person_pb_ids(year, session_types, session_cm_id, duration)
            mappings = self._filter_and_dedup_mappings(mappings, active_ids)
        elif duration:
            duration_person_ids = await self._fetch_duration_person_pb_ids(year, duration)
            mappings = self._filter_and_dedup_mappings(mappings, duration_person_ids)

        # Group: normalized_value -> original_value -> {count, confidence}
        by_normalized: dict[str, dict[str, dict[str, Any]]] = {}
        for m in mappings:
            nv = m.normalized_value
            ov = m.original_value
            if nv not in by_normalized:
                by_normalized[nv] = {}
            if ov not in by_normalized[nv]:
                by_normalized[nv][ov] = {"count": 0, "confidence": m.confidence}
            by_normalized[nv][ov]["count"] += 1
            by_normalized[nv][ov]["confidence"] = min(by_normalized[nv][ov]["confidence"], m.confidence)

        result: dict[str, list[SourceMappingItem]] = {}
        for nv, originals in by_normalized.items():
            items = [
                SourceMappingItem(original=ov, count=g["count"], confidence=g["confidence"])
                for ov, g in originals.items()
            ]
            items.sort(key=lambda x: -x.count)
            result[nv] = items

        return SourceMappingsResponse(mappings=result)

    async def list_overrides(self, category: str, year: int) -> list[OverrideResponse]:
        """List all overrides for a category and year."""
        records: list[Any] = await asyncio.to_thread(
            self.pb.collection("geo_overrides").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year}'},
        )
        return [_override_to_response(r) for r in records]

    async def create_override(self, data: OverrideCreate) -> OverrideResponse:
        """Create a new geo override record.

        For canonical overrides with city+state, attempts Nominatim geocoding.
        """
        body: dict[str, Any] = {
            "category": data.category,
            "override_type": data.override_type,
            "raw_value": data.raw_value or "",
            "canonical_name": data.canonical_name,
            "city": data.city or "",
            "state": data.state or "",
            "merged_into": data.merged_into or "",
            "notes": data.notes or "",
            "year": data.year,
        }

        # Attempt geocoding for canonical overrides with city+state
        if data.override_type == "canonical" and data.city and data.state:
            coords = await geocode_location(data.canonical_name, data.city, data.state)
            if coords:
                body["lat"] = coords[0]
                body["lng"] = coords[1]

        # Use user-supplied coords if provided and not already geocoded
        if "lat" not in body and data.lat is not None and data.lng is not None:
            body["lat"] = data.lat
            body["lng"] = data.lng

        record = await asyncio.to_thread(
            self.pb.collection("geo_overrides").create,
            body,
        )
        return _override_to_response(record)

    async def update_override(self, override_id: str, data: dict[str, Any]) -> OverrideResponse:
        """Update an existing geo override record."""
        record = await asyncio.to_thread(
            self.pb.collection("geo_overrides").update,
            override_id,
            data,
        )
        return _override_to_response(record)

    async def delete_override(self, override_id: str) -> None:
        """Delete a geo override record."""
        await asyncio.to_thread(
            self.pb.collection("geo_overrides").delete,
            override_id,
        )

    async def merge_canonical(self, source_name: str, target_name: str, category: str, year: int) -> int:
        """Merge source canonical into target.

        1. Create merge override (geo_overrides with override_type="merge")
        2. Update all normalized_mappings from source -> target
        3. Return count of updated mappings
        """
        # Create merge override
        await asyncio.to_thread(
            self.pb.collection("geo_overrides").create,
            {
                "category": category,
                "override_type": "merge",
                "canonical_name": source_name,
                "merged_into": target_name,
                "year": year,
            },
        )

        # Update all mappings
        mappings: list[Any] = await asyncio.to_thread(
            self.pb.collection("normalized_mappings").get_full_list,
            query_params={"filter": f'category = "{category}" && year = {year} && normalized_value = "{source_name}"'},
        )

        count = 0
        for m in mappings:
            await asyncio.to_thread(
                self.pb.collection("normalized_mappings").update,
                m.id,
                {"normalized_value": target_name},
            )
            count += 1

        return count

    async def approve_suggested(
        self,
        canonical_name: str,
        category: str,
        year: int,
        city: str = "",
        state: str = "",
        country: str = "",
    ) -> None:
        """Approve a suggested canonical by creating a canonical override."""
        await asyncio.to_thread(
            self.pb.collection("geo_overrides").create,
            {
                "category": category,
                "override_type": "canonical",
                "canonical_name": canonical_name,
                "city": city,
                "state": state,
                "year": year,
            },
        )

    async def reject_suggested(
        self,
        canonical_name: str,
        category: str,
        year: int,
    ) -> int:
        """Reject a suggested canonical by dissolving its cluster.

        Deletes all normalized_mappings pointing at this canonical,
        so source variants reappear as unresolved gaps.
        """
        mappings: list[Any] = await asyncio.to_thread(
            self.pb.collection("normalized_mappings").get_full_list,
            query_params={
                "filter": f'category = "{category}" && year = {year} && normalized_value = "{canonical_name}"'
            },
        )

        count = 0
        for m in mappings:
            await asyncio.to_thread(
                self.pb.collection("normalized_mappings").delete,
                m.id,
            )
            count += 1

        return count

    def _check_name_ambiguity(self, category: str, canonical_name: str) -> bool:
        """Check if a canonical name exists in multiple locations in static data."""
        location_data = _load_static_location(category)
        lookup = _load_static_lookup(category)

        target_lower = canonical_name.lower()
        matching_canonicals = [v for k, v in lookup.items() if v.lower() == target_lower or k == target_lower]
        if len(matching_canonicals) <= 1:
            return False

        locations = set()
        for canon in matching_canonicals:
            loc = location_data.get(canon, {})
            city = loc.get("city", "")
            state = loc.get("state", "")
            if city or state:
                locations.add((city.lower(), state.lower()))

        return len(locations) > 1

    async def batch_resolve_coords(self, category: str, year: int) -> dict[str, Any]:
        """Batch auto-resolve coordinates for unambiguous canonical entries."""
        static_coords = _load_static_coords(category)
        static_lookup = _load_static_lookup(category)
        static_location = _load_static_location(category)
        canonical_values = set(static_lookup.values())

        mappings_raw, overrides_raw = await asyncio.gather(
            asyncio.to_thread(
                self.pb.collection("normalized_mappings").get_full_list,
                query_params={"filter": f'category = "{category}" && year = {year}'},
            ),
            asyncio.to_thread(
                self.pb.collection("geo_overrides").get_full_list,
                query_params={"filter": f'category = "{category}" && year = {year}'},
            ),
        )
        mappings: list[Any] = mappings_raw
        overrides: list[Any] = overrides_raw

        canonical_names = {
            m.normalized_value for m in mappings if m.normalized_value and m.normalized_value in canonical_values
        }
        missing_coords = [name for name in canonical_names if name not in static_coords]

        checked_names = {o.canonical_name for o in overrides if o.nominatim_status}
        coord_override_names = {o.canonical_name for o in overrides if o.lat is not None and o.lng is not None}
        candidates = [name for name in missing_coords if name not in checked_names and name not in coord_override_names]

        resolved = 0
        skipped = 0
        skipped_names: list[str] = []

        for name in candidates:
            if self._check_name_ambiguity(category, name):
                skipped += 1
                skipped_names.append(name)
                location = static_location.get(name, {})
                await asyncio.to_thread(
                    self.pb.collection("geo_overrides").create,
                    {
                        "category": category,
                        "override_type": "canonical",
                        "canonical_name": name,
                        "city": location.get("city", ""),
                        "state": location.get("state", ""),
                        "nominatim_status": "ambiguous",
                        "year": year,
                    },
                )
                continue

            location = static_location.get(name, {})
            city = location.get("city", "")
            state = location.get("state", "")

            coords = await geocode_location(name, city, state)

            if coords:
                lat, lng = coords
                await asyncio.to_thread(
                    self.pb.collection("geo_overrides").create,
                    {
                        "category": category,
                        "override_type": "canonical",
                        "canonical_name": name,
                        "city": city,
                        "state": state,
                        "lat": lat,
                        "lng": lng,
                        "nominatim_status": "resolved",
                        "year": year,
                    },
                )
                resolved += 1
            else:
                skipped += 1
                skipped_names.append(name)
                await asyncio.to_thread(
                    self.pb.collection("geo_overrides").create,
                    {
                        "category": category,
                        "override_type": "canonical",
                        "canonical_name": name,
                        "city": city,
                        "state": state,
                        "nominatim_status": "no_result",
                        "year": year,
                    },
                )

            await asyncio.sleep(1.0)

        return {
            "resolved": resolved,
            "skipped": skipped,
            "skipped_names": skipped_names,
            "paused": False,
        }
