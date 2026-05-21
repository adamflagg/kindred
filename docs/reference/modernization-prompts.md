# Modernization Prompts

Companion to `modernization-backlog.md`. Two prompts, one workflow:

- **Part A** — *Build* (or upgrade) a language section of the backlog.
- **Part B** — *Execute* a section row-by-row, one tiny PR at a time.

Run Part A rarely (once per language, then again on toolchain bumps). Run Part B constantly.

---

## Front door: which section?

If you were invoked with this prompt and no language/section specified, do **not** guess. List the section headings from `modernization-backlog.md` and ask the user to pick one. Default options:

> The modernization backlog has these sections:
> - §1 Python (3.14)
> - §2 Go (1.26) — uses §a/§b/§c structure
> - §3 Frontend (React 19, TypeScript 6.0, Node 22, Tailwind 4) — uses §a/§b/§c structure
> - §4 Infrastructure + Caddy (hardening checklist, different artifact)
>
> Which section should I work in? And do you want **Part A** (re-run / upgrade the audit for that section) or **Part B** (execute the next row)?

Once the user picks, proceed to Part A or Part B as instructed below.

If the user named a section or row in their original invocation, skip this step and go straight to the named work.

---

## Rules that apply to both parts

These are load-bearing. Every section that has skipped them has produced bugs or stale docs.

### Rule 1: Verify in context, not against the regex

A grep hit is a *candidate*, not evidence. Every match must be inspected with surrounding lines (`rg -A2 -B2`, or by reading the function body) before being added to §a or claimed for a PR.

The backlog's first version had `strings.Index() != -1` → `strings.Contains` listed as a row. The single match in `sync/base_sync.go:1084` looked like a presence check to the regex, but the function body uses `idx` as a slice boundary 7 lines later. `strings.Contains` would discard a value the next 7 lines depend on. The row was retired as a false positive on first inspection.

**Lesson:** if your audit is just `grep | wc -l`, you will produce false positives. The cost of inspecting each candidate's surrounding code is small; the cost of pushing a broken refactor and reverting is large.

### Rule 2: Three independent versions

Every modernization decision touches three versions:

