# Modernization Backlog

Reference audit of modern language/tooling features available to Kindred but not yet adopted. Generated from a comprehensive audit across Python, Go, TypeScript/React, and infrastructure layers.

**Status legend:** HIGH = real behavioral/robustness benefit, MEDIUM = readability/consistency win, LOW = polish / defer.

**Execution model:** Work this backlog one layer at a time (one PR per language/concept) rather than a single mega-PR. Each section below is a candidate PR.

---

## 0. Fixed in the PR carrying this doc

- **`CLAUDE.md` language versions** — `Python 3.12+, Go 1.24+` → `Python 3.14+, Go 1.26+` (matches `.python-version` and `pocketbase/go.mod`)
- **`README.md`** — rewritten to include Camp Analytics (metrics module), architecture diagram, Python 3.14 / Go 1.26 pins, production-deployment note about Traefik/CrowdSec fronting Caddy

### Deferred to its own PR

- **`ruff.toml:21`** — `target-version` is still `py312` despite `pyproject.toml` requiring `>=3.14`. Bumping to `py314` activates rules (UP037 quoted annotations, UP043 unnecessary `Generator[..., None, None]` defaults) that fire on ~30+ existing test files. This should be done as **the first follow-up PR** (bump + `ruff check --fix` in one commit). Kept separate so the docs PR stays docs-only.

### Outstanding quick check

- **`ortools` on PyPI** — `9.15.6755` is published with wheels for cp310–cp313 only. **No cp314 wheel yet.** The GitHub-release URL pin in `pyproject.toml:37` is correct; revisit monthly. Switch back to `ortools>=9.15` on PyPI once Google publishes cp314 wheels.

---

## 1. Python (project is on 3.14)

Baseline is strong: Pydantic v2 everywhere, `datetime.UTC` adopted, modern generics (`dict[str, X]`), f-strings clean, mypy `strict = true`. The real gaps are concurrency idioms and version-specific polish.

| Impact | Feature | Where | Count | Notes |
|--------|---------|-------|-------|-------|
| **HIGH** | `asyncio.TaskGroup` replacing `asyncio.gather` | `api/services/` — `geo_service.py`, `drilldown_service.py`, `forecast_service.py`, `historical_service.py`, `session_availability_service.py`, `validation.py`, `batch_processor.py` | ~35 callsites | Real robustness win: TaskGroup aggregates exceptions via ExceptionGroup instead of silently dropping sibling tasks on partial failure. Pattern change, not mechanical. |
| **HIGH** | Drop `from __future__ import annotations` | repo-wide | ~250 files | PEP 649 makes deferred annotation evaluation the default in 3.14 — the import is dead weight. Fully mechanical (regex + ruff autofix). |
| **MEDIUM** | `itertools.batched` replacing `range(0, len(x), n)` chunking | `validation.py:185`, `batch_processor.py`, `metrics_repository.py`, `geo_service.py`, `data_fetcher.py`, `drilldown_service.py`, `optimized_graph_builder.py`, `debug_parse_repository.py` | 11 | 3.12+. Drops the manual index arithmetic. |
| **MEDIUM** | `match` statement for isinstance chains | `debug.py:188`, `requests.py`, `session_availability.py`, `metrics_repository.py` | ~15–20 | Readability only. Target chains with >2 branches. |
| **LOW** | Residual `Optional[X]` → `X \| None` | `tests/test_ranked_candidate_passthrough.py:65,67` | 3 | Mostly already modernized — last few leftovers. |
| **LOW** | `@override` decorator (from `typing`) | (unused) | 0 | Catches rename bugs in overrides. 3.12+. |
| **LOW** | PEP 695 generic syntax (`def foo[T](x: T)`) | `phase3_disambiguation_service.py:6,20` | 1 | Single TypeVar in the codebase — not worth a campaign on its own. |
| **LOW** | `@dataclass(slots=True, kw_only=True, frozen=True)` defaults | 41 `@dataclass` files | — | Mostly small DTOs, not hot paths. Apply opportunistically. |
| **LOW** | `typing.TypeIs` (replaces `TypeGuard`) / `typing.ReadOnly` TypedDict fields | `geo_normalizer/normalizer.py:20` for ReadOnly; no `TypeGuard` in codebase | 1 | 3.13+. Low leverage here. |
| **LOW** | `copy.replace()` | (unused; no `dataclasses.replace` callsites either) | 0 | 3.13+. No current use case. |

