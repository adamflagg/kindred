"""Name resolution system for bunk request processing.

Provides interfaces and strategies for resolving names to persons."""

from __future__ import annotations

from .interfaces import ResolutionResult, ResolutionStrategy
from .resolution_pipeline import ResolutionPipeline
from .strategies import ExactMatchStrategy, FuzzyMatchStrategy

__all__ = [
    "ResolutionResult",
    "ResolutionStrategy",
    "ResolutionPipeline",
    "ExactMatchStrategy",
    "FuzzyMatchStrategy",
]
