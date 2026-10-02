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
    # Reports (slice 4's back end, Part A): finance's report words (§5.6). "Awarded" labels money here only.
    Definition(
        key="apps",
        term="Applications",
        text=(
            "Applications: individual requests (camper × session; household × session for Family Camp). Received = "
            "every intake request except refused duplicates, cancelled requests included."
        ),
        spec="§5.6",
        rulings=("D72", "D131"),
    ),
    Definition(
        key="cancelled_applicants",
        term="Cancelled applicants",
        text=(
            "Cancelled applicants: received requests later cancelled, shown as their own line beside applications; "
            "applications keep their meaning."
        ),
        spec="§5.6",
        rulings=("D131",),
    ),
    Definition(
        key="awarded",
        term="Awarded",
        text=(
            "Awarded = offered = Posted: a round counts as awarded once it is posted (ticked or auto-ticked), net of "
            "any clawback, on a live request (not cancelled, withdrawn or a pending duplicate). {camp}'s own aid only, never Total Awards Granted. Liveness comes "
            "from the request's status: a cancelled request leaves it at once, while Rounds & budget's Posted keeps "
            "its money until the reversal posts."
        ),
        spec="§5.6",
        rulings=("D80", "D106", "D129", "D131"),
    ),
    Definition(
        key="average_award",
        term="Average award",
        text=(
            "Average award: awarded $ ÷ the awarded count. The 2026 sheet and the committee decks divide by all apps, "
            "$0 included, so this figure reads higher."
        ),
        spec="§5.6",
        rulings=("D80",),
    ),
    Definition(
        key="pct_of_ask",
        term="% of ask",
        text=(
            "% of ask: awarded $ ÷ the live requests' in-budget asks: each round's ask as keyed and as it stands "
            "today, on live requests (not cancelled, withdrawn or a pending duplicate). It is not the asked or requested total, which sums every "
            "app's ask, cancelled and closed ones included. A round paid wholly by an outside funder is never awarded, so its "
            'ask is left out of the in-budget asks this divides by. With "include not yet offered" on, the awarded $ '
            'is Posted + Decided, and the column reads "% of ask (posted + decided)".'
        ),
        spec="§5.6",
        rulings=("D80",),
    ),
    Definition(
        key="decided_not_offered",
        term="Decided (not yet offered)",
        text=(
            "Decided (not yet offered): behind an off-by-default switch, the amounts decided but not yet posted are "
            "added, one basis at a time. They are never called awarded, and each moves until posted: rules versions "
            "and income corrections can change it."
        ),
        spec="§5.1",
        rulings=("D43", "D130"),
    ),
    Definition(
        key="recipients_cancelled",
        term="Aid recipients who cancelled",
        text=(
            "Aid recipients who cancelled: requests with a posted award later cancelled, or withdrawn, by cancel reason, "
            "pool and round. A withdrawn request that holds a posted award counts here exactly as a cancelled one does. "
            "Once cancelled a request is out of awarded already."
        ),
        spec="§5.6",
        rulings=("D101", "D131", "D141"),
    ),
    Definition(
        key="finance_budget",
        term="Budget",
        text=(
            "Budget: {camp}'s own Total FA budget, the one finance and the board approved. Only the total is hard; "
            "the pool split is finance's soft setting."
        ),
        spec="§5.6",
        rulings=("D106", "D119"),
    ),
    Definition(
        key="as_reported",
        term="As reported (r)",
        text=(
            "As reported (r): finance's own history from before Kindred had the data, typed once as dollars and "
            "counts with an as-of date. Kindred computes every percentage."
        ),
        spec="§5.6",
        rulings=("D132", "D133"),
    ),
    Definition(
        key="round1_phases",
        term="Round 1 phases",
        text=(
            "Round 1 phases: phase 1 is Round 1 money on requests received by the application deadline; phase 2 is "
            "Round 1 money on requests received after it; phase 3 is appeals (Rounds 2 and 3). A request received "
            "on time but posted later stays in phase 1. Each phase has two columns. As offered: the lock as posted "
            "(D80's awarded = offered); a later cancellation, withdrawal or clawback never reduces it, and a round "
            "outside the budget (an outside funder's full-cost round) is in neither column; for a season finance "
            "typed, the deck's figure and its as-of date. End of season: net of cancellations and clawback; for a "
            'season Kindred priced it reads "to date" until the season closes, meaning the last session open to aid '
            "(summer, family camp and adult weekends alike) has ended; for a typed season, the end-of-season total. "
            "A blank stays blank: nothing is estimated, and one column is never filled from the other. Each column is "
            "shown as a % of the season's total budget and as its share of the three phases; the target bands compare "
            'against As offered; the total, the over/under and "total − Σ phases" are End of season\'s.'
        ),
        spec="§9.7",
        rulings=("D155",),
    ),
    Definition(
        key="appeals",
        term="Appeals",
        text=(
            "Appeals: the appeal rate and each tier's appeals count every request with a Round 2 or later ask, "
            "cancelled ones included, because the rate divides by applications, which include cancellations (D131). "
            "The outcomes table and the Season screen's Round 2 asks leave cancelled requests out."
        ),
        spec="§9.7",
        rulings=("D131",),
    ),
    # Slice 4 ask 4: the Statistics columns that had no note (§9.2, §9.7 RPT-9).
    Definition(
        key="pct_of_ask_with_grants",
        term="% of ask incl. grants",
        text=(
            "% of ask incl. grants: awarded $ plus the counting outside grants placed on the live requests, ÷ the "
            "live requests' asks, including rounds an outside funder pays in full (outside-funded asks stay in its "
            "denominator, unlike % of ask). It is the 2026 sheet's total % of ask granted. Round 1 and All rounds only: a grant belongs to the request, not to a round. With "
            '"include not yet offered" on, the awarded $ is Posted + Decided, and the column reads "% of ask incl. '
            'grants (posted + decided)".'
        ),
        spec="§9.2",
        rulings=("D80", "D116", "D132"),
    ),
    Definition(
        key="round2_max_pct",
        term="Round 2 max %",
        text=(
            "Round 2 max %: each tier's appeal cap in the rules version the read prices with: the most Round 1 and "
            "Round 2 aid together may cover, as a % of the session's cost. It is a rules value, not an outcome: no "
            "request's award is read to make it. It is blank on All award tables, on the totals row, and where the "
            "table's programs use no Round 2 table or more than one."
        ),
        spec="§9.7",
        rulings=("D132",),
    ),
    Definition(
        key="appeal_rate",
        term="Appeal rate",
        text=(
            "Appeal rate: appeals ÷ Round 1 apps, per tier and in total, with a tier's appeals counted at their "
            "Round 2 tier and its apps at Round 1's. Kindred derives it; no deck gives it per tier. As in Appeals, "
            "cancelled requests count on both sides. It is not development's appeals figure."
        ),
        spec="§9.7",
        rulings=("D131", "D132"),
    ),
    # Reports › Development (Part B): development's one all-money basis (§5.7, §5.10, §5.11).
    Definition(
        key="basis_unconfirmed",
        term="Basis unconfirmed",
        text=(
            "Basis unconfirmed: a 2022–2025 column shows the figures development already sent funders, typed once. "
            "Kindred counts all money ({camp}'s aid plus every outside grant), and those years may have counted "
            "{camp}'s own aid only (O-930-1). Until that is settled, comparing such a column with 2026 or later "
            "may compare two bases. This note is Kindred's interim default, not a ruling."
        ),
        spec="§5.7",
        rulings=("D96",),
    ),
    Definition(
        key="total_awards_granted",
        term="Total Awards Granted",
        text=(
            "Total Awards Granted: all money given out for camperships, together: {camp}'s awarded amounts and every "
            "outside grant. Every outside grant is an award, and the counts follow the same money."
        ),
        spec="§5.7",
        rulings=("D87", "D88"),
    ),
    Definition(
        key="need",
        term="Need",
        text=(
            "Need: {camp}'s awards in the rounds before the latest ask + the latest ask, never less than any earlier "
            "ask's own figure. Total Requests = Σ need of the live requests of campers who attended; a cancelled or closed request and outside grants are never in it. % "
            "of need met (Summer and Quest) = Σ min(all money the camper got, the camper's need) ÷ Σ need."
        ),
        spec="§5.10",
        rulings=("D91",),
    ),
    Definition(
        key="dev_recipients",
        term="Who counts",
        text=(
            "Who counts: campers who attended (CampMinder status 2) and got money from any source, including campers "
            "who never applied. A cancelled camper, or one who got nothing, is not counted. A camper counts once per "
            "program; Weekend counts families. Only attendees of aid-eligible sessions (those a program open to aid claims "
            "this season) are in these groups: someone who attended only a session that is not aid-eligible is not "
            "counted anywhere. An outside grant on a session that is not aid-eligible still counts when the same "
            "person also attended an aid-eligible session in that group."
        ),
        spec="§5.11",
        rulings=("D92",),
    ),
    # Reports › Development › Funding sources (Part C).
    Definition(
        key="source_facts",
        term="Three facts",
        text=(
            "Three facts: every source is listed by name with who paid ({camp} or another funder), whether it is an "
            "incentive or need-based (a per-source flag, never funder_type), and the source itself. Each outside "
            "source names its reporting group, one of the season's budget pools."
        ),
        spec="§5.7",
        rulings=("D88", "D100"),
    ),
    Definition(
        key="zip_who_counts",
        term="Who counts",
        text=(
            "Who counts: the every-family table counts households with an attendee in an aid-eligible session (one "
            "a program open to aid claims this season) in the chosen group (the summer group unless another, or all "
            "groups, is picked), with those attendees; the recipient table is the subset of them that received aid, "
            "with its dollars. Someone who attended only a session that is not aid-eligible is not counted in either "
            "table. A ZIP with one family shows as it is; no family is ever a row."
        ),
        spec="§9.4",
        rulings=("D90",),
    ),
    Definition(
        key="teens",
        term="Teens",
        text=(
            "Teens: Summer Camp and Quest campers aged 13–17 on the first day of their first session in that program. "
            "Youth are 0–12."
        ),
        spec="§5.11",
        rulings=("D89", "D103"),
    ),
    Definition(
        key="dev_families",
        term="Families",
        text=(
            "Families: each CampMinder household counts once, and the report says how many households share a "
            "camper. Family Camp counts the households that attended and got money."
        ),
        spec="§5.11",
        rulings=("D93",),
    ),
    Definition(
        key="gender",
        term="Gender",
        text=(
            "Gender: CampMinder's Gender Identity, for aid recipients and everyone enrolled. A write-in shows as "
            "self-described and a blank as not given."
        ),
        spec="§5.11",
        rulings=("D94",),
    ),
    Definition(
        key="first_time",
        term="First-time",
        text=(
            "First-time depends on who is asking: a grantor's or donor's own definition decides it, so each "
            "first-time line states its definition."
        ),
        spec="§5.11",
        rulings=("D99",),
    ),
    Definition(
        key="dev_appeals",
        term="Appeals",
        text=(
            "Appeals: an ask in Round 2 or any later round, for a camper who attended, counted once per request. "
            "Approved = a posted award above $0 in those rounds, in full or in part. Declined due to insufficient aid "
            "= requests cancelled with that reason. Since D158 every cancel-reason line includes campers who didn't attend."
        ),
        spec="§5.11",
        rulings=("D101", "D141"),
    ),
    Definition(
        key="household_level",
        term="Household-level grants",
        text=(
            "Household-level grants: a never-applied household's grant is tied to a camper only when the household "
            "has exactly one eligible camper; otherwise it stays household-level, and the camper counts show it as "
            "household-level and say by how much. Money totals and family counts are exact either way."
        ),
        spec="§5.11",
        rulings=("D142",),
    ),
    # Money › To place (slice 3; PENDING OWNER, owner question 4).
    Definition(
        key="not_yet_in_campminder",
        term="Not yet in CampMinder",
        text=(
            "Not yet in CampMinder: a candidate request's locked total, plus the decided amounts of its rounds waiting "
            "to be ticked (oldest first, up to the first round that can't be ticked), less the live camp-aid money "
            "already placed on it. It is what To place weighs a line "
            "against; it redefines nothing."
        ),
        spec="§8.1",
        rulings=("D151",),
    ),
    Definition(
        key="to_place_suggestion",
        term="Suggestion",
        text=(
            "Suggestion: Kindred's proposed placement or split of a line, with its evidence (an exact amount match, "
            "the person on the line, the date, or a split in proportion to the decided amounts). It counts toward "
            "nothing until a person confirms it, and Kindred never chooses between equal matches."
        ),
        spec="§8.1",
        rulings=("D12", "D16"),
    ),
    Definition(
        key="placement_tick",
        term="A placement's tick",
        text=(
            "A placement's tick: placing a line ticks Posted on the rounds the placed money covers in full, oldest "
            "first, at their decided amounts as of the posting date. If anything that prices the request was "
            "recorded since that posting, the money is still placed but the automatic tick is refused, and the "
            "registrar ticks by hand. The tick never reads awaiting tonight's sync: the money is already in CampMinder."
        ),
        spec="§5.1",
        rulings=("D81", "D146", "D151", "D152"),
    ),
    # Money › Sources (slice 3; PENDING OWNER, owner question 4). The three facts are #2967's source_facts.
    Definition(
        key="reporting_group",
        term="Reporting group",
        text=(
            "Reporting group: the season's budget pool, or programs within it, that an outside source funds. The "
            "ledger places a household-level grant line with it. An outside source with none needs a group, here and "
            "on Today. Changing it re-places household-level lines on the next sync."
        ),
        spec="§8.1",
        rulings=("D95", "D100", "D159"),
    ),
    Definition(
        key="source_lines",
        term="Lines this season",
        text=(
            "Lines this season: the season's live CampMinder lines a description classifies, after any reclassifying "
            "override, and their net. A reversed line is left out."
        ),
        spec="§5.5",
        rulings=("D58", "D74"),
    ),
    # Grants (slice 3; PENDING OWNER, owner question 4).
    Definition(
        key="expected_grant",
        term="Expected",
        text=(
            "Expected: a family whose aid form says it applied, or plans to apply, for an outside camper grant or a "
            "congregation's campership, with no such line in CampMinder yet. It clears itself when a line or an open "
            "commitment arrives (a reversed line counts: the application was answered). It "
            "is never a grant, and the calculator never counts it."
        ),
        spec="§5.8",
        rulings=("D56",),
    ),
    Definition(
        key="last_dollar",
        term="Pays after camp aid",
        text=(
            "Pays after camp aid: a full-cost grantor that fills whatever {camp}'s award left, last. The calculator "
            "never subtracts its grant from the award, but the family's share does."
        ),
        spec="§5.8",
        rulings=("D143", "D150"),
    ),
    Definition(
        key="grantor_season",
        term="Grants this season",
        text=(
            "Grants this season: a grantor's live CampMinder grant lines this season (a line still waiting for its "
            "camper included) and their net. A reversed line and a commitment not yet in CampMinder are left out."
        ),
        spec="§5.7",
        rulings=("D55", "D87"),
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
    "money-to-place": ("not_yet_in_campminder", "to_place_suggestion", "placement_tick", "posted"),
    "money-sources": ("source_facts", "reporting_group", "source_lines"),
    "grants": ("grants", "expected_grant", "last_dollar", "household_level", "grantor_season"),
    "reports-statistics": (
        "apps",
        "cancelled_applicants",
        "awarded",
        "average_award",
        "pct_of_ask",
        "decided_not_offered",
        "recipients_cancelled",
        "appeals",
        "pct_of_ask_with_grants",
        "round2_max_pct",
        "appeal_rate",
    ),
    "reports-programs": ("apps", "awarded", "average_award", "pct_of_ask"),
    "reports-committee": ("finance_budget", "awarded", "apps", "as_reported", "round1_phases", "appeals"),
    "reports-development-zip": ("zip_who_counts",),
    "reports-funding-sources": ("source_facts",),
    "reports-development": (
        "total_awards_granted",
        "need",
        "dev_recipients",
        "teens",
        "dev_families",
        "gender",
        "first_time",
        "dev_appeals",
        "household_level",
        "basis_unconfirmed",
    ),
}

BY_KEY: Final[Mapping[str, Definition]] = {d.key: d for d in DEFINITIONS}


def render(definition: Definition, *, camp: str) -> Definition:
    """The definition with the camp's name filled in."""
    return replace(
        definition, term=definition.term.replace("{camp}", camp), text=definition.text.replace("{camp}", camp)
    )
