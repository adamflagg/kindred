"""Slice 1's reads (clean spec §12.2 "Slice 1's own reads"; §3.5, §4.8, §6.4): the definitions
registry, the jump-box index and Today. The household page is api/schemas/financial_aid_household_page.py.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
decisions, grants and ledger reads. None is "nothing there"; 0 is a real zero (D74). Counts of work
(Today) carry no basis word and no definition (D20).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --- the definitions registry (§4.8, D20) ---------------------------------------------------------


class DefinitionNoteOut(BaseModel):
    """One numbered note: a signed meaning (§5), the camp's name filled in, numbered from 1 on its surface."""

    key: str
    n: int
    text: str


class DefinitionsResponse(BaseModel):
    surface: str
    notes: list[DefinitionNoteOut]


# --- the jump box's index (§3.5, D13, D27) ---------------------------------------------------------


class JumpIndexPerson(BaseModel):
    """A camper (with a request, a posting or a commitment in the household) or a parent its records name.
    A parent has no CampMinder id here (the camper record's parent names carry none): person_cm_id None."""

    person_cm_id: int | None
    name: str  # "" when a camper isn't in this season's persons: the id still finds the household
    role: Literal["camper", "parent"]


class JumpIndexHousehold(BaseModel):
    """One household with aid activity this season: an application, a request or a payer share, a posting
    (live or reversed) or a grant commitment. The browser matches the family name, a person's name or either
    CampMinder id, and Enter opens /aid/households/:household_cm_id."""

    household_cm_id: int
    family_name: str
    people: list[JumpIndexPerson]


class JumpIndexResponse(BaseModel):
    year: int
    households: list[JumpIndexHousehold]


# --- Today (§6.4, D24) --------------------------------------------------------------------------------

TodayKey = Literal[
    # casework (financial_aid.casework)
    "needs_offer",
    "holds",
    "waiting_on_family",
    "not_reconciled",
    "to_reverse",
    "session_not_settled",
    "duplicates",
    "cancel_reason",
    "to_place",
    "grants",
    "late_full_coverage",
    # finance (financial_aid.rules)
    "pending_approval",
    "rules_sections",
    "would_change",
    "sources",
    "intake",
    "equity_field_never_true",
]
TodayItemKind = Literal["requests", "grants", "sections", "descriptions", "fields", "lines"]


class TodayReasonOut(BaseModel):
    """One reason inside a line ("income conflict 3 · payer shares 1"): a hold code, a round (r1, r2, r3),
    a confirmation state, a grant's reason, a rules section or a description's state. `label` is the equity criterion's name on an
    equity_field_never_true reason (the code is a yes/no field); None on every other reason."""

    code: str
    families: int | None
    items: int
    label: str | None = None


class TodayLineOut(BaseModel):
    """One queue's dense line: "5 fam · 7 req", its reasons inline, and Open › to the view that lists
    exactly these rows. `families` is None where a line has no family (rules sections, descriptions).
    A line that is no Requests view (late_full_coverage, would_change, intake) names its `request_ids`.
    Reasons need not sum to `items`: a request Not reconciled on two payer shares counts once in items and
    under each share's state."""

    key: TodayKey
    families: int | None
    items: int
    item_kind: TodayItemKind
    reasons: list[TodayReasonOut] = Field(default_factory=list)
    amount: float | None = None  # pending_approval: the keyed amounts awaiting finance (D79)
    oldest_days: int | None = None  # waiting_on_family: days since the oldest waiting round was posted
    over_14_days: int | None = None  # waiting_on_family: requests waiting more than 14 days
    largest_gap: float | None = None  # not_reconciled: the largest short or over, in dollars (positive)
    request_ids: list[str] = Field(default_factory=list)  # what Open › shows, for a line that is no view
    skipped: str = ""  # to_place: why To place has nothing this season (before 2027, SP11 Decision 12); else ""


class TodayResponse(BaseModel):
    """Today's sections follow the user's permissions: casework None without financial_aid.casework,
    finance None without financial_aid.rules."""

    year: int
    casework: list[TodayLineOut] | None
    finance: list[TodayLineOut] | None


class HouseholdMatchOut(BaseModel):
    """One household the Add-a-link picker can name (owner F3 #27; §6.3 †): its CampMinder id and name, the people on
    its record this season, the family keys it is linked under (aid_household_links, excluded rows left out), and the
    other households those keys join."""

    household_cm_id: int
    family_name: str
    people: list[str]
    family_keys: list[str]
    linked_household_cm_ids: list[int]


class HouseholdSearchResponse(BaseModel):
    year: int
    matches: list[HouseholdMatchOut]  # by family name, then id; at most MAX_MATCHES
    truncated: bool  # more households matched than are listed: type more of the name
