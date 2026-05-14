# OAuth2 Configuration

> Referenced from `CLAUDE.md` → Critical Rules → Secrets, Privacy & Test Data.

PocketBase OAuth2 uses **OIDC auto-discovery** - set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `.env` (see `.env.example`). Endpoints auto-discovered from `{OIDC_ISSUER}/.well-known/openid-configuration`. Works with any OIDC provider (Pocket ID, Authentik, Auth0, Keycloak, etc.).

For CLI API testing with auth tokens, see `/docs/reference/cli-commands.md`.
