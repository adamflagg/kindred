# Reading the lodging inventory sheet

Camp staff maintain weekend-lodging inventory in a spreadsheet. This document
records **what its columns mean** and the traps in reading them, so a future
import does not rediscover them.

It deliberately contains **no unit names, no camp name and no sheet location** —
the registry is private data (`docs/reference/lodging-registry.md`), and this
file is tracked in a public repository. The extracted data and the sheet's
identity live in local working notes.

---

## The utilities column is four independent letters

`W` weatherized · `E` electricity · `P` plumbing · `H` heat. A cell holds any
combination.

- **`E` is the outlet signal** and maps to `has_power`. A highlight on the
  column corresponds to `E` with a single exception.
- **The separate Heat/AC column is a strict SUBSET of `H`** — every unit with a
  value there also has `H`, and none has one without it. It therefore carries no
  heat information `H` lacks, and its only unique meaning is *cooling*, which is
  why it maps to `has_ac`. **Never derive heat from it.**
- **Heat is scarcer than it looks.** Fewer than a third of units have `H`, and a
  space heater covers a different, only partly overlapping set. Around 40% of
  the site cannot be heated at all — which matters for a winter session.

## The plumbing letter predicts the bathroom column exactly

Every unit with bathroom detail has `P`, and no unit without `P` has detail. So a
unit without `P` has **no bathroom and depends on a bathhouse** — that is a known
fact, not missing data. This is what makes `near_bathhouse` load-bearing for the
majority of units rather than decorative.

## Capacity is NOT `sleeps`

The sheet's capacity is **total sleeping spots** — the summer bunk count, which
for a camper cabin is 14–16. `sleeps` is the staff judgement about how many
people should actually be placed there for a given session type, and one family
holds a whole cabin however many bunks it has.

**Most matched pairs disagree.** Capacity maps to `max_beds`; `sleeps` is never
overwritten from the sheet. HANDOFF §6: spaces, not beds.

## The flag columns are not all booleans

This is the trap that cost the most time. Several columns look like `X`/blank
but are not:

| Column | Contents | Correct reading |
|---|---|---|
| Lights, pack&play | `X` or blank only | `bool(non-empty)` is safe |
| Space heater | `TRUE` / `FALSE` strings | compare to `TRUE`, not truthiness |
| Kitchen | `X`, `X (ette)`, and one description | non-empty means yes; a kitchenette counts |
| **Living space** | `X`, **explicit `No`**, and furniture descriptions | **`X` only.** `bool(non-empty)` records a living room for the units that say they have none |
| **Ramp** | a few `X`, a few `No`, some qualified yeses, **mostly blank** | three-valued, and blank means NOT ASSESSED |

**`has_ramp` is a select, not a bool** (`yes` / `no` / `partial`, empty = not
assessed). A bool maps every unassessed cabin to `false`, asserting "no ramp"
about cabins nobody looked at — so someone filtering for step-free access sees a
short list and a long tail of invisible maybes. Same discipline as `sleeps: null`
never rendering as 0. Qualifier text ("yes, but there is a lip at the door")
belongs in `notes`, where it can say what the obstacle actually is.

⚠️ **It answers nothing on the board (kindred#2327).** Step-free is graded from
`is_accessible`, which staff answered for all 118 units on the confirm form,
rather than from this column, which is editable nowhere in the product and blank
on 104 of them. `has_ramp` stays stored as provenance for the 14 assessments
that were made; it is a record of what somebody looked at, not a verdict.

## Legacy codes appear in two places and they disagree

Older side-of-camp codes survive both in unit names (parenthesised) and in the
notes column. **For several units the two sources name different codes**, and
some codes are claimed by two different units.

An alias built from either source alone would silently point historical
placements at the wrong room, which is worse than having no alias: nothing
surfaces it. **Only build an alias for a code when every mention of it, across
both sources, points at the same unit.** A third of the river-side codes fail
that test and deliberately have no alias.

## Rows that are not units

- **Total rows.** The sheet ends with summary rows that parse like units and
  carry a nonsense capacity. Drop by name.
- **Year-round grounds crew quarters.** Not bookable; excluded from the registry.
- Two columns are uniformly `FALSE` across every row and carry no information.

Counting note: published counts of this sheet include the grounds-crew rows, so
a figure derived after excluding them will be lower. Reconcile against the
denominator before assuming an import dropped something.

## Names in free text

The notes column has contained a staff member's name. **Scrub person names
before the data reaches any repository**, and check by reading the notes rather
than trusting a regex — an initial-form pattern (`Firstname L.`) does not match a
full surname, which is how one got through once.

Place names and department names are fine and should be kept; they are what makes
a note useful.

## Applying an import

The boot loader is create-if-absent, so it will create units the sheet adds but
will **not** fill new columns on units that already exist. That second step is
`scripts/dev/apply_lodging_inventory.py`, which is dry-run by default. See
`docs/reference/lodging-registry.md` for the field-ownership rules.
