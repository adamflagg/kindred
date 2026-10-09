"""Money > Ledger's family read and the lines behind its totals (campership slice 3, ask 1; clean spec §5.5, §8.1;
D26, D54, D74, D97, D151). Amounts are aid dollars, positive; a reversed line is listed, never netted."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel

from api.schemas.financial_aid import SourceFamily
from api.schemas.financial_aid_decisions import AsOfAxis
from api.schemas.source_family_labels import SourceFamilyLabelled

LedgerLevelOut = Literal["household", "left", "no_request", "program_mismatch"]
LedgerTotalOut = Literal["in_campminder_net", "outside_grants"]
# The Ledger's source filter: one source family, or "outside": every line of the Outside grants column (each funder
# that isn't the camp's own aid: outside, incentive, unclassified), whatever its source family.
LedgerSourceFilter = Literal[SourceFamily, "outside"]


class LedgerSessionOut(BaseModel):
    """A session a household-level (Family Camp) request is for: the client shortens `name` by `session_type`."""

    name: str
    session_type: str


class LedgerFamilyOut(BaseModel):
    household_cm_id: int  # the family's row opens this household's page: its applying household with the lowest id
    family_households: list[int]  # every household in the family (D26): that household first, then by id
    display_name: str
    campers: list[str]  # the campers its lines name, by name
    in_campminder_net: float  # its live camp-aid lines (funder type camp, after reclassification), net of reversals
    outside_grants: float  # its live lines of every other funder: outside, incentive (D97), unclassified
    lines: int  # its lines by the read's day, reversed ones included (D74)
    reversed_lines: int  # how many of those were reversed by then
    # Where a live camp-aid line isn't on a request (D151). None: none waits off a request (every camp-aid line is on
    # one, or it has only outside or reversed lines), or a season before FIRST_TICKED_SEASON (no levels at all).
    level: LedgerLevelOut | None
    # Ruling D (owner 10-06): the family as the household page names its household (household_cm_id; household_labels:
    # as a household with no camper on the page), and its muted tie-breaker: "" unless another row here reads the same.
    label: str = ""
    label_tiebreak: str = ""
    # The sessions of the household-level requests (person_cm_id 0) its lines are placed on, by start day, once each;
    # empty for a family whose lines sit on camper requests (the mock's household mark and "FC4 · household").
    household_sessions: list[LedgerSessionOut] = []


class MoneyLedgerOut(BaseModel):
    year: int
    as_of: date | None = None  # None: live. Else the past day shown (end of that day, camp time)
    as_of_axis: AsOfAxis | None = None  # the axis a past read cut on; None: live
    rows: list[LedgerFamilyOut]
    in_campminder_net: float  # the rows' sum
    outside_grants: float  # the rows' sum


class LedgerLineOut(SourceFamilyLabelled):
    transaction_cm_id: int
    household_cm_id: int  # the household CampMinder posted it to
    family_household_cm_id: int  # the family row it sits in (that row's household_cm_id)
    family_name: str
    camper: str  # the camper(s) it names, ", "-joined; "" when it names none
    description: str  # CampMinder's description, after any reclassification
    source_family: str
    program: str  # its request's program when Kindred placed it; else CampMinder's attribution; "" for none
    program_label: str = ""  # the season's rules label for that program; "" for none or one the rules don't name
    amount: float  # the part of the line in this total (every part of a split line that passes the filters)
    posted_on: date | None  # camp time
    is_reversed: bool  # reversed by the read's day: shown struck through, left out of `amount` (D54, D74)
    reversed_on: date | None
    level: LedgerLevelOut | None
    household_session: LedgerSessionOut | None = None  # the session of the household request it is placed on


class MoneyLedgerLinesOut(BaseModel):
    year: int
    as_of: date | None = None
    as_of_axis: AsOfAxis | None = None
    total: LedgerTotalOut
    amount: float  # the sum of the lines that are not reversed: equals the family read's footer total
    lines: list[LedgerLineOut]
