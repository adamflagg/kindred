"""Money > To place (campership SP11-rest; clean spec §8.1; D12, D16, D26, D58, D62, D81, D104): the
read and its four writes.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
decisions reads; a part's amount comes in exact (D74). No field here is named "awarded" or "Total Awards
Granted" (spec §5.6; a test pins it). A suggestion counts toward nothing until a person confirms it (D12).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

ToPlaceReasonOut = Literal["several", "no_request", "program_mismatch"]
EvidenceKindOut = Literal["amount", "person", "date", "only_request", "proportional"]

_Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
_Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
_RequestId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]{15}$")]
_SourceKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class EvidenceOut(BaseModel):
    kind: EvidenceKindOut
    text: str


class PartOut(BaseModel):
    request_id: str
    amount: float


class TickedOut(BaseModel):
    request_id: str
    round: int
    amount: float


class LeftToTickOut(BaseModel):
    """A round the placement did not tick, and why: the registrar ticks it by hand if that is right."""

    request_id: str
    round: int
    why: str


class NotTickedOut(BaseModel):
    """A round the money covers that the placement does not tick (D16, owner ruling 2026-10-01, refined: option a).
    Something that prices the request was recorded after the day CampMinder posted it, so Kindred can't tell what
    the round was decided at that day. The money is placed anyway; only the automatic tick is withheld. `why` says
    that ticking it, by hand or by the next ledger sync, locks today's decided amount, to check against the offer."""

    transaction_cm_id: int
    request_id: str
    round: int
    posted_on: date
    reasons: list[str]
    why: str


class SuggestionOut(BaseModel):
    """Kindred's suggestion (D12): one part places the whole line, two or more split it. would_tick is what
    confirming it locks, worked out by the same code the write runs (§4.10: the confirmation shows the total
    it locks); would_leave names the rounds it leaves for a person to tick, and why. would_not_tick names the
    rounds the money covers that confirming will NOT tick, from the same check the write runs (D16): the line
    is still placed, and each of those rounds waits for a person to tick it by hand."""

    parts: list[PartOut]
    evidence: list[EvidenceOut]
    would_tick: list[TickedOut] = Field(default_factory=list)
    would_lock: float = 0  # the server's sum of would_tick: the client never adds floats (expected_locked, §4.10)
    would_leave: list[LeftToTickOut] = Field(default_factory=list)
    would_not_tick: list[NotTickedOut] = Field(default_factory=list)


class CandidateOut(BaseModel):
    """A request the line's family holds (D26). not_yet_in_campminder is the part of it not yet in CampMinder:
    its locked total and its decided rounds waiting to be ticked, less the money already placed on it."""

    request_id: str
    household_cm_id: int
    family: str
    person_cm_id: int  # 0 = the household's own request (Family Camp)
    camper: str
    session_cm_id: int
    session: str
    not_yet_in_campminder: float
    cancelled: bool


class ToPlaceLineOut(BaseModel):
    """One camp-aid line no single request takes. `unplaced` is the part of `amount` still at family level.
    `left_note` is set while it is left at family level (D58); `reclassified_to` while a reclassification
    (D104) waits for the next ledger sync."""

    transaction_cm_id: int
    household_cm_id: int
    family: str
    person_cm_id: int  # CampMinder's posted person; 0 = posted to the household
    person: str
    amount: float
    unplaced: float
    posted_on: date | None
    description: str
    reason: ToPlaceReasonOut
    candidates: list[CandidateOut]
    suggestion: SuggestionOut | None
    left_note: str = ""
    reclassified_to: str = ""


class ToPlaceGroupOut(BaseModel):
    reason: ToPlaceReasonOut
    label: str
    count: int
    total: float
    lines: list[ToPlaceLineOut]


