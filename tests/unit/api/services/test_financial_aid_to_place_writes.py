"""Money > To place, the writes (campership SP11-rest; clean spec §8.1; D12, D16, D54, D58, D81, D104,
D146): Confirm, Split and a whole class at once, Leave at family level and reopen, Reclassify. Each is one
operation through 4a's real commit_aid_writes over a fake batch. Fictional only. Figures: Session 2 (1000101)
gives a tier-2 family Round 1 = 1,500; Emma (1000011) and Liam (1000012) are siblings in household 1000001."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid_to_place import (
    LeaveLineIn,
    PlaceLineIn,
    PlaceLinesIn,
    PlaceLinesRow,
    PlacePartIn,
    ReclassifyLineIn,
)
from api.services.financial_aid_decisions_service import DecisionNotFoundError, DecisionRefusedError
from api.services.financial_aid_to_place import LEFT_DISPOSITION, TO_PLACE_FLAG, LeftLine, LineDetail, OverrideRow
from bunking.financial_aid.change_log import AidWrite, AidWriteConflictError
from bunking.financial_aid.decisions import DecisionEvent
from bunking.pocketbase_batch import BatchLimitError, BatchRequestFailedError
from tests.unit.api.services.decisions_fakes import ACTOR, RULES_ID, seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import LIAM, _posted
from tests.unit.api.services.to_place_fakes import (
    EMMA,
    GRANT_KEY,
    MAR8,
    QUEST_KEY,
    FakeToPlaceStore,
    one_line,
    seed_override_row,
    to_place_service,
)

MAY1 = datetime(2027, 5, 1, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)


def _without_locks(operation: Sequence[AidWrite]) -> list[AidWrite]:
    """An operation's writes apart from the leading aid_rules locks a first tick adds (G6 puts them first)."""
    return [w for w in operation if w.collection != "aid_rules"]


def _place(*parts: tuple[str, str], note: str = "") -> PlaceLineIn:
    return PlaceLineIn(parts=[PlacePartIn(request_id=r, amount=Decimal(a)) for r, a in parts], note=note)


# --- place (Confirm, Split) ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_confirming_places_the_line_and_ticks_the_round_it_covers_in_one_operation() -> None:
    """D81: the registrar's placement ticks the round it lands on, at its decided amount, dated the posting."""
    store = one_line()
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert [(t.request_id, t.round, t.amount) for t in out.ticked] == [(EMMA, 1, 1500.0)]
    assert out.left_to_tick == []
    (operation,) = store.operations
    assert operation[0].collection == "aid_rules"  # G6: the rules locks lead the operation
    operation = _without_locks(operation)
    assert [w.collection for w in operation[:2]] == ["aid_attribution_overrides", "aid_decisions"]
    override = operation[0]
    assert override.data is not None
    assert {k: override.data[k] for k in ("attributed_person_cm_id", "attributed_session_cm_id", "program_family")} == {
        "attributed_person_cm_id": 1000011,
        "attributed_session_cm_id": 1000101,
        "program_family": "summer",
    }
    assert (override.data["source"], override.data["split"], override.log_action) == ("staff", [], "place_line")
    post = store.events[-1]
    assert (post.kind, post.amount, post.lock_source, post.effective_on, post.actor) == (
        "post",
        Decimal(1500),
        "placement",
        date(2027, 3, 8),
        ACTOR,
    )
    assert len({row["operation_id"] for row in store.log}) == 1
    assert (await to_place_service(store).read(YEAR)).open_count == 0


@pytest.mark.asyncio
async def test_a_split_places_each_part_and_ticks_each_request() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "3000", person=0, posted=MAR8)
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500"), (LIAM, "1500")), ACTOR)
    assert sorted((t.request_id, t.amount) for t in out.ticked) == [(EMMA, 1500.0), (LIAM, 1500.0)]
    override = _without_locks(store.operations[0])[0]
    assert override.data is not None
    assert (override.data["attributed_person_cm_id"], override.data["attributed_session_cm_id"]) == (0, 0)
    assert override.data["split"] == [
        {"person_cm_id": 1000011, "session_cm_id": 1000101, "program_family": "summer", "amount": "1500"},
        {"person_cm_id": 1000012, "session_cm_id": 1000101, "program_family": "summer", "amount": "1500"},
    ]


