"""Shared helpers for FastAPI endpoint permission tests (campership SP2).

Later sub-projects import these to write the per-route tests campership spec
§14.3 asks for: none / exec without finance / registrar / finance / development.

Two complementary checks, because neither alone is enough:

* ``assert_requires_permission`` / ``assert_requires_any_permission`` read the
  endpoint's signature and prove WHICH gate it declares. They cannot see a gate
  added through ``APIRouter(dependencies=[...])``.
* ``assert_persona_access`` drives the real route through a bare FastAPI app
  once per persona and proves who gets a 403, whatever form the gate takes.

Personas mirror the roles migration 1500000185 leaves in production.
``is_admin`` bypasses every ``require_*`` gate and is deliberately not a
persona: it would pass every route and prove nothing.

Builds a bare FastAPI app and never imports ``api.main`` -- importing it from a
test poisons auth for the whole xdist run.
"""

import inspect
import typing
from collections.abc import Callable, Collection, Mapping
from types import MappingProxyType
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.permissions import ALL_PERMISSIONS, Permission

FINANCIAL_AID_PERMISSIONS: frozenset[str] = frozenset(
    {
        Permission.FINANCIAL_AID_VIEW,
        Permission.FINANCIAL_AID_CASEWORK,
        Permission.FINANCIAL_AID_RULES,
        Permission.FINANCIAL_AID_SUMMARY,
    }
)

PERSONA_NONE = "none"
PERSONA_EXEC_WITHOUT_FINANCE = "exec_without_finance"
PERSONA_REGISTRAR = "registrar"
PERSONA_FINANCE = "finance"
PERSONA_DEVELOPMENT = "development"

PERSONAS: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        PERSONA_NONE: frozenset(),
        # Every permission that exists except financial aid, users.manage
        # included: the exec role as the migration leaves it. Derived, so a
        # permission added later lands here too -- the worst case for a leak.
        PERSONA_EXEC_WITHOUT_FINANCE: frozenset(ALL_PERMISSIONS - FINANCIAL_AID_PERMISSIONS),
        PERSONA_REGISTRAR: frozenset(
            {
                Permission.METRICS_GEO,
                Permission.REGISTRATION_MANAGE,
                Permission.FINANCIAL_AID_VIEW,
                Permission.FINANCIAL_AID_CASEWORK,
            }
        ),
        PERSONA_FINANCE: frozenset(
            {Permission.METRICS_FINANCIAL, Permission.SHEETS_EXPORT, *FINANCIAL_AID_PERMISSIONS}
        ),
        PERSONA_DEVELOPMENT: frozenset({Permission.FINANCIAL_AID_SUMMARY}),
    }
)


def persona_user(persona: str) -> AuthUser:
    """A non-admin AuthUser holding exactly the persona's permissions."""
    if persona not in PERSONAS:
        raise KeyError(f"unknown persona {persona!r}; known: {sorted(PERSONAS)}")
    user = AuthUser(
        username=f"persona-{persona}",
        email=f"{persona.replace('_', '-')}@example.com",
        display_name=f"Test {persona}",
        groups=[],
        is_admin=False,
    )
    user.permissions = set(PERSONAS[persona])
    return user


def persona_client(router: APIRouter, persona: str) -> TestClient:
    """A TestClient over a bare app holding only ``router``, authenticated as ``persona``.

    ``raise_server_exceptions=False``: a handler that fails after the gate
    opened answers 500 rather than raising, so access checks stay about the gate.
    """
    user = persona_user(persona)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


def assert_persona_access(
    router: APIRouter,
    method: str,
    url: str,
    *,
    allowed: Collection[str],
    json: Any = None,
    params: Mapping[str, Any] | None = None,
) -> None:
    """Every persona in ``allowed`` gets a non-403; every other persona gets 403.

    Patch the router's services before calling; the handler's own result is
    not asserted here. Send a well-formed body: FastAPI runs the permission
    dependency before validating params, but a body that is not JSON at all
    fails earlier with 422.
    """
    unknown = sorted(set(allowed) - set(PERSONAS))
    if unknown:
        raise AssertionError(f"unknown persona(s) in allowed: {unknown}; known: {sorted(PERSONAS)}")
    wrong: list[str] = []
    for persona in PERSONAS:
        response = persona_client(router, persona).request(method.upper(), url, json=json, params=params)
        refused = response.status_code == 403
        if persona in allowed and refused:
            wrong.append(f"{persona}: refused (403) but should be let through")
        elif persona not in allowed and not refused:
            wrong.append(f"{persona}: got {response.status_code}, expected 403")
    if wrong:
        raise AssertionError(f"{method.upper()} {url}:\n  " + "\n  ".join(wrong))


def _dependencies_of(endpoint: Callable[..., Any]) -> list[Any]:
    """Every ``Depends(...)`` callable in the signature, default or Annotated form."""
    found: list[Any] = []
    for param in inspect.signature(endpoint).parameters.values():
        dependency = getattr(param.default, "dependency", None)
        if dependency is not None:
            found.append(dependency)
        if typing.get_origin(param.annotation) is typing.Annotated:
            for meta in param.annotation.__metadata__:
                dependency = getattr(meta, "dependency", None)
                if dependency is not None:
                    found.append(dependency)
    return found


def _declared_gates(endpoint: Callable[..., Any]) -> list[tuple[str, frozenset[str]]]:
    """("all", {perm}) per require_permission and ("any", {perms}) per require_any_permission."""
    gates: list[tuple[str, frozenset[str]]] = []
    for dependency in _dependencies_of(endpoint):
        code = getattr(dependency, "__code__", None)
        if code is None:
            continue
        cells = dict(zip(code.co_freevars, (c.cell_contents for c in dependency.__closure__ or ()), strict=True))
        qualname = getattr(dependency, "__qualname__", "")
        if qualname.startswith("require_permission.") and "permission" in cells:
            gates.append(("all", frozenset({cells["permission"]})))
        elif qualname.startswith("require_any_permission.") and "permissions" in cells:
            gates.append(("any", frozenset(cells["permissions"])))
    return gates


def _name(endpoint: Callable[..., Any]) -> str:
    return getattr(endpoint, "__name__", repr(endpoint))


def assert_requires_permission(endpoint: Callable[..., Any], permission: str) -> None:
    """The endpoint's signature declares ``Depends(require_permission(permission))``."""
    gates = _declared_gates(endpoint)
    if ("all", frozenset({permission})) not in gates:
        raise AssertionError(
            f"{_name(endpoint)} does not declare require_permission({permission!r}); declared gates: {gates}"
        )


def assert_requires_any_permission(endpoint: Callable[..., Any], *permissions: str) -> None:
    """The endpoint declares ``require_any_permission`` over exactly ``permissions`` (any order)."""
    gates = _declared_gates(endpoint)
    if ("any", frozenset(permissions)) not in gates:
        raise AssertionError(
            f"{_name(endpoint)} does not declare require_any_permission over {sorted(permissions)}; "
            f"declared gates: {gates}"
        )
