"""
Unit tests for geo management service.

Tests verify:
- Gap classification into three tiers (canonical_no_coords, non_canonical_grouped, non_canonical_ungrouped)
- Canonical search with filtering and source badge detection
- Source inspection (original_value grouping)
- Override CRUD operations
- Country field on canonical entries and source responses
- State distribution on source items and gap items
- Suggested source badge for non-lookup canonicals
- Location inference from mapping address fields
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

if TYPE_CHECKING:
    from api.services.geo_service import GeoService


# Reset the module-level _PERSON_ID_CACHE before every test in this file so
# cached results from one test don't bleed into another's call-count assertions.
@pytest.fixture(autouse=True)
def _reset_geo_module_cache() -> None:
    from api.services.geo_service import clear_person_id_cache

    clear_person_id_cache()


# ============================================================================
# Fixtures
# ============================================================================


def _make_mapping_record(
    original_value: str,
    normalized_value: str,
    category: str = "school",
    confidence: float = 1.0,
    year: int = 2025,
    person: str = "",
    address_city: str = "",
    address_state: str = "",
    address_country: str = "",
) -> Mock:
    """Create a mock normalized_mappings record."""
    record = Mock()
    record.original_value = original_value
    record.normalized_value = normalized_value
    record.category = category
    record.confidence = confidence
    record.year = year
    record.person = person
    record.address_city = address_city
    record.address_state = address_state
    record.address_country = address_country
    return record


def _make_attendee_record(
    person: str,
    status_id: int = 2,
    year: int = 2025,
) -> Mock:
    """Create a mock attendees record."""
    record = Mock()
    record.person = person
    record.status_id = status_id
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
    address_country: str = "",
    lat: float | None = None,
    lng: float | None = None,
    merged_into: str = "",
    notes: str = "",
    year: int = 2025,
    nominatim_status: str = "",
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
    record.address_country = address_country
    record.lat = lat
    record.lng = lng
    record.merged_into = merged_into
    record.notes = notes
    record.year = year
    record.nominatim_status = nominatim_status
    return record


def _make_session_record(
    cm_id: int,
    start_date: str = "2025-06-15",
    end_date: str = "2025-06-22",
    session_type: str = "main",
    year: int = 2025,
) -> Mock:
    """Create a mock sessions record for duration resolution."""
    record = Mock()
    record.cm_id = cm_id
    record.start_date = start_date
    record.end_date = end_date
    record.session_type = session_type
    record.year = year
    return record


def _route_collections(collection_data: dict[str, list[Mock]]) -> Any:
    """Create a mock_pb.collection side_effect that routes by collection name."""

    def collection_router(name: str) -> MagicMock:
        mock = MagicMock()
        mock.get_full_list.return_value = collection_data.get(name, [])
        return mock

    return collection_router


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
            _make_mapping_record("riverside elem", "Riverside Elementary"),
            _make_mapping_record("Riverside Elementary", "Riverside Elementary"),
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
            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert len(result.canonical_no_coords) == 1
        assert result.canonical_no_coords[0].name == "Riverside Elementary"
        assert result.canonical_no_coords[0].count == 2

    @pytest.mark.asyncio
    async def test_non_canonical_grouped_detected(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A normalized value NOT in the static lookup values but with multiple source variants
        should be classified as non_canonical_grouped."""
        # "Oakwood Academy" is not in the lookup but has multiple original values mapping to it
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy"),
            _make_mapping_record("Oakwood Acad.", "Oakwood Academy"),
            _make_mapping_record("The Oakwood Academy", "Oakwood Academy"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}  # not in canonical lookup
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert len(result.non_canonical_grouped) == 1
        assert result.non_canonical_grouped[0].name == "Oakwood Academy"
        assert result.non_canonical_grouped[0].count == 3
        assert result.non_canonical_grouped[0].source_count == 3

    @pytest.mark.asyncio
    async def test_non_canonical_ungrouped_detected(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A single raw value that passed through unmatched with only one source
        should be classified as non_canonical_ungrouped."""
        mappings = [
            _make_mapping_record("Random School XYZ", "Random School XYZ"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert len(result.non_canonical_ungrouped) == 1
        assert result.non_canonical_ungrouped[0].name == "Random School XYZ"
        assert result.non_canonical_ungrouped[0].count == 1
        assert result.non_canonical_ungrouped[0].source_count == 1

    @pytest.mark.asyncio
    async def test_values_with_coords_are_not_gaps(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Values that have coordinates in static data should not appear in gaps."""
        mappings = [
            _make_mapping_record("riverside elementary", "Riverside Elementary"),
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

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert len(result.canonical_no_coords) == 0
        assert len(result.non_canonical_grouped) == 0
        assert len(result.non_canonical_ungrouped) == 0
        assert result.total_gaps == 0

    @pytest.mark.asyncio
    async def test_override_coords_exclude_from_gaps(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Values that have coordinates from geo_overrides should not appear in gaps."""
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy"),
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

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [override],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert result.total_gaps == 0

    @pytest.mark.asyncio
    async def test_gaps_sorted_by_count_descending(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Each gap category should be sorted by count descending."""
        mappings = [
            _make_mapping_record("Small School", "Small School"),
            _make_mapping_record("Big School", "Big School"),
            _make_mapping_record("Big School 2", "Big School"),
            _make_mapping_record("Big School 3", "Big School"),
            _make_mapping_record("Medium School", "Medium School"),
            _make_mapping_record("Medium 2", "Medium School"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        # Big School (3 sources) and Medium School (2 sources) are non_canonical_grouped
        # Small School (1 source) is non_canonical_ungrouped
        assert len(result.non_canonical_grouped) == 2
        assert result.non_canonical_grouped[0].name == "Big School"
        assert result.non_canonical_grouped[0].count == 3
        assert result.non_canonical_grouped[1].name == "Medium School"
        assert result.non_canonical_grouped[1].count == 2
        assert len(result.non_canonical_ungrouped) == 1
        assert result.non_canonical_ungrouped[0].name == "Small School"
        assert result.non_canonical_ungrouped[0].count == 1

    @pytest.mark.asyncio
    async def test_mixed_gap_categories(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Test a mix of all three gap categories."""
        mappings = [
            # canonical_no_coords: in lookup values but no coords
            _make_mapping_record("riverside elem", "Riverside Elementary"),
            # non_canonical_grouped: not in lookup, multiple sources
            _make_mapping_record("oakwood academy", "Oakwood Academy"),
            _make_mapping_record("Oakwood Acad.", "Oakwood Academy"),
            # non_canonical_ungrouped: not in lookup, single source
            _make_mapping_record("Random Place", "Random Place"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            mock_coords.return_value = {}  # no coords for any
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert len(result.canonical_no_coords) == 1
        assert result.canonical_no_coords[0].name == "Riverside Elementary"
        assert len(result.non_canonical_grouped) == 1
        assert result.non_canonical_grouped[0].name == "Oakwood Academy"
        assert len(result.non_canonical_ungrouped) == 1
        assert result.non_canonical_ungrouped[0].name == "Random Place"
        assert result.total_gaps == 3

    @pytest.mark.asyncio
    async def test_prior_year_override_suppresses_gap(self, service: GeoService, mock_pb: MagicMock) -> None:
        """An override with coords from a prior year should suppress the gap in the current year."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", year=2026),
        ]
        overrides = [
            _make_override_record(
                canonical_name="Riverside Elementary",
                lat=37.5,
                lng=-122.0,
                year=2025,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": overrides,
                }
            )

            result = await service.get_gaps("school", 2026)

        assert result.total_gaps == 0
        assert len(result.canonical_no_coords) == 0


# ============================================================================
# Active-Only Filtering Tests
# ============================================================================


class TestActiveOnlyFiltering:
    """Test active_only filtering and person deduplication."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_active_only_excludes_inactive_persons(self, service: GeoService, mock_pb: MagicMock) -> None:
        """With active_only=True, mappings for non-active persons should be excluded."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
            _make_mapping_record("riverside elementary", "Riverside Elementary", person="p2"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p3"),  # inactive
        ]
        attendees = [
            _make_attendee_record("p1"),
            _make_attendee_record("p2"),
            # p3 is not in active attendees
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "attendees": attendees,
                }
            )

            result = await service.get_gaps("school", 2025, active_only=True)

        # Only 2 mappings (p1, p2) should be counted, not p3
        # 2 different original values → non_canonical_grouped
        assert result.non_canonical_grouped[0].count == 2

    @pytest.mark.asyncio
    async def test_active_only_deduplicates_by_person(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Same person in 2 sessions with same normalized_value should count as 1."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),  # same person, diff session
        ]
        attendees = [
            _make_attendee_record("p1"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "attendees": attendees,
                }
            )

            result = await service.get_gaps("school", 2025, active_only=True)

        # Dedup: same person + same normalized_value = 1
        assert result.non_canonical_ungrouped[0].count == 1

    @pytest.mark.asyncio
    async def test_active_only_false_returns_all(self, service: GeoService, mock_pb: MagicMock) -> None:
        """With active_only=False, all mappings are returned (current behavior)."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p2"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p3"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025, active_only=False)

        # All 3 should be counted (no attendee filtering)
        assert result.non_canonical_ungrouped[0].count == 3

    @pytest.mark.asyncio
    async def test_session_types_filters_attendees(self, service: GeoService, mock_pb: MagicMock) -> None:
        """When session_types is provided, attendee query should include session type filter."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p2"),
        ]
        attendees = [
            _make_attendee_record("p1"),  # only main session attendee
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "attendees": attendees,
                }
            )

            result = await service.get_gaps("school", 2025, active_only=True, session_types=["main"])

        # Only p1 is an active attendee in "main" sessions
        assert result.non_canonical_ungrouped[0].count == 1

    @pytest.mark.asyncio
    async def test_search_canonicals_active_only(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Camper counts should reflect only active persons when active_only=True."""
        mappings = [
            _make_mapping_record("park day", "Park Day School", person="p1"),
            _make_mapping_record("park day", "Park Day School", person="p2"),
            _make_mapping_record("park day", "Park Day School", person="p3"),  # inactive
        ]
        attendees = [
            _make_attendee_record("p1"),
            _make_attendee_record("p2"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"park day school": "Park Day School"}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "attendees": attendees,
                }
            )

            result = await service.search_canonicals("school", "park", 2025, active_only=True)

        assert result.results[0].camper_count == 2  # p1, p2 only

    @pytest.mark.asyncio
    async def test_get_sources_active_only(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Source counts should reflect only active persons, deduped."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95, person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.93, person="p2"),
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95, person="p3"),  # inactive
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95, person="p1"),  # dup
        ]
        attendees = [
            _make_attendee_record("p1"),
            _make_attendee_record("p2"),
        ]

        with (
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                attendees,
            ]

            result = await service.get_sources("school", "Riverside Elementary", 2025, active_only=True)

        # p1 and p2 only, deduped: p1 appears twice but same person+normalized_value
        assert result.sources[0].count == 2  # p1 + p2


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
            _make_mapping_record("park day", "Park Day School"),
            _make_mapping_record("mark day", "Mark Day School"),
            _make_mapping_record("other school", "Other School"),
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

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.search_canonicals("school", "park", 2025)

        # Only "Park Day School" should match query "park"
        assert len(result.results) == 1
        assert result.results[0].canonical_name == "Park Day School"
        assert result.results[0].has_coords is True

    @pytest.mark.asyncio
    async def test_search_includes_location_metadata(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Search results should include city and state from location data."""
        mappings = [
            _make_mapping_record("park day", "Park Day School"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"park day school": "Park Day School"}
            mock_coords.return_value = {"Park Day School": [37.8, -122.2]}
            mock_location.return_value = {"Park Day School": {"city": "Oakland", "state": "CA"}}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.search_canonicals("school", "park", 2025)

        assert result.results[0].city == "Oakland"
        assert result.results[0].state == "CA"

    @pytest.mark.asyncio
    async def test_search_source_badge_nces(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Schools from NCES lookup should have 'nces' source badge."""
        mappings = [
            _make_mapping_record("a school", "A School"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"a school": "A School"}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

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

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": [override],
                }
            )

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
        """Should group normalized_mappings by original_value with row counts."""
        mappings = [
            # 3 persons typed "riverside elem"
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95),
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.93),
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95),
            # 2 persons typed exact name
            _make_mapping_record("Riverside Elementary", "Riverside Elementary", confidence=1.0),
            _make_mapping_record("Riverside Elementary", "Riverside Elementary", confidence=1.0),
            # 1 person typed long form
            _make_mapping_record("riverside elementary school", "Riverside Elementary", confidence=0.85),
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
        assert result.sources[0].original_value == "riverside elem"
        assert result.sources[0].count == 3
        assert result.sources[0].confidence == 0.93  # min confidence
        assert result.sources[1].original_value == "Riverside Elementary"
        assert result.sources[1].count == 2
        assert result.sources[2].original_value == "riverside elementary school"
        assert result.sources[2].count == 1

    @pytest.mark.asyncio
    async def test_includes_city_state(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Should include city and state from location data."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary"),
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


# ============================================================================
# Batch Resolve Coords Tests
# ============================================================================


class TestBatchResolveCoords:
    """Tests for batch_resolve_coords service method."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_resolves_unambiguous_entry(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Unambiguous canonical missing coords gets resolved via Nominatim."""
        mapping = _make_mapping_record("Mark Day School", "Mark Day School", "school", confidence=1.0, year=2025)
        mock_pb.collection.return_value.get_full_list.side_effect = [
            [mapping],  # normalized_mappings
            [],  # existing overrides
        ]

        with (
            patch("api.services.geo_service._load_static_coords", return_value={}),
            patch(
                "api.services.geo_service._load_static_location",
                return_value={"Mark Day School": {"city": "San Rafael", "state": "CA"}},
            ),
            patch(
                "api.services.geo_service._load_static_lookup",
                return_value={"mark day school": "Mark Day School"},
            ),
            patch.object(service, "_check_name_ambiguity", return_value=False, create=True),
            patch(
                "api.services.geo_service.geocode_location",
                new_callable=AsyncMock,
                return_value=(37.96, -122.535),
            ),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            result = await service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 1
        assert result["skipped"] == 0
        assert len(result["skipped_names"]) == 0

    @pytest.mark.asyncio
    async def test_skips_ambiguous_entry(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Ambiguous canonical (same name in multiple cities) gets skipped."""
        mapping = _make_mapping_record("Lincoln Elementary", "Lincoln Elementary", "school", confidence=1.0, year=2025)
        mock_pb.collection.return_value.get_full_list.side_effect = [
            [mapping],
            [],  # no existing overrides
        ]

        with (
            patch("api.services.geo_service._load_static_coords", return_value={}),
            patch(
                "api.services.geo_service._load_static_location",
                return_value={"Lincoln Elementary": {"city": "Oakland", "state": "CA"}},
            ),
            patch(
                "api.services.geo_service._load_static_lookup",
                return_value={"lincoln elementary": "Lincoln Elementary"},
            ),
            patch.object(service, "_check_name_ambiguity", return_value=True, create=True),
        ):
            result = await service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 0
        assert result["skipped"] == 1
        assert "Lincoln Elementary" in result["skipped_names"]

    @pytest.mark.asyncio
    async def test_skips_previously_checked(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Entries with existing nominatim_status override get skipped."""
        mapping = _make_mapping_record("Oak Valley Middle", "Oak Valley Middle", "school", confidence=1.0, year=2025)
        existing_override = _make_override_record(
            category="school",
            canonical_name="Oak Valley Middle",
            override_type="canonical",
            nominatim_status="no_result",
            year=2025,
        )
        mock_pb.collection.return_value.get_full_list.side_effect = [
            [mapping],
            [existing_override],  # has nominatim_status
        ]

        with (
            patch("api.services.geo_service._load_static_coords", return_value={}),
            patch("api.services.geo_service._load_static_location", return_value={}),
            patch(
                "api.services.geo_service._load_static_lookup",
                return_value={"oak valley middle": "Oak Valley Middle"},
            ),
        ):
            result = await service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 0
        assert result["skipped"] == 0  # not counted as skipped, just filtered out

    @pytest.mark.asyncio
    async def test_nominatim_failure_sets_no_result(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Nominatim returning no results sets nominatim_status='no_result'."""
        mapping = _make_mapping_record("Fictional Academy", "Fictional Academy", "school", confidence=1.0, year=2025)
        mock_pb.collection.return_value.get_full_list.side_effect = [
            [mapping],
            [],
        ]

        with (
            patch("api.services.geo_service._load_static_coords", return_value={}),
            patch(
                "api.services.geo_service._load_static_location",
                return_value={"Fictional Academy": {"city": "Nowhereville", "state": "CA"}},
            ),
            patch(
                "api.services.geo_service._load_static_lookup",
                return_value={"fictional academy": "Fictional Academy"},
            ),
            patch.object(service, "_check_name_ambiguity", return_value=False, create=True),
            patch(
                "api.services.geo_service.geocode_location",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            result = await service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 0
        assert result["skipped"] == 1

    @pytest.mark.asyncio
    async def test_returns_summary_counts(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Response includes resolved, skipped, skipped_names, and paused."""
        mock_pb.collection.return_value.get_full_list.side_effect = [[], []]

        with (
            patch("api.services.geo_service._load_static_coords", return_value={}),
            patch("api.services.geo_service._load_static_location", return_value={}),
            patch("api.services.geo_service._load_static_lookup", return_value={}),
        ):
            result = await service.batch_resolve_coords("school", 2025)

        assert "resolved" in result
        assert "skipped" in result
        assert "skipped_names" in result
        assert "paused" in result


# ============================================================================
# Person ID Cache Tests
# ============================================================================


class TestPersonIdCache:
    """Test TTL caching of active person IDs (module-level cache)."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_second_call_uses_cache(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Second call with same params should return cached result, not hit PB again."""
        attendees = [_make_attendee_record("p1"), _make_attendee_record("p2")]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        result1 = await service._fetch_active_person_pb_ids(2025)
        result2 = await service._fetch_active_person_pb_ids(2025)

        assert result1 == result2 == {"p1", "p2"}
        # PB should only be called once
        assert mock_pb.collection.return_value.get_full_list.call_count == 1

    @pytest.mark.asyncio
    async def test_different_params_bypass_cache(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Different year should not share cache."""
        attendees_2025 = [_make_attendee_record("p1")]
        attendees_2024 = [_make_attendee_record("p2")]
        mock_pb.collection.return_value.get_full_list.side_effect = [attendees_2025, attendees_2024]

        result1 = await service._fetch_active_person_pb_ids(2025)
        result2 = await service._fetch_active_person_pb_ids(2024)

        assert result1 == {"p1"}
        assert result2 == {"p2"}
        assert mock_pb.collection.return_value.get_full_list.call_count == 2

    @pytest.mark.asyncio
    async def test_cache_expires_after_ttl(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Cache should expire after TTL seconds."""
        from api.services.geo_service import _PERSON_ID_CACHE

        attendees = [_make_attendee_record("p1")]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        await service._fetch_active_person_pb_ids(2025)

        # Manually expire the cache by setting timestamp to 0
        for key in _PERSON_ID_CACHE:
            _PERSON_ID_CACHE[key] = (_PERSON_ID_CACHE[key][0], 0.0)

        await service._fetch_active_person_pb_ids(2025)
        assert mock_pb.collection.return_value.get_full_list.call_count == 2

    @pytest.mark.asyncio
    async def test_cache_shared_across_service_instances(self, mock_pb: MagicMock) -> None:
        """Cache is module-level: a second GeoService instance hits the same cache."""
        from api.services.geo_service import GeoService

        attendees = [_make_attendee_record("p1")]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        service_a = GeoService(mock_pb)
        service_b = GeoService(mock_pb)

        result_a = await service_a._fetch_active_person_pb_ids(2025)
        result_b = await service_b._fetch_active_person_pb_ids(2025)

        assert result_a == result_b == {"p1"}
        # Only one PB call total — the second instance reused the cache populated by the first
        assert mock_pb.collection.return_value.get_full_list.call_count == 1

    @pytest.mark.asyncio
    async def test_clear_person_id_cache_empties_cache(self, service: GeoService, mock_pb: MagicMock) -> None:
        """clear_person_id_cache() forces the next call to refetch from PB."""
        from api.services.geo_service import clear_person_id_cache

        attendees = [_make_attendee_record("p1")]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        await service._fetch_active_person_pb_ids(2025)
        clear_person_id_cache()
        await service._fetch_active_person_pb_ids(2025)

        assert mock_pb.collection.return_value.get_full_list.call_count == 2

    def test_ttl_is_fifteen_minutes(self) -> None:
        """TTL is bumped to 15 minutes (900s) — matches graph_cache."""
        from api.services.geo_service import _PERSON_ID_CACHE_TTL_SECONDS

        assert _PERSON_ID_CACHE_TTL_SECONDS == 900


# ============================================================================
# Schema Country & State Distribution Tests
# ============================================================================


class TestSchemaCountryAndStateDistribution:
    """Test that schemas include country and state_distribution fields."""

    def test_canonical_entry_has_country_field(self) -> None:
        """CanonicalEntry should have a country field defaulting to empty string."""
        from api.schemas.geo import CanonicalEntry

        entry = CanonicalEntry(canonical_name="Riverside Elementary")
        assert entry.country == ""

    def test_canonical_entry_country_can_be_set(self) -> None:
        """CanonicalEntry country field can be set to a country code."""
        from api.schemas.geo import CanonicalEntry

        entry = CanonicalEntry(canonical_name="Tokyo International School", country="JP")
        assert entry.country == "JP"

    def test_source_item_has_state_distribution_field(self) -> None:
        """SourceItem should have a state_distribution field defaulting to empty dict."""
        from api.schemas.geo import SourceItem

        item = SourceItem(original_value="riverside elem", count=3, confidence=0.95)
        assert item.state_distribution == {}

    def test_source_item_state_distribution_can_be_set(self) -> None:
        """SourceItem state_distribution field can be populated."""
        from api.schemas.geo import SourceItem

        item = SourceItem(
            original_value="riverside elem",
            count=5,
            confidence=0.95,
            state_distribution={"CA": 3, "OR": 2},
        )
        assert item.state_distribution == {"CA": 3, "OR": 2}

    def test_sources_response_has_country_field(self) -> None:
        """SourcesResponse should have a country field defaulting to empty string."""
        from api.schemas.geo import SourcesResponse

        resp = SourcesResponse(canonical_name="Riverside Elementary", sources=[])
        assert resp.country == ""

    def test_gap_item_has_state_distribution_field(self) -> None:
        """GapItem should have a state_distribution field defaulting to empty dict."""
        from api.schemas.geo import GapItem

        item = GapItem(name="Unknown School", count=5, percentage=10.0)
        assert item.state_distribution == {}

    def test_gap_item_state_distribution_can_be_set(self) -> None:
        """GapItem state_distribution field can be populated."""
        from api.schemas.geo import GapItem

        item = GapItem(
            name="Unknown School",
            count=5,
            percentage=10.0,
            state_distribution={"CA": 3, "NY": 2},
        )
        assert item.state_distribution == {"CA": 3, "NY": 2}


# ============================================================================
# Suggested Canonical & Inferred Location Tests
# ============================================================================


class TestSuggestedCanonicalTier:
    """Test suggested source badge and location inference for non-lookup canonicals."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_non_lookup_canonical_gets_suggested_source(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Non-lookup canonical entries with camper data should have source='suggested'."""
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy", address_state="CA"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}  # Oakwood Academy is NOT in the static lookup
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.search_canonicals("school", "oakwood", 2025)

        assert len(result.results) == 1
        assert result.results[0].source == "suggested"

    @pytest.mark.asyncio
    async def test_suggested_canonical_infers_state_from_mappings(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """Suggested canonicals should infer state from majority of mapping address_state values."""
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy", address_state="CA", address_country="US"),
            _make_mapping_record("oakwood acad", "Oakwood Academy", address_state="CA", address_country="US"),
            _make_mapping_record("the oakwood academy", "Oakwood Academy", address_state="OR", address_country="US"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.search_canonicals("school", "oakwood", 2025)

        assert len(result.results) == 1
        # CA appears 2 times vs OR 1 time → majority is CA
        assert result.results[0].state == "CA"

    @pytest.mark.asyncio
    async def test_suggested_canonical_infers_country(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Suggested canonicals should infer country from majority of mapping address_country values."""
        mappings = [
            _make_mapping_record(
                "tokyo intl school", "Tokyo International School", address_state="", address_country="JP"
            ),
            _make_mapping_record(
                "tokyo international", "Tokyo International School", address_state="", address_country="JP"
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.search_canonicals("school", "tokyo", 2025)

        assert len(result.results) == 1
        assert result.results[0].country == "JP"

    @pytest.mark.asyncio
    async def test_lookup_canonical_keeps_original_source_badge(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Canonical entries from static lookup should keep their original source badge, not 'suggested'."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", address_state="IL"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            mock_coords.return_value = {}
            mock_location.return_value = {"Riverside Elementary": {"city": "Springfield", "state": "IL"}}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.search_canonicals("school", "riverside", 2025)

        assert len(result.results) == 1
        assert result.results[0].source == "nces"  # not "suggested"


# ============================================================================
# _infer_location_from_mappings Tests
# ============================================================================


class TestInferLocationFromMappings:
    """Test the static helper that infers city/state/country from mapping address fields."""

    def test_infers_majority_state(self) -> None:
        """Should return the state that appears most frequently."""
        from api.services.geo_service import GeoService

        mappings = [
            _make_mapping_record("a", "School A", address_state="CA", address_country="US"),
            _make_mapping_record("b", "School A", address_state="CA", address_country="US"),
            _make_mapping_record("c", "School A", address_state="OR", address_country="US"),
        ]
        result = GeoService._infer_location_from_mappings(mappings, "School A")
        assert result.get("state") == "CA"

    def test_infers_majority_country(self) -> None:
        """Should return the country that appears most frequently."""
        from api.services.geo_service import GeoService

        mappings = [
            _make_mapping_record("a", "School A", address_state="", address_country="JP"),
            _make_mapping_record("b", "School A", address_state="", address_country="JP"),
            _make_mapping_record("c", "School A", address_state="", address_country="US"),
        ]
        result = GeoService._infer_location_from_mappings(mappings, "School A")
        assert result.get("country") == "JP"


# ============================================================================
# Duration Filtering Without active_only Tests
# ============================================================================


class TestDurationFilteringWithoutActiveOnly:
    """Test that duration filtering works even when active_only=False.

    The duration parameter should filter to attendees in matching sessions
    regardless of the active_only flag. active_only controls the active enrollee
    filter; duration controls WHICH sessions to include. These are orthogonal.
    """

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_get_gaps_duration_without_active_only(self, service: GeoService, mock_pb: MagicMock) -> None:
        """get_gaps with duration but active_only=False should still filter by duration sessions."""
        # p1 is in a 1-week session, p2 is in a 2-week session
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p2"),
            _make_mapping_record("oak valley middle", "Oak Valley Middle", person="p2"),
        ]
        # 1-week session (7 days) and 2-week session (14 days)
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-21"),  # 1-week (7 days)
            _make_session_record(cm_id=1002, start_date="2025-06-15", end_date="2025-06-28"),  # 2-week (14 days)
        ]
        # Only p1 attends 1-week session 1001; p2 is only in the 2-week session
        # (mock returns all attendees regardless of filter, so we only include
        # attendees who would match the duration-filtered query)
        attendees = [
            _make_attendee_record("p1"),  # in 1-week session only
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "camp_sessions": sessions,
                    "attendees": attendees,
                }
            )

            # Request 1-week duration, active_only=False
            result = await service.get_gaps("school", 2025, active_only=False, duration="1-week")

        # Only p1 is in a 1-week session, so only Riverside Elementary should appear
        all_gap_names = [g.name for g in result.non_canonical_ungrouped + result.non_canonical_grouped]
        assert "Riverside Elementary" in all_gap_names
        # Oak Valley Middle (p2 only, 2-week session) should be excluded
        assert "Oak Valley Middle" not in all_gap_names

    @pytest.mark.asyncio
    async def test_search_canonicals_duration_without_active_only(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """search_canonicals with duration but active_only=False should filter by duration sessions."""
        mappings = [
            _make_mapping_record("park day", "Park Day School", person="p1"),
            _make_mapping_record("park day", "Park Day School", person="p2"),
            _make_mapping_record("park day", "Park Day School", person="p3"),
        ]
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-21"),  # 1-week (7 days)
            _make_session_record(cm_id=1002, start_date="2025-06-15", end_date="2025-06-28"),  # 2-week (14 days)
        ]
        # Only p1 and p2 are in 1-week sessions
        attendees = [
            _make_attendee_record("p1"),
            _make_attendee_record("p2"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {"park day school": "Park Day School"}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "camp_sessions": sessions,
                    "attendees": attendees,
                }
            )

            result = await service.search_canonicals("school", "park", 2025, active_only=False, duration="1-week")

        # Only p1 and p2 are in 1-week sessions, so camper_count should be 2
        assert result.results[0].camper_count == 2

    @pytest.mark.asyncio
    async def test_get_sources_duration_without_active_only(self, service: GeoService, mock_pb: MagicMock) -> None:
        """get_sources with duration but active_only=False should filter by duration sessions."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95, person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.93, person="p2"),
            _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.90, person="p3"),
        ]
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-21"),  # 1-week (7 days)
            _make_session_record(cm_id=1002, start_date="2025-06-15", end_date="2025-06-28"),  # 2-week (14 days)
        ]
        # Only p1 and p2 are in 1-week sessions
        attendees = [
            _make_attendee_record("p1"),
            _make_attendee_record("p2"),
        ]

        with patch("api.services.geo_service._load_static_location") as mock_location:
            mock_location.return_value = {}

            mock_pb.collection.return_value.get_full_list.side_effect = [
                mappings,
                sessions,
                attendees,
            ]

            result = await service.get_sources(
                "school", "Riverside Elementary", 2025, active_only=False, duration="1-week"
            )

        # Only p1 and p2 are in 1-week sessions
        assert result.sources[0].count == 2

    @pytest.mark.asyncio
    async def test_duration_no_matching_sessions_returns_empty(self, service: GeoService, mock_pb: MagicMock) -> None:
        """When duration matches no sessions, all data should be filtered out."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
        ]
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-28"),  # 2-week only (14 days)
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                    "camp_sessions": sessions,
                    "attendees": [],
                }
            )

            # Request 1-week but only 2-week sessions exist
            result = await service.get_gaps("school", 2025, active_only=False, duration="1-week")

        assert result.total_gaps == 0

    @pytest.mark.asyncio
    async def test_no_duration_without_active_only_returns_all(self, service: GeoService, mock_pb: MagicMock) -> None:
        """When neither active_only nor duration is set, all mappings should be returned unfiltered."""
        mappings = [
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p1"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p2"),
            _make_mapping_record("riverside elem", "Riverside Elementary", person="p3"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025, active_only=False)

        # All 3 should be counted
        assert result.non_canonical_ungrouped[0].count == 3


class TestDurationFilteringRespectsSessionTypes:
    """Test that _fetch_duration_person_pb_ids respects session_types.

    When session_types=["main"] and duration="1-week", only main-type sessions
    of that duration should be included in the attendee query filter.
    """

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_duration_helper_excludes_non_matching_session_types(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """_fetch_duration_person_pb_ids with session_types should exclude other types."""
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-21", session_type="main"),
            _make_session_record(cm_id=1002, start_date="2025-06-15", end_date="2025-06-21", session_type="quest"),
        ]
        attendees = [_make_attendee_record("p1")]

        call_filters: list[str] = []

        def collection_router(name: str) -> MagicMock:
            mock_coll = MagicMock()
            if name == "camp_sessions":
                mock_coll.get_full_list.return_value = sessions
            elif name == "attendees":

                def capture_attendees(**kwargs: Any) -> list[Mock]:
                    call_filters.append(kwargs.get("query_params", {}).get("filter", ""))
                    return attendees

                mock_coll.get_full_list.side_effect = capture_attendees
            else:
                mock_coll.get_full_list.return_value = []
            return mock_coll

        mock_pb.collection.side_effect = collection_router

        await service._fetch_duration_person_pb_ids(2025, "1-week", session_types=["main"])

        # The attendee filter should only include session 1001 (main), not 1002 (quest)
        assert len(call_filters) == 1
        assert "1001" in call_filters[0]
        assert "1002" not in call_filters[0]

    @pytest.mark.asyncio
    async def test_duration_helper_without_session_types_includes_all(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """_fetch_duration_person_pb_ids without session_types should include all matching sessions."""
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-21", session_type="main"),
            _make_session_record(cm_id=1002, start_date="2025-06-15", end_date="2025-06-21", session_type="quest"),
        ]
        attendees = [_make_attendee_record("p1"), _make_attendee_record("p2")]

        call_filters: list[str] = []

        def collection_router(name: str) -> MagicMock:
            mock_coll = MagicMock()
            if name == "camp_sessions":
                mock_coll.get_full_list.return_value = sessions
            elif name == "attendees":

                def capture_attendees(**kwargs: Any) -> list[Mock]:
                    call_filters.append(kwargs.get("query_params", {}).get("filter", ""))
                    return attendees

                mock_coll.get_full_list.side_effect = capture_attendees
            else:
                mock_coll.get_full_list.return_value = []
            return mock_coll

        mock_pb.collection.side_effect = collection_router

        await service._fetch_duration_person_pb_ids(2025, "1-week")

        # Both sessions should be in the filter
        assert len(call_filters) == 1
        assert "1001" in call_filters[0]
        assert "1002" in call_filters[0]

    @pytest.mark.asyncio
    async def test_duration_helper_filters_by_session_cm_id(self, service: GeoService, mock_pb: MagicMock) -> None:
        """_fetch_duration_person_pb_ids with session_cm_id should filter to that session only."""
        sessions = [
            _make_session_record(cm_id=1001, start_date="2025-06-15", end_date="2025-06-21", session_type="main"),
            _make_session_record(cm_id=1002, start_date="2025-06-15", end_date="2025-06-21", session_type="main"),
        ]
        attendees = [_make_attendee_record("p1")]

        call_filters: list[str] = []

        def collection_router(name: str) -> MagicMock:
            mock_coll = MagicMock()
            if name == "camp_sessions":
                mock_coll.get_full_list.return_value = sessions
            elif name == "attendees":

                def capture_attendees(**kwargs: Any) -> list[Mock]:
                    call_filters.append(kwargs.get("query_params", {}).get("filter", ""))
                    return attendees

                mock_coll.get_full_list.side_effect = capture_attendees
            else:
                mock_coll.get_full_list.return_value = []
            return mock_coll

        mock_pb.collection.side_effect = collection_router

        # Clear cache to avoid stale hits
        from api.services.geo_service import clear_person_id_cache

        clear_person_id_cache()

        await service._fetch_duration_person_pb_ids(2025, "1-week", session_cm_id=1001)

        # Should only include session 1001, not 1002
        assert len(call_filters) == 1
        assert "1001" in call_filters[0]
        assert "1002" not in call_filters[0]


class TestInferLocationFromMappingsExtended:
    """Additional tests for _infer_location_from_mappings (continued)."""

    def test_ignores_unrelated_mappings(self) -> None:
        """Should only consider mappings with matching normalized_value."""
        from api.services.geo_service import GeoService

        mappings = [
            _make_mapping_record("a", "School A", address_state="CA"),
            _make_mapping_record("b", "School B", address_state="NY"),
            _make_mapping_record("c", "School B", address_state="NY"),
        ]
        result = GeoService._infer_location_from_mappings(mappings, "School A")
        assert result.get("state") == "CA"

    def test_returns_empty_dict_when_no_address_data(self) -> None:
        """Should return empty dict when no mappings have address fields."""
        from api.services.geo_service import GeoService

        mappings = [
            _make_mapping_record("a", "School A", address_state="", address_country=""),
        ]
        result = GeoService._infer_location_from_mappings(mappings, "School A")
        assert result == {}

    def test_returns_empty_dict_for_unknown_normalized_value(self) -> None:
        """Should return empty dict when no mappings match the given normalized_value."""
        from api.services.geo_service import GeoService

        mappings = [
            _make_mapping_record("a", "School A", address_state="CA"),
        ]
        result = GeoService._infer_location_from_mappings(mappings, "Nonexistent School")
        assert result == {}


# ============================================================================
# State Distribution in Sources Tests
# ============================================================================


class TestSourcesStateDistribution:
    """Test state_distribution aggregation in get_sources."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_sources_aggregate_state_distribution(self, service: GeoService, mock_pb: MagicMock) -> None:
        """get_sources should aggregate address_state per original_value into state_distribution."""
        mappings = [
            _make_mapping_record(
                "riverside elem", "Riverside Elementary", confidence=0.95, address_state="IL", address_country="US"
            ),
            _make_mapping_record(
                "riverside elem", "Riverside Elementary", confidence=0.93, address_state="IL", address_country="US"
            ),
            _make_mapping_record(
                "riverside elem", "Riverside Elementary", confidence=0.95, address_state="CA", address_country="US"
            ),
        ]

        with patch("api.services.geo_service._load_static_location") as mock_location:
            mock_location.return_value = {}
            mock_pb.collection.return_value.get_full_list.return_value = mappings

            result = await service.get_sources("school", "Riverside Elementary", 2025)

        assert len(result.sources) == 1
        dist = result.sources[0].state_distribution
        assert dist == {"IL": 2, "CA": 1}

    @pytest.mark.asyncio
    async def test_sources_international_uses_country_code(self, service: GeoService, mock_pb: MagicMock) -> None:
        """For non-US entries, state_distribution should use the country code as label."""
        mappings = [
            _make_mapping_record(
                "tokyo intl", "Tokyo International", confidence=0.9, address_state="", address_country="JP"
            ),
            _make_mapping_record(
                "tokyo intl", "Tokyo International", confidence=0.9, address_state="", address_country="JP"
            ),
        ]

        with patch("api.services.geo_service._load_static_location") as mock_location:
            mock_location.return_value = {}
            mock_pb.collection.return_value.get_full_list.return_value = mappings

            result = await service.get_sources("school", "Tokyo International", 2025)

        assert result.sources[0].state_distribution == {"JP": 2}

    @pytest.mark.asyncio
    async def test_sources_empty_state_distribution_when_no_address(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """state_distribution should be empty when mappings have no address data."""
        mappings = [
            _make_mapping_record(
                "riverside elem", "Riverside Elementary", confidence=0.95, address_state="", address_country=""
            ),
        ]

        with patch("api.services.geo_service._load_static_location") as mock_location:
            mock_location.return_value = {}
            mock_pb.collection.return_value.get_full_list.return_value = mappings

            result = await service.get_sources("school", "Riverside Elementary", 2025)

        assert result.sources[0].state_distribution == {}


# ============================================================================
# State Distribution in Gaps Tests
# ============================================================================


class TestGapsStateDistribution:
    """Test state_distribution aggregation in get_gaps."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_gaps_include_state_distribution(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Gap items should include state_distribution from mapping address fields."""
        mappings = [
            _make_mapping_record("oakwood academy", "Oakwood Academy", address_state="CA", address_country="US"),
            _make_mapping_record("oakwood acad", "Oakwood Academy", address_state="CA", address_country="US"),
            _make_mapping_record("the oakwood", "Oakwood Academy", address_state="OR", address_country="US"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert len(result.non_canonical_grouped) == 1
        dist = result.non_canonical_grouped[0].state_distribution
        assert dist == {"CA": 2, "OR": 1}

    @pytest.mark.asyncio
    async def test_gaps_international_state_distribution(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Gap items with non-US countries should use country code in state_distribution."""
        mappings = [
            _make_mapping_record("tokyo intl", "Tokyo International", address_state="", address_country="JP"),
            _make_mapping_record("tokyo international", "Tokyo International", address_state="", address_country="JP"),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": [],
                }
            )

            result = await service.get_gaps("school", 2025)

        assert result.non_canonical_grouped[0].state_distribution == {"JP": 2}


# ============================================================================
# Merge Canonical Tests
# ============================================================================


class TestMergeCanonical:
    """Test merge_canonical service method."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_creates_merge_override(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Merging should create a geo_override record with override_type='merge'."""
        overrides_mock = MagicMock()
        mappings_mock = MagicMock()
        mappings_mock.get_full_list.return_value = []

        def collection_router(name: str) -> MagicMock:
            if name == "geo_overrides":
                return overrides_mock
            return mappings_mock

        mock_pb.collection.side_effect = collection_router

        await service.merge_canonical("Old School", "New School", "school", 2025)

        overrides_mock.create.assert_called_once_with(
            {
                "category": "school",
                "override_type": "merge",
                "canonical_name": "Old School",
                "merged_into": "New School",
                "year": 2025,
            },
        )

    @pytest.mark.asyncio
    async def test_updates_mappings_to_target(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Merging should update all normalized_mappings from source to target."""
        mapping1 = _make_mapping_record("old school", "Old School")
        mapping1.id = "m1"
        mapping2 = _make_mapping_record("old skool", "Old School")
        mapping2.id = "m2"

        overrides_mock = MagicMock()
        mappings_mock = MagicMock()
        mappings_mock.get_full_list.return_value = [mapping1, mapping2]

        def collection_router(name: str) -> MagicMock:
            if name == "geo_overrides":
                return overrides_mock
            return mappings_mock

        mock_pb.collection.side_effect = collection_router

        count = await service.merge_canonical("Old School", "New School", "school", 2025)

        assert count == 2
        assert mappings_mock.update.call_count == 2
        mappings_mock.update.assert_any_call("m1", {"normalized_value": "New School"})
        mappings_mock.update.assert_any_call("m2", {"normalized_value": "New School"})

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_mappings(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Merging with no matching mappings should return 0."""
        overrides_mock = MagicMock()
        mappings_mock = MagicMock()
        mappings_mock.get_full_list.return_value = []

        def collection_router(name: str) -> MagicMock:
            if name == "geo_overrides":
                return overrides_mock
            return mappings_mock

        mock_pb.collection.side_effect = collection_router

        count = await service.merge_canonical("Old School", "New School", "school", 2025)

        assert count == 0


# ============================================================================
# Approve Suggested Tests
# ============================================================================


class TestApproveSuggested:
    """Test approve_suggested service method."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_creates_canonical_override(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Approving a suggested canonical should create a canonical override."""
        await service.approve_suggested("Hillcrest Academy", "school", 2025, city="Springfield", state="IL")

        mock_pb.collection.return_value.create.assert_called_once_with(
            {
                "category": "school",
                "override_type": "canonical",
                "canonical_name": "Hillcrest Academy",
                "city": "Springfield",
                "state": "IL",
                "address_country": "",
                "year": 2025,
            },
        )

    @pytest.mark.asyncio
    async def test_creates_override_with_defaults(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Approving without city/state should use empty strings."""
        await service.approve_suggested("Unknown Place", "city", 2025)

        mock_pb.collection.return_value.create.assert_called_once_with(
            {
                "category": "city",
                "override_type": "canonical",
                "canonical_name": "Unknown Place",
                "city": "",
                "state": "",
                "address_country": "",
                "year": 2025,
            },
        )


# ============================================================================
# Approve Suggested Country Tests (#426)
# ============================================================================


class TestApproveSuggestedCountry:
    """Test approve_suggested includes address_country in payload."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_approve_includes_address_country(self, service: GeoService, mock_pb: MagicMock) -> None:
        """approve_suggested should persist the country parameter to geo_overrides."""
        from api.constants.geo import GeoCategory

        await service.approve_suggested(
            "London School", GeoCategory.SCHOOL, 2025, city="London", state="", country="GB"
        )

        mock_pb.collection.return_value.create.assert_called_once()
        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["address_country"] == "GB"

    @pytest.mark.asyncio
    async def test_approve_country_defaults_empty(self, service: GeoService, mock_pb: MagicMock) -> None:
        """approve_suggested without country should store empty string."""
        from api.constants.geo import GeoCategory

        await service.approve_suggested("Hillcrest Academy", GeoCategory.SCHOOL, 2025, city="Springfield", state="IL")

        payload = mock_pb.collection.return_value.create.call_args[0][0]
        assert payload["address_country"] == ""


# ============================================================================
# Reject Suggested Tests
# ============================================================================


class TestRejectSuggested:
    """Test reject_suggested service method."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_deletes_all_mappings(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Rejecting should delete all normalized_mappings for the canonical."""
        mapping1 = _make_mapping_record("bad school", "Bad Canonical")
        mapping1.id = "m1"
        mapping2 = _make_mapping_record("bad skool", "Bad Canonical")
        mapping2.id = "m2"

        mock_pb.collection.return_value.get_full_list.return_value = [mapping1, mapping2]

        count = await service.reject_suggested("Bad Canonical", "school", 2025)

        assert count == 2
        delete_mock = mock_pb.collection.return_value.delete
        assert delete_mock.call_count == 2
        delete_mock.assert_any_call("m1")
        delete_mock.assert_any_call("m2")

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_mappings(self, service: GeoService, mock_pb: MagicMock) -> None:
        """Rejecting with no matching mappings should return 0."""
        mock_pb.collection.return_value.get_full_list.return_value = []

        count = await service.reject_suggested("Nonexistent", "school", 2025)

        assert count == 0


# ============================================================================
# Reject Suggested Durability Tests (#427)
# ============================================================================


class TestRejectSuggestedDurable:
    """Test reject_suggested writes a durable rejection override."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_reject_writes_rejection_override(self, service: GeoService, mock_pb: MagicMock) -> None:
        """reject_suggested should create an override_type='rejected' record."""
        from api.constants.geo import GeoCategory

        mock_pb.collection.return_value.get_full_list.return_value = []

        await service.reject_suggested("Bad Canonical", GeoCategory.CITY, 2025)

        create_calls = mock_pb.collection.return_value.create.call_args_list
        assert len(create_calls) >= 1
        rejection_payload = create_calls[0][0][0]
        assert rejection_payload["override_type"] == "rejected"
        assert rejection_payload["canonical_name"] == "Bad Canonical"
        assert rejection_payload["category"] == "city"
        assert rejection_payload["year"] == 2025

    @pytest.mark.asyncio
    async def test_reject_still_deletes_mappings(self, service: GeoService, mock_pb: MagicMock) -> None:
        """reject_suggested should also delete existing mappings for immediate effect."""
        from api.constants.geo import GeoCategory

        mapping1 = _make_mapping_record("bad val", "Bad Canonical")
        mapping1.id = "m1"
        mock_pb.collection.return_value.get_full_list.return_value = [mapping1]

        count = await service.reject_suggested("Bad Canonical", GeoCategory.SCHOOL, 2025)

        assert count == 1
        mock_pb.collection.return_value.delete.assert_called_with("m1")


# ============================================================================
# Infer Location City Tests (#428)
# ============================================================================


class TestInferLocationCity:
    """Test _infer_location_from_mappings includes city tallying."""

    def test_infers_city_from_mappings(self) -> None:
        """City should be inferred via majority vote from address_city."""
        from api.services.geo_service import GeoService

        mappings = [
            MagicMock(
                normalized_value="Riverside Elementary",
                address_city="Portland",
                address_state="OR",
                address_country="US",
            ),
            MagicMock(
                normalized_value="Riverside Elementary",
                address_city="Portland",
                address_state="OR",
                address_country="US",
            ),
            MagicMock(
                normalized_value="Riverside Elementary",
                address_city="Seattle",
                address_state="WA",
                address_country="US",
            ),
        ]

        result = GeoService._infer_location_from_mappings(mappings, "Riverside Elementary")
        assert result["city"] == "Portland"
        assert result["state"] == "OR"
        assert result["country"] == "US"

    def test_no_city_when_all_empty(self) -> None:
        """City should not appear in result if all address_city values are empty."""
        from api.services.geo_service import GeoService

        mappings = [
            MagicMock(normalized_value="Oak Valley Middle", address_city="", address_state="CA", address_country="US"),
        ]
        result = GeoService._infer_location_from_mappings(mappings, "Oak Valley Middle")
        assert "city" not in result
        assert result["state"] == "CA"


# ============================================================================
# Merge/Approve/Reject Schema Tests
# ============================================================================


class TestMergeApproveRejectSchemas:
    """Test Pydantic schemas for merge, approve, reject operations."""

    def test_merge_request_fields(self) -> None:
        """MergeRequest should have target, category, year."""
        from api.schemas.geo import MergeRequest

        req = MergeRequest(target="Target School", category="school", year=2025)
        assert req.target == "Target School"
        assert req.category == "school"
        assert req.year == 2025

    def test_merge_response_fields(self) -> None:
        """MergeResponse should have merged_count."""
        from api.schemas.geo import MergeResponse

        resp = MergeResponse(merged_count=5)
        assert resp.merged_count == 5

    def test_approve_request_fields(self) -> None:
        """ApproveRequest should have category, year, and optional city/state/country."""
        from api.schemas.geo import ApproveRequest

        req = ApproveRequest(category="school", year=2025, city="Oakland", state="CA", country="US")
        assert req.category == "school"
        assert req.year == 2025
        assert req.city == "Oakland"
        assert req.state == "CA"
        assert req.country == "US"

    def test_approve_request_defaults(self) -> None:
        """ApproveRequest optional fields should default to empty strings."""
        from api.schemas.geo import ApproveRequest

        req = ApproveRequest(category="city", year=2025)
        assert req.city == ""
        assert req.state == ""
        assert req.country == ""

    def test_reject_request_fields(self) -> None:
        """RejectRequest should have category and year."""
        from api.schemas.geo import RejectRequest

        req = RejectRequest(category="school", year=2025)
        assert req.category == "school"
        assert req.year == 2025

    def test_reject_response_fields(self) -> None:
        """RejectResponse should have dissolved_count."""
        from api.schemas.geo import RejectResponse

        resp = RejectResponse(dissolved_count=3)
        assert resp.dissolved_count == 3


# ============================================================================
# Verified Badge Tests
# ============================================================================


class TestVerifiedBadge:
    """Test source badge lifecycle: manual (current year) vs verified (prior year)."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_prior_year_override_gets_verified_badge(self, service: GeoService, mock_pb: MagicMock) -> None:
        """An override from a prior year should have source='verified'."""
        overrides = [
            _make_override_record(
                canonical_name="Riverside Elementary",
                override_type="canonical",
                year=2025,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": overrides,
                }
            )

            result = await service.search_canonicals("school", "", 2026)

        matching = [e for e in result.results if e.canonical_name == "Riverside Elementary"]
        assert len(matching) == 1
        assert matching[0].source == "verified"

    @pytest.mark.asyncio
    async def test_current_year_override_gets_manual_badge(self, service: GeoService, mock_pb: MagicMock) -> None:
        """An override from the current year should have source='manual'."""
        overrides = [
            _make_override_record(
                canonical_name="Riverside Elementary",
                override_type="canonical",
                year=2026,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": overrides,
                }
            )

            result = await service.search_canonicals("school", "", 2026)

        matching = [e for e in result.results if e.canonical_name == "Riverside Elementary"]
        assert len(matching) == 1
        assert matching[0].source == "manual"

    @pytest.mark.asyncio
    async def test_has_coords_preserved_across_years(self, service: GeoService, mock_pb: MagicMock) -> None:
        """When a prior-year override has coords but the current-year override doesn't,
        has_coords should remain True (OR across years, not overwrite)."""
        overrides = [
            _make_override_record(
                id="ov1",
                canonical_name="Riverside Elementary",
                override_type="canonical",
                lat=37.5,
                lng=-122.0,
                year=2025,
            ),
            _make_override_record(
                id="ov2",
                canonical_name="Riverside Elementary",
                override_type="canonical",
                lat=None,
                lng=None,
                year=2026,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": overrides,
                }
            )

            result = await service.search_canonicals("school", "", 2026)

        matching = [e for e in result.results if e.canonical_name == "Riverside Elementary"]
        assert len(matching) == 1
        assert matching[0].has_coords is True

    @pytest.mark.asyncio
    async def test_rejected_override_removes_canonical_from_search(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """A canonical override followed by a rejection should not appear in search results."""
        overrides = [
            _make_override_record(
                id="ov1",
                canonical_name="Riverside Elementary",
                override_type="canonical",
                year=2025,
            ),
            _make_override_record(
                id="ov2",
                canonical_name="Riverside Elementary",
                override_type="rejected",
                year=2026,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": overrides,
                }
            )

            result = await service.search_canonicals("school", "", 2026)

        matching = [e for e in result.results if e.canonical_name == "Riverside Elementary"]
        assert len(matching) == 0

    @pytest.mark.asyncio
    async def test_merged_override_removes_canonical_from_search(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A canonical override followed by a merge should not appear in search results."""
        overrides = [
            _make_override_record(
                id="ov1",
                canonical_name="Riverside Elementary",
                override_type="canonical",
                year=2025,
            ),
            _make_override_record(
                id="ov2",
                canonical_name="Riverside Elementary",
                override_type="merge",
                merged_into="Oak Valley Elementary",
                year=2026,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": overrides,
                }
            )

            result = await service.search_canonicals("school", "", 2026)

        matching = [e for e in result.results if e.canonical_name == "Riverside Elementary"]
        assert len(matching) == 0

    @pytest.mark.asyncio
    async def test_rejection_then_re_canonical_shows_entry(self, service: GeoService, mock_pb: MagicMock) -> None:
        """A rejection followed by a later canonical override should show the entry."""
        overrides = [
            _make_override_record(
                id="ov1",
                canonical_name="Riverside Elementary",
                override_type="rejected",
                year=2025,
            ),
            _make_override_record(
                id="ov2",
                canonical_name="Riverside Elementary",
                override_type="canonical",
                year=2026,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
        ):
            mock_lookup.return_value = {}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": [],
                    "geo_overrides": overrides,
                }
            )

            result = await service.search_canonicals("school", "", 2026)

        matching = [e for e in result.results if e.canonical_name == "Riverside Elementary"]
        assert len(matching) == 1
        assert matching[0].source == "manual"


# ============================================================================
# Batch Resolve Coords Carry-Forward Tests
# ============================================================================


class TestBatchResolveCoordsCarryForward:
    """Test that batch_resolve_coords respects prior-year overrides."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_prior_year_geocoded_not_reprocessed(self, service: GeoService, mock_pb: MagicMock) -> None:
        """An entry geocoded in a prior year should not be re-geocoded."""
        mappings = [
            _make_mapping_record("Riverside Elementary", "Riverside Elementary", year=2026),
        ]
        overrides = [
            _make_override_record(
                canonical_name="Riverside Elementary",
                lat=37.5,
                lng=-122.0,
                nominatim_status="resolved",
                year=2025,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
            patch("api.services.geo_service.geocode_location") as mock_geocode,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": overrides,
                }
            )

            result = await service.batch_resolve_coords("school", 2026)

        mock_geocode.assert_not_called()
        assert result["resolved"] == 0

    @pytest.mark.asyncio
    async def test_prior_year_ambiguous_then_manual_coords_not_reprocessed(
        self, service: GeoService, mock_pb: MagicMock
    ) -> None:
        """An entry marked ambiguous in prior year but given coords in current year is not re-geocoded."""
        mappings = [
            _make_mapping_record("Riverside Elementary", "Riverside Elementary", year=2026),
        ]
        overrides = [
            _make_override_record(
                id="ov1",
                canonical_name="Riverside Elementary",
                nominatim_status="ambiguous",
                year=2025,
            ),
            _make_override_record(
                id="ov2",
                canonical_name="Riverside Elementary",
                lat=37.5,
                lng=-122.0,
                year=2026,
            ),
        ]

        with (
            patch("api.services.geo_service._load_static_lookup") as mock_lookup,
            patch("api.services.geo_service._load_static_coords") as mock_coords,
            patch("api.services.geo_service._load_static_location") as mock_location,
            patch("api.services.geo_service.geocode_location") as mock_geocode,
        ):
            mock_lookup.return_value = {"riverside elementary": "Riverside Elementary"}
            mock_coords.return_value = {}
            mock_location.return_value = {}

            mock_pb.collection.side_effect = _route_collections(
                {
                    "normalized_mappings": mappings,
                    "geo_overrides": overrides,
                }
            )

            result = await service.batch_resolve_coords("school", 2026)

        mock_geocode.assert_not_called()
        assert result["resolved"] == 0


# ============================================================================
# List Overrides Year-Scoped Tests
# ============================================================================


class TestListOverridesYearScoped:
    """Verify list_overrides still filters by year (admin CRUD view)."""

    @pytest.fixture
    def mock_pb(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def service(self, mock_pb: MagicMock) -> GeoService:
        from api.services.geo_service import GeoService

        return GeoService(mock_pb)

    @pytest.mark.asyncio
    async def test_list_overrides_queries_with_year_filter(self, service: GeoService, mock_pb: MagicMock) -> None:
        """list_overrides should pass year in the PocketBase filter (stays year-scoped)."""
        mock_collection = MagicMock()
        mock_collection.get_full_list.return_value = []
        mock_pb.collection.return_value = mock_collection

        await service.list_overrides("school", 2026)

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "year = 2026" in filter_str
        assert 'category = "school"' in filter_str
