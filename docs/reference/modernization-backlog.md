# Modernization Backlog

Reference audit of modern language/tooling features available to Kindred but not yet adopted. Generated from a comprehensive audit across Python, Go, TypeScript/React, and infrastructure layers.

**Status legend:** HIGH = real behavioral/robustness benefit, MEDIUM = readability/consistency win, LOW = polish / defer.

**Execution model:** Work this backlog one layer at a time (one PR per language/concept) rather than a single mega-PR. Each section governs its own execution order; there is no global cross-section ordering — pick which language to work on based on real-world signals (active PRs, blast radius, idle slot).

**Section lifecycle:** Open language sections start in single-table audit format. On first execution loop they're restructured to §a/§b/§c per `modernization-prompts.md` Part A (concrete rewrites + honest survey-status + ranked execution order) — §3 Frontend is in this in-progress shape today; the pre-restructure single-table form is preserved in this doc's git history (see §3 Frontend before this pass, or §1 Python before its closeout). Once every row has shipped, skipped, or deferred, the section collapses to a closeout summary capturing wins / deferrals / retired false positives / surveyed-clean (§1 Python and §2 Go today). §4 (Infrastructure) is a hardening checklist — different artifact, no lifecycle.

**Companion docs:** Ship rows by following `modernization-prompts.md` (Part B for execution, Part A for re-running an audit). The prompt doc names the false-positive lesson explicitly — every grep hit must be inspected with surrounding context before it lands in §a. When the last open section migrates, the §a/§b/§c template moves out of this doc into `modernization-prompts.md` as an appendix.

---

## 0. Cross-cutting fixes (originating PR #972 + follow-ups)

Shipped in originating PR #972 (Apr 2026):

