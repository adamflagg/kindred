"""Test-Driven Development for ValidationPipeline

Tests the orchestration of validation rules."""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.validation.interfaces import ValidationResult, ValidationRule
from bunking.sync.bunk_request_processor.validation.validation_pipeline import ValidationPipeline


class MockRule(ValidationRule):
    """Mock validation rule for testing.

    Supports custom validation behavior via callable parameters:
    - validate_fn: Custom validate function (request) -> ValidationResult
    - short_circuit_fn: Custom short-circuit function (result) -> bool
    - execution_tracker: List to track when this rule is executed
    """

    def __init__(
        self,
        name: str,
        priority: int = 0,
        is_valid: bool = True,
        errors: list[str] | None = None,
        short_circuit: bool | None = None,
        validate_fn: Callable[[BunkRequest], ValidationResult] | None = None,
        short_circuit_fn: Callable[[ValidationResult], bool] | None = None,
        execution_tracker: list[str] | None = None,
    ):
        self._name = name
        self._priority = priority
        self._is_valid = is_valid
        self._errors = errors or []
        self._short_circuit = short_circuit
        self._validate_fn = validate_fn
        self._short_circuit_fn = short_circuit_fn
        self._execution_tracker = execution_tracker
        self.call_count = 0

    @property
    def name(self) -> str:
        return self._name

    @property
    def priority(self) -> int:
        return self._priority

    def validate(self, request: BunkRequest) -> ValidationResult:
        self.call_count += 1
        if self._execution_tracker is not None:
            self._execution_tracker.append(self._name)
        if self._validate_fn is not None:
            return self._validate_fn(request)
        result = ValidationResult(is_valid=self._is_valid)
        for error in self._errors:
            result.add_error(error)
        return result

    def can_short_circuit(self, result: ValidationResult) -> bool:
        if self._short_circuit_fn is not None:
            return self._short_circuit_fn(result)
        if self._short_circuit is not None:
            return self._short_circuit
        return super().can_short_circuit(result)


