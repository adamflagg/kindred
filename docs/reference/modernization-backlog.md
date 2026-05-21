# Modernization Backlog

Reference audit of modern language/tooling features available to Kindred but not yet adopted. Generated from a comprehensive audit across Python, Go, TypeScript/React, and infrastructure layers.

**Status legend:** HIGH = real behavioral/robustness benefit, MEDIUM = readability/consistency win, LOW = polish / defer.

**Execution model:** Work this backlog one layer at a time (one PR per language/concept) rather than a single mega-PR. Each section governs its own execution order; there is no global cross-section ordering — pick which language to work on based on real-world signals (active PRs, blast radius, idle slot).

**Section lifecycle:** Open language sections start in single-table audit format (§3 Frontend today). On first execution loop they're restructured to §a/§b/§c per `modernization-prompts.md` Part A (concrete rewrites + honest survey-status + ranked execution order) — see §1 Python for the in-progress §a/§b/§c shape. Once every row has shipped or deferred, the section collapses to a closeout summary capturing wins / deferrals / retired false positives / surveyed-clean (§2 Go today). §4 (Infrastructure) is a hardening checklist — different artifact, no lifecycle.

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

## 1. Python (project is on 3.14)

**Toolchain at audit (May 2026):** `requires-python = ">=3.14"`; `.python-version` = `3.14`; `uv run python` ships `3.14.2`. Latest stable upstream is 3.14 (3.15 not GA). `ruff.toml target-version = "py314"`.
**Idiom level pre-audit:** mixed 3.10–3.12. 510 files carry redundant `from __future__ import annotations` (a no-op under PEP 649 in 3.14); 24 manual `range(0, len(x), n)` chunkers; 35 `asyncio.gather` sites; 1 explicit `T = TypeVar(...)` declaration.
**Idiom level post-audit goal:** through 3.14 except deferred row below.
**Next-audit floor:** features added in Python 3.15+. Don't re-survey 3.10–3.14 — outcomes captured below.

Baseline is strong: Pydantic v2 everywhere, `from datetime import UTC` adopted in 23 files (zero `timezone.utc` left), modern generics (`dict[str, X]`), `StrEnum` in 4 files, three functions already use PEP 695 scoped generics, f-strings clean, mypy `strict = true`, no `Union`/`Optional`/`Dict`/`List`/`Tuple` typing imports outside docstrings.

### §a — Concrete rewrites (current targets)

