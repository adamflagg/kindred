"""D16, ruled 2026-10-01 and refined the same day (option a): a placement locks each round at its decided amount
as of the POSTING DATE (the tick's posted_on). When anything that prices the request was recorded after the end of
that day (camp time), the money is still placed and only that round's automatic tick is withheld, for a person to
tick by hand. `changed_since` is the one pure check the read's preview and the write both run.
Fictional only. Emma (1000011) is in household 1000001; her request prices Round 1 at 1,500 (decisions_fakes).
The tick's posting day is Mar 8 2027; its cut is the end of Mar 8 in camp time; "today" is Mar 9 (T0)."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.schemas.financial_aid_to_place import (
    PlaceLineIn,
    PlaceLinesIn,
    PlaceLinesRow,
    PlacePartIn,
    PlacePreviewIn,
)
from api.services.financial_aid_decisions_service import (
    DecisionRefusedError,
    FinancialAidDecisionsService,
    Season,
    as_of_instant,
)
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import CorrectionRecord
from api.services.financial_aid_reconciliation import LedgerTick
from api.services.financial_aid_rules_service import RulesVersion
from api.services.financial_aid_to_place import (
    REMOVAL_SERVICES,
    ChangedReason,
    GrantLineRow,
    LinkRow,
    SinceCorrection,
    SinceInputs,
    SinceLog,
    SinceRecords,
    Synced,
    SyncRemoval,
    changed_since,
)
from bunking.financial_aid.rules.lifecycle import SectionStatus
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeRules,
    approved,
    grant_row,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.to_place_fakes import EMMA, MAR8, FakeToPlaceStore, one_line, to_place_service

POSTED = date(2027, 3, 8)
CUT = as_of_instant(POSTED)  # the end of Mar 8, camp time
AFTER = CUT + timedelta(microseconds=1)
BEFORE = datetime(2027, 3, 1, 18, 0, tzinfo=UTC)
APPLICATION = "app000001000001"  # Emma's application (seed_request)
EMMA_TWO = "reqemma00000002"  # Emma's second request, another session
OTHER = "reqotherfamily1"  # another family's request
TICK = LedgerTick(EMMA, 1, Decimal(1500), POSTED, Decimal(1500))


def _store() -> FakeToPlaceStore:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, EMMA_TWO, session=1000104)
    seed_request(store, OTHER, household=1000009, person=1000091)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    return store


async def _season(
    rules: RulesVersion | None = None, register: Sequence[RegisterRow] = (), store: FakeToPlaceStore | None = None
) -> Season:
    async def grants(year: int) -> Sequence[RegisterRow]:
        return list(register)

    decisions = FinancialAidDecisionsService(
        store or _store(), FakeRules(rules or approved()), grants, clock=lambda: T0
    )
    return await decisions.season(YEAR)


def _since(
    *,
    rules_at: RulesVersion | None = None,
    rules_unknown: frozenset[date] = frozenset(),
    history_from: datetime = T0 - timedelta(days=91),
    now: datetime = T0,
    **records: Any,
) -> SinceInputs:
    return SinceInputs(
        now=now,
        history_from=history_from,
        records=SinceRecords(**records),
        rules_at={POSTED: rules_at or approved()},
        rules_unknown=rules_unknown,
    )


def _place(*parts: tuple[str, str], expected: str | None = None) -> PlaceLineIn:
    return PlaceLineIn(
        parts=[PlacePartIn(request_id=r, amount=Decimal(a)) for r, a in parts],
        expected_locked=Decimal(expected) if expected is not None else None,
    )


def _codes(reasons: Sequence[ChangedReason]) -> list[str]:
    return [r.code for r in reasons]


def _grant(request_id: str = EMMA, **fields: object) -> RegisterRow:
    """An outside grant line on Emma's request, posted Feb 10 (decisions_fakes.grant_row)."""
    return replace(grant_row(request_id, "300"), transaction_cm_id=7001, **fields)  # type: ignore[arg-type]


# --- 1. nothing after the cut --------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_nothing_recorded_after_the_posting_day_changes_nothing() -> None:
    season = await _season(register=[_grant()])
    old = SinceLog("aid_requests", EMMA, "update", CUT)
    assert changed_since(season, TICK, _since(log=(old,))) == ()


# --- 2. each reason fires, exactly after the cut ------------------------------------------------------------

Fixture = Callable[[datetime], dict[str, Any]]

