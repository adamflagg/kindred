"""A scenario's request set: the requests received through a date (sub-project 9b; clean spec §7.4, §9.2; D129,
D138). Pure.

One of the two reporting controls that replace the sheet's manual Include freeze, for modeling:

  "Through the Round 1 deadline"  only requests received by the season's Round 1 application deadline
                                  (`milestones.application_deadline` in the approved rules);
  "Received through <date>"       only requests received on or before a chosen date.

Off by default, applied only when a figure is read. When on, every figure it affects carries a `RequestSetNote`,
whose label reads "requests received through <date>". It never changes a family's record, Include, decisions or audit
history, and never touches Rounds & budget or the Remaining line. What "received" means, and the split by date, live in
bunking.financial_aid.received, shared with the Reports "received through" filter.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.received import RequestSplit

RequestSetBasis = Literal["round1_deadline", "date"]


@dataclass(frozen=True)
class RequestSet:
    basis: RequestSetBasis
    through: date  # inclusive, camp time

    @property
    def label(self) -> str:
        return f"requests received through {self.through:%b} {self.through.day}, {self.through.year}"


class RequestSetNote(BaseModel):
    """The request set a scenario's figures were priced on: what every affected figure is labelled with."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    basis: RequestSetBasis
    through: date
    label: str
    left_out: int  # live requests first recorded after the date
    unknown: int  # live requests with no recorded received date: left out too


def request_set_note(request_set: RequestSet, split: RequestSplit) -> RequestSetNote:
    return RequestSetNote(
        basis=request_set.basis,
        through=request_set.through,
        label=request_set.label,
        left_out=len(split.after),
        unknown=len(split.unknown),
    )
