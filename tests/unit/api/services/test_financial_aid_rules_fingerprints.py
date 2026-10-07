"""A rules section save or approval is refused when the section changed since it was opened: each section carries a
fingerprint of its stored content, and a save or approval that names a stale one is a 409 (SectionChangedError).
Per section, so staff working on DIFFERENT sections never conflict. Fictional season 2031 only."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from api.services.financial_aid_rules_service import (
    FinancialAidRulesService,
    FingerprintsMismatchError,
    SectionChangedError,
    section_fingerprint,
)
from bunking.financial_aid.rules import AidRules
from bunking.financial_aid.rules.schema import SECTION_NAMES
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"


async def _draft() -> tuple[FinancialAidRulesService, FakeStore]:
    store = FakeStore()
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    return service, store


async def _opening(service: FinancialAidRulesService) -> dict[str, str]:
    return {s.section: s.fingerprint for s in (await service.draft_view(2031)).sections}


def _awards(minimum: str) -> dict[str, Any]:
    return {**fictional_rules_json()["awards"], "minimum": minimum}


def _income(threshold: str) -> dict[str, Any]:
    return {**fictional_rules_json()["income"], "medical_threshold": threshold}


def _reversed(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _reversed(v) for k, v in reversed(list(value.items()))}
    if isinstance(value, list):
        return [_reversed(v) for v in value]
    return value


def test_a_fingerprint_is_stable_across_key_order() -> None:
    doc = fictional_rules()
    raw = json.loads(json.dumps(doc.model_dump(mode="json")))
    flipped = AidRules.model_validate(_reversed(raw))
    assert list(_reversed(raw)) != list(raw)  # the keys really are reordered
    for name in SECTION_NAMES:
        assert section_fingerprint(flipped, name) == section_fingerprint(doc, name)
        assert len(section_fingerprint(doc, name)) == 64


@pytest.mark.asyncio
async def test_a_fingerprint_moves_only_with_its_own_sections_content() -> None:
    service, _ = await _draft()
    before = await _opening(service)
    await service.save_section(
        2031, 1, "awards", _awards("150"), actor=TREASURER, expected_fingerprint=before["awards"]
    )
    after = await _opening(service)
    assert after["awards"] != before["awards"]
    assert {k: v for k, v in after.items() if k != "awards"} == {k: v for k, v in before.items() if k != "awards"}


@pytest.mark.asyncio
async def test_a_second_save_with_the_same_opening_fingerprint_is_refused_and_the_first_kept() -> None:
    service, _ = await _draft()
    opened = (await _opening(service))["awards"]
    await service.save_section(2031, 1, "awards", _awards("150"), actor=TREASURER, expected_fingerprint=opened)
    with pytest.raises(SectionChangedError, match="awards"):
        await service.save_section(2031, 1, "awards", _awards("175"), actor=FINANCE, expected_fingerprint=opened)
    assert str((await service.load(2031)).document.awards.minimum) == "150"


@pytest.mark.asyncio
async def test_saves_of_two_different_sections_from_the_same_opening_state_both_succeed() -> None:
    service, _ = await _draft()
    opened = await _opening(service)
    await service.save_section(
        2031, 1, "awards", _awards("150"), actor=TREASURER, expected_fingerprint=opened["awards"]
    )
    await service.save_section(2031, 1, "income", _income("500"), actor=FINANCE, expected_fingerprint=opened["income"])
    doc = (await service.load(2031)).document
    assert (str(doc.awards.minimum), str(doc.income.medical_threshold)) == ("150", "500")


@pytest.mark.asyncio
async def test_approve_after_an_in_place_save_of_a_ticked_section_is_refused_and_nothing_is_approved() -> None:
    service, _ = await _draft()
    opened = await _opening(service)
    await service.save_section(
        2031, 1, "awards", _awards("150"), actor=TREASURER, expected_fingerprint=opened["awards"]
    )
    with pytest.raises(SectionChangedError, match="awards"):
        await service.approve_sections(
            2031,
            1,
            ["awards", "income"],
            actor=FINANCE,
            note="Board",
            fingerprints={s: opened[s] for s in ("awards", "income")},
        )
    status = (await service.load(2031)).section_status
    assert (status["awards"].state, status["income"].state) == ("draft", "draft")


@pytest.mark.asyncio
async def test_approve_after_a_save_to_an_unticked_section_succeeds() -> None:
    service, _ = await _draft()
    opened = await _opening(service)
    await service.save_section(
        2031, 1, "awards", _awards("150"), actor=TREASURER, expected_fingerprint=opened["awards"]
    )
    approved, _ = await service.approve_sections(
        2031, 1, ["income"], actor=FINANCE, note="Board", fingerprints={"income": opened["income"]}
    )
    assert approved.section_status["income"].state == "approved"


@pytest.mark.asyncio
async def test_approve_names_every_stale_section() -> None:
    service, _ = await _draft()
    opened = await _opening(service)
    await service.save_section(
        2031, 1, "awards", _awards("150"), actor=TREASURER, expected_fingerprint=opened["awards"]
    )
    await service.save_section(
        2031, 1, "income", _income("500"), actor=TREASURER, expected_fingerprint=opened["income"]
    )
    with pytest.raises(SectionChangedError) as raised:
        await service.approve_sections(
            2031,
            1,
            ["awards", "income"],
            actor=FINANCE,
            note="Board",
            fingerprints={s: opened[s] for s in ("awards", "income")},
        )
    assert sorted(raised.value.sections) == ["awards", "income"]


def test_every_section_has_a_fingerprint() -> None:
    doc = fictional_rules()
    assert len({section_fingerprint(doc, s) for s in SECTION_NAMES}) == len(SECTION_NAMES)


@pytest.mark.asyncio
async def test_an_approval_whose_fingerprints_do_not_name_exactly_the_sections_is_refused() -> None:
    service, _ = await _draft()
    opened = await _opening(service)
    with pytest.raises(FingerprintsMismatchError):
        await service.approve_sections(
            2031, 1, ["awards", "income"], actor=FINANCE, note="Board", fingerprints={"awards": opened["awards"]}
        )
    status = (await service.load(2031)).section_status
    assert (status["awards"].state, status["income"].state) == ("draft", "draft")


def test_the_stale_sections_are_carried_as_keys_beside_the_message() -> None:
    error = SectionChangedError(["awards", "income"])
    assert error.sections == ["awards", "income"]
    assert "awards, income" in str(error)
