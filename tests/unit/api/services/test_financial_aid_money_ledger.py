"""Money > Ledger's family rows, the pure part (campership slice 3, ask 1; §5.5, §8.1; D26, D54, D74, D97, D151).
Fictional only. The SeasonLedgers here are built by hand, as build_ledger leaves them."""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord
from api.services.financial_aid_money_ledger import (
    LedgerFilters,
    LedgerLine,
    Piece,
    as_recorded_lines,
    families,
    family_totals,
    ledger_pieces,
    total_lines,
)
from api.services.financial_aid_reconciliation import CampLine, SeasonLedger
from api.services.financial_aid_to_place import MISMATCH_FLAG
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_line, seed_request, share_row
from tests.unit.api.services.financial_aid_fakes import SESSIONS

EMMA = "reqemma00000001"  # Emma Johnson (1000011), household 1000001
SAMUEL = "reqsamu00000001"  # Samuel Johnson (1000012), the same household
LIAM = "reqliam00000001"  # Liam Garcia (1000021), household 1000002
MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)
MAR20 = datetime(2027, 3, 20, 18, 0, tzinfo=UTC)
APR1 = datetime(2027, 4, 1, 18, 0, tzinfo=UTC)
JUN1 = datetime(2027, 6, 1, 18, 0, tzinfo=UTC)
SESSION_MAP = {s.cm_id: s for s in SESSIONS}


def _johnsons() -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, SAMUEL, person=1000012)
    return store


def _season(store: FakeDecisionsStore) -> tuple[dict[str, RequestRecord], dict[str, tuple[PayerShareRecord, ...]]]:
    shares = {rid: tuple(s for s in store.shares if s.request_id == rid) for rid in store.requests}
    return store.requests, shares


def _camp(line: CampLine, *, flags: tuple[str, ...] = ()) -> LedgerLine:
    return LedgerLine(line, "camp", "camp fa", "camp_fa", flags)


def _other(
    txn: int, amount: str, *, funder: str = "outside", family: str = "other_outside", household: int = 1000001
) -> LedgerLine:
    line = CampLine(txn, household, 0, Decimal(amount), MAR8, False, None)
    return LedgerLine(line, funder, "summer program grant", family)


def _pieces(
    store: FakeDecisionsStore,
    lines: Iterable[LedgerLine],
    placed: SeasonLedger,
    *,
    left: Collection[int] = (),
    at: datetime | None = None,
    register: Iterable[RegisterRow] = (),
    levels: bool = True,
) -> list[Piece]:
    requests, shares = _season(store)
    return ledger_pieces(lines, placed, requests, shares, SESSION_MAP, register, left=left, at=at, levels=levels)


# --- the family (D26, closed) -------------------------------------------------------------------


def test_a_family_is_every_household_a_payer_share_joins() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    store.shares = [share_row(EMMA, 1000001, "60"), share_row(EMMA, 1000004, "40"), share_row(LIAM, 1000002, "100")]
    found = families(*_season(store))
    assert found[1000001] == found[1000004] == (1000001, 1000004)  # the row opens the applying household
    assert found[1000002] == (1000002,)
    assert 1000009 not in found  # a household with no request is its own family
    # A household paying a share of two families' requests joins them, so every line sits in exactly one row.
    store.shares.append(share_row(LIAM, 1000004, "10"))
    assert families(*_season(store))[1000002] == (1000001, 1000002, 1000004)


# --- the level, read from Kindred's placements (D151) --------------------------------------------


