# Modernization Backlog

Reference audit of modern language/tooling features available to Kindred but not yet adopted. Generated from a comprehensive audit across Python, Go, TypeScript/React, and infrastructure layers.

**Status legend:** HIGH = real behavioral/robustness benefit, MEDIUM = readability/consistency win, LOW = polish / defer.

**Execution model:** Work this backlog one layer at a time (one PR per language/concept) rather than a single mega-PR. Each section governs its own execution order; there is no global cross-section ordering — pick which language to work on based on real-world signals (active PRs, blast radius, idle slot).

**Section format:** §2 (Go) was rewritten to a §a/§b/§c structure (concrete rewrites with two version columns, honest survey-status table, ranked execution order). §1 (Python), §3 (Frontend), and §4 (Infrastructure) are still in the older single-table format and will be migrated when each section is next picked up — see `modernization-prompts.md` Part A. **§4 is a hardening checklist, not a language-version audit; the §a/§b/§c structure does not apply.**

**Companion docs:** Ship rows by following `modernization-prompts.md` (Part B for execution, Part A for re-running an audit). The prompt doc names the false-positive lesson explicitly — every grep hit must be inspected with surrounding context before it lands in §2a.

---

## 0. Fixed in the PR carrying this doc

- **`CLAUDE.md` language versions** — `Python 3.12+, Go 1.24+` → `Python 3.14+, Go 1.26+` (matches `.python-version` and `pocketbase/go.mod`)
- **`README.md`** — rewritten to include Camp Analytics (metrics module), architecture diagram, Python 3.14 / Go 1.26 pins, production-deployment note about Traefik/CrowdSec fronting Caddy

### Deferred to its own PR

**Bundle: "Tell our tools we're on Python 3.14"** — ship these three together as **the first follow-up PR**. All three address the same root cause (tools assuming an older Python and flagging valid 3.14 syntax as errors). Kept separate from the docs PR so it stays docs-only.

1. **`ruff.toml:21`** — `target-version` is still `py312` despite `pyproject.toml` requiring `>=3.14`. Bumping to `py314` activates rules (UP037 quoted annotations, UP043 unnecessary `Generator[..., None, None]` defaults) that fire on ~30+ existing test files. Do bump + `ruff check --fix` in one commit.
2. **Add `.coderabbit.yaml` with Python-version `path_instructions`** — CodeRabbit's LLM keeps flagging modern 3.14 syntax (PEP 758 `except A, B:` without parens, PEP 649 bare annotations, PEP 695 generic syntax, `dict[str, X]` generics, `typing.TypeIs`, `asyncio.TaskGroup`) as Python 2.x errors. The right fix is a `reviews.path_instructions` block scoped to `**/*.py` that names the codebase's Python floor and the specific PEPs not to flag (20k-char budget per entry; safer than burying the note in CLAUDE.md). Schema: `docs.coderabbit.ai/reference/configuration` → `reviews.path_instructions`.
3. **Add `AGENTS.md` at repo root** — CodeRabbit auto-scans `**/AGENTS.md` via `knowledge_base.code_guidelines` (alongside `**/CLAUDE.md`, `.cursorrules`, `.windsurfrules`, etc.). AGENTS.md is the cross-agent convention — same Python-version note benefits Codex, Cursor, Copilot, and future agents. The repo currently has neither file. Companion to #2, not a replacement: `.coderabbit.yaml` is review-scoped and harder for the reviewer model to overlook; AGENTS.md is the durable cross-agent home for the same facts.

### Outstanding quick check

- **`ortools` on PyPI** — `9.15.6755` is published with wheels for cp310–cp313 only. **No cp314 wheel yet.** The GitHub-release URL pin in `pyproject.toml:37` is correct; revisit monthly. Switch back to `ortools>=9.15` on PyPI once Google publishes cp314 wheels.

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

