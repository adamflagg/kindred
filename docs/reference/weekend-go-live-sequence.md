# Weekend Housing — Sequence to Go-Live

The ordered path to a **no-request, no-solver, otherwise summer-equivalent** weekend housing programme: staff place every family by hand, and the surrounding product — caching, polish, RBAC, error handling — matches summer.

> **The critical path is COMPLETE as of 2026-08-04.** Staff can drag families into cabins, hold a cabin back and release one, and the counts no longer treat permanent staff housing as planning inventory. What remains is listed under "What is left" and **none of it gates go-live** — the largest item is an operational rollout, not engineering.
>
> This doc is now kept for two things: the record of what is left, and the "Things not to do" section, which is the part that has repeatedly saved work. It is a **working doc — rewrite it to current state rather than appending**. Per-step detail lives in the linked issues; the tree and `docs/reference/issue-triage.md`'s Status cells are authoritative over both.

**Originally written 2026-08-03, rewritten 2026-08-04** when the path finished. Latency figures quoted in the linked issues are loopback against a local dev DB; production runs behind a reverse proxy and a tunnel, so real-world numbers are likely **worse**.

---

## Where things stand

| Step | Work | Issue | State |
|---|---|---|---|
| 0 | Roster / summary latency | [#1966](https://github.com/adamflagg/kindred/issues/1966) | **done** — PR #1976 |
| 0a | Scenarios replace the mirror, as summer's do | [#1974](https://github.com/adamflagg/kindred/issues/1974) | **done** — PR #1980 |
| 1 | Scenario plumbing, picker, read-only gating | [#1967](https://github.com/adamflagg/kindred/issues/1967) | **done** — PR #1986 |
| 1b | What comes OUT of a finished plan | [#1968](https://github.com/adamflagg/kindred/issues/1968) | **answered** — see below |
| 2 | **Drag placement** — the capability the programme existed for | [#1989](https://github.com/adamflagg/kindred/issues/1989) | **done** — PR #1990 |
| 3 | Roster/API correctness as one Python PR | [#1889](https://github.com/adamflagg/kindred/issues/1889), [#1936](https://github.com/adamflagg/kindred/issues/1936) | **done** — PR #1994 |
| 2a | Multi-room placements on board and map | [#1940](https://github.com/adamflagg/kindred/issues/1940), [#1982](https://github.com/adamflagg/kindred/issues/1982) | **#1940 done** — PR #2010; #1941 in PR #1994; #1982 open |
| 4 | 2026 inventory rollout | [#1917](https://github.com/adamflagg/kindred/issues/1917) | **open** — #1918 done |
| 5 | Parity polish | [#1912](https://github.com/adamflagg/kindred/issues/1912), [#2004](https://github.com/adamflagg/kindred/issues/2004), [#1944](https://github.com/adamflagg/kindred/issues/1944), [#1894](https://github.com/adamflagg/kindred/issues/1894) | **open** |

**A four-stage programme landed after this doc was first written and is not a step above.** Lodging availability segregation — the board stops drawing staff housing (#1993), counts and stats bar follow (#1995), availability loses its scenario dimension (#2001, closing #1998), the reserve/release write surface (#2002, closing #1999), and the `allocation_default` → `inventory_class` rename (#2003, closing #2000). Its plan is local-only at `docs/superpowers/plans/2026-08-04-lodging-availability-segregation.md` and carries the reasoning; its durable rules are in `CLAUDE.md` §4.

## What is left

**#1917 — the 2026 inventory rollout — was run against production on 2026-08-03**: the registry seeded and `--apply` completed. Two things remain on it and neither is a runbook step. The **cabin-confirmation** acceptance rests on a premise that turned out to be wrong — the owner reports the Master Housing sheet was filled in by staff who had already walked the property, so the amenity data is verified at source and "nobody has checked these cabins" does not hold. Whether that licenses setting `is_confirmed` in bulk for the units the sheet covers is an open decision, not a walk. Separately, the **amenity columns the sheet carries but the registry did not** (`beds`, `has_fridge`, `is_accessible`) have since arrived: measured on the registry 2026-08-10, `has_fridge` and `is_accessible` are populated on 101 of 118 units and `beds` on 94. The importer that filled them (`scripts/dev/import_master_housing.py`) was **deleted once that load completed** — it was bootstrap tooling, ran manually, and read a sheet whose id it had to carry in a public file. Recover it from git history if a future season needs a re-import; `apply_lodging_inventory.py` remains the sanctioned registry→database writer and never touched the sheet.

**#1940 — multi-room placements — shipped in PR #2010.** `indexPayload` resolves `unit_codes` and draws a party on every room it holds, so a family holding a whole building is no longer drawn nowhere; `partyCount` de-dupes by `partyKey` so it still counts as one family. Roughly 12–16 such placements a year, ~3% of the total. Two things followed from it: **merge-by-drag is now unblocked** (#2012 — it was excluded from step 2 for exactly this reason and had never been filed), and #1982 lost its gate.

#1982 was gated on #1940 but is a **separate decision**: the fit check settles `needs_private_bathroom` from the assigned unit's own `bathroom` field (`rosterAttention.ts`), and a merged placement resolves to no single unit — so the one placement that physically delivers a private bathroom is the one the board can never credit. The rule the registry supports is exclusivity: a party satisfies the need when its units cover every member of that `bathroom_group`. It changes what `settled` means for a merge, so take it deliberately rather than folding it in.

**Step 5 is polish and should stay behind the capability.** #1997 (map highlight toggles and marks covering cabin labels) belongs here too and was deliberately never folded into the availability stages. #2016 — a marker on the card when a household wrote a request — is polish of the same kind, settled against a mockup of real data: the marker ships, the prose does not.

**Specified but never filed, now caught up.** Walking the six family-camp specs against the issue tree surfaced work that existed only in prose: #2012 (merge-by-drag, Plan 4 Phase C scope), #2013 (the pin editor, Plan 4 §3.14, which shipped without it), #2015 (nothing pins the sibling-request collapse rule), #2011 (clearing a plan offers to refill it from CampMinder, a trap that armed the moment unplacement shipped), and #2007/#2008/#2009 (`parent_unit` on the payload, and the whole-building signal and count that need it). Triage cannot see spec-only scope; only a spec-to-issue pass can.

Deliberately **not** on this path: [#1963](https://github.com/adamflagg/kindred/issues/1963) / [#1964](https://github.com/adamflagg/kindred/issues/1964) / [#1975](https://github.com/adamflagg/kindred/issues/1975) / [#1920](https://github.com/adamflagg/kindred/issues/1920) (further perf), [#1907](https://github.com/adamflagg/kindred/issues/1907) / [#1932](https://github.com/adamflagg/kindred/issues/1932) / [#1930](https://github.com/adamflagg/kindred/issues/1930) (occupancy and placement-assist design), [#1925](https://github.com/adamflagg/kindred/issues/1925) / [#1943](https://github.com/adamflagg/kindred/issues/1943) / [#1947](https://github.com/adamflagg/kindred/issues/1947) (Family Camp adult identity), and **Phase F geo, now decided against rather than merely deferred** — see "Things not to do".

---

## Two corrections to the go-live framing

These are kept because both were believed, acted on, and wrong. They will be believed again.

### The Family Camp adult-field discovery is NOT a gate

It was treated as one — "we're still figuring out how the real data is going to land". The belief traces to a single false sentence repeated in two documents asserting that `party_size` is what the fit check judges cabin capacity against.

It is not. `party_size` has **four display consumers and zero decision consumers** — `partyAttention` (`frontend/src/components/weekend/rosterAttention.ts`) never reads it, and `place_party` performs no capacity check. Measured 2026 agreement with `Total Adults-FC` is **92.9% exact, bounded ±2, zero zero-adult households, one false amber.** The honest fix is to soften the amber in `MapUnitPopover.tsx` and promote the caveat its own comment already carries ("a SIZING HINT, not a verdict… it runs high"). ⚠️ **Updated 2026-08-09:** #1925 and #2046 have since shipped and `party_size` is now a BED count — blank and placeholder adult slots are dropped and a child under 18 months consumes no bed — so the "it runs high" half of that quoted comment no longer applies and the comment has been rewritten in place. The amber itself is untouched and the softening is still an open call; the number it fires on is simply better than it was.

### "Live" is undefined, and the architecture cannot deliver its usual meaning

Every **placement** write requires a scenario; `lodging_assignments` is permanently admin-only by locked decision; there is no promote/publish endpoint; `lodging_assignments_sync.go` never writes back. (Availability writes take an *optional* scenario: `1500000135` deleted the dimension for #1998, and kindred#2382 gave it back to the occupancy half alone — blank is the live board, a scope in its own right. The staff↔family role half still takes none. The argument here is about *placements*, which are still draft-only.)

So the board writes **draft placements**, and go-live means *staff arrange in Kindred, then re-key into CampMinder by hand.*

**The original framing said summer avoids this by writing `bunk_assignments` directly in production mode, and that lodging is structurally denied that path. That is wrong on both halves:**

- `useCamperMovement` does contain a production write path, but **the board never reaches it** — `BunkingBoardByArea.tsx` returns early from `handleDragEnd` when `isProductionMode`, and `bunk_assignments` is admin-only besides.
- **Nothing writes back to CampMinder for any programme.** The only outbound POSTs in `pocketbase/sync` go to the internal solver API and a geocoder.

A finished summer plan reaches CampMinder the same way a weekend plan does: a human re-keys it. This is a product question for both programmes, not a lodging deficiency — which makes "manual re-key, and that's fine" a considerably stronger year-one answer than the original framing implied. That is the ruling #1968 recorded: *we never write anything to CampMinder, same as summer; it is a planning tool until such time CampMinder opens up their API.*

---

## What is already at or above summer's standard

Do not fund a broad polish sweep. Weekend's query-key discipline, `QueryGuard` coverage, route hardening (`ErrorBoundary` + `Suspense` on both routes), tab accessibility, and especially its handling of the medical narrative's cache (opt-in, `staleTime: 0, gcTime: 0, retry: false` — a control summer has no analogue for) are all sound.

The genuine parity gaps are narrow, and one of the three originally listed here has since been closed:

- `HouseholdRosterTable` has no search, sort or filter where summer's `CampersView` has four — [#1912](https://github.com/adamflagg/kindred/issues/1912).
- The four tabs use bare `&&` rather than `<Activity mode=…>`, so every tab switch destroys the map's viewport — [#2004](https://github.com/adamflagg/kindred/issues/2004). `SessionView.tsx` is the exemplar.
- ~~`SYNC_DEPENDENT_PREFIXES` lists no lodging prefixes~~ — **fixed in PR #1965.** `queryClient.ts` now carries `weekend-sessions`, `weekend-summary` and `weekend-roster`, with a comment recording that a completed sync previously refreshed nothing it had just written.

Caching and per-render recomputation were fixed in PR #1965 — see `CLAUDE.md` §4 "Family Camp Models Summer" for the rule that came out of it, including the caching row, which has been got wrong once.

---

## Things not to do, with reasons

Each of these was proposed and rejected on evidence. They will be proposed again. **This is the most durable section of this document.**

- **Do not narrow `fetch_prior_household_cm_ids` to the weekend's household ids.** A 183-term OR filter returns 200; a 250-term one returns **400** — undocumented, and it fails closed. It also splits the deliberate single `TaskGroup` in `lodging_roster_service.py`, and cannot express `/summary`'s year grain. Cache instead.
- **Do not add lander→roster prefetch on hover.** Per-weekend `/roster` calls are banned from any multi-weekend view.
- **Do not rebuild the merge-legality rule.** Built across nine tasks, removed in #1903. Read `docs/architecture/lodging-occupancy.md` before touching placement constraints, and do not push enforcement into the ingest.
- **Do not gate drag on the fit check**, and do not bulk-confirm cabins to un-dark it. `is_confirmed` asserts a human physically checked the cabin; confirmation is a property walk, not an engineering task. `confirm_lodging_units.py` is dev-only and refuses a non-loopback URL — do not run it against production.
- **Do not build the geo layer, `lat`/`lng`, or the distance bands.** Measured and rejected 2026-08-04, against imagery rather than argument. USGS NAIP over the site is **0.3 m/px** — twice the detail the plan budgeted for, public domain, no key — and buildings resolve cleanly in the open. That is not the problem. The problem is that the proposed bands do not discriminate: at a site ~600–700 m across, a 75 m "near" radius swallows the whole developed core and 200 m reaches everything anyone would call camp, so `near` fires for nearly every pair and `far` means "an outlying cluster" — a distinction staff already make by name. Tree canopy also obscures a real share of the cabins, so the 93 pins are not all cheap. **And punting costs nothing on NEAR request satisfaction**, which was never blocked on geometry: 110 households requested NEAR for 2026 and not one is linked to the household they named. That is §7.3 name resolution, and no amount of imagery fixes it. Revisit only if §7.3 lands, since automatic NEAR satisfaction is the one consumer that would justify the pins.
- **Do not solve marks-covering-cabin-labels by moving the coordinate.** `map_x`/`map_y` say where the *building* is; a pin dragged so a label reads says where the *dot looks good*, and once those diverge nothing can tell them apart — the same shape as the reversal encoding below. The occlusion is systematic, not drift: coordinates were extracted from the PDF's label anchors, so a mark lands on the text by construction (median 35 px to the nearest label anchor, 47% within 30 px). Automated offsetting and redrawing the labels ourselves were both prototyped and both rejected by the owner — reasoning on #1997, so it is not re-proposed as new.
- **Do not reintroduce a scenario dimension on the staff↔family ROLE**, in any form including a draft twin. A burst pipe closes a cabin in every plan for that weekend; "we're moving staff to X for weekend Y" is true in every plan too (owner ruling, 2026-08-15). Deleted in `1500000135`, and `lodging_availability` still has no scenario column.
  ⚠️ **Amended 2026-08-17 (kindred#2382).** This entry used to read "on availability … including a draft twin", and as written it forbade what has since shipped on an owner ruling. `lodging_availability` was **one table answering two questions**: the role above, and *occupancy* — "somebody is in this room" — which is a modelling choice (not every write-in is non-rostered staff; some are paper registrations for families arriving with no children) and **is** scenario-scoped. Occupancy moved to `lodging_write_ins` with a draft twin, `lodging_write_ins_draft`. `1500000135`'s reasoning is untouched for the half it was actually made about. Read `docs/architecture/lodging-occupancy.md` before arguing either way.
- **Do not use a reversal encoding** for availability — a row meaning "the opposite of the unit's current role" silently inverts when an ordinary registry edit changes that role. Same shape as the tombstone bug #1974 removed.
- **Do not filter `has_medical_narrative` — delete it** ([#1889](https://github.com/adamflagg/kindred/issues/1889), done). Stripping the literal `"No"` still left 67.7% / 52.6% / 55.9% flagged across 2024–26, swinging 15 points a year.
- **Do not rename a PocketBase column with remove-and-add.** Use `fields.getByName()` and set `.name`, which keeps the field ID and makes PocketBase emit `ALTER TABLE … RENAME COLUMN`. Rename the Go test fixtures FIRST: they build their own schema and never read `pb_migrations/`, so a stale `rec.Set` is a silent no-op the suite cannot see. Precedent and reasoning in `1500000136`.

---

## A note on `HANDOFF.md`

`HANDOFF.md` is **no longer tracked in git** — it is a large, fast-drifting working document, and committing it generated more noise than signal. It may still exist in a local checkout, and several source comments and docs still cite it by section.

Treat any such citation as a pointer to history, not to a current spec. Its §8 ("Open issues") had already drifted badly while tracked. **The authoritative sources are the issue tree and `docs/reference/issue-triage.md`'s Status cells**, not `HANDOFF.md` and not this file.
