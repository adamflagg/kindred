#!/usr/bin/env bash
# Behavioural check for docker/Caddyfile's superuser-API gate.
#
# Runs Caddy against the REAL production Caddyfile -- only its listen address
# and upstream ports are rewritten, the upstreams to a port nothing listens on,
# so a probe never reaches a real PocketBase -- then asserts:
#   - every spelling of the superuser collection API -- name, collection id,
#     any letter case, percent-encoded -- is refused (403) for a client outside
#     ADMIN_ALLOWLIST;
#   - the same paths are NOT refused for an allowlisted client: they reach the
#     proxy, which answers 502 because no upstream is listening;
#   - ordinary PocketBase paths are not gated (502 likewise).
#
# The gate exists because the equivalent Traefik rule was a literal,
# case-sensitive PathPrefix that `/api/collections/_SUPERUSERS/...` and
# `/api/collections/pbc_3142635823/...` walked straight past -- PocketBase
# resolves {collection} case-insensitively and by id. A text assertion on the
# Caddyfile could not catch that class of bypass; this can.
#
# Uses a local `caddy` binary if there is one, else the caddy:2 image (set
# PROBE_USE_DOCKER=1 to force the image). The image path copies the Caddyfile
# in with `docker cp` rather than a bind mount, like the Caddyfile validation
# step it sits beside, which avoids volume mounts on purpose.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=${PROBE_PORT:-18480}
DEAD_PORT=${PROBE_DEAD_PORT:-18481}  # nothing may listen here
ALLOWED_IP=203.0.113.7   # TEST-NET-3, inside the allowlist below
BLOCKED_IP=198.51.100.9  # TEST-NET-2, outside it

WORK=$(mktemp -d)
CONTAINER=""
PID=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if curl -s -o /dev/null "http://127.0.0.1:${DEAD_PORT}/"; then
  echo "FAIL: something is listening on DEAD_PORT ${DEAD_PORT}; set PROBE_DEAD_PORT" >&2
  exit 1
fi
sed -e "s/^:8080 {/:${PORT} {/" -e "s/}:8090\b/}:${DEAD_PORT}/g" -e "s/}:8000\b/}:${DEAD_PORT}/g" \
  "$ROOT/docker/Caddyfile" > "$WORK/Caddyfile"
if ! grep -q "^:${PORT} {" "$WORK/Caddyfile" \
  || grep -qE "\}:(8090|8000)\b" "$WORK/Caddyfile"; then
  echo "FAIL: could not rewrite the Caddyfile's listen address and upstream ports" >&2
  exit 1
fi

ENV_VARS=(
  "ADMIN_ALLOWLIST=203.0.113.0/24"
  "POCKETBASE_HOST=127.0.0.1"
  "API_HOST=127.0.0.1"
  "ALLOWED_ORIGINS_REGEX=example\\.invalid"
)

if [ "${PROBE_USE_DOCKER:-0}" != 1 ] && command -v caddy >/dev/null 2>&1; then
  env "${ENV_VARS[@]}" caddy run --config "$WORK/Caddyfile" --adapter caddyfile >"$WORK/caddy.log" 2>&1 &
  PID=$!
else
  DOCKER_ENV=()
  for kv in "${ENV_VARS[@]}"; do DOCKER_ENV+=(-e "$kv"); done
  CONTAINER=$(docker create "${DOCKER_ENV[@]}" -p "127.0.0.1:${PORT}:${PORT}" caddy:2)
  docker cp "$WORK/Caddyfile" "$CONTAINER:/etc/caddy/Caddyfile"
  docker start "$CONTAINER" >/dev/null
fi

for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then break; fi
  sleep 1
done
if ! curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then
  echo "FAIL: Caddy did not come up" >&2
  [ -f "$WORK/caddy.log" ] && cat "$WORK/caddy.log" >&2
  [ -n "$CONTAINER" ] && docker logs "$CONTAINER" >&2
  exit 1
fi

failures=0
# expect <want: blocked|open> <client ip> <method> <path>
expect() {
  local want=$1 ip=$2 method=$3 path=$4 code
  code=$(curl -s -o /dev/null -w '%{http_code}' --path-as-is -X "$method" \
    -H "X-Forwarded-For: $ip" "http://127.0.0.1:${PORT}${path}")
  if [ "$want" = blocked ] && [ "$code" != 403 ]; then
    echo "FAIL: $method $path from $ip -> $code, want 403"
    failures=$((failures + 1))
  elif [ "$want" = open ] && [ "$code" != 502 ]; then
    echo "FAIL: $method $path from $ip -> $code, want 502 (reached the proxy, no upstream)"
    failures=$((failures + 1))
  else
    echo "ok:   $method $path from $ip -> $code"
  fi
}

GATED=(
  /api/collections/_superusers
  /api/collections/_superusers/auth-with-password
  /api/collections/_superusers/records
  /api/collections/_SUPERUSERS/auth-with-password
  /api/collections/_SuperUsers/request-otp
  /api/collections/%5Fsuperusers/auth-with-password
  /api/collections/pbc_3142635823/auth-with-password
  /api/collections/PBC_3142635823/records
)
for path in "${GATED[@]}"; do
  expect blocked "$BLOCKED_IP" POST "$path"
  expect open "$ALLOWED_IP" POST "$path"
done

# Not gated: staff sign-in and ordinary collections must stay reachable.
expect open "$BLOCKED_IP" POST /api/collections/users/auth-with-oauth2
expect open "$BLOCKED_IP" GET /api/collections/users/auth-methods
expect open "$BLOCKED_IP" GET /api/collections/camp_sessions/records

if [ "$failures" -gt 0 ]; then
  echo "$failures superuser-gate check(s) failed"
  exit 1
fi
echo "superuser API gate holds"