REASONS: list[tuple[str, Fixture]] = [
    ("request", lambda at: {"log": (SinceLog("aid_requests", EMMA, "update", at),)}),
    ("application", lambda at: {"log": (SinceLog("aid_applications", APPLICATION, "update", at),)}),
    ("correction", lambda at: {"corrections": (SinceCorrection(APPLICATION, "", at),)}),
    ("payer_shares", lambda at: {"log": (SinceLog("aid_payer_shares", f"{EMMA}:1000001", "update", at),)}),
    ("decision", lambda at: {"log": (SinceLog("aid_decisions", f"{EMMA}:2", "ask", at),)}),
    ("hold", lambda at: {"log": (SinceLog("aid_hold_events", f"{EMMA}:income", "release", at),)}),
    ("cancellation", lambda at: {"log": (SinceLog("aid_cancellations", EMMA, "cancel", at),)}),
    (
        "grant",
        lambda at: {
            "log": (
                SinceLog(
                    "aid_grants", "grt000000000001", "create", at, after={"household_cm_id": 1000001, "person_cm_id": 0}
                ),
            )
        },
    ),
    ("enrollment", lambda at: {"synced": (Synced("attendees", at, person_cm_id=1000011, household_cm_id=1000001),)}),
    ("equity", lambda at: {"synced": (Synced("person_custom_values", at, person_cm_id=1000011),)}),
    ("session", lambda at: {"synced": (Synced("camp_sessions", at, session_cm_id=1000101),)}),
    ("removed_by_sync", lambda at: {"removals": (SyncRemoval("attendees", at),)}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("code", "fixture"), REASONS, ids=[code for code, _ in REASONS])
async def test_each_input_recorded_after_the_posting_day_refuses_and_one_at_the_cut_does_not(
    code: str, fixture: Fixture
) -> None:
    season = await _season()
    assert changed_since(season, TICK, _since(**fixture(CUT))) == ()
    reasons = changed_since(season, TICK, _since(**fixture(AFTER)))
    assert _codes(reasons) == [code]
    assert reasons[0].text.endswith("(Mar 9)")  # the earliest such record, by its camp day


@pytest.mark.asyncio
async def test_a_legacy_include_override_row_is_never_read_and_a_cost_override_still_is() -> None:
    """There is no Include override (owner ruling): a row left with that field is never read, so it refuses nothing
    here as it moves nothing anywhere else; a cost override is a price input."""
    season = await _season()
    legacy = SinceCorrection(APPLICATION, EMMA, AFTER, "include_override")
    assert changed_since(season, TICK, _since(corrections=(legacy,))) == ()
    cost = SinceCorrection(APPLICATION, EMMA, AFTER, "cost_override")
    assert _codes(changed_since(season, TICK, _since(corrections=(legacy, cost)))) == ["correction"]


@pytest.mark.asyncio
async def test_each_reason_reads_as_staff_text() -> None:
    season = await _season()
    since = _since(
        corrections=(SinceCorrection(APPLICATION, "", AFTER + timedelta(days=2)), SinceCorrection("", EMMA, AFTER)),
        removals=(SyncRemoval("persons", AFTER),),
    )
    assert [r.text for r in changed_since(season, TICK, since)] == [
        "a correction was entered (Mar 9)",
        "CampMinder records were removed by a sync since (Mar 9)",
    ]


# --- 3. must NOT fire ----------------------------------------------------------------------------------------


def _without_person_fields(rules: AidRules) -> AidRules:
    criteria = [c for c in rules.equity.criteria if c.source != "camper" or c.field == "bipoc"]
    return rules.model_copy(update={"equity": rules.equity.model_copy(update={"criteria": criteria})})


@pytest.mark.asyncio
async def test_an_accepted_tick_does_not_price_the_request() -> None:
    season = await _season()
    since = _since(
        log=(
            SinceLog("aid_decisions", f"{EMMA}:1", "accept", AFTER),
            SinceLog("aid_decisions", f"{EMMA}:1", "unaccept", AFTER),
        )
    )
    assert changed_since(season, TICK, since) == ()


@pytest.mark.asyncio
async def test_a_section_locked_after_the_posting_is_the_same_rules() -> None:
    """An overnight tick locks sections: same version, same document, so it must not refuse."""
    season = await _season()
    then = approved()
    locked = then.model_copy(
        update={"section_status": {**then.section_status, "income": SectionStatus(state="locked")}}
    )
    assert season.rules is not None
    assert season.rules != locked  # the statuses differ, the pricing doesn't
    assert changed_since(season, TICK, _since(rules_at=then)) == ()
    assert changed_since(replace(season, rules=locked), TICK, _since(rules_at=then)) == ()


@pytest.mark.asyncio
async def test_a_grant_line_posted_by_the_posting_day_but_synced_after_it_counts_as_present() -> None:
    """Build ruling 2026-10-01 (3c's CampMinder-date axis): CampMinder posted it on Mar 8; Kindred read it Mar 9."""
    season = await _season(register=[_grant(recorded_at=MAR8, recorded_on="2027-03-08")])
    line = GrantLineRow(7001, 1000001, 1000011, 1000011, "regional grant", created=AFTER, updated=AFTER)
    assert changed_since(season, TICK, _since(grant_lines=(line,))) == ()


@pytest.mark.asyncio
@pytest.mark.parametrize("gap", [timedelta(milliseconds=1), timedelta(milliseconds=-1)])
async def test_a_new_grant_line_whose_two_clock_reads_differ_by_a_millisecond_is_not_a_rewrite(gap: timedelta) -> None:
    """PocketBase stamps created and updated from two clock reads, so a brand-new row can show them 1 ms apart
    either way (5 prod rows have updated 1 ms BEFORE created). Millisecond precision exposes that; it isn't Go
    rewriting the row."""
    season = await _season(register=[_grant(recorded_at=MAR8, recorded_on="2027-03-08")])
    created = AFTER + timedelta(milliseconds=2)
    line = GrantLineRow(7001, 1000001, 1000011, 1000011, "regional grant", created=created, updated=created + gap)
    assert changed_since(season, TICK, _since(grant_lines=(line,))) == ()


@pytest.mark.asyncio
async def test_a_persons_change_does_not_refuse_when_the_rules_read_no_person_field() -> None:
    rules = approved(_without_person_fields(intake_rules()))
    season = await _season(rules=rules)
    since = _since(rules_at=rules, synced=(Synced("persons", AFTER, person_cm_id=1000011, household_cm_id=1000001),))
    assert changed_since(season, TICK, since) == ()


@pytest.mark.asyncio
async def test_another_familys_request_or_grant_does_not_refuse() -> None:
    season = await _season(register=[_grant(OTHER, household_cm_id=1000009, person_cm_id=1000091)])
    since = _since(
        log=(
            SinceLog("aid_requests", OTHER, "update", AFTER),
            SinceLog("aid_decisions", f"{OTHER}:1", "post", AFTER),
            SinceLog("aid_grants", "grt000000000009", "create", AFTER, after={"household_cm_id": 1000009}),
        ),
        grant_lines=(GrantLineRow(7009, 1000009, 1000091, 1000091, "regional grant", BEFORE, AFTER),),
        synced=(
            Synced("attendees", AFTER, person_cm_id=1000091, household_cm_id=1000009),
            Synced("person_custom_values", AFTER, person_cm_id=1000091),
            Synced("camp_sessions", AFTER, session_cm_id=1000106),
        ),
    )
    assert changed_since(season, TICK, since) == ()


@pytest.mark.asyncio
async def test_a_camp_aid_lines_placement_does_not_price_the_request() -> None:
    """Camp aid never prices a request (D81/D146): placing a camp-aid line (9001) is not a grant moving."""
    season = await _season()
    placed = SinceLog(
        "aid_attribution_overrides",
        "ovr000000009001",
        "place_line",
        AFTER,
        after={"transaction_cm_id": 9001, "attributed_person_cm_id": 1000011},
    )
    assert changed_since(season, TICK, _since(log=(placed,))) == ()


@pytest.mark.asyncio
async def test_a_deletion_by_an_unrelated_sync_does_not_refuse() -> None:
    season = await _season()
    assert "staff" not in REMOVAL_SERVICES
    assert changed_since(season, TICK, _since(removals=(SyncRemoval("staff", AFTER),))) == ()


# --- 4. must fire --------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_another_request_of_the_same_camper_changing_refuses() -> None:
    """A grant on the camper splits across her requests (split_equally): her other request's status moves it."""
    season = await _season()
    assert _codes(changed_since(season, TICK, _since(log=(SinceLog("aid_requests", EMMA_TWO, "update", AFTER),)))) == [
        "request"
    ]


@pytest.mark.asyncio
async def test_a_grant_moved_off_the_camper_refuses() -> None:
    season = await _season()
    moved = SinceLog(
        "aid_attribution_overrides",
        "ovr000000007001",
        "update",
        AFTER,
        before={"transaction_cm_id": 7001, "attributed_person_cm_id": 1000011},
        after={"transaction_cm_id": 7001, "attributed_person_cm_id": 1000012},
    )
    assert _codes(changed_since(season, TICK, _since(log=(moved,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_grant_split_onto_the_camper_refuses() -> None:
    season = await _season()
    split = SinceLog(
        "aid_attribution_overrides",
        "ovr000000007002",
        "update",
        AFTER,
        after={"transaction_cm_id": 7002, "split": [{"person_cm_id": 1000011, "amount": "10"}]},
    )
    assert _codes(changed_since(season, TICK, _since(log=(split,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_grant_posted_or_reversed_after_the_posting_day_refuses() -> None:
    later = datetime(2027, 3, 10, 18, 0, tzinfo=UTC)
    posted_later = await _season(register=[_grant(recorded_at=later, recorded_on="2027-03-10")])
    assert _codes(changed_since(posted_later, TICK, _since())) == ["grant"]
    reversed_later = await _season(register=[_grant(is_reversed=True, reversal_date="2027-03-10 18:00:00.000Z")])
    reasons = changed_since(reversed_later, TICK, _since())
    assert [(r.code, r.text) for r in reasons] == [("grant", "an outside grant was posted, reversed or moved (Mar 10)")]


@pytest.mark.asyncio
async def test_a_grant_line_campminder_changed_after_the_posting_day_refuses() -> None:
    """Go rewrote the row (a reclassification, its attribution, its amount): updated after the cut, not its create."""
    season = await _season(register=[_grant()])
    rewritten = GrantLineRow(7001, 1000001, 1000011, 1000011, "regional grant", created=BEFORE, updated=AFTER)
    assert _codes(changed_since(season, TICK, _since(grant_lines=(rewritten,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_commitment_withdrawn_after_the_posting_day_refuses() -> None:
    season = await _season()
    withdrawn = SinceLog(
        "aid_grants",
        "grt000000000001",
        "withdraw",
        AFTER,
        before={"household_cm_id": 1000001, "person_cm_id": 1000011, "status": "open"},
        after={"status": "withdrawn"},
    )
    assert _codes(changed_since(season, TICK, _since(log=(withdrawn,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_grantor_or_source_of_a_grant_in_scope_changing_refuses() -> None:
    season = await _season(register=[_grant()])
    grantor = SinceLog("aid_grantors", "regional_fund", "update", AFTER)
    assert _codes(changed_since(season, TICK, _since(log=(grantor,)))) == ["grant"]
    source = Synced("aid_sources", AFTER, key="regional grant")
    assert _codes(changed_since(season, TICK, _since(synced=(source,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_grantor_record_changed_after_the_posting_day_refuses_whatever_season_its_log_names() -> None:
    """The grantor directory spans seasons, so its log row carries the season configured when it was saved,
    which a late placement's season may not be: the grantor record's own `updated` is the exact date."""
    season = await _season(register=[_grant()])
    grantor = Synced("aid_grantors", AFTER, key="regional_fund")
    assert _codes(changed_since(season, TICK, _since(synced=(grantor,)))) == ["grant"]
    other = Synced("aid_grantors", AFTER, key="another_fund")
    assert _codes(changed_since(season, TICK, _since(synced=(other,)))) == []
    before = Synced("aid_grantors", CUT, key="regional_fund")
    assert _codes(changed_since(season, TICK, _since(synced=(before,)))) == []


@pytest.mark.asyncio
async def test_a_household_linked_into_the_family_after_the_posting_day_refuses() -> None:
    season = await _season()
    links = (LinkRow(1000001, "fam-a", False, BEFORE), LinkRow(1000007, "fam-a", False, AFTER))
    assert _codes(changed_since(season, TICK, _since(links=links))) == ["grant"]
    unlinked = (LinkRow(1000001, "fam-a", False, BEFORE), LinkRow(1000007, "fam-a", True, AFTER))
    assert _codes(changed_since(season, TICK, _since(links=unlinked))) == ["grant"]


@pytest.mark.asyncio
async def test_a_persons_change_refuses_when_the_rules_read_gender_identity() -> None:
    """The fictional rules weigh trans_nb from the camper's gender identity, which lives on persons."""
    assert any(c.field == "gender_identity" for c in intake_rules().equity.criteria)
    season = await _season()
    since = _since(synced=(Synced("persons", AFTER, person_cm_id=1000011, household_cm_id=1000001),))
    assert _codes(changed_since(season, TICK, since)) == ["equity"]


@pytest.mark.asyncio
async def test_rules_reapproved_as_a_new_version_with_the_same_document_refuse() -> None:
    season = await _season(rules=approved(version=2))
    reasons = changed_since(season, TICK, _since(rules_at=approved(version=1)))
    assert [(r.code, r.text) for r in reasons] == [("rules", "the pricing rules changed (version 1 then, 2 now)")]


@pytest.mark.asyncio
async def test_rules_whose_document_changed_refuse() -> None:
    rules = intake_rules()
    edited = rules.model_copy(update={"equity": rules.equity.model_copy(update={"max_shift": 1})})
    season = await _season(rules=approved(edited))
    assert _codes(changed_since(season, TICK, _since(rules_at=approved()))) == ["rules"]


@pytest.mark.asyncio
async def test_rules_whose_history_cannot_be_replayed_refuse() -> None:
    season = await _season()
    reasons = changed_since(season, TICK, _since(rules_unknown=frozenset({POSTED})))
    assert [(r.code, r.text) for r in reasons] == [
        ("rules_history", "the dashboard can't replay the pricing rules' history to that day")
    ]


@pytest.mark.asyncio
async def test_no_approved_rules_on_the_posting_day_refuse() -> None:
    season = await _season()
    since = replace(_since(), rules_at={POSTED: None})
    assert _codes(changed_since(season, TICK, since)) == ["rules"]


@pytest.mark.asyncio
async def test_a_posting_older_than_the_sync_history_refuses() -> None:
    season = await _season()
    reasons = changed_since(season, TICK, _since(history_from=AFTER))
    assert [(r.code, r.text) for r in reasons] == [
        ("too_long_ago", "the posting is older than the dashboard's 90-day sync history")
    ]


@pytest.mark.asyncio
async def test_a_sync_that_removed_records_after_the_posting_day_refuses() -> None:
    season = await _season()
    for service in REMOVAL_SERVICES:
        assert _codes(changed_since(season, TICK, _since(removals=(SyncRemoval(service, AFTER),)))) == [
            "removed_by_sync"
        ]


# --- 5. posted today: nothing can be after it ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_round_posted_today_is_never_refused() -> None:
    season = await _season()
    today = replace(TICK, posted_on=date(2027, 3, 9))
    since = _since(log=(SinceLog("aid_requests", EMMA, "update", T0),), removals=(SyncRemoval("persons", T0),))
    assert changed_since(season, today, since) == ()


# --- the service: the write places and withholds the tick, the read previews the same ---------------------------

LIAM_ELSEWHERE = "reqliam00000009"  # a camper in another household, for the bulk confirm


def _correction(store: FakeToPlaceStore, at: datetime = T0) -> None:
    """A correction on Emma's application entered Mar 9, after her line's posting day. It re-keys the income the
    application already holds, so the amount doesn't move: the check refuses on the record, not on the figure."""
    store.corrections.append(
        CorrectionRecord(
            id="cor000000000001",
            year=YEAR,
            application_id=APPLICATION,
            request_id="",
            field="total_gross_income",
            new_value="60000",
            original_value="60000",
            reason="Pay stub",
            actor=ACTOR,
            created=at.isoformat(),
        )
    )


NOT_TICKED_WHY = (  # owner 10-03 (D162): the "Changed after posting" sentence, To place and Not reconciled alike
    "Round 1 wasn't marked posted automatically: after it was posted in CampMinder on Mar 8, a correction was entered "
    "(Mar 9). Check it against what the family was offered, then click Mark Posted. That saves the higher of its "
    "amount on Mar 8 and today's."
)
NOT_TICKED_9001 = (9001, EMMA, 1, POSTED, ["a correction was entered (Mar 9)"], NOT_TICKED_WHY)


def _not_ticked(rows: Sequence[Any]) -> list[tuple[Any, ...]]:
    return [(n.transaction_cm_id, n.request_id, n.round, n.posted_on, n.reasons, n.why) for n in rows]


@pytest.mark.asyncio
async def test_money_placed_tick_withheld_and_the_response_names_the_round() -> None:
    """D16 option (a), owner ruling 2026-10-01: something that sets the award was recorded after the posting, so
    the money IS placed, and only the automatic tick is withheld: no Posted row and no rules lock for it. The
    response names the round, says why, and asks the registrar to tick it by hand."""
    store = one_line()
    _correction(store)
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert out.placed == [9001]
    assert out.ticked == []
    assert _not_ticked(out.not_ticked) == [NOT_TICKED_9001]
    assert out.left_to_tick == []  # named once, in not_ticked, with its reasons
    (operation,) = store.operations
    assert [w.collection for w in operation] == ["aid_attribution_overrides"]  # no Posted row, no aid_rules lock
    assert [e.kind for e in store.events if e.request_id == EMMA and e.kind == "post"] == []
    assert (await to_place_service(store).read(YEAR)).open_count == 0  # the line is on Emma's request


@pytest.mark.asyncio
async def test_a_legacy_include_override_row_entered_after_the_posting_withholds_nothing_at_the_placement() -> None:
    """The store's read carries each correction's field, so the placement skips a legacy include_override row as
    `changed_since` does (owner ruling: the Include override is gone) and ticks the round."""
    store = one_line()
    store.corrections.append(
        CorrectionRecord(
            id="cor000000000002",
            year=YEAR,
            application_id=APPLICATION,
            request_id="",
            field="include_override",
            new_value="excluded",
            original_value="",
            reason="Legacy row",
            actor=ACTOR,
            created=T0.isoformat(),
        )
    )
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert (out.placed, out.not_ticked) == ([9001], [])
    assert [(e.request_id, e.round) for e in store.events if e.kind == "post"] == [(EMMA, 1)]


@pytest.mark.asyncio
async def test_a_bulk_confirm_places_every_line_and_withholds_only_the_changed_lines_tick() -> None:
    store = one_line()
    seed_request(store, LIAM_ELSEWHERE, household=1000002, person=1000021)
    seed_line(store, 9002, "1500", household=1000002, person=0, posted=MAR8)
    _correction(store)
    body = PlaceLinesIn(
        lines=[
            PlaceLinesRow(transaction_cm_id=9001, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(1500))]),
            PlaceLinesRow(transaction_cm_id=9002, parts=[PlacePartIn(request_id=LIAM_ELSEWHERE, amount=Decimal(1500))]),
        ]
    )
    out = await to_place_service(store).place_lines(YEAR, body, ACTOR)
    assert out.placed == [9001, 9002]
    assert [(t.request_id, t.round, t.amount) for t in out.ticked] == [(LIAM_ELSEWHERE, 1, 1500.0)]
    assert _not_ticked(out.not_ticked) == [NOT_TICKED_9001]  # listed against its own line
    (operation,) = store.operations  # still one atomic operation
    posts = [w for w in operation if w.collection == "aid_decisions"]
    assert [w.data["request"] for w in posts if w.data is not None] == [LIAM_ELSEWHERE]
    assert sum(w.collection == "aid_attribution_overrides" for w in operation) == 2


@pytest.mark.asyncio
async def test_a_bulk_confirm_of_two_lines_on_one_request_names_its_withheld_round_once() -> None:
    """Two family-level lines both placed on Emma cover her Round 1 together; that one round's tick is withheld
    once, so the response names it once, against the first line that reaches her request (like `ticked`)."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, "reqliam00000001", person=1000012)  # Emma's brother: both lines are family level
    seed_line(store, 9001, "750", person=0, posted=MAR8)
    seed_line(store, 9002, "750", person=0, posted=MAR8)
    _correction(store)
    body = PlaceLinesIn(
        lines=[
            PlaceLinesRow(transaction_cm_id=9001, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(750))]),
            PlaceLinesRow(transaction_cm_id=9002, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(750))]),
        ]
    )
    out = await to_place_service(store).place_lines(YEAR, body, ACTOR)
    assert out.placed == [9001, 9002]
    assert out.ticked == []
    assert _not_ticked(out.not_ticked) == [NOT_TICKED_9001]


@pytest.mark.asyncio
async def test_the_read_previews_the_round_as_won_t_tick_from_the_same_check_the_write_runs() -> None:
    """Preview = write (§4.10): the same function on the same loads. would_tick and would_lock leave the round
    out; would_not_tick carries it with the reasons, exactly as the write returns it in not_ticked."""
    store = one_line()
    _correction(store)
    service = to_place_service(store)
    out = await service.read(YEAR)
    (line,) = out.groups[0].lines
    assert line.suggestion is not None
    assert line.suggestion.would_tick == []
    assert line.suggestion.would_lock == 0
    assert line.suggestion.would_leave == []
    assert _not_ticked(line.suggestion.would_not_tick) == [NOT_TICKED_9001]
    placed = await service.place(YEAR, 9001, _place((EMMA, "1500"), expected="0"), ACTOR)
    assert _not_ticked(placed.not_ticked) == _not_ticked(line.suggestion.would_not_tick)


@pytest.mark.asyncio
async def test_the_exact_total_is_checked_against_the_ticks_that_will_be_written() -> None:
    """expected_locked compares with what is written: a withheld tick locks nothing."""
    store = one_line()
    _correction(store)
    with pytest.raises(DecisionRefusedError, match="this now locks \\$0, not the \\$1,500 you confirmed"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500"), expected="1500"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_the_read_loads_what_changed_once_for_every_suggestion() -> None:
    store = one_line()
    seed_request(store, LIAM_ELSEWHERE, household=1000002, person=1000021)
    seed_line(store, 9002, "1500", household=1000002, person=0, posted=datetime(2027, 3, 5, 18, 0, tzinfo=UTC))
    out = await to_place_service(store).read(YEAR)
    assert all(ln.suggestion is not None and ln.suggestion.would_not_tick == [] for ln in out.groups[0].lines)
    assert store.since_reads == [as_of_instant(date(2027, 3, 5))]  # one read, from the earliest posting day


@pytest.mark.asyncio
async def test_with_nothing_changed_the_exact_total_still_checks() -> None:
    store = one_line()
    with pytest.raises(DecisionRefusedError, match="this now locks \\$1,500, not the \\$1,400 you confirmed"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500"), expected="1400"), ACTOR)
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500"), expected="1500"), ACTOR)
    assert [(t.request_id, t.round, t.amount) for t in out.ticked] == [(EMMA, 1, 1500.0)]


@pytest.mark.asyncio
async def test_a_placement_with_no_tick_needs_no_check() -> None:
    """Short of the decided amount: nothing ticks, so nothing is locked at a posting day's amount."""
    store = one_line("1000")
    _correction(store)
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1000")), ACTOR)
    assert out.ticked == []
    assert store.since_reads == []


@pytest.mark.asyncio
async def test_the_overnight_tick_is_not_gated() -> None:
    """SP10b-1 Decision 2 (open ⚠): the nightly tick is priced at the sync; its gap is a night, not ungated by D16b."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8)  # posted to Emma: the ledger places it
    _correction(store)
    service = to_place_service(store)
    out = await service._decisions.ledger_ticks(YEAR)
    assert out.ticked == 1
    assert store.since_reads == []


# --- fix round 1 (review of b97bd7ab): three false "unchanged" routes, and two minors ------------------------


@pytest.mark.asyncio
async def test_a_grant_line_reclassified_into_camp_aid_after_the_posting_day_refuses() -> None:
    """Critical 2: it was an outside grant on the posting day and is camp aid now, so it is a camp line today.
    The Reclassify that moved it is a grant moving, even though the line is camp aid now."""
    store = _store()
    seed_line(store, 9002, "300", person=0, posted=BEFORE)  # camp aid today, in Emma's household
    season = await _season(store=store)
    reclassified = SinceLog(
        "aid_attribution_overrides",
        "ovr000000009002",
        "reclassify",
        AFTER,
        before={"transaction_cm_id": 9002, "source_key_override": ""},
        after={"transaction_cm_id": 9002, "source_key_override": "camp fa"},
    )
    assert _codes(changed_since(season, TICK, _since(log=(reclassified,)))) == ["grant"]
    elsewhere = _store()
    seed_line(elsewhere, 9002, "300", household=1000009, person=0, posted=BEFORE)  # another family's line
    assert changed_since(await _season(store=elsewhere), TICK, _since(log=(reclassified,))) == ()


@pytest.mark.asyncio
async def test_a_camp_aid_line_rewritten_by_the_sync_after_the_posting_day_refuses() -> None:
    """Critical 2: Go re-stamps a line it moved from an outside grant to camp aid (its funder type); the read
    keeps every funder type, and an in-scope row rewritten after the cut refuses whatever it is now."""
    season = await _season()
    restamped = GrantLineRow(9002, 1000001, 0, 0, "camp fa", created=BEFORE, updated=AFTER)
    assert _codes(changed_since(season, TICK, _since(grant_lines=(restamped,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_line_posted_after_the_posting_day_that_fulfils_an_earlier_commitment_refuses() -> None:
    """Critical 3: recorded_at is the commitment's earlier created; the line's own post date is what moved."""
    posted = datetime(2027, 3, 10, 18, 0, tzinfo=UTC)
    season = await _season(register=[_grant(fulfils_commitment_id="grt000000000001", posted_at=posted)])
    reasons = changed_since(season, TICK, _since())
    assert [(r.code, r.text) for r in reasons] == [("grant", "an outside grant was posted, reversed or moved (Mar 10)")]


@pytest.mark.asyncio
async def test_a_grant_line_with_no_post_date_synced_after_the_posting_day_refuses() -> None:
    season = await _season(register=[_grant(recorded_at=None, recorded_on="", posted_at=None)])
    line = GrantLineRow(7001, 1000001, 1000011, 1000011, "regional grant", created=AFTER, updated=AFTER)
    assert _codes(changed_since(season, TICK, _since(grant_lines=(line,)))) == ["grant"]


@pytest.mark.asyncio
async def test_a_session_of_another_family_request_changing_refuses() -> None:
    """Its session type decides its program family, and with it how a grant splits across the camper's requests."""
    season = await _season()
    since = _since(synced=(Synced("camp_sessions", AFTER, session_cm_id=1000104),))  # Emma's other request
    assert _codes(changed_since(season, TICK, since)) == ["session"]


@pytest.mark.asyncio
async def test_a_custom_value_sync_removal_refuses_only_where_the_rules_weigh_a_custom_value() -> None:
    """Now that sweeps count their deletions, the equity custom-value syncs trip only a camper-level request
    whose rules read a camper answer kept in custom values (the BIPOC answer)."""
    removals = tuple(SyncRemoval(s, AFTER) for s in ("person_custom_values", "person_custom_values_family_camp"))
    rules = intake_rules()
    no_custom = rules.model_copy(
        update={
            "equity": rules.equity.model_copy(
                update={"criteria": [c for c in rules.equity.criteria if c.source != "camper"]}
            )
        }
    )
    season = await _season(rules=approved(no_custom))
    assert changed_since(season, TICK, _since(rules_at=approved(no_custom), removals=removals)) == ()
    assert _codes(changed_since(await _season(), TICK, _since(removals=removals))) == ["removed_by_sync"]
    household_level = _store()
    seed_request(household_level, "reqfamily000001", household=1000003, person=0, session=1000202)
    family_tick = replace(TICK, request_id="reqfamily000001")
    season = await _season(store=household_level)
    assert changed_since(season, family_tick, _since(removals=removals)) == ()
    attendees = (SyncRemoval("attendees", AFTER),)
    assert _codes(changed_since(season, family_tick, _since(removals=attendees))) == ["removed_by_sync"]


# --- a split with several withheld parts: the shared explanation is said once ---------------------------------


SIBLING = "reqliam00000001"  # Emma's brother, same household and application


def _split_store() -> FakeToPlaceStore:
    """One 3,000 line posted Mar 8, to split 1,500 / 1,500 over Emma's and her brother's requests; a correction entered Mar 9 sits on
    her application, so BOTH parts' rounds are withheld for the same reason."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, SIBLING, person=1000012)  # Emma's brother: same application
    seed_line(store, 9001, "3000", person=0, posted=MAR8)
    _correction(store)
    return store


SPLIT = _place((EMMA, "1500"), (SIBLING, "1500"))


def _split_would_not_tick_whys(rows: Sequence[Any]) -> list[tuple[str, str]]:
    return [(n.request_id, n.why) for n in rows]


@pytest.mark.asyncio
async def test_a_split_with_two_withheld_parts_says_the_changed_since_list_once() -> None:
    """The Money › To place wall of text: two parts withheld for the same changes repeated the whole "after it was
    posted in CampMinder on Mar 8, a correction was entered (Mar 9)..." sentence once per part. The first part carries
    the shared explanation; the other says only that its round wasn't marked either, for the same changes."""
    service = to_place_service(_split_store())
    preview = await service.preview(YEAR, 9001, PlacePreviewIn(parts=SPLIT.parts), ACTOR)
    whys = _split_would_not_tick_whys(preview.would_not_tick)
    assert [r for r, _ in whys] == [EMMA, SIBLING]
    first, second = (w for _, w in whys)
    assert first == NOT_TICKED_WHY
    assert second == "Round 1 wasn't marked posted automatically either: the same changes as above."
    assert sum(w.count("a correction was entered") for _, w in whys) == 1


@pytest.mark.asyncio
async def test_the_split_previews_and_the_write_word_the_withheld_parts_alike() -> None:
    """Preview = write (§4.10): the confirmation names the same parts with the same words."""
    service = to_place_service(_split_store())
    preview = await service.preview(YEAR, 9001, PlacePreviewIn(parts=SPLIT.parts), ACTOR)
    placed = await service.place(YEAR, 9001, SPLIT, ACTOR)
    assert _split_would_not_tick_whys(placed.not_ticked) == _split_would_not_tick_whys(preview.would_not_tick)
    assert len(placed.not_ticked) == 2


@pytest.mark.asyncio
async def test_two_withheld_parts_for_different_changes_each_keep_their_own_explanation() -> None:
    """Only an IDENTICAL explanation (same posting day, same changed-since list) is folded: a part withheld for other
    reasons keeps its whole sentence."""
    from api.services.financial_aid_to_place_service import not_ticked_outs

    other = replace(TICK, request_id=SIBLING)
    a, b = (
        (ChangedReason("correction", "a correction was entered (Mar 9)"),),
        (ChangedReason("grant", "a grant was recorded (Mar 9)"),),
    )
    out = not_ticked_outs([(9001, TICK, a), (9001, other, b)])
    assert out[0].why.startswith("Round 1 wasn't marked posted automatically: after it was posted")
    assert out[1].why.startswith("Round 1 wasn't marked posted automatically: after it was posted")
    assert "grant was recorded" in out[1].why


@pytest.mark.asyncio
async def test_withheld_rounds_on_different_lines_each_keep_their_own_explanation() -> None:
    """The fold is within ONE line's placement: a batch confirm's other line is another row on screen, so "as above"
    would point at a different family's text. Same posting day and same changes, different transactions: both full."""
    from api.services.financial_aid_to_place_service import not_ticked_outs

    other = replace(TICK, request_id=SIBLING)
    same = (ChangedReason("correction", "a correction was entered (Mar 9)"),)
    out = not_ticked_outs([(9001, TICK, same), (9002, other, same)])
    assert out[0].why == out[1].why == NOT_TICKED_WHY
