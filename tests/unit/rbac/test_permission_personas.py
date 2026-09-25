"""Self-tests for tests/unit/rbac/permission_personas.py.

The helper is the specification later sub-projects' route tests are written
against, so it gets its own proof: it must pass a correctly gated route, and it
must FAIL on a route gated with the wrong permission. A helper that cannot fail
is how an ungated route ships green.
"""

import re

import pytest
from fastapi import APIRouter, Depends

from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_any_permission, require_permission
from bunking.rbac.permissions import ALL_PERMISSIONS, Permission
from tests.unit.rbac.permission_personas import (
    FINANCIAL_AID_PERMISSIONS,
    PERSONA_DEVELOPMENT,
    PERSONA_EXEC_WITHOUT_FINANCE,
    PERSONA_FINANCE,
    PERSONA_NONE,
    PERSONA_REGISTRAR,
    PERSONAS,
    assert_persona_access,
    assert_requires_any_permission,
    assert_requires_permission,
    persona_user,
)

router = APIRouter()


@router.get("/demo/view")
def demo_view(user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_VIEW))) -> dict[str, str]:
    return {"ok": "view"}


@router.get("/demo/summary")
def demo_summary(
    user: AuthUser = Depends(require_any_permission(Permission.FINANCIAL_AID_SUMMARY, Permission.FINANCIAL_AID_VIEW)),
) -> dict[str, str]:
    return {"ok": "summary"}


@router.get("/demo/explodes")
def demo_explodes(user: AuthUser = Depends(require_permission(Permission.FINANCIAL_AID_VIEW))) -> dict[str, str]:
    raise RuntimeError("handler failed after the gate let the caller in")


class TestPersonas:
    def test_exactly_the_five_personas(self):
        assert set(PERSONAS) == {
            PERSONA_NONE,
            PERSONA_EXEC_WITHOUT_FINANCE,
            PERSONA_REGISTRAR,
            PERSONA_FINANCE,
            PERSONA_DEVELOPMENT,
        }

    def test_financial_aid_permissions_are_the_four(self):
        assert {
            "financial_aid.view",
            "financial_aid.casework",
            "financial_aid.rules",
            "financial_aid.summary",
        } == FINANCIAL_AID_PERMISSIONS

    def test_none_holds_nothing(self):
        assert PERSONAS[PERSONA_NONE] == frozenset()

    def test_exec_without_finance_holds_everything_but_financial_aid(self):
        """The prod exec role as migration 1500000185 leaves it (spec §2 item 12):
        every permission, users.manage included, and none of the four."""
        assert PERSONAS[PERSONA_EXEC_WITHOUT_FINANCE] == ALL_PERMISSIONS - FINANCIAL_AID_PERMISSIONS
        assert Permission.USERS_MANAGE in PERSONAS[PERSONA_EXEC_WITHOUT_FINANCE]

    def test_registrar_matches_the_role_grant(self):
        held = PERSONAS[PERSONA_REGISTRAR]
        assert held & FINANCIAL_AID_PERMISSIONS == {Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_CASEWORK}

    def test_finance_holds_all_four(self):
        assert PERSONAS[PERSONA_FINANCE] >= FINANCIAL_AID_PERMISSIONS

    def test_development_holds_summary_only(self):
        assert PERSONAS[PERSONA_DEVELOPMENT] == {Permission.FINANCIAL_AID_SUMMARY}

    def test_persona_user_is_never_admin(self):
        """is_admin bypasses every gate, so an admin persona would prove nothing."""
        for persona in PERSONAS:
            user = persona_user(persona)
            assert user.is_admin is False
            assert user.permissions == set(PERSONAS[persona])
            assert user.email.endswith("@example.com")

    def test_unknown_persona_is_refused(self):
        with pytest.raises(KeyError, match="unknown persona"):
            persona_user("treasurer")


class TestAssertPersonaAccess:
    def test_passes_a_correctly_gated_view_route(self):
        assert_persona_access(router, "GET", "/demo/view", allowed={PERSONA_REGISTRAR, PERSONA_FINANCE})

    def test_fails_when_the_expected_set_is_wrong(self):
        # Ruling P1: /demo/view is gated on FINANCIAL_AID_VIEW. registrar and
        # finance legitimately hold it and get a real 200; development does
        # not hold it, so it is the one that gets refused. The failure this
        # raises is "development: refused", not "registrar: refused".
        with pytest.raises(AssertionError, match="development: refused"):
            assert_persona_access(
                router, "GET", "/demo/view", allowed={PERSONA_REGISTRAR, PERSONA_FINANCE, "development"}
            )

    def test_fails_when_a_persona_is_let_through_unexpectedly(self):
        with pytest.raises(AssertionError, match="registrar: got 200, expected 403"):
            assert_persona_access(router, "GET", "/demo/view", allowed={PERSONA_FINANCE})

    def test_require_any_permission_route(self):
        assert_persona_access(
            router,
            "GET",
            "/demo/summary",
            allowed={PERSONA_REGISTRAR, PERSONA_FINANCE, PERSONA_DEVELOPMENT},
        )

    def test_a_handler_error_after_the_gate_counts_as_let_through(self):
        """Route tests patch services loosely; a 500 behind the gate still proves the gate opened."""
        assert_persona_access(router, "GET", "/demo/explodes", allowed={PERSONA_REGISTRAR, PERSONA_FINANCE})

    def test_unknown_persona_in_allowed_is_refused(self):
        with pytest.raises(AssertionError, match="unknown persona"):
            assert_persona_access(router, "GET", "/demo/view", allowed={"treasurer"})


class TestGateIntrospection:
    def test_require_permission_found(self):
        assert_requires_permission(demo_view, Permission.FINANCIAL_AID_VIEW)

    def test_require_permission_wrong_permission_fails(self):
        with pytest.raises(AssertionError, match=re.escape("financial_aid.rules")):
            assert_requires_permission(demo_view, Permission.FINANCIAL_AID_RULES)

    def test_require_any_permission_found_in_any_order(self):
        assert_requires_any_permission(demo_summary, Permission.FINANCIAL_AID_VIEW, Permission.FINANCIAL_AID_SUMMARY)

    def test_require_any_permission_must_match_the_whole_set(self):
        with pytest.raises(AssertionError):
            assert_requires_any_permission(demo_summary, Permission.FINANCIAL_AID_SUMMARY)

    def test_an_any_gate_is_not_a_single_permission_gate(self):
        with pytest.raises(AssertionError):
            assert_requires_permission(demo_summary, Permission.FINANCIAL_AID_SUMMARY)
