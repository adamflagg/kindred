"""Admin "view as" persona: the FastAPI half.

A real admin's tab sends ``X-Kindred-View-As: <comma-separated codenames>`` (or
``none``). It is honoured only when the user's stored is_admin is true, and it
always yields is_admin=False: a persona downgrades, never grants, so there is no
permission allow-list. The PocketBase half is pocketbase/rbac/view_as.go; both
are pinned by pocketbase/rbac/testdata/view_as_vectors.json.
"""

from collections.abc import Iterable
from dataclasses import dataclass

VIEW_AS_HEADER = "X-Kindred-View-As"
_NONE = "none"


@dataclass(frozen=True)
class ViewAsDecision:
    """Effective access for one request."""

    applied: bool
    is_admin: bool
    permissions: frozenset[str]


def parse_view_as(header: str | None) -> list[str] | None:
    """Persona permissions (trimmed, blanks and ``none`` dropped, deduped, sorted), or None if none was sent."""
    if header is None or not header.strip():
        return None
    return sorted({p.strip() for p in header.split(",") if p.strip() and p.strip() != _NONE})


def decide_view_as(real_is_admin: bool, real_permissions: Iterable[str], header: str | None) -> ViewAsDecision:
    """The whole policy, pure so it can share vectors with the Go half."""
    unchanged = ViewAsDecision(applied=False, is_admin=real_is_admin, permissions=frozenset(real_permissions))
    if not real_is_admin:
        return unchanged
    perms = parse_view_as(header)
    if perms is None:
        return unchanged
    return ViewAsDecision(applied=True, is_admin=False, permissions=frozenset(perms))
