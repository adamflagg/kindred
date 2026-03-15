#!/bin/bash
# Secrets provider detection — sources environment variables from the best available provider.
#
# Priority: Infisical CLI → Doppler CLI → .env file → error
#
# Usage (from any script):
#   source "$(dirname "$0")/env-provider.sh"  # or with full path
#   load_env "$PROJECT_ROOT"
#
# Supported providers:
#   - Infisical: Install CLI + configure scripts/vault.config (see scripts/vault.config.example)
#   - Doppler:   Install CLI + run `doppler setup` in project root
#   - .env file: Copy .env.example → .env and fill in values (always works)
#
# Override auto-detection with SECRETS_PROVIDER:
#   SECRETS_PROVIDER=dotenv ./scripts/start_dev.sh      # Skip managers, use .env only
#   SECRETS_PROVIDER=infisical ./scripts/start_dev.sh   # Only try Infisical
#   SECRETS_PROVIDER=doppler ./scripts/start_dev.sh     # Only try Doppler
#
# The function exports all loaded variables into the current shell.
# Returns 0 on success, 1 if no provider found.

# shellcheck source=./colors.sh
source "$(dirname "${BASH_SOURCE[0]}")/colors.sh"

load_env() {
    local project_root="${1:-.}"
    local loaded=false
    local _env_source=""

    # Optional: force a specific provider (skips auto-detection)
    local provider="${SECRETS_PROVIDER:-auto}"

    # ── 0. Direct .env (skip all managers) ────────────────────────────
    if [ "$provider" = "dotenv" ]; then
        if [ -f "$project_root/.env" ]; then
            echo -e "${BLUE}Loading environment from .env (SECRETS_PROVIDER=dotenv)${NC}"
            set -a
            # shellcheck source=/dev/null
            source "$project_root/.env"
            set +a
            return 0
        else
            echo -e "${RED}SECRETS_PROVIDER=dotenv but no .env file found${NC}"
            return 1
        fi
    fi

    # ── 1. Infisical CLI ──────────────────────────────────────────────
    if { [ "$provider" = "auto" ] || [ "$provider" = "infisical" ]; } &&
       command -v infisical &>/dev/null && [ -f "$project_root/scripts/vault.config" ]; then
        # Allow env override: INFISICAL_ENV=staging ./scripts/start_dev.sh
        local env_override="${INFISICAL_ENV:-}"
        # shellcheck source=/dev/null
        source "$project_root/scripts/vault.config"
        # Restore override if caller set it before vault.config
        [ -n "$env_override" ] && INFISICAL_ENV="$env_override"

        # Skip network call if credentials are missing
        if [ -n "${INFISICAL_CLIENT_ID:-}" ] && [ -n "${INFISICAL_CLIENT_SECRET:-}" ]; then
            # Authenticate via REST API (same approach as the `vault` wrapper)
            local token
            token=$(curl -sf --connect-timeout 5 --max-time 10 \
                -X POST "${INFISICAL_DOMAIN}/api/v1/auth/universal-auth/login" \
                -H "Content-Type: application/json" \
                -d "{\"clientId\":\"${INFISICAL_CLIENT_ID}\",\"clientSecret\":\"${INFISICAL_CLIENT_SECRET}\"}" \
                | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

            if [ -n "$token" ]; then
                local infisical_output
                if infisical_output=$(infisical export \
                    --token="$token" \
                    --env="${INFISICAL_ENV:-dev}" \
                    --projectId="${INFISICAL_PROJECT_ID:-}" \
                    --domain="${INFISICAL_DOMAIN:-}" \
                    --format=dotenv-export 2>/dev/null) && [ -n "$infisical_output" ]; then
                    echo -e "${BLUE}Loading secrets from Infisical (${INFISICAL_ENV:-dev})${NC}"
                    set -a
                    eval "$infisical_output"
                    set +a
                    loaded=true
                    _env_source="infisical"
                    echo -e "${GREEN}Secrets loaded from Infisical${NC}"
                else
                    echo -e "${YELLOW}Infisical auth OK but export failed — falling back${NC}"
                fi
            else
                echo -e "${YELLOW}Infisical configured but auth failed — falling back${NC}"
            fi
        else
            echo -e "${YELLOW}Infisical vault.config missing credentials — skipping${NC}"
        fi
    fi

    # ── 2. Doppler CLI ────────────────────────────────────────────────
    if { [ "$provider" = "auto" ] || [ "$provider" = "doppler" ]; } &&
       [ "$loaded" = false ] && command -v doppler &>/dev/null; then
        if doppler configure get project --plain &>/dev/null; then
            local doppler_output
            if doppler_output=$(doppler secrets download --no-file --format=env-no-quotes 2>/dev/null) \
               && [ -n "$doppler_output" ]; then
                echo -e "${BLUE}Loading secrets from Doppler${NC}"
                set -a
                eval "$doppler_output"
                set +a
                loaded=true
                _env_source="doppler"
                echo -e "${GREEN}Secrets loaded from Doppler${NC}"
            else
                echo -e "${YELLOW}Doppler configured but export failed — falling back${NC}"
            fi
        fi
    fi

    # ── 2b. Explicit provider failed — don't silently fall back ─────
    if [ "$loaded" = false ] && [ "$provider" != "auto" ]; then
        echo -e "${RED}SECRETS_PROVIDER=$provider requested but failed${NC}"
        return 1
    fi

    # ── 3. .env file ─────────────────────────────────────────────────
    if [ "$loaded" = false ] && [ -f "$project_root/.env" ]; then
        echo -e "${BLUE}Loading environment from .env${NC}"
        set -a
        # shellcheck source=/dev/null
        source "$project_root/.env"
        set +a
        loaded=true
        _env_source="dotenv"
    fi

    # ── 3b. Local overrides (.env) after secrets manager ─────────────
    # When a secrets manager provides the base secrets, .env is sourced
    # as a second pass so ALL .env values override the manager's values.
    # This is critical for worktrees where .env contains unique port
    # assignments that the secrets manager doesn't know about.
    if [ "$loaded" = true ] && [ "$_env_source" != "dotenv" ] && [ -f "$project_root/.env" ]; then
        set -a
        # shellcheck source=/dev/null
        source "$project_root/.env"
        set +a
    fi

    # ── 4. Nothing found ─────────────────────────────────────────────
    if [ "$loaded" = false ]; then
        echo -e "${RED}No secrets provider found.${NC}"
        echo -e "Options:"
        echo -e "  1. Copy .env.example to .env and fill in your values"
        echo -e "  2. Install Infisical CLI and configure scripts/vault.config"
        echo -e "  3. Install Doppler CLI and run 'doppler setup'"
        return 1
    fi

    return 0
}