@pytest.mark.asyncio
async def test_a_whole_class_of_suggestions_is_confirmed_at_once_as_one_operation() -> None:
    """D16: a person confirms one at a time or a whole class in bulk; all or nothing, like the Posted tick."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    seed_line(store, 9002, "1500", household=1000002, person=0, posted=MAR8)
    body = PlaceLinesIn(
        lines=[
            PlaceLinesRow(transaction_cm_id=9001, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(1500))]),
            PlaceLinesRow(transaction_cm_id=9002, parts=[PlacePartIn(request_id=LIAM, amount=Decimal(1500))]),
        ],
        note="March reposts",
    )
    out = await to_place_service(store).place_lines(YEAR, body, ACTOR)
    assert (out.placed, sorted(t.request_id for t in out.ticked)) == ([9001, 9002], [EMMA, LIAM])
    assert len(store.operations) == 1
    assert {row["reason"] for row in store.log} == {"March reposts"}


@pytest.mark.asyncio
async def test_one_bad_line_refuses_the_whole_class_and_says_which() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)  # no request behind it
    body = PlaceLinesIn(
        lines=[
            PlaceLinesRow(transaction_cm_id=9001, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(1500))]),
            PlaceLinesRow(transaction_cm_id=9002, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(700))]),
        ]
    )
    with pytest.raises(DecisionRefusedError, match=f"line 9002: {EMMA} is not a request this family holds"):
        await to_place_service(store).place_lines(YEAR, body, ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_placement_short_of_the_decided_amount_places_but_leaves_the_round_for_a_person() -> None:
    """D146: a round ticks only when CampMinder holds its full decided amount; a short one waits for the
    registrar's own tick, and the answer says why."""
    store = one_line("1000")
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1000")), ACTOR)
    assert out.ticked == []
    assert [(x.request_id, x.round, x.why) for x in out.left_to_tick] == [
        (
            EMMA,
            1,
            "CampMinder holds $1,000 on this request; Round 1 needs $1,500: mark it posted by hand if that is right",
        )
    ]
    (operation,) = store.operations
    assert [w.collection for w in operation] == ["aid_attribution_overrides"]


@pytest.mark.asyncio
async def test_a_round_a_person_unticked_is_left_for_a_person() -> None:
    store = one_line()
    _posted(store, EMMA, 1, "1500")
    store.events.append(DecisionEvent(id="ev9999999999999", request_id=EMMA, round=1, kind="unpost", created=MAY1))
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert out.ticked == []
    assert [x.why for x in out.left_to_tick] == [
        "You un-ticked this round: mark it posted again by hand if that is right"
    ]


