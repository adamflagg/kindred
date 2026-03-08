"""Tests for RBAC FastAPI dependencies."""

import pytest
from fastapi import HTTPException

from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_any_permission, require_permission


def _make_user(is_admin: bool = False, permissions: set[str] | None = None) -> AuthUser:
    user = AuthUser(
        username="testuser",
        email="test@example.com",
        display_name="Test User",
        groups=[],
        is_admin=is_admin,
    )
    user.permissions = permissions or set()
    return user


class TestRequirePermission:
    def test_admin_bypasses_all_checks(self):
        user = _make_user(is_admin=True)
        checker = require_permission("bunking.manage")
        result = checker(user)
        assert result is user

    def test_user_with_permission_passes(self):
        user = _make_user(permissions={"bunking.view", "bunking.manage"})
        checker = require_permission("bunking.manage")
        result = checker(user)
        assert result is user

    def test_user_without_permission_gets_403(self):
        user = _make_user(permissions={"metrics.view"})
        checker = require_permission("bunking.manage")
        with pytest.raises(HTTPException) as exc_info:
            checker(user)
        assert exc_info.value.status_code == 403

    def test_user_with_no_permissions_gets_403(self):
        user = _make_user(permissions=set())
        checker = require_permission("bunking.view")
        with pytest.raises(HTTPException) as exc_info:
            checker(user)
        assert exc_info.value.status_code == 403


class TestRequireAnyPermission:
    def test_admin_bypasses(self):
        user = _make_user(is_admin=True)
        checker = require_any_permission("bunking.view", "metrics.view")
        result = checker(user)
        assert result is user

    def test_user_with_one_matching_permission_passes(self):
        user = _make_user(permissions={"metrics.view"})
        checker = require_any_permission("bunking.view", "metrics.view")
        result = checker(user)
        assert result is user

    def test_user_with_no_matching_permissions_gets_403(self):
        user = _make_user(permissions={"other.perm"})
        checker = require_any_permission("bunking.view", "metrics.view")
        with pytest.raises(HTTPException) as exc_info:
            checker(user)
        assert exc_info.value.status_code == 403
