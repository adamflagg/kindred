# api/

FastAPI HTTP layer over `bunking/`. Thin shell — routers parse input, call into `bunking/`, return shape.

## Layout

| Dir | Purpose |
|-----|---------|
| `routers/` | One file per logical area (solver, scenarios, social_graph, satisfaction, requests, metrics, validation, geo, debug, internal) |
| `schemas/` | Pydantic request/response models |
| `utils/` | Small router helpers |
| `main.py` | App setup + global exception handler |

## Business logic belongs in `bunking/`, not here

Routers should be thin. If a router accumulates logic, extract to `bunking/` and have the router call back in. See `bunking/CLAUDE.md`.

## Global exception handler

`api/main.py` registers a handler that catches unhandled exceptions and returns:

```json
{"detail": "Internal server error"}
```

(generic message — never the actual error). Full traceback is logged server-side with `exc_info=True`.

**Never use `raise HTTPException(status_code=500, detail=str(e))`** — that leaks internals to clients. Let the global handler catch it.

## Routing

Caddy uses an **inverse routing pattern**: specific PocketBase paths (`/api/collections/*`, `/api/files/*`, `/api/realtime`, `/api/custom/*`, `/api/oauth2-redirect`) go to PocketBase; everything else under `/api/*` goes to FastAPI. New FastAPI endpoints automatically work — no Caddy enumeration needed.

Config: `docker/Caddyfile` (prod), `frontend/Caddyfile` (dev).

## Auth

`bunking/auth_middleware.py` + `bunking/jwt_auth.py` verify PocketBase JWTs. Frontend must use `fetchWithAuth` (not raw `fetch`) — the JWT lives in localStorage, not cookies. Protected endpoints must verify auth or they silently 401.

## Conventions

Same Python conventions as `bunking/` — Python 3.14+, mypy strict, line length 120, `bunking.logging_config` (tag this surface as `[api]`). Tests: `tests/integration/` for router tests, `tests/unit/` for schema tests.
