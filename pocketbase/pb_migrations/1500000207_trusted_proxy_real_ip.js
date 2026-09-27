/// <reference path="../pb_data/types.d.ts" />
/**
 * Trust Caddy's X-Real-IP for the client address (admin audit log, spec §5 `ip`).
 *
 * PocketBase's RequestEvent.RealIP() reads settings.trustedProxy.headers and
 * otherwise returns the TCP peer -- in production that is always the Caddy
 * container, so every audit entry, PocketBase log line and rate-limit bucket
 * would carry Caddy's address. docker/Caddyfile and frontend/Caddyfile now set
 * `header_up X-Real-IP {client_ip}` on every PocketBase route: {client_ip} is
 * Caddy's own resolution (CF-Connecting-IP first, then X-Forwarded-For through
 * trusted private-range proxies, kindred#2835), the same value its IP gates
 * use, and header_up REPLACES any X-Real-IP a client sent, so it cannot be
 * forged through Caddy.
 *
 * PocketBase is reachable only through Caddy and the internal Docker network;
 * a request that reaches it directly (FastAPI, init) carries no X-Real-IP and
 * falls back to the peer address, which is correct for those callers.
 * useLeftmostIP stays false: the header holds exactly one address.
 *
 * rbac/trusted_proxy_booted_test.go asserts the booted value.
 */

migrate((app) => {
  const settings = app.settings();
  settings.trustedProxy.headers = ["X-Real-IP"];
  settings.trustedProxy.useLeftmostIP = false;
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.trustedProxy.headers = [];
  settings.trustedProxy.useLeftmostIP = false;
  app.save(settings);
});
