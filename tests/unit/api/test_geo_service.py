"""
Unit tests for geo management service.

Tests verify:
- Gap classification into three tiers (canonical_no_coords, non_canonical_grouped, non_canonical_ungrouped)
- Canonical search with filtering and source badge detection
- Source inspection (original_value grouping)
- Override CRUD operations
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

if TYPE_CHECKING:
    from api.services.geo_service import GeoService

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"


# ============================================================================
# Fixtures
# ============================================================================


def _make_mapping_record(
    original_value: str,
    normalized_value: str,
    category: str = "school",
    occurrence_count: int = 1,
    confidence: float = 1.0,
    year: int = 2025,
) -> Mock:
    """Create a mock normalized_mappings record."""
    record = Mock()
    record.original_value = original_value
    record.normalized_value = normalized_value
    record.category = category
    record.occurrence_count = occurrence_count
    record.confidence = confidence
    record.year = year
    return record


def _make_override_record(
    id: str = "abc123",
    category: str = "school",
    override_type: str = "canonical",
    raw_value: str = "",
    canonical_name: str = "Riverside Elementary",
    city: str = "Springfield",
    state: str = "IL",
    lat: float | None = None,
    lng: float | None = None,
    merged_into: str = "",
    notes: str = "",
    year: int = 2025,
) -> Mock:
    """Create a mock geo_overrides record."""
    record = Mock()
    record.id = id
    record.category = category
    record.override_type = override_type
    record.raw_value = raw_value
    record.canonical_name = canonical_name
    record.city = city
    record.state = state
    record.lat = lat
    record.lng = lng
    record.merged_into = merged_into
    record.notes = notes
    record.year = year
    return record


# ============================================================================
# Gap Classification Tests
# ============================================================================


class TestGetGaps:
    """Test three-tier gap classification logic."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_canonical_no_coords_detected(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A normalized value that exists in the static lookup VALUES but has no coords
        should be classified as canonical_no_coords."""
        # Arrange: "Riverside Elementary" is in the lookup values but has no coords
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", occurrence_count=5),
            _make_mapping_record("Riverside Elementary", "Riverside Elementary", occurrence_count=10),
        ]
        mock_pb.collection.return_value.get_full_list.return_value = mappings

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            # lookup values contain "Riverside Elementary" (it IS canonical)
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            # but no coords for it
            mock_coords.return_value = {}
            mock_location.return_value = {}

            # Also mock override coords query (no overrides with coords)
            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,  # normalized_mappings query
                [],  # geo_overrides query
            ]

            result = await service.get_gaps("school", 2025)

        assert len(result.canonical_no_coords) == 1
        assert result.canonical_no_coords[0].name == "Riverside Elementary"
        assert result.canonical_no_coords[0].count == 15  # 5 + 10

    @pytest.mark.asyncio
    async def test_non_canonical_grouped_detected(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A normalized value NOT in the static lookup values but with multiple source variants
        should be classified as non_canonical_grouped."""
        # "Oakwood Academy" is not in the lookup but has multiple original values mapping to it
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy", occurrence_count=3),
            _make_mapping_record("Oakwood Acad.", "Oakwood Academy", occurrence_count=2),
            _make_mapping_record("The Oakwood Academy", "Oakwood Academy", occurrence_count=1),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}  # not in canonical lookup
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,  # normalized_mappings query
                [],  # geo_overrides query
            ]

            result = await service.get_gaps("school", 2025)

        assert len(result.non_canonical_grouped) == 1
        assert result.non_canonical_grouped[0].name == "Oakwood Academy"
        assert result.non_canonical_grouped[0].count == 6  # 3 + 2 + 1
        assert result.non_canonical_grouped[0].source_count == 3

    @pytest.mark.asyncio
    async def test_non_canonical_ungrouped_detected(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A single raw value that passed through unmatched with only one source
        should be classified as non_canonical_ungrouped."""
        mappings = [
            _make_mapping_record("Random School XYZ", "Random School XYZ", occurrence_count=2),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [],  # geo_overrides
            ]

            result = await service.get_gaps("school", 2025)

        assert len(result.non_canonical_ungrouped) == 1
        assert result.non_canonical_ungrouped[0].name == "Random School XYZ"
        assert result.non_canonical_ungrouped[0].count == 2
        assert result.non_canonical_ungrouped[0].source_count == 1

    @pytest.mark.asyncio
    async def test_values_with_coords_are_not_gaps(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Values that have coordinates in static data should not appear in gaps."""
        mappings = [
            _make_mapping_record("riverside elementary", "Riverside Elementary", occurrence_count=10),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            # This school HAS coords, so it's not a gap
            mock_coords.return_value = {"Riverside Elementary": [37.0, -122.0]}
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [],  # geo_overrides
            ]

            result = await service.get_gaps("school", 2025)

        assert len(result.canonical_no_coords) == 0
        assert len(result.non_canonical_grouped) == 0
        assert len(result.non_canonical_ungrouped) == 0
        assert result.total_gaps == 0

    @pytest.mark.asyncio
    async def test_override_coords_exclude_from_gaps(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Values that have coordinates from geo_overrides should not appear in gaps."""
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy", occurrence_count=5),
        ]
        override = _make_override_record(
            canonical_name="Oakwood Academy",
            override_type="canonical",
            lat=37.5,
            lng=-122.0,
        )

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [override],  # geo_overrides with coords
            ]

            result = await service.get_gaps("school", 2025)

        assert result.total_gaps == 0

    @pytest.mark.asyncio
    async def test_gaps_sorted_by_count_descending(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Each gap category should be sorted by count descending."""
        mappings = [
            _make_mapping_record("Small School", "Small School", occurrence_count=1),
            _make_mapping_record("Big School", "Big School", occurrence_count=10),
            _make_mapping_record("Medium School", "Medium School", occurrence_count=5),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [],
            ]

            result = await service.get_gaps("school", 2025)

        # All three are ungrouped (single source each)
        assert len(result.non_canonical_ungrouped) == 3
        assert result.non_canonical_ungrouped[0].name == "Big School"
        assert result.non_canonical_ungrouped[1].name == "Medium School"
        assert result.non_canonical_ungrouped[2].name == "Small School"

    @pytest.mark.asyncio
    async def test_mixed_gap_categories(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Test a mix of all three gap categories."""
        mappings = [
            # canonical_no_coords: in lookup values but no coords
            _make_mapping_record("riverside elem", "Riverside Elementary", occurrence_count=5),
            # non_canonical_grouped: not in lookup, multiple sources
            _make_mapping_record("oakwood academy", "Oakwood Academy", occurrence_count=3),
            _make_mapping_record("Oakwood Acad.", "Oakwood Academy", occurrence_count=2),
            # non_canonical_ungrouped: not in lookup, single source
            _make_mapping_record("Random Place", "Random Place", occurrence_count=1),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            mock_coords.return_value = {}  # no coords for any
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [],
            ]

            result = await service.get_gaps("school", 2025)

        assert len(result.canonical_no_coords) == 1
        assert result.canonical_no_coords[0].name == "Riverside Elementary"
        assert len(result.non_canonical_grouped) == 1
        assert result.non_canonical_grouped[0].name == "Oakwood Academy"
        assert len(result.non_canonical_ungrouped) == 1
        assert result.non_canonical_ungrouped[0].name == "Random Place"
        assert result.total_gaps == 3


# ============================================================================
# Canonical Search Tests
# ============================================================================


class TestSearchCanonicals:
    """Test canonical entry search with filtering and source badges."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_search_filters_by_query(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Search should filter canonical names by case-insensitive substring."""
        mappings = [
            _make_mapping_record("park day", "Park Day School", occurrence_count=5),
            _make_mapping_record("mark day", "Mark Day School", occurrence_count=3),
            _make_mapping_record("other school", "Other School", occurrence_count=1),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {
                "park day school": "Park Day School",
                "mark day school": "Mark Day School",
                "other school": "Other School",
            }
            mock_coords.return_value = {"Park Day School": [37.8, -122.2]}
            mock_location.return_value = {
                "Park Day School": {"city": "Oakland", "state": "CA"},
                "Mark Day School": {"city": "San Rafael", "state": "CA"},
            }

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,  # normalized_mappings
                [],  # geo_overrides
            ]

            result = await service.search_canonicals("school", "park", 2025)

        # Only "Park Day School" should match query "park"
        assert len(result.results) == 1
        assert result.results[0].canonical_name == "Park Day School"
        assert result.results[0].has_coords is True

    @pytest.mark.asyncio
    async def test_search_includes_location_metadata(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Search results should include city and state from location data."""
        mappings = [
            _make_mapping_record("park day", "Park Day School", occurrence_count=5),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"park day school": "Park Day School"}
            mock_coords.return_value = {"Park Day School": [37.8, -122.2]}
            mock_location.return_value = {"Park Day School": {"city": "Oakland", "state": "CA"}}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [],
            ]

            result = await service.search_canonicals("school", "park", 2025)

        assert result.results[0].city == "Oakland"
        assert result.results[0].state == "CA"

    @pytest.mark.asyncio
    async def test_search_source_badge_nces(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Schools from NCES lookup should have 'nces' source badge."""
        mappings = [
            _make_mapping_record("a school", "A School", occurrence_count=1),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
            patch("api.services.geo_service._get_source_badge") as mock_badge,
        ):
            mock_lookup.return_value = {"a school": "A School"}
            mock_coords.return_value = {}
            mock_location.return_value = {}
            mock_badge.return_value = "nces"

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                [],
            ]

            result = await service.search_canonicals("school", "school", 2025)

        assert result.results[0].source == "nces"

    @pytest.mark.asyncio
    async def test_search_includes_override_canonicals(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Override canonical entries should appear in search results."""
        override = _make_override_record(
            canonical_name="Custom School",
            override_type="canonical",
            city="Test City",
            state="CA",
            lat=37.0,
            lng=-122.0,
        )

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                [],  # normalized_mappings
                [override],  # geo_overrides
            ]

            result = await service.search_canonicals("school", "custom", 2025)

        assert len(result.results) == 1
        assert result.results[0].canonical_name == "Custom School"
        assert result.results[0].source == "manual"
        assert result.results[0].has_coords is True


# ============================================================================
# Source Inspection Tests
# ============================================================================


class TestGetSources:
    """Test source inspection (original_value grouping)."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_groups_by_original_value(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should group normalized_mappings by original_value with counts."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", occurrence_count=5, confidence=0.95),
            _make_mapping_record("Riverside Elementary", "Riverside Elementary", occurrence_count=10, confidence=1.0),
            _make_mapping_record(
                "riverside elementary school", "Riverside Elementary", occurrence_count=2, confidence=0.85
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_location.return_value = {"Riverside Elementary": {"city": "Springfield", "state": "IL"}}

            mock_pb.collection.return_value.get_full_list.return_value = mappings

            result = await service.get_sources("school", "Riverside Elementary", 2025)

        assert result.canonical_name == "Riverside Elementary"
        assert len(result.sources) == 3
        # Sort by count descending
        assert result.sources[0].original_value == "Riverside Elementary"
        assert result.sources[0].count == 10
        assert result.sources[0].confidence == 1.0
        assert result.sources[1].original_value == "riverside elem"
        assert result.sources[1].count == 5

    @pytest.mark.asyncio
    async def test_includes_city_state(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should include city and state from location data."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", occurrence_count=5),
        ]

        with (
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_location.return_value = {"Riverside Elementary": {"city": "Springfield", "state": "IL"}}
            mock_pb.collection.return_value.get_full_list.return_value = mappings

            result = await service.get_sources("school", "Riverside Elementary", 2025)

        assert result.city == "Springfield"
        assert result.state == "IL"


# ============================================================================
# Override CRUD Tests
# ============================================================================


class TestOverrideCRUD:
    """Test override create, read, update, delete operations."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_list_overrides(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should return overrides filtered by category and year."""
        overrides = [
            _make_override_record(id="o1", canonical_name="School A"),
            _make_override_record(id="o2", canonical_name="School B"),
        ]
        mock_pb.collection.return_value.get_full_list.return_value = overrides

        result = await service.list_overrides("school", 2025)

        assert len(result) == 2
        assert result[0].id == "o1"
        assert result[1].id == "o2"

    @pytest.mark.asyncio
    async def test_create_override(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should create a new override record in PocketBase."""
        created_record = _make_override_record(
            id="new1",
            canonical_name="New School",
            override_type="canonical",
            city="New City",
            state="CA",
        )
        mock_pb.collection.return_value.create.return_value = created_record

        from api.schemas.geo import OverrideCreate

        data = OverrideCreate(
            category="school",
            override_type="canonical",
            canonical_name="New School",
            city="New City",
            state="CA",
            year=2025,
        )

        result = await service.create_override(data)

        assert result.id == "new1"
        assert result.canonical_name == "New School"
        # Verify PB create was called
        mock_pb.collection.return_value.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_canonical_override_geocodes(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Creating a canonical override with city+state should attempt geocoding."""
        created_record = _make_override_record(
            id="geo1",
            canonical_name="Geocoded School",
            override_type="canonical",
            city="Oakland",
            state="CA",
            lat=37.8044,
            lng=-122.2712,
        )
        mock_pb.collection.return_value.create.return_value = created_record

        from api.schemas.geo import OverrideCreate

        data = OverrideCreate(
            category="school",
            override_type="canonical",
            canonical_name="Geocoded School",
            city="Oakland",
            state="CA",
            year=2025,
        )

        with patch("api.services.geo_service.geocode_location", new_callable=AsyncMock) as mock_geocode:
            mock_geocode.return_value = (37.8044, -122.2712)
            await service.create_override(data)

        # geocode_location should have been called
        mock_geocode.assert_called_once_with("Geocoded School", "Oakland", "CA")

    @pytest.mark.asyncio
    async def test_update_override(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should update an existing override record."""
        updated_record = _make_override_record(
            id="upd1",
            canonical_name="Updated School",
            notes="Updated note",
        )
        mock_pb.collection.return_value.update.return_value = updated_record

        result = await service.update_override("upd1", {"notes": "Updated note"})

        assert result.id == "upd1"
        mock_pb.collection.return_value.update.assert_called_once_with("upd1", {"notes": "Updated note"})

    @pytest.mark.asyncio
    async def test_delete_override(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should delete an override record."""
        mock_pb.collection.return_value.delete.return_value = None

        await service.delete_override("del1")

        mock_pb.collection.return_value.delete.assert_called_once_with("del1")


# ============================================================================
# Geocoding Tests
# ============================================================================


class TestGeocoding:
    """Test Nominatim geocoding helper."""

    @pytest.mark.asyncio
    async def test_geocode_returns_coordinates(self) -> None:
        """Successful geocoding should return (lat, lng) tuple."""
        from api.services.geo_service import geocode_location

        mock_response = Mock()
        mock_response.json.return_value = [{"lat": "37.8044", "lon": "-122.2712"}]

        with patch("api.services.geo_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get.return_value = mock_response
            mock_client_cls.return_value = mock_client

            result = await geocode_location("Some School", "Oakland", "CA")

        assert result == (37.8044, -122.2712)

    @pytest.mark.asyncio
    async def test_geocode_returns_none_on_no_results(self) -> None:
        """When Nominatim returns no results, should return None."""
        from api.services.geo_service import geocode_location

        mock_response = Mock()
        mock_response.json.return_value = []

        with patch("api.services.geo_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get.return_value = mock_response
            mock_client_cls.return_value = mock_client

            result = await geocode_location("Unknown Place", "Nowhere", "ZZ")

        assert result is None

    @pytest.mark.asyncio
    async def test_geocode_returns_none_on_error(self) -> None:
        """When Nominatim request fails, should return None gracefully."""
        from api.services.geo_service import geocode_location

        with patch("api.services.geo_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get.side_effect = Exception("Network error")
            mock_client_cls.return_value = mock_client

            result = await geocode_location("Some School", "Oakland", "CA")

        assert result is None