@pytest.mark.asyncio
async def test_placing_on_a_request_whose_money_came_back_counts_that_money_again_before_ticking() -> None:
    """The season clawed Emma's Round 1 back (D54): her line was reversed, and the family's line was posted
    before that reversal. Placing that family line on her makes her money live again, so Round 1 is locked
    once more and Round 2 must not tick on money Round 1 holds."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    store.events.append(
        DecisionEvent(
            id="ev9999999999998",
            request_id=EMMA,
            round=2,
            kind="ask",
            created=MAY1,
            amount=Decimal(300),
            effective_on=date(2027, 5, 1),
        )
    )
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8, reversed_at=JUN1)
    seed_line(store, 9002, "1500", person=0, posted=MAY1)
    out = await to_place_service(store).place(YEAR, 9002, _place((EMMA, "1500")), ACTOR)
    assert out.ticked == []
    assert [(x.round, x.why) for x in out.left_to_tick] == [
        (2, "CampMinder holds $1,500 on this request; Round 2 needs $1,800: mark it posted by hand if that is right")
    ]


@pytest.mark.asyncio
async def test_parts_that_do_not_add_up_to_the_line_are_refused_and_nothing_is_written() -> None:
    store = one_line()
    with pytest.raises(DecisionRefusedError, match=r"the parts add up to \$1,400; the line is \$1,500"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1400")), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_request_this_family_does_not_hold_is_refused() -> None:
    store = one_line()
    seed_request(store, LIAM, household=1000002, person=1000021)
    with pytest.raises(DecisionRefusedError, match="not a request this family holds"):
        await to_place_service(store).place(YEAR, 9001, _place((LIAM, "1500")), ACTOR)


@pytest.mark.asyncio
async def test_a_line_already_on_a_request_or_unknown_is_refused() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8)  # Emma's only request takes it
    with pytest.raises(DecisionRefusedError, match="already on a request"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    with pytest.raises(DecisionNotFoundError):
        await to_place_service(store).place(YEAR, 9999, _place((EMMA, "1500")), ACTOR)


@pytest.mark.asyncio
async def test_a_line_waiting_on_a_reclassification_is_not_placed() -> None:
    store = one_line()
    seed_override_row(store, 9001, source_key=GRANT_KEY)
    with pytest.raises(DecisionRefusedError, match="reclassification waits for tonight's ledger sync"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    with pytest.raises(DecisionRefusedError, match="reclassification waits"):  # nor left: it is out of the count
        await to_place_service(store).leave(YEAR, 9001, LeaveLineIn(note="n"), ACTOR)


@pytest.mark.asyncio
async def test_a_line_whose_reclassification_the_sync_applied_is_placed_and_keeps_it() -> None:
    """Reclassified to another camp-aid description (a program mismatch), the line is still camp aid and
    still unplaced once Go applied it: it is open again and placeable, and placing it never undoes it."""
    store = one_line()
    service = to_place_service(store)
    await service.reclassify(YEAR, 9001, ReclassifyLineIn(source_key=QUEST_KEY, reason="Quest money"), ACTOR)
    store.details[9001] = LineDetail(9001, QUEST_KEY)  # tonight's sync applied it
    assert (await service.read(YEAR)).open_count == 1
    await service.place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    placed = _without_locks(store.operations[-1])[0]
    assert placed.data is not None
    assert (placed.action, placed.data["source_key_override"], placed.data["attributed_person_cm_id"]) == (
        "update",
        QUEST_KEY,
        1000011,
    )


@pytest.mark.asyncio
async def test_a_placement_that_would_not_land_on_the_request_is_refused() -> None:
    """A request with no session yet names only its camper and program: with the camper's second request
    in the same program, the placement would land on neither, so it is refused before anything is written."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    seed_request(store, "reqemmab0000001", session=1000102)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    with pytest.raises(DecisionRefusedError, match="would not land"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_place_is_refused_before_ticks_began() -> None:
    with pytest.raises(DecisionRefusedError, match="predates To place"):
        await to_place_service(one_line()).place(2026, 9001, _place((EMMA, "1500")), ACTOR)


# --- leave at family level, reopen ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_leaving_a_line_at_family_level_records_its_note_once_and_reopening_undoes_it() -> None:
    store = one_line()
    service = to_place_service(store)
    first = await service.leave(YEAR, 9001, LeaveLineIn(note="Family pays it back in June"), ACTOR)
    assert (first.written, len(first.operation_id)) == (1, 15)
    write = store.operations[0][0]
    assert (write.collection, write.action, write.log_action) == (
        "aid_flag_dispositions",
        "create",
        "leave_at_family_level",
    )
    assert write.data is not None
    assert {k: write.data[k] for k in ("flag", "disposition", "note")} == {
        "flag": "to_place",
        "disposition": "accepted_let_stand",
        "note": "Family pays it back in June",
    }
    out = await service.read(YEAR)
    assert (out.open_count, out.open_total, out.left_total) == (0, 0.0, 1500.0)
    assert [(ln.transaction_cm_id, ln.left_note) for ln in out.left] == [(9001, "Family pays it back in June")]
    again = await service.leave(YEAR, 9001, LeaveLineIn(note="Family pays it back in June"), ACTOR)
    assert (again.written, again.operation_id) == (0, "")
    reopened = await service.reopen(YEAR, 9001, "Left it by mistake", ACTOR)
    assert reopened.written == 1
    assert store.operations[-1][0].action == "delete"
    assert (await service.read(YEAR)).open_count == 1
    assert (await service.reopen(YEAR, 9001, "Again", ACTOR)).written == 0


