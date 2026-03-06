"""FastAPI dependencies for RBAC permission checks."""

from collections.abc import Callable

from fastapi import Depends, HTTPException

from bunking.auth_middleware import AuthUser, get_current_user


def require_permission(permission: str) -> Callable[..., AuthUser]:
    """Require a specific permission. Admin always passes."""

    def checker(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.is_admin:
            return user
        if permission not in user.permissions:
            raise HTTPException(status_code=403, detail=f"Permission required: {permission}")
        return user

    return checker


def require_any_permission(*permissions: str) -> Callable[..., AuthUser]:
    """Require at least one of the listed permissions. Admin always passes."""

    def checker(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.is_admin:
            return user
        if not user.permissions.intersection(permissions):
            raise HTTPException(status_code=403, detail=f"One of these permissions required: {', '.join(permissions)}")
        return user

    return checker
