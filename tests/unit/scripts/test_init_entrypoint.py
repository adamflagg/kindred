"""kindred-init leaves the superuser alone when its password already works.

PocketBase regenerates a superuser's tokenKey on any password write, even a
re-set to the same password, because the stored bcrypt hash gets a fresh salt.
init runs on every `up`, so an unconditional `superuser upsert` killed every
superuser token held by services that were not recreated alongside it.

The script is run for real against stub `curl` and `pocketbase` executables.
A marker file stands for "the env password is the stored one": the stub auth
endpoint succeeds only when it exists, and the stub upsert creates it.
"""

import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ENTRYPOINT = REPO_ROOT / "docker" / "init-entrypoint.sh"

STUB_CURL = r"""#!/bin/sh
url=""
for arg in "$@"; do url="$arg"; done
echo "$*" >> "$STATE/curl.log"
case "$url" in
  */api/collections/_superusers/auth-with-password)
    if [ -f "$STATE/password_ok" ]; then
      echo '{"token":"tok-123","record":{}}'
      exit 0
    fi
    exit 22 ;;
  */.well-known/openid-configuration)
    echo '{"authorization_endpoint":"https://id.example.test/authorize","token_endpoint":"https://id.example.test/token","userinfo_endpoint":"https://id.example.test/userinfo"}'
    exit 0 ;;
  */api/collections/users)
    printf 200
    exit 0 ;;
esac
exit 7
"""

STUB_POCKETBASE = r"""#!/bin/sh
echo "$*" >> "$STATE/pocketbase.log"
touch "$STATE/password_ok"
"""


@pytest.fixture
def stubs(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("curl", STUB_CURL), ("pocketbase", STUB_POCKETBASE)):
        path = bin_dir / name
        path.write_text(body)
        path.chmod(0o755)
    return tmp_path


def run_init(state: Path, *, oidc: bool = False) -> subprocess.CompletedProcess[str]:
    env = {
        "PATH": f"{state / 'bin'}:{os.environ['PATH']}",
        "STATE": str(state),
        "PB_BIN": str(state / "bin" / "pocketbase"),
        "POCKETBASE_URL": "http://pocketbase:8090",
        "POCKETBASE_ADMIN_EMAIL": "admin@example.test",
        "POCKETBASE_ADMIN_PASSWORD": "correct horse",
    }
    if oidc:
        env |= {
            "OIDC_ISSUER": "https://id.example.test",
            "OIDC_CLIENT_ID": "client-id",
            "OIDC_CLIENT_SECRET": "client-secret",
        }
    return subprocess.run(["sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, check=False)


def upserts(state: Path) -> list[str]:
    log = state / "pocketbase.log"
    return log.read_text().splitlines() if log.exists() else []


@pytest.mark.parametrize("oidc", [False, True])
def test_a_working_password_is_never_rewritten(stubs: Path, oidc: bool) -> None:
    (stubs / "password_ok").touch()

    result = run_init(stubs, oidc=oidc)

    assert result.returncode == 0, result.stdout + result.stderr
    assert upserts(stubs) == []


@pytest.mark.parametrize("oidc", [False, True])
def test_a_rejected_password_is_upserted_once(stubs: Path, oidc: bool) -> None:
    result = run_init(stubs, oidc=oidc)

    assert result.returncode == 0, result.stdout + result.stderr
    assert upserts(stubs) == ["superuser upsert admin@example.test correct horse --dir=/pb_data"]


def test_oauth_config_is_sent_with_the_token_from_after_the_upsert(stubs: Path) -> None:
    result = run_init(stubs, oidc=True)

    assert result.returncode == 0, result.stdout + result.stderr
    patch_calls = [line for line in (stubs / "curl.log").read_text().splitlines() if "PATCH" in line]
    assert len(patch_calls) == 1
    assert "Authorization: tok-123" in patch_calls[0]


def test_the_probe_asks_pocketbase_not_the_database_file(stubs: Path) -> None:
    (stubs / "password_ok").touch()

    run_init(stubs)

    calls = (stubs / "curl.log").read_text()
    assert "http://pocketbase:8090/api/collections/_superusers/auth-with-password" in calls
