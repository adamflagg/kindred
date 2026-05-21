"""Name resolution system for bunk request processing.

Provides interfaces and strategies for resolving names to persons."""

from .interfaces import ResolutionResult, ResolutionStrategy
from .resolution_pipeline import ResolutionPipeline
from .strategies import ExactMatchStrategy, FuzzyMatchStrategy

__all__ = [
    "ExactMatchStrategy",
    "FuzzyMatchStrategy",
    "ResolutionPipeline",
    "ResolutionResult",
    "ResolutionStrategy",
]
