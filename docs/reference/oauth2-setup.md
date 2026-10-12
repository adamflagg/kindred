# OAuth2 Configuration

> Referenced from `CLAUDE.md` → Critical Rules → Secrets, Privacy & Test Data.

PocketBase OAuth2 uses **OIDC auto-discovery** - set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `.env` (see `.env.example`). Endpoints auto-discovered from `{OIDC_ISSUER}/.well-known/openid-configuration`. Works with any OIDC provider (Pocket ID, Authentik, Auth0, Keycloak, etc.).

For CLI API testing with auth tokens, see `/docs/reference/cli-commands.md`.

## Back-channel logout (disabled users lose access)

PocketBase asks the provider about a user only at a full sign-in, and the app refreshes its own
token on every load, so a user disabled at the provider would otherwise keep their session.
PocketBase therefore serves an [OIDC Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html)
endpoint at `/api/custom/auth/backchannel-logout` (`pocketbase/oidclogout`). Set the OIDC
client's back-channel logout URL at the provider to `<your dashboard origin>/api/custom/auth/backchannel-logout`.

- **Configuration:** the PocketBase container needs `OIDC_ISSUER`; the client id comes from the
  users collection's `oidc` provider. Without either the endpoint answers 404.
- **What it does:** verifies the logout token (signature against the provider's JWKS, `iss`,
  `aud`, `iat` within five minutes, the logout `events` member, no `nonce`, an unused `jti`),
  then rotates the linked user's `tokenKey`. Every token PocketBase issued them stops working
  (FastAPI caches a validated token for up to 60 seconds). The user record is kept.
- **What triggers it** is the provider's choice. Pocket ID sends one when an admin disables or
  deletes a user, when a user revokes the app, and when a user loses group access to a
  group-restricted client. Removing a user from the admin group on a client that is not
  group-restricted sends nothing; `is_admin` re-syncs at their next full sign-in.
- Tokens that carry only `sid` are refused: Kindred's sessions are PocketBase tokens, which
  know nothing of provider sessions.
