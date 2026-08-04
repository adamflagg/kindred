# HANDOFF — Family Camp Lodging

**State as of the write-race guards (#1927).** One PR is in flight and unmerged: **#1926**, which
moves the board's consent flag off the registration gate onto the authoritative form — **§3a is
the model behind it, and is worth reading even if that PR changes.** The data layer, the ingest, the read API, the
weekend surfaces, the writable editor, the 2026 inventory, the read-only board and the draft
write layer are all merged. `/weekend/sessions` lists the year's weekends;
`/weekend/session/:id` shows one weekend's roster and inventory; `/manage/lodging/:section`
edits the registry; the board renders placements read-only; and three write endpoints exist for
scenario-scoped placement — merging is folded into it now, a placement's `units` set rather than
a separate action, since kindred#1931 — and availability overrides. **What does not exist
is the interaction: nothing on the board calls those endpoints yet. That is the next body of
work — see §4.**

This is a working document. Edit it in place: tick what ships, rewrite "Next", delete what stops
being true. It is not a changelog — `git log` is the changelog.

---

## 1. Programme status

**This programme has accumulated three overlapping label schemes** — Plans 1–3, Phases A–F, and
a step number — and one of them names a phase that no longer exists. Do not add a fourth, and
treat a bare letter in any older document as ambiguous rather than authoritative. The table
below identifies work by **PR and commit**, which are the only labels that cannot drift.

| Scope | Status |
|---|---|
| Data layer — `lodging_*` collections, seed, alias registry | ✅ `49d38ff8` (#1867) |
| Ingest — CampMinder cabin fields → assignments, requests, PHI split | ✅ four PRs, see below |
| Surfaces — read API, `/weekend` roster, `/manage/lodging` editor | ✅ `f99a8ef7` (#1884), `37cf8d24` (#1890), `1bcd90f1` (#1893) |
| Ingest repair — replay the queue without a re-sync; `parent_unit` cycle guard | ✅ `58bc5c77` (#1903) |
| Private registry — registry out of tracked source into `kindred-local` | ✅ `397379a3` (#1910) |
| 2026 inventory — real amenities and the alias set (114 units / 141 aliases at merge) | ✅ `8b83f388` (#1914) |
| Read-only board — area sections, unit cards, unplaced rail, detail panel | ✅ `3c2e3b55` (#1911) |
| Draft write layer — draft tables, RBAC, scenario-aware reads, write endpoints | ✅ `7065b4c9` (#1915) |
| Write-race guards — every write path hardened | ✅ `7b25d25e` (#1927) |
| Share eligibility — flag on the authoritative form, not the registration gate | ✅ `d5951b69` (#1926) — see §3a |
| Merge collapse — one `units` relation replaces `unit`/`merge`/`merge_draft` | ✅ `ee881bdf` (#1931) — see §2 |
| Map — read-only `map_x`/`map_y` surface, a projection of the board | ✅ `e3f0cca2` (#1939) + `c6903f59` (#1942, legend + highlight controls) — see §2 |
| Scenario semantics — a scenario REPLACES the mirror, and a copy seeds it | ✅ #1974 — see §2 |
| Scenario plumbing — the picker, and read-only when no scenario is chosen | ⬅ **#1967 — gates every write. Do this first.** It must offer the copy: a new scenario is now empty. |
| **Drag placement — the board calls the write endpoints** | ⬅ **then this, see §4. The map has landed.** |
| Pin editor — drag a unit to correct its coordinates | needs the map |
| Geo layer | needs the map |

**Ordering, sizes and the work that is NOT on the critical path live in `docs/reference/weekend-go-live-sequence.md`.** It also records two corrections worth reading before planning: the Family Camp adult-field discovery is **not** a gate (`party_size` has zero decision consumers), and "go live" is undefined on the current architecture — the board can only ever write drafts, so #1968 asks what staff actually take away from a finished plan.

**The map did NOT need drag placement**, contrary to what this table said for several rounds:
it is a read-only projection of the roster response, so it shipped ahead of the interaction.
Its one seam is documented at `mapModel.ts:75` — when `RosterParty.unit_codes` (added by
#1931) is wired in, a multi-room party gets positioned across its rooms instead of joining the
off-map rail, "and nothing else changes."

The ingest row above shipped in four PRs:

| Commit | What |
|---|---|
| `78ef6d8d` (#1872) | four silently-broken columns in `family_camp_derived.go` |
| `2b28e0fa` (#1877) | work queue, alias resolver, merges, session attribution, grain guard |
| `0cf6420b` (#1880) | both grains, history, job registration, backfill gate |
| `b3fa243d` (#1878) | household-grain collapse, housing flags, PHI containment |

The Wawona / Doctor's House alias reconcile was **rejected**, not deferred — see §3.

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
  `RosterCounts`. `/summary` exists because `/roster` makes ten fetches of which **seven are
  year-scoped**, so filling a lander weekend-by-weekend repeated that work N times; a weekend with
  zero parties still cost ~3s. Measured: twelve weekends in one 4.0s / 5.9 KB call. (Eleven and
  eight until #1889 deleted the whole-year medical read; #1963 measures from the older numbers.)
- **`/summary` and `/roster` cannot disagree.** The batch runs the same
  `_build_units` / `_build_parties` / `_build_counts` helpers, and
  `TestBuildSummary::test_counts_match_what_the_roster_reports_for_the_same_weekend` asserts it.
- **Shared weekend helpers live in `frontend/src/components/weekend/`**: `rosterAttention.ts`
  (triage + `countUnmeasuredSpaces`), `weekendStatus.ts` (lifecycle + chronological sort),
  `weekendNames.ts` (colon split), `sessionDates.ts` (PocketBase datetime → "May 22–25, 2026").
  The board reuses these rather than re-deriving.
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
  - **Three collections are NOT widened, and #1915 ANSWERED that question rather than
    completing it.** `lodging_field_mappings`, because it is ingest plumbing that decides what
    every lodging read *means*, not a cabin decision. And `lodging_assignments` +
    `lodging_assignment_history`, because they are the synced record of truth and its
    append-only audit — summer draws the identical line, keeping `bunk_assignments` and
    `attendee_status_history` admin-only while staff write the DRAFT (`bunk_assignments_draft`).
    This section used to say *"widen them in the PR that adds the board that writes them"*.
    **Do not.** `1500000132` gave the opposite answer: the writer never touches them. Staff
    write `lodging_assignments_draft`, and all three stay `is_admin` permanently. The rejected
    alternative — widen `lodging_assignments` and scope staff to non-empty scenarios via a
    `scenario != ""` rule — is a guard by convention, one string edit from opening the synced
    rows, and it makes every reader responsible for a filter.
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
  **every unit the loader writes ships unconfirmed** — state that invariant rather than a count,
  which goes stale on every inventory change.
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
- **Never write the next migration number down in this file.** This bullet used to name a
  specific pair and went stale twice in three PRs — which is precisely the failure the numbering
  rule exists to prevent, committed by the document that states the rule. Recompute, always:
  `git ls-tree -r origin/main pocketbase/pb_migrations/ | grep -oE '15000[0-9]{5}' | sort -u | tail -1`

  A relation field's value has the OPPOSITE hazard to the json field above, and neither fails
  loudly on the wrong accessor: on a **multi-valued relation** `getStringSlice()` returns the
  ids and `getString()` returns `""`. Using the json idiom on a relation empties the field
  while reporting success (`1500000134` documents this at its `memberUnitsOf` helper).

### The 2026 inventory (`8b83f388`, #1914) and the private registry (`397379a3`, #1910)

- The registry lives in `config/lodging_registry.json` in **kindred-local**, not in tracked
  source, and loads on boot. `docs/reference/lodging-registry.md` is the contract.
- **The loader is create-if-absent and will NOT backfill a new field onto rows that already
  exist.** `scripts/dev/apply_lodging_inventory.py` is what does that, in two passes: amenities
  first, then `--structural` for container promotion and parent corrections. **#1917 tracks
  running it against production, which merging did not do and nothing in CI/CD does.**
- `scripts/dev/confirm_lodging_units.py` refuses non-loopback URLs. It exists to light up the
  fit check locally; run against production it would assert that every cabin had been checked
  when none had.
- **A count reconciliation is not a placement check.** #1914's amenity-count reconciliation
  balanced exactly and was structurally incapable of catching a sheet row landing on the wrong
  unit — it counts each row once, wherever it sits. It caught the two mismappings that were
  *collisions* and was blind to the one where a row sat on a container and its four bookable
  rooms got nothing. Whenever data is mapped onto rows, the question is "is every row on the
  right target", which counts cannot answer. #1918 tracks a guard for that shape.

### The map (`e3f0cca2`, #1939; legend + highlight controls `c6903f59`, #1942)

A fourth tab on `/weekend/session/:id`, beside Roster / Inventory / Board. Read-only, and a
**projection of the board** — it calls the same `buildBoard` over the same roster payload and
adds position, so the two cannot disagree about who is where.

- **The coordinate space IS page 1 of the camp map PDF.** `map_x`/`map_y` were digitised
  against it, so placement is a plain `x*W, y*H`, top-left origin, no flip. Two things follow
  and both are load-bearing: the canvas is locked to the page's 3300:2550 aspect, and the
  backdrop carries `transform-origin: 0 0`. With the CSS default the marks drift out of
  register as you zoom — zero error at 1×, worsening with `k` — and **no test can see it**,
  because jsdom performs no layout. The comment in the file says so; do not tidy it away.
- **The background is `/local/assets/camp-map.webp`** (3300×2550, 440 KB) from **kindred-local**,
  shipped exactly as `camp-logo.png` is: Vite's `serve-local-assets` in dev,
  `Dockerfile.caddy`'s `COPY local/` in prod. **A worktree gets a real COPY of `local/assets/`,
  not a symlink**, so a new private asset must be copied into each worktree by hand. Without the
  file the map degrades to positions-only with a note — it must never render an empty box.
- **Marks cluster by GEOMETRY, not by `parent_unit`** — which is absent from the roster payload
  and read nowhere in `api/`. The radius is SCREEN-space, so zooming dissolves clusters.
  `clusterByProximity` merges every group a candidate touches, which makes the partition the
  connected components of the radius graph and therefore **order-invariant**; a first-match
  greedy is not, and the unit list is a DB query result whose order is not guaranteed.
- **Containers are never drawn**, the same invariant the board holds. The Map tab counts
  POSITIONED ROOMS, which is neither the Inventory count (includes containers) nor the number
  of marks (clusters, and changes with zoom).
- **`(0,0)` means UNPOSITIONED.** PocketBase stores an unset number as 0, which rendered naively
  lands in the map's top-left corner looking like a real placement. Settled at BOTH ends as of
  #1941: `_map_point` sends the unset pair as null, and `hasCoordinates` stays as defence in
  depth. Note the asymmetry deliberately — only a BOTH-axes zero is the unset signal; a
  single-axis zero is a real edge position and is kept.
- **A merged placement cannot be positioned yet.** The roster sends `unit_code: ""` for a merge,
  so those parties land on the "Placed, off the map" rail. `resolvePartyUnits` (`mapModel.ts`)
  is the pre-built seam and is the ONLY place a party becomes units. #1933 landed
  `RosterParty.unit_codes`, so **#1940 is unblocked** and should be a small change.
- **Wheel listeners must be NATIVE and non-passive.** React 19 registers `wheel` as passive at
  the root, so `preventDefault()` inside an `onWheel` prop is silently ignored and the page
  scrolls while the map zooms. Assert `defaultPrevented` if you touch this.
- **Not keyboard-navigable, and it does not pretend to be** — marks carry no `role="button"`.
  The Inventory tab is the accessible equivalent; nothing is reachable only here.

### The read-only board (`3c2e3b55`, #1911)

Area sections, leaf-unit cards, the unplaced rail, the detail panel and consent flagging all
render. It is a display surface — **nothing on it calls a write endpoint.** It flags on explicit
`no_share` only, which is the unambiguous case; see §4 for the two rules deferred to the drag PR.

### The draft write layer (`7065b4c9`, #1915)

**Two new collections** (`1500000132`): `lodging_assignments_draft` and `lodging_merges_draft`.
`scenario` is required on both, with `cascadeDelete: true`, so deleting a saved scenario sweeps
its drafts server-side. (`lodging_merges_draft` did not survive **#1931** — see the units-set
collapse below.)

**The dead `scenario` column was DROPPED** from `lodging_assignments` and `lodging_merges`. It
was an artifact — absent from the original field list, and empty on all 67 assignment rows. The
live unique indexes were rebuilt without it and **kept their `> 0` partials**. Consequences:

- **`EnsureMerge` lost its `scenario` parameter.** Filtering on the dropped column now fails the
  whole ingest with `unknown field "scenario"`. Do not reinstate it. (`EnsureMerge` itself was
  later deleted outright by **#1931**.)
- **A `Set` on a dropped column silently no-ops; a filter naming it errors.** So a write-only
  reference to a dropped column looks fine forever. This is #1921, and it is why dropping
  `scenario` broke the Go ingest while the Go suite stayed green — the fixtures build their own
  schema and never read `pb_migrations/`.

**`lodging_availability` keeps its `scenario` column and gets NO draft twin.** Nothing syncs into
it, so there is no record of truth to protect. Live rows are the base; scenario rows overlay per
unit. `state: null` DELETES the scenario row — there is no state meaning "normal", and writing an
override that agrees with the live plan would pin the unit against a later change to it.

**Reads.** `GET /roster` and `GET /summary` both take an optional `scenario`:

- **No `scenario` → the CampMinder mirror**, read-only for everyone, byte-identical to
  pre-#1915 behaviour. The draft reads are not issued at all.
- **With `scenario` → the scenario's draft rows REPLACE the mirror** (#1974). A party with no
  draft row is **unplaced**, and `lodging_assignments` is not read at all — asserted, not just
  implied. A new scenario is therefore EMPTY and is filled by an explicit copy.
- **Availability still overlays**, per unit, and that asymmetry is deliberate: nothing syncs into
  `lodging_availability`, so a scenario has no record of truth to replace there.
- Both reads join the same `TaskGroup`, so scenario mode costs no extra round trip. A test asserts
  `/summary` and `/roster` cannot disagree under one scenario, on a fixture where falling back to
  the mirror would change the count.

**Writes — four endpoints, all gating on `bunking.manage`:**

```text
POST   /api/lodging/placements       place one party; `unit_ids` must name ≥ 1 unit
DELETE /api/lodging/placements       UNPLACE the party — drop its row
POST   /api/lodging/placements/copy  seed this scenario from the mirror, one weekend
PUT    /api/lodging/availability     reserve/release a unit; state:null clears
```

Two more endpoints existed here — `POST`/`DELETE /api/lodging/merges` — until kindred#1931 deleted
them along with `lodging_merges_draft`. See the units-set collapse subsection below.

`scenario` is **required and non-empty on every write.** With no scenario the board is read-only
for everyone, which is what summer's `isProductionMode` does; an endpoint accepting a
scenario-less write would be the one path around it. A blank scenario is a 422, not a silent
write to the live plan.

#### TWO STATES, WHICH IS THE POINT (#1974)

There were three, and the third — the **tombstone**, a draft row naming no unit, meaning "staff
took them off the board" as distinct from "untouched, so show CampMinder" — was called here the
single easiest thing for the board to get wrong. It only existed because reads fell through to
the mirror. Replace semantics removed the fall-through, so it had nothing left to express.

| State | Row | Renders as |
|---|---|---|
| Placed in this scenario | draft row naming ≥ 1 unit | in those units |
| Unplaced in this scenario | **no draft row** | on the unplaced rail |

So **`DELETE /placements` IS the unplaced rail** — the same operation deleting a
`bunk_assignments_draft` row is on the summer board. `POST` with an empty `unit_ids` is a **422**,
not a second spelling of unplaced. Rows of the old tombstone shape still exist on databases
written before #1974 and simply read as unplaced, which is what they always meant.

**The copy is what makes a new scenario usable.** `POST /placements/copy` writes one draft row per
synced placement for one weekend, carrying the mirror row's own `source` and `staff_touched:
false` (a seed is not a staff decision, and the flag is one-way). It **409s** if the scenario
already holds placements for that weekend: a second copy would overwrite what staff placed and
re-place everything they unplaced, since unplacing is now the absence of a row. Re-baselining a
worked plan against upstream drift is a DIFFERENT feature and does not exist.

The count and the creates are separate round trips, so they race exactly as `place_party`'s
find-then-create does, and are guarded the same way: a failed create re-counts, and rows **beyond
the ones this copy wrote** are the race — reported as the same 409, not as the index's 400.

**The test is `held > copied`, not `held > 0`, and the difference is not cosmetic.** The seed
writes sequentially, so from its second row onwards it is looking at its own output; a bare
"are there rows?" answers yes to itself and reports every later failure — a transient PocketBase
error, a unit deleted since the mirror was read — as a 409 race, swallowing the real status. On a
62-row weekend that is most of the failure surface.

#### The `unit` / `merge` / `merge_draft` collapse into one `units` set (`2ae8a4ec`, #1931)

The three targets above did not last. Migration `1500000134` replaces `unit`, `merge` and
`merge_draft` with one multi-valued `units` relation on both `lodging_assignments` and
`lodging_assignments_draft`, and deletes `lodging_merges` and `lodging_merges_draft` outright,
along with `EnsureMerge`. A placement now points at a SET of rooms; "merging" is extending that
set past one member, not creating a separate row.

**Why the row had nothing left to protect.** Alias resolution already produced a set —
`AliasResolution.UnitIDs` — and `EnsureMerge` existed only because a placement could hold a
single id. Remove that constraint and the merge apparatus has nothing left to do: the three-way
target XOR nothing enforced, the two delete guards, the three-relation expand whose partial use
rendered a placed party as unplaced, and kindred#1923(b) all go with it. A merged slot was never
inventory in the first place — `lodging_availability.unit` is a required relation to
`lodging_units`, so a merge could never be reserved or released; `effective_bathroom` already
took `merged_codes: frozenset[str]`, set-based all along and unchanged by this migration;
`capacity_override` on a merge was write-only with zero readers; and staff confirmed they do not
pre-configure merges — a merge is the outcome of placing a family across rooms, not a slot
created in advance.

**The concept is real; the row was not.** Multi-room placements measured on real data:
**2022=16, 2023=12, 2024=13, 2025=16, 2026=1** (2026 is low only because the season has barely
started) — roughly 12–16 placements a year, about 3% of the total.

**Write surface.** `POST /api/lodging/placements` takes `unit_ids: list[str]` and writes it
straight to `units` on create and update; `create_merge` / `delete_merge` and the
`/api/lodging/merges*` endpoints are gone. `countAssignments` (`pocketbase/lodging/hooks.go`)
now spans both placement tables filtering `units.id ?= {:id}`, which closes **#1923(a)**.

**#1923(b) and #1916 are MOOT, not fixed** — a distinction worth keeping, because both were
questions *about* `lodging_merges` / `lodging_merges_draft` and those collections no longer
exist. #1923(b) asked whether to guard deleting a draft merge; #1916 asked whether
`lodging_merges` should become admin-only now it had a draft twin. `countAssignments` closed
neither of them; the collapse dissolved the subject. See §4 for what "merging" means to the
drag PR.

**The filter is `units.id ?= {:id}`, never `units ?= {:id}`.** The bare form matches **zero
rows** — the `.id` sub-field reference is what triggers PocketBase's relation-join multi-match.
Using it would make `guardUnitDelete` count zero for every unit and permit exactly the deletes
it exists to refuse, silently. Pinned with a negative control in
`pocketbase/lodging/hooks_multirelation_test.go`, so a future PocketBase change flips an
assertion instead of rotting.

#### `guardDraftAssignmentGrain` is NOT the delete guard

New `OnRecordCreate`/`OnRecordUpdate` hook on `lodging_assignments_draft` enforcing
`household_cm_id` XOR `person_cm_id` — **party grain only, and deliberately nothing else.** It is
a separate function from `guardAssignmentGrain` because the target rule differs and must: the
draft tolerates a row naming **no** target, which `guardAssignmentGrain` rejects. That
tolerance was the tombstone until #1974 retired it; it stays because 1500000134's backfill saves
the party grain and the units in two steps, and because `deleteRefRecords` empties `units` on a
placement whose last unit is deleted — a guard there would crash-loop the boot and break a path
PocketBase owns. A row naming neither *grain* is what makes it worth guarding — it keys on
nothing, both partial unique indexes skip it, and `placement_grain` in the roster service
silently drops it, so the row accumulates and does nothing, invisibly.

**This is not what fixed #1923.** `guardDraftAssignmentGrain` is a create/update guard on party
grain; #1923 was about DELETE guards on units and merges not seeing draft placements at all,
closed separately when `countAssignments` learned to span both placement tables (see the
units-set collapse above, and §8).

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
  Per-session arrangement is what a placement's `units` set is for (§2). Do not re-derive this from occupancy
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

### Locked by the weekend surfaces (`37cf8d24`, #1890)

- **Capacity is measured in SPACES, not beds.** A family holds a whole cabin whether or not it
  fills it, so a cabin sleeping 8 housing a family of 3 strands five beds nobody else can use.
  Beds read 223 of 389 for FC1 — apparent 43% headroom — where the true figure is 62 families into
  79 spaces, 17 spare. Beds stay visible as a *fit* note ("does this family fit this cabin"), which
  is the board's question. **Merging or splitting cabins on the board moves the space count**, so
  the figure is provisional and says so.
- **The roster is a triage surface.** The board places parties; the roster says which need a
  decision. It ranks only on signals that discriminate: measured on real 2026 data
  `needs_resolution` is true for 44 of 62 parties and `has_medical_narrative` was true for 62 of 62
  (deleted in kindred#1889), so
  **neither escalates a row**. A flag that is always on is not a flag.
- **The met/unmet fit check judges only CONFIRMED cabins.** Every cabin is `is_confirmed: false`
  today, so an unset `has_power` means "nobody has said", not "there is no power". Judging against
  unset defaults would flag every constrained family on absent evidence, so the check reports
  `unverified` instead. **#1914 seeded the real amenities, so the remaining gate is
  confirmation, not data** — the check begins working the moment staff start confirming cabins
  in `/manage/lodging/units`, and stays dark until they do.
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
  `MedicalNarrativeProps.householdCmId` is `number | null` — `null` means "no household to
  look up" and suppresses the PHI fetch entirely, rather than requesting `/households/0/medical`.
  (It lived on `AccessibilityFlagListProps` until #1889 made that component purely
  presentational and moved the narrative to `MedicalNarrative`.)
  `partyAttention`'s `unverified` reason lists only needs a confirmed cabin has *not* answered.
  `UnitInventoryPanel` buckets areas on `` `${area_code}::${area_name}` `` because the API sends
  `area_code: ""` for anything it cannot resolve. Neither weekend page passes `emptyMessage` to
  `QueryGuard` — the nested components carry the real empty states.

---

## 3a. SHARE ELIGIBILITY — the model staff confirmed, 2026-08-02

**Read this before touching anything that decides who may share a cabin.** It is the largest
correction the programme has made to its own understanding, and the implementation is in flight
on **#1926** (not yet merged) — but the *model* is staff-stated and holds regardless of that PR.

### Share intent lives in TWO CampMinder fields, and the later one wins

| Field | cm_id | When | Shape |
|---|---|---|---|
| `FAM CAMP-Share Cabins` | 240877 | registration, early | single-select 3-state gate |
| `FAM CAMP-Shared Cabin` | 263379 | Family Camp info form, later | **multi-select** modes |

**Staff rule: the Family Camp information form is authoritative. Registration is consulted only
when the form's share question is unanswered. Not answering is never consent.**

**The four live form options are NEAR / "No requests" / WITH-a-named-family / WITH-similarly-aged.
There is NO "we do not want to share" option** — so "did not request sharing" is the absence of a
WITH token, never a recorded refusal. Say it that way on any surface: most of that group asked to
be housed NEAR someone.

### Two INDEPENDENT axes, not one

- **Cabin sharing** — no / named (mutual) / open (similar ages) / both
- **Proximity** — NEAR, plus names. **Orthogonal.** NEAR means *not in my cabin, but close by*.

Collapsing NEAR into the sharing axis is the single easiest mistake here: households select a WITH
option *and* NEAR, and that combination becomes inexpressible.

### What the ingest could NOT see before

`NormalizeShareGate` needs a leading no/maybe/yes token, and no form option has one — so
`share_cabin_gate` is **100% registration** and the `winsGate` tie-break naming the form as winner
has never fired. The board flagged on that column and was wrong in both directions: a few
households were flagged though legitimately placed, and roughly ten times as many declined on the
authoritative form while the board stayed silent and read as permissive.

### Facts worth not re-deriving

- **The form is returned (~88%); its share question is skipped by about half.** So an absent share
  answer is usually a *skipped question*, not a missing form. Proven by overlap with
  `FAM CAMP-bathroom` (274056) on the same form.
- **`family_camp_registrations` is NOT the attendee population.** For 2026 it holds ~459 rows of
  which only ~381 attend a `session_type='family'` session — the rest are adult-only, other
  programmes, or not enrolled. **Filter through `attendees` (`status_id = 2`) before quoting any
  number**, or every figure is diluted ~17%.
- **Siblings disagree.** The request fields are person-partition. The form modes are OR'd (a real
  request beats a sibling's "No requests", which is correct); the gate is resolved newest-wins
  with no fail-safe direction, which is **#1928**.
- **Free text is where the "who" lives**, and it is one lossy join across three source fields
  shared by BOTH axes — you cannot attribute a name to an axis. Resolving names to households is
  spec §7.3 and **unbuilt**; it gates mutuality verification, the unplaced rail's second ranking
  leg, and suppressing the flag on reciprocated pairs.

### ADULT PROGRAMS ARE A STRUCTURAL SPLIT, NOT A SPECIAL CASE

| | Family Camp | Adult Weekends |
|---|---|---|
| Party grain | household | person |
| Roster builder | `_build_household_parties` | `_build_person_parties` |
| Share / proximity questions | both forms | **none exist** |
| `share` / `flags` on the party | populated | **not attached at all** |

There is **no `Adult-Share` field** in `custom_field_defs` — the absence is specific to sharing
(`Adult-Bathroom`, `Adult-CPAP`, `Adult-Infant` all exist). So:

1. **A consent check structurally cannot fire on an adult weekend.** The surface must say it is
   *not checking*, rather than render a clean board that was never examined.
2. **Never fall back to household registration data for a person-grain party** — those answers may
   belong to a different weekend and different people.
3. **Housing rules differ** (the occupancy doc records the couple-booked-as-two-attendees case).
   Do not apply the family-camp sharing rule to adult weekends at all.

### Where the full design lives

`docs/superpowers/specs/2026-08-02-family-camp-share-eligibility-design.md` — **LOCAL ONLY and
gitignored**, so it does not exist on a fresh clone. It carries every measurement, the form-redesign
recommendation, and the plan for a family-camp request pipeline (summer's shape minus the CSV step,
since CampMinder's API makes ingestion automatable, with intent parsing upstream of the request).
If that file is missing, this section is the surviving summary.

---

## 4. Next: drag placement on the board (spec "C2")

**#1923(a) is already settled — see §8.** `guardUnitDelete` sees draft placements now, so a unit
holding scenario placements refuses to delete rather than silently emptying someone's scenario
once drag makes draft rows exist for real.

**Both halves of placement now exist separately and are not connected.** The board renders
(#1911); the write endpoints accept (#1915). Nothing on the board calls them. The next PR is
the interaction that joins them, and it is a frontend PR — **there is no schema work in front
of it** unless it takes on `unit_class` (#1907).

**The map has landed (#1939), so its collision risk is spent.** What it leaves behind for drag:
`WeekendRosterPage.tsx` now has a FOUR-entry `View` union and `TABS` array — add the drag work
around it rather than reformatting. The map IMPORTS `buildBoard` and `AREA_HUES` from
`boardLayout.ts` and never edits them, so changing `buildBoard`'s output changes the map too:
it is a projection, and that is the point. `MapUnitPopover.tsx` now also imports
`rosterAttention`, so `partyAttention` has two consumers.

**The collapse (#1931, `ee881bdf`) made this PR materially smaller than it was planned as.**
A placement now has ONE target — `units`, a set — instead of three (`unit`, `merge`,
`merge_draft`). So the drop handler resolves one kind, not three, and "merge" is no longer a
separate create-a-slot interaction: it is *extending a placement to another room*. Any plan
text describing three targets or a merge endpoint predates the collapse and is wrong.

Read the §2 subsection on the draft write layer before starting. #1974 made a scenario REPLACE
the mirror, which deleted the three-state table that used to be the thing this PR was most
likely to get wrong — but it also means a scenario starts empty, so the picker (#1967) must
offer the copy.

**In scope:**

- @dnd-kit dragging on the existing board, as summer uses it. Party → unit, party → unplaced
  rail, and unit → unit — that last one now IS "merging". Since **#1931** collapsed the three
  targets into one `units` set (§2), the drop handler resolves a single target kind, not three:
  dropping a second room onto a placed party extends the same `POST /placements` body to
  `unit_ids: [a, b]` rather than calling a separate merge endpoint. There is no create-a-slot
  interaction left to build.
- **Party → unplaced rail is `DELETE /placements`.** #1974 retired the tombstone POST; an empty
  `unit_ids` is now a 422. See §2.
- Optimistic placement with rollback. **A rejected write must roll the card back** with a toast,
  as summer's `useCamperMovement` does. A silent revert is not acceptable.
- Scenario gating: no scenario → the board stays exactly as read-only as it is today, with the
  amber CM badge. Mirror `ScenarioContext`'s `isProductionMode`.
- Reserve/release if it fits; otherwise say so and leave it.
- ~~The three unguarded write paths in §8.~~ Done separately in **#1927** — do not re-do them.

**Out of scope:** `unit_class`/#1907 unless flagging needs it, and any new read endpoint — the
roster already returns what the board renders.

**The map already shipped (#1939), before drag rather than after.** Two consequences for this
PR. First, `WeekendRosterPage.tsx` is shared — keep the diff there small. Second, the map is a
PROJECTION: it calls the same `buildBoard`, so any change to the board's model appears on the
map for free, and any change that breaks the board breaks both. Run
`npx vitest run src/components/weekend/` and not just the board's own file.

### Two occupancy questions deferred to exactly this PR

Spec §11 flags on two independent rules. The board today flags only explicit `no_share`, which
is unambiguous. Two questions were deferred to the drag PR because they only bite when staff
drag:

- Does `maybe_mutual` + `maybe_mutual` satisfy "mutual"?
- Does a blank share gate (45 of 452 for 2026) count as consent?

**Neither occurs in placed data, so nothing is broken today.** Decide them, or decide explicitly
to keep flagging on `no_share` alone and say so on the surface. `unit_class` (#1907) is the other
half and is not built; §11 measured it as flagging **zero** of the three shared units on real
data, so it is not what makes the board truthful — the consent rule is.

### The merge-legality rule was BUILT and then REMOVED — do not rebuild it

A rule was written here — *a merge is legal iff its members are the complete child set of some
container* — and taken back out before it ever shipped. Read
`docs/architecture/lodging-occupancy.md` before proposing anything like it again, because the
idea is genuinely appealing and wrong for reasons that are not obvious.

The short version. Every unit set a placement holds is hand-authored — in the admin UI today,
via the board once §4 ships — so an "illegal" merge is a human decision the ingest has less
context to overrule. A deliberate partial booking and a mis-clicked one produce a
**byte-identical `units` value**, so the rule cannot discriminate between the case it is for and
the case it is against. Nothing downstream consumes completeness —
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

- **`lodging_merges` CRUD is now moot.** #1931 collapsed the separate merge collections into one
  `units` set on the placement itself (§2), so there is no merge row left to CRUD, no admin-only
  question (**#1916, closed**), and no delete-guard gap on a draft merge table that no longer
  exists (**#1923(b), moot** — see §8). **Nothing validates the unit set** still stands, though:
  see the removed legality rule below and `docs/architecture/lodging-occupancy.md` before adding
  a check. **#1932** proposes something adjacent and weaker — offering known-good combinations
  derived from `bathroom_group` + `parent_unit` at the moment of picking, not rejecting a
  hand-authored set after the fact — which is explicitly not the removed rule.
- **Occupancy (#1907)** — how many parties may share one unit, which varies by unit class and
  session type. This is the constraint the board actually needs and the one nothing models.
  `docs/architecture/lodging-occupancy.md` has the staff-confirmed rules. Enforcement belongs
  at the point a human is choosing — the board, or the picker — not in the ingest.
- **`lodging_availability`** — the per-session reserved/released overrides (spec §3.7). No
  longer unread: the roster and summary overlay scenario rows on live ones — still an overlay
  after #1974, which changed placements only — and
  `PUT /api/lodging/availability` writes them (§2). What is still missing is the **surface** —
  no UI reserves or releases a unit yet.
- **`lodging.phi` is held by admins and the Bunking Staff role** (`1500000130`, closing #1887).
  Everyone else who can read the roster gets a 403 from the medical endpoint, so the degradation
  path in `AccessibilityFlagList` is now a live path rather than a theoretical one.
- **Health Center room 5** — `hc-upstairs-hall` groups rooms 1, 2, 3, 4 and 6 but not 5. If 5
  shares that hall's bathroom the group is incomplete, and a merge covering the hall would
  never upgrade to `private` — the same bug that was fixed for Tioga/Tenaya 3+4 in
  `1500000129`. **Unanswered; needs staff.**

## 5. CRITICAL: first action before anything else

**The ingest-derived REQUEST columns are EMPTY until a sync runs.** On any database that has not
run `family_camp_derived` since #1878, they are schema-only and the roster renders every party
unknown/unflagged — the API looks broken while working exactly as designed. The unit registry is
NOT affected: the boot loader creates those rows, so the inventory and the read-only board render
regardless. It is the share gate, the request text and the housing flags that go dark.

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
- **Do not let the roster escalate on `needs_resolution`.** (`has_medical_narrative` is gone —
  kindred#1889 deleted it for this very reason.) True for 44
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
- **Do not number a migration from a branch, and do not trust a number written in this file.**
  Both places that hardcoded one went stale within three PRs. Recompute every time:
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
  row means "nobody has said". Confirmation is now possible and the amenities are seeded, so this
  starts mattering the moment staff confirm anything — not a reason to relax it.
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
  a failed unit query and saving would strip every member. On the board an empty unit list
  renders an empty board, which reads as "nothing to place" rather than "the fetch failed".
- **Do not POST an empty `unit_ids` when a card is dragged to the unplaced rail.** Call
  `DELETE /placements`. This bullet said the exact opposite until #1974: the tombstone existed
  only because reads fell through to the mirror, and with the fall-through gone an empty
  `unit_ids` is a 422. Any plan text describing a tombstone POST predates that change.
- **Do not restore the overlay to make untouched parties track CampMinder again.** That
  property was given up knowingly (#1974). If staff hit it, the fix is a visible "differs from
  CampMinder" indicator on the roster, not an invisible auto-update — a scenario that silently
  changes under a staff member is the same complaint in the other direction.
- **Do not make the copy merge into a worked scenario.** `POST /placements/copy` 409s when the
  scenario already holds placements for that weekend, deliberately: a gap-filling copy cannot
  tell a party nobody has reached yet from one staff deliberately unplaced, because both are
  now spelled as no row. "Re-baseline my plan against CampMinder drift" is a real and DIFFERENT
  feature; do not conflate it with seeding.
- **Do not accept a scenario-less write.** A blank `scenario` is a 422. With no scenario the
  board is read-only for everyone; an endpoint taking a scenario-less write is the one path
  around that.
- **Do not reinstate `scenario` on `lodging_assignments`.** The column is dropped; a filter
  naming it fails the whole ingest.
- **Do not render a value the model carries but nothing reads.** The map shipped with
  `MapUnit.consent` threaded through and never rendered, so a non-consenting shared room looked
  identical to any other — on the surface whose job is judging placements. Restored post-merge.
  Two smells worth grepping for after any plan: an import that is never called, and a field
  carried through a model that nothing reads.
- **Do not assume a green suite means a green run.** `Tests 5323 passed` alongside
  `Errors 1 error` and exit 1 is a CI failure. Always read the exit code, not the pass count.
- **Do not trust `computeAccessibleName()` as proof a name is exposed.** testing-library
  implements the accname COMPUTATION and does not enforce ARIA's name-prohibition, so it
  returns a name for `aria-label` on a role-less `<div>` that real screen readers ignore.
  Assert real DOM text (`sr-only`) instead.
- **Do not trust the Go suite to catch a dropped column.** The fixtures declare their own schema
  and never read `pb_migrations/` (#1921). A `Set` on a dropped column silently no-ops.

---

## 7. Useful one-liners

```bash
# Frontend gates. NOT `npm run lint`: the rtk proxy mangles the npm wrapper's
# output into a false failure.
cd frontend && node_modules/.bin/eslint src --ext ts,tsx   # 0 errors; ~348 pre-existing warnings
cd frontend && npm run type-check
# The board and the weekend surfaces share this directory: LodgingBoard.tsx,
# LodgingUnitCard.tsx, FamilyCard.tsx and the rosterAttention/weekendStatus helpers.
cd frontend && npx vitest run src/components/weekend/

# Python gates — the API now has a lodging service worth running on its own
uv run pytest tests/unit/api/services/test_lodging_roster_service.py tests/unit/api/test_lodging_phi_boundary.py -q
uv run ruff format api bunking tests && uv run ruff check api bunking tests
# NOT `mypy api bunking` -- pre-push runs the FULL tree including tests (~790 files).
# A test-only typing error passes the narrow form and fails at push. This cost a cycle already.
uv run mypy . --explicit-package-bases
uv run pytest tests/unit/api/ -q
uv run pytest tests/unit/api/ -k lodging -q

# Go gates — per task, not per phase
cd pocketbase && go test ./sync/ -count=1 && gofmt -l sync/ && go build ./...
rtk proxy golangci-lint run ./sync/...

# JS migrations (npm run lint gives a FALSE failure under rtk)
cd pocketbase && ./node_modules/.bin/eslint pb_migrations pb_hooks

# Lodging harnesses (all three now share scripts/dev/lib/pb-harness.sh, #1885)
./scripts/dev/verify-lodging-schema.sh && ./scripts/dev/verify-lodging-seed.sh
# THREE outcomes, not two: 0 pass, 1 leak, 2 = THE SCAN DID NOT RUN. It scans pb_migrations/ too.
./scripts/dev/verify-no-hardcoded-lodging.sh; echo "exit=$?"
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

### Filed by the map (#1939)

- **#1940 — wire `RosterParty.unit_codes` into the map.** UNBLOCKED: #1933 landed the field.
  A multi-room party currently sits on the "Placed, off the map" rail because a merge sends
  `unit_code: ""`. `resolvePartyUnits` in `mapModel.ts` is the only place a party becomes units
  and was written for exactly this, so nothing else should need to change. Real multi-room
  placements run 12–16 a year, so this is not hypothetical.
  (#1941 was here and is CLOSED — `_map_point` landed the API half; see §2.)


### CLOSED: every write path is race-guarded

Left here as the record of a gap that is now shut, because the shape recurs: any find-then-write
pair in this file races, and the answer is always one of the two existing shapes.

This section previously listed three unguarded paths and told you to fold them into the drag PR
(§4). They were fixed on their own instead, in **#1927**. Every write path in
`api/services/lodging_write_service.py` now holds:

| Path | Shape | Handled? |
|---|---|---|
| `place_party` create | find→create vs unique index | ✅ race-guarded |
| `unplace_party` delete | delete between find and delete | ✅ 404-idempotent |
| `set_availability` delete | delete between find and delete | ✅ 404-idempotent |
| `set_availability` create | find→create vs `idx_lodging_avail_unique` | ✅ race-guarded |
| `copy_from_mirror` seed | count→create vs the draft's unique indexes | ✅ race-guarded (#1974) |

A fifth row sat here — `delete_merge`, 404-idempotent — until **#1931** deleted that method
along with `lodging_merges_draft`. Its shape is the same as the two deletes above, so nothing
about the lesson changed; there is just one fewer place to apply it.

Both create-retries also guard their OWN recovery — the re-read and the update inside the except
block go through `pb_error_to_http` too, because an unwrapped failure there is the same bare 500
the retry exists to prevent.

**Do not read that as "concurrency is handled."** These guard the write paths, not occupancy:
two staff can still place different parties into one unit without either write failing. That is
kindred#1907, and it is a modelling question for the board, not an exception handler.

### CLOSED: #1923 — the delete guards were blind to draft rows

Left here as the record of a gap that is now shut, and of a wrong belief about PocketBase that
made half of it look safe to skip.

**(a) is done.** `countAssignments` (`pocketbase/lodging/hooks.go`) now spans both
`lodging_assignments` and `lodging_assignments_draft`, filtering `units.id ?= {:id}` against
each, so `guardUnitDelete` refuses to delete a unit that still holds a draft placement, not only
a confirmed one. `1500000130` opened `lodging_units` to `bunking.manage`, so this closes exactly
the gap that mattered: the delete was reachable from `/manage/lodging` by staff other than the
one who placed the scenario row. **This is user-facing**: staff can no longer delete a unit
holding draft placements — deactivate instead, same as they already had to for a confirmed one.

**(b) is moot.** There is no `lodging_merges_draft` left to guard — **#1931** (§2) deleted it
outright and folded merging into a placement's own `units` set. `guardUnitDelete` now covers what
a separate merge delete guard would have: a merged slot is a placement whose `units` has two or
more members, so "don't break up an occupied merge" and "don't delete an occupied unit" are the
same rule, enforced by the same guard.

**A correction, since it is what made (b) look harmless in the first place.** This section used
to argue that a delete guard on `lodging_merges_draft` would "contradict behaviour already
documented in `delete_merge`" — namely that a placement whose slot was deleted "keeps its row and
reads as unplaced rather than vanishing." **That was wrong about PocketBase.** `deleteRefRecords`
(`core/record_model.go:1576`) does not leave a clean, harmless "unplaced" row behind: it removes
the deleted id from the `units` list of every placement holding it and re-saves the row with
`SaveNoValidate`, skipping validation specifically so a dangling reference is tolerated. For a
placement sitting in exactly that one room, removing its only id EMPTIES `units`, and the row
survives saying nothing at all.

**#1974 changed how bad that is, not whether the guard is needed.** Under the overlay an emptied
`units` set was the TOMBSTONE — it suppressed the CampMinder mirror, so the family silently read
as "staff took them off the board" rather than falling through to wherever CampMinder still had
them. With the fall-through gone the row now reads as plain unplaced, which is honest: the room
is gone. What survives unchanged is that the placement is **destroyed by a delete elsewhere in
the UI**, silently and with no undo, which is exactly what `guardUnitDelete`'s refusal in (a)
exists to prevent. It was never true that deleting the slot degraded gracefully.

### #1925 — `party_size` counts adults who are not attending

`family_camp_adults` is keyed `(household, year)` with **no session and no attendance dimension**,
while children come from session-scoped `attendees`. `_build_household_parties` computes
`party_size = len(adults) + len(children)`, so every weekend gets ALL of the household's listed
adults — and most households list two.

Not cosmetic: **`party_size` is what the fit check judges cabin capacity against**, so this
silently over-sizes parties and can reject a cabin that suits them. **Not fixable from current
data** — only 2 adult attendee rows exist across all 2026 family sessions, so there is no
attendance signal to recover. Needs either a CampMinder field or a staff-editable override.
Degrades what drag is FOR, but does not block it.

### #1928 — the share gate resolves sibling disagreement newest-wins

Pre-existing, low urgency. `winsGate` has no fail-safe direction, so a household whose siblings
disagree can report the most permissive answer. #1926's eligibility fallback guards the NEW column
against this; the gate column itself is unchanged. Nothing that makes placement decisions reads
the gate any more, so this matters for the displayed value and for whatever consumes it next.

### #1917 — the 2026 inventory is not in production

Nothing in CI/CD does this and merging did not do it. Ordered: restart PocketBase (the loader
creates the new units) → dry-run `apply_lodging_inventory.py` → `--apply` for amenities on the
pre-existing rows → review → `--apply --structural` for the container promotion and the two
parent corrections. **Explicitly do not run `confirm_lodging_units.py` against production.**

### Filed out of the collapse (#1931), none blocking

- **#1935 — a placement silently degrades when one of its units is deleted.** `_placement_of`
  drops an unresolvable id, so a two-room placement whose second unit was deleted renders as an
  ordinary one-room one. Deliberately left; it needs a product answer, not a fix. Note the
  tempting justification is wrong: this does NOT preserve precedent, because pre-collapse a
  merged slot was one atomic record that either resolved or did not. *Partial* degradation
  inside a slot is a state the collapse itself created.
  (#1936 was here and is CLOSED — `REFUSAL_STATUSES` re-raises 401/403 before any recovery, in
  all four write paths: both creates, both updates, and the seed's `_seed_failure`. The 400
  recovery is untouched. Note the update branches were the COMMON path once drag shipped.)
- **#1937 — `golangci-lint` is not in the pre-push hook.** Go lint failures pass every local
  gate and surface only in CI. Cost two round-trips on #1933. Run it by hand until this lands:
  `cd pocketbase && golangci-lint run --config ../.golangci.yml > /tmp/lint.out 2>&1; echo $?`
- **#1934 — two stale statements in this file**, both fixed in the PR carrying this text.

### The rest

- **#1891 is fixed** — `verify-no-hardcoded-lodging.sh` now ignores comments and docstrings and is
  green on a clean `main`. **But it never scans test files** (`:68` filters `_test.`, `.test.`,
  `/tests/`), which is where every lodging fixture lives. A green run is not evidence that no
  real unit names are present in tracked source. Adam's ruling when this was raised: names in
  tests are fine for now — so do not scrub them unprompted, and do not read the green as proof.
- **Free text carries PHI the boundary does not cover.** Families type medical detail into the
  *cabin-request* box: across 2026 family weekends, **12 of 232 request texts (5%)** contain health
  vocabulary, including at least one named diagnosis with the accommodation it requires. That text
  is `request_text` — an ordinary roster field, ungated — while `family_camp_medical` is
  admin-gated. Predates this work; the owner's call, deliberately not acted on. Options are gate the
  text, flag it for review, or accept it.
- ~~**`has_medical_narrative` is true for every household**~~ **RESOLVED — the flag is deleted**
  (kindred#1889). It was true for 62 of 62 in 2026 and 100.0% in each of 2024-26, because these
  questions store their negative answer as the text "No". Narrowing it was measured and rejected:
  a boilerplate-negative filter still lands at 67.7% / 52.6% / 55.9% across those years. Deleting it
  removed the whole-year `family_camp_medical` read from BOTH `build_roster` and `build_summary` —
  the narrative now has one reader, `get_household_medical`, one household at a time behind
  `Permission.LODGING_PHI`. The reveal button went with it: `MedicalNarrative` renders on
  `FamilyDetailsPanel` for a PHI holder, and `HouseholdRosterRow` carries chips only.
- **The weekend surfaces were never verified in a browser after #1890's last three commits.**
  Merged and green, but nobody has *looked* at the lander, the Listbox switcher or the stats bar
  — they are covered by tests and by direct API measurement only. Worth ten minutes with
  `./scripts/start_dev.sh`. **The board is an interaction surface and a green suite proves
  nothing about whether it feels right**, so the drag PR must end with a card dragged in a real
  browser on the worktree's Vite port.
- **Nothing in #1903 was verified in a browser either.** The one visual check that phase got
  covered a merge-repair panel that no longer exists. The replay path is proven by direct
  measurement on real data, not by looking at it.
- **#1907 — lodging occupancy is unmodelled**, and it is the constraint that matters. Nothing
  stops two families being placed in the same bedroom; the unique indexes only stop one party
  holding two placements. Staff-confirmed rules are in
  `docs/architecture/lodging-occupancy.md`. **The drag PR is the surface that forces this** —
  read the doc before designing placement validation, and see §4 for the two consent questions
  deferred to it. §11 measured `unit_class` as flagging zero of the three shared units on real
  data, so it is not what makes the board truthful.
- **#1908 — no test drives `replayOnResolve` through a replay that succeeds.** Every hook test
  exercises refusal or failure. The success path is proven manually, so this is a missing
  regression guard rather than missing evidence: the lodging test harness builds 5 collections
  and a real replay needs ~13, and Go cannot share `_test.go` helpers across packages.
- **The summer campers tab was never mined.** `/summer/session/:id/campers` (`CampersView`) is the
  closest analogue to the roster table and likely has filter/sort affordances worth copying. Traced
  as far as the component and stopped.
- **A green CodeRabbit check is weak evidence, twice over in this programme.** It reviewed #1890
  only up to `2451582e`, three commits behind HEAD — it never saw the stats bar, the
  summer-language rewrite or the batched endpoint, and two files it did review no longer existed.
  On #1915 it was rate-limited for most of the PR's life and **never reviewed `4b8b541c` at all**,
  because auto-merge fired while its incremental pass was still running — which is how the three
  unguarded write paths above reached `main`. **The tell is a review comment saying "Actionable
  comments posted: N".** A green check with no such comment means it never ran. Check which
  commit it reviewed, and whether it reviewed anything.

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
- **#1916 is moot** — `lodging_merges` no longer exists (**#1931**, §2), so there is nothing left
  to make admin-only.
- **#1918** — guard against a whole-building sheet row stranding its rooms on the container. See
  the count-reconciliation lesson in §2.
- **#1920** — bound the scenario-mode `/summary` fan-out. It runs a nested `TaskGroup` per
  weekend; there was no caller passing a scenario when it shipped, and **the drag PR becomes
  one**.
- **#1921** — Go fixtures declare their own schema, so a dropped column stays green in the suite
  and breaks in production. This is how dropping `scenario` broke the ingest. See §2 and §6.
- **#1922** — the lodging verify harnesses trust a prebuilt binary with no staleness check, so a
  green harness can be describing a binary that predates the migration under test.
- **#1919** — `.coderabbit.yaml:55` reads as a ban on `from __future__ import annotations`.
- **#1912** — filter the roster and board by needs and requests. Unscheduled.
- **#1909** — 2 of 4 boxes left: a recorded decision on the CampMinder-vocabulary cluster (29
  hits, reducible to one literal per field by aliasing at the sync boundary) and documenting the
  audit command. The hardcoded-string count is holding at 46.

---

## 9. Cross-session pointers

- **Driving the sync and the API as an agent** —
  `~/.claude/projects/-home-adam-kindred/memory/reference_driving_sync_and_api_locally.md`.
  Neither local API accepts a `_superusers` token: impersonate the admin *users* record via
  `POST /api/collections/users/impersonate/<id>`, send it raw to PocketBase custom routes and with a
  `Bearer` prefix to FastAPI. Also covers seeding `localStorage["pocketbase_auth"]` so a browser
  session works, and why `family_camp_derived` looks hung when it is not.
- **The spec for the board and the map** —
  `docs/superpowers/specs/2026-07-31-family-camp-lodging-board-map-design.md`. **Start with its
  status block**; parts of the document are dead and marked so. For the drag PR the live
  sections are §3.1, §3.2, §3.7, §3.9 and §11. The earlier
  `2026-07-30-family-camp-lodging-design.md` covers the data layer and the ingest.
  Both local-only and gitignored — never commit them.
- **Per-PR measurements and deviation lists live in the PR bodies**, not here: #1890 for the
  weekend surfaces, #1914 for the inventory reconciliation, #1915 for the write layer.
