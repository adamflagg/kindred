"""Validation interfaces and results.

Defines the contracts for validation rules and their results."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from ..core.models import BunkRequest


@dataclass
class ValidationResult:
    """Result of a validation check"""

    is_valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    requires_conversion: bool = False
    conversion_reason: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)

    def add_error(self, error: str) -> None:
        """Add an error message"""
        self.errors.append(error)
        self.is_valid = False

    def add_warning(self, warning: str) -> None:
        """Add a warning message"""
        self.warnings.append(warning)

    def merge(self, other: ValidationResult) -> None:
        """Merge another validation result into this one"""
        self.is_valid = self.is_valid and other.is_valid
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        if other.requires_conversion:
            self.requires_conversion = True
            if other.conversion_reason:
                self.conversion_reason = other.conversion_reason
        self.metadata.update(other.metadata)


class ValidationRule(ABC):
    """Abstract base class for validation rules"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Name of the validation rule"""
        pass

    @property
    def priority(self) -> int:
        """Priority of the rule (higher runs first)"""
        return 0

    @abstractmethod
    def validate(self, request: BunkRequest) -> ValidationResult:
        """Validate a bunk request.

        Args:
            request: The request to validate

        Returns:
            ValidationResult with any errors or warnings
        """
        pass

    def can_short_circuit(self, result: ValidationResult) -> bool:
        """Whether this rule's result should stop further validation.

        Args:
            result: The validation result

        Returns:
            True if validation should stop
        """
        # By default, stop on errors
        return not result.is_valid
