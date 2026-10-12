#!/usr/bin/env bash
# Behavioural check for docker/Caddyfile's Cache-Control policy.
#
# Runs Caddy against the REAL production Caddyfile -- only its listen address,
# upstream ports and static root are rewritten -- and asserts the
# Cache-Control header every class of response leaves with:
#   - every API, PocketBase and health response is `no-store`, including the
#     ones Caddy answers itself (403 gates) and the OAuth2 redirect it
#     rewrites, and it REPLACES whatever the upstream sent. The stub upstream
#     below sends the long-lived value PocketBase puts on /api/files/*, so a
#     route that merely forgot the header fails here instead of passing on an
#     empty one;
#   - every HTML document -- index.html, the SPA fallback for any unknown path
#     (including a missing hashed bundle or branding file), and
#     oauth2-complete.html -- is `no-store`;
#   - Vite's content-hashed bundles under /assets/ are long-lived and immutable;
#   - every other static file (frontend/public's icons, /local/ branding) is
#     `no-cache`: storable, but revalidated on every use, because its name does
#     not change when its bytes do.
# Each response must carry exactly ONE Cache-Control line: a proxy route that
# appended its value beside the upstream's would leave the strictest reading
# to the client's discretion.
#
# Uses a local `caddy` binary if there is one, else the caddy:2 image (set
# PROBE_USE_DOCKER=1 to force the image). The image path copies files in with
# `docker cp` rather than a bind mount, like the Caddyfile validation step it
# sits beside.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=${PROBE_PORT:-18490}
STUB_PORT=${PROBE_STUB_PORT:-18491}  # the stub upstream, served by the same Caddy
ALLOWED_IP=203.0.113.7   # TEST-NET-3, inside the allowlist below
BLOCKED_IP=198.51.100.9  # TEST-NET-2, outside it
# What PocketBase itself sends on /api/files/* (tools/filesystem's default).
UPSTREAM_CC="max-age=2592000, stale-while-revalidate=86400"
NO_STORE="no-store"
NO_CACHE="no-cache"
IMMUTABLE="public, max-age=31536000, immutable"

WORK=$(mktemp -d)
CONTAINER=""
PID=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

for p in "$PORT" "$STUB_PORT"; do
  if curl -s -o /dev/null "http://127.0.0.1:${p}/"; then
    echo "FAIL: something is already listening on ${p}; set PROBE_PORT / PROBE_STUB_PORT" >&2
    exit 1
  fi
done

# --- The static root: the real frontend/public files plus a stand-in for the
# build output (index.html, hashed bundles) and the /local/ branding tree.
DOCROOT_LOCAL="$WORK/pb_public"
mkdir -p "$DOCROOT_LOCAL/assets" "$DOCROOT_LOCAL/local/assets"
cp -R "$ROOT/frontend/public/." "$DOCROOT_LOCAL/"
printf '<!doctype html><title>stub</title>\n' > "$DOCROOT_LOCAL/index.html"
printf 'console.log(1)\n' > "$DOCROOT_LOCAL/assets/index-AbCd12_-.js"
printf 'body{}\n' > "$DOCROOT_LOCAL/assets/index-Zy98xW76.css"
# A file under /assets/ WITHOUT a content hash (frontend/public/assets/ would
# copy one there): its bytes can change under the same URL, so it must not be
# immutable.
printf '{}\n' > "$DOCROOT_LOCAL/assets/app-config.json"
printf 'PNG' > "$DOCROOT_LOCAL/local/assets/brand-logo.png"

USE_DOCKER=1
if [ "${PROBE_USE_DOCKER:-0}" != 1 ] && command -v caddy >/dev/null 2>&1; then
  USE_DOCKER=0
fi
if [ "$USE_DOCKER" = 1 ]; then DOCROOT=/pb_public; else DOCROOT="$DOCROOT_LOCAL"; fi

# --- The Caddyfile: listen port, both upstreams -> the stub, root -> DOCROOT.
sed -e "s/^:8080 {/:${PORT} {/" \
  -e "s/}:8090\b/}:${STUB_PORT}/g" -e "s/}:8000\b/}:${STUB_PORT}/g" \
  -e "s#root \* /pb_public\$#root * ${DOCROOT}#" \
  "$ROOT/docker/Caddyfile" > "$WORK/Caddyfile"
