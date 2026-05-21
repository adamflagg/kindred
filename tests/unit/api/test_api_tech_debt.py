"""TDD tests for Group 18 API Tech Debt cleanup.

Tests for:
- #620: Standardize attendee filtering on status_id (remove is_active)
- #624: Extract _group_enrolled_by_person helper
- #625: get_person_from_expand utility
- #626: _build_parsed_intent helper in debug.py
- #628: Year parameter bounds validation
- #630: ACTIVE_ENROLLED_FILTER constant
"""

from typing import Any
from unittest.mock import MagicMock, Mock

import pytest

# ============================================================================
# #620: Standardize on status_id, remove is_active from filters
# ============================================================================


class TestActiveEnrolledFilterStandardization:
    """Verify all attendee filters use status_id = 2 without is_active."""

    @pytest.mark.asyncio
    async def test_metrics_repo_default_filter_uses_status_id_only(self) -> None:
        """MetricsRepository.fetch_attendees default should use status_id = 2, not is_active."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_attendees(2025)

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "status_id = 2" in filter_str
        assert "is_active" not in filter_str

    @pytest.mark.asyncio
    async def test_metrics_repo_enrolled_filter_uses_status_id_only(self) -> None:
        """MetricsRepository.fetch_attendees with 'enrolled' should use status_id = 2, not is_active."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_attendees(2025, status_filter="enrolled")

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "status_id = 2" in filter_str
        assert "is_active" not in filter_str

    @pytest.mark.asyncio
    async def test_metrics_repo_attendees_with_persons_uses_status_id_only(self) -> None:
        """MetricsRepository.fetch_attendees_with_persons default should not use is_active."""
        from api.services.metrics_repository import MetricsRepository

        mock_pb = MagicMock()
        mock_collection = MagicMock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        repo = MetricsRepository(mock_pb)
        await repo.fetch_attendees_with_persons(2025)

        call_args = mock_collection.get_full_list.call_args
        filter_str = call_args.kwargs["query_params"]["filter"]
        assert "status_id = 2" in filter_str
        assert "is_active" not in filter_str


# ============================================================================
# #624: Extract _group_enrolled_by_person helper
# ============================================================================


class TestGroupEnrolledByPerson:
    """Tests for the extracted _group_enrolled_by_person helper."""

    def test_groups_enrolled_by_person_id(self) -> None:
        """Should group enrolled attendees by person_id."""
        from api.services.drilldown_service import _group_enrolled_by_person

        session_main = Mock(session_type="main", cm_id=1001)
        session_quest = Mock(session_type="quest", cm_id=2001)

        enrolled = [
            Mock(person_id=100, expand={"session": session_main}),
            Mock(person_id=100, expand={"session": session_quest}),
            Mock(person_id=200, expand={"session": session_main}),
        ]

        result = _group_enrolled_by_person(enrolled, ("main", "embedded", "ag", "quest"))
        assert len(result[100]) == 2
        assert len(result[200]) == 1

    def test_filters_by_effective_types(self) -> None:
        """Should only include attendees whose session_type is in effective_types."""
        from api.services.drilldown_service import _group_enrolled_by_person

        session_main = Mock(session_type="main", cm_id=1001)
        session_family = Mock(session_type="family", cm_id=3001)

        enrolled = [
            Mock(person_id=100, expand={"session": session_main}),
            Mock(person_id=100, expand={"session": session_family}),
        ]

        result = _group_enrolled_by_person(enrolled, ("main",))
        assert len(result[100]) == 1

    def test_returns_empty_dict_for_no_enrollments(self) -> None:
        """Should return empty dict when no attendees match."""
        from api.services.drilldown_service import _group_enrolled_by_person

        result = _group_enrolled_by_person([], ("main",))
        assert result == {}

    def test_skips_attendees_without_session_expand(self) -> None:
        """Should skip attendees that have no session in expand."""
        from api.services.drilldown_service import _group_enrolled_by_person

        enrolled = [
            Mock(person_id=100, expand={}),
            Mock(person_id=200, expand=None),
        ]

        result = _group_enrolled_by_person(enrolled, ("main",))
        assert result == {}


# ============================================================================
# #625: get_person_from_expand utility
# ============================================================================


class TestGetPersonFromExpand:
    """Tests for the get_person_from_expand utility function."""

    def test_extracts_person_from_dict_expand(self) -> None:
        """Should extract person from a dict-style expand."""
        from api.utils.session_metrics import get_person_from_expand

        person = Mock(cm_id=500, first_name="Emma")
        record = Mock(expand={"person": person})
        assert get_person_from_expand(record) is person

    def test_extracts_person_from_object_expand(self) -> None:
        """Should extract person from an object-style expand."""
        from api.utils.session_metrics import get_person_from_expand

        person = Mock(cm_id=500, first_name="Emma")
        expand = Mock(person=person)
        expand.__contains__ = Mock(side_effect=TypeError)
        record = Mock(expand=expand)
        result = get_person_from_expand(record)
        assert result is person

    def test_returns_none_for_empty_expand(self) -> None:
        """Should return None when expand is empty dict."""
        from api.utils.session_metrics import get_person_from_expand

        record = Mock(expand={})
        assert get_person_from_expand(record) is None

    def test_returns_none_for_none_expand(self) -> None:
        """Should return None when expand is None."""
        from api.utils.session_metrics import get_person_from_expand

        record = Mock(expand=None)
        assert get_person_from_expand(record) is None

    def test_returns_none_for_missing_expand(self) -> None:
        """Should return None when record has no expand attribute."""
        from api.utils.session_metrics import get_person_from_expand

        record = Mock(spec=[])
        assert get_person_from_expand(record) is None


