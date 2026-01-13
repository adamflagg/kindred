"""Input Sanitizer for Prompt Injection Detection and Prevention.

This module provides security utilities for detecting and sanitizing
potentially malicious input before sending to AI providers."""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, ClassVar

logger = logging.getLogger(__name__)


class RiskLevel(Enum):
    """Risk level classification for detected patterns."""

    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class DetectionResult:
    """Result of prompt injection detection."""

    is_suspicious: bool
    detected_patterns: list[str] = field(default_factory=list)
    confidence_penalty: float = 0.0
    risk_level: RiskLevel = RiskLevel.NONE
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class SanitizationResult:
    """Result of input sanitization."""

    sanitized_text: str
    was_truncated: bool = False
    injection_detected: bool = False
    removed_patterns: list[str] = field(default_factory=list)


@dataclass
class SecureProcessResult:
    """Combined result of detection and sanitization."""

    sanitized_text: str
    is_suspicious: bool
    confidence_penalty: float
    risk_level: RiskLevel
    detected_patterns: list[str]
    was_truncated: bool


class PromptInjectionDetector:
    """Detects potential prompt injection patterns in input text."""

    # Penalty values per pattern category
    PENALTY_VALUES: ClassVar[dict[str, float]] = {
        "system_instruction": 0.4,
        "ignore_instructions": 0.35,
        "role_manipulation": 0.3,
        "prompt_leaking": 0.25,
        "delimiter_injection": 0.2,
    }

    # Pattern definitions for different injection types
    SYSTEM_INSTRUCTION_PATTERNS: ClassVar[list[re.Pattern[str]]] = [
        re.compile(r"\[system[:\s\]]", re.IGNORECASE),
        re.compile(r"system\s*:", re.IGNORECASE),
        re.compile(r"<<system>>", re.IGNORECASE),
        re.compile(r"\[assistant[:\s\]]", re.IGNORECASE),
        re.compile(r"\[user[:\s\]]", re.IGNORECASE),
    ]

    IGNORE_INSTRUCTIONS_PATTERNS: ClassVar[list[re.Pattern[str]]] = [
        # Handles: "ignore previous instructions", "ignore all previous instructions", etc.
        re.compile(
            r"ignore\s+(?:(?:all|previous|above|prior)\s+)+(?:instructions?|rules?|constraints?)",
            re.IGNORECASE,
        ),
        re.compile(r"forget\s+(everything|all)\s+(above|before)", re.IGNORECASE),
        re.compile(r"disregard\s+(previous|prior|above)\s+(instructions?|rules?)", re.IGNORECASE),
        re.compile(r"ignore\s+the\s+above", re.IGNORECASE),
    ]

    ROLE_MANIPULATION_PATTERNS: ClassVar[list[re.Pattern[str]]] = [
        re.compile(r"you\s+are\s+now\s+\w+", re.IGNORECASE),
        re.compile(r"pretend\s+(you\s+are|to\s+be)\s+", re.IGNORECASE),
        re.compile(r"act\s+as\s+if\s+", re.IGNORECASE),
        re.compile(r"roleplay\s+as\s+", re.IGNORECASE),
        re.compile(r"you\s+are\s+no\s+longer\s+bound\s+by", re.IGNORECASE),
    ]

    PROMPT_LEAKING_PATTERNS: ClassVar[list[re.Pattern[str]]] = [
        re.compile(
            r"(what|show|reveal|print|output)\s+(is|me)?\s*(your)?\s*(system\s+)?(prompt|instructions?|configuration)",
            re.IGNORECASE,
        ),
        re.compile(r"(initial|original)\s+prompt", re.IGNORECASE),
        re.compile(r"system\s+message", re.IGNORECASE),
    ]

    DELIMITER_INJECTION_PATTERNS: ClassVar[list[re.Pattern[str]]] = [
        re.compile(r"```\s*\n.*?(system|instruction|ignore)", re.IGNORECASE | re.DOTALL),
        re.compile(r"---\s*\n\s*(system|instruction|ignore)", re.IGNORECASE),
        re.compile(r"###\s*\n\s*(system|instruction|ignore)", re.IGNORECASE),
        re.compile(r"===\s*\n\s*(system|instruction|ignore|new|override)", re.IGNORECASE),
        re.compile(r"\*\*\*\s*\n\s*(system|instruction|ignore|override)", re.IGNORECASE),
        re.compile(r"backticks\s*\n.*?(instruction|ignore)", re.IGNORECASE | re.DOTALL),
    ]

    def detect(self, text: str) -> DetectionResult:
        """Detect potential prompt injection patterns in text.

        Args:
            text: Input text to analyze

        Returns:
            DetectionResult with detection information
        """
        if not text or not text.strip():
            return DetectionResult(is_suspicious=False, risk_level=RiskLevel.NONE)

        detected_patterns: list[str] = []
        details: dict[str, list[str]] = {}

        # Check each pattern category
        pattern_checks = [
            ("system_instruction", self.SYSTEM_INSTRUCTION_PATTERNS),
            ("ignore_instructions", self.IGNORE_INSTRUCTIONS_PATTERNS),
            ("role_manipulation", self.ROLE_MANIPULATION_PATTERNS),
            ("prompt_leaking", self.PROMPT_LEAKING_PATTERNS),
            ("delimiter_injection", self.DELIMITER_INJECTION_PATTERNS),
        ]

        for category, patterns in pattern_checks:
            matches = self._find_matches(text, patterns)
            if matches:
                detected_patterns.append(category)
                details[category] = matches

        # Calculate confidence penalty
        confidence_penalty = self._calculate_penalty(detected_patterns)

        # Determine risk level
        risk_level = self._determine_risk_level(detected_patterns, confidence_penalty)

        is_suspicious = len(detected_patterns) > 0

        if is_suspicious:
            logger.warning(
                f"Prompt injection patterns detected: {detected_patterns}, "
                f"risk_level={risk_level.value}, penalty={confidence_penalty:.2f}"
            )

        return DetectionResult(
            is_suspicious=is_suspicious,
            detected_patterns=detected_patterns,
            confidence_penalty=confidence_penalty,
            risk_level=risk_level,
            details=details,
        )

    def _find_matches(self, text: str, patterns: list[re.Pattern[str]]) -> list[str]:
        """Find all matching patterns in text."""
        matches = []
        for pattern in patterns:
            found = pattern.findall(text)
            if found:
                # Convert tuples to strings if needed
                for match in found:
                    if isinstance(match, tuple):
                        matches.append(" ".join(str(m) for m in match if m))
                    else:
                        matches.append(str(match))
        return matches

    def _calculate_penalty(self, detected_patterns: list[str]) -> float:
        """Calculate confidence penalty based on detected patterns."""
        if not detected_patterns:
            return 0.0

        total_penalty = sum(self.PENALTY_VALUES.get(pattern, 0.1) for pattern in detected_patterns)

        # Cap at 1.0
        return min(total_penalty, 1.0)

    def _determine_risk_level(self, detected_patterns: list[str], penalty: float) -> RiskLevel:
        """Determine overall risk level."""
        if not detected_patterns:
            return RiskLevel.NONE

        if penalty >= 0.7 or len(detected_patterns) >= 3:
            return RiskLevel.CRITICAL
        if penalty >= 0.5 or len(detected_patterns) >= 2:
            return RiskLevel.HIGH
        if penalty >= 0.3:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW


class InputSanitizer:
    """Sanitizes input text before sending to AI providers."""

    # Default max length for input text
    DEFAULT_MAX_LENGTH: ClassVar[int] = 5000

    # Patterns to escape or remove
    ESCAPE_PATTERNS: ClassVar[list[tuple[re.Pattern[str], str]]] = [
        (re.compile(r"\[SYSTEM[:\s\]]", re.IGNORECASE), "[SYS]"),
        (re.compile(r"<<SYSTEM>>", re.IGNORECASE), "(SYS)"),
    ]

    def __init__(self, max_length: int | None = None):
        """Initialize the sanitizer.

        Args:
            max_length: Maximum allowed input length (default: 5000)
        """
        self.max_length = max_length or self.DEFAULT_MAX_LENGTH
        self._detector = PromptInjectionDetector()

    def sanitize(self, text: str) -> SanitizationResult:
        """Sanitize input text.

        Args:
            text: Input text to sanitize

        Returns:
            SanitizationResult with sanitized text
        """
        if not text:
            return SanitizationResult(sanitized_text="")

        sanitized = text
        removed_patterns: list[str] = []

        # Remove control characters (except newlines and tabs)
        sanitized = self._remove_control_chars(sanitized)

        # Normalize whitespace
        sanitized = self._normalize_whitespace(sanitized)

        # Escape dangerous patterns
        sanitized, escaped = self._escape_patterns(sanitized)
        removed_patterns.extend(escaped)

        # Check for injection patterns
        detection = self._detector.detect(sanitized)
        injection_detected = detection.is_suspicious

        # Truncate if needed
        was_truncated = False
        if len(sanitized) > self.max_length:
            sanitized = sanitized[: self.max_length]
            was_truncated = True

        return SanitizationResult(
            sanitized_text=sanitized.strip(),
            was_truncated=was_truncated,
            injection_detected=injection_detected,
            removed_patterns=removed_patterns,
        )

    def _remove_control_chars(self, text: str) -> str:
        """Remove control characters except newlines and tabs."""
        result = []
        for char in text:
            # Keep printable chars, newlines, and tabs
            if char in ("\n", "\t") or not unicodedata.category(char).startswith("C"):
                result.append(char)
        return "".join(result)

    def _normalize_whitespace(self, text: str) -> str:
        """Normalize excessive whitespace."""
        # Replace multiple spaces with single space
        text = re.sub(r" {2,}", " ", text)
        # Replace multiple newlines with double newline
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text

    def _escape_patterns(self, text: str) -> tuple[str, list[str]]:
        """Escape potentially dangerous patterns."""
        escaped = []
        for pattern, replacement in self.ESCAPE_PATTERNS:
            if pattern.search(text):
                escaped.append(pattern.pattern)
                text = pattern.sub(replacement, text)
        return text, escaped