if ! grep -q "^:${PORT} {" "$WORK/Caddyfile" \
  || grep -qE "\}:(8090|8000)\b" "$WORK/Caddyfile" \
  || ! grep -qF "root * ${DOCROOT}" "$WORK/Caddyfile"; then
  echo "FAIL: could not rewrite the Caddyfile's listen address, upstream ports or root" >&2
  exit 1
fi
# The stub upstream: answers everything 200 with PocketBase's long-lived file
# header, and answers the OAuth2 callback the way PocketBase does (a 307 to
# the admin UI's redirect page), so the rewrite path is exercised too.
cat >> "$WORK/Caddyfile" <<EOF

:${STUB_PORT} {
	header Cache-Control "${UPSTREAM_CC}"
	@oauth path /api/oauth2-redirect
	header @oauth Location "/_/#/auth/oauth2-redirect-success"
	respond @oauth 307
	respond "stub upstream" 200
}
EOF

ENV_VARS=(
  "ADMIN_ALLOWLIST=203.0.113.0/24"
  "POCKETBASE_HOST=127.0.0.1"
  "API_HOST=127.0.0.1"
  "ALLOWED_ORIGINS_REGEX=example\\.invalid"
)

if [ "$USE_DOCKER" = 0 ]; then
  env "${ENV_VARS[@]}" caddy run --config "$WORK/Caddyfile" --adapter caddyfile >"$WORK/caddy.log" 2>&1 &
  PID=$!
else
  DOCKER_ENV=()
  for kv in "${ENV_VARS[@]}"; do DOCKER_ENV+=(-e "$kv"); done
  CONTAINER=$(docker create "${DOCKER_ENV[@]}" \
    -p "127.0.0.1:${PORT}:${PORT}" -p "127.0.0.1:${STUB_PORT}:${STUB_PORT}" caddy:2)
  docker cp "$WORK/Caddyfile" "$CONTAINER:/etc/caddy/Caddyfile"
  docker cp "$DOCROOT_LOCAL" "$CONTAINER:/pb_public"
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
fail() {
  echo "FAIL: $*"
  failures=$((failures + 1))
}

# headers_of <port> <method> <path> [extra curl args...] -> response headers, CR stripped
headers_of() {
  local port=$1 method=$2 path=$3
  shift 3
  curl -s -o /dev/null -D - --path-as-is -X "$method" "$@" \
    "http://127.0.0.1:${port}${path}" | tr -d '\r'
}

# expect_cc <want Cache-Control> <want status> <method> <path> [extra curl args...]
expect_cc() {
  local want=$1 want_status=$2 method=$3 path=$4 hdrs status lines got
  shift 4
  hdrs=$(headers_of "$PORT" "$method" "$path" "$@")
  status=$(printf '%s\n' "$hdrs" | head -1 | awk '{print $2}')
  lines=$(printf '%s\n' "$hdrs" | grep -ci '^cache-control:' || true)
  got=$(printf '%s\n' "$hdrs" | grep -i '^cache-control:' | sed 's/^[^:]*: *//' | paste -sd'|' - || true)
  if [ "$status" != "$want_status" ]; then
    fail "$method $path -> status $status, want $want_status"
  elif [ "$lines" != 1 ]; then
    fail "$method $path -> $lines Cache-Control lines [$got], want exactly 1 [$want]"
  elif [ "$got" != "$want" ]; then
    fail "$method $path -> Cache-Control [$got], want [$want]"
  else
    echo "ok:   $method $path -> $status, Cache-Control: $got"
  fi
}

# expect_html <path>: the response is the SPA document, not a static file.
expect_html() {
  local path=$1 ctype
  ctype=$(headers_of "$PORT" GET "$path" | grep -i '^content-type:' | sed 's/^[^:]*: *//' || true)
  case "$ctype" in
    text/html*) echo "ok:   GET $path is HTML ($ctype)" ;;
    *) fail "GET $path -> Content-Type [$ctype], want text/html" ;;
  esac
}