### Not applicable / already adopted

- `Union[X, Y]` → `X \| Y` — no `Union` imports found ✓
- `Dict`/`List`/`Tuple` from typing — only in docstrings/comments ✓
- `datetime.UTC` — already used in 17+ files ✓
- `tomllib` — no TOML parsing in the codebase ✓
- PEP 750 t-strings — no SQL/HTML template builders that would benefit
- `compression.zstd` — no zstandard dependency
- Pydantic v1 legacy patterns — none found ✓

### Recommended Python PR order

1. `chore(ci): ruff target-version py314` — already in this PR
2. `chore(py): drop redundant __future__ annotations import` — mechanical, repo-wide
3. `refactor(api): adopt asyncio.TaskGroup in metrics services` — focused, ~35 callsites, behavioral improvement
4. `refactor(api): use itertools.batched for chunking` — 11 callsites
5. `refactor(api): convert isinstance chains to match` — small, optional

---

## 2. Go (project is on 1.26)

Baseline is excellent: 784 `slog` uses, 395 `fmt.Errorf("%w", ...)` wrappings, no `ioutil`. The dominant gap is an `interface{}` → `any` codemod the codebase never got.

| Impact | Feature | Where | Count | Notes |
|--------|---------|-------|-------|-------|
| **HIGH** | `interface{}` → `any` | `sync/api.go` (108 occurrences), `sync/base_sync.go` (42), `sync/households.go` (35+), widespread | **744** | Single mechanical pass. Alias since Go 1.18. |
| **HIGH** | `map[string]interface{}` → `map[string]any` | same hotspots | **603** | Same PR as the `any` codemod. |
| **HIGH** | `fmt.Sprintf` inside `slog` call sites | `campminder/client.go:1008`, `sync/financial_transactions.go:106`, `sync/orchestrator.go:784,844` | 4 | Defeats structured logging — pass raw values as key/value attrs instead. |
| **HIGH** | String-based error matching | `sync/rate_limited_sheets_writer.go` (`strings.Contains(err.Error(), "googleapi: Error 429")`), `sync/scheduler_test.go`, `workbook_manager_test.go`, `orchestrator_test.go` | 4 | Define sentinel errors (e.g. `ErrRateLimited`) and use `errors.Is` / `errors.As`. The Google 429 detection is the production-impact one. |
| **MEDIUM** | `sort.Slice` → `slices.SortFunc` (Go 1.21) | `sync/normalize_geographic_test.go`, `sync/workbook_manager.go`, `sync/multi_workbook_ordering.go` (2×) | 3 | |
| **MEDIUM** | `sort.Strings` → `slices.Sort` (Go 1.21) | `rbac/hooks.go`, `sync/base_sync.go` (2×), `sync/multi_workbook_ordering.go` (2×), `sync/table_exporter.go` | 6 | |
| **MEDIUM** | Classic `for i := 0; i < len(...)` → `for i := range slice` (Go 1.22) | `sync/households.go`, `sync/staff_skills.go`, `sync/session_resolver.go`, `sync/sessions.go`, `sync/camper_history.go`, `sync/rate_limited_sheets_writer.go`, test files | 26 | Not all applicable — some use custom increments (`i += batchSize`) that still need the classic form. |
| **MEDIUM** | Manual map-clear loop → `clear()` builtin (Go 1.21) | `sync/base_sync.go:122–125, 130–133` (`ClearProcessedKeys`, `ClearFieldDiffStats`) | 2 | Trivial. |
| **LOW** | Mixed `log` + `log/slog` in one file | `campminder/client.go:11` (`log.Printf` for rate-limit warnings alongside `slog`) | 1 file | Consolidate on `slog`. |
| **LOW** | `strings.Index() != -1` anti-pattern | `sync/base_sync.go` | 1 | Use `strings.Contains`. |
| **?** | `time.After` in retry loop | `sync/rate_limited_sheets_writer.go:194` | 1 | Creates a new timer per retry — fine in practice unless the loop becomes hot. |

