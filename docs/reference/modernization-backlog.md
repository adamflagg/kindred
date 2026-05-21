# Modernization Backlog

Reference audit of modern language/tooling features available to Kindred but not yet adopted. Generated from a comprehensive audit across Python, Go, TypeScript/React, and infrastructure layers.

**Status legend:** HIGH = real behavioral/robustness benefit, MEDIUM = readability/consistency win, LOW = polish / defer.

**Execution model:** Work this backlog one layer at a time (one PR per language/concept) rather than a single mega-PR. Each section governs its own execution order; there is no global cross-section ordering — pick which language to work on based on real-world signals (active PRs, blast radius, idle slot).

**Section lifecycle:** Open language sections start in single-table audit format (§1 Python, §3 Frontend today). On first execution loop they're restructured to §a/§b/§c per `modernization-prompts.md` Part A (concrete rewrites + honest survey-status + ranked execution order). Once every row has shipped or deferred, the section collapses to a closeout summary capturing wins / deferrals / retired false positives / surveyed-clean (§2 Go today). §4 (Infrastructure) is a hardening checklist — different artifact, no lifecycle.

**Companion docs:** Ship rows by following `modernization-prompts.md` (Part B for execution, Part A for re-running an audit). The prompt doc names the false-positive lesson explicitly — every grep hit must be inspected with surrounding context before it lands in §a. When the last open section migrates, the §a/§b/§c template moves out of this doc into `modernization-prompts.md` as an appendix.

---

## 0. Cross-cutting fixes (originating PR #972 + follow-ups)

Shipped in originating PR #972 (Apr 2026):