- **`CLAUDE.md` language versions** — `Python 3.12+, Go 1.24+` → `Python 3.14+, Go 1.26+` (matches `.python-version` and `pocketbase/go.mod`)
- **`README.md`** — rewritten to include Camp Analytics (metrics module), architecture diagram, Python 3.14 / Go 1.26 pins, production-deployment note about Traefik/CrowdSec fronting Caddy
- **`ruff.toml`** — `target-version = "py312"` → `"py314"` (intended to defer but landed in #972 itself)

Shipped in follow-up PRs:

- **`ortools` PyPI switch** — PR #1038 moved `pyproject.toml:37` from the GitHub-release URL pin back to `ortools>=9.15`. PyPI now publishes cp314 wheels for `9.15.6755` (macOS/Linux/Windows), so the pin is healthy. Re-survey on the next ortools major bump.

### Bundle closeout — "Tell our tools we're on Python 3.14"

All three items resolved:

1. **`ruff target-version = "py314"`** — ✓ shipped in originating PR #972.
2. **`.coderabbit.yaml`** — ✓ shipped (this PR). Includes Python 3.14 `path_instructions` (PEP 758/649/695/750, `typing.TypeIs`, `asyncio.TaskGroup`) plus path-scoped guidance for Go 1.26 idioms (incl. the `slog.SetDefault` default-handler false-positive suppression), PocketBase v0.23 migration syntax, React 19 / TS 6.0 / ES2022 frontend conventions, the `api/` FastAPI surface, OR-Tools solver invariants, fictional-test-data discipline, and Markdown noise filters. `learnings.scope: local` + `related_issues` / `assess_linked_issues` enabled; `pre_merge_checks`, `suggested_labels`, `poem`/`fortune` deliberately off.
3. **`AGENTS.md`** — **decided not to add.** The only consumers of agent-instruction files in this repo are Claude Code and CodeRabbit. CodeRabbit already auto-scans `**/CLAUDE.md` via `knowledge_base.code_guidelines.filePatterns`, and the repo already has a 7-file CLAUDE.md hierarchy (root + `tests/`, `bunking/`, `bunking/solver/`, `frontend/`, `pocketbase/`, `api/`). AGENTS.md would duplicate those without serving a distinct audience. Revisit if Codex / Cursor / Jules adoption ever happens.

---

## 1. Python — closed at 3.14 (May 2026)

**Toolchain at closeout:** Python 3.14.2 (`requires-python = ">=3.14"`, `.python-version` = `3.14`); `ruff.toml target-version = "py314"`. Latest stable upstream is 3.14 (3.15 not GA).
**Idiom level pre-audit:** mixed 3.10–3.12 — 510 redundant `from __future__ import annotations`, 24 `range(0, len(x), n)` chunkers, 35 `asyncio.gather` sites, 1 explicit `T = TypeVar(...)`.
**Idiom level post-audit:** through 3.14 except the deferred + skipped rows below.
**Next-audit floor:** features added in Python 3.15+. Don't re-survey 3.10–3.14 — outcomes captured below.

Baseline was already strong at audit: Pydantic v2 everywhere, `from datetime import UTC` in 23 files (zero `timezone.utc` left), PEP 585 builtin generics (`dict[str, X]`) and PEP 604 `X | Y` unions throughout, `StrEnum` in 4 files, three functions already on PEP 695 scoped generics, f-strings clean, mypy `strict = true`, no `Union`/`Optional`/`Dict`/`List`/`Tuple` typing imports outside docstrings.

### Shipped

5 PRs landed 5 distinct rewrites across the `api/` and `bunking/` layers:

| PR | Rewrite | Scope |
|---|---|---|
| #1574 | PEP 695 scoped generic `[T]` + drop the module-level `TypeVar` (3.12) | `phase3_disambiguation_service.py` |
| #1575 | enable ruff `PLC0415` (`import-outside-toplevel`) + sweep 108 production import-hoists (+4 `# noqa` for genuine circular-import / test-monkeypatch cases); `tests/**` per-file-ignored | repo-wide |
| #1578 | drop redundant `from __future__ import annotations` (PEP 649, 3.14) — 467 deleted, **43 `if TYPE_CHECKING:` files kept** (load-bearing under PEP 649, *not* PEP 563) | repo-wide |
| #1579 | `dataclasses.replace` → `copy.replace` (3.13) — 3 callsites + spec-lock test | `bunking/` |
| #1582 | `range(0, len(x), n)` chunkers → `itertools.batched` (3.12) — 23 sites / 10 files, all `strict=False`, tuple-vs-slice inspected per site (3 helpers widened `list`→`Sequence`, 2 list-comp forms kept via `[list(b) for b in batched(...)]`) | `api/`, `bunking/` |

**Audit-count corrections found during execution** (counts decay — see Process lessons): `PLC0415` was 1,871 hits, not "1 known"; `__future__` redundancy was 467, not all 510; `itertools.batched` was 23 sites/10 files, not "24/12"; `asyncio.gather` was 35/13, not "35/11".

### Deferred

- **PEP 750 t-strings (3.14)** — `grep -rEn "f['\"](SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE|DROP) " …` → 5 SQL f-strings in `scripts/setup/seed_from_prod.py` (3), `tests/test_seed_from_prod.py` (1), plus 2 multiline in `api/services/metrics_sql_repository.py`. None are user-input-driven (table/column identifiers only), and PocketBase/SQLite expose no t-string-aware API. Re-evaluate when a downstream library accepts `Template`.

### Skipped

- **`asyncio.gather` → `asyncio.TaskGroup` (3.11)** — 35 `gather` calls across **13 files** (the §a draft said "35 across 11"; it missed `comparison`/`day1`/`retention_trends` and listed `velocity_service`, which has none). **Skipped after in-context audit (Rule 1):** every site is a homogeneous `a, b = await gather(...)` positional-unpack fan-out with no local `try/except`. TaskGroup trades that one-liner for `create_task` + `.result()` boilerplate across ~34 sites to harden an error path that the global `@app.exception_handler(Exception)` (`api/main.py:103`) already collapses to the same generic 500 — `ExceptionGroup` ⊆ `Exception`, so client-facing behavior is unchanged. The only behavioral delta is direct-call tests asserting a concrete type (e.g. `test_session_availability.py:956` → `pytest.raises(RuntimeError)`) that would have to become `ExceptionGroup`. Net: readability regression across ~34 sites > marginal sibling-cancellation gain on a rarely-hit error path for read-only fan-outs. The `return_exceptions=True` site at `batch_processor.py` was excluded regardless (different pattern — it deliberately collects exceptions). Re-survey only if a heterogeneous / partial-success fan-out appears.

### Surveyed clean / dismissed (no candidates) — search expressions retained

Grepped at audit time; recorded so the next pass (3.15+) knows where this one stopped looking. Features found **already adopted** are folded into the baseline paragraph above (`datetime.UTC`, PEP 585/604, `StrEnum`, partial PEP 695).

| Feature | Status | Evidence |
|---|---|---|
| `match` statement (PEP 634, 3.10) | dismissed | `grep -rEn '^\s*match [a-zA-Z_(]' …` → 0 real `match X:`; the 16 hits were `match = regex.match(...)`. 18 `elif isinstance` candidates all 2-branch or mixed value/type predicates — see Retired |
| `tomllib` (3.11) | dismissed | `grep -rn 'import tomli\|import toml\b\|from tomli\|from toml ' …` → 0; no runtime TOML parsing |
| `typing.Self` (3.11) | dismissed | `grep -rln 'from typing import.*Self\b\|typing\.Self\b' …` → 0; `grep -rEn 'def [a-z_]+\(cls,?.*\) -> ["\047][A-Z]' …` → 0 awkward forward refs |
| `ExceptionGroup` / `except*` (3.11) | dismissed | `grep -rn 'ExceptionGroup\|except\*' …` → 0 (the `return_exceptions=True` site was the TaskGroup target — now skipped) |
| `typing.LiteralString` (3.11) | dismissed | `grep -rn 'LiteralString' …` → 0; no SQL-builder layer (raw SQL is in scripts/tests only) |
| PEP 695 `type` statement / `TypeAlias` (3.12) | dismissed | `grep -rn 'TypeAlias\b' …` → 0; `grep -rEn '^type [A-Z]' …` → 0; no aliases to migrate |
| `@override` decorator (3.12) | surveyed — not actionable | `grep -rn '@override' …` → 0; 289 inheritance lines (27 non-Pydantic/Enum/Protocol). A discipline policy + ruff-rule (`PLR6301`) decision, not a row |
| `typing.TypeIs` (3.13) | dismissed | `grep -rn 'TypeGuard' …` → 0 callers; nothing to migrate |
| `typing.ReadOnly` TypedDict fields (3.13) | surveyed — low value | `grep -rln 'TypedDict' …` → 6 files; none mutated cross-module in ways `ReadOnly` would catch. Re-survey if a TypedDict bug surfaces |
| PEP 696 TypeVar defaults (3.13) | dismissed | `grep -rn 'TypeVar.*default=' …` → 0 |
| PEP 702 `@deprecated` (3.13) | dismissed | `grep -rn '@deprecated' …` → 0; no `DeprecationWarning` discipline yet |
| `compression.zstd` (3.14) | dismissed | `grep -i 'zstd\|zstandard' pyproject.toml` → 0; no zstandard dep |
| `@dataclass(slots=True, kw_only=True, frozen=True)` | surveyed — not a campaign | `grep -rn '@dataclass' …` → 85 declarations, only 1 sets `slots=True` (hottest: `core/models.py`, 9 dataclasses). Apply opportunistically when touching a file, not a sweep |

### Retired as false positives (calibration for future audits)

These survived the regex pass in the previous (pre-§a/§b/§c) audit before being killed on inspection. Worth remembering because the same regexes will keep matching:

| Pattern | Where (prior audit's claim) | Why it failed |
|---|---|---|
| `match` statement replacing isinstance chains | "~15–20 hits across 4 files" | 18 `elif isinstance` hits exist but every one is either 2-branch (debug.py keywords/list-vs-str, campminder/client.py dict-vs-list, phase2 dict-vs-(int,str)) or mixes value comparison with type checks (metrics_repository.py: `elif status_filter == "enrolled"` between two `isinstance(…, list)` branches). The prompts doc's bar is ">2 branches"; none qualify. **Lesson: don't count `elif isinstance` lines — count distinct >2-branch type-only chains.** |
| Residual `Optional[X]` → `X \| None` | "3 hits in test_ranked_candidate_passthrough.py:65,67" | All 3 hits sit inside a docstring describing a refactor (`Optional[Tuple[int, float, str]]` is plain text, not an annotation). **Lesson: filter grep hits for `--include='*.py'` AND verify they're not inside `"""..."""`. Or add `--exclude-dir` for docstring-heavy files.** |
| `typing.ReadOnly` for `geo_normalizer/normalizer.py:20` | "1 hit" | The previous audit listed normalizer.py as a `ReadOnly` candidate; the actual line is an unrelated import. No TypedDict in the file would gain from `ReadOnly`. |
| "no SQL/HTML template builders that would benefit from PEP 750" (Not-applicable list) | (claimed clean) | 5–7 SQL f-strings exist in `scripts/setup/seed_from_prod.py`, `tests/test_seed_from_prod.py`, `api/services/metrics_sql_repository.py`. Moved to the **Deferred** section above — t-strings are real candidates, just not actionable without library support. **Lesson: "no candidates" claims need a search expression; the audit had none for PEP 750.** |

### Process lessons (carried into `modernization-prompts.md` Rules 1–3)

- **Counts decay between audits.** Previous audit said "~250 `__future__` files" — actually 510. "11 batched candidates" — actually 24. "41 `@dataclass`" — actually 85. Always re-grep before opening the PR; never reuse a stale count.
- **Docstring text matches Python regexes.** Both the `Optional[X]` and `Dict/List/Tuple` rows in the previous audit triggered on docstring contents. Either exclude docstrings or grep only at file-imports.
- **`elif isinstance` ≠ `match` candidate.** Most chains in this codebase are 2-branch, mixed-predicate, or `else`-terminated dictionary parsers. The `match` statement doesn't help any of them. Don't count regex hits; count >2-branch type-only chains.
- **Three functions already use PEP 695** scoped-generic syntax (`api/services/breakdown_calculator.py`, `api/services/retention_service.py`). The previous audit didn't notice. The remaining single `T = TypeVar` is the last holdout, not the lonely sentinel the prior audit framed it as.
- **`from __future__ import annotations` is NOT redundant in `if TYPE_CHECKING:` files (PEP 649 ≠ PEP 563).** Dropping it broke 43 files (#1578). Mechanism: under PEP 563 (the future import) `__annotations__` holds *strings* and `TYPE_CHECKING`-only names are never evaluated; under PEP 649 (3.14 default) *accessing* `__annotations__` **evaluates** bare annotations → `NameError` on names that only exist under `if TYPE_CHECKING:`. The triggers are everywhere annotations get read at runtime: `inspect.signature`, `unittest.mock` `Mock(spec=X)`, FastAPI endpoint/dependency introspection, dataclass field collection, `typing.get_type_hints()`. **Lesson for the next sweep: before deleting the import, exclude every file containing `if TYPE_CHECKING:` (any alias form too). The test suite only catches the subset that a `Mock(spec=)`/`inspect` path happens to exercise — the rest are latent landmines, so scope by the guard, not by the test failures.**
- **Reconcile §c against `gh pr list` on every pickup (Part B).** Stale/blank statuses spawned two duplicate PR pairs this round — #1579/#1581 (`copy.replace`) and #1580/#1582 (`itertools.batched`), same rows opened across sessions. The worse of each was closed; #1579 + #1582 shipped. Mark a row `PR open #N` the moment its PR opens; `gh pr list` is ground truth, the §c table is a lossy cache.

Survey scope: features added in Python 3.10–3.14. Re-run Part A after toolchain bumps to 3.15+.

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
- **CodeRabbit flagged "bypasses logging contract" on #1562** — false positive; logging pkg installs default slog handler via `slog.SetDefault` and no `logging.Info` wrapper exists. ✓ Addressed in §0 — `.coderabbit.yaml` `pocketbase/**/*.go` block documents the `slog.SetDefault` default-handler pattern explicitly.

Survey scope: Go 1.18 through 1.26. Re-run Part A on a 1.27+ toolchain bump.

---

## 3. Frontend — React 19, TypeScript 6.0, Node 22, Tailwind 4

**Toolchain at audit (May 2026):** Node `v22.17.1` (`engines.node >=22`, `.nvmrc` = `22`); TypeScript `6.0.3` (`typescript: ^6.0.2`); React `19.2`, `@tanstack/react-query` `5.100`, Tailwind `4.3` (`@tailwindcss/vite`), Vite `8`, ESLint `10` (flat). `tsconfig.json` `target`/`lib` = **ES2022**.
**Idiom level pre-audit:** broadly ES2020 (optional chaining `?.` 1,091 sites, nullish `??` 1,198 — both pervasive) through ES2022, with modern React/TS layered on top (React 19 hooks; TS 6.0 strictness incl. `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `erasableSyntaxOnly`; `satisfies` in 4 files; comprehensive route-level lazy-loading). The misses are concentrated in **ES2023+ immutable array methods (zero `toSorted`/`toReversed`/`findLast`)** plus a few ES2021/ES2022 spot-misses.
**Toolchain gate:** `tsconfig` `lib` = ES2022, so ES2023 `toSorted` and ES2024 `Object.groupBy` are **not in the type lib** — adopting them needs a `lib` bump to ES2024. Node 22 supports them at runtime, so the bump is safe; it's row #1 because it unblocks the cheapest wins.
**Stale-header corrections from this pass:** "TypeScript 5.8" → actually **6.0**; "Tailwind 4 migration?" → **already on v4**; "100+ `useContext` consumers" → **13**; "~1,800 `as const`" → **208**; "only 2 components lazy-load" → **~50 lazy routes** (already adopted). Counts decay — Rules 1–3 apply.

### 3a. Concrete rewrites (current targets)

| # | From (current idiom) | To (modern) | `from` since | `to` since | Impact | Where | Count |
|---|---|---|---|---|---|---|---|
| 1 | `tsconfig` `target`/`lib` = `ES2022` | `ES2024` (lib at minimum) | — | TS lib 5.4 / Node 21 rt | **prereq** (unblocks #2, #6) | `frontend/tsconfig.json` | 1 |
| 2 | `[...arr].sort(cmp)` / `arr.slice().sort(cmp)` | `arr.toSorted(cmp)` | ES2015 | ES2023 | MEDIUM (cheapest mechanical) | 22 files / 30 true-win sites (`utils/sessionUtils.ts` ×5, `utils/csvExportHelpers.ts` ×2, `components/BunkCard.tsx` ×2, `pages/.../StaffCabinAnalysisPage.tsx` ×2, …). **Not** `retentionTransforms.ts` — that's a Set-spread (skipped, see Retired) | 52 raw → 30 wins (#1587) |
| 3 | `arr[arr.length - 1]` | `arr.at(-1)` | ES5 | ES2022 (already in lib) | LOW–MED (readability) | 18 files (`hooks/useUndoStack.ts`, metrics chart utils, `components/BunkCard.tsx`, …) | 27 |
| 4 | `<Context.Provider value=>` | `<Context value=>` | React <19 | React 19 | LOW–MED (cosmetic) | 9 files (`contexts/*`, `providers/BunkRequestProvider.tsx:126`, …) | 18 |
| 5 | `catch (e) { throw new Error(msg) }` | `throw new Error(msg, { cause: e })` | ES2015 | ES2022 (already in lib) | **HIGH** (stack-trace fidelity) | catch-and-wrap subset of 93 `catch` blocks (`services/*`, hooks); only `useCamperMovement.ts` chains today | scope to catch-rethrow sites (NOT the 138 bare `throw`) |
| 6 | `xs.reduce<Record<K, V[]>>((acc, x) => { acc[k].push(x) }, {})` | `Object.groupBy(xs, x => k)` | ES5 | ES2024 | LOW–MED | `components/LockGroupPanel.tsx:339`, `contexts/LockGroupContext.tsx:165` (near-duplicates) | 2 |
| 7 | ad-hoc `useQuery({queryKey, queryFn})` + `enabled: <bool>` | `queryOptions(...)` shared defs + `skipToken` | RQ v5 | RQ v5 (in use) | **HIGH** (type-safe shared defs; `skipToken` replaces conditional `enabled`) | 103 `useQuery`/55 files, 112 `enabled:` gates, 4 `useQueries` (no `combine`) | 50+ |
| 8 | mutable `interface`/`type` for cache/store/API shapes | `readonly` fields / `Readonly<>` | TS | TS | MEDIUM (prevents accidental mutation) | ≈1,758 type defs (735 interface + 1,023 alias); 24 `readonly` today | targeted (persisted/cached shapes only) |
| 9 | untyped / `as Type` config & route/feature maps | `… satisfies T` | TS 4.9 | TS 4.9 (in use) | MEDIUM | 4 files use it (`VelocityPage`, `CancellationVelocityPage`, `services/debug.ts`); 208 `as const` | targeted |

**Two-version note:** only rows 2 and 6 carry a *compile* gate — the ES2022 `lib` doesn't expose `toSorted`/`Object.groupBy` types (hence row 1). Every other rewrite is already accepted by the current toolchain, so it's stylistic/robustness with no compile-error pressure.

### 3b. Survey status (search expressions retained)

| Feature | Status | Evidence |
|---|---|---|
| optional chaining `?.` (ES2020) | already adopted | `\?\.` → 1,091 |
| nullish coalescing `??` (ES2020) | already adopted | `\?\?` → 1,198 |
| `React.lazy` + `Suspense` | **already adopted** | `App.tsx` lazy-loads ≈50 route components (incl. `MetricsLayout`, `ScenarioComparisonPage`, every metrics page) under 37 `<Suspense>` boundaries; `CamperDetailsPanel` lazy via `LazyCamperDetailsPanel.ts`; `FriendGroupsView`/`RightPanelContainer`/`BunkingBoardByArea` lazy. Lone possible remainder: `RequestReviewPanel` (low value). Prior doc's "only 2 lazy-load, candidates `MetricsLayout`/`CamperDetailsPanel`" was simply wrong — both are already lazy. |
| Tailwind 4 | **already adopted** | `tailwindcss ^4.3.0` + `@tailwindcss/vite ^4.2.2` |
| `String.replaceAll` (ES2021) | surveyed — low value | `\.replace\(/_/g` → 9 literal-`_` candidates; the other ≈47 `.replace(/…/g)` use real regex (anchors, classes, lookbehind, `\s+`) that can't become a string `replaceAll`. Converting only the 9 is inconsistent churn. |
| `structuredClone` (ES2022) | dismissed | `JSON\.parse\(JSON\.stringify` → 0; `structuredClone` → 0. No deep-clone sites. |
| `Array.findLast` / `findLastIndex` (ES2023) | dismissed | `\.findLast(Index)?\(` → 0; `\.reverse\(\)\.find\(` → 0 |
| `Promise.try` (ES2025) | dismissed | `Promise\.try` → 0; also beyond current `lib`/`target` |
| React 19 `use()` hook | surveyed — **false premise, LOW** | `useContext\(` → 13/11 files; every wrapper is `if (!ctx) throw 'must be used within …'`. `use()` does **not** remove that guard (it only enables *conditional* context reads, which none of these need) — converting is pure churn. The prior HIGH "eliminates the throw-on-missing wrapper" claim is wrong about what `use()` does. |
| React 19 `useActionState` / `useFormStatus` | dismissed | `useActionState\|useFormStatus` → 0; no Server-Actions form pattern |
| RQ v5 `useSuspenseQuery` / `combine` | surveyed — deferred | both 0; `useQueries` used 4× without `combine`. `useSuspenseQuery` needs Suspense data boundaries (bigger change) — kept behind row 7's `queryOptions`/`skipToken` entry point. |
| TS 5.0 `const` type params | dismissed | `<const [A-Za-z]` → 0; no generic fns to tighten |
| TS 5.0 decorators (stage 3) | dismissed | `^\s*@[A-Z]` → 0; `erasableSyntaxOnly` forbids them anyway |
| Temporal / `Intl.Segmenter` / regex `v` flag | not surveyed | no signals; revisit if a date/i18n/grapheme need arises |

### Retired as false positives (calibration for future audits)

| Pattern | Where (prior claim) | Why it failed |
|---|---|---|
| `[...].sort()` → `toSorted` | inflated count | `areas[area as BunkArea].sort(...)` (`BunkingBoardByArea.tsx:157`) is an **in-place** sort inside `forEach`; the `].sort(` matched an *index bracket*, not a spread. Converting changes behavior. **Lesson: confirm a `[...` or `.slice()` precedes `.sort(`.** |
| `[...ids].sort().join(',')` | `utils/queryKeys.ts:384` | Inside a doc **comment**, not code. **Lesson: filter comment lines.** |
| `[...set].sort()` / `[...map.entries()].sort()` → `toSorted` | 10 sites (`retentionTransforms.ts` ×2, `SessionBunkHeatmap.tsx` ×2, `useVelocityChartData.ts` ×2, `useStaffRetentionData.ts`, `PdfExport/familyRows.ts`, `PostValidationResultsModal.tsx`, `PdfExport/BunkPlanReport.tsx`) | When the spread *materializes* a `Set`/`Map`/iterator (which have no `.sort()`/`.toSorted()`), the spread is **load-bearing**, not a defensive copy of an array. `[...x].toSorted()` allocates a second throwaway array; `[...x].sort()` sorts the first in place. `toSorted` is only a win over a *named Array* (`[...arr].sort()` → `arr.toSorted()`). **Lesson (#1587): grep `[\.\.\.IDENT]` is not enough — confirm IDENT is an Array, not a Set/Map/iterator; also exclude array-literal-append spreads like `[...prev, n].sort()`.** |
| `use()` "eliminates throw-on-missing-provider wrapper" | prior HIGH row | `use(Context)` doesn't auto-throw or remove the null-guard; it only allows conditional reads. **Lesson: verify the feature's real semantics, not its reputation.** |
| inflated counts | "100+ useContext", "~1,800 as const", "240 type defs", "only 2 lazy" | actual 13 / 208 / ≈1,758 / ≈50-lazy. **Lesson: counts decay — re-grep every pass (carried from §1/§2).** |

### 3c. Ranked execution order

| # | Status | Row | Title |
|---|---|---|---|
| 1 | `✓ shipped #1585` | 3a#1 | `build(frontend): bump tsconfig target+lib to ES2024` (unblocks #3, #5) |
| 2 | `✓ shipped #1586` | 3a#3 | `refactor(frontend): arr[len-1] → arr.at(-1)` (27 sites, no prereq) |
| 3 | `PR open #1587` | 3a#2 | `refactor(frontend): [...].sort() → toSorted` (30 true-win sites / 22 files; Set/iterator spreads skipped — see Retired) |
| 4 | `next` | 3a#4 | `refactor(frontend): <Context.Provider> → <Context> shorthand` (18 sites) |
| 5 | | 3a#6 | `refactor(frontend): Object.groupBy for LockGroup membersByGroup` (2 sites; needs #1) |
| 6 | | 3a#5 | `refactor(frontend): error cause chaining on catch-rethrow` (behavioral — TDD per Rule 3) |
| 7 | | 3a#9 | `refactor(frontend): satisfies on config/route maps` (targeted) |
| 8 | | 3a#8 | `refactor(frontend): readonly on cache/store/API types` (type-level, large surface) |
| 9 | | 3a#7 | `refactor(frontend): React Query queryOptions + skipToken` (HIGH value, largest/most semantic — split as needed) |

Ranking is easiest→hardest with the unblocker (#1) first per Part B's tie-breaker. The HIGH-impact-but-large rows (error cause, React Query) sit later because they carry test/semantic surface, not because they're low value.

Survey scope: ES2020–ES2024 + React 19 + TS 6.0 + RQ v5. Re-run Part A after a Node/TS/React major bump or when `tsconfig` `lib` moves past ES2024.

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