### Unexplored / no concrete opportunities identified

- Go 1.23 range-over-func iterators — no strong candidates surfaced in the audit
- Go 1.24 generic type aliases — no existing generic patterns that would benefit
- `context.WithoutCancel` / `context.AfterFunc` — only `WithCancel` in tests, production context propagation looks fine

### Recommended Go PR order

1. `refactor(pb): interface{} → any codemod` — single bulk PR, ~1,347 replacements, purely mechanical
2. `fix(sync): replace string-based error matching with sentinel errors` — behavioral (Google 429 detection), smaller PR
3. `refactor(sync): use slices package helpers and clear() builtin` — bundle the Medium items together
4. `chore(logging): consolidate campminder client on slog` — small cleanup

---

## 3. Frontend — React 19, TypeScript 5.8, Node 22

`tsconfig.json` is already modern (ES2022, bundler resolution, `verbatimModuleSyntax`, `noImplicitOverride`, `erasableSyntaxOnly`). The misses are idiomatic — code predating React 19 and ES2023 adoption.

| Impact | Feature | Where | Count | Notes |
|--------|---------|-------|-------|-------|
| **HIGH** | `Array.prototype.toSorted()` vs `[...arr].sort()` | 24 files incl. `StaffCabinAnalysisPage.tsx`, `utils/retentionTransforms.ts:36`, `components/SessionList.tsx`, `utils/enrollmentSort.test.ts` | 24 | ES2023. Cheapest win. |
| **HIGH** | React 19 `use()` hook for contexts | 9 context files + 100+ `useContext` consumers (`AuthContext`, `ProgramContext`, `ScenarioContext`, `LockGroupContext`, etc.) | 100+ | Eliminates the "`useX()` wrapper that throws on missing provider" pattern. |
| **HIGH** | React Query v5: `queryOptions`, `skipToken`, `useSuspenseQuery`, `combine` | 30+ `useQuery`, 20+ `useMutation` callsites; none use these | 50+ | `queryOptions` gives type-safe shared query definitions; `skipToken` replaces conditional `enabled` logic. |
| **HIGH** | Error cause chaining (`new Error(msg, { cause })`) | 140+ `throw` statements; only `hooks/session/useCamperMovement.ts` uses `cause` | 139 | Much better stack-trace fidelity when wrapping API errors. |
| **MEDIUM** | `<Context.Provider>` → `<Context>` shorthand (React 19) | 25 providers | 25 | Cosmetic but clean. |
| **MEDIUM** | `satisfies` operator | 4 files use it (velocity/cancellation pages); ~1,800 `as const` sites don't | 1,800 | Don't convert blindly — target config objects and route/feature maps where shape matters. |
| **MEDIUM** | `Object.groupBy()` (ES2024) | `components/LockGroupPanel.tsx`, `contexts/LockGroupContext.tsx`, `providers/BunkRequestProvider.tsx:57` | 5–8 | Replaces manual `reduce((acc, x) => ...)` groupBy patterns. |
| **MEDIUM** | `React.lazy` + `Suspense` for large modals | Only `RightPanelContainer.tsx` and `BunkingBoardByArea.tsx` currently lazy-load. Candidates: `MetricsLayout`, `CamperDetailsPanel`, `RequestReviewPanel`, scenario comparison modals | 5–10 candidates | Direct bundle-size impact on the initial load. |
| **MEDIUM** | `readonly` modifiers on Record/interfaces | 9 files use `readonly`; ~240 type definitions (cache/store shapes, API response types) don't | 240 | Prevents accidental mutations. Apply to types that represent persisted / cached shape. |
| **LOW** | React 19 `useActionState` / `useFormStatus` | 150+ `useState` sites for form submission state | 150 | Only worth doing if adopting Server Actions pattern broadly. |
| **LOW** | `findLast` / `findLastIndex`, `structuredClone`, Temporal, `Intl.Segmenter`, regex `v` flag | — | — | No clear use cases surfaced. |
| **?** | Tailwind 4 migration | `frontend/package.json` | — | Confirm current version; Tailwind 4 (2025) ships the Oxide engine + CSS-first config, but it's a real migration, not a drop-in. |

