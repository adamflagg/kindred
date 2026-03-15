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
#   - Infisical: Install CLI + configure scripts/vault.config (see vault.config.example)
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

load_env() {
    local project_root="${1:-.}"
    local loaded=false
    local _env_source=""

    # Provider colors (safe if caller already defined these)
    local _blue='\033[0;34m'
    local _green='\033[0;32m'
    local _yellow='\033[1;33m'
    local _red='\033[0;31m'
    local _nc='\033[0m'

    # Optional: force a specific provider (skips auto-detection)
    local provider="${SECRETS_PROVIDER:-auto}"

    # ── 0. Direct .env (skip all managers) ────────────────────────────
    if [ "$provider" = "dotenv" ]; then
        if [ -f "$project_root/.env" ]; then
            echo -e "${_blue}Loading environment from .env (SECRETS_PROVIDER=dotenv)${_nc}"
            set -a
            # shellcheck source=/dev/null
            source "$project_root/.env"
            set +a
            return 0
        else
            echo -e "${_red}SECRETS_PROVIDER=dotenv but no .env file found${_nc}"
            return 1
        fi
    fi

    # ── 1. Infisical CLI ──────────────────────────────────────────────
    if [ "$provider" = "auto" ] || [ "$provider" = "infisical" ]; then
    if command -v infisical &>/dev/null && [ -f "$project_root/scripts/vault.config" ]; then
        # Allow env override: INFISICAL_ENV=staging ./scripts/start_dev.sh
        local env_override="${INFISICAL_ENV:-}"
        # shellcheck source=/dev/null
        source "$project_root/scripts/vault.config"
        # Restore override if caller set it before vault.config
        [ -n "$env_override" ] && INFISICAL_ENV="$env_override"

        # Authenticate via REST API (same approach as the `vault` wrapper)
        local token
        token=$(curl -sf -X POST "${INFISICAL_DOMAIN}/api/v1/auth/universal-auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"clientId\":\"${INFISICAL_CLIENT_ID}\",\"clientSecret\":\"${INFISICAL_CLIENT_SECRET}\"}" \
            | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

        if [ -n "$token" ]; then
            local infisical_output
            infisical_output=$(infisical export \
                --token="$token" \
                --env="${INFISICAL_ENV:-dev}" \
                --projectId="${INFISICAL_PROJECT_ID:-}" \
                --domain="${INFISICAL_DOMAIN:-}" \
                --format=dotenv-export 2>/dev/null)

            if [ $? -eq 0 ] && [ -n "$infisical_output" ]; then
                echo -e "${_blue}Loading secrets from Infisical (${INFISICAL_ENV:-dev})${_nc}"
                set -a
                eval "$infisical_output"
                set +a
                loaded=true
                _env_source="infisical"
                echo -e "${_green}Secrets loaded from Infisical${_nc}"
            else
                echo -e "${_yellow}Infisical auth OK but export failed — falling back${_nc}"
            fi
        else
            echo -e "${_yellow}Infisical configured but auth failed — falling back${_nc}"
        fi
    fi
    fi

    # ── 2. Doppler CLI ────────────────────────────────────────────────
    if [ "$provider" = "auto" ] || [ "$provider" = "doppler" ]; then
    if [ "$loaded" = false ] && command -v doppler &>/dev/null; then
        if doppler configure debug &>/dev/null 2>&1; then
            local doppler_output
            doppler_output=$(doppler secrets download --no-file --format=env-no-quotes 2>/dev/null)

            if [ $? -eq 0 ] && [ -n "$doppler_output" ]; then
                echo -e "${_blue}Loading secrets from Doppler${_nc}"
                set -a
                eval "$doppler_output"
                set +a
                loaded=true
                _env_source="doppler"
                echo -e "${_green}Secrets loaded from Doppler${_nc}"
            else
                echo -e "${_yellow}Doppler configured but export failed — falling back${_nc}"
            fi
        fi
    fi
    fi

    # ── 2b. Explicit provider failed — don't silently fall back ─────
    if [ "$loaded" = false ] && [ "$provider" != "auto" ]; then
        echo -e "${_red}SECRETS_PROVIDER=$provider requested but failed${_nc}"
        return 1
    fi

    # ── 3. .env file ─────────────────────────────────────────────────
    if [ "$loaded" = false ] && [ -f "$project_root/.env" ]; then
        echo -e "${_blue}Loading environment from .env${_nc}"
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
        echo -e "${_red}No secrets provider found.${_nc}"
        echo -e "Options:"
        echo -e "  1. Copy .env.example to .env and fill in your values"
        echo -e "  2. Install Infisical CLI and configure scripts/vault.config"
        echo -e "  3. Install Doppler CLI and run 'doppler setup'"
        return 1
    fi

    return 0
}
