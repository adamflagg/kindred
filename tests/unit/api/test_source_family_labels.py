"""Source-family words (owner ruling 10-08: "Source-family names: a small SERVER word list next to the closed
family list (source_family_label); never show keys."). Fictional only."""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any, get_args

import pytest

from api.schemas.financial_aid import (
    AidPostingLine,
    AidSourceRow,
    ClassifiedSourceFamily,
    NetAidTotal,
    SourceFamily,
    SummaryCell,
)
from api.schemas.financial_aid_grants import GrantorDescription, GrantRowOut
from api.schemas.financial_aid_money_ledger import LedgerLineOut
from api.schemas.source_family_labels import SOURCE_FAMILY_LABELS, source_family_label

GO_CONFIG = Path(__file__).resolve().parents[3] / "pocketbase" / "sync" / "aid_sources_config.go"
ALL_KEYS = [*get_args(ClassifiedSourceFamily), "unclassified"]


def test_the_python_family_list_matches_the_go_closed_list() -> None:
    """Regression guard. A new Go family fails here, so it cannot reach staff without a word."""
    src = GO_CONFIG.read_text()
    body = re.search(r"aidSourceFamilies\s*=\s*\[\]string\{(.*?)\}", src, re.DOTALL)
    assert body is not None
    go_keys = set(re.findall(r'"([a-z_]+)"', body.group(1)))
    assert go_keys == set(get_args(ClassifiedSourceFamily))
    assert set(get_args(SourceFamily)) == go_keys | {"unclassified"}


@pytest.mark.parametrize("key", ALL_KEYS)
def test_every_family_has_a_plain_label_that_is_not_its_key(key: str) -> None:
    label = source_family_label(key)
    assert label
    assert key not in label  # the raw key, case-sensitive: "Placeholder" is a word, "placeholder" the key
    assert "_" not in label


def test_the_word_list_covers_exactly_the_families() -> None:
    assert set(SOURCE_FAMILY_LABELS) == set(ALL_KEYS)


@pytest.mark.parametrize("key", ["", "made_up", "CAMP_FA"])
def test_an_unknown_key_has_no_label_and_is_never_echoed(key: str) -> None:
    assert source_family_label(key) == ""


def _cell() -> dict[str, Any]:
    return {"program": "summer", "amount": 1.0, "postings": 1, "households": 1}


def _models(family: str) -> list[Any]:
    return [
        SummaryCell(source_family=family, **_cell()),
        GrantorDescription(source_id="a", description_key="k", description="d", source_family=family),
        LedgerLineOut(
            transaction_cm_id=1,
            household_cm_id=1000001,
            family_household_cm_id=1000001,
            family_name="Johnson",
            camper="Emma Johnson",
            description="d",
            source_family=family,
            program="summer",
            amount=1.0,
            posted_on=date(2027, 1, 1),
            is_reversed=False,
            reversed_on=None,
            level=None,
        ),
    ]


@pytest.mark.parametrize("model", [SummaryCell, GrantorDescription, LedgerLineOut, GrantRowOut, AidSourceRow])
def test_every_response_model_that_sends_a_family_sends_its_label_with_a_default(model: type) -> None:
    field = model.model_fields["source_family_label"]  # type: ignore[attr-defined]
    assert field.default == ""
    assert not field.is_required()


@pytest.mark.parametrize("model", [AidPostingLine, NetAidTotal])
def test_the_ledger_read_rows_carry_the_label_too(model: type) -> None:
    assert model.model_fields["source_family_label"].default == ""  # type: ignore[attr-defined]


@pytest.mark.parametrize("family", ALL_KEYS)
def test_a_built_response_carries_the_right_label(family: str) -> None:
    for m in _models(family):
        assert m.source_family_label == source_family_label(family)


def test_a_blank_family_sends_a_blank_label() -> None:
    """A commitment row has no source family: it sends "" and never a key."""
    for m in _models(""):
        assert m.source_family_label == ""


def test_the_ledger_services_builders_send_the_label() -> None:
    """The Sources registry row and the posting line (the Ledger's lines) carry the words, not just the key."""
    from api.services.financial_aid_ledger_service import posting_line, source_row
    from tests.unit.api.services.test_financial_aid_ledger_service import _posting
    from tests.unit.api.services.test_financial_aid_sources_read import _source

    row = source_row(_source("regional grant", "src000000000001"))
    assert (row.source_family, row.source_family_label) == ("other_outside", "Other outside grants")
    line = posting_line(_posting(1, 1000001, -100.0), {})
    assert (line.source_family, line.source_family_label) == ("camp_fa", "Camp financial aid")
    blank = posting_line(_posting(2, 1000001, -100.0, source_family=""), {})
    assert (blank.source_family, blank.source_family_label) == ("unclassified", "Not yet classified")


def test_a_grant_line_with_a_blank_family_reads_not_yet_classified() -> None:
    """A CampMinder grant line whose posting has no family reads "Not yet classified", as the posting line
    and the money ledger do for the same posting; only a commitment row sends a blank family."""
    from api.services.financial_aid_grants_service import _line
    from tests.unit.api.services.test_financial_aid_grants_service import _posting as _grant_posting

    line = _line(_grant_posting(9001, 500.0, source_family=""))
    assert line.source_family == "unclassified"
    assert source_family_label(line.source_family) == "Not yet classified"