### Recommended frontend PR order

1. `refactor(frontend): Array.toSorted + Object.groupBy` — 24 + 5–8 callsites, mechanical, great cleanup
2. `refactor(frontend): error cause chaining on API/service throws` — behavioral (debugging quality)
3. `refactor(frontend): adopt React 19 use() for contexts` — larger touch, own PR
4. `refactor(frontend): React Query queryOptions + skipToken` — affects hook shapes, own PR
5. `perf(frontend): lazy-load large modals` — bundle-size focus, own PR
6. `refactor(frontend): readonly on cache/store types` — type-level only, low-risk
7. Separate investigation: Tailwind 4 upgrade feasibility

---

## 4. Infrastructure + Caddy production hardening

Exceptional baseline: Chainguard/Wolfi + distroless final images, `COPY --link` + numeric `--chown`, healthchecks in every Dockerfile, concurrency groups in CI/CD, path-filtered rebuilds, Trivy scanning, `uv` with `[dependency-groups]` (PEP 735), commitlint, git-cliff.

### 4a. Caddy hardening (production priority)

**Context:** In production, Kindred is deployed behind Traefik + CrowdSec. Those handle TLS, rate limiting, bot/WAF rules, CORS, and IP reputation. Caddy's role is reduced to internal routing — but it should still do the minimum to prevent internal misbehavior from causing problems (OOM from rogue uploads, socket exhaustion from hung upstreams, missing access-log trail when debugging multi-container issues).

**Current state:** Both `docker/Caddyfile` and `frontend/Caddyfile` are minimal reverse proxies — no timeouts, body-size caps, security headers, or access logs.

**Minimum hardened Caddy config (safe behind Traefik/CrowdSec):**

```caddyfile
{
    admin localhost:2019
    timeouts {
        request_read 30s
        request_body 30s
    }
    log {
        format json { time_format iso8601 }
        level INFO
    }
}

:{$CADDY_PORT:8080} {
    # Defense-in-depth headers (Traefik can still override at the edge)
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "interest-cohort=()"
        -Server
    }

    # Request body cap — tune to max upload (CSVs, photos, etc.)
    request_body {
        max_size 50MB
    }

    # Access log (JSON, stdout → Docker log driver)
    log {
        format json
        output stdout
    }

    # ... existing handle blocks (PocketBase routing, /api, static) ...

    handle /api/internal/* {
        respond 403
    }

    handle {
        root * /pb_public
        try_files {path} /index.html
        file_server {
            precompressed br gzip
        }
    }
}
```

**Edge responsibilities (keep at Traefik/CrowdSec):** TLS termination, HSTS, rate limiting, bot detection, WAF rules, CORS policy, IP reputation, access log shipping.

### 4b. Other infrastructure gaps