def test_a_line_on_a_request_has_no_level_and_one_no_request_takes_has_to_places_reason() -> None:
    store = _johnsons()
    on_emma = seed_line(store, 9001, "1500")
    several = seed_line(store, 9002, "3000", person=0)
    left = seed_line(store, 9003, "200", person=0)
    mismatch = seed_line(store, 9004, "100", person=0)
    nobody = seed_line(store, 9005, "700", household=1000009, person=0)
    placed = SeasonLedger(
        by_request={EMMA: (on_emma,)},
        unplaced_lines_by_household={1000001: (several, left, mismatch), 1000009: (nobody,)},
        read=True,
    )
    lines = [_camp(on_emma), _camp(several), _camp(left), _camp(mismatch, flags=(MISMATCH_FLAG,)), _camp(nobody)]
    pieces = _pieces(store, lines, placed, left={9003})
    assert {p.transaction_cm_id: p.level for p in pieces} == {
        9001: None,
        9002: "household",
        9003: "left",
        9004: "program_mismatch",
        9005: "no_request",
    }


def test_a_season_before_levels_exist_reads_no_level_on_any_piece() -> None:
    """Owner question 7 (default): `levels=False` (a season before FIRST_TICKED_SEASON) leaves `level` None on every
    piece, even a live camp-aid line no request takes. The amounts and nets are unchanged."""
    store = _johnsons()
    several = seed_line(store, 9002, "3000", person=0)
    nobody = seed_line(store, 9005, "700", household=1000009, person=0)
    placed = SeasonLedger(unplaced_lines_by_household={1000001: (several,), 1000009: (nobody,)}, read=True)
    lines = [_camp(several), _camp(nobody)]
    assert {p.level for p in _pieces(store, lines, placed)} == {"household", "no_request"}
    pieces = _pieces(store, lines, placed, levels=False)
    assert [p.level for p in pieces] == [None, None]
    assert sorted(t.in_campminder_net for t in family_totals(pieces)) == [Decimal(700), Decimal(3000)]
    assert {t.level for t in family_totals(pieces)} == {None}


def test_a_split_line_placed_in_full_wears_no_level() -> None:
    """D151: a split line is not "household level". Each part keeps its request's program and camper."""
    store = _johnsons()
    line = seed_line(store, 9006, "3000", person=0)
    placed = SeasonLedger(
        by_request={EMMA: (replace(line, amount=Decimal(1800)),), SAMUEL: (replace(line, amount=Decimal(1200)),)},
        read=True,
    )
    pieces = _pieces(store, [_camp(line)], placed)
    assert sorted((p.amount, p.level, p.program, p.person_cm_id) for p in pieces) == [
        (Decimal(1200), None, "summer", 1000012),
        (Decimal(1800), None, "summer", 1000011),
    ]
    # A part no request takes any more waits at household level alone; the placed part stays placed.
    partly = SeasonLedger(
        by_request={EMMA: (replace(line, amount=Decimal(1800)),)},
        unplaced_lines_by_household={1000001: (replace(line, amount=Decimal(1200)),)},
        read=True,
    )
    assert sorted((p.amount, str(p.level)) for p in _pieces(store, [_camp(line)], partly)) == [
        (Decimal(1200), "household"),
        (Decimal(1800), "None"),
    ]


def test_a_row_shows_open_work_before_a_line_a_person_left() -> None:
    store = _johnsons()
    several = seed_line(store, 9002, "3000", person=0)
    left = seed_line(store, 9003, "200", person=0)
    placed = SeasonLedger(unplaced_lines_by_household={1000001: (several, left)}, read=True)
    (both,) = family_totals(_pieces(store, [_camp(several), _camp(left)], placed, left={9003}))
    (only_left,) = family_totals(_pieces(store, [_camp(left)], placed, left={9003}))
    assert (both.level, only_left.level) == ("household", "left")


# --- the two columns (§5.5, D97), reversals (D54, D74), a past day ---------------------------------


def test_a_reversed_line_counts_as_a_line_and_never_in_a_net() -> None:
    store = _johnsons()
    live = seed_line(store, 9001, "1500")
    gone = seed_line(store, 9007, "300", person=0, reversed_at=JUN1)  # unplaced and reversed: in no SeasonLedger list
    placed = SeasonLedger(by_request={EMMA: (live,)}, read=True)
    (row,) = family_totals(_pieces(store, [_camp(live), _camp(gone)], placed))
    assert (row.in_campminder_net, row.lines, row.reversed_lines, row.level) == (Decimal(1500), 2, 1, None)


