"""Validation pipeline for orchestrating validation rules.

Manages the execution of validation rules in priority order with short-circuit logic."""

from __future__ import annotations

from ..core.models import BunkRequest
from .interfaces import ValidationResult, ValidationRule


class ValidationPipeline:
    """Orchestrates validation rules for bunk requests"""

    def __init__(self) -> None:
        """Initialize the validation pipeline"""
        self.rules: list[ValidationRule] = []
        self._validation_stats: dict[str, int] = {}

    def add_rule(self, rule: ValidationRule) -> None:
        """Add a validation rule to the pipeline.

        Args:
            rule: The validation rule to add
        """
        self.rules.append(rule)
        # Sort by priority (descending)
        self.rules.sort(key=lambda r: r.priority, reverse=True)

    def validate(self, request: BunkRequest) -> ValidationResult:
        """Validate a request through all rules.

        Args:
            request: The request to validate

        Returns:
            Combined ValidationResult from all rules
        """
        combined_result = ValidationResult(is_valid=True)

        for rule in self.rules:
            # Run the validation rule
            result = rule.validate(request)

            # Track statistics
            rule_name = rule.name
            if rule_name not in self._validation_stats:
                self._validation_stats[rule_name] = 0
            if not result.is_valid:
                self._validation_stats[rule_name] += 1

            # Merge the result
            combined_result.merge(result)

            # Check for short-circuit
            if rule.can_short_circuit(result):
                combined_result.metadata["short_circuited_at"] = rule_name
                break

        return combined_result

    def validate_batch(self, requests: list[BunkRequest]) -> dict[int, ValidationResult]:
        """Validate a batch of requests.

        Args:
            requests: List of requests to validate

        Returns:
            Dictionary mapping request index to validation result
        """
        results = {}

        for i, request in enumerate(requests):
            results[i] = self.validate(request)

        return results

    def get_statistics(self) -> dict[str, int]:
        """Get validation statistics.

        Returns:
            Dictionary of rule names to error counts
        """
        return self._validation_stats.copy()

    def reset_statistics(self) -> None:
        """Reset validation statistics"""
        self._validation_stats.clear()