@pytest.mark.asyncio
async def test_placing_a_line_left_at_family_level_ends_the_leave_in_the_same_operation() -> None:
    store = one_line()
    service = to_place_service(store)
    await service.leave(YEAR, 9001, LeaveLineIn(note="Waiting for the family"), ACTOR)
    await service.place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    placed = _without_locks(store.operations[-1])
    assert [(w.collection, w.action) for w in placed[:2]] == [
        ("aid_attribution_overrides", "create"),
        ("aid_flag_dispositions", "delete"),
    ]
    assert store.left == {}


@pytest.mark.asyncio
async def test_only_a_line_in_to_place_is_left_at_family_level() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, "1500", person=1000011, posted=MAR8)
    with pytest.raises(DecisionRefusedError, match="already on a request"):
        await to_place_service(store).leave(YEAR, 9001, LeaveLineIn(note="n"), ACTOR)


# --- reclassify (D104) ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reclassifying_writes_the_lines_source_and_waits_for_the_sync_apart_from_the_open_lines() -> None:
    store = one_line()
    service = to_place_service(store)
    body = ReclassifyLineIn(source_key=GRANT_KEY, reason="Outside grant posted as camp aid")
    out = await service.reclassify(YEAR, 9001, body, ACTOR)
    assert out.written == 1
    write = store.operations[0][0]
    assert (write.collection, write.action, write.log_action) == ("aid_attribution_overrides", "create", "reclassify")
    assert write.data is not None
    assert (write.data["source_key_override"], write.data["attributed_person_cm_id"], write.data["note"]) == (
        GRANT_KEY,
        0,
        "Outside grant posted as camp aid",
    )
    read = await service.read(YEAR)
    assert (read.open_count, read.reclassified_total) == (0, 1500.0)
    assert [(ln.transaction_cm_id, ln.reclassified_to) for ln in read.reclassified] == [(9001, "Summer Program Grant")]
    assert (await service.reclassify(YEAR, 9001, body, ACTOR)).written == 0  # the same again changes nothing


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("key", "why"),
    [
        ("no such description", "not in aid_sources"),
        ("new description", "not classified as aid"),
        ("refer a friend", "not classified as aid"),
        ("camp fa", "already"),
    ],
)
async def test_a_reclassification_must_name_another_classified_aid_source(key: str, why: str) -> None:
    store = one_line()
    with pytest.raises(DecisionRefusedError, match=why):
        await to_place_service(store).reclassify(YEAR, 9001, ReclassifyLineIn(source_key=key, reason="r"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_reclassification_keeps_an_existing_placement() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, "reqemmaq0000001", session=1000106)
    seed_line(store, 9001, "100", person=0, posted=MAR8)
    seed_override_row(store, 9001, person=1000011)  # names Emma, who has two requests: still at family level
    await to_place_service(store).reclassify(YEAR, 9001, ReclassifyLineIn(source_key=GRANT_KEY, reason="r"), ACTOR)
    write = store.operations[0][0]
    assert write.data is not None
    assert (write.data["attributed_person_cm_id"], write.data["source_key_override"]) == (1000011, GRANT_KEY)


# --- review focus ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_people_placing_one_line_at_once_get_one_placement_and_a_clean_refusal() -> None:
    """The second confirm read the season before the first committed: the unique index refuses its batch,
    so nothing of it is written and no round is ticked twice. It is G6's 409 ("reload and try again"), not
    a 500. This holds for two CREATES of one placement; see Decision 15 for the windows it doesn't close."""
    store = one_line()
    service = to_place_service(store)
    await service.place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    events, rows = len(store.events), dict(store.override_rows)

    async def stale(year: int) -> dict[int, OverrideRow]:
        return {}

    store.fetch_override_rows = stale  # type: ignore[method-assign]
    store.placements.clear()  # the second request's season read: the line still at family level
    with pytest.raises(AidWriteConflictError):
        await service.place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert (len(store.events), store.override_rows) == (events, rows)


@pytest.mark.asyncio
async def test_a_double_clicked_leave_is_a_conflict_not_a_500() -> None:
    store = one_line()
    service = to_place_service(store)
    await service.leave(YEAR, 9001, LeaveLineIn(note="Waiting for the family"), ACTOR)

    async def stale(year: int) -> dict[int, LeftLine]:
        return {}

    store.fetch_left_lines = stale  # type: ignore[method-assign]
    with pytest.raises(AidWriteConflictError):
        await service.leave(YEAR, 9001, LeaveLineIn(note="Waiting for the family"), ACTOR)


@pytest.mark.asyncio
async def test_a_double_clicked_reopen_is_a_conflict_not_a_500() -> None:
    store = one_line()
    service = to_place_service(store)
    await service.leave(YEAR, 9001, LeaveLineIn(note="Waiting for the family"), ACTOR)
    seen = dict(store.left)
    await service.reopen(YEAR, 9001, "Left by mistake", ACTOR)

    async def stale(year: int) -> dict[int, LeftLine]:
        return seen  # read before the first reopen deleted the row

    store.fetch_left_lines = stale  # type: ignore[method-assign]
    with pytest.raises(AidWriteConflictError):
        await service.reopen(YEAR, 9001, "Left by mistake", ACTOR)


@pytest.mark.asyncio
async def test_a_double_clicked_reclassify_is_a_conflict_not_a_500() -> None:
    store = one_line()
    service = to_place_service(store)
    body = ReclassifyLineIn(source_key=GRANT_KEY, reason="Outside grant posted as camp aid")
    await service.reclassify(YEAR, 9001, body, ACTOR)

    async def stale(year: int) -> dict[int, OverrideRow]:
        return {}

    store.fetch_override_rows = stale  # type: ignore[method-assign]
    with pytest.raises(AidWriteConflictError):
        await service.reclassify(YEAR, 9001, body, ACTOR)


@pytest.mark.asyncio
async def test_a_placement_whose_rules_locks_went_stale_writes_nothing_and_is_a_conflict() -> None:
    """G6: finance approved a section after this placement read the rules. The batch is refused whole: no
    override, no Posted row, no log row (the fake checks every sub-request before applying any)."""
    store = one_line()
    store.rules_revision[RULES_ID] = 1
    with pytest.raises(AidWriteConflictError):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert (store.override_rows, store.events, store.log) == ({}, [], [])


@pytest.mark.asyncio
async def test_the_suggestion_shows_what_confirming_it_locks_and_the_write_locks_exactly_that() -> None:
    """§4.10: the confirmation shows the total it locks, and what you confirm is what's written."""
    store = one_line()
    service = to_place_service(store)
    (line,) = (await service.read(YEAR)).groups[0].lines
    assert line.suggestion is not None
    preview = [(t.request_id, t.round, t.amount) for t in line.suggestion.would_tick]
    assert preview == [(EMMA, 1, 1500.0)]
    body = PlaceLineIn(parts=[PlacePartIn(request_id=EMMA, amount=Decimal(1500))], expected_locked=Decimal(1500))
    out = await service.place(YEAR, 9001, body, ACTOR)
    assert [(t.request_id, t.round, t.amount) for t in out.ticked] == preview


@pytest.mark.asyncio
async def test_a_placement_that_would_now_lock_another_total_than_was_confirmed_is_refused() -> None:
    store = one_line()
    body = PlaceLineIn(parts=[PlacePartIn(request_id=EMMA, amount=Decimal(1500))], expected_locked=Decimal(1400))
    with pytest.raises(DecisionRefusedError, match=r"now locks \$1,500, not the \$1,400 you confirmed"):
        await to_place_service(store).place(YEAR, 9001, body, ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_split_part_left_behind_shows_the_part_and_replacing_the_line_rewrites_the_split() -> None:
    """Liam's request was withdrawn after the split, before anything of his was ticked: his part waits at
    family level, the read shows it, and placing the line again replaces the whole override."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "2500", person=0, posted=MAR8)
    service = to_place_service(store)
    out = await service.place(YEAR, 9001, _place((EMMA, "1500"), (LIAM, "1000")), ACTOR)
    assert [t.request_id for t in out.ticked] == [EMMA]  # Liam's 1,000 is short of his 1,500
    store.requests[LIAM] = replace(store.requests[LIAM], status="withdrawn")
    (line,) = (await service.read(YEAR)).groups[0].lines
    assert (line.amount, line.unplaced) == (2500.0, 1000.0)
    await service.place(YEAR, 9001, _place((EMMA, "2500")), ACTOR)
    rewrite = store.operations[-1][0]
    assert (rewrite.action, rewrite.data is not None and rewrite.data["split"]) == ("update", [])
    assert (await service.read(YEAR)).open_count == 0


@pytest.mark.asyncio
async def test_an_over_posting_places_and_ticks_at_the_decided_amount() -> None:
    """D78, D146: over-postings tick, at the decided amount; the gap shows as "over" in the confirmation."""
    store = one_line("1600")
    out = await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1600")), ACTOR)
    assert [(t.round, t.amount) for t in out.ticked] == [(1, 1500.0)]


@pytest.mark.asyncio
async def test_a_family_camp_line_in_a_household_with_a_summer_request_too_lands_on_the_weekend() -> None:
    """The household's own (Family Camp) request has no camper: the placement names its session alone."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, "reqfamily000001", person=0, session=1000201)
    seed_line(store, 9001, "700", person=0, posted=MAR8)
    (item,) = (await to_place_service(store).read(YEAR)).groups[0].lines
    assert sorted(c.request_id for c in item.candidates) == sorted([EMMA, "reqfamily000001"])
    await to_place_service(store).place(YEAR, 9001, _place(("reqfamily000001", "700")), ACTOR)
    override = store.operations[-1][0]
    assert override.data is not None
    assert (override.data["attributed_person_cm_id"], override.data["attributed_session_cm_id"]) == (0, 1000201)
    assert (override.data["program_family"]) == "family_camp"


# --- the build lead's checks --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_left_line_is_written_with_the_shared_constants_so_the_read_finds_it_as_left() -> None:
    store = one_line()
    service = to_place_service(store)
    await service.leave(YEAR, 9001, LeaveLineIn(note="Waiting for the family"), ACTOR)
    data = store.operations[0][0].data
    assert data is not None
    assert (data["flag"], data["disposition"]) == (TO_PLACE_FLAG, LEFT_DISPOSITION)
    read = await service.read(YEAR)
    assert [ln.transaction_cm_id for ln in read.left] == [9001]
    assert read.groups[0].lines == []
    assert read.open_count == 0


@pytest.mark.parametrize("amount", ["0", "-5", "-0.01"])
def test_a_zero_or_negative_part_is_refused_before_any_service_runs(amount: str) -> None:
    with pytest.raises(ValidationError):
        _place((EMMA, amount))


def test_two_parts_on_one_request_are_refused_before_any_service_runs() -> None:
    with pytest.raises(ValidationError, match="each request takes one part"):
        _place((EMMA, "700"), (EMMA, "800"))


@pytest.mark.asyncio
async def test_split_parts_short_of_or_over_the_line_are_refused_to_the_cent() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "3000", person=0, posted=MAR8)
    service = to_place_service(store)
    with pytest.raises(DecisionRefusedError, match=r"add up to \$2,999\.99; the line is \$3,000"):
        await service.place(YEAR, 9001, _place((EMMA, "1500"), (LIAM, "1499.99")), ACTOR)
    with pytest.raises(DecisionRefusedError, match=r"add up to \$3,000\.01; the line is \$3,000"):
        await service.place(YEAR, 9001, _place((EMMA, "1500.01"), (LIAM, "1500")), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_placing_only_the_remainder_of_a_partly_placed_line_is_refused_not_a_silent_replacement() -> None:
    """Emma's part still stands and Liam's is unplaced (1,000). Confirming just the 1,000 would replace the
    whole override and drop Emma's part, so the parts must cover the WHOLE line (2,500) and say so."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "2500", person=0, posted=MAR8)
    service = to_place_service(store)
    await service.place(YEAR, 9001, _place((EMMA, "1500"), (LIAM, "1000")), ACTOR)
    store.requests[LIAM] = replace(store.requests[LIAM], status="withdrawn")
    operations = len(store.operations)
    with pytest.raises(DecisionRefusedError, match=r"add up to \$1,000; the line is \$2,500"):
        await service.place(YEAR, 9001, _place((EMMA, "1000")), ACTOR)
    assert len(store.operations) == operations
    assert store.splits[9001][0].amount == Decimal(1500)  # Emma's standing part is untouched


@pytest.mark.asyncio
async def test_the_read_files_open_left_pending_and_applied_lines_apart() -> None:
    store = FakeToPlaceStore()
    for txn, amount in ((9001, "100"), (9002, "200"), (9003, "300"), (9004, "400")):
        seed_line(store, txn, amount, household=1000009, person=0, posted=MAR8)  # no request behind any
    service = to_place_service(store)
    await service.leave(YEAR, 9001, LeaveLineIn(note="Family pays it back"), ACTOR)
    await service.reclassify(YEAR, 9002, ReclassifyLineIn(source_key=GRANT_KEY, reason="Outside grant"), ACTOR)
    await service.reclassify(YEAR, 9003, ReclassifyLineIn(source_key=QUEST_KEY, reason="Quest money"), ACTOR)
    store.details[9003] = LineDetail(9003, QUEST_KEY)  # the sync applied 9003's, not 9002's
    read = await service.read(YEAR)
    assert [ln.transaction_cm_id for ln in read.left] == [9001]
    assert [(ln.transaction_cm_id, ln.reclassified_to) for ln in read.reclassified] == [(9002, "Summer Program Grant")]
    open_lines = sorted(ln.transaction_cm_id for g in read.groups for ln in g.lines)
    assert open_lines == [9003, 9004]
    assert (read.open_count, read.open_total) == (2, 700.0)
    assert (read.left_total, read.reclassified_total) == (100.0, 200.0)


@pytest.mark.asyncio
async def test_a_write_that_changes_nothing_never_reaches_the_change_log() -> None:
    store = one_line()
    seed_line(store, 9002, "200", household=1000009, person=0, posted=MAR8)
    service = to_place_service(store)
    note = LeaveLineIn(note="Waiting for the family")
    body = ReclassifyLineIn(source_key=GRANT_KEY, reason="Outside grant")
    await service.leave(YEAR, 9001, note, ACTOR)
    await service.reclassify(YEAR, 9002, body, ACTOR)
    operations, log = len(store.operations), len(store.log)
    assert (await service.leave(YEAR, 9001, note, ACTOR)).operation_id == ""
    assert (await service.reclassify(YEAR, 9002, body, ACTOR)).operation_id == ""
    assert (await service.reopen(YEAR, 9999, "nothing there", ACTOR)).operation_id == ""
    assert (len(store.operations), len(store.log)) == (operations, log)


# --- fix round 1 ------------------------------------------------------------------------------------


def _two_ambiguous_lines() -> FakeToPlaceStore:
    """Emma and Liam in one household: both 750 lines are family level ("several"), and both go on Emma."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "750", person=0, posted=MAR8)
    seed_line(store, 9002, "750", person=0, posted=MAR8)
    return store


def _both_on_emma(expected: str | None = None) -> PlaceLinesIn:
    return PlaceLinesIn(
        lines=[
            PlaceLinesRow(transaction_cm_id=9001, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(750))]),
            PlaceLinesRow(transaction_cm_id=9002, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(750))]),
        ],
        expected_locked=Decimal(expected) if expected is not None else None,
    )


