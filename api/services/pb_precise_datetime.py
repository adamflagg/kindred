"""Keep the milliseconds PocketBase stamps on `created` and `updated`, for the aid reads.

The PocketBase Python SDK parses those two fields with `pocketbase.utils.to_datetime`, which cuts the
fraction off ("2027-02-01 18:00:00.011Z" becomes 18:00:00). Two events on one request in the same second
then replayed in record-id order, not time order: a hold lifted 9 ms after it was placed still read held.
The SDK pops the raw string while it builds the model, so the fix sits in the service that builds it:
`PreciseRecordService.decode` keeps the two raw strings, lets the SDK build the record as usual, then sets
`created` and `updated` from the raw strings with the fraction kept. Same type back (a naive datetime, read
as UTC by `parse_pb_datetime`), and a value it can't parse stays as the SDK parsed it.

Only the aid reads use it, through `aid_collection` (nothing else in the app changes). Every aid replay reads
`created` off a record those helpers list, so the helper at each aid list call serves them all."""

from __future__ import annotations

import datetime
from typing import Any, Final

from pocketbase.models.record import Record
from pocketbase.services.record_service import RecordService

from pocketbase import PocketBase

_FORMATS: Final = ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S")
_STAMPS: Final = ("created", "updated")


def precise_datetime(value: Any) -> datetime.datetime | None:
    """A PocketBase timestamp ("YYYY-MM-DD HH:MM:SS.mmmZ") with its fraction, naive UTC; None when it isn't one."""
    if not isinstance(value, str):
        return None
    text = value.strip().removesuffix("Z")
    for fmt in _FORMATS:
        try:
            return datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


class PreciseRecordService(RecordService):
    """A RecordService whose records keep the milliseconds of `created` and `updated`."""

    def decode(self, data: dict[str, Any]) -> Record:
        raw = {name: data.get(name) for name in _STAMPS}  # the SDK pops them while it builds the record
        record = super().decode(data)
        for name, value in raw.items():
            stamp = precise_datetime(value)
            if stamp is not None:
                setattr(record, name, stamp)
        return record


def aid_collection(pb: Any, name: str) -> Any:
    """`pb.collection(name)`, with milliseconds kept on a real PocketBase client; anything else (a test double)
    answers as it always did."""
    if isinstance(pb, PocketBase):
        return PreciseRecordService(pb, name)
    return pb.collection(name)