# The stub really does send a long-lived header, so every no-store below is an
# override, not an absence.
stub_cc=$(headers_of "$STUB_PORT" GET /api/files/x/y/z.png | grep -i '^cache-control:' | sed 's/^[^:]*: *//' || true)
if [ "$stub_cc" != "$UPSTREAM_CC" ]; then
  fail "stub upstream sends Cache-Control [$stub_cc], want [$UPSTREAM_CC] -- the probe proves nothing"
fi

echo "--- PocketBase routes (upstream sends: $UPSTREAM_CC)"
expect_cc "$NO_STORE" 200 GET /api/collections/camp_sessions/records
expect_cc "$NO_STORE" 200 GET /api/collections
expect_cc "$NO_STORE" 200 GET /api/files/pbc_000/rec000/photo_abc123.png
expect_cc "$NO_STORE" 200 GET /api/realtime
expect_cc "$NO_STORE" 200 POST /api/batch
expect_cc "$NO_STORE" 200 GET /api/custom/sync/status
expect_cc "$NO_STORE" 200 GET /api/settings
expect_cc "$NO_STORE" 200 GET /api/logs
expect_cc "$NO_STORE" 200 GET /api/backups
# The superuser API gate's own 403, and the same path let through.
expect_cc "$NO_STORE" 403 POST /api/collections/_superusers/auth-with-password \
  -H "X-Forwarded-For: $BLOCKED_IP"
expect_cc "$NO_STORE" 200 POST /api/collections/_superusers/auth-with-password \
  -H "X-Forwarded-For: $ALLOWED_IP"

echo "--- OAuth2 redirect (rewritten by Caddy)"
expect_cc "$NO_STORE" 307 GET "/api/oauth2-redirect?state=s&code=c"
loc=$(headers_of "$PORT" GET "/api/oauth2-redirect?state=s&code=c" | grep -i '^location:' | sed 's/^[^:]*: *//' || true)
if [ "$loc" != "/oauth2-complete.html?status=success" ]; then
  fail "OAuth2 redirect Location [$loc], want the rewritten /oauth2-complete.html?status=success"
fi

echo "--- PocketBase admin UI"
expect_cc "$NO_STORE" 200 GET /_/ -H "X-Forwarded-For: $ALLOWED_IP"
expect_cc "$NO_STORE" 403 GET /_/ -H "X-Forwarded-For: $BLOCKED_IP"

echo "--- FastAPI routes"
expect_cc "$NO_STORE" 200 GET /health
expect_cc "$NO_STORE" 200 GET /api/solver/status
expect_cc "$NO_STORE" 403 GET /api/internal/anything

echo "--- HTML documents"
expect_cc "$NO_STORE" 200 GET /
expect_cc "$NO_STORE" 200 GET /summer/session/1/board
expect_html /summer/session/1/board
expect_cc "$NO_STORE" 200 GET /oauth2-complete.html
expect_cc "$NO_STORE" 200 GET "/oauth2-complete.html?status=success"
# A hashed bundle or branding file that does not exist falls back to
# index.html: that HTML must not inherit the long-lived asset policy.
expect_cc "$NO_STORE" 200 GET /assets/index-gone0000.js
expect_html /assets/index-gone0000.js
expect_cc "$NO_STORE" 200 GET /local/assets/missing.png
expect_html /local/assets/missing.png

echo "--- Content-hashed bundles"
expect_cc "$IMMUTABLE" 200 GET /assets/index-AbCd12_-.js
expect_cc "$IMMUTABLE" 200 GET /assets/index-Zy98xW76.css

echo "--- Other static files"
expect_cc "$NO_CACHE" 200 GET /local/assets/brand-logo.png
expect_cc "$NO_CACHE" 200 GET /assets/app-config.json
# Every file frontend/public ships: HTML is a document (no-store), anything
# else is a non-hashed static file (no-cache).
while IFS= read -r f; do
  rel=${f#"$ROOT/frontend/public"}
  case "$rel" in
    *.html) expect_cc "$NO_STORE" 200 GET "$rel" ;;
    *) expect_cc "$NO_CACHE" 200 GET "$rel" ;;
  esac
done < <(find "$ROOT/frontend/public" -type f | sort)

if [ "$failures" -gt 0 ]; then
  echo "$failures cache-header check(s) failed"
  exit 1
fi
echo "Cache-Control policy holds"
