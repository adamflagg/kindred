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
| 0 | Roster / summary latency | [#1966](https://github.com/adamflagg/kindred/issues/1966) | ½–1 day | Yes |
| 1 | Scenario plumbing, picker, read-only gating | [#1967](https://github.com/adamflagg/kindred/issues/1967) | 1–2 days | **Yes — gates all writes** |
| 1a | Multi-room positioning + coordinate pair rule | [#1940](https://github.com/adamflagg/kindred/issues/1940), [#1941](https://github.com/adamflagg/kindred/issues/1941) | ½ day | Yes |
| 2 | **Drag placement** | unfiled — `HANDOFF.md` §4 | 4–6 days | **Yes — this is the goal** |
| 3 | Roster/API correctness as one Python PR | [#1889](https://github.com/adamflagg/kindred/issues/1889), [#1936](https://github.com/adamflagg/kindred/issues/1936) | ≤1 day | Correctness |
| 4 | 2026 inventory rollout + container guard | [#1917](https://github.com/adamflagg/kindred/issues/1917), [#1918](https://github.com/adamflagg/kindred/issues/1918) | ½ day + staff walk | Parallel, blocks nothing |
| 5 | Parity polish — filters, tab state, sync invalidation | [#1912](https://github.com/adamflagg/kindred/issues/1912), [#1944](https://github.com/adamflagg/kindred/issues/1944), [#1894](https://github.com/adamflagg/kindred/issues/1894) | 1–2 days | **No — after the capability** |
| 6 | Decide what comes *out* of a finished plan | [#1968](https://github.com/adamflagg/kindred/issues/1968) | no code | Ask before step 2 opens |

**Total: 8–12 engineering days**, plus a cabin-confirmation property walk that sits on staff's calendar, not engineering's.

Also open and deliberately *not* on this path: [#1963](https://github.com/adamflagg/kindred/issues/1963) and [#1964](https://github.com/adamflagg/kindred/issues/1964) (further perf), [#1907](https://github.com/adamflagg/kindred/issues/1907) / [#1932](https://github.com/adamflagg/kindred/issues/1932) / [#1930](https://github.com/adamflagg/kindred/issues/1930) (occupancy and placement-assist design), the pin editor and Phase F geo.

---

## Two corrections to the go-live framing

### The Family Camp adult-field discovery is NOT a gate

It has been treated as one — "we're still figuring out how the real data is going to land". It isn't blocking, and the belief traces to a single false sentence repeated in two documents (`HANDOFF.md:944` and the share-eligibility spec `:273`) asserting that `party_size` is what the fit check judges cabin capacity against.

It is not. `party_size` has **four display consumers and zero decision consumers** — `partyAttention` (`frontend/src/components/weekend/rosterAttention.ts:76-119`) never reads it, and `place_party` performs no capacity check. Measured 2026 agreement with `Total Adults-FC` is **92.9% exact, bounded ±2, zero zero-adult households, one false amber.**

**Replace the discovery task with a half-day honesty patch:** soften the amber at `MapUnitPopover.tsx:139` and promote the caveat its own comment at `:134-136` already carries ("a SIZING HINT, not a verdict… it runs high"). [#1946](https://github.com/adamflagg/kindred/issues/1946) is worth doing whenever convenient because it renders a *blank adult name* today, which reads as a rendering bug. [#1925](https://github.com/adamflagg/kindred/issues/1925), [#1947](https://github.com/adamflagg/kindred/issues/1947) and [#1943](https://github.com/adamflagg/kindred/issues/1943) are post-go-live.

### "Live" is undefined, and the architecture cannot currently deliver its usual meaning

Every write requires a scenario; `lodging_assignments` is permanently admin-only by locked decision; there is no promote/publish endpoint in `api/routers/`; `lodging_assignments_sync.go` never writes back; no weekend surface imports `csvExport` or the PDF button.

So the board can only ever write **drafts**, and go-live today means *staff arrange in Kindred, then re-key into CampMinder by hand.* Summer avoids this by writing `bunk_assignments` directly in production mode (`useCamperMovement.ts:353`); lodging is structurally denied that path by its own one-way ingest design.

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

**#1967 — weekend scenario plumbing — MUST land before you can write anything.**
Every lodging write requires `scenario: str = Field(..., min_length=1)`
(`api/schemas/lodging.py:350`) and no weekend surface selects one yet. Check
whether #1967 has merged. If it has not, either take it as step one of your own
work or coordinate — but do not start the drag interaction on top of a surface
that cannot name a scenario.

Also check #1966 (roster latency) and #1940 (multi-room positioning). #1940 is
half a day and becomes live the moment drag can create a merge, so it belongs
immediately in front of you, not after.

## Scope

- Party → unit
- Party → unplaced rail. This is a **tombstone POST, not a DELETE**.
- Unit → unit merge: an extension of the SAME `POST /placements` body to
  `unit_ids: [a, b]`. #1931 collapsed three placement targets into one `units`
  set, so there is no separate merge interaction to build.
- Availability reserve/release rides along: `PUT /api/lodging/availability`
  takes the `unit_id` the card already holds and the badge already renders
  (`unitBadges.ts` → `LodgingUnitCard.tsx:30,68-72`).

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
(`api/services/lodging_write_service.py:78-147`) performs no validation of any
kind, by design. Every cabin currently has `is_confirmed = 0`, so
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