class ToPlaceResponse(BaseModel):
    """The open lines by reason, in §8.1's order (every reason listed, empty or not); the lines left at
    family level and those reclassified, apart and not counted. open_count and open_total are Today's
    To place line; open_total, left_total and reclassified_total together are §5.5's "To place" part of
    In CampMinder (net). household_cm_id is set when the read is scoped to one household page (D26)."""

    year: int
    household_cm_id: int | None = None
    open_count: int
    open_total: float
    groups: list[ToPlaceGroupOut]
    left: list[ToPlaceLineOut] = Field(default_factory=list)
    left_total: float = 0
    reclassified: list[ToPlaceLineOut] = Field(default_factory=list)
    reclassified_total: float = 0
    skipped: str = ""


class PlacePartIn(BaseModel):
    request_id: _RequestId
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


class _Parts(BaseModel):
    """Confirm (one part, the whole line) or Split (two or more parts adding up to the line), D12."""

    parts: list[PlacePartIn] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _distinct_requests(self) -> _Parts:
        ids = [p.request_id for p in self.parts]
        if len(set(ids)) != len(ids):
            raise ValueError("each request takes one part")
        return self


# What the confirmation showed it would lock (§4.10: "what you confirm is what's written"). When given, the
# write refuses if the placement would now lock a different total. None: not checked.
_Expected = Annotated[Decimal | None, Field(ge=0, max_digits=12, decimal_places=2)]


class PlaceLineIn(_Parts):
    """One line's Confirm or Split."""

    note: _Note = ""
    expected_locked: _Expected = None


class PlacePreviewIn(_Parts):
    """Split… or Place on another request, before the click (slice 3, ask 8): the parts the person typed, and the
    note they would send (a note alone can make an identical placement a change). Nothing is written."""

    note: _Note = ""


class PlacePreviewOut(BaseModel):
    """What placing these parts would do, worked out by the plan the write runs (§4.10), as SuggestionOut.would_* is
    for Kindred's suggestion. would_lock is the server's sum of would_tick: the place call sends it as expected_locked,
    so a change between the preview and the click is refused rather than written."""

    year: int
    transaction_cm_id: int
    parts: list[PartOut]
    would_tick: list[TickedOut] = Field(default_factory=list)
    would_lock: float = 0
    would_leave: list[LeftToTickOut] = Field(default_factory=list)
    would_not_tick: list[NotTickedOut] = Field(default_factory=list)


class PlaceLinesRow(_Parts):
    transaction_cm_id: int = Field(ge=1)


class PlaceLinesIn(BaseModel):
    """Several lines confirmed at once (D16: "a whole class in bulk"), all or nothing, as one operation."""

    lines: list[PlaceLinesRow] = Field(min_length=1, max_length=200)
    note: _Note = ""
    expected_locked: _Expected = None

    @model_validator(mode="after")
    def _distinct_lines(self) -> PlaceLinesIn:
        ids = [line.transaction_cm_id for line in self.lines]
        if len(set(ids)) != len(ids):
            raise ValueError("each line is placed once")
        return self


class LeaveLineIn(BaseModel):
    note: _Reason


class ReclassifyLineIn(BaseModel):
    """Reclassify (D104): the aid_sources description key the line's money really is, and why."""

    source_key: _SourceKey
    reason: _Reason


class PlaceOut(BaseModel):
    """What a placement did: the lines it placed, the rounds it ticked, and the rounds it left for a person.
    not_ticked: the rounds the money covers whose automatic tick was withheld because something that prices the
    request changed after the posting (D16), each with why and a prompt to tick it by hand."""

    year: int
    operation_id: str
    placed: list[int]
    ticked: list[TickedOut]
    left_to_tick: list[LeftToTickOut]
    not_ticked: list[NotTickedOut] = Field(default_factory=list)
    sections_not_locked: list[str] = Field(default_factory=list)


class ToPlaceWriteOut(BaseModel):
    """What a leave, reopen or reclassify did. A write that changed nothing wrote nothing: operation_id is ""."""

    year: int
    transaction_cm_id: int
    written: int
    operation_id: str