def test_outside_and_incentive_lines_are_outside_grants_with_no_level() -> None:
    """D97: the family incentive lines go to Outside grants with the outside ones, and carry no level (note 4)."""
    store = _johnsons()
    camp = seed_line(store, 9001, "1500")
    lines = [_camp(camp), _other(9101, "250"), _other(9102, "100", funder="incentive", family="jfam_incentive")]
    pieces = _pieces(store, lines, SeasonLedger(by_request={EMMA: (camp,)}, read=True))
    (row,) = family_totals(pieces)
    assert (row.in_campminder_net, row.outside_grants, row.lines) == (Decimal(1500), Decimal(350), 3)
    assert [p.level for p in pieces if not p.camp] == [None, None]


def _household_grant(txn: int, *, session: int, basis: str = "household", person: int = 0) -> RegisterRow:
    return RegisterRow(
        kind="ledger",
        transaction_cm_id=txn,
        commitment_id="",
        household_cm_id=1000001,
        person_cm_id=person,
        camper_basis=basis,  # type: ignore[arg-type]
        session_cm_id=session,
        program_family="family_camp",
        grantor_key="",
        source_key="",
        source_family="other_outside",
        funder_type="outside",
        amount=Decimal(250),
        recorded_on="2027-03-08",
        recorded_at=None,
        is_reversed=False,
        reversal_date="",
        cancelled=False,
        counts=True,
        fulfils_commitment_id="",
        requests=(),
    )


def test_an_outside_grant_posted_to_the_household_carries_the_household_level_and_its_session() -> None:
    """Final audit O3 (owner ruling): the lines card draws "Household level" and the Family Camp session for an outside
    grant that sits on the household, as it does for camp aid. A grant on a camper keeps no level."""
    store = _johnsons()
    camp = seed_line(store, 9001, "1500")
    placed = SeasonLedger(by_request={EMMA: (camp,)}, read=True)
    register = [
        _household_grant(9101, session=1000301),
        _household_grant(9102, session=1000102, basis="placed", person=1000011),
    ]
    pieces = _pieces(store, [_camp(camp), _other(9101, "250"), _other(9102, "250")], placed, register=register)
    by_txn = {p.transaction_cm_id: p for p in pieces}
    assert (by_txn[9101].level, by_txn[9101].household_session_cm_id) == ("household", 1000301)
    assert (by_txn[9102].level, by_txn[9102].household_session_cm_id) == (None, 0)
    # A season before levels exist carries none on any piece.
    old = _pieces(store, [_other(9101, "250")], placed, register=register, levels=False)
    assert [p.level for p in old] == [None]


def test_an_unclassified_line_counts_in_outside_grants() -> None:
    """Owner question 3 (default): a line whose description is still unclassified counts in Outside grants, so that
    nothing drops out of the Ledger (§8.1)."""
    store = _johnsons()
    camp = seed_line(store, 9001, "1500")
    lines = [_camp(camp), _other(9103, "40", funder="unknown", family="unclassified")]
    pieces = _pieces(store, lines, SeasonLedger(by_request={EMMA: (camp,)}, read=True))
    (row,) = family_totals(pieces)
    assert (row.in_campminder_net, row.outside_grants, row.lines) == (Decimal(1500), Decimal(40), 2)
    assert [p.level for p in pieces if not p.camp] == [None]


def test_on_a_past_day_a_line_posted_later_is_left_out_and_a_later_reversal_reads_live() -> None:
    store = _johnsons()
    early = seed_line(store, 9001, "1500", reversed_at=JUN1)
    later = seed_line(store, 9008, "400", posted=APR1)
    placed = SeasonLedger(by_request={EMMA: (early,)}, read=True)
    assert [(p.transaction_cm_id, p.live) for p in _pieces(store, [_camp(early), _camp(later)], placed, at=MAR20)] == [
        (9001, True)
    ]