@pytest.mark.asyncio
async def test_a_class_of_lines_on_one_request_locks_its_round_once() -> None:
    store = _two_ambiguous_lines()
    out = await to_place_service(store).place_lines(YEAR, _both_on_emma(), ACTOR)
    assert [(t.request_id, t.round, t.amount) for t in out.ticked] == [(EMMA, 1, 1500.0)]
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_a_class_confirm_does_not_take_an_expected_total() -> None:
    """The bulk total is an estimate: two lines each showing Round 1 would sum to twice what the one write locks."""
    store = _two_ambiguous_lines()
    with pytest.raises(DecisionRefusedError, match="confirm lines one by one to check the exact total"):
        await to_place_service(store).place_lines(YEAR, _both_on_emma("3000"), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_a_single_line_confirm_still_checks_its_exact_total() -> None:
    store = one_line()
    body = PlaceLinesIn(
        lines=[PlaceLinesRow(transaction_cm_id=9001, parts=[PlacePartIn(request_id=EMMA, amount=Decimal(1500))])],
        expected_locked=Decimal(1400),
    )
    with pytest.raises(DecisionRefusedError, match="now locks"):
        await to_place_service(store).place_lines(YEAR, body, ACTOR)


@pytest.mark.asyncio
async def test_the_suggestion_carries_the_total_it_would_lock() -> None:
    (line,) = (await to_place_service(one_line()).read(YEAR)).groups[0].lines
    assert line.suggestion is not None
    assert line.suggestion.would_lock == 1500.0


@pytest.mark.asyncio
async def test_a_partly_placed_line_says_so_when_its_parts_do_not_cover_the_whole() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, person=1000012)
    seed_line(store, 9001, "2500", person=0, posted=MAR8)
    service = to_place_service(store)
    await service.place(YEAR, 9001, _place((EMMA, "1500"), (LIAM, "1000")), ACTOR)
    store.requests[LIAM] = replace(store.requests[LIAM], status="withdrawn")
    with pytest.raises(DecisionRefusedError, match="partly placed; a placement replaces all of it"):
        await service.place(YEAR, 9001, _place((EMMA, "1000")), ACTOR)