class SecureSanitizer:
    """Combined detector and sanitizer for secure AI input processing."""

    def __init__(
        self,
        max_length: int | None = None,
        detector: PromptInjectionDetector | None = None,
        sanitizer: InputSanitizer | None = None,
    ):
        """Initialize the secure sanitizer.

        Args:
            max_length: Maximum allowed input length
            detector: Optional custom detector
            sanitizer: Optional custom sanitizer
        """
        self.detector = detector or PromptInjectionDetector()
        self.sanitizer = sanitizer or InputSanitizer(max_length=max_length)

    def process(self, text: str) -> SecureProcessResult:
        """Process input text with both detection and sanitization.

        Args:
            text: Input text to process

        Returns:
            SecureProcessResult with all security information
        """
        # First detect injection patterns in original text
        detection = self.detector.detect(text)

        # Then sanitize the text
        sanitization = self.sanitizer.sanitize(text)

        return SecureProcessResult(
            sanitized_text=sanitization.sanitized_text,
            is_suspicious=detection.is_suspicious,
            confidence_penalty=detection.confidence_penalty,
            risk_level=detection.risk_level,
            detected_patterns=detection.detected_patterns,
            was_truncated=sanitization.was_truncated,
        )


def create_secure_sanitizer(max_length: int | None = None) -> SecureSanitizer:
    """Factory function to create a configured SecureSanitizer.

    Args:
        max_length: Optional maximum input length

    Returns:
        Configured SecureSanitizer instance
    """
    return SecureSanitizer(max_length=max_length)
