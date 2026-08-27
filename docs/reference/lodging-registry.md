# The lodging registry

The weekend-lodging unit registry — areas, units and the alias strings that map
CampMinder's free-text cabin fields onto them — is **private data**, not source.
It lives in `config/lodging_registry.json`, carried in the private
`kindred-local` repo, and is loaded into PocketBase on every boot.

This document is the contract: the file format, what the loader does and does
not do, and how to verify it. It deliberately contains **no unit names** — that
is the whole point of the arrangement.

---

## Why the registry is private

This repository is public. The registry names the camp's buildings, and several
unit names contain the camp's own name, so seeding it into `pb_migrations/`
published it. Tracked as **#1909**.

The trigger was scale: a 2026 inventory seed would have added roughly five times
the existing exposure. Moving 30 literals once was cheaper than moving 160
later.

`scripts/dev/verify-no-hardcoded-lodging.sh` already encoded _"the registry is
DATA, not code"_. This extends it to _private_ data, and the guard now scans
`pb_migrations/` too — with the data gone from the seed migrations, skipping
that directory would leave a hole exactly where a future seed would land.

## Why a boot loader and not a migration

`_migrations` keys on **filename** and applies once.

A migration that read `config/lodging_registry.json` would run in CI, find no
file (CI has no private config), do nothing, and be **recorded as applied**. It
would never run again — so the day the file appeared, the registry would stay
silently empty. This repository has been bitten by filename-keying before.

So the loader runs on the `OnServe` hook in `pocketbase/main.go`, beside
`runHistorySync`. Every boot re-reads the file, which means a file that appears
later still takes effect — **while the registry has never been seeded at
all.** See "One-time bootstrap, not a per-season populator" below: once any
season has rows, the loader stops reading the file on every boot and starts
skipping instead.

**Absent file is not an error.** A clone without `kindred-local` boots normally
with an empty registry and a log line — the same graceful degradation
`branding.local.json` has.

