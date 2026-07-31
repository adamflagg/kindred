# HANDOFF — Family Camp Lodging

**State as of `f99a8ef7` on `main`.** The lodging **data layer**, **ingest** and the surfaces'
**read API** are complete and merged. `/weekend` still shows its placeholder: the next body of
work is Plan 3 Phase B, the roster page that consumes the API.

This is a working document. Edit it in place: tick what ships, rewrite "Next", delete what stops
being true. It is not a changelog — `git log` is the changelog.

---

## 1. Programme status

Three plans. The first two are done.

| Plan | Scope | Status |
|---|---|---|
| **1 — Data layer** | `lodging_*` collections, seed, alias registry | ✅ merged (`49d38ff8`, #1867) |
| **2 — Ingest** | CampMinder cabin fields → assignments, requests, PHI split | ✅ merged — see below |
| **3 — Surfaces** | Read API, `/weekend` roster, `/admin/lodging` editor | 🔶 Phase A merged (`f99a8ef7`, #1884); B and C open |

Plan 2 shipped in four PRs:

| Phase | Tasks | Commit | What |
|---|---|---|---|
| A — source-field correctness | 1–3 | `78ef6d8d` (#1872) | four silently-broken columns in `family_camp_derived.go` |
| B1 — ingest primitives | 4–10 | `2b28e0fa` (#1877) | work queue, alias resolver, merges, session attribution, grain guard |
| B2 — ingest on | 11–14 | `0cf6420b` (#1880) | both grains, history, job registration, backfill gate |
| C — request layer + PHI | 16–19 | `b3fa243d` (#1878) | household-grain collapse, housing flags, PHI containment |

Task 15 was **rejected**, not deferred — see §3.

---

## 2. What is live on `main`

Facts, not a work log. Do not re-verify or re-implement these.

- **The lodging assignment ingest runs as a registered sync job** (`lodging_assignments`, transform
  phase, after `family_camp_derived`). API route, status list, orchestrator registration, daily
  `orderedJobs`, export-skip map and six frontend files are all wired.
- **Both grains ingest.** Household grain from `Family Camp Cabin`; person grain (adult weekends)
  from `Reportable Family Camp Cabin`. Placements resolve through the temporal alias table, attribute
  to a weekend, and append `lodging_assignment_history` on change.
- **Unresolvable and ambiguous inputs become work-queue rows, never assignments.**
  `lodging_ingest_issues.kind` is a **7-value select**: `unresolved_alias`, `ambiguous_alias`,
  `ambiguous_session`, `no_session`, `field_zero_values`, `unknown_party`, `write_failed`.
  The Go constants are *not* the constraint — the migration's select list is, and
  `verify-lodging-schema.sh` pins it exactly.
- **Backfill is validated end to end against real data.** 2024+2025 in ~7s, 1336 assignments, zero
  errors, idempotent on a second pass. `scripts/dev/verify-lodging-backfill.sh` is the gate.
- **The request layer is household-grain.** Request fields are person-partition, so a household with
  two enrolled children stores the same answer twice; it is collapsed before anything reads it.
- **Housing flags are derived and PHI-free**: `needs_private_bathroom`, `needs_power`,
  `accommodation_is_mandatory`, `has_infant`. The narrative behind them lives only in
  `family_camp_medical`, which is admin-gated on all five rules and absent from every export config.
- **`/api/lodging/*` is live** (Phase A, `f99a8ef7`): `GET /sessions`, `GET /roster`, and
  `GET /households/{cm_id}/medical` behind `Permission.LODGING_PHI`. Repository → service → thin
  router, all unit-tested against mocks. The generated TypeScript is committed, so Phase B imports
  `WeekendRosterResponse` and friends from `frontend/src/types/api-generated/`.
- **The read API consumes ingest-derived columns; it does not re-parse raw answers.** The share
  gate, the NEAR/WITH/similar-ages modes, the request text and the four housing flags are all
  read from `family_camp_registrations`. See §3.
- **`wants_similar_ages` is derived** (`1500000127`). It IMPLIES `wants_with` — the option it comes
  from begins "Share a cabin WITH", and what differs is only that the partner is unnamed, which is
  what makes those households the staff-matchable pool.
- **PHI is enforced by construction, not convention.** `HouseholdMedicalResponse` is the only model
  carrying narrative, and `tests/unit/api/test_lodging_phi_boundary.py` walks the whole model graph
  from `WeekendRosterResponse` to prove no PHI field is reachable. `PHI_FIELD_NAMES` has **eight**
  entries and a test pins it against Go's `phiColumns`, because the two guard different exits —
  Go keeps PHI out of exports and logs, Python keeps it out of API payloads.
- **Highest migration is `1500000127`.** Compute the next number from `main`, never from a branch.

---

## 3. Decisions locked

Each of these was decided deliberately. Reopening one needs a reason, not a fresh read of the code.

- **The ingest work queue is ONE collection: `lodging_ingest_issues`.** Plan 3's draft defines its own
  `lodging_unresolved_aliases`. **Do not create it.** Plan 2's model is a superset (it carries `kind`,
  `candidate_session_cm_ids`, `suggested_session`) and is the sole producer; the admin UI only reads
  and resolves. Plan 3's Phase A Task 1 migration for that collection must be **deleted**, and its
  work queue pointed at `lodging_ingest_issues` filtered to `kind = "unresolved_alias"`.
- **The Wawona / Doctor's House alias reconcile is rejected** (Plan 2 Task 15, spec §9a note 8). The
  building is let whole *or* split depending on the session's housing needs — staff-confirmed. An
  alias has a *year* window and no session dimension, so it structurally cannot express that.
  Per-session arrangement is what `lodging_merges` is for. Do not re-derive this from occupancy
  numbers; the 2024 peak of 7 in one household is one session's arrangement, not a rule.
- **`opt_out_vip` and `accommodation_is_mandatory` are one three-state answer** (`dc9437e9`, #1874):
  mandatory → some member cannot attend without it; opt-out → answered and the family will come
  anyway; both false → nobody answered. A blocker anywhere in the household clears the opt-out, in a
  finalization pass rather than the per-member switch, because the switch cannot see a later member.
- **`SyncJobToCollections` membership is not an export.** It powers only the export-skip
  optimisation. No `lodging_*` collection is exported to Sheets, and `lodging_phi_test.go` asserts it.
- **Known exposure, recorded not fixed:** `person_custom_values` / `household_custom_values` *are*
  exported to Sheets with names and raw values, so PHI narrative already reaches Sheets through the
  raw tables. Predates this work; staff may depend on the sheet. Narrowing it is an owner decision.
- **The surfaces READ the ingest-derived request columns. They never re-parse the raw answers.**
  `share_cabin_gate`, `wants_near`, `wants_with`, `wants_similar_ages`, `request_text` and the four
  housing flags are all written by Go. Re-deriving any of them in Python forks two fixes that exist
  only on the Go side: `NormalizeShareGate` requires the sentence to contain `"shar"` before a
  leading "no" reads as a decline (else the modes field's own "No requests" option — 209 rows across
  2025-2026 — silently strips a household's pairing eligibility), and `ParseSharedCabinModes` tests
  the modes independently rather than as ordered arms. One writer, one reader: if a value looks
  wrong, fix it in the ingest so every surface sees the correction.
- **The share vocabulary is Go's, end to end.** `no_share | maybe_mutual | yes_share`, with an empty
  column rendering as `unknown`. Proximity is `near | with | similar_ages`, and `similar_ages` always
  accompanies `with` rather than replacing it. `request_text` is ONE pre-joined string — the ingest
  joins three source fields with `"; "` and that join is lossy to reverse, so do not split it.

---

## 4. Next: Plan 3 Phase B — the `/weekend` roster page

Plan: `docs/superpowers/plans/2026-07-30-family-camp-lodging-surfaces.md` (local-only, gitignored),
Tasks 7–12, starting around line 3251.

| Phase | Tasks | Ships | Status |
|---|---|---|---|
| **A — Read API** | 1–6 | `/api/lodging/*`, `lodging.phi`, generated TS types | ✅ `f99a8ef7` (#1884) |
| **B — Roster page** | 7–12 | `/weekend` roster replacing the placeholder | ⬜ **next** |
| **C — Admin CRUD** | 13–17 | `/admin/lodging` editor, Go integrity guards, work queue UI | ⬜ after B |

Phase B deletes `frontend/src/pages/WeekendHousingDashboard.tsx` (the placeholder) and swaps the
lazy import and `/weekend` index route in `App.tsx`. Commit scope `frontend`.

### ⚠️ The plan is stale in five specific places — all verified against `main`

It was drafted before the ingest request layer landed, so parts of it describe a world that no
longer exists. Treat the rest of its Global Constraints as current; those were verified empirically
and their failure modes are silent.

1. **"Branch base"** says Plan 1 is an open PR and `lodging_*` does not exist on `main`. False —
   branch off `main`.
2. **It has the surfaces deriving share/proximity/request-text.** They do not — see §3.
3. **`lodging_unresolved_aliases`** must not be created. The work queue is `lodging_ingest_issues`
   filtered to `kind = "unresolved_alias" && is_resolved = false`.
4. **`PHI_FIELD_NAMES` is listed with six entries.** There are eight; `bathroom_explain` and
   `accommodation_explain` arrived with `1500000126`.
5. **Its `SharePreference` vocabulary (`mutual_only`/`open`) is invented.** The wire vocabulary is
   Go's — see §3.

### Phase A's shape, which Phase B consumes

Review (#1884) changed the repository surface from what the plan describes:

- `get_household_medical` no longer loads every household and every medical row. It calls
  `fetch_household_by_cm_id` and `fetch_medical_for_household` — two narrow reads.
- The two count helpers use `get_list(1, 1)` and read `total_items` via a private `_count`, not
  `get_full_list` + `len()`. **A test double that stubs `get_full_list` for a count silently returns
  a MagicMock instead of an int.**
- Every paginated read now sends `sort` (`STABLE_SORT = "id"` where there is no display order),
  because `get_full_list` walks LIMIT/OFFSET and SQLite may reorder rows between pages. Tests
  asserting exact `query_params` dicts must include it.
- `fetch_session` is type-filtered, so a summer `cm_id` on `/api/lodging/roster` now 404s instead of
  being handed a household-grain roster.

---

## 5. CRITICAL: first action before anything else

**The request columns Phase B renders are EMPTY until a sync runs.** They are schema-only on any
database that has not run `family_camp_derived` since #1878. Build the roster UI against that and
every party renders with `preference: "unknown"`, no proximity, no request text and no flags — and
it will look like the API is broken when it is working exactly as designed.

```bash
sqlite3 pocketbase/pb_data/data.db \
  "SELECT year, COUNT(*) n, SUM(share_cabin_gate!='') gate, SUM(request_text!='') req
     FROM family_camp_registrations WHERE year >= 2025 GROUP BY year;"
```

If `gate` and `req` are `0`, populate before building anything:

```bash
./scripts/start_dev.sh   # boots PocketBase, which applies 1500000127
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2026&service=family_camp_derived"
```

Then re-run the query and confirm non-zero. Only then start Task 7.

---

## 6. What you should NOT do

- **Do not re-parse the raw share/modes/request columns in the UI.** Render what the API sends. The
  raw columns are still on the row for provenance, and reading them re-forks the Go fixes in §3.
- **Do not render `similar_ages` as an alternative to `with`.** It accompanies it. A chip that shows
  one *or* the other drops 22 households out of any "wants to share" view.
- **Do not render `sleeps: null` as 0.** `null` is UNKNOWN — the API already maps PocketBase's
  stored `0` to `null`, and `units_capacity_unknown` reports how many. "Sleeps 0" is a lie.
- **Do not sum capacity over units where `is_container` is true.** They are building rows carrying
  whole-building aggregates; including them gives 408 beds against a true 389.
- **Do not create `lodging_unresolved_aliases`.** See §3. The plan tells you to; the ruling overrides it.
- **Do not number a migration from a branch.** Highest on `main` is `1500000127`. Compute it:
  `git ls-tree -r origin/main pocketbase/pb_migrations/ | grep -oE '15000[0-9]{5}' | sort -u | tail -1`
- **Do not add a `kind` value as a Go constant without the migration.** The select list is the
  constraint; a bare constant passes tests and fails in production.
- **Do not read `opt_out_vip` as the blocker gate.** `accommodation_is_mandatory` is the gate.
- **Do not add any `lodging_*` collection to `GetReadableYearExports()` / `GetReadableGlobalExports()`,
  and never log a `family_camp_medical` text field.** `lodging_phi_test.go` fails on both, deliberately.
- **Do not "simplify" `> 0` predicates or the `eqOrEmpty` helper.** SQLite evaluates `0 != ''` as TRUE,
  and a bound empty-string parameter matches nothing — both silent.
- **Do not run `golangci-lint` only at the end of a phase.** Per task. Several lint failures reached
  push time in this programme precisely because it was deferred.
- **Do not commit `docs/superpowers/**` or `docs/plans/**`.** Gitignored, local-only, public repo.

---

## 7. Useful one-liners

```bash
# Frontend gates — Phase B's daily loop. NOT `npm run lint`: the rtk proxy
# mangles the npm wrapper's output into a false failure.
cd frontend && node_modules/.bin/eslint src --ext ts,tsx   # 0 errors; ~348 pre-existing warnings
cd frontend && npm run type-check
cd frontend && npx vitest run src/components/weekend/

# Python gates
uv run ruff format api bunking tests && uv run ruff check api bunking tests
uv run mypy api bunking
uv run pytest tests/unit/api/ -q

# Go gates — per task, not per phase
cd pocketbase && go test ./sync/ -count=1 && gofmt -l sync/ && go build ./...
rtk proxy golangci-lint run ./sync/...

# JS migrations (npm run lint gives a FALSE failure under rtk)
cd pocketbase && ./node_modules/.bin/eslint pb_migrations pb_hooks

# Lodging harnesses (all three now share scripts/dev/lib/pb-harness.sh, #1885)
./scripts/dev/verify-lodging-schema.sh && ./scripts/dev/verify-lodging-seed.sh
./scripts/dev/verify-no-hardcoded-lodging.sh
./scripts/dev/test-pb-harness.sh && ./scripts/dev/test-verify-no-hardcoded-lodging.sh
./scripts/dev/verify-lodging-backfill.sh pocketbase/pb_data/data.db 2024 2025

# Verify a push actually landed (a wrapper's "ok" is a claim, not evidence)
git fetch -q && git rev-list --count origin/<branch>..HEAD   # must be 0
```

---

## 8. Open issues

- **#1887** — `lodging.phi` is granted to **no role**, and `1500000070_rbac_roles.js` was untouched
  by #1884. `require_permission` admin-bypasses, so admins reach the medical endpoint and every
  non-admin gets a 403 that no role edit resolves. Defensible as default-deny for PHI, but it will
  surprise whoever first tries to give a health-centre lead access. **Phase B should assume the
  narrative reveal is admin-only in practice** and degrade gracefully when the call 403s.
- **#1881** — two pre-existing package-wide patterns the ingest inherited rather than introduced:
  every individual-sync handler in `api.go` mutates the orchestrator's singleton service, and
  `SyncTab`'s card guard references no type-specific `isPending`. Both want **one sweep across all
  sync types** — fixing them for lodging alone would leave the package inconsistent.
- **#1870** — `.coderabbit.yaml` recommends a WAL checkpoint after data-write migrations that zero
  of 15 such migrations perform. Needs an adopt-or-drop decision; the evidence in the issue favours
  drop. Until settled, CodeRabbit flags it on every seed migration.
- **#1864** — `uv.lock` is genuinely out of sync with `pyproject.toml`, and CI hides it by installing
  with `--frozen`. CI is still linting with ruff 0.15.22 and type-checking with mypy 2.1.0 while the
  manifest declares 0.16.0 / 2.3.0. Regenerating it will surface real findings — that is the point of
  the bumps, and the reason it keeps re-resolving in every fresh worktree.
- **Shipped unfixed, unfiled:** the roster router raises 404 but declares no `responses={404: ...}`,
  so the generated error type carries only 422. Accurate, but `responses=` appears in zero routers
  under `api/routers/` while five raise 404 — a package-wide gap, not this router's.
- **Untested error branches on `main`** — `write_failed` queueing and the unconditional WAL
  checkpoint landed without direct tests. A stub `core.App` whose `Save` errors on the assignments
  collection would cover the first, which is the one with real behaviour behind it.
