# HANDOFF — Family Camp Lodging

**State as of Phase A of the ingest-repair work (#1903).** All three plans are merged, plus
the queue drain. The data layer, the ingest, the read API, the weekend surfaces and the
writable editor are done. `/weekend/sessions` lists the year's weekends;
`/weekend/session/:id` shows one weekend's roster and inventory; `/manage/lodging/:section`
edits the registry, and resolving a work-queue row now writes the placement on the click
instead of on the next sync. **The next body of work is the board and the map (spec §7.2) —
see §4.**

This is a working document. Edit it in place: tick what ships, rewrite "Next", delete what stops
being true. It is not a changelog — `git log` is the changelog.

---

## 1. Programme status

Three plans merged, plus one follow-on phase. What remains is the board and the map — see §4.

| Plan | Scope | Status |
|---|---|---|
| **1 — Data layer** | `lodging_*` collections, seed, alias registry | ✅ merged (`49d38ff8`, #1867) |
| **2 — Ingest** | CampMinder cabin fields → assignments, requests, PHI split | ✅ merged — see below |
| **3 — Surfaces** | Read API, `/weekend` roster, `/manage/lodging` editor | ✅ A (`f99a8ef7`, #1884), B (`37cf8d24`, #1890), C + units redesign (`1bcd90f1`, #1893) |

Plan 2 shipped in four PRs:

| Phase | Tasks | Commit | What |
|---|---|---|---|
| A — source-field correctness | 1–3 | `78ef6d8d` (#1872) | four silently-broken columns in `family_camp_derived.go` |
| B1 — ingest primitives | 4–10 | `2b28e0fa` (#1877) | work queue, alias resolver, merges, session attribution, grain guard |
| B2 — ingest on | 11–14 | `0cf6420b` (#1880) | both grains, history, job registration, backfill gate |
| C — request layer + PHI | 16–19 | `b3fa243d` (#1878) | household-grain collapse, housing flags, PHI containment |

Task 15 was **rejected**, not deferred — see §3.

After Plan 2, one follow-on phase:

| Phase | Commit | What |
|---|---|---|
| A — ingest repair | #1903 | replay: drain the work queue without a re-sync; server-side `parent_unit` cycle guard (#1899) |

**#1903 also removed a merge-legality rule it had itself just built.** That is the single most
important thing to read before touching lodging constraints — §4 and
`docs/architecture/lodging-occupancy.md`.

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
- **The work queue drains without a re-sync** (#1903). Resolving a row fires `replayOnResolve`
  (`pocketbase/lodging/hooks.go`), which routes by row shape: `ReplayIssue` for a party-scoped
  row, `ReplayPartylessIssue` for a row standing for a cabin STRING, which fans out over every
  party that wrote it. Measured on real data: one row 13 households shared produced **11
  placements across 8 weekends in 0.92s**. The alternative was an 8–10 minute sync per year.
  - **Routing is not total, deliberately.** `field_zero_values` and `unknown_party` rows are
    refused by both entry points; a UI must surface the refusal rather than report a repair.
  - The hook gates on the `false→true` **transition** of `is_resolved`, not on the value.
    Gating on the value alone recurses: `Flush` re-saves an already-resolved row, which
    re-fires the hook. `Original()` is what makes the gate work, and PocketBase never
    refreshes it after a save.
- **`lodging_units.parent_unit` has a server-side cycle guard** (#1899, `guardUnitParentCycle`).
  It fires only when the write actually changes `parent_unit`, so a unit already sitting on a
  legacy cycle can still be confirmed or deactivated.
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
- **The weekend surfaces are live** (Phase B, `37cf8d24`): `/weekend/sessions` lander,
  `/weekend/session/:sessionCmId` roster with Roster/Inventory tabs, and
  `GET /api/lodging/summary?year=` — one batched read returning every weekend with its
  `RosterCounts`. `/summary` exists because `/roster` makes eleven fetches of which **eight are
  year-scoped**, so filling a lander weekend-by-weekend repeated that work N times; a weekend with
  zero parties still cost ~3s. Measured: twelve weekends in one 4.0s / 5.9 KB call.
- **`/summary` and `/roster` cannot disagree.** The batch runs the same
  `_build_units` / `_build_parties` / `_build_counts` helpers, and
  `TestBuildSummary::test_counts_match_what_the_roster_reports_for_the_same_weekend` asserts it.
- **Shared weekend helpers live in `frontend/src/components/weekend/`**: `rosterAttention.ts`
  (triage + `countUnmeasuredSpaces`), `weekendStatus.ts` (lifecycle + chronological sort),
  `weekendNames.ts` (colon split), `sessionDates.ts` (PocketBase datetime → "May 22–25, 2026").
  Phase C reuses these rather than re-deriving.
- **`verify-no-hardcoded-lodging.sh` ignores comments and docstrings** (`scripts/dev/lib/
  drop_comment_hits.py`). It used to fail on prose, which is why it was red on `main` (#1891).
- **`/manage/lodging/:section` is live** (`1bcd90f1`, #1893) — three sections: units, cabin-name
  aliases, and the unresolved-name work queue. Areas are a slide-in drawer over units, not a
  section. Writes go straight to PocketBase through `lodgingCrud.ts`; the Go hooks in
  `pocketbase/lodging` are the integrity boundary. It shipped at `/admin/lodging`; see the access
  model below for why it moved.
- **The access model is the summer board's, not admin-only.** Reads on every `lodging_*`
  collection, and on every `/api/lodging/*` endpoint EXCEPT
  `GET /households/{cm_id}/medical`, are open to any authenticated user; writes are
  `admin || bunking.manage` (`1500000130`). Consequences worth holding:
  - **Three collections are NOT widened.** `lodging_field_mappings`, because it is ingest
    plumbing that decides what every lodging read *means*, not a cabin decision. And
    `lodging_assignments` + `lodging_assignment_history`, because they are the synced record of
    truth and its append-only audit — summer draws the identical line, keeping `bunk_assignments`
    and `attendee_status_history` admin-only while staff write the DRAFT
    (`bunk_assignments_draft`). Lodging has no draft table yet. **Widen them in the PR that adds
    the board that writes them**, not before.
  - **`lodging.phi` is now held by the Bunking Staff role** (closing #1887), so the roster's
    medical reveal works for the staff doing placement. It stayed a separate permission from
    `bunking.manage` deliberately: it can be revoked, or granted to someone who places nobody,
    without touching write access.
  - **No `/admin/lodging` redirect exists**, deliberately: the surface was never in anyone's
    hands, so there are no bookmarks to preserve. `App.tsx`'s `path="*"` sends the old paths home.
  - `AdminLayout` now returns `PermissionDeniedPage` when a user has no visible tab, so the
    remaining admin routes are guarded rather than merely tab-filtered (#1895).
- **Units is sortable, area-grouped, and confirmable in one click or in bulk.** That last part
  is the point: nothing on the roster judges a housing need against an unconfirmed cabin, and
  every unit the loader writes ships unconfirmed (114 of them after the 2026 inventory).
- **Beds are inventory behind `sleeps`, not a replacement for it.** `frontend/src/types/beds.ts`
  turns "2 twins and a queen" into a *suggested* occupancy staff adopt with one click. `sleeps`
  remains the single number every consumer reads, so no Pydantic model changed.
- **Three behaviours that are NOT what their names suggest** — these bit once already:
  - **`deleteLodgingAlias` is not a plain delete.** It reopens every
    `lodging_ingest_issues` row whose `resolved_alias` points at the alias (clearing
    `is_resolved` and `resolved_alias`) *before* deleting. That order is load-bearing; reversed,
    it leaves exactly the silent state described below.
  - **`lodging_unit_aliases` has an `OnRecordDelete` guard** (`guardAliasDelete`). Deleting an
    alias with resolved queue items behind it returns 400 from **every** path, including the
    PocketBase admin UI.
  - **`LodgingUnitForm` writes `sleeps: 0` on EDIT when the field is blank**, and omits the key
    on CREATE. Omitting on edit made clearing a capacity a silent no-op — the old number stayed.
- **New modules worth knowing**: `unitTree.ts` (parent candidates, descendant walk),
  `aliasMembers.ts`, `unitCode.ts`, `unitAmenities.ts`, `lodgingStyles.ts`.
- **`record.get()` on a PocketBase json field returns the Go byte slice, and goja reports it as
  an Array.** So `Array.isArray()` answers true, iterating yields BYTE VALUES, and writing them
  back turns `["bunking.manage"]` into `[34,98,117,...]`. This shipped once and was caught only by
  running the migration against a real database. Use `record.getString(field)` and `JSON.parse`.
  The Go side has the same trap in a different shape — see `extractBusinessCategory` in
  `pocketbase/rbac/hooks.go`, which handles `types.JSONRaw` separately from `map[string]any`.
- **Highest migration is `1500000130`.** Compute the next number from `main`, never from a branch.

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
- **The met/unmet fit check judges only CONFIRMED cabins.** Every cabin is `is_confirmed: false`
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
- **Contracts corrected in review (`03754754`), easy to mis-remember:**
  `AccessibilityFlagListProps.householdCmId` is `number | null` — `null` means "no household to
  look up" and suppresses the PHI reveal entirely, rather than requesting `/households/0/medical`.
  `partyAttention`'s `unverified` reason lists only needs a confirmed cabin has *not* answered.
  `UnitInventoryPanel` buckets areas on `` `${area_code}::${area_name}` `` because the API sends
  `area_code: ""` for anything it cannot resolve. Neither weekend page passes `emptyMessage` to
  `QueryGuard` — the nested components carry the real empty states.

---

## 4. Next: the board and the map (spec §7.2)

All three plans are merged. What the programme was building toward — placing parties — does
not exist yet. Assignments are still read-only; the registry is now editable.

**The two surfaces the spec wants, as complements not alternatives:**

- **(a) The bunking board** — the primary surface, laid out like the summer board (unit
  columns grouped by area, party cards as atoms, @dnd-kit drag). New `FamilyCard` and
  `LodgingUnitCard` components, NOT conditionals inside the 849-line camper-coupled
  `BunkingBoardByArea.tsx`: the atom here is a household party of mixed ages, not a camper.
- **(b) The map view** — a secondary tab rendering the camp map from `map_x`/`map_y`, for
  judging *near* requests and seeing whether a family sits beside a bathhouse or a staff
  cabin. The coordinates have been in the schema since slice 1 for this, and `/manage/lodging`
  now lets staff correct both unit positions and area centroids.

Both operate on the same `lodging_assignments` + `lodging_merges` + `lodging_availability`
state, so a change in one shows in the other. The map is a projection of the board, not a
separate system of record.

### The merge-legality rule was BUILT and then REMOVED — do not rebuild it

A rule was written here — *a merge is legal iff its members are the complete child set of some
container* — and taken back out before it ever shipped. Read
`docs/architecture/lodging-occupancy.md` before proposing anything like it again, because the
idea is genuinely appealing and wrong for reasons that are not obvious.

The short version. Every `member_units` set is hand-authored in the admin UI, so an "illegal"
merge is a human decision the ingest has less context to overrule. A deliberate partial booking
and a mis-clicked one produce **byte-identical rows**, so the rule cannot discriminate between
the case it is for and the case it is against. Nothing downstream consumes completeness —
bathroom privacy comes off `bathroom_group`, and `parent_unit` — the tree the rule walked —
appears nowhere in `api/` or `bunking/`. (`is_container` is read there, but only to keep
buildings out of bookable lists.) And the real configuration space (a house split between a family and a
staff member, an extended family across two registrations, different rules for adult weekends)
is not expressible as tree shape at all.

Four intermediate containers were seeded (`1500000129`) partly so existing merges would satisfy
that rule. **They stay** — independently, they encode a real floorplan distinction and fixed a
`bathroom_group` bug where merging a pair left the slot scored `shared`.

What actually needs building is the **other** axis: many parties in one unit. Sharing already
happens throughout historical data and nothing models or guards it — two families in the same
bedroom is currently possible and undetected. The staff-confirmed rules are written up in the
occupancy doc.

`parent_unit` is editable in the admin UI, filtered to containers minus self minus descendants
(`unitTree.ts`), `is_container` is disabled while a unit has children, and `guardUnitParentCycle`
is now the server-side backstop (#1899). Both the frontend filter and the Go guard are worth
having: the guard blocks *new* cycles but cannot retroactively clean data that already has one.

### Before either surface: confirm some cabins

`partyAttention` only judges a housing need against a cabin whose `is_confirmed` is true, and
**no unit is confirmed** — the loader writes `false` on every row it creates — so the roster
reports *"Fit not verified"* for every
constrained party. This was verified working end to end on real data (#1893): confirming one
cabin dropped `units_unconfirmed` 82→81 and turned a real party from unverified into a genuine
unmet (needs power, confirmed cabin has none). `/manage/lodging/units` now offers confirmation
inline per row and in bulk. Until staff use it, the fit check stays dark.

### Open decisions the board will force

- **`lodging_merges` CRUD** — merges are a board action (spec §3.4), created mid-assignment
  rather than configured up front. Nothing but the ingest writes them yet, and **nothing
  validates the member set** — see the removed rule above before adding a check. Note merges
  carry `session` AND `scenario`; the alias table carries neither, which is why a rule keyed on
  aliases could never express a building that is whole one weekend and split the next.
  `guardMergeDelete` already protects them.
- **Occupancy (#1907)** — how many parties may share one unit, which varies by unit class and
  session type. This is the constraint the board actually needs and the one nothing models.
  `docs/architecture/lodging-occupancy.md` has the staff-confirmed rules. Enforcement belongs
  at the point a human is choosing — the board, or the picker — not in the ingest.
- **`lodging_availability`** — the per-session reserved/released overrides (spec §3.7). The
  schema exists; no surface reads or writes it.
- **`lodging.phi` is held by admins and the Bunking Staff role** (`1500000130`, closing #1887).
  Everyone else who can read the roster gets a 403 from the medical endpoint, so the degradation
  path in `AccessibilityFlagList` is now a live path rather than a theoretical one.
- **Health Center room 5** — `hc-upstairs-hall` groups rooms 1, 2, 3, 4 and 6 but not 5. If 5
  shares that hall's bathroom the group is incomplete, and a merge covering the hall would
  never upgrade to `private` — the same bug that was fixed for Tioga/Tenaya 3+4 in
  `1500000129`. **Unanswered; needs staff.**

## 5. CRITICAL: first action before anything else

**The columns and rows Phase C edits are EMPTY until a sync runs.** On any database that has not run
`family_camp_derived` since #1878, the request columns are schema-only and the roster renders every
party unknown/unflagged — the API looks broken while working exactly as designed.

```bash
sqlite3 pocketbase/pb_data/data.db \
  "SELECT year, COUNT(*) n, SUM(share_cabin_gate!='') gate, SUM(request_text!='') req
     FROM family_camp_registrations WHERE year >= 2025 GROUP BY year;"
```

Only `gate` and `req` are meaningful. **Do not add `SUM(wants_near!='')`** — `wants_near` is a
boolean and SQLite evaluates `0 != ''` as TRUE, so that column reports the full row count on a
completely empty database. If `gate`/`req` are `0`:

```bash
./scripts/start_dev.sh   # boots PocketBase, which applies 1500000130
# then, with a users-collection admin token (see §9 — a _superusers token is REJECTED):
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2026&service=family_camp_derived"
```

The job takes **~8–10 minutes per year** and reports `status: "running"` with an all-zero summary
the whole time. That is progress, not a hang — confirm with CPU, not the counters.

---

## 6. What you should NOT do

- **Do not fill a lander or any multi-weekend view with per-weekend `/roster` calls.** Use
  `/api/lodging/summary`. `/roster`'s cost is year-scoped work repeated per call; N calls is N times
  the same eight fetches, and it looks fine on a year with two weekends.
- **Do not let the roster escalate on `needs_resolution` or `has_medical_narrative`.** True for 44
  of 62 and 62 of 62 parties respectively. Ranking on either turns the whole roster amber and the
  triage sections stop meaning anything.
- **Do not judge a housing need against an UNCONFIRMED cabin.** `has_power: false` on an unconfirmed
  row means "nobody has said". Every cabin is unconfirmed today, so treating that as evidence
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
- **Do not number a migration from a branch.** Highest on `main` is `1500000130`. Compute it:
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
- **Do not re-add unit names to application source to make a rule readable.** The guard now ignores
  comments and docstrings, so prose is fine; a string literal, list or map is not (spec §3.8).
- **Do not seed registry data in a migration — including a migration that READS the private file.**
  The registry lives in `config/lodging_registry.json` (kindred-local) and loads on boot;
  `docs/reference/lodging-registry.md` is the contract. `_migrations` keys on filename and applies
  once, so a migration reading an absent private file in CI would be recorded as applied and never
  re-run when the file appeared — a silently empty registry. `verify-no-hardcoded-lodging.sh` now
  scans `pb_migrations/` for exactly this.
- **Do not make the boot loader overwrite existing rows.** It is create-if-absent on purpose: the
  registry is staff-editable, so a full upsert would undo confirmations and corrected coordinates on
  the next restart. The flip side is that it will NOT backfill a new field onto rows that already
  exist — that needs its own one-off, and assuming otherwise is how an inventory update lands empty.
- **Do not judge a housing need against an unconfirmed cabin.** `has_power: false` on an unconfirmed
  row means "nobody has said". Phase C makes confirmation possible — that is the moment this starts
  mattering, not a reason to relax it.
- **Do not delete a `lodging_units` row that has assignments.** Deactivate.
  `guardUnitDelete` enforces it and no `deleteLodgingUnit` should exist.
- **Do not "simplify" `deleteLodgingAlias` back into a plain `delete`.** It reopens the queue
  rows the alias resolved, first. Skipping that silences the work queue **permanently** and
  nothing surfaces it: `IssueRecorder.Flush` (`sync/lodging_issues.go`) writes `is_resolved`
  only on CREATE — deliberately, so a later sync cannot un-tick what staff ticked — and its
  dedup matches a re-encountered cabin string to that same row. So the next sync bumps
  `occurrences` and leaves the row resolved. The string never returns to the queue and its
  placement never resolves again. `resolved_alias` is `cascadeDelete: false` on purpose
  (`1500000122`), which preserves the audit trail and loses the work item. Found post-merge on
  #1893; `guardAliasDelete` is the backstop.
- **Do not make a bulk mutation act on rows the user cannot see.** Collapsing an area group
  deselects its units for this reason.
- **Do not render an edit form without a `key` tied to the record being edited.** Both lodging
  panels do (`key={editing === 'new' ? 'new' : editing.id}`). Without it React reuses the
  component instance, `useState` initialisers never re-run, and submit writes the previous
  record's field values against the new record's id — silently, for aliases.
- **Do not lowercase an area `code`.** Every seeded area is uppercase (`RIDGE`, `GT`, `HC`,
  `YURT`) and `code` is a join key. A reviewer suggested lowercasing it; that would break the
  join. Pinned by a characterisation test.
- **Do not "fix" `aria-sort={undefined}` to `"none"`** on inactive sortable columns. `undefined`
  is correct and is the shape to standardise on (#1897). Also pinned by test.
- **Do not use `?? []` to paper over a failed secondary query.** Each fallback hides an error
  as an empty list. The alias editor's member checkboxes ARE the payload, so opening it against
  a failed unit query and saving would strip every member.

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

# Lodging editor. The route is /manage/lodging; the SOURCE still lives under
# components/admin/lodging/ — deliberately not renamed, 32 files for no behaviour.
cd frontend && npx vitest run src/components/admin/lodging/ src/types/beds.test.ts
cd pocketbase && go test ./lodging/... -count=1   # incl. guardAliasDelete
cd pocketbase && go test ./ -run TestLodgingRBAC -count=1   # migration 1500000130 semantics

# Verify a push actually landed (a wrapper's "ok" is a claim, not evidence)
git fetch -q && git rev-list --count origin/<branch>..HEAD   # must be 0
```

---

## 8. Open issues

- **#1891 is fixed** — `verify-no-hardcoded-lodging.sh` now ignores comments and docstrings and is
  green on a clean `main`. Kept here only so a reader of the issue knows where it went.
- **Free text carries PHI the boundary does not cover.** Families type medical detail into the
  *cabin-request* box: across 2026 family weekends, **12 of 232 request texts (5%)** contain health
  vocabulary, including at least one named diagnosis with the accommodation it requires. That text
  is `request_text` — an ordinary roster field, ungated — while `family_camp_medical` is
  admin-gated. Predates this work; the owner's call, deliberately not acted on. Options are gate the
  text, flag it for review, or accept it.
- **`has_medical_narrative` is true for every household** (62 of 62 in 2026; 870 medical rows, 648
  with dietary/allergy text). Accurate, but it means the medical affordance appears on every row and
  therefore signals nothing. Worth deciding whether the flag should mean something narrower.
- **Phase B was never verified in a browser after its last three commits.** It is merged and green,
  but nobody has *looked* at the lander, the Listbox switcher or the stats bar — they are covered by
  tests and by direct API measurement only. Worth ten minutes with `./scripts/start_dev.sh` before
  building Phase C on top of them.
- **Nothing in #1903 was verified in a browser either.** The one visual check that phase got
  covered a merge-repair panel that no longer exists. The replay path is proven by direct
  measurement on real data, not by looking at it.
- **#1907 — lodging occupancy is unmodelled**, and it is the constraint that matters. Nothing
  stops two families being placed in the same bedroom; the unique indexes only stop one party
  holding two placements. Staff-confirmed rules are in
  `docs/architecture/lodging-occupancy.md`. **The board is the surface that will force this** —
  read the doc before designing placement validation.
- **#1908 — no test drives `replayOnResolve` through a replay that succeeds.** Every hook test
  exercises refusal or failure. The success path is proven manually, so this is a missing
  regression guard rather than missing evidence: the lodging test harness builds 5 collections
  and a real replay needs ~13, and Go cannot share `_test.go` helpers across packages.
- **The summer campers tab was never mined.** `/summer/session/:id/campers` (`CampersView`) is the
  closest analogue to the roster table and likely has filter/sort affordances worth copying. Traced
  as far as the component and stopped.
- **CodeRabbit reviewed #1890 only up to `2451582e`, three commits behind HEAD.** It never saw the
  stats bar, the summer-language rewrite or the batched endpoint, and two files it did review no
  longer existed. Do not read a CodeRabbit pass as covering a branch that moved under it — check
  which commit it reviewed.

- **#1895 is fixed** — `AdminLayout` returns `PermissionDeniedPage` for a non-admin, which is the
  route-group fix the issue asked for. Lodging left `/admin` entirely in the same change.
  `AdminTabConfig.requiredPermission` is now the literal `'admin'`, not `string`: the guard is an
  is-admin test, so a tab carrying an ordinary permission codename would slip past it. #387 put a
  `metrics.geo` tab under `/admin` and #450 had to move it out — the narrowed type makes a repeat
  a compile error. **Merging `/admin` into `/manage` must revisit that guard.**
- **#1899 is fixed** — `guardUnitParentCycle` is an `OnRecordUpdate` hook on `lodging_units`,
  so a direct write can no longer close a loop. It runs at the model level, which means it also
  covers programmatic Go writes and the PocketBase admin UI, not just the REST path
  `1500000130` widened. There is deliberately no create binding: a new record has no
  descendants, so no create can close a cycle.
  **One claim this issue carried was wrong:** a cycle does *not* hang any merge rule — and with
  that rule now removed, the only things that walk parent links at all are `HasParentCycle`
  (`sync/lodging_unit_tree.go`) and `descendantIds` (`unitTree.ts`), which both carry visited
  guards. That inaccuracy had propagated into four comments across three files before it was
  traced to its origin in `hooks_test.go`; if you meet another copy of it, it is wrong.
- **#1894** — `dark:*-forest-950` classes generate nothing: the forest scale stops at 900, so 14
  occurrences across 8 files are dead dark-mode states. `SessionTabs` is one of them, which is
  how it propagates — other surfaces are told to copy its pill grammar.
- **#1896** — data fetching is not extracted into custom hooks, against `frontend/CLAUDE.md:23`,
  across 12 files. `queryKeys.lodgingAreas()` is declared twice in the lodging admin alone, each
  with its own fallback, which is what made the `?? []` gap above possible.
- **#1897** — two competing sortable-header a11y shapes: `PipelineBatchList` and
  `UnitsTableHeader` use a focusable `<th>`; `SolverDebugImpossibilityModal` uses a `<button>`
  inside it. Standardise on the button, keep `aria-sort={undefined}`.
- **#1887 is fixed** — `lodging.phi` is granted to the Bunking Staff role by `1500000130`, which
  also recomputes `users.cached_permissions` for its holders rather than trusting the Go `roles`
  hook to fire during migration bootstrap. The reveal's 403 path is still live and still matters:
  anyone authenticated can read the roster the button sits on.
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
