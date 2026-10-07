"""SP9b's scenario routes: every one needs financial_aid.rules (D76: Scenarios is finance's workspace), bodies are
validated before the service, and refusals map to 404 / 409 / 422. A bare FastAPI app (persona_client), never
api.main (it poisons auth for xdist). Fictional only."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.constants.collections import AID_SCENARIO_SNAPSHOTS
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_rules_service import (
    DraftSection,
    FinancialAidRulesService,
    PromotionPreview,
    PromotionSection,
    ReplacementNotAcknowledgedError,
    ReplacementWarning,
    RulesDraft,
    RulesVersion,
    VersionExistsError,
)
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, SnapshotError, capture_season
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
    FinancialAidScenariosService,
    Fitted,
    KeptOption,
    LastSeason,
    LeverEffect,
    ScenarioConflictError,
    ScenarioNotFoundError,
    ScenarioPromotion,
    ScenarioRefusedError,
    ScenarioSectionLockedError,
    Sensitivity,
    Workspace,
)
from bunking.financial_aid.arrival import PoolProjection, Projection, TooEarly
from bunking.financial_aid.change_diff import FieldChange
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWriteConflictError
from bunking.financial_aid.rules import ValidationReport
from bunking.financial_aid.rules.lifecycle import SectionStatus, initial_status
from bunking.financial_aid.rules.schema import SECTION_NAMES
from bunking.financial_aid.scenarios import (
    SIZING_LEVERS,
    CommitteeView,
    FitResult,
    PoolResult,
    RequestSetNote,
    Round2CompareRow,
    Round2TierRow,
    ScenarioResults,
    SizingError,
    TierCompareRow,
    TierRow,
)
from bunking.rbac.permissions import Permission
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_request
from tests.unit.api.services.financial_aid_fakes import intake_rules
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.api.services.scenarios_fakes import FakeScenarioStore
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
    pools=[
        PoolResult(
            pool="camp_pool",
            label="Camp pool",
            round1=Decimal(2600),
            round2=Decimal(0),
            round3=Decimal(0),
            round1_allocated=None,
            round1_remaining=None,
            remaining=None,
            round1_unmet=Decimal(0),
        )
    ],
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
    VERSION,
    None,
    ValidationReport(),
    tuple(DraftSection(name, SectionStatus(), (), "0" * 64) for name in SECTION_NAMES),
)
DOC_BODY = {"document": DOC.model_dump(mode="json")}

ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "/api/financial-aid/scenarios/2027/snapshot", None),
    ("POST", "/api/financial-aid/scenarios/2027/starting-points", None),
    ("POST", "/api/financial-aid/scenarios/2027/starting-points/last-season", None),
    ("GET", "/api/financial-aid/scenarios/2027", None),
    ("POST", "/api/financial-aid/scenarios/2027/evaluate", DOC_BODY),
    ("PUT", "/api/financial-aid/scenarios/2027/draft", DOC_BODY),
    ("POST", "/api/financial-aid/scenarios/2027/draft/load", {"option": "A"}),
    ("POST", "/api/financial-aid/scenarios/2027/keep", {"name": "Every tier up"}),
    ("PATCH", "/api/financial-aid/scenarios/2027/options/A", {"name": "Every tier up"}),
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
    service.start_from_last_season = AsyncMock(return_value=Workspace(2027, 1, META, DRAFT, (KEPT,)))
    service.workspace = AsyncMock(return_value=Workspace(2027, 1, META, DRAFT, (KEPT,)))
    service.evaluate = AsyncMock(return_value=EVALUATION)
    service.save_draft = AsyncMock(return_value=DRAFT)
    service.load = AsyncMock(return_value=DRAFT)
    service.keep = AsyncMock(return_value=KEPT)
    service.rename = AsyncMock(return_value=KEPT)
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
    service.rules_draft_preview = AsyncMock(return_value=ScenarioPromotion(PREVIEW, 0))
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
    client.post("/api/financial-aid/scenarios/2027/keep", json={"name": "Kept"})
    assert service.freeze.await_args.args == (2027, email)
    assert service.save_draft.await_args.args[2] == email
    assert service.load.await_args.args == (2027, email)
    assert service.load.await_args.kwargs == {"option": None, "trail_row": "trl000000000001", "start": None}
    assert service.keep.await_args.kwargs == {"name": "Kept"}


def test_a_load_takes_a_built_in_start_and_refuses_two_sources_before_the_service() -> None:
    service = _stub()
    client = _client()
    assert client.post("/api/financial-aid/scenarios/2027/draft/load", json={"start": "rules_draft"}).status_code == 200
    assert service.load.await_args.kwargs == {"option": None, "trail_row": None, "start": "rules_draft"}
    both = client.post("/api/financial-aid/scenarios/2027/draft/load", json={"option": "A", "start": "rules"})
    assert both.status_code == 422
    assert client.post("/api/financial-aid/scenarios/2027/draft/load", json={"start": "nope"}).status_code == 422


def test_an_unrecorded_draft_reads_with_no_trail_row_and_says_what_it_is_from() -> None:
    service = _stub()
    service.workspace = AsyncMock(
        return_value=Workspace(
            2027,
            2,
            META,
            replace(DRAFT, trail_id=None, recorded_at=None, from_code="rules", source_document=DOC, same_as="rules"),
            (KEPT,),
            pricing_version=1,
            rules_draft_version=2,
        )
    )
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    assert (body["rules_draft_version"], body["draft"]["trail_id"], body["draft"]["recorded_at"]) == (2, None, None)
    assert (body["draft"]["from_code"], body["draft"]["same_as"]) == ("rules", "rules")
    assert body["draft"]["source_document"]["year"] == 2027


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
    assert service.compare.await_args.kwargs == {
        "request_set": None,
        "last_season": False,
        "rules": False,
        "last_rules": False,
        "draft": True,
    }


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
    assert service.compare.await_args.kwargs == {
        "request_set": "round1_deadline",
        "last_season": False,
        "rules": False,
        "last_rules": False,
        "draft": True,
    }


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
        (VersionExistsError("Rules v2 already exists"), 409),
        (ScenarioRefusedError("Freeze 2027's applications first"), 422),
        (SnapshotError("This snapshot predates the season read fetch_x"), 422),
        (SizingError("Bands $50,000 narrower would leave band 1 empty or below $0"), 422),
    ],
)
def test_refusals_map_to_404_409_and_422(error: Exception, status: int) -> None:
    service = _stub()
    service.keep = AsyncMock(side_effect=error)
    response = _client().post("/api/financial-aid/scenarios/2027/keep", json={"name": "Every tier up"})
    assert (response.status_code, response.json()["detail"]) == (status, str(error))


def test_an_unconfirmed_replacement_is_409_naming_the_sections() -> None:
    service = _stub()
    service.make_rules_draft = AsyncMock(side_effect=ReplacementNotAcknowledgedError(["awards"]))
    response = _client().post(
        "/api/financial-aid/scenarios/2027/options/B2/rules-draft", json={"base_version": 2, "acknowledged": {}}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["sections"] == ["awards"]


def test_making_a_rules_draft_that_lost_a_race_is_409() -> None:
    service = _stub()
    service.make_rules_draft = AsyncMock(side_effect=AidWriteConflictError(collection="aid_rules", record_id="r" * 15))
    response = _client().post(
        "/api/financial-aid/scenarios/2027/options/B2/rules-draft", json={"base_version": 2, "acknowledged": {}}
    )
    assert (response.status_code, response.json()["detail"]) == (409, CONFLICT_MESSAGE)


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


def test_a_pool_with_no_allocation_reads_as_null_and_a_real_zero_as_zero() -> None:
    _stub()
    [pool] = _client().get("/api/financial-aid/scenarios/2027").json()["options"][0]["results"]["pools"]
    assert (pool["round1_allocated"], pool["round1_unmet"]) == (None, 0.0)


@pytest.mark.parametrize("codes", [["a1"], ["ABCDEFGHIJKLM"], ["A", "B", "C", "D", "E"]])
def test_compare_codes_must_be_codes_and_at_most_four(codes: list[str]) -> None:
    service = _stub()
    assert _client().get("/api/financial-aid/scenarios/2027/compare", params={"codes": codes}).status_code == 422
    service.compare.assert_not_called()


def test_inputs_are_bounded() -> None:
    service = _stub()
    client = _client()
    url = "/api/financial-aid/scenarios/2027"
    token = {"acknowledged": {"award_tables": "x" * 129}, "base_version": 1}
    assert client.post(f"{url}/options/A1/rules-draft", json=token).status_code == 422
    assert client.get(f"{url}/trail", params={"page": 10001}).status_code == 422
    assert client.post(f"{url}/evaluate", json={**DOC_BODY, "tier_shift": "1.234"}).status_code == 422
    assert client.post(f"{url}/evaluate", json={**DOC_BODY, "band_width_delta": "1000.123"}).status_code == 422
    service.make_rules_draft.assert_not_called()
    service.trail.assert_not_called()
    service.evaluate.assert_not_called()


def test_a_load_naming_nothing_is_422_before_the_service() -> None:
    service = _stub()
    assert _client().post("/api/financial-aid/scenarios/2027/draft/load", json={}).status_code == 422
    service.load.assert_not_called()


# --- a route through the real service over in-memory stores (final review 10b) ---------------------------------


def _real_service() -> tuple[FinancialAidScenariosService, FakeScenarioStore]:
    """The real scenarios service over fake stores: a frozen-season flow through a route fails on any exception the
    router does not map (a 500 here, since the persona client never raises)."""
    season = FakeDecisionsStore()
    seed_request(season, "reqemma00000001")
    seed_request(season, "reqliam00000001", household=1000002, person=1000021, income=90000.0)
    rules = FinancialAidRulesService(FakeStore(), clock=lambda: T0)
    asyncio.run(rules.create_version(intake_rules(), actor=FINANCE))

    async def register(year: int) -> Sequence[RegisterRow]:
        return ()

    async def capture(year: int) -> SeasonSnapshot:
        return await capture_season(season, register, FakeRules(approved()), year)

    store = FakeScenarioStore()
    return FinancialAidScenariosService(store, rules, capture), store


def test_freeze_then_the_workspace_through_the_real_service() -> None:
    service, _ = _real_service()
    patch("api.routers.financial_aid._scenarios", return_value=service).start()
    client = _client()
    frozen = client.post("/api/financial-aid/scenarios/2027/snapshot")
    assert (frozen.status_code, frozen.json()["requests"]) == (200, 2)
    started = client.post("/api/financial-aid/scenarios/2027/starting-points")
    assert started.status_code == 200, started.text
    workspace = client.get("/api/financial-aid/scenarios/2027").json()
    assert (workspace["snapshot"]["id"], workspace["options"][0]["results"]["round1"]) == (frozen.json()["id"], 2600.0)


def test_a_stored_season_this_code_cant_read_is_422_and_a_freeze_replaces_it() -> None:
    service, store = _real_service()
    patch("api.routers.financial_aid._scenarios", return_value=service).start()
    client = _client()
    first = client.post("/api/financial-aid/scenarios/2027/snapshot").json()
    assert client.post("/api/financial-aid/scenarios/2027/starting-points").status_code == 200
    [row] = store.rows[AID_SCENARIO_SNAPSHOTS]
    row.inputs = {key: value for key, value in row.inputs.items() if key != "live"}
    evaluated = client.post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY)
    assert evaluated.status_code == 422
    assert "Update Applications again" in evaluated.json()["detail"]
    assert client.get("/api/financial-aid/scenarios/2027").status_code == 200
    again = client.post("/api/financial-aid/scenarios/2027/snapshot")
    assert (again.status_code, again.json()["id"] != first["id"]) == (200, True)
    assert client.post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).status_code == 200


def test_the_results_say_how_much_round1_is_in_no_tier() -> None:
    service = _stub()
    service.evaluate = AsyncMock(
        return_value=Evaluation(DOC, RESULTS.model_copy(update={"not_in_tiers": Decimal(1100)}), ValidationReport())
    )
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()
    assert (body["results"]["by_tier"][0]["round1"], body["results"]["not_in_tiers"]) == (1500.0, 1100.0)


def test_fit_to_budget_on_a_request_set_is_422_through_the_real_service() -> None:
    service, _ = _real_service()
    patch("api.routers.financial_aid._scenarios", return_value=service).start()
    client = _client()
    assert client.post("/api/financial-aid/scenarios/2027/snapshot").status_code == 200
    body = {**DOC_BODY, "received_through": "2027-02-01"}
    response = client.post("/api/financial-aid/scenarios/2027/fit-to-budget", json=body)
    assert (response.status_code, response.json()["detail"]) == (
        422,
        "Fit to budget uses every request; turn off the request set.",
    )
    assert client.post("/api/financial-aid/scenarios/2027/fit-to-budget", json=DOC_BODY).status_code == 200


def test_a_trail_row_says_whether_its_figures_are_stale() -> None:
    service = _stub()
    service.trail = AsyncMock(return_value=((replace(ROW, stale=True), ROW), 2))
    rows = _client().get("/api/financial-aid/scenarios/2027/trail").json()["rows"]
    assert [row["stale"] for row in rows] == [True, False]


def test_the_workspace_names_the_version_that_prices_the_season() -> None:
    service = _stub()
    service.workspace = AsyncMock(return_value=Workspace(2027, 2, META, DRAFT, (KEPT,), pricing_version=1))
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    assert (body["rules_version"], body["pricing_version"]) == (2, 1)
    service.workspace = AsyncMock(return_value=Workspace(2027, 1, META, DRAFT, (KEPT,)))
    assert _client().get("/api/financial-aid/scenarios/2027").json()["pricing_version"] is None


# --- SP9c: what the committee compares (RPT-17, RPT-18, RPT-32) ------------------------------------------------------


def _tier_row(table: str | None) -> TierCompareRow:
    return TierCompareRow(
        table=table,
        tier=2,
        requests=1,
        families=1,
        asked=Decimal(4000),
        average_ask=Decimal("4000.00"),
        fee_pct=Decimal(75) if table else None,
        pct_of_ask=Decimal("37.5"),
        round1=Decimal(1500),
        average_round1=Decimal("1500.00"),
        held=1,
        held_asked=Decimal(900),
    )


COMMITTEE = CommitteeView(
    budget_total=Decimal(500000),
    round1=Decimal(2600),
    round1_pct_of_budget=Decimal("0.5"),
    round2=Decimal(600),
    round1_by_tier=(_tier_row("camp"), _tier_row(None)),
    round2_by_tier=(
        Round2CompareRow(
            table="camp",
            tier=2,
            appeals=2,
            asked=Decimal(1500),
            max_pct=Decimal(90),
            priced=1,
            priced_asked=Decimal(1000),
            round2=Decimal(600),
            average_round2=Decimal("600.00"),
            pct_of_ask=Decimal("60.0"),
            held_asked=Decimal(500),
        ),
    ),
    not_in_tiers=Decimal(1100),
    round2_not_in_tiers=Decimal(0),
)
LAST_LABEL = "2026, posted as reproduced from the repaired sheet (as of Jan 8, 2027)"


def test_compare_carries_the_committee_tables_and_last_season() -> None:
    service = _stub()
    column = CompareColumn("draft", "no changes", DOC, (), RESULTS, None, None, COMMITTEE)
    last = LastSeason(2026, True, LAST_LABEL, 1, COMMITTEE)
    service.compare = AsyncMock(return_value=Comparison(META, (column,), last))
    body = _client().get("/api/financial-aid/scenarios/2027/compare", params={"last_season": "true"}).json()
    committee = body["columns"][0]["committee"]
    assert (committee["budget_total"], committee["round1_pct_of_budget"]) == (500000.0, 0.5)
    assert (committee["not_in_tiers"], committee["round2_not_in_tiers"]) == (1100.0, 0.0)
    assert committee["round1_by_tier"][0] == {
        "table": "camp",
        "tier": 2,
        "requests": 1,
        "families": 1,
        "asked": 4000.0,
        "average_ask": 4000.0,
        "fee_pct": 75.0,
        "pct_of_ask": 37.5,
        "round1": 1500.0,
        "average_round1": 1500.0,
        "held": 1,
        "held_asked": 900.0,
        "no_ask": 0,
    }
    assert committee["round1_by_tier"][1]["table"] is None  # All
    assert committee["round2_by_tier"][0] == {
        "table": "camp",
        "tier": 2,
        "appeals": 2,
        "asked": 1500.0,
        "max_pct": 90.0,
        "priced": 1,
        "priced_asked": 1000.0,
        "round2": 600.0,
        "average_round2": 600.0,
        "pct_of_ask": 60.0,
        "held_asked": 500.0,
    }
    # Disagreement 3: the season-wide figures ride the wire (COMMITTEE's one All row: 1 request, Round 1 1,500).
    assert (committee["requests"], committee["average_round1"]) == (1, 1500.0)
    assert (body["last_season"]["year"], body["last_season"]["label"]) == (2026, LAST_LABEL)
    assert service.compare.await_args.kwargs == {
        "request_set": None,
        "last_season": True,
        "rules": False,
        "last_rules": False,
        "draft": True,
    }


def test_last_season_not_loaded_reads_as_its_label_with_no_figures() -> None:
    service = _stub()
    label = "2026's decisions are not loaded yet, so there is no last-season column"
    service.compare = AsyncMock(return_value=Comparison(META, (), LastSeason(2026, False, label, None, None)))
    body = _client().get("/api/financial-aid/scenarios/2027/compare", params={"last_season": "true"}).json()
    assert body["last_season"] == {
        "year": 2026,
        "loaded": False,
        "label": label,
        "rules_version": None,
        "view": None,
        "round3": 0.0,
        "pools": [],
        "remaining": None,
    }


def test_compare_passes_the_built_in_columns_and_reads_their_version() -> None:
    service = _stub()
    rules = CompareColumn(
        "rules", "Rules v4 in effect", DOC, (), RESULTS, None, None, version=4, approved_at=T, via="B"
    )
    service.compare = AsyncMock(
        return_value=Comparison(
            META,
            (rules,),
            last_rules_refused="2026 has no approved rules to start from: load and approve them first",
        )
    )
    body = (
        _client()
        .get(
            "/api/financial-aid/scenarios/2027/compare",
            params={"rules": "true", "last_rules": "true", "draft": "false"},
        )
        .json()
    )
    assert service.compare.await_args.kwargs == {
        "request_set": None,
        "last_season": False,
        "rules": True,
        "last_rules": True,
        "draft": False,
    }
    [column] = body["columns"]
    assert (column["code"], column["version"], column["via"], column["up"]) == ("rules", 4, "B", None)
    assert body["last_rules_refused"] == "2026 has no approved rules to start from: load and approve them first"


def test_keep_refuses_the_retired_starting_point_and_results_send_no_round2_allocation() -> None:
    service = _stub()
    assert _client().post("/api/financial-aid/scenarios/2027/keep", json={"starting_point": True}).status_code == 422
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()["results"]
    assert "round2_allocated" not in body
    assert "round2_remaining" not in body
    service.keep.assert_not_called()


def test_start_from_last_season_passes_the_caller_and_maps_a_refusal_to_422() -> None:
    service = _stub()
    client = _client()
    url = "/api/financial-aid/scenarios/2027/starting-points/last-season"
    assert client.post(url).status_code == 200
    assert service.start_from_last_season.await_args.args == (2027, persona_user(PERSONA_FINANCE).email)
    service.start_from_last_season = AsyncMock(
        side_effect=ScenarioRefusedError("2026 has no approved rules to start from: load and approve them first")
    )
    refused = client.post(url)
    assert (refused.status_code, refused.json()["detail"]) == (
        422,
        "2026 has no approved rules to start from: load and approve them first",
    )


def test_start_from_last_season_through_the_real_service_without_its_rules_is_422() -> None:
    service, _ = _real_service()
    patch("api.routers.financial_aid._scenarios", return_value=service).start()
    client = _client()
    assert client.post("/api/financial-aid/scenarios/2027/snapshot").status_code == 200
    response = client.post("/api/financial-aid/scenarios/2027/starting-points/last-season")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("2026 has no approved rules to start from")


def test_nothing_in_the_committee_rows_reads_as_zero() -> None:
    """None is "nothing there" (no rules, All's table cells, nothing priced), never 0: it stays null in JSON."""
    service = _stub()
    empty = replace(
        COMMITTEE,
        budget_total=None,
        round1_pct_of_budget=None,
        round1_by_tier=(replace(_tier_row(None), fee_pct=None, average_ask=None, pct_of_ask=None),),
        round2_by_tier=(replace(COMMITTEE.round2_by_tier[0], max_pct=None, average_round2=None, pct_of_ask=None),),
    )
    column = CompareColumn("draft", "no changes", DOC, (), RESULTS, None, None, empty)
    service.compare = AsyncMock(return_value=Comparison(META, (column,)))
    committee = _client().get("/api/financial-aid/scenarios/2027/compare").json()["columns"][0]["committee"]
    assert (committee["budget_total"], committee["round1_pct_of_budget"]) == (None, None)
    row = committee["round1_by_tier"][0]
    assert (row["fee_pct"], row["average_ask"], row["pct_of_ask"]) == (None, None, None)
    appeal = committee["round2_by_tier"][0]
    assert (appeal["max_pct"], appeal["average_round2"], appeal["pct_of_ask"]) == (None, None, None)


def test_the_router_gives_the_scenarios_service_the_live_season_read() -> None:
    from api.routers import financial_aid

    service_class = patch("api.routers.financial_aid.FinancialAidScenariosService").start()
    decisions = patch("api.routers.financial_aid._decisions").start()
    financial_aid._scenarios()
    assert service_class.call_args.kwargs["season_read"] is decisions.return_value.season
    assert set(service_class.call_args.kwargs) >= {"season_read", "curves", "received"}
    assert service_class.call_args.kwargs["curves"] is not None
    assert callable(service_class.call_args.kwargs["received"])


def test_rename_trims_the_name_passes_the_caller_and_bounds_it() -> None:
    service = _stub()
    client = _client()
    email = persona_user(PERSONA_FINANCE).email
    response = client.patch("/api/financial-aid/scenarios/2027/options/A", json={"name": "  Every tier up "})
    assert response.status_code == 200
    assert service.rename.await_args.args == (2027, "A", "Every tier up", email)
    too_long = client.patch("/api/financial-aid/scenarios/2027/options/A", json={"name": "x" * 81})
    assert too_long.status_code == 422
    service.rename = AsyncMock(side_effect=ScenarioRefusedError("Give it a name"))
    blank = client.patch("/api/financial-aid/scenarios/2027/options/A", json={"name": "   "})
    assert (blank.status_code, blank.json()["detail"]) == (422, "Give it a name")
    service.rename = AsyncMock(side_effect=ScenarioNotFoundError("2027 has no kept option Q"))
    assert client.patch("/api/financial-aid/scenarios/2027/options/Q", json={"name": "x"}).status_code == 404


def test_keep_passes_its_name_and_the_option_reads_with_its_name() -> None:
    service = _stub()
    service.keep = AsyncMock(
        return_value=KeptOption(replace(OPTION, name="Every tier up"), "rules v1 as they were", stale=False)
    )
    body = _client().post("/api/financial-aid/scenarios/2027/keep", json={"name": "Every tier up"}).json()
    assert service.keep.await_args.kwargs == {"name": "Every tier up"}
    assert (body["name"], body["label"], body["promotable"], body["blocked"]) == (
        "Every tier up",
        "rules v1 as they were",
        False,
        None,
    )


def test_a_locked_section_is_409_naming_the_sections() -> None:
    service = _stub()
    service.save_draft = AsyncMock(side_effect=ScenarioSectionLockedError(["award_tables"]))
    response = _client().put("/api/financial-aid/scenarios/2027/draft", json=DOC_BODY)
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "message": "Round 1 award table is locked: Round 1 is posted, so Scenarios models only what is still open.",
        "sections": ["award_tables"],
    }


