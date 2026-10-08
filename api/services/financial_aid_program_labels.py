"""Program-family labels for the Camperships screens: the season's rules name every program (programs.<key>.label),
and a posting's program family is that same key. Screens show the label, never the key spelled out. Reads that
carry no rules, or a bucket the rules don't name (ambiguous, unattributed), give ""."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bunking.financial_aid.rules.schema import AidRules

ProgramLabelLoader = Callable[[int], Awaitable[Mapping[str, str]]]


def program_labels(document: AidRules | None) -> dict[str, str]:
    """program key -> the rules' label for it; empty when the season has no rules."""
    if document is None:
        return {}
    return {key: program.label for key, program in document.programs.items()}
