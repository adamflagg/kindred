# Lodging Occupancy and Sharing

Staff-confirmed rules for who may occupy a lodging unit, and how many parties
may share one. **Documented, not enforced** — nothing in the codebase currently
validates any of this. Read this before adding a constraint to the lodging
ingest, the board, or a future solver.

## Two axes, often confused

| | Meaning | Frequency | Guarded today |
|---|---|---|---|
| **Merge** | one party occupies **many units** | rare, deliberate | no |
| **Share** | many parties occupy **one unit** | routine | no |

These are independent. A merge binds rooms into one bookable slot for a single
party. Sharing puts two unrelated parties in the same space. Confusing them is
the reason an earlier version of the ingest validated merges — the axis staff
exercise carefully and rarely — while leaving sharing, the axis exercised
constantly, entirely unmodelled.

Sharing already happens throughout historical data: multiple `lodging_assignments`
rows for different households point at the same unit, in the same session and
year, with no merge involved.

## The rules

Occupancy is a property of **unit class × session type**. It is not derivable
from the unit tree — see "Why not container topology" below.

### Family camp (household grain)

| Unit class | Occupancy |
|---|---|
| **Camper cabins** — the large shared-sleeping cabins | one **or more** families |
| **Everything else** — a bedroom or area inside a house, or a small house | one family |

An extended family spanning **two or more registrations** may occupy one house
together, each registration in its own room. This is not sharing a unit; it is
several parties distributed across a house, and it is legitimate.

### Adult weekends — men's and women's (person grain)

| Unit class | Occupancy |
|---|---|
| **Camper cabins** | up to 8 participants |
| **Everything else** | usually one participant, but may hold a couple attending as two separate attendees |

Adult weekends count **people**, not households, because attendance is
per-person. A couple in one room is two attendee records against one unit, which
under family-camp rules would look like a violation and is not one.

### The grain distinction already exists

The ingest already carries this seam: `Family Camp Cabin` is a household-grain
custom field, `Reportable Family Camp Cabin` is person-grain. Any occupancy
check must respect the same split rather than counting rows.

## Why not container topology

A previous design expressed merge validity as "the member set must be the
complete child set of some container". It was removed. That was written when
the set lived on a separate `lodging_merges` row; kindred#1931 later folded
`unit` / `merge` / `merge_draft` into one multi-valued `units` relation on the
placement itself (`HANDOFF.md` §2), so restated in today's vocabulary the
removed rule would read "a placement's `units` set must be the complete child
set of some container". The reasoning did not depend on where the set lived,
and neither does the case against it. The reasons generalise to any future
attempt to encode occupancy as tree shape:

1. **The valid configurations are not enumerable.** A four-room house may be let
   whole, split by room, split between a family and a staff member, or split
   across an extended family's several registrations — and differently again
   between family camp and an adult weekend. Expressing each as its own
   container means inventing a node per bookable subset, which is the power set
   of every building.

2. **Legitimate and mistaken configurations are byte-identical.** A deliberate
   partial booking and a mis-clicked unit selection produce the same `units`
   set. A rule that cannot distinguish them flags both and advises both
   identically.

3. **The topology gets fitted to the data.** Intermediate containers were seeded
   specifically so existing real merges would satisfy the rule — the check then
   largely certified the data it was shaped around.

4. **Nothing downstream consumes it.** Bathroom privacy is computed from
   `bathroom_group` (`api/services/lodging_rules.py`), a different grouping that
   handles partial merges correctly on its own. `effective_bathroom`
   (`api/services/lodging_rules.py:75`) takes the merged set as
   `merged_codes: frozenset[str]` — set-based from the start, so the bathroom
   upgrade is unchanged by kindred#1931's collapse; it was never reading a
   `lodging_merges` row to begin with. Capacity sums actual member units.
   `parent_unit` — the tree the completeness rule walked — appears nowhere in
   `api/` or `bunking/` at all. `is_container` is read there, but only to keep
   buildings out of bookable lists
   (`api/services/lodging_roster_service.py:561`); nothing reads the
   parent/child relationship that made a merge "complete".

Container units remain useful for what they genuinely model — physical
structure, and the `bathroom_group` upgrade where merging a whole group turns a
`shared` bathroom `private`. They are not an occupancy vocabulary.

## Where enforcement belongs

Not in the ingest. The ingest's job is to record faithfully what CampMinder
holds; a constraint there turns a debatable grouping into a family with no
cabin, and cannot see the session-level context that decides whether a
configuration is right.

Enforcement belongs where a human is making the decision — the assignment board,
or the unit picker at the moment of selection — and only once the rules above
are settled enough to encode. A rule encoded early and wrongly is worse than no
rule: it blocks legitimate work and teaches staff to ignore warnings.

