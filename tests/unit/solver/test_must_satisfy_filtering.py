"""Tests for must_satisfy.py source_field filtering logic.

Verifies that EXPLICIT_SOURCE_FIELDS correctly filters requests
based on their source_field values using SourceField constants."""

from unittest.mock import Mock

from bunking.sync.bunk_request_processor.shared.constants import SourceField


def _make_request(
    source_field: str, request_type: str = "bunk_with", csv_source_fields: list[str] | None = None
) -> Mock:
    """Create a mock DirectBunkRequest with given source_field."""
    request = Mock()
    request.source_field = source_field
    request.request_type = request_type
    request.csv_source_fields = csv_source_fields
    request.ai_reasoning = None
    return request


class TestExplicitSourceFieldFiltering:
    """Test that _filter_and_categorize_requests uses EXPLICIT_SOURCE_FIELDS correctly."""

    def test_bunk_with_source_field_is_explicit(self):
        """A request with source_field=SourceField.BUNK_REQUEST_FORM IS included as bunk request."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.BUNK_REQUEST_FORM, "bunk_with")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 1
        assert len(age_reqs) == 0

    def test_not_bunk_with_source_field_is_explicit(self):
        """A request with source_field=SourceField.STAFF_NOT_BUNK_WITH IS included as bunk request."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.STAFF_NOT_BUNK_WITH, "not_bunk_with")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 1
        assert len(age_reqs) == 0

    def test_bunking_notes_source_field_is_explicit(self):
        """A request with source_field=SourceField.BUNKING_NOTES IS included."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.BUNKING_NOTES, "bunk_with")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 1

    def test_internal_notes_source_field_is_explicit(self):
        """A request with source_field=SourceField.INTERNAL_NOTES IS included."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.INTERNAL_NOTES, "bunk_with")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 1

    def test_socialize_with_source_field_is_excluded(self):
        """A request with source_field=SourceField.SOCIALIZE_WITH is EXCLUDED."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.SOCIALIZE_WITH, "bunk_with")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 0
        assert len(age_reqs) == 0

    def test_age_preference_from_explicit_field_is_included(self):
        """An age_preference request from an explicit source field IS included in age_requests."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.BUNK_REQUEST_FORM, "age_preference")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 0
        assert len(age_reqs) == 1

    def test_age_preference_from_socialize_excluded(self):
        """An age_preference from socialize_with is excluded entirely."""
        from bunking.solver.constraints.must_satisfy import _filter_and_categorize_requests

        request = _make_request(SourceField.SOCIALIZE_WITH, "age_preference")
        bunk_reqs, age_reqs = _filter_and_categorize_requests([request])

        assert len(bunk_reqs) == 0
        assert len(age_reqs) == 0
