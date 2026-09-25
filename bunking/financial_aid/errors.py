"""The one base class for financial-aid domain errors.

The rules service, the rules lifecycle and the calculator raise subclasses of
FinancialAidError, so a router can map every domain refusal with one `except`
without also catching pydantic's ValidationError (a ValueError). Each subclass
keeps its older builtin base as well (ValueError, LookupError, KeyError), so
existing callers that catch those still work.
"""

from __future__ import annotations


class FinancialAidError(Exception):
    """A financial-aid domain error: the request is understood and refused."""