def test_the_workspace_says_what_is_locked_and_the_preview_how_many_fixed_settings_stay() -> None:
    service = _stub()
    service.workspace = AsyncMock(
        return_value=Workspace(
            2027, 1, META, DRAFT, (KEPT,), locked_sections=("tiers", "award_tables"), locked_by_round=1
        )
    )
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    assert (body["locked_sections"], body["locked_by_round"]) == (["tiers", "award_tables"], 1)
    service.rules_draft_preview = AsyncMock(return_value=ScenarioPromotion(PREVIEW, 2))
    assert _client().get("/api/financial-aid/scenarios/2027/options/A1/rules-draft").json()["fixed_kept"] == 2


def test_results_carry_allocated_round2_by_tier_and_the_appeals() -> None:
    service = _stub()
    rows = [
        Round2TierRow(
            table="camp",
            tier=2,
            appeals=1,
            asked=Decimal(400),
            priced=1,
            priced_asked=Decimal(400),
            round2=Decimal(300),
        ),
    ]
    priced = RESULTS.model_copy(update={"round2_by_tier": rows, "round1_allocated": Decimal("500000.00")})
    pools = [p.model_copy(update={"round1_allocated": Decimal("400000.00")}) for p in priced.pools]
    service.evaluate = AsyncMock(
        return_value=Evaluation(DOC, priced.model_copy(update={"pools": pools}), ValidationReport())
    )
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()["results"]
    assert (body["allocated"], body["round1_allocated"]) == (500000.0, 500000.0)
    assert body["pools"][0]["allocated"] == 400000.0
    assert [(t["tier"], t["round2"]) for t in body["by_tier"]] == [(2, 300.0)]
    assert (body["appeals"], body["appeals_asked"]) == (1, 400.0)


