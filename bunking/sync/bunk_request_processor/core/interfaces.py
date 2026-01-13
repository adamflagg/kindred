"""Abstract interfaces (protocols) for dependency injection.

These protocols define the contracts that implementations must follow,
enabling loose coupling and testability."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Protocol

from .models import BunkRequest, ParsedRequest, Person, ResolvedName


class NameResolutionStrategy(Protocol):
    """Protocol for name resolution strategies"""

    @property
    def name(self) -> str:
        """Strategy name for reporting"""
        ...

    @property
    def min_confidence(self) -> float:
        """Minimum confidence to consider a match"""
        ...

    def resolve(self, name: str, candidates: list[Person], context: dict[str, Any]) -> ResolvedName | None:
        """Try to resolve name against candidates"""
        ...


class ValidationRule(Protocol):
    """Protocol for validation rules"""

    @property
    def name(self) -> str:
        """Rule name for reporting"""
        ...

    def validate(self, request: BunkRequest) -> ValidationResult:
        """Validate a request and return result"""
        ...


class Repository(ABC):
    """Abstract base class for repositories"""

    @abstractmethod
    def find_by_id(self, id: Any) -> Any | None:
        """Find entity by ID"""
        pass

    @abstractmethod
    def save(self, entity: Any) -> bool:
        """Save entity"""
        pass

    @abstractmethod
    def delete(self, id: Any) -> bool:
        """Delete entity by ID"""
        pass


class CacheStrategy(Protocol):
    """Protocol for caching strategies"""

    def get(self, key: str) -> Any | None:
        """Get value from cache"""
        ...

    def set(self, key: str, value: Any, ttl: int | None = None) -> bool:
        """Set value in cache with optional TTL"""
        ...

    def delete(self, key: str) -> bool:
        """Delete value from cache"""
        ...

    def clear(self) -> bool:
        """Clear all cache entries"""
        ...


class AIService(Protocol):
    """Protocol for AI service providers"""

    @property
    def provider_name(self) -> str:
        """Name of the AI provider"""
        ...

    def parse_request(self, text: str, context: dict[str, Any]) -> list[ParsedRequest]:
        """Parse request text using AI"""
        ...

    def disambiguate_name(self, name: str, candidates: list[Person], context: dict[str, Any]) -> ResolvedName | None:
        """Use AI to disambiguate between name candidates"""
        ...


# Result classes used by interfaces


@dataclass
class ValidationResult:
    """Result of a validation rule check"""

    is_valid: bool
    errors: list[str]
    warnings: list[str]
    requires_conversion: bool = False
    conversion_reason: str | None = None

    @classmethod
    def valid(cls) -> ValidationResult:
        """Create a valid result"""
        return cls(is_valid=True, errors=[], warnings=[])

    @classmethod
    def invalid(cls, errors: list[str]) -> ValidationResult:
        """Create an invalid result"""
        return cls(is_valid=False, errors=errors, warnings=[])


@dataclass
class ProcessingResult:
    """Result of processing a batch of requests"""

    total_processed: int
    successful: int
    failed: int
    errors: list[dict[str, Any]]
    stats: dict[str, Any]

    @property
    def success_rate(self) -> float:
        """Calculate success rate"""
        if self.total_processed == 0:
            return 0.0
        return self.successful / self.total_processed
