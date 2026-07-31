# HANDOFF — Family Camp Lodging

**State as of `abfdbe90` on `main`, with Plan 3 Phase B in review as PR #1890.** The data layer,
the ingest and the read API are merged. Phase B — the `/weekend` lander and roster — is written,
green and pushed, but **not merged**: it is in review, a scan agent is applying fixes to the same
branch, and §4 is how you pick it up.

This is a working document. Edit it in place: tick what ships, rewrite "Next", delete what stops
being true. It is not a changelog — `git log` is the changelog.

---

## 1. Programme status

Three plans. The first two are done.

| Plan | Scope | Status |
|---|---|---|
| **1 — Data layer** | `lodging_*` collections, seed, alias registry | ✅ merged (`49d38ff8`, #1867) |
| **2 — Ingest** | CampMinder cabin fields → assignments, requests, PHI split | ✅ merged — see below |
| **3 — Surfaces** | Read API, `/weekend` roster, `/admin/lodging` editor | 🔶 A merged (`f99a8ef7`, #1884); **B in review (#1890)**; C open |

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

### Locked by Phase B (PR #1890 — binding whether or not it has merged yet)

- **Capacity is measured in SPACES, not beds.** A family holds a whole cabin whether or not it
  fills it, so a cabin sleeping 8 housing a family of 3 strands five beds nobody else can use.
  Beds read 223 of 389 for FC1 — apparent 43% headroom — where the true figure is 62 families into
  79 spaces, 17 spare. Beds stay visible as a *fit* note ("does this family fit this cabin"), which
  is the board's question. **Merging or splitting cabins on the board moves the space count**, so
  the figure is provisional and says so.
- **The roster is a triage surface.** The board places parties; the roster says which need a
  decision. It ranks only on signals that discriminate: measured on real 2026 data
  `needs_resolution` is true for 44 of 62 parties and `has_medical_narrative` for 62 of 62, so
  **neither escalates a row**. A flag that is always on is not a flag.
- **The met/unmet fit check judges only CONFIRMED cabins.** All 82 cabins are `is_confirmed: false`
  today, so an unset `has_power` means "nobody has said", not "there is no power". Judging against
  unset defaults would flag every constrained family on absent evidence, so the check reports
  `unverified` instead and begins working the moment Phase C seeds amenities.
- **The weekend surfaces extend the summer session area's visual language, they do not invent one.**
  `SessionTabs` pill grammar, `SessionStatsCompact` stats bar, `CamperAlertSection` alert rows, the
  camper panel's amber blockquote for request text, Headless UI `Listbox` title-switcher, and
  summer's type scale (`text-xs` floor — no `text-[10px]`/`text-[11px]`).
- **Routes mirror summer**: `/weekend/sessions` (lander) and `/weekend/session/:sessionCmId`
  (roster). `PROGRAM_HOME.weekend` is `/weekend/sessions`.
- **Weekend names split on the colon.** `splitWeekendName` gives "Family Camp 1" for titles and
  pickers and keeps "Memorial Day Weekend" for the lander row. Lossless — inventing abbreviations
  is how a UI starts disagreeing with CampMinder about what a session is called.
- **Lander counts come from `/api/lodging/summary`, never from N roster calls.** See §4.

---

## 4. Next: intake Phase B's review, then Plan 3 Phase C

Plan: `docs/superpowers/plans/2026-07-30-family-camp-lodging-surfaces.md` (local-only, gitignored).
Its Phase B header carries a **SHIPPED** block listing nine ways the delivered work diverges from
Tasks 7-12 — read that before treating the task list as the record.

| Phase | Tasks | Ships | Status |
|---|---|---|---|
| **A — Read API** | 1-6 | `/api/lodging/*`, `lodging.phi`, generated TS types | ✅ `f99a8ef7` (#1884) |
| **B — Lander + roster** | 7-12 | `/weekend/sessions`, `/weekend/session/:id`, `/api/lodging/summary` | 🔶 **in review, PR #1890** |
| **C — Admin CRUD** | 13-17 | `/admin/lodging` editor, Go integrity guards, work queue UI | ⬜ after B merges |

### Your job, in order

1. **Intake the scan agent's fixes.** A scan agent is working the same branch and worktree. Its
   catches so far are real bugs in Phase B's code, not style: `UnitInventoryPanel` bucketed areas on
   `area_code` alone, so two areas both carrying `code: ""` collided and the second one's name was
   silently dropped; and `partyAttention` dragged already-answered needs back into the `unverified`
   reason, so a cabin the registry confirms *has* power could read "Power" as outstanding. Expect
   more of that shape. Re-run the suites after taking them (§7) — several of these live in pure
   helpers with dense tests, so a bad fix fails loudly rather than silently.
2. **Review the work against the plan AND the owner's GUI direction.** The plan is the weaker of
   the two here: it predates both the ingest request layer and any look at the summer surfaces. The
   owner's direction, gathered over the session, is in §3 under "Locked by Phase B" — spaces not
   beds, triage not listing, extend summer's visual language rather than invent one. Where the plan
   and §3 disagree, §3 wins.
3. **After #1890 merges, start Phase C** (Tasks 13-17): `pocketbase/lodging/hooks.go` integrity
   guards, then the `/admin/lodging` editor, then the work-queue UI over
   `lodging_ingest_issues`.

### What Phase C inherits that the plan does not describe

- **`GET /api/lodging/summary?year=` exists.** Built because the lander needs per-weekend counts and
  `/roster` is a composed read dominated by year-scoped work — eight of its eleven fetches are
  identical for every weekend, so a weekend with **zero parties still cost ~3s**. Measured: twelve
  weekends in one **4.0s / 5.9 KB** call against 12 x ~3s and ~1.2 MB. Its counts come from the same
  `_build_units` / `_build_parties` / `_build_counts` helpers `/roster` uses, and
  `TestBuildSummary::test_counts_match_what_the_roster_reports_for_the_same_weekend` asserts the two
  agree. **Any new per-weekend figure belongs on this endpoint, not on a per-weekend roster call.**
- **`frontend/src/components/weekend/` is the shared surface**: `rosterAttention.ts` (triage +
  `countUnmeasuredSpaces`), `weekendStatus.ts` (lifecycle + chronological sort), `weekendNames.ts`
  (colon split), `sessionDates.ts` (PocketBase datetime -> "May 22-25, 2026"), plus the components.
  Phase C's admin UI should reuse these rather than re-deriving.
- **The PocketBase record/input types the plan puts in Task 7 were deferred to Phase C** — nothing
  in Phase B consumes them; only Task 14's `lodgingCrud.ts` does. Write them there, and do **not**
  write a `LodgingUnresolvedAliasRecord`: the work queue is `lodging_ingest_issues`.
- **`lodging.phi` is still granted to no role (#1887).** Admin bypass is the only route to the
  narrative. Phase C's role editor is the natural place to fix it.

---

## 5. CRITICAL: first action before anything else

**Two gates, in this order.**

**(a) The branch is shared. Check for work that is not yours before touching anything.**

```bash
cd ~/kindred-worktrees/lodging-roster
git status --short                       # scan agent's fixes may be UNCOMMITTED here
git fetch -q && git log --oneline -5 origin/feature/lodging-roster
```

Uncommitted files in that worktree are the scan agent's. **Do not `git add -A`** — stage only what
you changed, or you will sweep their in-progress work into your commit.

**(b) The request columns the roster renders are EMPTY until a sync runs.** Schema-only on any
database that has not run `family_camp_derived` since #1878. Build against that and every party
renders unknown/unflagged, and the API looks broken while working exactly as designed.

```bash
sqlite3 pocketbase/pb_data/data.db \
  "SELECT year, COUNT(*) n, SUM(share_cabin_gate!='') gate, SUM(request_text!='') req
     FROM family_camp_registrations WHERE year >= 2025 GROUP BY year;"
```

Only `gate` and `req` are meaningful there. **Do not add `SUM(wants_near!='')`** — `wants_near` is a
boolean and SQLite evaluates `0 != ''` as TRUE, so that column reports the full row count on an
empty database. If `gate`/`req` are `0`:

```bash
./scripts/start_dev.sh   # boots PocketBase, which applies 1500000127
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2026&service=family_camp_derived"
```

That endpoint needs a **users**-collection admin token, not a `_superusers` one, and FastAPI needs a
`Bearer` prefix — see the memory pointer in §9. The job takes **~8-10 minutes per year** and reports
`status: "running"` with a zero summary the whole time; that is progress, not a hang.

---

## 6. What you should NOT do

- **Do not fill a lander or any multi-weekend view with per-weekend `/roster` calls.** Use
  `/api/lodging/summary`. `/roster`'s cost is year-scoped work repeated per call; N calls is N times
  the same eight fetches, and it looks fine on a year with two weekends.
- **Do not let the roster escalate on `needs_resolution` or `has_medical_narrative`.** True for 44
  of 62 and 62 of 62 parties respectively. Ranking on either turns the whole roster amber and the
  triage sections stop meaning anything.
- **Do not judge a housing need against an UNCONFIRMED cabin.** `has_power: false` on an unconfirmed
  row means "nobody has said". All 82 cabins are unconfirmed today, so treating that as evidence
  flags every constrained family. `partyAttention` reports `unverified` for a reason.
- **Do not measure weekend capacity in beds.** Spaces. A family holds a whole cabin whether or not
  it fills it; beds reported 43% headroom on a weekend with 17 spare rooms out of 79.
- **Do not hand-write the share/proximity/bathroom unions.** They are DERIVED from the generated
  types (`NonNullable<ShareRequestSummary['preference']>`) precisely so a Go-side change becomes a
  type error rather than a silently unreachable branch. The plan's hand-written set was already
  wrong twice.
- **Do not invent short session names.** `splitWeekendName` splits on the colon and is lossless.
  Abbreviating is how the UI starts disagreeing with CampMinder about what a session is called.
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
- **Do not `git add -A` in the lodging-roster worktree while the scan agent is working it.** Stage
  the paths you touched.

---

## 7. Useful one-liners

```bash
# Frontend gates — Phase B's daily loop. NOT `npm run lint`: the rtk proxy
# mangles the npm wrapper's output into a false failure.
cd frontend && node_modules/.bin/eslint src --ext ts,tsx   # 0 errors; ~348 pre-existing warnings
cd frontend && npm run type-check
cd frontend && npx vitest run src/components/weekend/

# Python gates — the API now has a lodging service worth running on its own
uv run pytest tests/unit/api/services/test_lodging_roster_service.py tests/unit/api/test_lodging_phi_boundary.py -q
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

- **Free text carries PHI the boundary does not cover.** Families type medical detail into the
  *cabin-request* box: across 2026 family weekends, **12 of 232 request texts (5%)** contain health
  vocabulary, including at least one named diagnosis with the accommodation it requires. That text
  is `request_text` — an ordinary roster field, ungated — while `family_camp_medical` is
  admin-gated. Predates this work; the owner's call, deliberately not acted on. Options are gate the
  text, flag it for review, or accept it.
- **`has_medical_narrative` is true for every household** (62 of 62 in 2026; 870 medical rows, 648
  with dietary/allergy text). Accurate, but it means the medical affordance appears on every row and
  therefore signals nothing. Worth deciding whether the flag should mean something narrower.
- **Phase B was never verified in a browser after its last two commits.** The summer-language pass,
  the lander, the route change, the `Listbox` and the batched endpoint are covered by tests and by
  direct API measurement, but the lander has never been rendered. Boot the worktree stack and look
  before merging.
- **The summer campers tab was never mined.** `/summer/session/:id/campers` (`CampersView`) is the
  closest analogue to the roster table and likely has filter/sort affordances worth copying. Traced
  as far as the component and stopped.

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

---

## 9. Cross-session pointers

- **Driving the sync and the API as an agent** —
  `~/.claude/projects/-home-adam-kindred/memory/reference_driving_sync_and_api_locally.md`.
  Neither local API accepts a `_superusers` token: impersonate the admin *users* record via
  `POST /api/collections/users/impersonate/<id>`, send it raw to PocketBase custom routes and with a
  `Bearer` prefix to FastAPI. Also covers seeding `localStorage["pocketbase_auth"]` so a browser
  session works, and why `family_camp_derived` looks hung when it is not.
- **The plan** — `docs/superpowers/plans/2026-07-30-family-camp-lodging-surfaces.md`, Phase B header
  carries the SHIPPED divergence block. Local-only, gitignored, never commit it.
- **Phase B's inventory** — `git log --oneline f99a8ef7..` on `feature/lodging-roster`; the PR body
  on #1890 carries the measurements and the deviation list.
