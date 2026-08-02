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

`scripts/dev/verify-no-hardcoded-lodging.sh` already encoded *"the registry is
DATA, not code"*. This extends it to *private* data, and the guard now scans
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
later still takes effect.

**Absent file is not an error.** A clone without `kindred-local` boots normally
with an empty registry and a log line — the same graceful degradation
`branding.local.json` has. An unreadable or malformed file logs a warning and
leaves the registry alone rather than taking the service down.

## Loader semantics: create-if-absent, never update

`pocketbase/lodging/registry.go` creates rows that do not exist and **leaves
existing rows completely alone**.

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

## Path resolution

First match wins:

| Path | Context |
|---|---|
| `/config/lodging_registry.json` | Docker — where `docker-compose.yml` mounts the private config directory |
| `/app/config/lodging_registry.json` | Docker, alternate layout; matches `pocketbase/google/branding.go` |
| `./config/lodging_registry.json` | run from the repo root |
| `../config/lodging_registry.json` | run from `pocketbase/` |

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
> no `WORKDIR`, so the container runs from `/` and the *relative* `./config`
> candidate resolves to `/config` as well — which means the loader would appear
> to work in production while depending on a coincidence that any future
> `WORKDIR` would silently break.

## File format

The block below is annotated for documentation. **The loader uses Go's
`encoding/json`, which rejects `//` comments** — strip them from the real file.
A file that fails to parse is a logged warning, not a crash, so the symptom is
an empty registry rather than an error anyone will see.

```jsonc
{
  "_notes": [
    "Free prose about the registry. Ignored by the loader.",
    "Camp-specific knowledge lives here, beside the data it describes,",
    "rather than in a tracked comment."
  ],
  "areas": [
    {
      "code": "AREA1",          // unique, uppercase; a join key — never lowercase it
      "name": "Display Name",
      "map_x": 0.5,             // normalised 0-1 on the camp map canvas
      "map_y": 0.25,
      "sort_order": 1
    }
  ],
  "units": [
    {
      "area": "AREA1",          // area CODE, not an id
      "code": "unit-a",         // unique
      "name": "Display Name",
      "map_x": 0.51,
      "map_y": 0.26,
      "sleeps": 4,              // null = unknown; see below
      "bathroom": "shared",     // none | private | shared
      "bathroom_group": "grp-1",// units sharing one bathroom; "" for none
      "parent_unit": "bldg-1",  // unit CODE of the containing building, or ""
      "near_bathhouse": true,
      "allocation_default": "family_pool",  // family_pool | staff_default
      "is_container": false,    // true = a building row: never bookable, never counted
      "notes": ""
    }
  ],
  "aliases": [
    {
      "alias_string": "As CampMinder stores it",  // VERBATIM — do not trim
      "member_units": ["unit-a"],                 // unit CODEs; 2+ denotes a merge
      "valid_from_year": null,                    // null = unbounded
      "valid_to_year": null
    }
  ]
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