class TestValidationPipeline:
    """Test the ValidationPipeline orchestration"""

    @pytest.fixture
    def pipeline(self):
        """Create a ValidationPipeline"""
        return ValidationPipeline()

    @pytest.fixture
    def sample_request(self):
        """Create a sample bunk request"""
        return BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.PENDING,
            is_placeholder=False,
            metadata={},
        )

    def test_empty_pipeline_validates(self, pipeline, sample_request):
        """Test empty pipeline returns valid result"""
        result = pipeline.validate(sample_request)

        assert result.is_valid
        assert len(result.errors) == 0
        assert len(result.warnings) == 0

    def test_single_rule_validation(self, pipeline, sample_request):
        """Test pipeline with single rule"""
        rule = MockRule("test_rule", is_valid=False, errors=["Test error"])
        pipeline.add_rule(rule)

        result = pipeline.validate(sample_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        assert "Test error" in result.errors
        assert rule.call_count == 1

    def test_multiple_rules_all_pass(self, pipeline, sample_request):
        """Test multiple rules that all pass"""
        rule1 = MockRule("rule1", priority=1)
        rule2 = MockRule("rule2", priority=2)
        rule3 = MockRule("rule3", priority=0)

        pipeline.add_rule(rule1)
        pipeline.add_rule(rule2)
        pipeline.add_rule(rule3)

        result = pipeline.validate(sample_request)

        assert result.is_valid
        assert len(result.errors) == 0
        # Verify all rules were called
        assert rule1.call_count == 1
        assert rule2.call_count == 1
        assert rule3.call_count == 1

    def test_rules_execute_in_priority_order(self, pipeline, sample_request):
        """Test rules execute in priority order"""
        execution_order: list[str] = []

        # Add rules in non-priority order, all using the same tracker
        pipeline.add_rule(MockRule("low", priority=1, execution_tracker=execution_order))
        pipeline.add_rule(MockRule("high", priority=10, execution_tracker=execution_order))
        pipeline.add_rule(MockRule("medium", priority=5, execution_tracker=execution_order))

        pipeline.validate(sample_request)

        # Should execute high->medium->low
        assert execution_order == ["high", "medium", "low"]

    def test_short_circuit_on_error(self, pipeline, sample_request):
        """Test short-circuit stops further validation"""
        rule1 = MockRule("rule1", priority=10, is_valid=False, errors=["Critical error"])
        rule2 = MockRule("rule2", priority=5)
        rule3 = MockRule("rule3", priority=1)

        pipeline.add_rule(rule1)
        pipeline.add_rule(rule2)
        pipeline.add_rule(rule3)

        result = pipeline.validate(sample_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        # Rule1 should have been called
        assert rule1.call_count == 1
        # Rules 2 and 3 should not have been called due to short-circuit
        assert rule2.call_count == 0
        assert rule3.call_count == 0
        assert result.metadata["short_circuited_at"] == "rule1"

    def test_no_short_circuit_when_configured(self, pipeline, sample_request):
        """Test short-circuit can be disabled"""
        rule1 = MockRule("rule1", priority=10, is_valid=False, errors=["Error 1"], short_circuit=False)
        rule2 = MockRule("rule2", priority=5, is_valid=False, errors=["Error 2"])

        pipeline.add_rule(rule1)
        pipeline.add_rule(rule2)

        result = pipeline.validate(sample_request)

        assert not result.is_valid
        assert len(result.errors) == 2
        assert "Error 1" in result.errors
        assert "Error 2" in result.errors
        # Both rules should have been called
        assert rule1.call_count == 1
        assert rule2.call_count == 1

    def test_validation_result_merging(self, pipeline, sample_request):
        """Test validation results are properly merged"""
        # Build custom result with errors and warnings
        rule1_result = ValidationResult(is_valid=False)
        rule1_result.add_error("Error 1")
        rule1_result.add_warning("Warning 1")
        rule1_result.metadata["rule1_data"] = "value1"

        rule2_result = ValidationResult(is_valid=True)
        rule2_result.add_warning("Warning 2")
        rule2_result.metadata["rule2_data"] = "value2"

        # Rule with errors and warnings (but doesn't short-circuit)
        rule1 = MockRule(
            "rule1",
            priority=10,
            short_circuit=False,
            validate_fn=lambda _: rule1_result,
        )

        # Rule with just warnings (doesn't short-circuit)
        rule2 = MockRule(
            "rule2",
            priority=5,
            validate_fn=lambda _: rule2_result,
            short_circuit_fn=lambda _: False,
        )

        pipeline.add_rule(rule1)
        pipeline.add_rule(rule2)

        result = pipeline.validate(sample_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        assert len(result.warnings) == 2
        assert "Warning 1" in result.warnings
        assert "Warning 2" in result.warnings
        assert result.metadata["rule1_data"] == "value1"
        assert result.metadata["rule2_data"] == "value2"

    def test_batch_validation(self, pipeline):
        """Test validating multiple requests"""
        requests = [
            BunkRequest(
                requester_cm_id=i,
                requested_cm_id=i + 1,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1000002,
                priority=3,
                confidence_score=0.95,
                source=RequestSource.FAMILY,
                source_field="share_bunk_with",
                csv_position=0,
                year=2025,
                status=RequestStatus.PENDING,
                is_placeholder=False,
                metadata={},
            )
            for i in range(3)
        ]

        # Rule that fails for even requesters
        def even_check_validator(request: BunkRequest) -> ValidationResult:
            is_even = request.requester_cm_id % 2 == 0
            return ValidationResult(
                is_valid=not is_even,
                errors=["Even requester"] if is_even else [],
            )

        rule = MockRule("even_check", validate_fn=even_check_validator)
        pipeline.add_rule(rule)

        results = pipeline.validate_batch(requests)

        assert len(results) == 3
        assert not results[0].is_valid  # requester_cm_id = 0 (even)
        assert results[1].is_valid  # requester_cm_id = 1 (odd)
        assert not results[2].is_valid  # requester_cm_id = 2 (even)

    def test_validation_statistics(self, pipeline, sample_request):
        """Test validation statistics tracking"""
        rule1 = MockRule("rule1", is_valid=False, errors=["Error"])
        rule2 = MockRule("rule2", is_valid=True)

        pipeline.add_rule(rule1)
        pipeline.add_rule(rule2)

        # Validate multiple times
        pipeline.validate(sample_request)
        pipeline.validate(sample_request)

        stats = pipeline.get_statistics()

        assert stats["rule1"] == 2  # Failed twice
        assert "rule2" not in stats  # Never failed

    def test_reset_statistics(self, pipeline, sample_request):
        """Test resetting validation statistics"""
        rule = MockRule("rule", is_valid=False, errors=["Error"])
        pipeline.add_rule(rule)

        pipeline.validate(sample_request)
        stats = pipeline.get_statistics()
        assert stats["rule"] == 1

        pipeline.reset_statistics()
        stats = pipeline.get_statistics()
        assert len(stats) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