def test_a_projection_reads_as_money_and_a_share() -> None:
    service = _stub()
    projection = Projection(
        share=Decimal("0.4286"),
        through=date(2027, 2, 3),
        basis_year=2026,
        aligned_on="application_deadline",
        requests=5,
        round1=Decimal("6066.40"),
        round1_and_2=Decimal("6466.40"),
        remaining=Decimal("493933.60"),
        pools=(PoolProjection("camp_pool", Decimal("393933.60")),),
    )
    service.evaluate = AsyncMock(return_value=Evaluation(DOC, RESULTS, ValidationReport(), projection=projection))
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()["results"]["projection"]
    assert (body["round1_and_2"], body["basis_year"], body["aligned_on"]) == (6466.4, 2026, "application_deadline")
    assert (body["share"], body["through"], body["requests"], body["round1"], body["remaining"]) == (
        0.429,
        "2027-02-03",
        5,
        6066.4,
        493933.6,
    )
    assert body["pools"] == [{"pool": "camp_pool", "remaining": 393933.6}]


def _a_projection() -> Projection:
    return Projection(
        share=Decimal("0.4286"),
        through=date(2027, 2, 3),
        basis_year=2026,
        aligned_on="application_deadline",
        requests=5,
        round1=Decimal("6066.40"),
        round1_and_2=Decimal("6466.40"),
        remaining=Decimal("493933.60"),
        pools=(PoolProjection("camp_pool", Decimal("393933.60")),),
    )


