"""
Geo management service - business logic for geographic data gaps, canonicals, sources, and overrides.

This service provides:
- Three-tier gap classification (canonical_no_coords, non_canonical_grouped, non_canonical_ungrouped)
- Canonical search with source badges and location metadata
- Source inspection (original_value grouping for a canonical name)
- Override CRUD with optional Nominatim geocoding
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.schemas.geo import (
        CanonicalSearchResponse,
        GapsResponse,
        OverrideCreate,
        OverrideResponse,
        SourcesResponse,
    )
    from pocketbase import PocketBase

logger = get_logger(__name__)


def _load_static_lookup(category: str) -> dict[str, str]:
    """Load the static lookup dict for a category. Stub for tests."""
    raise NotImplementedError


def _load_static_coords(category: str) -> dict[str, list[float]]:
    """Load the static coords dict for a category. Stub for tests."""
    raise NotImplementedError


def _load_static_location(category: str) -> dict[str, dict[str, str]]:
    """Load the static location dict for a category. Stub for tests."""
    raise NotImplementedError


def _get_source_badge(category: str, canonical_name: str) -> str:
    """Get the source badge for a canonical name. Stub for tests."""
    raise NotImplementedError


async def geocode_location(name: str, city: str, state: str) -> tuple[float, float] | None:
    """Geocode a location using Nominatim. Stub for tests."""
    raise NotImplementedError


class GeoService:
    """Business logic for geo management - fully testable with mocked PocketBase."""

    def __init__(self, pb: PocketBase) -> None:
        self.pb = pb

    async def get_gaps(self, category: str, year: int) -> GapsResponse:
        """Classify gaps into three tiers. Stub for tests."""
        raise NotImplementedError

    async def search_canonicals(self, category: str, query: str, year: int) -> CanonicalSearchResponse:
        """Search canonical entries. Stub for tests."""
        raise NotImplementedError

    async def get_sources(self, category: str, canonical_name: str, year: int) -> SourcesResponse:
        """Get source variants for a canonical name. Stub for tests."""
        raise NotImplementedError

    async def list_overrides(self, category: str, year: int) -> list[OverrideResponse]:
        """List overrides. Stub for tests."""
        raise NotImplementedError

    async def create_override(self, data: OverrideCreate) -> OverrideResponse:
        """Create an override. Stub for tests."""
        raise NotImplementedError

    async def update_override(self, override_id: str, data: dict[str, Any]) -> OverrideResponse:
        """Update an override. Stub for tests."""
        raise NotImplementedError

    async def delete_override(self, override_id: str) -> None:
        """Delete an override. Stub for tests."""
        raise NotImplementedError