# ============================================================================
# #626: _build_parsed_intent helper in debug.py
# ============================================================================


class TestBuildParsedIntent:
    """Tests for the _build_parsed_intent helper extracted from debug.py."""

    def test_builds_parsed_intent_from_dict(self) -> None:
        """Should construct a ParsedIntent from an intent dict."""
        from api.routers.debug import _build_parsed_intent

        intent = {
            "request_type": "bunk_with",
            "target_name": "Emma Johnson",
            "keywords_found": ["bunk", "together"],
            "parse_notes": "Direct request",
            "reasoning": "Clear preference",
            "list_position": 1,
            "needs_clarification": False,
            "temporal_info": None,
        }

        result = _build_parsed_intent(intent)
        assert result.request_type == "bunk_with"
        assert result.target_name == "Emma Johnson"
        assert result.keywords_found == ["bunk", "together"]
        assert result.list_position == 1
        assert result.needs_clarification is False

    def test_handles_missing_optional_fields(self) -> None:
        """Should use defaults for missing optional fields."""
        from api.routers.debug import _build_parsed_intent

        intent: dict[str, Any] = {}

        result = _build_parsed_intent(intent)
        assert result.request_type == "unknown"
        assert result.target_name is None
        assert result.keywords_found == []
        assert result.parse_notes == ""
        assert result.reasoning == ""
        assert result.list_position == 0
        assert result.needs_clarification is False
        assert result.temporal_info is None


# ============================================================================
# #628: Year parameter bounds validation
# ============================================================================


def _has_year_bounds(func: Any, param_name: str = "year") -> bool:
    """Check if a FastAPI endpoint parameter has ge=2000, le=2100 bounds."""
    import inspect

    from annotated_types import Ge, Le

    sig = inspect.signature(func)
    param = sig.parameters.get(param_name)
    if param is None:
        return False
    default = param.default
    if not hasattr(default, "metadata"):
        return False
    metadata = default.metadata
    has_ge = any(isinstance(m, Ge) and m.ge == 2000 for m in metadata)
    has_le = any(isinstance(m, Le) and m.le == 2100 for m in metadata)
    return has_ge and has_le


class TestYearParameterBounds:
    """Tests verifying year parameters have ge=2000, le=2100 bounds."""

    def test_metrics_year_parameter_has_bounds(self) -> None:
        """Year parameters in metrics router should have bounds."""
        from api.routers.metrics import get_registration_metrics

        assert _has_year_bounds(get_registration_metrics)

    def test_geo_year_parameter_has_bounds(self) -> None:
        """Year parameters in geo router should have bounds."""
        from api.routers.geo import get_gaps

        assert _has_year_bounds(get_gaps)

    def test_debug_year_parameter_has_bounds(self) -> None:
        """Year parameters in debug router should have bounds."""
        from api.routers.debug import list_original_requests

        assert _has_year_bounds(list_original_requests)

    def test_session_availability_year_parameter_has_bounds(self) -> None:
        """Year parameters in session_availability router should have bounds."""
        from api.routers.session_availability import get_session_availability

        assert _has_year_bounds(get_session_availability)


# ============================================================================
# #630: ACTIVE_ENROLLED_FILTER constant
# ============================================================================


class TestActiveEnrolledFilterConstant:
    """Tests for the ACTIVE_ENROLLED_FILTER constant."""

    def test_constant_exists(self) -> None:
        """ACTIVE_ENROLLED_FILTER should be importable from constants."""
        from api.constants.filters import ACTIVE_ENROLLED_FILTER

        assert isinstance(ACTIVE_ENROLLED_FILTER, str)

    def test_constant_uses_status_id_only(self) -> None:
        """Constant should use status_id = 2 without is_active (per #620)."""
        from api.constants.filters import ACTIVE_ENROLLED_FILTER

        assert "status_id = 2" in ACTIVE_ENROLLED_FILTER
        assert "is_active" not in ACTIVE_ENROLLED_FILTER

    def test_constant_has_proper_pb_spacing(self) -> None:
        """Constant should use PocketBase filter syntax with spaces around operators."""
        from api.constants.filters import ACTIVE_ENROLLED_FILTER

        # PB requires spaces around operators
        assert "status_id = 2" in ACTIVE_ENROLLED_FILTER
        assert "status_id=2" not in ACTIVE_ENROLLED_FILTER