## What is not yet modelled

- ~~`lodging_units` has no shareability field.~~ **Modelled as of kindred#2026**
  (migration `1500000145`). `lodging_units.shareability` is a three-state select
  — `shareable`, `single_party`, and blank for "nobody has classified this",
  which must never read as permission to double-book nor as a ruling that one
  family only may go here. `inventory_class` (`family_pool` / `staff_default`)
  still describes who a unit is *reserved for*, not how many parties may occupy
  it; the two are read together, and only a `family_pool` unit is ever
  `shareable`.

  Classified at BOTH levels, and compared at whichever level the assignment was
  actually made (owner ruling, 2026-08-07). Two households on one container is a
  legitimate share, not a violation: they occupy different rooms beneath it, and
  CampMinder has no sub-room concept for every building, so staff assign at
  container level for some buildings and will keep doing so. Measured over
  2022-2025, resolving down to leaves instead raises 36 false alarms.

  **Still not modelled: the enforcement itself.** The column makes the question
  answerable; nothing yet blocks or warns on a second party being dropped into a
  `single_party` unit. That is the board-side check this document's next section
  describes, and it remains where a human is choosing.
- `lodging_availability` carries a per-unit `family_available` boolean per
  session, not capacity. It has no scenario dimension: migration `1500000135`
  deleted it, because availability is a fact about the weekend rather than
  about the plan — a burst pipe closes a cabin in every scenario for that
  weekend.

  **That boolean answered two questions, and kindred#2382 split them.** `true`
  is a staff↔family ROLE override — "this staff cabin is released to families
  this weekend" — which the owner ruled is *not* scenario-scoped, so it stays
  here and `1500000135`'s reasoning above is exactly right for it. `false` was
  an OCCUPANCY — somebody is in the room — and that *is* scenario-scoped,
  because not every write-in is non-rostered staff: some are paper
  registrations for families arriving with no children, which are a modelling
  choice belonging to the scenario that made them. Migration `1500000161`
  created `lodging_write_ins` and `lodging_write_ins_draft` for it and
  `1500000162` moved the rows.

  The pair behaves exactly as `lodging_assignments` / `lodging_assignments_draft`
  does: a request naming a scenario reads the DRAFT and **replaces** the live
  rows rather than falling through to them (kindred#1974's rule), and the live
  board is a scope in its own right rather than the absence of one — staff must
  be able to record a write-in on the real board, not only inside a modelling
  sandbox. A fresh scenario is therefore seeded with the write-ins its source
  had, in **both** seed paths (`copy_from_mirror` and
  `copy_scenario_to_scenario`); without that the placement gate below would
  offer a room the live board records as occupied. Deleting a scenario sweeps
  its write-ins through the relation's `cascadeDelete`, the same mechanism
  every other lodging draft table relies on — there is no hook and no
  client-side pre-delete loop.

  **The WRITE chooses too.** `PUT /api/lodging/availability` carries an
  OPTIONAL `scenario`, spelled exactly as `/api/lodging/merge` spells its own:
  blank is the live board, a scope in its own right, and a scenario id writes
  that scenario's draft occupancy. It steers the OCCUPANCY half alone — a
  release ignores it and still writes `lodging_availability`, because the
  staff↔family role is a fact about the weekend whoever is looking at it.
  Requiring one is the shape that made this endpoint uncallable under
  kindred#1998, and would now leave the live board with no write path.

  **`family_available_override` on the wire is the ROLE alone.** While the
  split was landing in four parts, the read layer kept spelling an occupancy as
  `family_available_override = false`, because `is_family_available` — and
  through it every count on the stats bar, and the board's forest open-tint —
  was derived from that one field. Every consumer now reads the occupancy
  source directly (`LodgingUnitSummary.write_in`, and `writeInOccupant` on the
  client), so the field answers one question again. `is_family_available`
  remains the DERIVED answer and still folds both facts in: occupancy closes a
  unit whatever the role says, so no reported number moved.

  ⚠️ **kindred#2432 did not touch that derivation, deliberately.** The board
  now places a family into a written-into space, but `is_family_available`
  still resolves `false` for one, so the stats bar's *spaces* figure stays
  CONSERVATIVE about a space that can in fact take a family. That is the safe
  direction to be wrong in and it keeps one narrow pre-existing edge from
  widening: a `staff_default` cabin RELEASED to families and then written into
  resolves `false` and drops off the board entirely via `isPlanningInventory`
  (`boardLayout.ts`) — reachable only with a release and a write-in on the same
  staff unit and no party placed on it, since any placement keeps the card
  drawn. Loosening the derivation is an API-side decision that has to be taken
  with the stats-bar arithmetic beside it, not as a side effect.

  ### What a write-in represents (owner ruling, 2026-08-18; kindred#2432)

  A write-in records **who is in a building** — non-rostered staff, a
  caretaker, a paper registration — not a reservation of empty space. It is a
  fact about the BUILDING for one weekend; a placement is a fact about a PLAN.

  **A write-in NAMES AN OCCUPANT. It does not CLOSE THE SPACE.** A write-in
  and a placement may share one unit, in either order:

  > *"we should be able to add families to any write in space, or add a write
  > in to a family space — regardless of which came first."*

  ⚠️ **This REVERSES the 2026-08-09 ruling on kindred#2090/kindred#2087**,
  which held the two "mutually exclusive states: a unit cannot be both held and
  occupied", and the reversal is stated here rather than the old rule being
  quietly deleted, because the old rule is the one the next reader will
  otherwise re-derive from the shape of the surrounding code. #2090 was ruled
  while a hold and a write-in were the same act (kindred#2078, *"hold IS the
  write-in"*), and under that collapse "occupied and held" really was
  contradictory. The collapse has one real exception, and it is the case staff
  actually reported: a paper registration has no CampMinder record, so it
  cannot be placed on the board at all and a write-in is the ONLY way to record
  it — and such a party can legitimately share a cabin with a placed family.
  Refusing made the one case the control exists for the one case it would not
  do. (The production snapshot bears the shape out: of 16 written-into units in
  the 2026 weekend, two name a paper registration explicitly, and 8 already
  carried a draft placement alongside the write-in.)

  Concretely, kindred#2432 struck **four** refusals, and they had to go
  together — the first two are the enforcing and affordance halves of one gate,
  and leaving either would have left the reversal half-done while looking
  finished:

  - `resolveDrop` in `dragPlacement.ts` — the load-bearing one, since
    kindred#2080's picker reaches placement without touching a droppable.
  - the `useDroppable` `disabled` flag in `LodgingUnitCard.tsx` — without this
    dnd-kit never reports `isOver`, so a drop the resolver now accepts could
    not be aimed at the card.
  - `availabilityAction`'s occupancy gate in `unitBadges.ts` — the mirror
    direction, a write-in onto a placed family. The `occupied` argument is
    **deleted** rather than defaulted, here and on `UnitAvailabilityControl`'s
    props, so a caller holding an occupancy fact has nowhere to spell it and
    `tsc` enforces the reversal.
  - `canPickFamily`'s `!held` in `LodgingUnitCard.tsx` — otherwise #2080's
    picker stays absent for a placement drag performs happily.

  `resolvePickerPlacement` needed no edit at all, which is the payoff of it
  being a thin adapter over `resolveDrop`.

  **What did NOT change.** `availabilityAction` still returns `null` for a
  written-into card, and that gate is about **write-in arity**, not occupancy
  (kindred#2381: one button cannot name which of four rows a click would
  destroy). `canPickFamily` still requires `parties.length === 0` — a second
  family reaches a shareable space by drag, which stays the deliberate path,
  and kindred#2091 (marking a space that holds two families) is unbuilt. The
  `clear` action is still never blocked by occupancy. The open-space forest
  tint and the "Drop families here" placeholder still stand down on a
  written-into cabin, on the surviving half of their reason: a room somebody is
  sleeping in is not EMPTY, even though it is now placeable.

  Every gate reads the fact through `writeInEntries`/`hasWriteIn`
  (`writeIn.ts`), never through `family_available_override`. They were written
  against that column when it still doubled as the occupancy store; naming the
  fact once is what let kindred#2382 re-point it in one place, and the same
  tree walk is what now lands the write-in and the family in the SAME card's
  well whichever level the board draws — a write-in names one unit but covers a
  SPACE.

  **The known cost is filed, not hidden.** A write-in carries no headcount
  (`lodging_write_ins` holds `occupant_name` and `note` and no count), so a
  shared space's occupancy figure and its free-bed arithmetic both understate:
  a 10-bed cabin holding a party of 6 plus a written-in party of 3 reads 4 free
  when 1 is. That is kindred#2439, ruled an optional investigation and
  explicitly not a blocker — an understated count on a space staff can share
  beats a space they could not share at all. Do not guess a headcount to
  paper over it.
- The unique indexes on `lodging_assignments` are
  `(session, year, household_cm_id)` and the person-grain equivalent, each
  partial on `> 0` so the two grains do not collide. (Migration `1500000132`
  dropped the dead `scenario` column from this table; scenario planning lives
  in `lodging_assignments_draft`, whose equivalent indexes add `scenario`.)
  They prevent one **party** holding two placements; nothing prevents one
  **unit** holding two parties.

So a bedroom double-booked between two families is currently possible and
undetected. That is the gap worth closing when occupancy is built.
