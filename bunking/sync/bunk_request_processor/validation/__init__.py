"""Validation module for bunk request processing.

Provides validation rules and special handlers for ensuring request integrity."""

from __future__ import annotations

from .interfaces import ValidationResult, ValidationRule
from .validation_pipeline import ValidationPipeline

__all__ = [
    "ValidationPipeline",
    "ValidationResult",
    "ValidationRule",
]