1. `chore(ci): ruff target-version py314` — already in this PR
2. `chore(py): drop redundant __future__ annotations import` — mechanical, repo-wide
3. `refactor(api): adopt asyncio.TaskGroup in metrics services` — focused, ~35 callsites, behavioral improvement
4. `refactor(api): use itertools.batched for chunking` — 11 callsites
5. `refactor(api): convert isinstance chains to match` — small, optional

---

## 2. Go (project is on 1.26)

**Toolchain:** `pocketbase/go.mod` declares `go 1.26.0`; locally installed `go1.26.0`. 1.26 is the current stable as of April 2026 — already on latest, no version bump pending.

**Idiom level:** the compiler is 1.26 but the codebase mixes idiom from pre-1.18 through ~1.21. Baseline is otherwise excellent: 784 `slog` uses, 395 `fmt.Errorf("%w", ...)` wrappings, no `ioutil`, `math/rand/v2` already adopted. The dominant gap is an `interface{}` → `any` codemod the codebase never got.

### How to read these tables

The first table lists rewrites with both a **`from` works since** column (oldest Go that accepts the current idiom — usually `1.0`) and a **`to` available since** column (when the target idiom became available). The codebase's effective idiom level is roughly *the highest "from works since" we still depend on*, which is `1.0` everywhere — i.e. our code reads like Go 1.0–1.18 even though we build on 1.26.

The second table is an honest accounting of where the original audit *stopped looking*, with survey results filled in.

### 2a. Concrete rewrites (current targets)

| From (current idiom) | To (modern equivalent) | `from` works since | `to` available since | Impact | Where | Count |
|---|---|---|---|---|---|---|
| `interface{}` | `any` | 1.0 | 1.18 | **HIGH** | `sync/api.go` (108), `sync/base_sync.go` (42), `sync/households.go` (35+), widespread | 744 |
| `map[string]interface{}` | `map[string]any` | 1.0 | 1.18 | **HIGH** | same hotspots | 603 |
| `fmt.Sprintf(...)` inside `slog.Info(...)` etc. | raw key/value attrs | n/a | 1.21 (`log/slog`) | **HIGH** | `campminder/client.go:1008`, `sync/financial_transactions.go:106`, `sync/orchestrator.go:784,844` | 4 |
| `strings.Contains(err.Error(), "...")` | sentinel errors + `errors.Is` / `errors.As` | 1.0 | 1.13 | **HIGH** | `sync/rate_limited_sheets_writer.go` (Google 429), `scheduler_test.go`, `workbook_manager_test.go`, `orchestrator_test.go` | 4 |
| `sort.Slice(s, less)` | `slices.SortFunc(s, cmp)` | 1.0 (`sort.Slice` since 1.8) | 1.21 | **MEDIUM** | `sync/normalize_geographic_test.go`, `sync/workbook_manager.go`, `sync/multi_workbook_ordering.go` (2×) | 3 |
| `sort.Strings(s)` | `slices.Sort(s)` | 1.0 | 1.21 | **MEDIUM** | `rbac/hooks.go`, `sync/base_sync.go` (2×), `sync/multi_workbook_ordering.go` (2×), `sync/table_exporter.go` | 6 |
| `for i := 0; i < len(s); i++` | `for i := range s` | 1.0 | 1.22 (loop-var semantics) | **MEDIUM** | `sync/households.go`, `staff_skills.go`, `session_resolver.go`, `sessions.go`, `camper_history.go`, `rate_limited_sheets_writer.go`, tests | 26 |
| manual map-clear loop | `clear(m)` | 1.0 | 1.21 | **MEDIUM** | `sync/base_sync.go:122–125, 130–133` | 2 |
| Mixed `log` + `log/slog` in one file | consolidate on `slog` | n/a | 1.21 (`log/slog`) | **LOW** | `campminder/client.go:11` | 1 file |
| ~~`strings.Index(x, y) != -1`~~ | ~~`strings.Contains(x, y)`~~ | — | — | **FALSE POSITIVE** | ~~`sync/base_sync.go:1084`~~ | ~~1~~ |
| `time.After` in retry loop | reuse `time.NewTimer` | 1.0 | 1.0 | **?** | `sync/rate_limited_sheets_writer.go:194` | 1 |

