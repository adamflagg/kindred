"""SuperuserPocketBase recovers on its own when its superuser token stops being valid.

PocketBase regenerates a superuser's ``tokenKey`` whenever that superuser's
password is re-set (for example by a container that re-sets it on every
start), and every token issued before then dies. PocketBase does NOT answer a
dead token with 401: it treats the request as a guest's, so a superuser-only
collection answers 403 and an auth-ruled list answers 200 with no items.

These tests drive the real SDK against an ``httpx.MockTransport`` -- the HTTP
boundary -- so the retry is exercised through ``Client.send`` exactly as the
record services call it.
"""

import json
import threading
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from pocketbase.errors import ClientResponseError

from api.services.pb_superuser_client import SuperuserPocketBase

EMAIL = "admin@example.com"
PASSWORD = "fictional-password"
OLD = "old-token"
NEW = "new-token"
AUTH_PATH = "/api/collections/_superusers/auth-with-password"
REFRESH_PATH = "/api/collections/_superusers/auth-refresh"
RECORDS_PATH = "/api/collections/solver_runs/records"


def _auth_ok(token: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "token": token,
            "record": {"id": "su0000000000001", "collectionName": "_superusers", "email": EMAIL},
        },
    )


def _list_ok() -> httpx.Response:
    return httpx.Response(
        200,
        json={"page": 1, "perPage": 30, "totalItems": 1, "totalPages": 1, "items": [{"id": "rec000000000001"}]},
    )


def _denied(status: int) -> httpx.Response:
    return httpx.Response(status, json={"status": status, "message": "Only superusers can perform this action."})


class FakePocketBase:
    """Records every request and routes it by path and Authorization token."""

    def __init__(self, records: Callable[[httpx.Request], httpx.Response]) -> None:
        self.calls: list[tuple[str, str]] = []
        self.auth_calls = 0
        self.next_token = NEW
        self._records = records
        self._lock = threading.Lock()

    def handler(self, request: httpx.Request) -> httpx.Response:
        token = request.headers.get("Authorization", "")
        with self._lock:
            self.calls.append((request.url.path, token))
        if request.url.path == AUTH_PATH:
            with self._lock:
                self.auth_calls += 1
            return _auth_ok(self.next_token)
        return self._records(request)

    def record_calls(self) -> list[str]:
        return [token for path, token in self.calls if path == RECORDS_PATH]


def _client(fake: FakePocketBase, token: str = OLD) -> SuperuserPocketBase:
    client = SuperuserPocketBase(
        "http://pb.test",
        credentials=lambda: (EMAIL, PASSWORD),
        transport=httpx.MockTransport(fake.handler),
    )
    client.auth_store.save(token, None)
    return client


def _only_new_token_allowed(status: int) -> Callable[[httpx.Request], httpx.Response]:
    def records(request: httpx.Request) -> httpx.Response:
        return _list_ok() if request.headers.get("Authorization") == NEW else _denied(status)

    return records


class TestRetryAfterReauth:
    @pytest.mark.parametrize("status", [401, 403])
    def test_denied_request_is_retried_once_after_reauth(self, status: int) -> None:
        fake = FakePocketBase(_only_new_token_allowed(status))
        client = _client(fake)

        result = client.collection("solver_runs").get_list(1, 30)

        assert [item.id for item in result.items] == ["rec000000000001"]
        assert fake.auth_calls == 1
        assert fake.record_calls() == [OLD, NEW]
        assert client.auth_store.token == NEW

    def test_reauth_uses_the_configured_credentials(self) -> None:
        bodies: list[dict[str, Any]] = []
        fake = FakePocketBase(_only_new_token_allowed(403))

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == AUTH_PATH:
                bodies.append(json.loads(request.content))
            return fake.handler(request)

        client = SuperuserPocketBase(
            "http://pb.test", credentials=lambda: (EMAIL, PASSWORD), transport=httpx.MockTransport(handler)
        )
        client.auth_store.save(OLD, None)
        client.collection("solver_runs").get_list(1, 30)

        assert bodies == [{"identity": EMAIL, "password": PASSWORD}]

    def test_retry_sends_the_new_token_even_when_the_caller_passed_headers(self) -> None:
        """Client._send writes the token into the caller's own headers dict; the retry must not resend it."""
        fake = FakePocketBase(_only_new_token_allowed(403))
        client = _client(fake)

        data = client.send(RECORDS_PATH, {"method": "GET", "headers": {"X-Fictional": "1"}})

        assert data["items"][0]["id"] == "rec000000000001"
        assert fake.record_calls() == [OLD, NEW]


