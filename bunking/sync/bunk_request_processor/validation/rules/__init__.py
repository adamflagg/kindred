"""Validation rules for bunk request processing.

Each rule implements a specific validation check."""

from __future__ import annotations

from .self_reference import SelfReferenceRule
from .session_compatibility import SessionCompatibilityRule

__all__ = [
    "SelfReferenceRule",
    "SessionCompatibilityRule",
]
