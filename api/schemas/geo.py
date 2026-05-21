"""
Pydantic schemas for geo management API endpoints.

Defines response models for gap classification, canonical search,
source inspection, and override CRUD.
"""

from typing import Literal

from pydantic import BaseModel, Field

from api.constants.geo import GeoCategory


class GapItem(BaseModel):
    """A single gap entry (normalized value missing coordinates)."""

    name: str = Field(description="The normalized/canonical name")
    count: int = Field(description="Total camper count referencing this value")
    percentage: float = Field(description="Percentage of total gap campers")
    source_count: int = Field(default=0, description="Number of raw value variants that map to this")
    state_distribution: dict[str, int] = Field(
        default_factory=dict,
        description="Count of persons per state/country for this gap",
    )


class GapsResponse(BaseModel):
    """Three-tier gap classification response."""

    canonical_no_coords: list[GapItem] = Field(
        description="Known canonical entries (in static lookup) missing coordinates"
    )
    non_canonical_grouped: list[GapItem] = Field(
        description="Non-canonical entries with multiple source variants (discovered by clustering)"
    )
    non_canonical_ungrouped: list[GapItem] = Field(description="Single raw values that passed through unmatched")
    total_gaps: int = Field(description="Total number of distinct gap entries")


class CanonicalEntry(BaseModel):
    """A canonical entry with metadata."""

    canonical_name: str = Field(description="The canonical/normalized name")
    city: str = Field(default="", description="City from location data")
    state: str = Field(default="", description="State from location data")
    country: str = Field(default="", description="Country code (empty = US)")
    source: str = Field(default="", description="Data source: nces, simplemaps, curated, manual, suggested")
    has_coords: bool = Field(default=False, description="Whether coordinates are available")
    camper_count: int = Field(default=0, description="Number of campers referencing this value")


class CanonicalSearchResponse(BaseModel):
    """Response for canonical search endpoint."""

    results: list[CanonicalEntry] = Field(description="Matching canonical entries")


class SourceItem(BaseModel):
    """A raw value variant that maps to a canonical name."""

    original_value: str = Field(description="The original/raw value from source data")
    count: int = Field(description="Number of occurrences of this raw value")
    confidence: float = Field(description="Normalization confidence score (0.0-1.0)")
    state_distribution: dict[str, int] = Field(
        default_factory=dict,
        description="Count of persons per state/country for this source value",
    )


class SourcesResponse(BaseModel):
    """Response for source inspection endpoint."""

    canonical_name: str = Field(description="The canonical name being inspected")
    city: str = Field(default="", description="City from location data")
    state: str = Field(default="", description="State from location data")
    country: str = Field(default="", description="Country code (empty = US)")
    sources: list[SourceItem] = Field(description="Raw value variants sorted by count descending")


class OverrideCreate(BaseModel):
    """Request body for creating a geo override."""

    category: GeoCategory = Field(description="Category: city, school, or congregation")
    override_type: Literal["alias", "canonical", "merge"] = Field(
        description="Override type: alias, canonical, or merge"
    )
    raw_value: str | None = Field(default=None, description="Original raw value (for alias type)")
    canonical_name: str = Field(description="The canonical/normalized name")
    city: str | None = Field(default=None, description="City for location context")
    state: str | None = Field(default=None, description="State for location context")
    lat: float | None = Field(default=None, description="Latitude coordinate")
    lng: float | None = Field(default=None, description="Longitude coordinate")
    merged_into: str | None = Field(default=None, description="Target canonical name (for merge type)")
    notes: str | None = Field(default=None, description="Free-form notes")
    year: int = Field(description="Year scope")


class OverrideResponse(BaseModel):
    """Response model for a geo override record."""

    id: str = Field(description="PocketBase record ID")
    category: str = Field(description="Category: city, school, or congregation")
    override_type: Literal["alias", "canonical", "merge", "rejected"] = Field(
        description="Override type: alias, canonical, merge, or rejected"
    )
    raw_value: str | None = Field(default=None, description="Original raw value (for alias type)")
    canonical_name: str = Field(description="The canonical/normalized name")
    city: str | None = Field(default=None, description="City for location context")
    state: str | None = Field(default=None, description="State for location context")
    address_country: str | None = Field(default=None, description="Country code for location context")
    lat: float | None = Field(default=None, description="Latitude coordinate")
    lng: float | None = Field(default=None, description="Longitude coordinate")
    merged_into: str | None = Field(default=None, description="Target canonical name (for merge type)")
    notes: str | None = Field(default=None, description="Free-form notes")
    year: int = Field(description="Year scope")
    nominatim_status: str | None = Field(
        default=None, description="Nominatim lookup status: resolved, no_result, ambiguous"
    )


class MergeRequest(BaseModel):
    """Request body for merging one canonical into another."""

    target: str = Field(description="Target canonical name to merge into")
    category: GeoCategory = Field(description="Category: city, school, or congregation")
    year: int = Field(description="Year scope")


class MergeResponse(BaseModel):
    """Response for canonical merge operation."""

    merged_count: int = Field(description="Number of mappings reassigned")


class ApproveRequest(BaseModel):
    """Request body for approving a suggested canonical."""

    category: GeoCategory = Field(description="Category: city, school, or congregation")
    year: int = Field(description="Year scope")
    city: str = Field(default="", description="Confirmed city")
    state: str = Field(default="", description="Confirmed state")
    country: str = Field(default="", description="Confirmed country")


class RejectRequest(BaseModel):
    """Request body for rejecting a suggested canonical."""

    category: GeoCategory = Field(description="Category: city, school, or congregation")
    year: int = Field(description="Year scope")


class RejectResponse(BaseModel):
    """Response for rejecting a suggested canonical."""

    dissolved_count: int = Field(description="Number of mappings dissolved")


class BatchResolveResponse(BaseModel):
    """Response for batch coordinate resolution."""

    resolved: int
    skipped: int
    skipped_names: list[str]
    paused: bool = False
