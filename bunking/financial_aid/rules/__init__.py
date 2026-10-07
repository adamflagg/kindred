"""The per-season financial-aid rules document, its validation and its lookups."""

from bunking.financial_aid.rules.lookup import resolve_program, resolved_table, round1_table, round2_table
from bunking.financial_aid.rules.schema import SECTION_NAMES, AidRules, SectionName
from bunking.financial_aid.rules.validation import (
    SessionRef,
    ValidationContext,
    ValidationIssue,
    ValidationReport,
    validate_rules,
)

__all__ = [
    "SECTION_NAMES",
    "AidRules",
    "SectionName",
    "SessionRef",
    "ValidationContext",
    "ValidationIssue",
    "ValidationReport",
    "resolve_program",
    "resolved_table",
    "round1_table",
    "round2_table",
    "validate_rules",
]
