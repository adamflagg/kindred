# Weekend Housing — Sequence to Go-Live

The ordered path to a **no-request, no-solver, otherwise summer-equivalent** weekend housing programme: staff place every family by hand, and the surrounding product — caching, polish, RBAC, error handling — matches summer.

This is a working doc for sequencing. Per-step detail lives in the linked issues; the tree and `docs/reference/issue-triage.md`'s Status cells are authoritative over both.

**Written 2026-08-03.** Every latency figure below is loopback against a local dev DB. Production runs behind a reverse proxy and a tunnel, and round-trip-bound costs scale with per-hop RTT, so real-world numbers are likely **worse**, not better.

---

## The fact that determines the order

**No open issue covers manual placement.** Working the entire triage backlog, every row, terminates with a read-only board. The capability exists only as a status-table row (`HANDOFF.md:41`) and a scope block (`HANDOFF.md:566-590`).

That is why this programme is plan-driven rather than triage-driven. Triage is the right instrument for correctness and polish; it structurally cannot reach a capability nobody filed.

---

## Sequence

| Step | Work | Issue | Size | Critical path? |
|---|---|---|---|---|
| 0 | Roster / summary latency — **DONE** | [#1966](https://github.com/adamflagg/kindred/issues/1966) | ½–1 day (spent) | Was yes; closed 2026-08-03 by PR #1976 |
| 0a | Scenarios replace the mirror, as summer's do — **DONE** | [#1974](https://github.com/adamflagg/kindred/issues/1974) | ~1 day (spent) | Was yes; closed 2026-08-03 by PR #1980 |
| 1 | Scenario plumbing, picker, read-only gating — **DONE** | [#1967](https://github.com/adamflagg/kindred/issues/1967) | 1–2 days (spent) | Was yes; closed 2026-08-04 by PR #1986 |
| 1b | **What comes OUT of a finished plan — ANSWERED** | [#1968](https://github.com/adamflagg/kindred/issues/1968) | none | Was a prerequisite of step 2; now cleared |
| 2 | **Drag placement** — placement only, no merge | [#1989](https://github.com/adamflagg/kindred/issues/1989) | 4–6 days | **Yes — this is the goal, and it is the only thing left on the path** |
| 2a | Multi-room placements on board and map | [#1940](https://github.com/adamflagg/kindred/issues/1940), [#1941](https://github.com/adamflagg/kindred/issues/1941), [#1982](https://github.com/adamflagg/kindred/issues/1982) | ½–1 day | Follow-up — unlocks merge-by-drag |
| 3 | Roster/API correctness as one Python PR | [#1889](https://github.com/adamflagg/kindred/issues/1889), [#1936](https://github.com/adamflagg/kindred/issues/1936) | ≤1 day | Correctness |
| 4 | 2026 inventory rollout + container guard | [#1917](https://github.com/adamflagg/kindred/issues/1917), [#1918](https://github.com/adamflagg/kindred/issues/1918) | ½ day + staff walk | Parallel, blocks nothing |
| 5 | Parity polish — filters, tab state, sync invalidation | [#1912](https://github.com/adamflagg/kindred/issues/1912), [#1944](https://github.com/adamflagg/kindred/issues/1944), [#1894](https://github.com/adamflagg/kindred/issues/1894) | 1–2 days | **No — after the capability** |

**Step 2a gained a third issue, and it is the only newly-filed work that is order-specific.** [#1982](https://github.com/adamflagg/kindred/issues/1982) — the fit check settles `needs_private_bathroom` by reading the assigned unit's own `bathroom` field (`rosterAttention.ts:51-55`), and a merged placement resolves to no single unit, so `partyAttention` reports `unverified`. The result is that the one placement which physically delivers a private bathroom — a household holding every room in a building — is the one the board can never credit. The rule the registry already supports is exclusivity: a party satisfies the need when its units cover every member of that `bathroom_group`. It is gated on #1940 for the same reason as the rest of 2a (a merged party carries no unit codes until that lands), but it is a **separate decision** — it changes what `settled` means for a merge, so it should be taken deliberately rather than folded in.

**Nothing else filed since this doc was written belongs in the sequence.** #1922 (verify-harness staleness, merged) was never on the path. #1963 / #1964 remain deliberately off it. The post-rollout guard now recorded on #1917 — stop `apply_lodging_inventory.py` overwriting units staff have confirmed — is a **follow-up to step 4, not a prerequisite**: the hazard does not exist until confirmations do, and it is tracked in that issue's own acceptance list rather than here.

**Step 1b is answered, and the answer was "nothing"** ([#1968](https://github.com/adamflagg/kindred/issues/1968), closed 2026-08-03). The owner's ruling: *we never write anything to CampMinder, same as summer; it is a planning tool until such time CampMinder opens up their API.* Going live therefore means **staff can drag families around inside a scenario** — the same bar summer clears — and a finished plan is re-keyed by a human, exactly as a finished summer plan is.

That clears the prerequisite rather than satisfying it with work. The only reason this gated step 2 was the printed-cabin-list option, which would have required print-shaped data — stable ordering, legible labels, occupancy per room — that nothing else would prompt anyone to add. Recorded but deliberately not filed: summer ships both export artifacts (`lib/csvExport.ts` from `CampersView`, `AllCampersView`, `BunkCard` and `ScenarioComparisonPage`, plus `PdfExport/BunkPlanReport` behind `LazyPdfExportButton`) and no weekend surface imports either, so strict summer parity would eventually put those on weekend too. That is parity polish well after the capability, not a gate on it.

**Total: 9–15 engineering days**, summing every row including the parallel step 4 — it is half a day of engineering even though it blocks nothing. This is effort, not calendar duration, and it excludes the cabin-confirmation property walk, which sits on staff's calendar rather than engineering's. The earlier "8–12" did not reconcile with its own table.

**Two owner decisions, 2026-08-03, changed steps 0a–2a from what this table first said.**

- **Lodging scenarios adopt summer's semantics** ([#1974](https://github.com/adamflagg/kindred/issues/1974), **done**). A lodging scenario used to OVERLAY the CampMinder mirror per party, so a fresh scenario rendered the synced placements and "unplaced" needed a tombstone row. Summer's draft table *replaces* production and is seeded by an explicit copy. There was no principled asymmetry — `sync/bunk_assignments.go` and `sync/lodging_assignments_sync.go` are both registered sync services — so the divergence was removed. **Consequences: dragging a party out of a cabin is a `DELETE`, not a tombstone `POST`; and a new scenario is EMPTY, so the picker (step 1) must offer `POST /api/lodging/placements/copy`.**
- **The unplaced rail has been replaced by a floating queue** (landed, PR #1984). The weekend unplaced-popout work removed the board's fixed 240px rail (`LodgingBoard.tsx:101`) and the map's 280px one, in favour of summer's `FloatingUnassignedBadge` pattern extracted into a shared `FloatingQueueBadge` shell. **So "drag to the unplaced rail" is a drop target that no longer exists** — the target is the floating badge/popover (`ui/FloatingQueueBadge.tsx`, `weekend/FloatingUnplacedBadge.tsx`). Summer's badge is already a dnd-kit droppable, so the pattern is in the tree, but do not plan against the rail. That work also adds `sort_name` to `RosterParty` and orders the queue by last name, which retires `rankUnplaced`'s mandatory-accommodation ranking — and with it the caveat the board currently prints about that ranking being half-uncomputable.
- **Drag ships placement only.** Party → unit and party → rail. Unit → unit merge is **out**, because `buildBoard` indexes parties by `party.unit_code` and `_placement_of` sends `unit_code: ""` for any placement spanning 2+ rooms — so the board cannot draw a multi-room placement at all today, and drag-to-merge would make the card vanish into the off-board section. That is why #1940 moved from in front of drag to behind it: it is the render fix that *unlocks* merge, not a prerequisite for placement. Roughly 12–16 multi-room placements a year, ~3% of the total.

Also open and deliberately *not* on this path: [#1963](https://github.com/adamflagg/kindred/issues/1963) and [#1964](https://github.com/adamflagg/kindred/issues/1964) (further perf), [#1907](https://github.com/adamflagg/kindred/issues/1907) / [#1932](https://github.com/adamflagg/kindred/issues/1932) / [#1930](https://github.com/adamflagg/kindred/issues/1930) (occupancy and placement-assist design), the pin editor and Phase F geo.

---

## Two corrections to the go-live framing

### The Family Camp adult-field discovery is NOT a gate

It has been treated as one — "we're still figuring out how the real data is going to land". It isn't blocking, and the belief traces to a single false sentence repeated in two documents (`HANDOFF.md:944` and the share-eligibility spec `:273`) asserting that `party_size` is what the fit check judges cabin capacity against.

It is not. `party_size` has **four display consumers and zero decision consumers** — `partyAttention` (`frontend/src/components/weekend/rosterAttention.ts:76-119`) never reads it, and `place_party` performs no capacity check. Measured 2026 agreement with `Total Adults-FC` is **92.9% exact, bounded ±2, zero zero-adult households, one false amber.**

**Replace the discovery task with a half-day honesty patch:** soften the amber at `MapUnitPopover.tsx:139` and promote the caveat its own comment at `:134-136` already carries ("a SIZING HINT, not a verdict… it runs high"). [#1946](https://github.com/adamflagg/kindred/issues/1946) is worth doing whenever convenient because it renders a *blank adult name* today, which reads as a rendering bug. [#1925](https://github.com/adamflagg/kindred/issues/1925), [#1947](https://github.com/adamflagg/kindred/issues/1947) and [#1943](https://github.com/adamflagg/kindred/issues/1943) are post-go-live.

### "Live" is undefined, and the architecture cannot currently deliver its usual meaning

Every **placement** write requires a scenario; `lodging_assignments` is permanently admin-only by locked decision; there is no promote/publish endpoint in `api/routers/`; `lodging_assignments_sync.go` never writes back; no weekend surface imports `csvExport` or the PDF button.

(This said "every write" until [#1998](https://github.com/adamflagg/kindred/issues/1998). Availability writes now require none — `1500000135` deleted the scenario dimension from `lodging_availability`, because a burst pipe closes a cabin in every plan for that weekend. The argument below is unaffected: it is about *placements*, which are still draft-only.)

So the board can only ever write **draft placements**, and go-live today means *staff arrange in Kindred, then re-key into CampMinder by hand.*

**This section originally added "Summer avoids this by writing `bunk_assignments` directly in production mode (`useCamperMovement.ts:353`); lodging is structurally denied that path." That is wrong on both halves** (corrected 2026-08-03, and on [#1968](https://github.com/adamflagg/kindred/issues/1968) itself):

- `useCamperMovement` does contain a production write path, but **the board never reaches it** — `BunkingBoardByArea.tsx:380` returns early from `handleDragEnd` when `isProductionMode`, and `bunk_assignments` is admin-only besides.
- **Nothing writes back to CampMinder for any programme.** The only outbound POSTs in `pocketbase/sync` go to the internal solver API (`sync/process_requests.go:169`) and a geocoder (`sync/normalize_geographic.go:575`). The Go tree does make other outbound writes — `feedback/github.go:102` POSTs a GitHub issue — but none of them reach CampMinder.

A finished summer plan reaches CampMinder the same way a weekend plan would: a human re-keys it. So this is a product question for both programmes, not a lodging deficiency to close — which makes "manual re-key, and that's fine" a considerably stronger year-one answer than the original framing implied.

That may be the correct year-one answer. But it changes what the board must render, so it is [#1968](https://github.com/adamflagg/kindred/issues/1968) and it wants an answer in week one, not week two of drag.

---

## What is already at or above summer's standard

Do not fund a broad polish sweep. Weekend's query-key discipline, `QueryGuard` coverage, route hardening (`ErrorBoundary` + `Suspense` on both routes), tab accessibility, and especially its PHI cache handling (opt-in, `staleTime: 0, gcTime: 0, retry: false` — a control summer has no analogue for) are all sound.

The genuine parity gaps are narrow: `HouseholdRosterTable` has no search, sort or filter where summer's `CampersView` has four ([#1912](https://github.com/adamflagg/kindred/issues/1912)); the four tabs use bare `&&` rather than `<Activity mode=…>` so every tab switch destroys the map's viewport state (`SessionView.tsx:405-494` is the exemplar); and `SYNC_DEPENDENT_PREFIXES` (`queryClient.ts:66-94`) lists no lodging prefixes, so the lodging ingest sync invalidates nothing it wrote.

Caching and per-render recomputation were the other two and were fixed in PR #1965 — see `CLAUDE.md` §4 "Family Camp Models Summer" for the rule that came out of it.

---

## Things not to do, with reasons

Each of these was proposed and rejected on evidence. They will be proposed again.

- **Do not narrow `fetch_prior_household_cm_ids` to the weekend's household ids.** A 183-term OR filter returns 200; a 250-term one returns **400** — undocumented, and it fails closed. It also splits the deliberate single `TaskGroup` argued for at `lodging_roster_service.py:199-202`, and cannot express `/summary`'s year grain. Cache instead.
- **Do not add lander→roster prefetch on hover.** `HANDOFF.md:707-710` bans per-weekend `/roster` calls from any multi-weekend view.
- **Do not rebuild the merge-legality rule.** Built across nine tasks, removed in #1903. Read `docs/architecture/lodging-occupancy.md` before touching placement constraints, and do not push enforcement into the ingest.
- **Do not gate drag on the fit check**, and do not bulk-confirm cabins to un-dark it. `is_confirmed` asserts a human physically checked the cabin; confirmation is a property walk, not an engineering task. Ship with the check dark.
- **Do not plan off `HANDOFF.md` §8.** It has drifted — it calls #1926 unmerged when `d5951b69` merged it, and lists #1928 and #1935 as open when both are closed.
- **Do not filter `has_medical_narrative` — delete it** ([#1889](https://github.com/adamflagg/kindred/issues/1889)). Stripping the literal `"No"` still leaves 67.7% / 52.6% / 55.9% flagged across 2024–26, swinging 15 points a year.

---

## Appendix — handoff prompt for step 2 (drag placement)

Paste this to a fresh agent. It is written to survive this codebase's specific traps: stale issue bodies, a removed rule that looks like it should be rebuilt, and a drifted HANDOFF section.

````text
Implement drag placement on the Family Camp weekend lodging board — the phase
HANDOFF.md calls "C2". This is the capability the whole weekend housing
programme exists to deliver: today the board is READ-ONLY and staff cannot
place a single family.

## Read first, in this order — do not skip

1. `HANDOFF.md` §1 (programme status), §2 (what is live), §3/§3a (locked
   decisions), §4 (THE SPEC FOR YOUR PHASE), §6 (what not to do), §7 (commands).
2. `docs/architecture/lodging-occupancy.md` — MANDATORY. A merge-legality rule
   was built across nine tasks and then REMOVED in #1903. Read why before you
   touch placement constraints. Do not rebuild it. Do not push enforcement into
   the ingest.
3. `docs/superpowers/specs/2026-07-31-family-camp-lodging-board-map-design.md`
   §3.2 — the always-scenario model you depend on.

**Do NOT plan off HANDOFF §8 ("Open issues").** It has drifted: it calls #1926
unmerged when d5951b69 merged it, and lists #1928 and #1935 as open when both
are closed. Trust `docs/reference/issue-triage.md`'s Status cells and the tree.

## Your blocking prerequisite

**#1967 — weekend scenario plumbing — MUST land before you can write a placement.**
Every write that names a *plan* extends `ScenarioWriteRequest`, where `scenario`
is `Field(..., min_length=1)` (`api/schemas/lodging.py`, and re-grep rather than
trusting a line number), and no weekend surface selected one yet. Check whether
#1967 has merged. If it has not, either take it as step one of your own work or
coordinate — but do not start the drag interaction on top of a surface that
cannot name a scenario.

**This said "every lodging write" and named a line that has since moved. Both
were fixed after [#1998](https://github.com/adamflagg/kindred/issues/1998).**
`AvailabilityWriteRequest` no longer extends `ScenarioWriteRequest`: availability
is a fact about the weekend rather than about the plan, so holding a cabin back
needs no scenario and works on the CampMinder mirror.

Also check #1966 (roster latency). **#1974 (scenarios replace the mirror) has
landed**, so a scenario is a plan of its own, seeded by `POST
/api/lodging/placements/copy`, and a party with no draft row is unplaced.

## Scope

- Party → unit
- Party → the unplaced queue. **Check what that queue IS before you build the
  drop target.** The weekend unplaced-popout work replaces the board's fixed
  left rail with a floating badge/popover built on a shared
  `FloatingQueueBadge`; if it has landed, the rail is gone and you are making
  the badge droppable, as summer already does with `FloatingUnassignedBadge`.
  **The write is `DELETE /placements`** (#1974, landed). Older text —
  including HANDOFF §2's three-state table and §6 — says it must be a
  tombstone `POST` with an empty `unit_ids`. That was true under the OVERLAY
  read, where deleting the row fell through to the CampMinder mirror and put
  the family back in the cabin they were just dragged out of. The fall-through
  is gone, an empty `unit_ids` is a 422, and HANDOFF §2 and §6 have been
  rewritten to match.
- **Unit → unit merge is OUT OF SCOPE.** `buildBoard` indexes parties by
  `party.unit_code`, and `_placement_of` sends `unit_code: ""` for a placement
  spanning 2+ rooms — so the board cannot draw a multi-room placement at all,
  and a merge created by drag would make the card vanish into "Placed outside
  the board". #1940 (step 2a) is the render fix that unlocks this; it is a
  follow-up, not a prerequisite. Do not build merge-by-drag before it.
- Availability reserve/release rides along IF it fits: `PUT
  /api/lodging/availability` takes the `unit_id` the card already holds and the
  badge already renders (`unitBadges.ts` → `LodgingUnitCard.tsx:30,68-72`).
  Drop it and say so rather than half-building it.

The write endpoints ALREADY EXIST (#1915) and are race-hardened (#1927). You
are wiring a UI to them, not designing an API.

## Non-negotiable: optimistic updates with rollback

`HANDOFF.md:578-580` puts this in scope verbatim — "A rejected write must roll
the card back with a toast… A silent revert is not acceptable."

There is also a mechanical reason. React Query serves previous data during a
refetch, and `LodgingBoard.tsx:39` derives layout from `parties`. An
invalidate-only path rubber-bands the dragged card back to its source cabin for
the length of the refetch.

**Warning:** the spec claims summer's `useCamperMovement` is the optimistic
exemplar. That is FALSE — it has no `onMutate`, only `onSuccess` invalidation
at `:361-403`. You are writing this layer from scratch. Budget for it.

## Cache invalidation is now your job

Weekend queries moved from a 30-second staleTime to the app default of 30
minutes, to match summer (PR #1965). Your mutations MUST explicitly invalidate
`queryKeys.weekendRoster` and `queryKeys.weekendSummary`. Nothing will refresh
on its own. Note #1967 adds a scenario dimension to the roster query key —
invalidate the right slot.

## dnd is the cheap part

Four in-repo exemplars: `BunkingBoardByArea.tsx:122-142`/`:373`/`:590-725`,
`BunkCard.tsx:153`, `UnassignedCampers.tsx:24`, `CamperCard.tsx:103`. The test
idiom is settled: mock the hooks, because jsdom cannot do pointer drags.

## Two consent questions HANDOFF defers to exactly this PR

`HANDOFF.md:600-607`. Their vocabulary is stale — phrased on `maybe_mutual`,
which #1926 replaced with `ShareEligibility` (`api/schemas/lodging.py:70`) —
but the instruction survives: say on the surface what the board flags on.
Answer them; do not re-litigate them.

## Do NOT gate on the fit check

`partyAttention` is advisory. `place_party`
(`api/services/lodging_write_service.py:78-147`) does not enforce the
fit/capacity check, by design — it DOES validate scenario, grain, permission,
a non-empty unit set (#1974) and unique-index races, so do not read this as
"the write path checks nothing". Every cabin currently has `is_confirmed = 0`, so
`rosterAttention.ts:102` refuses to judge any housing need — the fit check is
dark and will stay dark until staff physically walk the property. Ship drag
with it dark. Do not bulk-confirm units to work around this; `is_confirmed`
asserts a human checked the cabin, and `docs/reference/issue-triage.md` bans
`confirm_lodging_units.py` against production.

## Housekeeping while you are in the file

`LodgingBoard.tsx:14` still tells the reader "Phase B's draft tables… do not
exist yet." They shipped in #1915. Fix it.

## Process

- Work in a worktree: `./scripts/worktree/new.sh <name>`. Never bare
  `git worktree add`; never commit to main.
- STRICT TDD: write failing tests, verify they fail for the right reason, then
  implement. Tests are the specification.
- Family Camp models summer wherever possible — `CLAUDE.md` §4 "Family Camp
  Models Summer". A divergence must be deliberate and justified in a comment.
- Before claiming done: `cd frontend && npx vitest run && npx tsc --noEmit`,
  plus `uv run pytest tests/` if you touch Python. Read the EXIT CODE, not the
  pass count — a green count beside a nonzero exit is a failure.
- Open the PR non-draft. Do not merge without explicit instruction.

Estimated 4–6 days, extrapolated from #1911 (2,548 insertions/17 files), #1939
(2,834/13) and #1915 (3,163/22) — not from a comparable dnd PR, so treat it as
a rough order of magnitude.
````