def test_a_compare_column_carries_its_projection_to_the_wire() -> None:
    """Regression guard. The router maps the projection onto the wire."""
    service = _stub()
    column = CompareColumn("draft", "no changes", DOC, (), RESULTS, None, None, projection=_a_projection())
    service.compare = AsyncMock(return_value=Comparison(META, (column,)))
    body = _client().get("/api/financial-aid/scenarios/2027/compare").json()["columns"][0]
    assert body["results"]["projection"]["round1"] == 6066.4


def test_the_draft_carries_its_projection_to_the_wire() -> None:
    """Regression guard. The router maps the projection onto the wire."""
    service = _stub()
    draft = replace(DRAFT, projection=_a_projection())
    service.workspace = AsyncMock(return_value=Workspace(2027, 1, META, draft, (KEPT,)))
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    assert body["draft"]["results"]["projection"]["round1"] == 6066.4


def test_a_kept_options_results_carry_no_projection() -> None:
    _stub()
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    assert body["options"][0]["results"]["projection"] is None


def test_the_draft_save_forwards_the_opened_version() -> None:
    service = _stub()
    client = _client()
    assert (
        client.put("/api/financial-aid/scenarios/2027/draft", json={**DOC_BODY, "opened_version": 3}).status_code == 200
    )
    assert service.save_draft.await_args.kwargs == {"opened_version": 3}
    client.put("/api/financial-aid/scenarios/2027/draft", json=DOC_BODY)
    assert service.save_draft.await_args.kwargs == {"opened_version": None}


