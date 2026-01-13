# Infisical + GitHub Actions Integration

## Overview

Infisical syncs secrets to GitHub Actions in two ways:
1. **Native sync** - Automatically push secrets to GitHub Secrets
2. **Runtime injection** - Use `infisical-action` to inject at workflow runtime

## Option 1: Native GitHub Secrets Sync (Recommended for Cloud)

This automatically syncs Infisical secrets to GitHub Secrets. Best for simplicity with Infisical Cloud.

### Setup in Infisical Dashboard

1. Go to your project → **Integrations** → **GitHub**
2. Authorize the GitHub App
3. Select your repository
4. Map environments:
   - Infisical `prod` → GitHub Environment `production`
   - Infisical `dev` → GitHub Environment `development` (optional)
5. Select which secrets to sync (or sync all)

Secrets are now automatically pushed to GitHub whenever they change in Infisical.

### Use in Workflows

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # Uses secrets synced from Infisical
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        env:
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
          OIDC_CLIENT_SECRET: ${{ secrets.OIDC_CLIENT_SECRET }}
        run: |
          # Secrets are available as env vars
          ./deploy.sh
```

## Option 2: Runtime Injection via Action (Recommended for Self-Hosted)

Fetch secrets at workflow runtime. Better for self-hosted instances.

### Setup

1. In Infisical: Create a **Machine Identity** for CI/CD
   - Go to **Access Control** → **Machine Identities**
   - Create identity with access to your project
   - Copy the **Client ID** and **Client Secret**

2. In GitHub: Add these as repository secrets
   - `INFISICAL_DOMAIN` - Your Infisical instance URL (e.g., `https://vault.example.com`)
   - `INFISICAL_CLIENT_ID` - Machine identity client ID
   - `INFISICAL_CLIENT_SECRET` - Machine identity client secret

### Use in Workflows

```yaml
# .github/workflows/build.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Import secrets from Infisical
        uses: Infisical/secrets-action@v1
        with:
          client-id: ${{ secrets.INFISICAL_CLIENT_ID }}
          client-secret: ${{ secrets.INFISICAL_CLIENT_SECRET }}
          domain: ${{ secrets.INFISICAL_DOMAIN }}
          project-slug: kindred
          env-slug: prod
          # Optional: export specific secrets
          # secret-path: /
          # export-type: env  # or 'file' to create .env

      - name: Build
        run: |
          # All secrets now available as env vars
          echo "Using AI provider: $AI_PROVIDER"
          docker compose build
```

### Export to .env File

```yaml
- name: Import secrets to .env file
  uses: Infisical/secrets-action@v1
  with:
    client-id: ${{ secrets.INFISICAL_CLIENT_ID }}
    client-secret: ${{ secrets.INFISICAL_CLIENT_SECRET }}
    domain: ${{ secrets.INFISICAL_DOMAIN }}
    project-slug: kindred
    env-slug: prod
    export-type: file
    file-path: .env
```

## Recommended Setup for Self-Hosted Infisical

1. **Use Runtime Injection (Option 2)** - Works better with self-hosted
2. **Create Machine Identity** in Infisical for GitHub
3. **Store 3 secrets in GitHub**:
   - `INFISICAL_DOMAIN` - Your vault URL
   - `INFISICAL_CLIENT_ID`
   - `INFISICAL_CLIENT_SECRET`
4. **All other secrets live in Infisical** - single source of truth

### Updated CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Import secrets
        uses: Infisical/secrets-action@v1
        with:
          client-id: ${{ secrets.INFISICAL_CLIENT_ID }}
          client-secret: ${{ secrets.INFISICAL_CLIENT_SECRET }}
          domain: ${{ secrets.INFISICAL_DOMAIN }}
          project-slug: kindred
          env-slug: dev

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Run tests
        run: |
          pip install -r requirements.txt
          pytest tests/
```

## Environment Mapping

| Infisical Env | GitHub Environment | Use Case |
|---------------|-------------------|----------|
| `dev` | development | CI tests, PR checks |
| `staging` | staging | Pre-production testing |
| `prod` | production | Deployments, releases |

## Secrets to Store in Infisical

### Required (Production)
- `CAMPMINDER_API_KEY`
- `CAMPMINDER_PRIMARY_KEY`
- `CAMPMINDER_SECONDARY_KEY`
- `CAMPMINDER_CLIENT_ID`
- `POCKETBASE_ADMIN_EMAIL`
- `POCKETBASE_ADMIN_PASSWORD`
- `AI_API_KEY`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `SESSION_SECRET`

### Configuration (can vary by environment)
- `AI_PROVIDER` (openai)
- `AI_MODEL` (gpt-4.1-nano for prod, maybe gpt-4-turbo for dev)
- `AUTH_MODE` (production for prod, bypass for dev)
- `CAMPMINDER_SEASON_ID` (2025)
- `API_LOG_LEVEL` (INFO for prod, DEBUG for dev)
