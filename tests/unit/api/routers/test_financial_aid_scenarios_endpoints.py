"""SP9b's scenario routes: every one needs financial_aid.rules (D76: Scenarios is finance's workspace), bodies are
validated before the service, and refusals map to 404 / 409 / 422. A bare FastAPI app (persona_client), never
api.main (it poisons auth for xdist). Fictional only."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.services.financial_aid_rules_service import (
    DraftSection,
    PromotionPreview,
    PromotionSection,
    ReplacementNotAcknowledgedError,
    ReplacementWarning,
    RulesDraft,
    RulesVersion,
)
from api.services.financial_aid_scenario_pricing import SnapshotError
from api.services.financial_aid_scenarios_repository import (
    OptionCodeTakenError,
    OptionRecord,
    SnapshotMeta,
    TrailRecord,
)
from api.services.financial_aid_scenarios_service import (
    CompareColumn,
    Comparison,
    Draft,
    Evaluation,
    Fitted,
    KeptOption,
    LeverEffect,
    ScenarioConflictError,
    ScenarioNotFoundError,
    ScenarioRefusedError,
    Sensitivity,
    Workspace,
)
from bunking.financial_aid.change_diff import FieldChange
from bunking.financial_aid.rules import ValidationReport
from bunking.financial_aid.rules.lifecycle import SectionStatus, initial_status
from bunking.financial_aid.rules.schema import SECTION_NAMES
from bunking.financial_aid.scenarios import (
    SIZING_LEVERS,
    FitResult,
    RequestSetNote,
    ScenarioResults,
    SizingError,
    TierRow,
)
from bunking.rbac.permissions import Permission
from tests.unit.api.services.financial_aid_fakes import intake_rules
from tests.unit.rbac.permission_personas import PERSONA_FINANCE, PERSONAS, persona_client, persona_user

RULES = Permission.FINANCIAL_AID_RULES
T = datetime(2027, 1, 14, 17, 40, tzinfo=UTC)
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"
DOC = intake_rules()
RESULTS = ScenarioResults(
    requests=2,
    families=2,
    round1=Decimal(2600),
    round2=Decimal(0),
    round3=Decimal(0),
    round1_allocated=Decimal("440000.00"),
    round1_remaining=Decimal("437400.00"),
    remaining=Decimal("497400.00"),
    at_minimum=0,
    held=0,
    held_asked=Decimal(0),
    round1_unmet=Decimal(5400),
    pools=[],
    by_tier=[TierRow(tier=2, requests=1, families=1, round1=Decimal(1500))],
)
META = SnapshotMeta(id="snp000000000001", year=2027, requests=2, actor=FINANCE, created=T)
OPTION = OptionRecord(
    id="opt000000000001",
    year=2027,
    code="A",
    starting_point="",
    from_code="",
    origin_version=1,
    document=DOC,
    results=RESULTS,
    snapshot=META.id,
    actor=FINANCE,
    created=T,
)
ROW = TrailRecord(
    id="trl000000000001",
    year=2027,
    actor=FINANCE,
    from_code="A",
    document=None,
    change="started from rules v1",
    results=RESULTS,
    snapshot=META.id,
    kept_code="A",
    created=T,
)
DRAFT = Draft(
    trail_id=ROW.id,
    from_code="A",
    document=DOC,
    label="no changes",
    changes=(),
    results=RESULTS,
    report=ValidationReport(),
    recorded_at=T,
)
KEPT = KeptOption(OPTION, "rules v1 as they were", stale=False)
EVALUATION = Evaluation(DOC, RESULTS, ValidationReport())
PREVIEW = PromotionPreview(
    origin_version=1,
    base_version=1,
    sections=(
        PromotionSection(
            "award_tables",
            (FieldChange(("camp", "tiers", "1", "r1_pct"), "changed", Decimal(90), Decimal(95)),),
            ReplacementWarning("unapproved_edit", TREASURER, T, None, token="tok-award-tables"),
        ),
    ),
    unchanged=tuple(name for name in SECTION_NAMES if name != "award_tables"),
)
VERSION = RulesVersion(
    record_id="rul000000000001",
    year=2027,
    version=2,
    document=DOC,
    section_status=initial_status(),
    parent_year=2027,
    parent_version=1,
)
RULES_DRAFT = RulesDraft(
    VERSION, None, ValidationReport(), tuple(DraftSection(name, SectionStatus(), ()) for name in SECTION_NAMES)
)
DOC_BODY = {"document": DOC.model_dump(mode="json")}

ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "/api/financial-aid/scenarios/2027/snapshot", None),
    ("POST", "/api/financial-aid/scenarios/2027/starting-points", None),
    ("GET", "/api/financial-aid/scenarios/2027", None),
    ("POST", "/api/financial-aid/scenarios/2027/evaluate", DOC_BODY),
    ("PUT", "/api/financial-aid/scenarios/2027/draft", DOC_BODY),
    ("POST", "/api/financial-aid/scenarios/2027/draft/load", {"option": "A"}),
    ("POST", "/api/financial-aid/scenarios/2027/keep", {"starting_point": False}),
    ("GET", "/api/financial-aid/scenarios/2027/compare?codes=A", None),
    ("POST", "/api/financial-aid/scenarios/2027/fit-to-budget", DOC_BODY),
    ("POST", "/api/financial-aid/scenarios/2027/sensitivity", DOC_BODY),
    ("GET", "/api/financial-aid/scenarios/2027/trail", None),
    ("GET", "/api/financial-aid/scenarios/2027/options/A1/rules-draft", None),
    ("POST", "/api/financial-aid/scenarios/2027/options/A1/rules-draft", {"base_version": 1, "acknowledged": {}}),
]


def _client(persona: str = PERSONA_FINANCE) -> TestClient:
    from api.routers.financial_aid import router

    return persona_client(router, persona)


def _stub() -> Any:
    service = patch("api.routers.financial_aid.FinancialAidScenariosService").start().return_value
    service.freeze = AsyncMock(return_value=META)
    service.start_from_rules = AsyncMock(return_value=Workspace(2027, 1, META, DRAFT, (KEPT,)))
    service.workspace = AsyncMock(return_value=Workspace(2027, 1, META, DRAFT, (KEPT,)))
    service.evaluate = AsyncMock(return_value=EVALUATION)
    service.save_draft = AsyncMock(return_value=DRAFT)
    service.load = AsyncMock(return_value=DRAFT)
    service.keep = AsyncMock(return_value=KEPT)
    service.compare = AsyncMock(
        return_value=Comparison(META, (CompareColumn("draft", "no changes", DOC, (), RESULTS, None, None),))
    )
    service.fit = AsyncMock(return_value=Fitted(FitResult(Decimal(1), Decimal(0), "fits", 9), "camp_pool", EVALUATION))
    service.sensitivity = AsyncMock(
        return_value=Sensitivity(
            RESULTS,
            (LeverEffect(SIZING_LEVERS[0], Decimal(40)), LeverEffect(SIZING_LEVERS[-1], Decimal(63), on=True)),
        )
    )
    service.trail = AsyncMock(return_value=((ROW,), 1))
    service.rules_draft_preview = AsyncMock(return_value=PREVIEW)
    service.make_rules_draft = AsyncMock(return_value=(RULES_DRAFT, 1))
    return service


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


@pytest.mark.parametrize("persona", sorted(PERSONAS))
@pytest.mark.parametrize(("method", "url", "body"), ROUTES)
def test_permission_matrix(persona: str, method: str, url: str, body: dict[str, Any] | None) -> None:
    _stub()
    response = _client(persona).request(method, url, json=body)
    expected = 200 if RULES in PERSONAS[persona] else 403
    assert response.status_code == expected, (persona, method, url, response.text)


def test_writes_carry_the_callers_email() -> None:
    service = _stub()
    client = _client()
    email = persona_user(PERSONA_FINANCE).email
    client.post("/api/financial-aid/scenarios/2027/snapshot")
    client.put("/api/financial-aid/scenarios/2027/draft", json=DOC_BODY)
    client.post("/api/financial-aid/scenarios/2027/draft/load", json={"trail_row": "trl000000000001"})
    client.post("/api/financial-aid/scenarios/2027/keep", json={"starting_point": True})
    assert service.freeze.await_args.args == (2027, email)
    assert service.save_draft.await_args.args[2] == email
    assert service.load.await_args.args == (2027, email)
    assert service.load.await_args.kwargs == {"option": None, "trail_row": "trl000000000001"}
    assert service.keep.await_args.kwargs == {"starting_point": True}


def test_evaluate_passes_the_sizing_settings() -> None:
    service = _stub()
    body = {**DOC_BODY, "tier_shift": "2.5", "band_width_delta": "1000"}
    _client().post("/api/financial-aid/scenarios/2027/evaluate", json=body)
    assert service.evaluate.await_args.kwargs == {
        "tier_shift": Decimal("2.5"),
        "band_width_delta": Decimal(1000),
        "request_set": None,
    }


def test_compare_passes_the_ticked_codes_in_order() -> None:
    service = _stub()
    _client().get("/api/financial-aid/scenarios/2027/compare", params=[("codes", "A1"), ("codes", "B")])
    assert service.compare.await_args.args[2] == ["A1", "B"]
    assert service.compare.await_args.kwargs == {"request_set": None}


def test_the_request_set_controls_reach_every_read() -> None:
    service = _stub()
    client = _client()
    client.post("/api/financial-aid/scenarios/2027/evaluate", json={**DOC_BODY, "through_round1_deadline": True})
    client.post("/api/financial-aid/scenarios/2027/fit-to-budget", json={**DOC_BODY, "received_through": "2027-02-01"})
    client.post("/api/financial-aid/scenarios/2027/sensitivity", json={**DOC_BODY, "received_through": "2027-02-01"})
    client.get("/api/financial-aid/scenarios/2027/compare", params={"codes": "A", "through_round1_deadline": "true"})
    assert service.evaluate.await_args.kwargs["request_set"] == "round1_deadline"
    assert service.fit.await_args.kwargs == {"request_set": date(2027, 2, 1)}
    assert service.sensitivity.await_args.kwargs == {"request_set": date(2027, 2, 1)}
    assert service.compare.await_args.kwargs == {"request_set": "round1_deadline"}


def test_both_request_set_controls_at_once_is_422_before_the_service() -> None:
    service = _stub()
    both = {**DOC_BODY, "through_round1_deadline": True, "received_through": "2027-02-01"}
    assert _client().post("/api/financial-aid/scenarios/2027/evaluate", json=both).status_code == 422
    query = {"codes": "A", "through_round1_deadline": "true", "received_through": "2027-02-01"}
    assert _client().get("/api/financial-aid/scenarios/2027/compare", params=query).status_code == 422
    service.evaluate.assert_not_called()
    service.compare.assert_not_called()


def test_figures_on_a_request_set_carry_its_label() -> None:
    service = _stub()
    note = RequestSetNote(
        basis="date", through=date(2027, 2, 1), label="requests received through Feb 1, 2027", left_out=3, unknown=0
    )
    service.evaluate = AsyncMock(
        return_value=Evaluation(DOC, RESULTS.model_copy(update={"request_set": note}), ValidationReport())
    )
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()
    assert body["results"]["request_set"] == {
        "basis": "date",
        "through": "2027-02-01",
        "label": "requests received through Feb 1, 2027",
        "left_out": 3,
        "unknown": 0,
    }


def test_fit_names_the_tightest_pool_and_sensitivity_names_the_dollar_for_dollar_switch() -> None:
    _stub()
    fit = _client().post("/api/financial-aid/scenarios/2027/fit-to-budget", json=DOC_BODY).json()
    assert (fit["tier_shift"], fit["outcome"], fit["tightest_pool"]) == (1.0, "fits", "camp_pool")
    levers = _client().post("/api/financial-aid/scenarios/2027/sensitivity", json=DOC_BODY).json()["levers"]
    assert levers[-1] == {
        "lever": "dollar_for_dollar",
        "label": "Grants offset dollar-for-dollar",
        "step": None,
        "on": True,
        "round1_change": 63.0,
    }


def test_the_workspace_reads_as_money_with_its_labels() -> None:
    _stub()
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    [option] = body["options"]
    assert (option["code"], option["starting_point"], option["label"]) == ("A", None, "rules v1 as they were")
    assert (option["results"]["round1"], option["results"]["round1_unmet"]) == (2600.0, 5400.0)
    assert body["draft"]["from_code"] == "A"
    assert (body["snapshot"]["requests"], body["snapshot"]["awaiting_rules"]) == (2, 0)


@pytest.mark.parametrize("body", [{"option": "a1"}, {"trail_row": "x"}, {"option": "A", "extra": 1}])
def test_a_malformed_load_is_422_before_the_service(body: dict[str, Any]) -> None:
    service = _stub()
    assert _client().post("/api/financial-aid/scenarios/2027/draft/load", json=body).status_code == 422
    service.load.assert_not_called()


def test_a_body_that_is_not_a_rules_document_is_422() -> None:
    service = _stub()
    broken = DOC.model_dump(mode="json")
    del broken["income"]
    assert _client().put("/api/financial-aid/scenarios/2027/draft", json={"document": broken}).status_code == 422
    service.save_draft.assert_not_called()


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ScenarioNotFoundError("2027 has no kept option Q"), 404),
        (ScenarioConflictError("Your draft is the same as A"), 409),
        (OptionCodeTakenError("Someone kept an option at the same moment"), 409),
        (ScenarioRefusedError("Freeze 2027's applications first"), 422),
        (SnapshotError("This snapshot predates the season read fetch_x"), 422),
        (SizingError("Bands $50,000 narrower would leave band 1 empty or below $0"), 422),
    ],
)
def test_refusals_map_to_404_409_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.keep = AsyncMock(side_effect=error)
    response = _client().post("/api/financial-aid/scenarios/2027/keep", json={"starting_point": False})
    assert (response.status_code, response.json()["detail"]) == (status, str(error))


def test_an_unconfirmed_replacement_is_409_naming_the_sections() -> None:
    service = _stub()
    service.make_rules_draft = AsyncMock(side_effect=ReplacementNotAcknowledgedError(["awards"]))
    response = _client().post(
        "/api/financial-aid/scenarios/2027/options/B2/rules-draft", json={"base_version": 2, "acknowledged": {}}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["sections"] == ["awards"]


def test_the_preview_shows_each_section_old_to_new_with_its_warning() -> None:
    _stub()
    body = _client().get("/api/financial-aid/scenarios/2027/options/A1/rules-draft").json()
    [section] = body["sections"]
    assert section["changes"] == [
        {"path": ["camp", "tiers", "1", "r1_pct"], "kind": "changed", "before": "90", "after": "95"}
    ]
    assert (section["warning"]["kind"], section["warning"]["by"], section["warning"]["token"]) == (
        "unapproved_edit",
        TREASURER,
        "tok-award-tables",
    )
    assert (body["code"], body["base_version"], len(body["unchanged"])) == ("A1", 1, len(SECTION_NAMES) - 1)


def test_making_the_rules_draft_passes_what_was_confirmed_and_returns_the_rules_draft() -> None:
    service = _stub()
    response = _client().post(
        "/api/financial-aid/scenarios/2027/options/A1/rules-draft",
        json={"base_version": 1, "acknowledged": {"award_tables": "tok-award-tables"}},
    )
    call = service.make_rules_draft.await_args
    assert call.args == (2027, "A1")
    assert (call.kwargs["base_version"], call.kwargs["acknowledged"]) == (1, {"award_tables": "tok-award-tables"})
    assert (response.json()["version"], response.json()["branched_from"]) == (2, 1)


def test_the_trail_pages_newest_first() -> None:
    service = _stub()
    body = _client().get("/api/financial-aid/scenarios/2027/trail", params={"page": 2, "per_page": 10}).json()
    assert service.trail.await_args.kwargs == {"page": 2, "per_page": 10}
    assert (body["total"], body["rows"][0]["round1"], body["rows"][0]["kept_code"]) == (1, 2600.0, "A")


def test_an_option_code_must_be_a_code() -> None:
    service = _stub()
    assert _client().get("/api/financial-aid/scenarios/2027/options/a1/rules-draft").status_code == 422
    service.rules_draft_preview.assert_not_called()
