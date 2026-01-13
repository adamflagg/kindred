#!/bin/sh
set -e

# Logging function: outputs in unified format
# Format: 2026-01-06T14:05:52Z [entrypoint] LEVEL message
log_info() {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [entrypoint] INFO $1"
}

log_error() {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [entrypoint] ERROR $1"
}

log_info "Starting Kindred API (PocketBase + FastAPI)..."

# Run migrations FIRST (before any server starts)
log_info "Running database migrations..."
if /usr/local/bin/pocketbase migrate --dir=/pb_data --migrationsDir=/pb_migrations; then
    log_info "Migrations completed successfully"
else
    log_error "Migration failed"
    exit 1
fi

# Check if this is the first run (no admin user exists)
if [ ! -f "/pb_data/.initialized" ]; then
    log_info "First run detected, creating admin user..."

    # Ensure required environment variables are set
    if [ -z "${POCKETBASE_ADMIN_EMAIL}" ] || [ -z "${POCKETBASE_ADMIN_PASSWORD}" ]; then
        log_error "POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be set"
        exit 1
    fi

    # Start PocketBase in background temporarily for admin creation
    log_info "Starting temporary PocketBase instance..."
    /usr/local/bin/pocketbase serve --http=127.0.0.1:8091 --dir=/pb_data --migrationsDir=/pb_migrations &
    PB_PID=$!

    # Wait for PocketBase to be ready
    log_info "Waiting for PocketBase to start..."
    for i in $(seq 1 30); do
        if wget -q --spider http://127.0.0.1:8091/api/health 2>/dev/null; then
            log_info "PocketBase is ready"
            break
        fi
        if [ "$i" -eq 30 ]; then
            log_error "PocketBase failed to start"
            kill $PB_PID 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done

    # Create admin user
    log_info "Creating admin user: ${POCKETBASE_ADMIN_EMAIL}"
    /usr/local/bin/pocketbase superuser upsert "${POCKETBASE_ADMIN_EMAIL}" "${POCKETBASE_ADMIN_PASSWORD}" --dir=/pb_data
    RESULT=$?

    if [ $RESULT -eq 0 ]; then
        log_info "Admin user created successfully"
    else
        log_error "Failed to create admin user (exit code: $RESULT)"
        kill $PB_PID 2>/dev/null || true
        exit 1
    fi

    # Configure OAuth2 if OIDC environment variables are set
    if [ -n "${OIDC_ISSUER}" ] && [ -n "${OIDC_CLIENT_ID}" ] && [ -n "${OIDC_CLIENT_SECRET}" ]; then
        log_info "Configuring OAuth2 provider..."

        # Discover OIDC endpoints from issuer
        DISCOVERY_URL="${OIDC_ISSUER%/}/.well-known/openid-configuration"
        log_info "Discovering OIDC endpoints from: $DISCOVERY_URL"

        DISCOVERY_RESPONSE=$(wget -q -O - "$DISCOVERY_URL" 2>/dev/null || echo "")

        if [ -z "$DISCOVERY_RESPONSE" ]; then
            log_error "Failed to fetch OIDC discovery document from $DISCOVERY_URL"
            log_error "Your OIDC provider may not support auto-discovery"
            kill $PB_PID 2>/dev/null || true
            exit 1
        fi

        # Parse endpoints from discovery response (using sed for Alpine compatibility)
        OIDC_AUTH_URL=$(echo "$DISCOVERY_RESPONSE" | sed -n 's/.*"authorization_endpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        OIDC_TOKEN_URL=$(echo "$DISCOVERY_RESPONSE" | sed -n 's/.*"token_endpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        OIDC_USERINFO_URL=$(echo "$DISCOVERY_RESPONSE" | sed -n 's/.*"userinfo_endpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

        if [ -z "$OIDC_AUTH_URL" ] || [ -z "$OIDC_TOKEN_URL" ] || [ -z "$OIDC_USERINFO_URL" ]; then
            log_error "OIDC discovery response missing required endpoints"
            log_error "Auth URL: ${OIDC_AUTH_URL:-MISSING}"
            log_error "Token URL: ${OIDC_TOKEN_URL:-MISSING}"
            log_error "UserInfo URL: ${OIDC_USERINFO_URL:-MISSING}"
            kill $PB_PID 2>/dev/null || true
            exit 1
        fi

        log_info "Discovered OIDC endpoints: auth=${OIDC_AUTH_URL} token=${OIDC_TOKEN_URL} userinfo=${OIDC_USERINFO_URL}"

        # Login as admin to get token
        AUTH_RESPONSE=$(wget -q -O - --post-data "{\"identity\":\"${POCKETBASE_ADMIN_EMAIL}\",\"password\":\"${POCKETBASE_ADMIN_PASSWORD}\"}" \
            --header="Content-Type: application/json" \
            "http://127.0.0.1:8091/api/collections/_superusers/auth-with-password" 2>/dev/null || echo "")

        TOKEN=$(echo "$AUTH_RESPONSE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

        if [ -n "$TOKEN" ]; then
            # Build OAuth2 config JSON with discovered endpoints
            OAUTH_CONFIG="{\"oauth2\":{\"enabled\":true,\"providers\":[{\"name\":\"oidc\",\"displayName\":\"Pocket ID\",\"clientId\":\"${OIDC_CLIENT_ID}\",\"clientSecret\":\"${OIDC_CLIENT_SECRET}\",\"authURL\":\"${OIDC_AUTH_URL}\",\"tokenURL\":\"${OIDC_TOKEN_URL}\",\"userURL\":\"${OIDC_USERINFO_URL}\",\"pkce\":true,\"enabled\":true,\"scopes\":[\"openid\",\"email\",\"profile\"]}]}}"

            # Update users collection with OAuth2 config (curl required - BusyBox wget doesn't support PATCH)
            HTTP_CODE=$(curl -s -o /tmp/oauth_response.txt -w "%{http_code}" \
                -X PATCH \
                -H "Authorization: $TOKEN" \
                -H "Content-Type: application/json" \
                -d "$OAUTH_CONFIG" \
                "http://127.0.0.1:8091/api/collections/users")

            if [ "$HTTP_CODE" = "200" ]; then
                log_info "OAuth2 provider configured successfully"
            else
                log_error "OAuth2 configuration failed (HTTP $HTTP_CODE)"
                if [ -f /tmp/oauth_response.txt ]; then
                    cat /tmp/oauth_response.txt
                    rm -f /tmp/oauth_response.txt
                fi
            fi
        else
            log_error "Could not login as admin for OAuth config"
        fi
    else
        log_info "OIDC environment variables not set, skipping OAuth2 configuration"
    fi

    # Mark as initialized only on success
    touch /pb_data/.initialized

    # Stop temporary instance
    log_info "Stopping temporary PocketBase instance..."
    kill $PB_PID
    wait $PB_PID 2>/dev/null || true

    log_info "Initial setup complete"
else
    log_info "PocketBase already initialized, skipping admin creation"
fi

# Start supervisor which manages both PocketBase and FastAPI
log_info "Starting services via supervisor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
