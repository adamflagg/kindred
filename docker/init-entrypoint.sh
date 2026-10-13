#!/bin/sh
set -e

# Logging functions: compact mode omits timestamp and source (Docker adds its own)
# LOG_COMPACT defaults to true (same as Go/Python services)
_LOG_COMPACT="${LOG_COMPACT:-true}"

if [ "$_LOG_COMPACT" = "false" ] || [ "$_LOG_COMPACT" = "0" ]; then
    log_info() {
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [init] INFO $1"
    }
    log_error() {
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [init] ERROR $1"
    }
else
    log_info() {
        echo "INFO $1"
    }
    log_error() {
        echo "ERROR $1"
    }
fi

PB_URL="${POCKETBASE_URL:-http://pocketbase:8090}"

log_info "Running idempotent init (admin upsert + OIDC config)..."

# Upsert admin via PocketBase CLI (operates directly on SQLite)
if [ -z "${POCKETBASE_ADMIN_EMAIL}" ] || [ -z "${POCKETBASE_ADMIN_PASSWORD}" ]; then
    log_error "POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be set"
    exit 1
fi

# Sign in as the superuser; prints the token, or nothing if PocketBase refuses.
admin_token() {
    curl -sf -X POST \
        -H "Content-Type: application/json" \
        -d "{\"identity\":\"${POCKETBASE_ADMIN_EMAIL}\",\"password\":\"${POCKETBASE_ADMIN_PASSWORD}\"}" \
        "${PB_URL}/api/collections/_superusers/auth-with-password" 2>/dev/null \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' || true
}

# Upsert only when the env credentials don't already sign in. PocketBase
# regenerates a superuser's tokenKey on ANY password write -- re-setting the
# same password still stores a freshly salted hash -- so an unconditional
# upsert on every start signs out every service holding a superuser token.
TOKEN=$(admin_token)
if [ -n "$TOKEN" ]; then
    log_info "Admin user ${POCKETBASE_ADMIN_EMAIL} already signs in; leaving it unchanged"
else
    log_info "Upserting admin user: ${POCKETBASE_ADMIN_EMAIL}"
    # PB_BIN lets tests/unit/scripts/test_init_entrypoint.py substitute a stub.
    "${PB_BIN:-/usr/local/bin/pocketbase}" superuser upsert \
        "${POCKETBASE_ADMIN_EMAIL}" "${POCKETBASE_ADMIN_PASSWORD}" \
        --dir=/pb_data
    TOKEN=$(admin_token)
fi

# Configure OAuth2 if OIDC environment variables are set
if [ -n "${OIDC_ISSUER}" ] && [ -n "${OIDC_CLIENT_ID}" ] && [ -n "${OIDC_CLIENT_SECRET}" ]; then
    log_info "Configuring OAuth2 provider..."

    if [ -z "$TOKEN" ]; then
        log_error "Could not authenticate as admin for OAuth config"
        exit 1
    fi

    # Discover OIDC endpoints
    DISCOVERY_URL="${OIDC_ISSUER%/}/.well-known/openid-configuration"
    log_info "Discovering OIDC endpoints from: $DISCOVERY_URL"

    DISCOVERY_RESPONSE=$(curl -sf "$DISCOVERY_URL" 2>/dev/null || echo "")

    if [ -z "$DISCOVERY_RESPONSE" ]; then
        log_error "Failed to fetch OIDC discovery document from $DISCOVERY_URL"
        exit 1
    fi

    OIDC_AUTH_URL=$(echo "$DISCOVERY_RESPONSE" | sed -n 's/.*"authorization_endpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    OIDC_TOKEN_URL=$(echo "$DISCOVERY_RESPONSE" | sed -n 's/.*"token_endpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    OIDC_USERINFO_URL=$(echo "$DISCOVERY_RESPONSE" | sed -n 's/.*"userinfo_endpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

    if [ -z "$OIDC_AUTH_URL" ] || [ -z "$OIDC_TOKEN_URL" ] || [ -z "$OIDC_USERINFO_URL" ]; then
        log_error "OIDC discovery response missing required endpoints"
        exit 1
    fi

    log_info "Discovered OIDC endpoints"

    # Patch OAuth2 config (idempotent)
    OAUTH_CONFIG="{\"oauth2\":{\"enabled\":true,\"providers\":[{\"name\":\"oidc\",\"displayName\":\"Pocket ID\",\"clientId\":\"${OIDC_CLIENT_ID}\",\"clientSecret\":\"${OIDC_CLIENT_SECRET}\",\"authURL\":\"${OIDC_AUTH_URL}\",\"tokenURL\":\"${OIDC_TOKEN_URL}\",\"userURL\":\"${OIDC_USERINFO_URL}\",\"pkce\":true,\"enabled\":true,\"scopes\":[\"openid\",\"email\",\"profile\",\"groups\"]}]}}"

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X PATCH \
        -H "Authorization: $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$OAUTH_CONFIG" \
        "${PB_URL}/api/collections/users")

    if [ "$HTTP_CODE" = "200" ]; then
        log_info "OAuth2 provider configured successfully"
    else
        log_error "OAuth2 configuration failed (HTTP $HTTP_CODE)"
        exit 1
    fi
else
    log_info "OIDC environment variables not set, skipping OAuth2 configuration"
fi

log_info "Init complete"