class TestNoLoop:
    def test_second_denial_surfaces_the_original_error(self) -> None:
        fake = FakePocketBase(lambda request: _denied(403))
        client = _client(fake)

        with pytest.raises(ClientResponseError) as exc:
            client.collection("solver_runs").get_list(1, 30)

        assert exc.value.status == 403
        assert fake.record_calls() == [OLD, NEW]  # exactly one retry
        assert fake.auth_calls == 1

    def test_original_error_is_raised_not_the_retry_error(self) -> None:
        attempts: list[int] = []

        def records(request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            return _denied(401) if len(attempts) == 1 else _denied(403)

        client = _client(FakePocketBase(records))

        with pytest.raises(ClientResponseError) as exc:
            client.collection("solver_runs").get_list(1, 30)

        assert exc.value.status == 401

    def test_failed_reauth_surfaces_the_original_error_without_retrying(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == AUTH_PATH:
                return httpx.Response(400, json={"status": 400, "message": "Failed to authenticate."})
            return _denied(403)

        client = SuperuserPocketBase(
            "http://pb.test", credentials=lambda: (EMAIL, PASSWORD), transport=httpx.MockTransport(handler)
        )
        client.auth_store.save(OLD, None)

        with pytest.raises(ClientResponseError) as exc:
            client.collection("solver_runs").get_list(1, 30)

        assert exc.value.status == 403

    def test_auth_with_password_itself_is_never_retried(self) -> None:
        auth_calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            auth_calls.append(request.url.path)
            return _denied(403)

        client = SuperuserPocketBase(
            "http://pb.test", credentials=lambda: (EMAIL, PASSWORD), transport=httpx.MockTransport(handler)
        )
        client.auth_store.save(OLD, None)

        with pytest.raises(ClientResponseError):
            client.collection("_superusers").auth_with_password(EMAIL, PASSWORD)

        assert auth_calls == [AUTH_PATH]

    @pytest.mark.parametrize("status", [400, 404, 500])
    def test_other_statuses_are_not_retried(self, status: int) -> None:
        fake = FakePocketBase(lambda request: _denied(status))
        client = _client(fake)

        with pytest.raises(ClientResponseError) as exc:
            client.collection("solver_runs").get_list(1, 30)

        assert exc.value.status == status
        assert fake.auth_calls == 0
        assert fake.record_calls() == [OLD]

    def test_unauthenticated_client_is_not_retried(self) -> None:
        """No token means no superuser session to restore (e.g. SKIP_PB_AUTH)."""
        fake = FakePocketBase(lambda request: _denied(403))
        client = _client(fake, token="")

        with pytest.raises(ClientResponseError):
            client.collection("solver_runs").get_list(1, 30)

        assert fake.auth_calls == 0

    def test_non_auth_failure_on_retry_is_the_real_answer(self) -> None:
        """With a working token a record can be genuinely missing; that 404 must not hide behind a 403."""

        def records(request: httpx.Request) -> httpx.Response:
            if request.headers.get("Authorization") == NEW:
                return httpx.Response(404, json={"status": 404, "message": "Not found."})
            return _denied(403)

        client = _client(FakePocketBase(records))

        with pytest.raises(ClientResponseError) as exc:
            client.collection("solver_runs").get_one("rec000000000001")

        assert exc.value.status == 404


class TestConcurrentCallers:
    def test_concurrent_denials_reauth_once(self) -> None:
        callers = 4
        barrier = threading.Barrier(callers, timeout=5)

        def records(request: httpx.Request) -> httpx.Response:
            if request.headers.get("Authorization") == NEW:
                return _list_ok()
            barrier.wait()  # every caller has been denied before any of them re-auths
            return _denied(403)

        fake = FakePocketBase(records)
        client = _client(fake)
        results: list[int] = []
        errors: list[BaseException] = []

        def call() -> None:
            try:
                results.append(len(client.collection("solver_runs").get_list(1, 30).items))
            except BaseException as e:  # pragma: no cover - surfaced by the assert below
                errors.append(e)

        threads = [threading.Thread(target=call) for _ in range(callers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert errors == []
        assert results == [1] * callers
        assert fake.auth_calls == 1


class TestRefreshOrReauthenticate:
    def test_live_token_is_renewed_by_auth_refresh(self) -> None:
        def records(request: httpx.Request) -> httpx.Response:
            if request.url.path == REFRESH_PATH and request.headers.get("Authorization") == OLD:
                return _auth_ok("renewed-token")
            return _denied(401)

        fake = FakePocketBase(records)
        client = _client(fake)

        client.refresh_or_reauthenticate()

        assert client.auth_store.token == "renewed-token"
        assert fake.auth_calls == 0

    def test_dead_token_falls_back_to_password_auth(self) -> None:
        """auth-refresh answers 401 for a guest -- which is what a rotated token makes us."""
        fake = FakePocketBase(lambda request: _denied(401))
        client = _client(fake)

        client.refresh_or_reauthenticate()

        assert client.auth_store.token == NEW
        assert fake.auth_calls == 1
        refresh_calls = [path for path, _ in fake.calls if path == REFRESH_PATH]
        assert len(refresh_calls) == 1  # the probe itself is not retried

    @pytest.mark.parametrize("status", [500, 502, 503])
    def test_a_pocketbase_failure_is_raised_without_a_password_sign_in(self, status: int) -> None:
        """Only 401/403 means the token died; an outage is not fixed by signing in again."""
        fake = FakePocketBase(lambda request: _denied(status))
        client = _client(fake)

        with pytest.raises(ClientResponseError) as caught:
            client.refresh_or_reauthenticate()

        assert caught.value.status == status
        assert fake.auth_calls == 0
        assert client.auth_store.token == OLD

    def test_reauth_failure_propagates_to_the_caller(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == AUTH_PATH:
                return httpx.Response(400, json={"status": 400, "message": "Failed to authenticate."})
            return _denied(401)

        client = SuperuserPocketBase(
            "http://pb.test", credentials=lambda: (EMAIL, PASSWORD), transport=httpx.MockTransport(handler)
        )
        client.auth_store.save(OLD, None)

        with pytest.raises(ClientResponseError):
            client.refresh_or_reauthenticate()


class TestAuthenticate:
    def test_authenticate_signs_in_with_the_configured_credentials(self) -> None:
        fake = FakePocketBase(_only_new_token_allowed(403))
        client = _client(fake, token="")

        client.authenticate()

        assert client.auth_store.token == NEW
        assert fake.auth_calls == 1
