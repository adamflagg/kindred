"""A rules approval's recorded effect (Season › History back-end ask H3). Fictional only."""

from __future__ import annotations

from decimal import Decimal

from api.services.financial_aid_rules_effect import RULES_EFFECT_ENTITY, ApprovalEffect, approval_counts
from api.services.financial_aid_season_history import ENTITY_KINDS
from bunking.financial_aid.decisions import PricedRequest, RoundStatus, RoundView
from tests.unit.bunking.financial_aid.fixtures import app

EMMA, SAMUEL, LIAM = "reqemma00000001", "reqsamuel000001", "reqliam00000001"


def _d(value: str | None) -> Decimal | None:
    return Decimal(value) if value is not None else None


def _view(
    n: int, status: RoundStatus, *, decided: str | None = None, would: str | None = None, clawed_back: bool = False
) -> RoundView:
    return RoundView(
        round=n,
        status=status,
        ask=None,
        decided=_d(decided),
        locked=_d(decided) if status == "posted" else None,
        accepted=False,
        pending=None,
        would_change_by=_d(would),
        counts_toward_budget=True,
        pool="camp_pool",
        clawed_back=clawed_back,
    )


def _priced(request_id: str, *views: RoundView, live: bool = True) -> PricedRequest:
    return PricedRequest(
        request_id=request_id,
        household_cm_id=1000001,
        live=live,
        program_key="summer",
        pool="camp_pool",
        rounds=views,
        holds=(),
        notes=(),
        application=app(),
        inputs=None,
        result=None,
    )


def test_an_unsent_round_whose_amount_moved_is_re_priced_once_per_request() -> None:
    was = {
        EMMA: _priced(EMMA, _view(1, "needs_offer", decided="1420"), _view(2, "needs_offer", decided="300")),
        SAMUEL: _priced(SAMUEL, _view(1, "needs_offer", decided="900")),
    }
    now = {
        EMMA: _priced(EMMA, _view(1, "needs_offer", decided="1380"), _view(2, "needs_offer", decided="310")),
        SAMUEL: _priced(SAMUEL, _view(1, "needs_offer", decided="900")),
    }
    assert approval_counts(was, now) == (1, 0)  # Emma once, though two of her rounds moved


def test_a_held_round_that_becomes_priced_is_re_priced() -> None:
    was = {LIAM: _priced(LIAM, _view(1, "held"))}
    now = {LIAM: _priced(LIAM, _view(1, "needs_offer", decided="500"))}
    assert approval_counts(was, now) == (1, 0)


def test_a_priced_round_that_becomes_held_is_re_priced() -> None:
    """Either direction counts (the Owner question's default): priced becoming held moved the amount too."""
    was = {LIAM: _priced(LIAM, _view(1, "needs_offer", decided="500"))}
    now = {LIAM: _priced(LIAM, _view(1, "held"))}
    assert approval_counts(was, now) == (1, 0)


def test_a_sent_offer_is_flagged_only_when_its_would_change_by_moves_to_a_new_amount() -> None:
    """⚠ Number meaning (the Owner question): a flag set or changed counts; a flag that stays or clears does not."""

    def flagged(before: str | None, after: str | None) -> int:
        was = {LIAM: _priced(LIAM, _view(1, "posted", decided="1500", would=before))}
        now = {LIAM: _priced(LIAM, _view(1, "posted", decided="1500", would=after))}
        return approval_counts(was, now)[1]

    assert flagged(None, "-120") == 1
    assert flagged("-120", "80") == 1
    assert flagged("-120", "-120") == 0
    assert flagged("-120", None) == 0
    assert flagged("-120", "0") == 0


def test_flagged_counts_sent_offers_not_requests() -> None:
    """D49's noun is the offer: one request with two flagged posted rounds is two flagged offers, one re-priced request
    only when an unsent round moved too."""
    was = {EMMA: _priced(EMMA, _view(1, "posted", decided="1500"), _view(2, "posted", decided="300"))}
    now = {
        EMMA: _priced(
            EMMA, _view(1, "posted", decided="1500", would="-120"), _view(2, "posted", decided="300", would="40")
        )
    }
    assert approval_counts(was, now) == (0, 2)


def test_a_posted_amount_never_re_prices_and_clawed_back_or_closed_requests_count_nowhere() -> None:
    was = {
        EMMA: _priced(EMMA, _view(1, "posted", decided="1500")),
        SAMUEL: _priced(SAMUEL, _view(1, "posted", decided="900", clawed_back=True)),
        LIAM: _priced(LIAM, _view(1, "needs_offer", decided="400"), live=False),
    }
    now = {
        EMMA: _priced(EMMA, _view(1, "posted", decided="1500")),
        SAMUEL: _priced(SAMUEL, _view(1, "posted", decided="900", would="-50", clawed_back=True)),
        LIAM: _priced(LIAM, _view(1, "needs_offer", decided="450"), live=False),
    }
    assert approval_counts(was, now) == (0, 0)


def test_the_logged_effect_is_four_whole_numbers() -> None:
    assert ApprovalEffect(3, 4, 41, 12).log() == {"from_version": 3, "to_version": 4, "repriced": 41, "flagged": 12}


def test_an_effect_row_is_a_rules_row_in_history() -> None:
    """RBAC: without this mapping the row defaults to "money" and a registrar would see a rules approval."""
    assert ENTITY_KINDS.get(RULES_EFFECT_ENTITY) == "rules"