def _too_early() -> TooEarly:
    return TooEarly(share=Decimal("0.0304"), through=date(2027, 1, 5), basis_year=2026)


def test_evaluate_carries_too_early_to_the_wire() -> None:
    service = _stub()
    service.evaluate = AsyncMock(return_value=Evaluation(DOC, RESULTS, ValidationReport(), too_early=_too_early()))
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()["results"]
    assert body["projection"] is None
    assert body["too_early"] == {"share": 0.03, "through": "2027-01-05", "basis_year": 2026}


def test_a_compare_column_carries_too_early_to_the_wire() -> None:
    service = _stub()
    column = CompareColumn("draft", "no changes", DOC, (), RESULTS, None, None, too_early=_too_early())
    service.compare = AsyncMock(return_value=Comparison(META, (column,)))
    body = _client().get("/api/financial-aid/scenarios/2027/compare").json()["columns"][0]["results"]
    assert body["too_early"]["basis_year"] == 2026


def test_the_draft_carries_too_early_to_the_wire() -> None:
    service = _stub()
    draft = replace(DRAFT, too_early=_too_early())
    service.workspace = AsyncMock(return_value=Workspace(2027, 1, META, draft, (KEPT,)))
    body = _client().get("/api/financial-aid/scenarios/2027").json()
    assert body["draft"]["results"]["too_early"]["share"] == 0.03


def test_a_projection_with_no_floor_note_has_no_too_early() -> None:
    """Pin: the field is optional and null on a projected read and on a kept option."""
    service = _stub()
    service.evaluate = AsyncMock(return_value=Evaluation(DOC, RESULTS, ValidationReport(), projection=_a_projection()))
    body = _client().post("/api/financial-aid/scenarios/2027/evaluate", json=DOC_BODY).json()["results"]
    assert body["too_early"] is None