| Impact | From (current idiom) | To (modern equivalent) | `from` works since | `to` available since | Where | Count |
|---|---|---|---|---|---|---|
| **HIGH** | `from __future__ import annotations` | delete the import (PEP 649 in 3.14 makes deferred evaluation the default — note: PEP 649 ≠ PEP 563, see §c #3 verification note) **except** in files pairing `if TYPE_CHECKING:` imports with bare annotations, where the import is load-bearing | 3.7 | 3.14 (PEP 649) | repo-wide | ✓ shipped #1578: 467 deleted, 43 `TYPE_CHECKING` files kept (510 total) |
| **HIGH** | `asyncio.gather(*tasks)` / `asyncio.gather(..., return_exceptions=True)` | `async with asyncio.TaskGroup() as tg: ... tg.create_task(...)` (aggregates failures via `ExceptionGroup` instead of dropping sibling tasks) | 3.4 | 3.11 (PEP 654 + asyncio.TaskGroup) | `api/services/{drilldown,forecast,geo,historical,registration,retention,session_availability,velocity,batch_processor,validation}.py`, `bunking/sync/.../{trace_collector,batch_processor}.py` | 35 across 11 files (1 of them uses `return_exceptions=True`) |
| **MEDIUM** | `for i in range(0, len(x), n): chunk = x[i:i+n]` and the list-comprehension form `[x[i:i+n] for i in range(0, len(x), n)]` | `from itertools import batched; for chunk in batched(x, n)` (returns tuples — call `list()` if downstream mutates) | 3.0 | 3.12 (`itertools.batched`) | `api/routers/validation.py:198`, `api/services/{metrics_repository,metrics_sql_repository,data_fetcher}.py`, `bunking/satisfaction/aggregate.py:328`, `bunking/graph/optimized_graph_builder.py`, `bunking/sync/.../debug_parse_repository.py` (9), `.../attendee_repository.py` (3), `.../social_graph.py`, `.../ai_service.py`, `.../batch_processor.py:369` | 24 across 12 files |
| **LOW** | `T = TypeVar("T")` + `def foo(x: T) -> T` | scoped generic `def foo[T](x: T) -> T:` (and drop the module-level `TypeVar`) | 3.5 (PEP 484) | 3.12 (PEP 695) | `bunking/sync/bunk_request_processor/services/phase3_disambiguation_service.py:6,20` | 1 declaration |
| **LOW** | `dataclasses.replace(obj, field=value)` | `copy.replace(obj, field=value)` (generalizes — works for any class implementing `__replace__`) | 3.7 (`dataclasses`) | 3.13 (`copy.replace`) | `bunking/solver/impossibility.py:23`, `bunking/sync/.../phase1_parse_service.py:7`, `bunking/sync/.../deduplicator.py:193` | 3 |
| **LOW** | Enable ruff `PLC0415` (`import-outside-toplevel`) — currently not in the enabled rules list | turn on the rule; clean offenders first | n/a | ruff 0.4+ | repo-wide; one known offender surfaced by PR #1529 review (`test_analyze_objective_sensitivity.py` had `import pytest` inside a test body) | 1 known + however many a fresh pass surfaces |

### §b — Survey status (features ≥ 3.11, plus 3.10 cleanups verified)

Each row records the actual search expression so the next audit can pick up where this one stopped looking.

| Feature | Status | Evidence |
|---|---|---|
| PEP 604 `X \| Y` unions (3.10) | **already adopted** | `grep -rn 'from typing import.*\bUnion\b' --include='*.py' api bunking campminder scripts tests` → 0; `grep -rn '\bOptional\[' …` → 3 (all in docstrings of `tests/unit/sync/bunk_request_processor/social/test_ranked_candidate_passthrough.py`) |
| PEP 585 builtin generics (`list[X]`, `dict[K,V]`) (3.9) | **already adopted** | `grep -rEn '\b(Dict\|List\|Tuple\|Set\|FrozenSet)\[' --include='*.py' …` → 10 hits, all inside docstring text |
| `match` statement (PEP 634, 3.10) | **dismissed** | `grep -rEn '^\s*match [a-zA-Z_(]' --include='*.py' …` → 0 real `match X:` statements; the 16 hits were all `match = regex.match(...)` assignments. 18 `elif isinstance(...)` candidates exist but inspection in context shows all are 2-branch or mix value-based + type-based predicates — match doesn't improve them. See "Retired" below. |
| `datetime.UTC` (3.11) | **already adopted** | `grep -rln 'from datetime import.*UTC\b' …` → 23 files; `grep -rn 'timezone\.utc' …` → 0 legacy holdouts |
| `tomllib` (3.11) | **dismissed** | `grep -rn 'import tomli\|import toml\b\|from tomli\|from toml ' …` → 0; project doesn't parse TOML at runtime |
| `typing.Self` (3.11) | **dismissed** | `grep -rln 'from typing import.*Self\b\|typing\.Self\b' …` → 0; `grep -rEn 'def [a-z_]+\(cls,?.*\) -> ["\047][A-Z]' …` → 0 awkward forward refs |
| `ExceptionGroup` / `except*` (3.11) | **dismissed** | `grep -rn 'ExceptionGroup\|except\*' …` → 0; the one `return_exceptions=True` site at `batch_processor.py:348` is the TaskGroup migration target, not a separate ExceptionGroup row |
| `StrEnum` / `IntEnum` (3.11) | **already adopted** | `grep -rn 'StrEnum\|IntEnum' --include='*.py' …` → 4 files (`api/constants/geo.py`, `bunking/satisfaction/request_registry.py`, `bunking/bunking_validator.py`) |
| `typing.LiteralString` (3.11) | **dismissed** | `grep -rn 'LiteralString' …` → 0; no SQL-builder layer that would gate on it (raw SQL is in scripts/tests only) |
| PEP 695 generic syntax (3.12) | **partially adopted** | `grep -rEn 'def [a-zA-Z_]+\[[A-Z]' …` → 3 functions (`api/services/breakdown_calculator.py:57,108`, `api/services/retention_service.py:412`); `grep -rn '= TypeVar(' …` → 1 holdout — see §a |
| `@override` decorator (3.12) | **surveyed — not actionable** | `grep -rn '@override' …` → 0; `grep -rEn '^class [A-Z][a-zA-Z_]*\([A-Z]' …` → 289 inheritance lines (27 non-Pydantic/Enum/Protocol). Adding `@override` retroactively across the AIProvider hierarchy and ABCs is a discipline policy, not a row. Decide separately whether to add the ruff rule (`PLR6301`/`misc-no-explicit-override`) before opening PRs. |
| `itertools.batched` (3.12) | **see §a** | `grep -rn 'itertools\.batched' …` → 0 already-adopted sites; 24 `range(0, len(...))` candidates verified |
| PEP 695 `type` statement / `TypeAlias` (3.12) | **dismissed** | `grep -rn 'TypeAlias\b' …` → 0; `grep -rEn '^type [A-Z]' …` → 0; no aliases to migrate |
| `from __future__ import annotations` redundancy (3.14, PEP 649) | **✓ shipped #1578** | `grep -rl 'from __future__ import annotations' …` → 510 files. **NOT a universal no-op:** 467 deleted; 43 files with `if TYPE_CHECKING:` + bare annotations kept the import (load-bearing under PEP 649 — see §c #3 + Process lessons). |
| `typing.TypeIs` (3.13) | **dismissed** | `grep -rn 'TypeGuard' …` → 0 callers; nothing to migrate |
| `typing.ReadOnly` TypedDict fields (3.13) | **surveyed — low value** | `grep -rln 'TypedDict' …` → 6 files; none are mutated cross-module in ways `ReadOnly` would catch. Re-survey if a TypedDict bug surfaces. |
| `copy.replace()` (3.13) | **see §a** | 3 `dataclasses.replace` callsites verified |
| PEP 696 TypeVar defaults (3.13) | **dismissed** | `grep -rn 'TypeVar.*default=' …` → 0; the single remaining TypeVar will get folded into PEP 695 anyway |
| PEP 702 `@deprecated` (3.13) | **dismissed** | `grep -rn '@deprecated' …` → 0; no `DeprecationWarning` discipline in the codebase yet |
| PEP 750 t-strings (3.14) | **deferred** | `grep -rEn "f['\"](SELECT\|INSERT\|UPDATE\|DELETE\|CREATE TABLE\|ALTER TABLE\|DROP) " …` → 5 SQL f-strings in `scripts/setup/seed_from_prod.py` (3), `tests/test_seed_from_prod.py` (1), plus 2 multiline in `api/services/metrics_sql_repository.py`. None are user-input-driven (table/column identifiers only), and PocketBase/SQLite have no t-string-aware API. Re-evaluate when a downstream library accepts `Template`. The prior audit's "no SQL/HTML template builders" claim was wrong — corrected here. |
| `compression.zstd` (3.14) | **dismissed** | `grep -i 'zstd\|zstandard' pyproject.toml` → 0; no zstandard dep |
| `@dataclass(slots=True, kw_only=True, frozen=True)` defaults | **surveyed — not a campaign** | `grep -rn '@dataclass' …` → 85 declarations across the codebase; only 1 currently sets `slots=True`. Hottest file `bunking/sync/.../core/models.py` has 9 dataclasses. Apply opportunistically when touching a file for another reason — not worth a sweep PR. |

### §c — Ranked execution order

**Status values:** blank (ready) · `next` (start here) · `PR open #N` (in flight, not yet merged) · `✓ shipped #N` (merged) · `skipped (reason)` · `deferred` · `gated (...)`. Per Part B step 6, statuses flip from `PR open` to `✓ shipped` after merge.

| # | Row | Status | Score (s/m/t/r/p) | Notes |
|---|---|---|---|---|
| 1 | PEP 695 generic syntax on `phase3_disambiguation_service.py` | **✓ shipped #1574** | 1/1/1/1/1 = 5 | 1 file, drop `TypeVar` import + retype methods using `[T]`. Trivial; ships fast. |
| 2 | Enable ruff `PLC0415` (`import-outside-toplevel`) + sweep production offenders | **✓ shipped #1575** | 3/2/1/3/1 = 10 | Audit-count correction: prior audit said "1 known offender"; real count was 1,871 (1,567 tests + 304 production). Path B chosen: per-file-ignore `tests/**` + `api/services/test_*.py`, then sweep 108 production hoists + 4 `# noqa: PLC0415` for genuine circular-import / test-monkeypatch cases. Original score of 5 was wrong; corrected to 10. |
| 3 | `refactor(api): drop redundant __future__ annotations import` | **✓ shipped #1578** | 3/1/1/1/1 = 7 | Mechanical-but-verify sweep. Codemod: `sed -i '/^from __future__ import annotations$/d'` + `ruff check --fix --select I` + `ruff format`. **Audit-count correction:** prior premise said all 510 redundant; **only 467 are.** 43 files pair `if TYPE_CHECKING:` imports with **bare** annotations where the import is **load-bearing** under PEP 649 — accessing `__annotations__` (via `inspect.signature`, `unittest.mock` `spec=`, FastAPI introspection, dataclass field collection) evaluates the bare annotation → `NameError` on the `TYPE_CHECKING`-only name. PEP 563 kept those as strings; PEP 649 evaluates them. The full pytest suite caught it (4 files via `Mock(spec=)`); the 43 were restored. Verified: 4962 passed + `mypy --strict` clean. |
| 4 | `refactor(api): copy.replace for dataclasses.replace` | **PR open #1579** | 1/1/1/1/1 = 5 | 3 callsites; mostly cosmetic. Could be bundled with #1 since both are 1-file touches — but they're in different files; keep separate per PR-sizing rules. |
| 5 | `refactor(api): itertools.batched for chunking` | **PR open #1582** | 3/1/1/2/1 = 8 | Verified count: 23 converted across 10 files (not "24 across 12"); 1 deliberately skipped (`ai_service.py:151` reuses the running index `i` for `batch_indices`). All calls `strict=False` (preserves short-final-batch). Tuple-vs-slice: 18 iterate-only (direct), 3 attendee helpers widened `list[int]`→`Sequence[int]`, 2 list-comp forms keep `list[list[...]]` via `[list(b) for b in batched(...)]`. ruff `B911` requires explicit `strict=`. |
| 6 | `refactor(api): adopt asyncio.TaskGroup for asyncio.gather` | | 3/3/2/3/1 = 12 | Behavioral contract change: callers will start seeing `ExceptionGroup` on partial failure instead of one of `gather`'s silently-dropped siblings. Audit each call's error-handling block before converting. Don't include the `return_exceptions=True` site at `batch_processor.py:348` — that one deliberately collects exceptions; the TaskGroup translation is a different pattern (catch the group and inspect `.exceptions`). |

**Tie-breakers:** none of these rows unblock each other directly. #1–#4 can ship in any order; #5 before #6 (smaller blast radius first lets reviewer fatigue settle before the big behavioral one).

### Retired as false positives (calibration for future audits)

These survived the regex pass in the previous (pre-§a/§b/§c) audit before being killed on inspection. Worth remembering because the same regexes will keep matching:

| Pattern | Where (prior audit's claim) | Why it failed |
|---|---|---|
| `match` statement replacing isinstance chains | "~15–20 hits across 4 files" | 18 `elif isinstance` hits exist but every one is either 2-branch (debug.py keywords/list-vs-str, campminder/client.py dict-vs-list, phase2 dict-vs-(int,str)) or mixes value comparison with type checks (metrics_repository.py: `elif status_filter == "enrolled"` between two `isinstance(…, list)` branches). The prompts doc's bar is ">2 branches"; none qualify. **Lesson: don't count `elif isinstance` lines — count distinct >2-branch type-only chains.** |
| Residual `Optional[X]` → `X \| None` | "3 hits in test_ranked_candidate_passthrough.py:65,67" | All 3 hits sit inside a docstring describing a refactor (`Optional[Tuple[int, float, str]]` is plain text, not an annotation). **Lesson: filter grep hits for `--include='*.py'` AND verify they're not inside `"""..."""`. Or add `--exclude-dir` for docstring-heavy files.** |
| `typing.ReadOnly` for `geo_normalizer/normalizer.py:20` | "1 hit" | The previous audit listed normalizer.py as a `ReadOnly` candidate; the actual line is an unrelated import. No TypedDict in the file would gain from `ReadOnly`. |
| "no SQL/HTML template builders that would benefit from PEP 750" (Not-applicable list) | (claimed clean) | 5–7 SQL f-strings exist in `scripts/setup/seed_from_prod.py`, `tests/test_seed_from_prod.py`, `api/services/metrics_sql_repository.py`. Moved to §b as **deferred** — t-strings are real candidates, just not actionable without library support. **Lesson: "no candidates" claims need a search expression; the audit had none for PEP 750.** |

### Process lessons (carried into `modernization-prompts.md` Rules 1–3)

- **Counts decay between audits.** Previous audit said "~250 `__future__` files" — actually 510. "11 batched candidates" — actually 24. "41 `@dataclass`" — actually 85. Always re-grep before opening the PR; never reuse a stale count.
- **Docstring text matches Python regexes.** Both the `Optional[X]` and `Dict/List/Tuple` rows in the previous audit triggered on docstring contents. Either exclude docstrings or grep only at file-imports.
- **`elif isinstance` ≠ `match` candidate.** Most chains in this codebase are 2-branch, mixed-predicate, or `else`-terminated dictionary parsers. The `match` statement doesn't help any of them. Don't count regex hits; count >2-branch type-only chains.
- **Three functions already use PEP 695** scoped-generic syntax (`api/services/breakdown_calculator.py`, `api/services/retention_service.py`). The previous audit didn't notice. The remaining single `T = TypeVar` is the last holdout, not the lonely sentinel the prior audit framed it as.
- **`from __future__ import annotations` is NOT redundant in `if TYPE_CHECKING:` files (PEP 649 ≠ PEP 563).** Dropping it broke 43 files (#1578). Mechanism: under PEP 563 (the future import) `__annotations__` holds *strings* and `TYPE_CHECKING`-only names are never evaluated; under PEP 649 (3.14 default) *accessing* `__annotations__` **evaluates** bare annotations → `NameError` on names that only exist under `if TYPE_CHECKING:`. The triggers are everywhere annotations get read at runtime: `inspect.signature`, `unittest.mock` `Mock(spec=X)`, FastAPI endpoint/dependency introspection, dataclass field collection, `typing.get_type_hints()`. **Lesson for the next sweep: before deleting the import, exclude every file containing `if TYPE_CHECKING:` (any alias form too). The test suite only catches the subset that a `Mock(spec=)`/`inspect` path happens to exercise — the rest are latent landmines, so scope by the guard, not by the test failures.**

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
