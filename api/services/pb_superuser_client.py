"""A PocketBase client that keeps its superuser session alive across token rotation.

PocketBase signs every superuser token with that superuser's ``tokenKey``, and
regenerates the key whenever the password is re-set -- by a container that
re-sets it on start, a manual rotation, or an admin action. Every token issued
before then dies at once, long before its expiry.

PocketBase does not answer a dead token with 401. Its ``loadAuthToken``
middleware logs the failure at debug level and serves the request as a guest's,
so a superuser-only collection answers **403**, and a collection whose list rule
needs any auth answers **200 with no items** -- silently wrong data. This class
covers the two halves:

* ``send`` -- the one choke point every record/collection service call goes
  through -- re-authenticates and retries **once** when a request made with the
  stored token is answered 401 or 403. A genuine 403 for a superuser should not
  happen, so the retry is cheap.
* ``refresh_or_reauthenticate`` is a probe for the silent case: auth-refresh
  answers 401 for a guest, i.e. a dead token, and renews a live one.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from pocketbase.errors import ClientResponseError

from bunking.logging_config import get_logger
from pocketbase import PocketBase

from ..constants.collections import SUPERUSERS

logger = get_logger(__name__)

_AUTH_DENIED = frozenset({401, 403})
_REFRESH_PATH = f"/api/collections/{SUPERUSERS}/auth-refresh"


def _copy_config(req_config: dict[str, Any]) -> dict[str, Any]:
    """Copy a request config so each attempt gets its own headers dict.

    ``Client._send`` writes the stored token straight into the caller's
    ``headers`` dict when one is passed, so reusing it for the retry would
    resend the dead token.
    """
    config = dict(req_config)
    if isinstance(config.get("headers"), dict):
        config["headers"] = dict(config["headers"])
    return config


class SuperuserPocketBase(PocketBase):
    """PocketBase client that re-authenticates as superuser when its token dies.

    ``credentials`` returns ``(email, password)`` and is read at each
    authentication, so the client never holds a stale copy of the settings.
    """

    def __init__(self, base_url: str, credentials: Callable[[], tuple[str, str]], **kwargs: Any) -> None:
        super().__init__(base_url, **kwargs)
        self._credentials = credentials
        # Calls arrive through asyncio.to_thread, so several threads can see the
        # same dead token at once. One re-auths; the rest find a new token waiting.
        self._reauth_lock = threading.Lock()

    def authenticate(self) -> None:
        """Sign in as superuser with the configured credentials."""
        email, password = self._credentials()
        self.collection(SUPERUSERS).auth_with_password(email, password)

    def _reauthenticate(self, stale_token: str) -> None:
        """Re-authenticate unless another thread already replaced ``stale_token``."""
        with self._reauth_lock:
            if self.auth_store.token != stale_token:
                return
            self.authenticate()

    def send(self, path: str, req_config: dict[str, Any]) -> Any:
        """Send a request; on 401/403 with the stored token, re-auth and retry once."""
        headers = req_config.get("headers") or {}
        stale_token = self.auth_store.token
        # A caller that set its own Authorization (auth-with-password sends an
        # empty one) is not using the superuser session -- never retry it. This
        # is also what keeps the re-auth call below from recursing.
        if not stale_token or "Authorization" in headers:
            return super().send(path, req_config)

        try:
            return super().send(path, _copy_config(req_config))
        except ClientResponseError as original:
            if original.status not in _AUTH_DENIED:
                raise
            logger.warning(
                f"PocketBase answered {original.status} to the superuser client; re-authenticating and retrying once"
            )
            try:
                self._reauthenticate(stale_token)
            except Exception as reauth_error:
                raise original from reauth_error
            try:
                return super().send(path, _copy_config(req_config))
            except ClientResponseError as retry_error:
                # Denied again: the token was not the problem, so report what the
                # caller first saw. Anything else (404, 400, ...) is the real
                # answer now the request ran as superuser, and callers that
                # handle e.g. a missing record by status must get it.
                if retry_error.status in _AUTH_DENIED:
                    raise original from retry_error
                raise

    def refresh_or_reauthenticate(self) -> None:
        """Renew the superuser token, or sign in again if it has died.

        Raises if the fallback sign-in fails, so the caller can log it.
        """
        stale_token = self.auth_store.token
        try:
            # Straight to Client.send: the probe must observe the dead token,
            # not be rescued by the retry above.
            data = super().send(_REFRESH_PATH, {"method": "POST"})
            self.collection(SUPERUSERS).auth_response(data)
        except ClientResponseError as e:
            logger.warning(f"PocketBase superuser token failed auth-refresh ({e.status}); re-authenticating")
            self._reauthenticate(stale_token)
