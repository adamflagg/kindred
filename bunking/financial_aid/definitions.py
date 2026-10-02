"""The definitions registry (clean spec §4.8, D20): the numbered notes at the bottom of every
Camperships surface that shows money come from here, and so will Reports › Development's.

Each note is condensed from the clean spec's §5 signed text, opening with the term it defines, with
these substitutions: a staff member is named by role, the camp's name is the `{camp}` placeholder
(render() fills it from branding), and named funders or outside programs are paraphrased. A plan never
redefines one of these (§5's preamble); a new figure gets a new entry with its own sign-off. SURFACES says
which notes a surface shows, in the order they are numbered there; a later slice adds its surface here with
its plan.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Final


@dataclass(frozen=True)
class Definition:
    key: str
    term: str
    text: str  # the whole note, opening with `term`
    spec: str  # the clean spec section that holds the signed meaning
    rulings: tuple[str, ...]


DEFINITIONS: Final[tuple[Definition, ...]] = (
    Definition(
        key="decided",
        term="Decided",
        text=(
            "Decided: the award Kindred computed or staff decided for a request's round. It is live until the "
            "round locks: income corrections, a new rules version or a grant can move it. It is never labelled "
            '"awarded", which means Posted.'
        ),
        spec="§5.1",
        rulings=("D43", "D80"),
    ),
    Definition(
        key="posted",
        term="Posted",
        text=(
            "Posted: the round's Posted tick and the amount it locked. Posting in CampMinder is the offer. The "
            "tick is set by the registrar after entering the award in CampMinder, or by the overnight ledger "
            'sync when the registrar didn\'t. There is one "Posted", never two figures.'
        ),
        spec="§5.1",
        rulings=("D47", "D51", "D52", "D59", "D78"),
    ),
    Definition(
        key="confirmation",
        term="Confirmation",
        text=(
            "Confirmation, beside every Posted figure: awaiting tonight's sync, then confirmed (date); "
            '"CampMinder shows $X · short $Y" or "· over $Y" when it disagrees; not in CampMinder (ticked, '
            "nothing posted after the sync). It is computed by net-total reconciliation of live camp-aid lines "
            "placed on the request against the locked amount, at family level where a line can't be placed on "
            "a request, and per payer share. Exact to the cent."
        ),
        spec="§5.1",
        rulings=("D59", "D74"),
    ),
    Definition(
        key="would_change_by",
        term="Would change by",
        text=(
            "Would change by: after the lock, a later change (rules, cost, a late grant, a correction) never "
            'rewrites the decision. It raises "would change by $X", information only once the family is told '
            "(no clawback)."
        ),
        spec="§5.1",
        rulings=("D43",),
    ),
    Definition(
        key="cost",
        term="Cost",
        text=(
            "Cost: each request's cost, the session's list price; Family Camp by headcount. Aid is a percentage "
            "of list price: discounts CampMinder bills are not read."
        ),
        spec="§5.8",
        rulings=("D77", "D118"),
    ),
    Definition(
        key="grants",
        term="Grants",
        text=(
            "Grants: the known grants on the family's included requests, live outside-grant lines in CampMinder "
            "plus grants hand-entered as committed but not yet posted. Expected grants never count."
        ),
        spec="§5.8",
        rulings=("D55", "D77", "D116"),
    ),
    Definition(
        key="family_share",
        term="Family's share",
        text=(
            "Family's share = cost − {camp} aid (decided) − grants, over the family's included requests. It is "
            "not a balance: CampMinder's balance also holds payments, deposits and other charges. For a split "
            "family it is the family total."
        ),
        spec="§5.8",
        rulings=("D77", "D118"),
    ),
    Definition(
        key="allocated",
        term="Allocated",
        text=(
            "Allocated: the round's allocation from the approved rules, per pool. Unused reserves stay inside "
            "each round's allocation. Only the total budget is hard; the pool split is finance's soft setting."
        ),
        spec="§5.3",
        rulings=("D44", "D119"),
    ),
    Definition(
        key="accepted",
        term="Accepted",
        text=(
            "Accepted: the locked amounts of posted rounds whose Accepted tick is set, less any round whose "
            "clawback has posted. Shown, never subtracted."
        ),
        spec="§5.3",
        rulings=("D44", "D53"),
    ),
    Definition(
        key="needs_offer",
        term="Needs an offer",
        text="Needs an offer: the decided amounts of rounds decided but not yet posted (money spoken for).",
        spec="§5.3",
        rulings=("D42", "D44", "D51"),
    ),
    Definition(
        key="pending_approval",
        term="Pending approval",
        text=(
            "Pending approval: a Round 3 above +$300 keyed by the registrar and awaiting finance, at its keyed "
            "amount. It is its own line under Round 3, not part of Needs an offer; on approval it moves to Needs "
            "an offer, on refusal it leaves."
        ),
        spec="§5.3",
        rulings=("D79",),
    ),
    Definition(
        key="budget_posted",
        term="Posted",
        text=(
            "Posted: the locked amounts of every posted round, less any round whose clawback has posted (its "
            "money returns to Remaining when the reversing debit posts)."
        ),
        spec="§5.3",
        rulings=("D44", "D51", "D54"),
    ),
    Definition(
        key="remaining",
        term="Remaining",
        text=(
            "Remaining = Allocated − Posted − Needs an offer − Pending approval, per pool and round and in "
            "total. Accepted is shown, never subtracted."
        ),
        spec="§5.3",
        rulings=("D44", "D53", "D79"),
    ),
    Definition(
        key="below_the_line",
        term="Below the line",
        text=(
            "Below the line, visible, never counted in Remaining: outside grants, money outside {camp}'s budget, "
            "and held requests (amount unknown)."
        ),
        spec="§5.3",
        rulings=("D44", "D121"),
    ),
    Definition(
        key="in_campminder_net",
        term="In CampMinder (net)",
        text=(
            "In CampMinder (net): the family's live CampMinder camp-aid lines this season (lines Money › Sources "
            "classes as camp aid, after any reclassifying override), across the households in the page scope, "
            "net of reversals. Outside grants are a separate column and are not in it. It is not Posted."
        ),
        spec="§5.5",
        rulings=("D26", "D58", "D59"),
    ),
    Definition(
        key="round2_asks",
        term="Round 2 asks so far",
        text=(
            "Round 2 asks so far: the appeals keyed so far on live requests (not cancelled, in Kindred or in "
            "CampMinder, withdrawn or a duplicate), counted, with their total ask, held appeals' asks included, and "
            "the total computed for those decided or posted. It knows only the appeals keyed so far. Shown below "
            "the line, never counted in Remaining."
        ),
        spec="§5.9",
        rulings=("D82",),
    ),
    Definition(
        key="round1_unmet",
        term="Round 1 unmet ask, not yet appealed",
        text=(
            "Round 1 unmet ask, not yet appealed: Σ (the family's Round 1 ask − its Round 1 decided award) over "
            "live requests with no Round 2 ask keyed yet, plus held Round 1 requests' asks, per pool. It is demand "
            "that can still come back as appeals: shown below the line, never counted in Remaining. Rounds outside "
            "the budget don't count, offers that were clawed back don't count, and each family's gap is floored at "
            "$0, so one family's overage never offsets another's unmet ask."
        ),
        spec="§5.9",
        rulings=("D82",),
    ),
    Definition(
        key="unconfirmed",
        term="Not yet confirmed",
        text=(
            "Not yet confirmed, the amber line under Posted: the part of each posted round's locked amount that "
            "CampMinder's live camp aid on the request doesn't cover yet. The live net fills the request's posted "
            "rounds oldest round first, each payer share from its own household's lines. Money beyond the locked "
            "total confirms nothing more and stays in Requests › Not reconciled. Remaining still subtracts all of "
            "Posted."
        ),
        spec="§7.2",
        rulings=("D59", "D153"),
    ),
)

# The notes each surface shows, numbered from 1 in this order (§4.8). A surface not listed here is unknown.
SURFACES: Final[Mapping[str, tuple[str, ...]]] = {
    "requests": ("decided", "posted", "confirmation", "would_change_by", "cost"),
    "household": ("cost", "decided", "grants", "family_share", "posted", "confirmation", "would_change_by"),
    "season-rounds-budget": (
        "allocated",
        "budget_posted",
        "accepted",
        "needs_offer",
        "pending_approval",
        "remaining",
        "below_the_line",
        "round2_asks",
        "round1_unmet",
        "unconfirmed",
    ),
    "money-ledger": ("in_campminder_net", "posted"),
}

BY_KEY: Final[Mapping[str, Definition]] = {d.key: d for d in DEFINITIONS}


def render(definition: Definition, *, camp: str) -> Definition:
    """The definition with the camp's name filled in."""
    return replace(
        definition, term=definition.term.replace("{camp}", camp), text=definition.text.replace("{camp}", camp)
    )