@pytest.mark.asyncio
async def test_the_session_cause_is_named_only_when_it_is_the_known_cause() -> None:
    store = FakeToPlaceStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    seed_request(store, "reqemmab0000001", session=1000102)
    seed_line(store, 9001, "1500", person=0, posted=MAR8)
    with pytest.raises(DecisionRefusedError, match="its session is not known yet"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)


@pytest.mark.asyncio
async def test_the_rules_locks_lead_the_operation_and_a_stale_lock_writes_nothing() -> None:
    """G6's convention: aid_rules locks first. Sections left unlocked are locked by the first tick, so make the
    first lock stale and check the whole batch is refused."""
    store = one_line()
    store.rules_revision[RULES_ID] = 1
    with pytest.raises(AidWriteConflictError):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)
    assert (store.override_rows, store.events, store.log) == ({}, [], [])


def _failing_commit(store: FakeToPlaceStore, error: Exception) -> None:
    async def commit(*args: object, **kwargs: object) -> None:
        raise error

    store.commit = commit  # type: ignore[method-assign,assignment]


@pytest.mark.asyncio
async def test_a_batch_refused_for_another_reason_is_a_nothing_was_written_refusal() -> None:
    store = one_line()
    _failing_commit(
        store,
        BatchRequestFailedError(
            index=0, total=1, request=None, status=400, message="Something is wrong.", field_errors={}, response=None
        ),
    )
    with pytest.raises(DecisionRefusedError, match="nothing was written"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)


@pytest.mark.asyncio
async def test_a_class_too_big_for_one_batch_is_refused_to_place_in_smaller_groups() -> None:
    store = one_line()
    _failing_commit(store, BatchLimitError("too many"))
    with pytest.raises(DecisionRefusedError, match="too many to place at once"):
        await to_place_service(store).place(YEAR, 9001, _place((EMMA, "1500")), ACTOR)


@pytest.mark.asyncio
async def test_reclassifying_a_left_line_ends_its_leave_in_the_same_operation() -> None:
    store = one_line()
    service = to_place_service(store)
    await service.leave(YEAR, 9001, LeaveLineIn(note="Waiting"), ACTOR)
    await service.reclassify(YEAR, 9001, ReclassifyLineIn(source_key=GRANT_KEY, reason="Outside grant"), ACTOR)
    operation = store.operations[-1]
    assert [(w.collection, w.action) for w in operation] == [
        ("aid_attribution_overrides", "create"),
        ("aid_flag_dispositions", "delete"),
    ]
    assert store.left == {}