| Impact | Finding | File | Fix |
|--------|---------|------|-----|
| **HIGH** | `kindred-caddy` isn't rebuilt/pushed on every CD run — only during release promotion | `.github/workflows/cd.yml` (around line 412) | Add `kindred-caddy` to `IMAGES[]` and `docker/Dockerfile.caddy` to `DOCKERFILES[]` so security patches ship with every merge to main |
| **MEDIUM** | Release workflow has no `concurrency:` group | `.github/workflows/release.yml` | Add `concurrency: { group: release, cancel-in-progress: false }` so two manual dispatches can't race |
| **MEDIUM** | `pytest-xdist` not enabled | `pyproject.toml` | Add `pytest-xdist` to dev group + `-n auto` in addopts → ~3–4× CI speedup |
| **MEDIUM** | CodeQL (SAST) not enabled | `.github/workflows/` | Add `codeql.yml` for Python + JavaScript |
| **LOW** | GitHub Dependency Review not gating PRs | `ci.yml` | Complements Dependabot by blocking vulnerable deps at PR time |
| **LOW** | No ARM64 multi-arch builds | `cd.yml` | Only matters if deploying to Pi / Apple Silicon |
| **LOW** | Caddy base image unpinned (`dhi.io/caddy:2`) | `docker/Dockerfile.caddy` | Pin to minor (e.g. `:2.8`) |
| **LOW** | No SBOM/provenance attestation, no cosign image signing | `cd.yml` | Supply-chain nice-to-have |

### Already adopted (no action)

- `COPY --link` used across all Dockerfiles ✓
- `HEALTHCHECK` in every Dockerfile ✓
- Multi-stage builds in all 4 Dockerfiles ✓
- Wolfi/distroless final images (api on `chainguard/wolfi-base`, pocketbase + caddy on `chainguard/static`) ✓
- Concurrency groups on CI and CD ✓
- Path filters in CD PR validation ✓
- Least-privilege `permissions: contents: read` on CI ✓
- Trivy scanning with weekly schedule + SARIF upload ✓
- `uv` + PEP 735 `[dependency-groups]` ✓
- mypy `strict = true` ✓
- Ruff as single linter (no black/autopep8 conflict) ✓
- commitlint enforced on PRs ✓
- git-cliff changelog in release workflow ✓
- Gitleaks secret scanning in CI ✓

### Recommended infrastructure PR order

1. `fix(ci): add caddy to CD build+push pipeline` + `build(docker): pin caddy base image` — combined, ships Caddy patches continuously
2. `build(caddy): minimum hardened config behind Traefik` — the config block above, applied to both Caddyfiles
3. `ci: add release workflow concurrency group`
4. `perf(ci): enable pytest-xdist`
5. `ci: add CodeQL + dependency-review workflows`
6. Optional: ARM64 multi-arch, SBOM/cosign — only if there's a concrete driver

---

## Suggested overall PR order

One PR per row, roughly in this sequence:

1. **This PR** — `chore(docs): comprehensive modernization backlog + README overhaul` (ships with `CLAUDE.md` pin fixes)
2. `chore(ci): ruff target-version py314 + autofix UP037/UP043 cascade`
3. `chore(py): drop redundant __future__ annotations import`
4. `refactor(pb): interface{} → any codemod`
4. `refactor(api): adopt asyncio.TaskGroup in metrics services`
5. `fix(sync): replace string-based error matching with sentinel errors`
6. `refactor(frontend): Array.toSorted + Object.groupBy`
7. `refactor(frontend): error cause chaining`
8. `fix(ci): rebuild caddy on every CD run + pin base image`
9. `build(caddy): minimum hardened production config`
10. `refactor(api): itertools.batched for chunking`
11. `refactor(pb): slices package helpers + clear() builtin`
12. `refactor(frontend): adopt React 19 use() for contexts`
13. `refactor(frontend): React Query queryOptions + skipToken`
14. `perf(frontend): lazy-load large modals`
15. `perf(ci): enable pytest-xdist`
16. `ci: add CodeQL + dependency-review`
17. Remaining LOW items opportunistically

---

## Review cadence

Revisit this doc quarterly or when bumping a major language/framework version. Keep the "already adopted" lists in each section so future audits don't rediscover the same wins.