**A file that IS present but unloadable fails the boot.** Malformed JSON, a
duplicate code, an unknown area/parent/alias-member reference — anything that
makes `SeedRegistry` return an error stops the service from starting, rather
than coming up with an empty registry behind a single warn-level log line
nobody is watching (issues #2054, #2141). The bound is the same one the
bootstrap gate already gives for free: once any season has rows the loader
returns early without reading the file at all, so an already-seeded
deployment cannot be taken down by a bad file on a later boot. Only a
genuinely empty registry with a broken file present fails.

The one exception is a failure to _check_ for existing rows
(`lodging.ErrRegistryRowCheck`): the loader then cannot tell whether anything
is at risk, so it warns and boots rather than compounding one failure with a
second, less legible one.

## Loader semantics: create-if-absent, never update

`pocketbase/lodging/registry.go` creates rows that do not exist and **leaves
existing rows completely alone** — for whichever season it seeds. See the
next section for when it seeds at all.

This is not a full upsert, deliberately. The registry is staff-editable in
`/manage/lodging`: coordinates get corrected, capacities get adjusted, cabins
get confirmed. A loader that rewrote every field on boot would silently undo all
of that on the next restart.

The same reasoning covers `parent_unit`: a parent staff cleared deliberately
stays cleared. Only rows the loader itself created in the current run get their
parent wired.

Two consequences worth knowing:

- On every database that the old seed migrations already populated — including
  production — the loader is an exact no-op.
- **Adding a field to an existing row is not something this loader will do.**
  Extending the registry with new columns on rows that already exist needs its
  own backfill; the file alone will not apply them.

Parent wiring is two-pass, so a unit may name a parent that appears later in the
file.

## One-time bootstrap, not a per-season populator

`lodging_units` and `lodging_areas` each carry a `year` column (migration
`1500000140`): a row is identified by `(code, year)`, and `code` is the
cross-year thread linking a building across seasons. `SeedRegistry` takes the
season as a parameter — `pocketbase/main.go` resolves it from
`CAMPMINDER_SEASON_ID` on every boot — but it does **not** seed whatever
season is running. Before doing anything else it checks whether
`lodging_areas` or `lodging_units` has a row for **any** year at all. If
either does, it logs that it is skipping and returns untouched, regardless of
which year it was called with.

**The operator-visible consequence:** once the registry has been seeded once,
adding a cabin to `config/lodging_registry.json` and restarting the service
produces an INFO log line and **no row**. The file is a one-time bootstrap
for a database that has never had any lodging registry rows — never a live
source of truth for a season that already exists.

This is deliberate, and load-bearing. Before this gate existed, the loader's
`(code, year)` create-if-absent key meant the first restart after
`scripts/prepare_for_new_year.py` flipped `CAMPMINDER_SEASON_ID` silently
rebuilt the _entire_ registry for the new season out of the stale bootstrap
file — unconfirmed, every amenity correction, coordinate, rename and
deactivation gone — and then the roll-forward panel (the first path below)
found every code already present and reported nothing to carry forward,
permanently disabling the one control meant to carry a season into the next.
See `docs/superpowers/specs/2026-08-04-lodging-year-scoping-design.md` §4.2.

Two paths exist for a season that already has rows:

- **A new season with no registry of its own yet** — Manage → Lodging →
  Season, or `POST /api/custom/lodging/roll-forward` directly. Roll-forward
  copies the _prior_ season's confirmed state forward instead of re-guessing
  it from the file; see `pocketbase/lodging/rollforward.go`.
- **A correction to the bootstrap data itself, reaching a season that
  already exists** — run `scripts/dev/apply_lodging_inventory.py --apply
--year N` by hand. Its own create-if-absent and staff-owned-field rules
  ("Getting the inventory onto rows that already exist", below) still apply;
  it is the deliberate file-to-database path this loader is not.

## Path resolution

First match wins:

| Path                                | Context                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `/config/lodging_registry.json`     | Docker — where `docker-compose.yml` mounts the private config directory |
| `/app/config/lodging_registry.json` | Docker, alternate layout; matches `pocketbase/google/branding.go`       |
| `./config/lodging_registry.json`    | run from the repo root                                                  |
| `../config/lodging_registry.json`   | run from `pocketbase/`                                                  |

`scripts/setup/setup-local-config.sh` symlinks the file in from `kindred-local`,
and `scripts/worktree/new.sh` does the same for a new worktree.

> **Note:** `docker/Dockerfile.pocketbase` does not copy `config/` into the
> image — in production the file arrives through the compose mount
> (`${APPDATA_DIR}/kindred/config` → `/config`), not through the build. Drop
> `lodging_registry.json` into that host directory and a from-scratch
> production database picks it up on boot; leave it out and production boots
> with an empty registry.
>
> The absolute candidates are listed first deliberately. The runtime image sets
> no `WORKDIR`, so the container runs from `/` and the _relative_ `./config`
> candidate resolves to `/config` as well — which means the loader would appear
> to work in production while depending on a coincidence that any future
> `WORKDIR` would silently break.

## File format

The block below is annotated for documentation. **The loader uses Go's
`encoding/json`, which rejects `//` comments** — strip them from the real file.
On a fresh deployment a file that fails to parse **fails the boot** (#2141), so
the symptom is a service that will not start with the parse error in the log —
loud on purpose, rather than a silently empty registry.

```jsonc
{
  "_notes": [
    "Free prose about the registry. Ignored by the loader.",
    "Camp-specific knowledge lives here, beside the data it describes,",
    "rather than in a tracked comment.",
  ],
  "areas": [
    {
      "code": "AREA1", // unique, uppercase; a join key — never lowercase it
      "name": "Display Name",
      "map_x": 0.5, // normalised 0-1 on the camp map canvas
      "map_y": 0.25,
      "sort_order": 1,
    },
  ],
  "units": [
    {
      "area": "AREA1", // area CODE, not an id
      "code": "unit-a", // unique
      "name": "Display Name",
      "map_x": 0.51,
      "map_y": 0.26,
      "sleeps": 4, // null = unknown; see below
      "bathroom": "shared", // none | private | shared
      "bathroom_group": "grp-1", // units sharing one bathroom; "" for none
      "parent_unit": "bldg-1", // unit CODE of the containing building, or ""
      "near_bathhouse": true,
      "inventory_class": "family_pool", // family_pool | staff_default
      "is_container": false, // true = a building row: never bookable, never counted
      "notes": "",

      // Amenities. Absent means false, which is the same claim the column made
      // before the inventory existed: unknown, recorded as false.
      "has_power": true,
      "has_ac": false,
      "has_fridge": false,
      "is_accessible": false,
      "has_heat": true,
      "is_weatherized": true,
      "has_plumbing": true,
      "has_space_heater": false,
      "has_pack_play_space": false, // unit-side counterpart to the family infant flag
      "has_living_room": false,
      "has_kitchen": false,
      "has_lights": true,

      "has_ramp": "partial", // yes | no | partial; "" or absent = NOT ASSESSED
      //   read by the roster as ramp_coverage (#2438)
      "max_beds": 14, // total sleeping spots. NOT sleeps — see below

      "shareability": "shareable", // shareable | single_party; absent = not curated
    },
  ],
  "aliases": [
    {
      "alias_string": "As CampMinder stores it", // VERBATIM — do not trim
      "member_units": ["unit-a"], // unit CODEs; 2+ denotes a merge
      "valid_from_year": null, // null = unbounded
      "valid_to_year": null,
    },
  ],
}
```

Everything references everything else by **code**, never by PocketBase id. That
is what lets the file survive a database rebuild, and it matches the
CampMinder-id discipline used across the rest of the schema.

### Fields the loader sets itself

- `is_active` — always `true` on create.
- `is_confirmed` — always `false` on create. Every seeded value is a guess until
  staff verify it against the actual cabin, so nothing the loader writes may
  claim otherwise. Staff confirm through `/manage/lodging`.

### `shareability` is CURATED, not derived

Whether more than one party may sleep in a unit is a fact staff maintain per
unit, not something any formula produces (kindred#2331, owner ruling D17,
2026-08-14). It used to be derived on a family-pool leaf from `sleeps >= 12` —
a threshold no leaf in the inventory reaches, so every leaf came out
`single_party` and the board warned on correct multi-family placements.

- **Vocabulary**: exactly `"shareable"` or `"single_party"`. Anything else
  **fails the file load**, before any row is written — a typo must not degrade
  into "not classified".
- **Absent, `null`, or `""` all mean NOT YET CURATED** and land the unit blank.
  A leaf the file says nothing about never becomes shareable by default.
- **Only meaningful on a family-pool LEAF.** A container classifies from
  `is_container` alone and a `staff_default` row is always `single_party`; both
  ignore the key, so there is no need to set it on either.

Like every other field here, the loader is create-if-absent, so the key reaches
**new rows only** — see the section below.

### A multi-unit alias is ambiguous, not automatically a share (kindred#2339)

`member_units` with 2+ codes denotes a merge — **one** household occupying
every named unit at once, a whole-house let. It is not evidence that _every_
household who ever resolves through that alias occupies all of them: the same
alias string routinely gets reused by different households, on different
weekends or in different years, for what is really one unit per household —
ambiguous only in _which_ unit, never confirmed as a shared room.

**The rule:** for H households observed resolving through an alias whose
`member_units` names N units, `H > N` is the earliest point that is provable
evidence of over-occupancy. At `H <= N` the households fit one per unit and
the assignment is ambiguous rather than shared.

Eight alias rows in the current registry map one string to two units, matching
this shape — seven of them valid for 2026, the eighth expired after 2024.
(kindred#2339's prose says "six"; that was a miscount of its own by-shape
enumeration, which described only six of the eight. The issue's other figure,
"8 alias strings resolve to more than one unit", is the one that matches the
registry file.) A consumer that credits an occupancy count to every member unit
for every household resolving through the alias, without applying `H > N`,
overstates multi-family occupancy — one building's apparent 18 multi-household
occupancies collapsed to 2 once the `H <= N` cases were excluded.

**Audited consumers**, in case a new one is added:

- The PocketBase loader (`seedAliases`) and the sync-time resolver
  (`AliasResolver.Resolve`) never tally occupancy across households — the
  first writes the table, the second resolves one household's own placement —
  so `H > N` does not apply to either.
- The sync ingest (`LodgingAssignmentsSync.placementFor`) writes an alias's
  full member set onto one household's own `lodging_assignments.units` row,
  deliberately unjudged by design (see "Where enforcement belongs" in
  `docs/architecture/lodging-occupancy.md`). It is the source of the ambiguous
  data, not itself an occupancy count.
- The weekend board's conflict warning (`overlappingPartyKeys` in
  `frontend/src/components/weekend/boardLayout.ts`) **is** an occupancy count,
  and needed the guard: two households resolving to the same alias are no
  longer read as sharing a room with each other while `H <= N`.

**The guard is not alias-only (kindred#2371).** `overlappingPartyKeys` keys
the `H <= N` group on the ROOM set a placement resolves to
(`occupiedLeafCodes`), not on which construct produced that set. A household
named directly at a multi-room **container** claims the same room set as one
resolving through an alias to those rooms, and the guard reaches both the same
way: two households named at one two-room container are `H <= N` exactly as
two households resolving through a two-unit alias are. "Alias" above should be
read as one way of arriving at an N-room set, not the only one.

### `max_beds` is not `sleeps`, and neither may overwrite the other

`max_beds` is the total number of sleeping spots in the room. `sleeps` is the
staff judgement about how many people should actually be placed there for a
given session type. A camper cabin with 14 bunks holds one family, and the two
columns disagree on most units — HANDOFF §6, spaces not beds. Both exist so
neither has to be inferred from the other.

### Getting the inventory onto rows that already exist

The loader is create-if-absent, so **a new column lands empty on every row that
already exists**. Adding amenity columns to the schema therefore gives the
existing units a set of false-everywhere flags, which is the very condition the
inventory exists to fix.

`scripts/dev/apply_lodging_inventory.py` closes that gap. It is dry-run by
default and splits fields by how much damage writing them could do:

| Class       | Fields                                                                     | Behaviour                                                                                         |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Inventory   | the amenities and `max_beds`                                               | filled freely — they were empty                                                                   |
| Structural  | `bathroom`, `bathroom_group`, `is_container`, `parent_unit`                | reported; written only under `--structural`, since each overwrites a value that may be deliberate |
| Staff-owned | `sleeps`, `map_x`, `map_y`, `is_confirmed`, `is_active`, `inventory_class` | **never written**, under any flag                                                                 |

Two further rules: an empty `has_ramp` never overwrites a real assessment, and
`notes` are filled only when the database has none — replacing free text a staff
member wrote would destroy it.

Since kindred#2438 `has_ramp` is no longer write-only: the weekend roster
publishes it as `ramp_coverage`, resolved over a unit's LEAF descendants exactly
as `power_coverage` and `fridge_coverage` are, and the board grades a family's
`needs_step_free` flag against it. Two things follow for anyone editing this
file. **Blank still means NOT ASSESSED and resolves `unknown`, never `none`** —
104 of the 118 units are blank, so writing `no` into them would mark almost the
whole registry step-free-hostile on evidence nobody recorded. And **`partial` is
carried through** as its own grade rather than folded into either neighbour, so
the ramp qualifier a `partial` unit records in `notes` stays the thing staff are
being pointed at.

`parent_unit` is compared as a **code**. The database stores it as a relation —
a record id — so comparing raw values reports every parented unit as needing a
change, and applying that would write a code into a relation field.

### What confirming a unit gates across the system

Marking a unit `is_confirmed: true` gates the following behavior. **8 behavioral gates**
determine whether staff see confirmation prompts and whether the system judges amenity
compliance. **6 write sites** modify the flag:

**Fit-verification gate (core)** — `rosterAttention.ts:105` evaluates whether a party's
accommodation needs (power, private bathroom) are satisfied **only for confirmed units**.
On unconfirmed units, an unset `has_power: false` means "nobody has said", not "there
is no power", so the check reports `unverified` and stays silent.

**Capacity-suggestion gate** — `capacityFlag.ts:52` offers to fill a unit's `sleeps`
when it differs from bed count — **only when unconfirmed**. Confirming a unit suppresses
the suggestion **for that season**, not permanently: the next roll-forward clears
`is_confirmed` (kindred#2500) and the suggestion becomes available again. Containers suppress it unconditionally (line 58) because
their `sleeps` records shared furniture (a futon), not whole-house capacity.

**Admin UI visibility gates**:

- `LodgingUnitRow.tsx:96` shows the `Unconfirmed` badge only on unconfirmed units
- `LodgingUnitRow.tsx:106` shows the `Confirm` button only on unconfirmed units
- `unitSort.ts:52–55` allows sorting by confirmed status as a dimension

**Weekend board gates**:

- `MapUnitPopover.tsx:142` renders the badge container only when `is_confirmed === false`
- `MapUnitPopover.tsx:157` renders the unconfirmed badge only when `is_confirmed === false`

**Roster summary** — `lodging_roster_service.py:1044` counts how many units have
`is_confirmed` false.

**Write sites** (where `is_confirmed` is modified):

1. `LodgingUnitForm.tsx:338` — Form checkbox updates state on save
2. `lodgingCrud.ts:166` — Bulk confirm function sets all selected units to true
3. `lodgingCrud.ts:124` — Create function defaults to false
4. `registry.go:495` — Loader sets false on every row it creates
5. `api/schemas/lodging.py:117` — Schema field definition with false default
6. `confirm_lodging_units.py:135` — Script API call for manual bulk updates

Roll-forward is deliberately **not** in that list and does not make it seven: it never
calls `.Set("is_confirmed", …)`. It omits the field from the columns it copies, so the
new record simply holds the bool zero value. The effect on a new season's units is
decided there all the same — see _"Is confirmation ephemeral?"_ below.

**Is confirmation ephemeral?** Yes, per-season (kindred#2500). `is_confirmed` means
"someone walked this cabin THIS season", not a permanent attestation about the
building. Year roll-forward (`pocketbase/lodging/rollforward.go`) therefore creates
every new season's units **unconfirmed**, regardless of roll direction — a yearly
re-confirm is exactly the point, not something the system spares staff from. The
amenity _values_ themselves still carry forward (bed count, room layout, and
`shareability` do not change when the calendar does); only the "has staff looked at
this for the current season" bit resets. This walks back an earlier design
(#2029) that made confirmation carry forward permanently — see #2500 for the
reasoning.

### Lighting up the fit check locally

The loader writes `is_confirmed: false` on everything, so the fit check is
dark until staff confirm cabins. `scripts/dev/confirm_lodging_units.py` flips
the flag on a **local** database so the surface can be developed against. It
refuses a non-loopback URL unless explicitly overridden: bulk confirmation on
real data asserts to staff that every cabin was checked when none was.

### Two traps encoded in the format

**`null` numbers become `0`, and `0` means UNKNOWN.** PocketBase number columns
are `NUMERIC DEFAULT 0 NOT NULL`, so an unset value stores as `0` — there is no
NULL to read back. A `sleeps` of `0` therefore means "never observed", not "zero
capacity", and the API maps it to `null` on the way out. Never render it as 0.

**An unbounded alias window is `0`, not NULL.** The unique index is
`(alias_string, valid_from_year)`, and an unset `valid_from_year` is stored as
`0`. Idempotency has to look for `0`; a check against `null` would match nothing
and a re-run would re-insert and die on the index. Two rows may legitimately
share an `alias_string` when their year windows differ — that is how a rename is
recorded.

## Verifying

Run from the repository root. The `cd` is in a subshell so the rest of the
block still resolves — the paths below are relative to the root, not to
`pocketbase/`.

```bash
(cd pocketbase && go test ./lodging/ -count=1)   # loader unit tests
uv run pytest tests/setup/                       # the two dev scripts below
./scripts/dev/verify-lodging-schema.sh           # the columns exist, with the right types
./scripts/dev/verify-lodging-seed.sh             # boots a throwaway DB and loads the file
./scripts/dev/verify-no-hardcoded-lodging.sh     # no unit names in source
./scripts/dev/test-verify-no-hardcoded-lodging.sh
```

`verify-lodging-seed.sh` asserts the **database matches the file**, field by
field, rather than hardcoding expected contents — hardcoding them would
reproduce in this public repo precisely the strings the private file exists to
keep out of it. It needs `config/lodging_registry.json` present and exits 2
without it.

## History

The registry was seeded by migrations `1500000120` (areas + units),
`1500000121` (aliases) and `1500000129` (intermediate containers and a
bathroom-group fix). Those files still exist, emptied to no-ops: `_migrations`
keys on filename, so every database that already applied them keeps both the row
and the data it created, and PocketBase will not re-run an edited file. A fresh
database gets the registry from the boot loader instead.