1. **Toolchain version** — what the compiler/runtime accepts (`go.mod`, `pyproject.toml`'s `requires-python`, `package.json`'s `engines.node`, `tsconfig.json`'s `target`).
2. **Installed version** — what's actually on the developer machine and in CI.
3. **Idiom level** — the *highest* language version any line of code idiomatically requires. Usually far below (1) and (2). Code written in 2018-style still compiles on a 2026 toolchain.

The audit's job is to surface (3) and propose moving it closer to (1). Don't go past (1). Don't hand-wave at "no candidates surfaced" — see Rule 1.

### Rule 3: Tests are the spec

For **behavioral** rows (sentinel errors, retry-loop changes, log format changes), follow CLAUDE.md TDD: write a failing test first.

For **pure-rewrite** rows (`clear()`, `slices.Sort`, `interface{}` → `any`, `min`/`max`), the existing tests are the spec. Run them before and after; both must pass. If no existing test covers the rewritten function, write a small spec-lock test (it'll pass on the old code too — that's fine, it locks the contract for the future). Do not invent failing-then-passing tests for code that is bit-equivalent.

`lefthook run pre-push` is the verification gate either way. No "I claim it works" without it.

---

## Part A — Building (or upgrading) a section

Use this when adding a new language to the backlog or when a toolchain bump invalidates the existing section.

The output looks like §2 (Go) of `modernization-backlog.md`: a toolchain-versions preamble, §a (concrete rewrites with two version columns), §b (honest survey-status table), §c (ranked execution order). The process is what produces them honestly.

### Step 0: Establish the three versions explicitly

Open the section with one paragraph that names all three. For Go this looks like:

> Toolchain: `go.mod` declares `go 1.26.0`; locally installed `go1.26.0`. 1.26 is the current stable as of April 2026. Idiom: code mixes pre-1.18 through ~1.21 patterns.

Commands per language:

| Language | Toolchain pin | Installed | Latest stable check |
|---|---|---|---|
| Go | `grep -E '^(go|toolchain) ' go.mod` | `go version` | go.dev/doc/devel/release |
| Python | `grep requires-python pyproject.toml` + `cat .python-version` | `python --version` | python.org/downloads |
| Node | `jq .engines package.json` + `cat .nvmrc` | `node -v` | nodejs.org |
| TypeScript | `cd frontend && jq .compilerOptions.target tsconfig.json` | `cd frontend && npx tsc -v` | typescriptlang.org |

If toolchain < latest, decide explicitly whether bumping is in scope. If toolchain > installed, flag the dev-env drift separately.

### Step 1: Establish the idiom floor

The codebase reads like *the highest* language version any line still requires idiomatically. To find it, walk the per-language version-feature checklist (appendix below) from oldest to newest. The first feature where the legacy pattern is present is the floor.

Example for Go:
- `interface{}` present → idiom floor < 1.18
- `sort.Slice` present → idiom floor < 1.21
- `for i := 0; i < len(s); i++` present → idiom floor < 1.22

**Floor = lowest of the matches, not highest.** That's the oldest version of the language the codebase still relies on idiomatically.

### Step 2: Build §a — concrete rewrites (current targets)

For every `from → to` candidate found in Step 1, capture:

| Column | What it means | Source |
|---|---|---|
| **From (current idiom)** | What's in code today | grep result |
| **To (modern equivalent)** | The modern target | language reference |
| **`from` works since** | Oldest version that accepts the legacy pattern | usually 1.0 / language birth |
| **`to` available since** | Version the modern target became available | release notes |
| **Impact** | HIGH (behavioral/robustness) / MEDIUM (readability/consistency) / LOW (polish) | judgment |
| **Where** | File paths with line numbers, hotspots first | `grep -n` |
| **Count** | Total occurrences | `wc -l` |

**Why two version columns:** the original audit had one ("available since"). It hid the question "is the legacy form even still recommended, or has it been quietly superseded by something newer?" Two columns make this obvious. If `from works since` ≥ `to available since`, the rewrite is purely stylistic (no compile error pressure). If a newer modern target has appeared (e.g. `slices.Chunk` post-1.23 partially obsoletes `for i := range`), note it as a caveat or split the row.

**Apply Rule 1 here.** Every grep hit must be inspected before it lands in this table. If the candidate uses the matched value beyond the literal predicate, it is not a §a row.

### Step 3: Build §b — survey status of features ≥ N

Where N is the version *after* whatever the original audit covered. The original Go audit stopped at ~1.21 features and said "no strong candidates surfaced" for 1.22+ — that's the failure mode this step exists to prevent.

For each post-N feature in the appendix, set status to one of:

- **already adopted** — found existing imports/usage; record the file
- **surveyed** — actually grepped and document the findings (even if zero)
- **dismissed** — surveyed and confirmed no candidates, with the search expression
- **deferred** — real candidates exist, blocked on toolchain bump or ecosystem signal
- **not surveyed** — be honest if you stopped looking

**Never put a feature in §b without including the search expression for the dismissed/surveyed status.** That's how the next audit knows where you stopped looking.

### Step 4: Build §c — ranked execution order

Drop already-adopted / N/A rows. Sort the remaining §a + §b rows by the ranking criteria in Part B's "Ranking criteria" section. Bundle adjacent rows only when they share a file or are both <10 callsites.

The §c table has a "Status" column with values: blank (default, ready), `next` (whoever picks up the loop starts here), `✓ shipped #NNNN`, `skipped (reason)`, `deferred`, `gated (...)`. As rows ship or are skipped, update the status in place — don't delete rows; the audit trail is the value.

If a §a row is retired as a false positive after verification, move it to a "Retired" subsection above the live table with the reason captured. Renumber live items so the loop picks up at #1.

### Step 5: Honesty pass

Before declaring the section done, re-read it and ask:

- Is every "no candidates" claim backed by a search expression?
- Did I conflate "feature added in version X" with "feature is the right choice for our codebase"? (e.g. `encoding/json/v2` is real but a hot-path migration, not a drop-in — call that out.)
- Is anything in §a superseded by something in §b? (For Go: `for i := range s` is partially superseded by `slices.Chunk` for the `i += batchSize` subset. Note it.)
- Did I close any "deferred" rows whose gate has shifted? (E.g. `testing/synctest` was gated on Go 1.25 GA; once 1.25 ships, ungate.)

### Step 6: Close with a survey scope statement

End the section with one line stating the version range covered:

> Survey scope: features added in Go 1.18–1.26. Re-run after toolchain bumps to Go 1.27+.

That way the next audit knows what was already covered.

### Upgrade-in-place mode (when re-running on an existing section)

If a section already has §a/§b/§c (e.g. Go after PR #1066), **do not replace it wholesale**. Walk these explicit preserve rules:

- Preserve `✓ shipped #NNNN` markers in §c
- Preserve "Retired" subsection (false-positive history is load-bearing)
- Preserve `skipped (reason)` rows
- Preserve survey-status entries that still hold (don't redo the grep if the toolchain hasn't moved)
- Update only: rows whose toolchain gate has shifted, rows with new findings from extended grep, rows superseded by features in newer versions

If the section is in pre-redo single-table format (no §a/§b/§c), wholesale replacement is fine.

### How to invoke Part A

> Build (or upgrade) the {language} section of `docs/reference/modernization-backlog.md` following Part A of `docs/reference/modernization-prompts.md`. {Build mode | Upgrade-in-place mode}. Use real grep results, not "no candidates surfaced." Output the new section and the list of survey commands run (so the audit is reproducible).

---

## Part B — Executing a section row-by-row

### Loop

1. **Read** `docs/reference/modernization-backlog.md` §c for the active language section.
2. **Pick the next row** by status `next`, falling through to the lowest-numbered live row. If §c isn't ranked yet (pre-redo section), generate a ranking via the criteria below and present it for approval before starting work.
3. **For the chosen row, write a brief.** Include:
   - **Where:** exact file paths and counts (re-verify with grep — counts decay)
   - **What it does:** describe the rewrite in plain English; show before/after if non-obvious
   - **Why do it:** real benefit (correctness, performance, readability, lint-clean)
   - **Why not:** honest counter-arguments (diff churn, semantic risk, low value)
   - **Alternatives:** any competing modern target (e.g. `slices.Chunk` vs `for i := range`)
   - **My call:** a recommendation, framed so the user can override
4. **Wait for the user's call.** Do not start the PR until they say go.
5. **When go is given:** create a worktree per CLAUDE.md if one isn't already in use, write a failing test if behavioral (per Rule 3), implement, run `lefthook run pre-push`, push, open a tiny focused PR.
6. **After merge:** mark the row `✓ shipped #NNNN` in §c. Return to step 2.
7. **If user rejects the row:** mark it `skipped (reason)` in §c with one-line reason. Return to step 2.

### Section-done criterion

A section is done when every live row in §c is either `✓ shipped`, `skipped (reason)`, or `deferred` with a recorded gate. Trigger a fresh Part A pass when:

- The toolchain bumps to a new minor version (new features available)
- A `deferred` row's gate flips (ecosystem signal arrives)
- "Review cadence" in the backlog says it's time

### Ranking criteria (easiest → hardest)

Score each row by these axes; lower total = easier:

| Axis | 1 (easy) | 2 | 3 (hard) |
|---|---|---|---|
| Scope | 1–3 callsites | 4–20 | 20+ or repo-wide |
| Mechanical vs semantic | pure renames | signature change | behavioral / contract change |
| Test surface | no tests touched | a few tests adjusted | new tests required |
| Blast radius | one file | one package | cross-package |
| Toolchain prereq | none | feature already in use | requires version bump |

**Tie-breaker:** prefer items that *unblock* a later item (e.g. `slices.Chunk` subsumes part of `for i := range` — do `slices.Chunk` first).

### PR sizing rules

- One row per PR by default.
- Bundle two rows only if both are <10 callsites *and* touch the same file(s).
- Title: conventional commit (`refactor(sync):`, `fix(sync):`, etc., per CLAUDE.md scopes).
- Body: link the backlog row by `#` and quote the "what it does" + "why" lines from the brief.
- For codemods (e.g. `interface{}` → `any`), include the exact `gofmt -r` / `sed` / autofix command in the PR body so the change is reproducible.

### Verification before claiming done

Run `lefthook run pre-push`, plus targeted package tests for the touched code. For behavioral changes, re-run the failing test from step 5 to confirm it passes after the implementation. **Never claim "done" before pre-push is green.**

### What this loop does NOT do

- Plan multiple rows in parallel — one PR at a time keeps reviews fast.
- Skip the user-decision step — each row is a small bet; the user makes the call after seeing the brief.
- Update §a or §b retroactively — if a finding goes stale, run Part A in upgrade-in-place mode instead.

### How to invoke Part B

> Resume modernization-backlog execution per Part B of `docs/reference/modernization-prompts.md`. Read `docs/reference/modernization-backlog.md` §{N}c for the active language, identify the next row (status `next`, else lowest-numbered live row, last shipped: #N), and present its brief.

---

## Appendix — per-language version-feature checklists

These are the lookup tables used by Part A Steps 1–3. Each row says "if you find pattern X, you've found a candidate for feature Y added in version Z." Add new rows as language versions ship.

### Go (post-1.18 features)

| Since | Feature | Search expression |
|---|---|---|
| 1.18 | `any` alias | `grep -rn 'interface{}'` |
| 1.18 | generics | `grep -rn 'func [A-Za-z]*\[[A-Z]'` |
| 1.20 | `errors.Join` | `grep -rn 'errors.Join'` (and chained `fmt.Errorf` with `%w` repeated) |
| 1.21 | `slices`, `maps`, `cmp` packages | `grep -rln '"sort"'` (legacy users) |
| 1.21 | `clear()` builtin | manual map-clear loops |
| 1.21 | `min`/`max` builtins | manual `if a > b` ternaries, `math.Min/Max` for ints |
| 1.21 | `log/slog` | `grep -rn 'log.Print'` (legacy users) |
| 1.22 | `cmp.Or` | chained `if x != "" { return x }` patterns |
| 1.22 | `math/rand/v2` | `grep -rn '"math/rand"'` |
| 1.22 | loop-var per-iteration scoping | `for i := 0; i < len(s); i++` (closure-capture safety) |
| 1.22 | `slices.Concat` | `append(x, y...)` |
| 1.23 | range-over-func | callback-iter patterns (`func(...) bool`) |
| 1.23 | `slices.Chunk` | `for i := 0; i < len(x); i += batchSize` |
| 1.24 | generic type aliases | repeated generic instantiations |
| 1.24 | `os.Root` | untrusted-input file ops |
| 1.25 | `testing/synctest` (GA) | `time.Sleep` in tests |
| 1.25 | `encoding/json/v2` | `json.Marshal/Unmarshal` hot paths |

### Python (post-3.10 features, when running on 3.14)

| Since | Feature | Search expression |
|---|---|---|
| 3.10 | `match` statement | long isinstance chains |
| 3.10 | `X \| Y` unions | `from typing import Union` |
| 3.11 | `tomllib` | `tomli`/`toml` usage |
| 3.11 | `Self` type | `TypeVar.*Self`, awkward forward refs |
| 3.11 | `ExceptionGroup` / `except*` | manual exception aggregation |
| 3.11 | `asyncio.TaskGroup` | `asyncio.gather` |
| 3.12 | PEP 695 generic syntax | `TypeVar(...)` declarations |
| 3.12 | `@override` decorator | inheritance hierarchies without it |
| 3.12 | `itertools.batched` | `range(0, len(x), n)` chunking |
| 3.12 | `from __future__ import annotations` | now redundant under PEP 649 (3.14) |
| 3.13 | `typing.TypeIs` | `TypeGuard` users |
| 3.13 | `typing.ReadOnly` | TypedDict mutation concerns |
| 3.13 | `copy.replace()` | `dataclasses.replace` |
| 3.14 | PEP 649 deferred annotations | drop `from __future__ import annotations` |
| 3.14 | PEP 750 t-strings | SQL/HTML template builders |
| 3.14 | `compression.zstd` | zstandard dependency |

### TypeScript / JS (post-ES2020 features)

| Since | Feature | Search expression |
|---|---|---|
| ES2020 | optional chaining `?.` | nested `&&` access |
| ES2020 | nullish coalescing `??` | `\|\|` for default-when-null |
| ES2021 | `String.replaceAll` | `.replace(/.../g, ...)` |
| ES2022 | `Array.prototype.at(-1)` | `arr[arr.length - 1]` |
| ES2022 | `structuredClone` | `JSON.parse(JSON.stringify(x))` |
| ES2022 | error `cause` chaining | `throw new Error(...)` without `cause` |
| ES2023 | `Array.prototype.toSorted/toReversed` | `[...arr].sort()`, `[...arr].reverse()` |
| ES2023 | `Array.findLast` | `.reverse().find()` |
| ES2024 | `Object.groupBy` | `reduce` groupBy patterns |
| ES2025 | `Promise.try` | sync-or-async wrapper logic |
| TS 5.0 | `const` type params | `as const` overuse |
| TS 5.0 | decorators (stage 3) | legacy decorators |
| React 19 | `use()` hook | `useContext` consumers + provider wrappers |
| React 19 | `<Context>` shorthand | `<Context.Provider>` |
| React 19 | `useActionState` / `useFormStatus` | form-submission `useState` |
