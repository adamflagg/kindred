"""Resolution strategies for name matching.

Provides various approaches to resolving names to persons."""

from __future__ import annotations

from .exact_match import ExactMatchStrategy
from .fuzzy_match import FuzzyMatchStrategy
from .phonetic_match import PhoneticMatchStrategy
from .school_disambiguation import SchoolDisambiguationStrategy

__all__ = [
    "ExactMatchStrategy",
    "FuzzyMatchStrategy",
    "PhoneticMatchStrategy",
    "SchoolDisambiguationStrategy",
]