**Notes on caveats:**
- `for i := 0; i < len(s); i++` → `for i := range s` was syntactically valid before 1.22; the reason it's now *preferred* is that 1.22 made the loop variable per-iteration scoped, which makes `i`-capture in closures/goroutines safe.
- Some of the 26 `for i := 0; …` callsites use `i += batchSize` — those still need the classic form (or migrate to `slices.Chunk`, see survey table below).
- **`strings.Index` row was a false positive.** The original audit pattern-matched `Index(...) != -1` without inspecting the body. The single hit at `sync/base_sync.go:1084` uses `idx` as a *slice boundary* (`result[:idx] + result[endIdx:]`), not just as a presence check, so `strings.Contains` would discard the offset that the next 7 lines depend on. **Lesson: every audit row must be confirmed against the surrounding code before claiming it's a candidate, not just against the regex.**

### 2b. Survey status of features ≥ 1.22

The original audit was scoped to "features the existing code visibly avoids," so library-level wins from 1.22 onward were under-surveyed. Findings below were filled in via this PR's discovery pass.

| Feature | Since | Survey status | Findings | Notes |
|---|---|---|---|---|
| `min` / `max` builtins | 1.21 | surveyed | ~10 manual `if a > b` ternaries (`sync/orchestrator.go:565`, `sync/rate_limited_sheets_writer.go:211`, `sync/sheets_scheduling.go:60,63`, `sync/persons.go:637, 1029`, `ratelimit/ratelimit.go:85`, `sync/feedback/handler.go:104`) + 1 `math.Min` (`ratelimit/ratelimit.go:78`) | Drops a few `math` imports if all converted. **MEDIUM**. |
| `cmp.Or` (first non-zero) | 1.22 | surveyed | ~5 chained-nonzero patterns (`sync/normalize_geographic.go:487`, `sync/table_exporter.go:262, 358`, `sync/camper_transportation_test.go:296`, `sync/camper_history_test.go:1045`) | Readability only. **LOW–MEDIUM**. |
| `math/rand/v2` | 1.22 | **already adopted** | `sync/orchestrator.go:9` already imports `math/rand/v2`; `sync/rate_limited_sheets_writer.go` correctly uses `crypto/rand` for jitter | No work — confirms 1.22 idiom is partially adopted. ✓ |
| `slices.Concat` | 1.22 | **retired (false positive)** | 3 `append(x, y...)` callsites (`sync/multi_workbook_ordering.go:39`, `sync/persons.go:1429`, `campminder/client.go:1020`) — but 2 are loop accumulators where `slices.Concat` would lose `append`'s growth amortization, and the 3rd rewrite is no clearer than the original | See Retired subsection in §2c. |
| `slices.Chunk` | 1.23 | surveyed | 6 manual `for i := 0; i < len(x); i += batchSize` chunkers (`sync/households.go:104`, `staff_skills.go:541`, `session_resolver.go:188`, `camper_history.go:1042`, `persons.go:283`, plus `camper_history_test.go:529`) | **MEDIUM** — strictly better than the for-range rewrite for these specific loops. Replaces the "still needs classic form for `i += batchSize`" caveat above. |
| Range-over-func iterators (`for x := range fn`) | 1.23 | surveyed | No callback-iteration patterns (`func(...) bool` only appears as `sort.Slice` less-funcs, which are migrating to `slices.SortFunc` anyway) | No candidates. ✓ |
| Generic type aliases (`type Set[T] = map[T]struct{}`) | 1.24 | surveyed | No generic functions in the codebase (`func Foo[T ...]` returned 0 hits) | N/A — no generics to alias. ✓ |
| `os.Root` (rooted FS, anti-traversal) | 1.24 | surveyed | All `os.ReadFile`/`os.WriteFile` use trusted internal paths (`s.App.DataDir()`, env-driven config paths, all already nolint'd as G304). No untrusted-input file ops. | Not security-relevant here. **LOW** value. |
| `testing/synctest` (virtualized time in tests) | 1.24 (experiment) / 1.25 (GA) | **ungated** | Real candidates: `sync/orchestrator_test.go` (~10 `time.Sleep`s, total real-time ~1.5s+), `sync/scheduler_test.go` (300ms+200ms sleeps), `sync/rate_limited_sheets_writer_test.go:387`, `rbac/config_hooks_test.go:74,84` | **MEDIUM**. 1.25 GA shipped, toolchain is 1.26 — no longer gated. Would speed up test suite and remove flake risk. |
| `encoding/json/v2` | 1.25 | surveyed | `campminder/client.go` is the hot path (33 callsites); `sync/base_sync.go` (8), `sync/normalize_geographic_test.go` (10) | Opt-in; v2 is a real API change, not a drop-in. **DEFER until ecosystem signal** — i.e. until logging/observability libs in our dep graph (or other packages we marshal *to*/from) accept v2 marshalers, so we don't have to wrap every boundary. The Go-stdlib gate is no longer the blocker (1.25 has shipped). |
| `context.WithoutCancel` / `context.AfterFunc` | 1.21 / 1.21 | surveyed | Only `WithCancel` in tests; no production patterns where a derived context needs to outlive its parent | No candidates. ✓ |

### 2c. Execution order (easiest → hardest)

Operational ranking driving the row-by-row PR loop in `modernization-prompts.md` Part B. **Pick rule: status `next` first, else lowest-numbered live row.** Bundle hints in the table are guidance for the brief, not a directive to skip — never re-rank based on a bundle hint.

#### Retired

| Item | Where | Reason |
|---|---|---|
| `strings.Index() != -1` → `strings.Contains(...)` | `sync/base_sync.go:1084` | **FALSE POSITIVE** — `idx` is used as a slice boundary (`result[:idx] + result[endIdx:]`), not just as a presence check; `strings.Contains` would discard the offset. See §2a annotation. *Lesson: always inspect surrounding code before adding to §2a.* |
| `append(x, y...)` → `slices.Concat` | `sync/multi_workbook_ordering.go:39`, `sync/persons.go:1429`, `campminder/client.go:1020` | **FALSE POSITIVE** — 2 of 3 callsites are loop accumulators (`persons.go:1429` inside `for status { for page {…} }`; `client.go:1020` inside `for month := 1; month <= 12 {…}`) where `slices.Concat` would lose `append`'s growth-amortized capacity and allocate fresh on every iteration. The 3rd site (`multi_workbook_ordering.go:39`) is a single conditional concat where the rewrite is no clearer than the current 5 lines. *Lesson: filter `append(x, y...)` candidates for non-loop context — the spread-append regex matches accumulator anti-patterns where `slices.Concat` is actively wrong.* |

#### Live (renumbered after retired and already-done/N/A items removed)

| Rank | Status | Item | Where | Count | Bundle |
|---|---|---|---|---|---|
| 1 | ✓ shipped #1066 | manual map-clear → `clear()` builtin | `sync/base_sync.go:121, 1416` | 2 | — |
| 2 | ✓ shipped #1066 | `sort.Strings` → `slices.Sort` | `rbac/hooks.go`, `sync/base_sync.go` (2×), `camper_history_test.go`, `multi_workbook_ordering.go` (2×), `table_exporter.go` (2×) | 8 | bundled w/ #3; drift +`camper_history_test.go:546` (audit miss) |
| 3 | ✓ shipped #1066 | `sort.Slice` → `slices.SortFunc` | `sync/normalize_geographic_test.go`, `base_sync.go:1402`, `workbook_manager.go` | 3 | bundled w/ #2 |
| — | ✓ shipped #1066 | `sort.Ints` → `slices.Sort` (drift, audit miss) | `sync/family_camp_derived_test.go:163` | 1 | included in #2/#3 bundle to drop `"sort"` import package-wide |
| 4 | ✓ shipped #1070 | `min` / `max` builtins | `sync/orchestrator.go:565`, `rate_limited_sheets_writer.go:211`, `persons.go:637`, `ratelimit/ratelimit.go:78` | 4 | bundled w/ #5; ~7 audit entries retired as false positives (early-return validators in `sheets_scheduling.go:60,63` & `persons.go:1029`, side-effecting if in `ratelimit.go:85`, error-size check in `feedback/handler.go:104`) |
| 5 | ✓ shipped #1070 | `cmp.Or` (first non-zero) | `sync/table_exporter.go:262` | 1 | bundled w/ #4; ~4 audit entries retired as false positives (`normalize_geographic.go:487`, `table_exporter.go:358` — "if non-empty, do X" patterns rather than first-non-zero fallbacks) |
| 6 | ✓ shipped #1071 | `map[string]interface{}` → `map[string]any` | hotspots | 603 | bundled w/ #7 as single `gofmt -r` codemod; surfaced pre-existing dead branch in `normalizeToStringSlice` (issue #1072) |
| 7 | ✓ shipped #1071 | `interface{}` → `any` | `sync/api.go` (122), `base_sync.go` (29), `households.go`, widespread | 141 (744 incl. #6) | bundled w/ #6 |
| 8 | ✓ shipped #1074 | log/slog consolidation | `campminder/client.go:11` (`log.Printf` alongside `slog`) | 1 file | scan-it surfaced pre-existing unbounded recursion in `authenticate()` 429 retry — filed as issue #1079; constant `maxRequestRetries` extracted in same PR |
| 9 | ✓ shipped #1075 | manual chunkers → `slices.Chunk` | `sync/households.go:104`, `staff_skills.go:541`, `session_resolver.go:188`, `camper_history.go:1042`, `persons.go:283`, plus test | 6 | scan-it surfaced inconsistent batch sizes (50/100/500) across sync services as a pre-existing issue — filed as #1078; deleted bespoke `splitIntoBatches` helper + its test |
| 10 | ✓ shipped #1076 | `for i := 0; …` → `for i := range s` | `sync/sessions.go` (n² sort outer), `rate_limited_sheets_writer.go` (retry), `ratelimit/ratelimit.go` (retry), `household_demographics_test.go` (byte-indexed string), `google/client_test.go` (substring search), tests | 22 | originally stacked on #1075; rebased onto main with `git rebase --onto` after #1075 squash-merged; `lll` lint required wrapping multi-attr slog calls (caught only on CI — `golangci-lint` not in `lefthook pre-push`) |
| 11 | next | `fmt.Sprintf` inside `slog` | `campminder/client.go:1008`, `sync/financial_transactions.go:106`, `sync/orchestrator.go:784,844` | 4 | — |
| 12 | | `time.After` in retry loop | `sync/rate_limited_sheets_writer.go:194` | 1 | — |
| 13 | | string error matching → sentinels | `sync/rate_limited_sheets_writer.go` (Google 429), `scheduler_test.go`, `workbook_manager_test.go`, `orchestrator_test.go` | 4 | behavioral |
| 14 | | `testing/synctest` for time-based tests | `orchestrator_test.go`, `scheduler_test.go`, `rate_limited_sheets_writer_test.go`, `rbac/config_hooks_test.go` | 10+ sleeps | 1.25 GA shipped, toolchain is 1.26 — no longer gated |
| 15 | deferred | `encoding/json/v2` | `campminder/client.go` (33), `sync/base_sync.go` (8) | hot path | defer until ecosystem signal (deps accept v2 marshalers) |

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
