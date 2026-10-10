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
            "Decided: the award the dashboard computed or staff set for a round. It can still move (an income "
            "correction, new rules, a grant) until the round is Posted."
        ),
        spec="§5.1",
        rulings=("D43", "D80"),
    ),
    Definition(
        key="posted",
        term="Posted",
        text=(
            "Posted: the round's Posted checkbox and the amount it locked. Posting in CampMinder is the offer; "
            'there is one "Posted", never two figures.'
        ),
        spec="§5.1",
        rulings=("D47", "D51", "D52", "D59", "D78"),
    ),
    Definition(
        key="confirmation",
        term="Confirmation",
        text=(
            "Confirmation, beside every Posted figure: pending, then confirmed (date); "
            '"CampMinder shows $X · short $Y" or "· over $Y" when it disagrees; not in CampMinder (checked, '
            "nothing posted after the sync). It is computed by net-total reconciliation of live camp-aid lines "
            "placed on the request against the locked amount, at family level where a line can't be placed on "
            "a request, and per payer share. Exact to the cent."
        ),
        spec="§5.1",
        rulings=("D59", "D74"),
    ),
    Definition(
        # The Requests grid's column is "CM ✓" (owner ★5, final-ux 10-09); the household keeps "Confirmation".
        key="cm_check",
        term="CM ✓",
        text=(
            "CM ✓: whether CampMinder's ledger matches what was checked Posted: ✓ matched · short / over · "
            "missing · reversed · pending (tonight's sync)."
        ),
        spec="§5.1",
        rulings=("D59", "D74"),
    ),
    Definition(
        key="cost",
        term="Cost",
        text=(
            "Cost: the session's list price (an AG session's is its parent's); Family Camp by the number of "
            "people, or a cost staff set."
        ),
        spec="§5.8",
        rulings=("D77", "D118"),
    ),
    Definition(
        key="grants",
        term="Grants applied",
        text=(
            "Grants applied: the known grants on the family's included requests (live outside-grant lines in "
            "CampMinder, plus grants hand-entered as committed but not yet posted), each request's counted up "
            "to what that request still owed after camp aid. Any amount past that shows on its own line as "
            "beyond what was owed; the Grants table lists the full amounts. Expected grants never count."
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
            "Allocated: per pool, the approved total × the pool's share from the approved rules' budget section (see "
            "Share); in total, the approved total, which the pools add up to. Rounds have no allocation of their own: "
            "each round shows only what it committed, and Round 3 is whatever is left in the pool."
        ),
        spec="§5.3",
        rulings=("D44", "D119"),
    ),
    Definition(
        key="accepted",
        term="Accepted",
        text=(
            "Accepted: the locked amounts of posted rounds whose Accepted checkbox is checked, less any round whose "
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
            "Remaining = Allocated − Posted − Needs an offer − Pending approval, per pool and in total, never per "
            "round. Accepted is shown, never subtracted. The total's Remaining is the sum of the pools', less any "
            "money in No pool. A pool's "
            'Remaining below $0 reads amber, "over its share": the pool has committed more than its share while the '
            'season may still have money. Only the total\'s Remaining below $0 reads red, "over budget".'
        ),
        spec="§5.3",
        rulings=("D44", "D53", "D79", "D74"),
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
            "In CampMinder (net): the family's live camp-aid lines this season, after any reclassifying, net of "
            "reversals. It isn't Posted; the tie-out line shows the gap."
        ),
        spec="§5.5",
        rulings=("D26", "D58", "D59"),
    ),
    Definition(
        key="round2_asks",
        term="Round 2 asks so far",
        text=(
            "Round 2 asks so far: the appeals keyed so far on live requests (not cancelled, in the dashboard or in "
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
    Definition(
        key="share",
        term="Share",
        text=(
            "Share, from the approved rules' budget section: each program's % of the total; the shares add up to "
            "100%. A share is finance's guess at the program's need, not a cap: a pool can go past it while the season "
            "has money left. Finance moves money between programs by changing the shares (Edit Plan…, approved like "
            "any rules change). Only the total is a cap. There are no reserves and no round plan."
        ),
        spec="§5.3",
        rulings=("D119",),
    ),
    Definition(
        key="committed",
        term="Committed",
        text=(
            "Committed: Posted + Needs an offer + Pending approval, the three figures Remaining takes away. A label for "
            "that sum, not a new measure; Accepted is inside Posted."
        ),
        spec="§5.3",
        rulings=("D44", "D53", "D79"),
    ),
    Definition(
        key="past_date",
        term="A past date",
        text='A past date shows what the dashboard can rebuild exactly: a figure it can\'t reads "—", never an estimate.',
        spec="§5.3",
        rulings=("D21", "D74"),
    ),
    # Reports (slice 4's back end, Part A): finance's report words (§5.6). "Awarded" labels money here only.
    Definition(
        key="apps",
        term="Apps",
        text=(
            "Apps: requests received (camper × session; household × session for Family Camp), cancelled ones included. Refused duplicates are left out."
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
            "Awarded: Posted, net of clawbacks, on live requests: the camp's own aid only. Awards counts requests with Posted above $0, unlike Development's Grants/Awards."
        ),
        spec="§5.6",
        rulings=("D80", "D106", "D129", "D131"),
    ),
    Definition(
        key="average_award",
        term="Avg award",
        text=(
            "Avg award: awarded $ ÷ awards. The committee decks divide by every app, $0 included, so this reads higher than the decks."
        ),
        spec="§5.6",
        rulings=("D80",),
    ),
    Definition(
        key="pct_of_ask",
        term="% of ask",
        text=(
            "% of ask: awarded $ ÷ the live requests' in-budget asks. Asks are capped as Asked is. Incl. grants adds outside grants and fully funded rounds to both sides (Round 1 and All rounds)."
        ),
        spec="§5.6",
        rulings=("D80",),
    ),
    Definition(
        key="decided_not_offered",
        term="Not yet offered",
        text=(
            "Not yet offered: decided but not posted. Off by default, never called awarded, and it moves until posted."
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
            "So does a confirmed duplicate that holds one, on its own Duplicate line (it is still not an application). "
            "Once cancelled a request is out of awarded already."
        ),
        spec="§5.6",
        rulings=("D101", "D131", "D141"),
    ),
    Definition(
        key="finance_budget",
        term="Budget",
        text=(
            "Budget: {camp}'s own Total FA budget, as finance and the board approved it. Only the total is hard; "
            "the pool split is finance's soft setting."
        ),
        spec="§5.6",
        rulings=("D106", "D119"),
    ),
    Definition(
        key="as_reported",
        term="P and r",
        text=(
            "P and r: P = the dashboard's Posted; r = as reported, finance's own figures typed once from the "
            "committee decks. The dashboard computes every %."
        ),
        spec="§5.6",
        rulings=("D132", "D133"),
    ),
    Definition(
        key="round1_phases",
        term="Round 1 phases",
        text=(
            "Round 1 phases: 1 = Round 1 on requests in by the deadline, 2 = Round 1 after it, 3 = appeals. "
            "As offered never drops; End of season is net of cancellations."
        ),
        spec="§9.7",
        rulings=("D155",),
    ),
    # Year over year words three notes its own way (approved final mock reports-yoy.html); Statistics keeps its own keys.
    Definition(
        key="committee_awarded",
        term="Awarded",
        text=(
            "Awarded: Posted, net of clawbacks, on live requests. The camp's own aid only, never Total Awards "
            "Granted: outside grants are left out."
        ),
        spec="§5.6",
        rulings=("D80", "D106", "D129", "D131"),
    ),
    Definition(
        key="committee_apps",
        term="Applications",
        text=(
            "Applications: camper × session (household × session for Family Camp), cancelled ones included. "
            "Asks are Round 1 asks only, as they stood at the cutoff."
        ),
        spec="§5.6",
        rulings=("D72", "D131"),
    ),
    Definition(
        key="committee_appeals",
        term="Appeals",
        text=(
            "Appeals: requests with any Round 2 or later ask, cancelled ones included. Not Development's appeals "
            "figure, which counts a different population."
        ),
        spec="§9.7",
        rulings=("D131",),
    ),
    Definition(
        key="appeals",
        term="Appeals",
        text=(
            "Appeals: requests with a Round 2 or later ask, cancelled ones included; appeal rate = appeals ÷ Round 1 apps. R2 max fee % is a rules value, not an outcome."
        ),
        spec="§9.7",
        rulings=("D131",),
    ),
    # Slice 4 ask 4: the Statistics columns that had no note (§9.2, §9.7 RPT-9). Since the approved final mock
    # reports-statistics.html (six notes, cap 6) these three, cancelled_applicants, recipients_cancelled and
    # awarded_count sit on no surface: kept in the registry on purpose, off the Statistics footer.
    Definition(
        key="pct_of_ask_with_grants",
        term="% of ask incl. grants",
        text=(
            "% of ask incl. grants: awarded $ plus the counting outside grants placed on the live requests and the "
            "money of the rounds an outside funder pays in full, ÷ the "
            "live requests' asks, including rounds an outside funder pays in full (outside-funded asks stay in its "
            "denominator, unlike % of ask). It is the 2026 sheet's total % of ask granted. Round 1 and All rounds only: a grant belongs to the request, not to a round. "
            'With "include not yet offered" on, the awarded $ is Posted + Decided, and the column reads "% of ask incl. '
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
            "Round 2 tier and its apps at Round 1's. The dashboard derives it; no deck gives it per tier. As in "
            "Appeals, cancelled requests count on both sides. It is not development's appeals figure."
        ),
        spec="§9.7",
        rulings=("D131", "D132"),
    ),
    # Reports › Development (Part B): development's one all-money basis (§5.7, §5.10, §5.11).
    Definition(
        key="basis_unconfirmed",
        term="As reported",
        text=(
            "As reported: the figures already sent to funders, typed once. They may count the camp's own aid only, so compare them with the dashboard's seasons with care. "
            "The dashboard's own rebuild of these years waits on the 2017–2024 ledger backfill."
        ),
        spec="§5.7",
        rulings=("D96",),
    ),
    Definition(
        key="total_awards_granted",
        term="Total Awards Granted",
        text=(
            "Total Awards Granted: all money, the camp's Posted awards plus every outside grant. Grants/Awards counts each "
            "attendee and session with any aid once; Average award = Total ÷ Grants/Awards."
        ),
        spec="§5.7",
        rulings=(
            "D87",
            "D88",
        ),
    ),
    Definition(
        key="dev_budget",
        term="Budget",
        text=(
            "Budget: the camp's own aid budget as the board first passed it; a later revision doesn't move it. An as-reported "
            "season shows the figure finance typed."
        ),
        spec="§5.7",
        rulings=("D87",),
    ),
    Definition(
        key="need",
        term="Need and Total Requests",
        text=(
            "Need and Total Requests: for each live request of a camper who attended, the latest ask plus the camp's "
            "earlier-round awards, at most its session's cost; outside grants are left out. % of need met = money received, "
            "up to need, ÷ need."
        ),
        spec="§5.10",
        rulings=("D91",),
    ),
    Definition(
        key="dev_recipients",
        term="Who counts",
        text=(
            "Who counts: campers who attended an aid-eligible session and got money from any source, applied or not; Weekend "
            "counts families. Teens are 13–17 on their first day; gender is CampMinder's Gender Identity. A household's grant "
            "counts on a camper only when the household has one eligible camper."
        ),
        spec="§5.11",
        rulings=(
            "D92",
            "D89",
            "D93",
            "D94",
            "D103",
            "D142",
        ),
    ),
    # Reports › Development › Funding sources (Part C).
    Definition(
        key="source_facts",
        term="Three facts",
        text=(
            "Three facts: every source is listed by name with who paid ({camp} or another funder), whether it is an "
            "incentive or need-based (a flag set on each source), and the source itself. Each outside "
            "source names its reporting group, one of the season's budget pools."
        ),
        spec="§5.7",
        rulings=("D88", "D100"),
    ),
    Definition(
        key="zip_who_counts",
        term="Every camper",
        text=(
            "Every camper: campers in an aid-eligible session of the chosen group, by their household's billing ZIP. "
            "A camper only in a session not open to aid isn't counted."
        ),
        spec="§9.4",
        rulings=("D90",),
    ),
    Definition(
        key="first_time",
        term="First-time",
        text=(
            "First-time: no earlier session in that program since 2017, unless a grantor defines it. Appeals: a Round 2 or "
            "later ask from a camper who attended; approved = a posted award in those rounds."
        ),
        spec="§5.11",
        rulings=(
            "D99",
            "D101",
        ),
    ),
    # Money › To place (slice 3; PENDING OWNER, owner question 4).
    Definition(
        key="not_yet_in_campminder",
        term="Not yet in CampMinder",
        text=(
            "Not yet in CampMinder: what a request still lacks there: its locked total plus decided rounds waiting for "
            "Posted, less camp aid already placed on it."
        ),
        spec="§8.1",
        rulings=("D151",),
    ),
    Definition(
        key="to_place_suggestion",
        term="Suggestion",
        text=(
            "Suggestion: the dashboard's proposed placement or split, with its evidence. It counts toward nothing until "
            "a person confirms it, and never picks between equal matches."
        ),
        spec="§8.1",
        rulings=("D12", "D16"),
    ),
    Definition(
        key="placement_tick",
        term="Placing checks Posted",
        text=(
            "Placing checks Posted: on the rounds the money covers in full, oldest first. If pricing changed since the "
            "posting, the money is placed and Posted is checked by hand."
        ),
        spec="§5.1",
        rulings=("D81", "D146", "D151", "D152"),
    ),
    # Final audit (10-09): the notes Money › Ledger, Funders and Grants carry in the approved mocks.
    Definition(
        key="outside_grants_ledger",
        term="Outside grants",
        text=(
            "Outside grants: every other funder's lines, net of reversals, including lines not classified yet. "
            "Outside money is never Posted."
        ),
        spec="§5.5",
        rulings=("D26", "D58"),
    ),
    Definition(
        key="funder",
        term="Funder",
        text=(
            "Funder: Camp is the camp's own aid. Each other header is an outside funder with its terms, eligibility "
            'and contacts; "No funder yet" comes last.'
        ),
        spec="§5.7",
        rulings=("D88", "D100"),
    ),
    Definition(
        key="incentive",
        term="Incentive or need-based",
        text="Incentive or need-based: a flag on each description, never the funder type.",
        spec="§5.7",
        rulings=("D88",),
    ),
    # Money › Grants (final UX 10-09, star 5; design-language section 12): the mock's five short notes. Cancelled and
    # Not counted lost their columns, so their notes say how the mark reads. These keys are on no other surface.
    Definition(
        key="register_amount",
        term="Amount",
        text=(
            "Amount: the grant line's net in CampMinder, or a commitment's amount. Outside money: never in Remaining "
            "or Posted."
        ),
        spec="§5.8",
        rulings=("D55",),
    ),
    Definition(
        key="register_offsets",
        term="Aid request it offsets",
        text=(
            "Aid request it offsets: the camper's request, by session, and the round the grant lowers, or "
            "\"didn't apply\". A never-applied household's line goes to a camper only when it has one eligible camper."
        ),
        spec="§5.8",
        rulings=("D142",),
    ),
    Definition(
        key="register_stands",
        term="Where it stands",
        text=(
            'Where it stands: "\u2713 in CM" once a CampMinder line carries it; "Committed \u00b7 not in CM" while only '
            "entered by hand."
        ),
        spec="§5.8",
        rulings=("D55",),
    ),
    Definition(
        key="register_cancelled",
        term="Cancelled",
        text=(
            "Cancelled (\u2298 before a name): from the camper's enrollment, never typed. A posted grant still counts "
            "until CampMinder reverses it."
        ),
        spec="§5.8",
        rulings=("D55",),
    ),
    Definition(
        key="register_not_counted",
        term="Not counted",
        text=(
            "Not counted (a grey italic amount): a reversed line, a line waiting for its camper, or a commitment whose "
            "camper cancelled. Every other line counts, a didn't-apply family's household line included."
        ),
        spec="§8.2",
        rulings=("D55", "D142"),
    ),
    # Money › Sources (slice 3; PENDING OWNER, owner question 4). The three facts are #2967's source_facts.
    Definition(
        key="reporting_group",
        term="Reporting group",
        text=(
            "Reporting group: the budget pool an outside source funds; household-level grant lines follow it. An "
            "outside source with no programs set needs a group."
        ),
        spec="§8.1",
        rulings=("D95", "D100", "D159"),
    ),
    Definition(
        key="source_lines",
        term="Lines this season",
        text=(
            "Lines this season: the season's live CampMinder lines a description classifies, counting any line "
            "reclassified in To place, and their net. Reversed lines are left out."
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
    # Scenarios addendum §S6 (owner 10-06, lines 666-685, approved with the addendum).
    Definition(
        key="scenario_spend",
        term="Spend",
        text=(
            "Spend: what the applications priced would get under these settings, against the season's budget (set "
            "with Edit Plan… on Rounds & budget). A what-if: nothing here touches a family, the rules or Rounds & "
            "budget. Before Round 1, Rounds 2 and 3 are $0: no appeals exist yet, and Round 3 amounts are typed by "
            "staff, so no formula prices them. Once a round posts, its posted amounts stand in every column; "
            "settings change only what is not yet posted."
        ),
        spec="§7.4",
        rulings=("D35", "D38"),
    ),
    Definition(
        key="scenario_projected",
        term="Projected",
        text=(
            "Projected: last year's arrival curve says what share of last year's applications had arrived by the "
            "same point in the season, counted in weeks from the application deadline (from Jan 1 when last year's "
            "had none). Every figure is divided by that share, as if the rest arrive like last year's and are priced "
            "like those already in. Below 5% of last year's applications there is no projection: the line says it is "
            "too early instead. A pool's 'projected' figure is its Remaining on that basis. Projected figures are "
            "never amber or red: those colours read only real figures. Last year's curve is 2026's applications "
            "workbook, loaded once as weekly shares; from the 2028 season on, the dashboard's own received dates "
            "(2027's applications)."
        ),
        spec="§7.4",
        rulings=("D129", "D138"),
    ),
    Definition(
        key="scenario_below_the_line",
        term="Below the line",
        text=(
            "Below the line, never counted in Remaining: held requests (no amount yet), the Round 1 unmet ask (what "
            "families asked for above their Round 1), and, after Round 1, the appeals keyed so far. The number at "
            "the minimum is shown beside them. This is not Rounds & budget's 'Shown, not counted', which lists "
            "outside grants and money outside {camp}'s budget."
        ),
        spec="§7.4",
        rulings=("D35", "D38"),
    ),
    Definition(
        key="awarded_count",
        term="Awards",
        text=(
            "Awards: requests with {camp}'s own Posted money above $0. Development's Grants/Awards counts every "
            "source, {camp} aid plus a grant on one session counting once, so the two differ on purpose."
        ),
        spec="§9.2",
        rulings=("D157",),
    ),
    Definition(
        key="zip_dollars",
        term="Campers who got aid · Dollars",
        text=(
            "Campers who got aid · Dollars: the same campers, who attended and got money from any source: the camp's "
            "awards (= Posted) and every outside grant, net of reversals. A household-level grant lands on its "
            "household's ZIP."
        ),
        spec="§9.4",
        rulings=("D87", "D80"),
    ),
    Definition(
        key="zip_zip",
        term="ZIP",
        text=(
            "ZIP: the first five digits of the billing postal code on the household's record for that season. "
            "Outside the US and No ZIP on file come last, under any sort."
        ),
        spec="§9.4",
        rulings=("D90",),
    ),
    Definition(
        key="zip_families",
        term="Families",
        text="Families: CampMinder households, each counted once per table.",
        spec="§9.4",
        rulings=("D93",),
    ),
    Definition(
        key="zip_geography",
        term="Small groups show as they are",
        text=(
            "Small groups show as they are, a one-family ZIP and its dollars included: a row is a ZIP, never a "
            "family. Geography goes no finer than ZIP."
        ),
        spec="§9.4",
        rulings=("D66", "D90"),
    ),
)

# The notes each surface shows, numbered from 1 in this order (§4.8). A surface not listed here is unknown.
SURFACES: Final[Mapping[str, tuple[str, ...]]] = {
    "requests": ("decided", "posted", "cm_check", "cost"),
    "household": ("cost", "decided", "grants", "family_share", "posted", "confirmation"),
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
        "share",
        "committed",
        "past_date",
    ),
    # Scenarios addendum §S6: 1-4 in this order (Projected is note 3).
    "season-scenarios": ("scenario_spend", "remaining", "scenario_projected", "scenario_below_the_line"),
    "money-ledger": ("in_campminder_net", "outside_grants_ledger"),
    "money-to-place": ("not_yet_in_campminder", "to_place_suggestion", "placement_tick", "posted"),
    "money-sources": ("funder", "incentive", "reporting_group", "source_lines"),  # Money › Funders
    "grants": ("register_amount", "register_offsets", "register_stands", "register_cancelled", "register_not_counted"),
    "reports-statistics": (
        "apps",
        "awarded",
        "average_award",
        "pct_of_ask",
        "appeals",
        "decided_not_offered",
    ),
    "reports-programs": ("apps", "awarded", "average_award", "pct_of_ask"),
    "reports-committee": (
        "finance_budget",
        "committee_awarded",
        "committee_apps",
        "as_reported",
        "round1_phases",
        "committee_appeals",
    ),
    "reports-development-zip": ("zip_who_counts", "zip_dollars", "zip_zip", "zip_families", "zip_geography"),
    "reports-funding-sources": ("source_facts",),
    "reports-development": (
        "dev_budget",
        "need",
        "total_awards_granted",
        "dev_recipients",
        "first_time",
        "basis_unconfirmed",
    ),
}

BY_KEY: Final[Mapping[str, Definition]] = {d.key: d for d in DEFINITIONS}


def render(definition: Definition, *, camp: str) -> Definition:
    """The definition with the camp's name filled in."""
    return replace(
        definition, term=definition.term.replace("{camp}", camp), text=definition.text.replace("{camp}", camp)
    )
