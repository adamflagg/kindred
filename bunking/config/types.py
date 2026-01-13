"""Configuration type definitions.

Defines the schema for configuration keys including types and validation rules.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any


class ConfigType(Enum):
    """Supported configuration value types."""

    INT = "int"
    FLOAT = "float"
    BOOL = "bool"
    STRING = "string"
    JSON = "json"


@dataclass
class ConfigKey:
    """
    Definition of a configuration key with validation rules.

    Attributes:
        key: The dot-notation config key (e.g., "solver.time_limit.seconds")
        config_type: The expected type of the value
        required: If True, key must exist in database (no fallback)
        description: Human-readable description
        min_value: Minimum allowed value (for numeric types)
        max_value: Maximum allowed value (for numeric types)
        allowed_values: List of allowed values (for string/enum types)
        validator: Custom validation function returning True if valid
    """

    key: str
    config_type: ConfigType
    required: bool = True
    description: str = ""
    min_value: float | None = None
    max_value: float | None = None
    allowed_values: list[Any] | None = None
    validator: Callable[[Any], bool] | None = None

    def validate(self, value: Any) -> str | None:
        """
        Validate a value against this key's rules.

        Args:
            value: The value to validate

        Returns:
            None if valid, error message string if invalid
        """
        # Range validation for numeric types
        if self.config_type in (ConfigType.INT, ConfigType.FLOAT):
            if self.min_value is not None and value < self.min_value:
                return f"Value {value} below minimum {self.min_value}"
            if self.max_value is not None and value > self.max_value:
                return f"Value {value} above maximum {self.max_value}"

        # Allowed values validation
        if self.allowed_values is not None and value not in self.allowed_values:
            return f"Value {value} not in allowed values {self.allowed_values}"

        # Custom validator
        if self.validator is not None and not self.validator(value):
            return f"Value {value} failed custom validation"

        return None
