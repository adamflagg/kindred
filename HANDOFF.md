# HANDOFF — Family Camp Lodging

**State as of `dc9437e9` on `main`.** The lodging **data layer** and **ingest** are complete and
merged. The **surfaces** (read API, roster page, admin CRUD) are not started — that is the next
body of work.

This is a working document. Edit it in place: tick what ships, rewrite "Next", delete what stops
being true. It is not a changelog — `git log` is the changelog.

---

## 1. Programme status

Three plans. The first two are done.

| Plan | Scope | Status |
|---|---|---|
| **1 — Data layer** | `lodging_*` collections, seed, alias registry | ✅ merged (`49d38ff8`, #1867) |
| **2 — Ingest** | CampMinder cabin fields → assignments, requests, PHI split | ✅ merged — see below |
| **3 — Surfaces** | Read API, `/weekend` roster, `/admin/lodging` editor | ⬜ **not started** |

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
- **Highest migration is `1500000126`.** Compute the next number from `main`, never from a branch.

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

---

## 4. Next: Plan 3 — Surfaces

Plan: `docs/superpowers/plans/2026-07-30-family-camp-lodging-surfaces.md` (local-only, gitignored).

Three independently shippable PRs, in order:

| Phase | Tasks | Ships | Depends on |
|---|---|---|---|
| **A — Read API** | 1–6 | `/api/lodging/*`, `lodging.phi` permission, regenerated TS types. No UI change. | `main` |
| **B — Roster page** | 7–12 | `/weekend` roster replacing the placeholder. | Phase A merged |
| **C — Admin CRUD** | 13–17 | `/admin/lodging` editor, Go integrity guards, work queue UI. | Phase B |

Do not start B before A merges — B imports TypeScript generated from A's Pydantic models.

### ⚠️ The plan's own "Branch base" section is stale

It says Plan 1 is *"PR #1867, still OPEN"* and *"the `lodging_*` collections do not exist on `main`"*,
and tells you to branch off `feature/family-camp-lodging`. **All of that is false now.** #1867 merged,
along with three more lodging PRs. Branch Phase A off **`main`**. That worktree and branch are gone.

Treat the rest of the plan's Global Constraints as current — they were verified empirically and the
failure modes they describe are silent ones.

---

## 5. CRITICAL: first action before anything else

Confirm the schema Plan 3 reads actually exists, before writing a line against it:

```bash
cd "$(git rev-parse --show-toplevel)/pocketbase" && go build -o pocketbase . && \
  timeout 25 ./pocketbase serve --http=127.0.0.1:8988 --dir=./pb_data >/dev/null 2>&1
sqlite3 pocketbase/pb_data/data.db \
  "SELECT name FROM _collections WHERE name LIKE 'lodging_%' ORDER BY name;"
```

Expect all seven: `lodging_areas`, `lodging_assignment_history`, `lodging_assignments`,
`lodging_availability`, `lodging_field_mappings`, `lodging_ingest_issues`, `lodging_merges`,
`lodging_unit_aliases`, `lodging_units`. If `lodging_ingest_issues` is missing, migrations have not
applied — fix that before anything else, because Plan 3 Task 1 will otherwise "helpfully" create a
duplicate work-queue collection that §3 forbids.

---

## 6. What you should NOT do

- **Do not create `lodging_unresolved_aliases`.** See §3. The plan tells you to; the ruling overrides it.
- **Do not number a migration from a branch.** Highest on `main` is `1500000126`. Compute it:
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
# Go gates — per task, not per phase
cd pocketbase && go test ./sync/ -count=1 && gofmt -l sync/ && go build ./...
rtk proxy golangci-lint run ./sync/...

# JS migrations (npm run lint gives a FALSE failure under rtk)
cd pocketbase && ./node_modules/.bin/eslint pb_migrations pb_hooks

# Lodging harnesses
./scripts/dev/verify-lodging-schema.sh && ./scripts/dev/verify-lodging-seed.sh
./scripts/dev/verify-no-hardcoded-lodging.sh
./scripts/dev/verify-lodging-backfill.sh pocketbase/pb_data/data.db 2024 2025

# Verify a push actually landed (a wrapper's "ok" is a claim, not evidence)
git fetch -q && git rev-list --count origin/<branch>..HEAD   # must be 0
```

---

## 8. Open issues

- **#1881** — two pre-existing package-wide patterns the ingest inherited rather than introduced:
  every individual-sync handler in `api.go` mutates the orchestrator's singleton service, and
  `SyncTab`'s card guard references no type-specific `isPending`. Both want **one sweep across all
  sync types** — fixing them for lodging alone would leave the package inconsistent.
- **#1864** — spurious `uv.lock` re-resolution dirties every fresh worktree. Discard it; `main`'s
  lockfile is authoritative.
- **Untested error branches on `main`** — `write_failed` queueing and the unconditional WAL
  checkpoint landed without direct tests. A stub `core.App` whose `Save` errors on the assignments
  collection would cover the first, which is the one with real behaviour behind it.