def test_on_the_recorded_axis_a_line_kindred_recorded_after_the_day_is_left_out() -> None:
    store = FakeDecisionsStore()
    on_time = seed_line(store, 9001, "1500")
    late = seed_line(store, 9002, "300", recorded=APR1)
    assert [ll.line.transaction_cm_id for ll in as_recorded_lines([_camp(on_time), _camp(late)], MAR20)] == [9001]


# --- the filters and the lines behind a total ---------------------------------------------------


def test_the_filters_keep_lines_by_source_program_and_level() -> None:
    store = _johnsons()
    on_emma = seed_line(store, 9001, "1500")
    several = seed_line(store, 9002, "3000", person=0)
    placed = SeasonLedger(by_request={EMMA: (on_emma,)}, unplaced_lines_by_household={1000001: (several,)}, read=True)
    pieces = _pieces(store, [_camp(on_emma), _camp(several), _other(9101, "250")], placed)

    def kept(filters: LedgerFilters) -> set[int]:
        return {p.transaction_cm_id for p in pieces if filters.keeps(p)}

    assert kept(LedgerFilters()) == {9001, 9002, 9101}
    assert kept(LedgerFilters(level="household")) == {9002}
    assert kept(LedgerFilters(source="other_outside")) == {9101}
    assert kept(LedgerFilters(program="summer")) == {9001}  # placed on Emma's summer request; the others name none


def test_the_lines_behind_a_total_sum_a_split_lines_parts_and_keep_a_reversed_line() -> None:
    store = _johnsons()
    line = seed_line(store, 9006, "3000", person=0)
    gone = seed_line(store, 9007, "300", person=0, reversed_at=JUN1)
    placed = SeasonLedger(
        by_request={EMMA: (replace(line, amount=Decimal(1800)),), SAMUEL: (replace(line, amount=Decimal(1200)),)},
        read=True,
    )
    pieces = _pieces(store, [_camp(line), _camp(gone), _other(9101, "250")], placed)
    camp = total_lines(pieces, "in_campminder_net")
    assert sorted((lt.first.transaction_cm_id, lt.amount, lt.first.live, lt.person_cm_ids) for lt in camp) == [
        (9006, Decimal(3000), True, (1000011, 1000012)),
        (9007, Decimal(300), False, ()),
    ]
    assert [lt.first.transaction_cm_id for lt in total_lines(pieces, "outside_grants")] == [9101]


def test_a_line_on_a_household_request_names_its_session_and_a_camper_request_names_none() -> None:
    """Family Camp intake is one request per household (person_cm_id 0): the piece, and the family it totals into,
    carry that request's session so the Ledger can draw the household mark and its session (mock money-ledger)."""
    store = _johnsons()
    seed_request(store, "reqfam000000001", household=1000002, person=0, session=1000201)
    seed_request(store, "reqfam000000002", household=1000002, person=0, session=1000202)
    camper = seed_line(store, 9001, "1500")
    fam_a = seed_line(store, 9010, "800", household=1000002, person=0)
    fam_b = seed_line(store, 9011, "400", household=1000002, person=0)
    placed = SeasonLedger(
        by_request={
            EMMA: (camper,),
            "reqfam000000001": (fam_a,),
            "reqfam000000002": (fam_b,),
        },
        read=True,
    )
    pieces = _pieces(store, [_camp(camper), _camp(fam_a), _camp(fam_b)], placed)
    assert {p.transaction_cm_id: p.household_session_cm_id for p in pieces} == {9001: 0, 9010: 1000201, 9011: 1000202}
    by_family = {t.family: t for t in family_totals(pieces)}
    assert by_family[(1000001,)].household_session_cm_ids == ()
    assert by_family[(1000002,)].household_session_cm_ids == (1000201, 1000202)
    assert {t.first.transaction_cm_id: t.household_session_cm_id for t in total_lines(pieces, "in_campminder_net")} == {
        9001: 0,
        9010: 1000201,
        9011: 1000202,
    }