- **`CLAUDE.md` language versions** — `Python 3.12+, Go 1.24+` → `Python 3.14+, Go 1.26+` (matches `.python-version` and `pocketbase/go.mod`)
- **`README.md`** — rewritten to include Camp Analytics (metrics module), architecture diagram, Python 3.14 / Go 1.26 pins, production-deployment note about Traefik/CrowdSec fronting Caddy
- **`ruff.toml`** — `target-version = "py312"` → `"py314"` (intended to defer but landed in #972 itself)

Shipped in follow-up PRs:

- **`ortools` PyPI switch** — PR #1038 moved `pyproject.toml:37` from the GitHub-release URL pin back to `ortools>=9.15`. PyPI now publishes cp314 wheels for `9.15.6755` (macOS/Linux/Windows), so the pin is healthy. Re-survey on the next ortools major bump.

### Still outstanding

**Bundle: "Tell our tools we're on Python 3.14"** — `ruff` is already bumped (above). The two remaining bundle items remain unshipped; both files are absent from the repo today (`ls .coderabbit.yaml AGENTS.md` → not found):

1. **Add `.coderabbit.yaml` with Python-version `path_instructions`** — CodeRabbit's LLM keeps flagging modern 3.14 syntax (PEP 758 `except A, B:` without parens, PEP 649 bare annotations, PEP 695 generic syntax, `dict[str, X]` generics, `typing.TypeIs`, `asyncio.TaskGroup`) as Python 2.x errors. The right fix is a `reviews.path_instructions` block scoped to `**/*.py` that names the codebase's Python floor and the specific PEPs not to flag (20k-char budget per entry; safer than burying the note in CLAUDE.md). Schema: `docs.coderabbit.ai/reference/configuration` → `reviews.path_instructions`.
2. **Add `AGENTS.md` at repo root** — CodeRabbit auto-scans `**/AGENTS.md` via `knowledge_base.code_guidelines` (alongside `**/CLAUDE.md`, `.cursorrules`, `.windsurfrules`, etc.). AGENTS.md is the cross-agent convention — same Python-version note benefits Codex, Cursor, Copilot, and future agents. Companion to #1, not a replacement: `.coderabbit.yaml` is review-scoped and harder for the reviewer model to overlook; AGENTS.md is the durable cross-agent home for the same facts.

---

## 1. Python (project is on 3.14)

> **Format note:** This section predates the §2 redo (toolchain/idiom-floor preamble + §a/§b/§c). Migrate to the new format on the next pickup — re-run `modernization-prompts.md` Part A in upgrade-in-place mode.

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
| **LOW** | Enable ruff `PLC0415` (import-outside-toplevel) | repo-wide; surfaced by PR #1529 review (`test_analyze_objective_sensitivity.py` had `import pytest` inside a test body) | 1 known | Catches imports inside function bodies. Currently not in `ruff.toml`'s enabled rules. Likely a handful of pre-existing offenders to clean up before enabling. |

### Not applicable / already adopted

- `Union[X, Y]` → `X \| Y` — no `Union` imports found ✓
- `Dict`/`List`/`Tuple` from typing — only in docstrings/comments ✓
- `datetime.UTC` — already used in 17+ files ✓
- `tomllib` — no TOML parsing in the codebase ✓
- PEP 750 t-strings — no SQL/HTML template builders that would benefit
- `compression.zstd` — no zstandard dependency
- Pydantic v1 legacy patterns — none found ✓

### Recommended Python PR order

1. ~~`chore(ci): ruff target-version py314`~~ — ✓ shipped in originating PR #972
2. `chore(py): drop redundant __future__ annotations import` — mechanical, repo-wide
3. `refactor(api): adopt asyncio.TaskGroup in metrics services` — focused, ~35 callsites, behavioral improvement
4. `refactor(api): use itertools.batched for chunking` — 11 callsites
5. `refactor(api): convert isinstance chains to match` — small, optional

---

## 2. Go — closed at 1.26 (May 2026)

**Toolchain at closeout:** Go 1.26.3 (toolchain pin `go 1.26.0`).
**Idiom level pre-audit:** pre-1.18 (`interface{}` everywhere, `sort.*`, no `slices`/`maps`/`cmp`).
**Idiom level post-audit:** through 1.25 except deferred row below.
**Next-audit floor:** features added in Go 1.27+. Don't re-survey 1.18–1.26 — outcomes captured below.

### Shipped

10 PRs landed 14 distinct rewrites across the sync layer and supporting packages:

| PR | Rewrite | Scope |
|---|---|---|
| #1066 | `clear()` builtin + `sort.{Slice,Strings,Ints}` → `slices.{SortFunc,Sort}` (drops `"sort"` import) | `sync/`, `rbac/` |
| #1070 | `min`/`max` builtins + `cmp.Or` | `sync/`, `ratelimit/` |
| #1071 | `interface{}` → `any` (744 sites, single `gofmt -r` codemod) | repo-wide |
| #1074 | `log/slog` consolidation (drops `log.Printf` alongside `slog`) | `campminder/` |
| #1075 | manual chunkers → `slices.Chunk` (6 sites; deleted `splitIntoBatches` helper) | `sync/` |
| #1076 | `for i := 0; …` → `for i := range s` (closure-capture safety) | `sync/`, `ratelimit/`, tests |
| #1562 | `fmt.Sprintf` inside `slog.*` → structured key/value attrs | `sync/` |
| #1564 | `time.After` → reused `time.NewTimer` in retry loop | `sync/rate_limited_sheets_writer.go` |
| #1565 | `strings.Contains(err.Error(), ...)` → sentinel errors + `errors.Is`/`errors.As` | `sync/scheduler.go` + tests |
| #1566 | `testing/synctest` for time-based tests | `sync/`, `rbac/` |

### Deferred

- **`encoding/json/v2`** — still `GOEXPERIMENT=jsonv2`-gated in Go 1.26.3; package doc explicitly says *"not subject to the Go 1 compatibility promise … Most users should use `encoding/json`."* Hot path is `pocketbase/campminder/client.go` (32 callsites today; ~71 total across 15 files). Re-evaluate when v2 lands as GA stdlib (likely Go 1.27 or 1.28), not on ecosystem-signal alone. The original doc claim that "1.25 has shipped" implying GA was wrong.

### Retired as false positives (calibration for future audits)

These survived the regex pass to the brief stage before being killed. Worth remembering because the same regexes will keep matching:

| Pattern | Where | Why it failed |
|---|---|---|
| `strings.Index(x, y) != -1` → `strings.Contains` | `sync/base_sync.go:1084` | `idx` used as slice boundary (`result[:idx] + result[endIdx:]`); `Contains` discards the offset that the next 7 lines need. **Lesson: inspect surrounding lines, not just the predicate.** |
| `append(x, y...)` → `slices.Concat` | `multi_workbook_ordering.go:39`, `persons.go:1429`, `campminder/client.go:1020` | 2 of 3 hits are loop accumulators where `slices.Concat` allocates fresh on every iteration, losing `append`'s amortized growth. The 3rd is no clearer rewritten. **Lesson: filter `append(x, y...)` candidates for non-loop context.** |

In-bundle retired false positives (caught during execution, not surfaced as standalone retired rows): `min`/`max` candidates that were really early-return validators (`sheets_scheduling.go:60,63`, `persons.go:1029`), side-effecting `if` (`ratelimit.go:85`), error-size check (`feedback/handler.go:104`); `cmp.Or` candidates that were "if non-empty, do X" rather than first-non-zero fallbacks (`normalize_geographic.go:487`, `table_exporter.go:358`); `fmt.Sprintf` inside `slog` candidates that were literal `/12` denominators (`campminder/client.go:1116,1130`).

### Surveyed clean (no candidates / not applicable)

Grepped at audit time, yielded nothing worth shipping. Don't re-audit on a 1.27+ pass.

- **`math/rand/v2`** — already adopted in `sync/orchestrator.go`; `crypto/rand` used correctly elsewhere for jitter.
- **Range-over-func iterators (`for x := range fn`, 1.23)** — no callback-iteration patterns; `func(...) bool` only appeared as `sort.Slice` less-funcs (migrated in #1066).
- **Generic type aliases (1.24)** — no generic functions in the codebase (`func Foo[T ...]` returned 0 hits).
- **`os.Root` (1.24)** — all file ops use trusted internal paths (`s.App.DataDir()`, env-driven config); no untrusted-input candidates.
- **`context.WithoutCancel` / `context.AfterFunc` (1.21)** — no production patterns where a derived context outlives its parent.

### Drift / discoveries during execution (filed separately)

Modernization PRs surfaced unrelated pre-existing issues. Tracked for completeness:

- **#1072** — dead branch in `normalizeToStringSlice` (surfaced during #1071 `interface{}` codemod review)
- **#1078** — inconsistent batch sizes (50/100/500) across sync services (surfaced during #1075 `slices.Chunk` work)
- **#1079** — unbounded recursion in `campminder/client.go` `authenticate()` 429 retry (surfaced during #1074 slog consolidation; constant `maxRequestRetries` extracted in same PR)

### Process lessons (carried into `modernization-prompts.md` Rules 1–3)

- **Inspect surrounding code, not just the regex** — see retired rows above.
- **`lll` lint required wrapping multi-attr slog calls** in #1076; caught only on CI because `golangci-lint` is not in `lefthook pre-push`. Worth re-checking whether to move it into pre-push.
- **CodeRabbit flagged "bypasses logging contract" on #1562** — false positive; logging pkg installs default slog handler via `slog.SetDefault` and no `logging.Info` wrapper exists. Worth a `.coderabbit.yaml` `path_instructions` entry once that lands (see §0).

Survey scope: Go 1.18 through 1.26. Re-run Part A on a 1.27+ toolchain bump.

---

## 3. Frontend — React 19, TypeScript 5.8, Node 22

> **Format note:** This section predates the §2 redo (toolchain/idiom-floor preamble + §a/§b/§c). Migrate to the new format on the next pickup — re-run `modernization-prompts.md` Part A in upgrade-in-place mode.

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

> **Different artifact:** §4 is a hardening / CI gap checklist, not a language-version audit. The §a/§b/§c framing (idiom-floor, two-version columns, survey-status) does not apply — there is no compiler version, no idiom regression, no past-vs-modern axis to score against. Treat each item as a standalone task.

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

## Review cadence

Revisit this doc quarterly or when bumping a major language/framework version. Keep the "already adopted" lists in each section so future audits don't rediscover the same wins.
