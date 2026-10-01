"""Keep the milliseconds PocketBase stamps on `created` and `updated`.

The PocketBase Python SDK parses those two fields with `pocketbase.utils.to_datetime`, which cuts the
fraction off ("2027-02-01 18:00:00.011Z" becomes 18:00:00). Two events on one request in the same second
then replayed in record-id order, not time order: a hold lifted 9 ms after it was placed still read held.
The raw string is gone once the model is built (BaseModel.load pops it), so the fix is at the one parse:
`install()` swaps the SDK's base model's parser for one that keeps the fraction. Same type back (a naive
datetime, read as UTC by `parse_pb_datetime`), more precision, and a value it can't parse still comes back
as the SDK would have returned it. Every aid replay reads `created` through the SDK model, so this one
swap serves them all. Imported by `financial_aid_ledger_service` (home of `parse_pb_datetime`) and by
`api.dependencies` (which builds the client)."""

from __future__ import annotations

import datetime
from typing import Final

import pocketbase.models.base_model as base_model
from pocketbase.utils import to_datetime as sdk_to_datetime

_FORMATS: Final = ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S")


def precise_to_datetime(str_datetime: str, format: str = "%Y-%m-%d %H:%M:%S") -> datetime.datetime | str:
    """The SDK's `to_datetime`, keeping the fraction of a second a PocketBase timestamp carries."""
    if isinstance(str_datetime, str) and format == "%Y-%m-%d %H:%M:%S":
        text = str_datetime.strip().removesuffix("Z")
        for fmt in _FORMATS:
            try:
                return datetime.datetime.strptime(text, fmt)
            except ValueError:
                continue
    return sdk_to_datetime(str_datetime, format)


def install() -> None:
    """Idempotent: point the SDK's base model at the precise parser."""
    base_model.to_datetime = precise_to_datetime  # type: ignore[attr-defined]  # a module attribute the SDK imports by name


install()
