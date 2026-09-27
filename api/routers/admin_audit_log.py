"""Admin audit log router (spec 2026-09-26-admin-audit-log-design §6).

Admin only (`is_admin`). Under "view as" an admin is not an admin, so a preview
is refused like any non-admin. Reads are not logged.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from api.schemas.admin_audit_log import (
    DEFAULT_PER_PAGE,
    PER_PAGE_CHOICES,
    AuditLogActors,
    AuditLogPage,
    FilterType,
)
from api.services.admin_audit_log_service import AdminAuditLogService
from bunking.auth_middleware import AuthUser
from bunking.rbac.dependencies import require_admin

from ..dependencies import pb

router = APIRouter(prefix="/api/admin/audit-log", tags=["admin-audit-log"])


def _service() -> AdminAuditLogService:
    return AdminAuditLogService(pb)


@router.get("", response_model=AuditLogPage)
async def list_audit_log(
    user: AuthUser = Depends(require_admin),
    types: list[FilterType] = Query([], alias="type"),
    actor: str | None = Query(None, max_length=320),
    q: str | None = Query(None, max_length=100),
    sign_ins: bool = False,
    page: int = Query(1, ge=1, le=100_000),
    per_page: int = Query(DEFAULT_PER_PAGE),
) -> AuditLogPage:
    """Newest first. `type` repeats; sign-ins are hidden unless `sign_ins` is true."""
    if per_page not in PER_PAGE_CHOICES:
        raise HTTPException(status_code=422, detail="per_page must be 10, 15 or 25")
    return await _service().list_page(types=types, actor=actor, q=q, sign_ins=sign_ins, page=page, per_page=per_page)


@router.get("/actors", response_model=AuditLogActors)
async def list_audit_log_actors(user: AuthUser = Depends(require_admin)) -> AuditLogActors:
    """Everyone who appears in the log, for the person picker."""
    return await _service().list_actors()
