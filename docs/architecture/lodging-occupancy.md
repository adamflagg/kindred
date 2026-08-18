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

  ### What a hold represents (owner ruling, 2026-08-09; kindred#2090, kindred#2087)

  A hold records **who is in a building** — chiefly non-rostered staff, a
  caretaker, a burst pipe — not a reservation of empty space. It is a fact
  about the BUILDING for one weekend; a placement is a fact about a PLAN.
  They used to live on different axes for that reason, but the two questions
  "is anyone in this building" and "has a family been placed here" answer the
  same underlying fact from two directions, and the ruling settles them as
  **mutually exclusive states**: a unit cannot be both held and occupied.

  Concretely: a write-in covering a unit **blocks placement outright**
  (`resolveDrop` in `dragPlacement.ts`, plus the matching `useDroppable`
  `disabled` flag in `LodgingUnitCard.tsx`, refuse a drop onto a written-into
  unit rather than merely dimming it), and a unit already holding a placed
  party offers no "Write in" action (`availabilityAction` in `unitBadges.ts`
  takes the slot's own occupancy and returns `null` for the `hold` branch). The
  `clear` action — removing an existing write-in — is never blocked by
  occupancy, since clearing only ever reduces the conflict.

  Both gates read the fact through `writeInOccupant` (`writeIn.ts`), never
  through `family_available_override`. They were written against that column
  when it still doubled as the occupancy store; naming the fact once is what
  let kindred#2382 re-point it in one place, and it is also what makes them
  respect the unit tree — a write-in names one unit but closes a SPACE, so a
  building's write-in blocks a drop into its rooms and vice versa.
- The unique indexes on `lodging_assignments` are
  `(session, year, household_cm_id)` and the person-grain equivalent, each
  partial on `> 0` so the two grains do not collide. (Migration `1500000132`
  dropped the dead `scenario` column from this table; scenario planning lives
  in `lodging_assignments_draft`, whose equivalent indexes add `scenario`.)
  They prevent one **party** holding two placements; nothing prevents one
  **unit** holding two parties.

So a bedroom double-booked between two families is currently possible and
undetected. That is the gap worth closing when occupancy is built.
