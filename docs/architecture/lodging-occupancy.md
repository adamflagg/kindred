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
complete child set of some container". It was removed. The reasons generalise to
any future attempt to encode occupancy as tree shape:

1. **The valid configurations are not enumerable.** A four-room house may be let
   whole, split by room, split between a family and a staff member, or split
   across an extended family's several registrations — and differently again
   between family camp and an adult weekend. Expressing each as its own
   container means inventing a node per bookable subset, which is the power set
   of every building.

2. **Legitimate and mistaken configurations are byte-identical.** A deliberate
   partial booking and a mis-clicked unit selection produce the same rows. A
   rule that cannot distinguish them flags both and advises both identically.

3. **The topology gets fitted to the data.** Intermediate containers were seeded
   specifically so existing real merges would satisfy the rule — the check then
   largely certified the data it was shaped around.

4. **Nothing downstream consumes it.** Bathroom privacy is computed from
   `bathroom_group` (`api/services/lodging_rules.py`), a different grouping that
   handles partial merges correctly on its own. Capacity sums actual member
   units. `parent_unit` and `is_container` appear nowhere in `api/` or
   `bunking/`.

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

- `lodging_units` has no shareability field. `allocation_default`
  (`family_pool` / `staff_default`) describes who a unit is *reserved for*, not
  how many parties may occupy it.
- `lodging_availability` carries per-unit state per session, not capacity.
- The unique indexes on `lodging_assignments` are
  `(session, year, household_cm_id, scenario)` and the person-grain equivalent.
  They prevent one **party** holding two placements; nothing prevents one
  **unit** holding two parties.

So a bedroom double-booked between two families is currently possible and
undetected. That is the gap worth closing when occupancy is built.
