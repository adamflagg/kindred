# The family lodging board, measured against summer

A working comparison of the weekend/family lodging board
(`frontend/src/components/weekend/`) against the summer bunking board
(`frontend/src/components/`), row by row, under CLAUDE.md §4 **"Family Camp
Models Summer"**.

This is a **working document**, not a changelog. Rewrite the status column as
rows close; do not append history. It exists so the next session does not
re-measure what has already been measured, and does not re-open decisions that
have already been settled with a reason.

Every number here was measured in a browser at a **1600px viewport**, where the
board area is **1188px**, against the real 2026 registry: 82 rooms, 8 areas, 62
parties, 28 empty rooms. Numbers are restated when the layout changes underneath
them — several already have been.

**Read `frontend/CLAUDE.md` and CLAUDE.md §4 first.** This document assumes
both.

---

## Why measure at all

Two of the findings below could not have been reached by reading code, and both
had already been asserted wrongly from a careful reading:

- `hover:shadow-lodge-lg` **does nothing**, on this board or summer's. See
  kindred#2027.
- Widening the grid does **not** unwrap the amenity row, though it looks like
  it must.

Assert nothing about rendered output without rendering it. jsdom parses no
Tailwind, so a `toHaveStyle` assertion on a Tailwind class passes against an
empty string and proves nothing — pin **classes** in vitest and measure
**computed values** in a browser.

---

## 1. Card chrome and geometry — CLOSED

| Dimension  | Summer                   | Family                       | Status           |
| ---------- | ------------------------ | ---------------------------- | ---------------- |
| Base class | `.card-lodge`            | `.card-lodge`                | done             |
| Radius     | `rounded-2xl` (16px)     | same                         | done             |
| Border     | `border-2 border-border` | same, + `border-t-[3px]` hue | done             |
| Shadow     | two-layer lodge          | same                         | done             |
| Padding    | `p-4` (16px)             | `p-4`                        | done             |
| Row rhythm | `mb-3` (12px)            | `gap-3`                      | done             |
| Hover      | `.card-lodge:hover`      | `.card-lodge:hover`          | done — see below |

**Hover is deliberately NOT matched class-for-class.** `BunkCard` carries
`hover:shadow-lodge-lg`; this card does not, and `LodgingUnitCard.test.tsx` pins
that as an absence.

`.shadow-lodge-sm` / `.shadow-lodge` / `.shadow-lodge-lg` / `.shadow-lodge-xl`
are hand-written rules inside `@layer utilities` in `index.css`, not Tailwind v4
`@utility` declarations. Tailwind cannot build a variant from a plain CSS class,
so it emits nothing for `hover:shadow-lodge-*`. A sweep of all 3,373 loaded
rules found **no selector matching `hover.*shadow-lodge`**. Nine usages across
the codebase are inert, plus three of an undefined `shadow-lodge-md`. Filed as
**kindred#2027**.

Both cards' hover lift comes entirely from `.card-lodge:hover`, whose shadow
(`0 12px 32px`) is the deeper of the two anyway.

> When sweeping `document.styleSheets`, test `selectorText` **before** recursing
> into `cssRules`. Under nested-CSS support `CSSStyleRule.cssRules` is a truthy
> empty list, so an `if (r.cssRules) … else if (r.selectorText)` walk silently
> visits zero style rules. That produced a false negative on the first pass here.

## 2. Type scale — CLOSED

Summer uses three steps of the stock scale. The family board was built on
arbitrary bracket literals whose **largest** size was smaller than summer's
**body**.

| Slot               | Summer           | Family before | Family now |
| ------------------ | ---------------- | ------------- | ---------- |
| Unit title         | `text-lg` (18px) | `text-[13px]` | `text-lg`  |
| Capacity figure    | `text-sm`        | `text-[11px]` | `text-sm`  |
| Card body          | `text-sm`        | `text-[11px]` | `text-sm`  |
| Badges, chips      | `text-xs`        | `text-[10px]` | `text-xs`  |
| Occupant name      | `text-sm`        | `text-[13px]` | `text-sm`  |
| Occupant secondary | `text-xs`        | `text-[11px]` | `text-xs`  |

The occupant card steps **down** from the unit card, as `CamperCard` does from
`BunkCard`. It does not inherit the unit card's body size, or the household name
would print as large as the room holding it.

`UnitAvailabilityControl` renders inside the card and is part of its scale — a
10px pill in a 14px meta row is the same bug. A sweep test fails on any
`text-[Npx]` anywhere inside either card, because a single arbitrary size left
on a nested row is invisible in a spot check and is how the two scales diverged
in the first place.

**The typeface was the larger half of this row, and it is not a size at all.**
`index.css` sets `h1, h2, h3 { font-family: var(--font-display) }` — Fraunces,
`-0.02em`, `ss01`/`ss02`. Summer titles its bunk in an `<h3>` and gets it; this
card used a `<span>` and rendered the same 18px in the body sans. The tag was
doing typographic work, not only semantic work. Now `<h3>`, measured at
18px/600/−0.27px with `ss01`+`ss02` on all 82 cards. `text-lg` is a utility and
outranks the base rule's `text-2xl md:text-3xl`, so only the face and tracking
carry over.

## 3. What the card reports — OPEN

| Row                  | Summer                           | Family                          | Status             |
| -------------------- | -------------------------------- | ------------------------------- | ------------------ |
| Occupancy figure     | `{occupancy}/{capacity}`         | bare `sleeps`, `—` when unknown | open — package B   |
| Colour ramp          | 4 stops                          | none                            | open — package B   |
| Utilization bar      | `BunkUtilizationBar`             | absent                          | open — package B   |
| Over-capacity chrome | `border-destructive/50 border-2` | none                            | open — package B   |
| Empty state wording  | "Drop campers here"              | "Drop families here" / "Empty"  | **done**           |
| Empty state geometry | `py-8 text-center`               | `py-1`                          | open — package A   |
| Occupant well        | `min-h-[100px]`                  | none                            | open — package A   |
| Actions              | 2×2 `btn-ghost` grid             | one inline pill                 | open — see below   |
| Warnings block       | `BunkWarnings`                   | consent line only               | **keep divergent** |

**Empty state wording is conditional on `canPlace`.** Without a scenario or
without `bunking.manage` there is nothing to drop, so the invitation would name
an action the reader cannot take. Summer renders _nothing at all_ in production
mode; these cards are small enough that a blank body reads as broken rather than
read-only, so the state is stated instead.

**Actions probably should not be ported.** Three of summer's four have no family
analogue — there is no swap, no social graph and no lock concept for lodging.
CSV export is the only one that may genuinely be wanted. Treat this row as a
decision, not a build.

**`BunkWarnings` stays divergent.** Summer's four hazards — age gap, grade
ratio, grade count, over capacity — have no family analogue.

## 4. Occupant card — PARTIALLY OPEN

| Dimension      | Summer `CamperCard`                 | Family `FamilyCard`       | Status      |
| -------------- | ----------------------------------- | ------------------------- | ----------- |
| Name size      | `text-sm`                           | `text-sm`                 | done        |
| Secondary size | `text-xs`                           | `text-xs`                 | done        |
| Radius         | `rounded-xl` (12px)                 | `rounded-lg` (8px)        | open        |
| Border         | `border-2`                          | `border` (1px)            | open        |
| Padding        | `p-2.5`                             | `px-2 py-1.5`             | open        |
| Background     | gender-tinted                       | neutral                   | no analogue |
| Hover          | `hover:shadow-lodge` (inert, #2027) | `hover:border-primary/50` | open        |

**Gender tint has no family analogue** — a party is mixed by definition. Giving
this card a colour channel would mean choosing a _different_ fact to encode
(share eligibility, fit verdict). That is a design question, not a true-up, and
should not be smuggled in under §4.

## 5. Grid and row layout — ONE ROW OPEN

| Dimension     | Summer                       | Family                          | Status            |
| ------------- | ---------------------------- | ------------------------------- | ----------------- |
| Columns       | `grid-cols-1 sm:2 lg:3 xl:4` | `minmax(280px,1fr)` → 4 @ 288px | **done**          |
| Gap           | `gap-3` (12px)               | `gap-3`                         | **done**          |
| Row alignment | default `stretch`            | `items-start`                   | open — package A  |
| Grouping      | flat, area is a filter       | collapsible section per area    | **keep** — see §6 |

Summer sets columns by breakpoint; this board sets a minimum width and lets
`auto-fill` decide. Different mechanism, same result at the sizes that matter,
and the width-driven form degrades better across the range of viewports staff
actually use.

**What `minmax(280px)` bought,** over `minmax(200px)` (5 columns at 228px):

- truncated unit titles **12 of 82 → 2**. An 18px title had ~180px to work with
  at 228px once padding and the capacity figure were out. The two survivors are
  a pair of rooms whose names differ in their last character.
- amenity-row free space on its last line: median **153px → 213px**, 25th
  percentile **115px → 175px**. Roughly one more indicator chip per card, which
  is why the change was wanted — more indicators are coming.
- cost: board height **5172px → 5754px**, +11% scroll. That is what one fewer
  column means.

**Widening does NOT reduce how often the amenity row wraps.** 28 / 29 / 25 cards
sit at one, two and three lines at _both_ widths. The wrapping is structural:
`UnitAvailabilityControl` gives its stored-reason line and its open form
`w-full`, so each takes its own line however wide the card is. Anyone wanting a
denser amenity row must change that control, not the grid.

## 6. Deliberate divergences — SETTLED, do not "fix"

**Per-area collapsible sections.** Keep — but not for the reason originally
recorded.

`BunkingBoardByArea` groups by **gender** (boys / girls / all-gender) and
`selectedArea === 'all'` concatenates all three into one flat grid. Summer's
areas are _mutually exclusive by rule_ — a boy cannot go in a girls' bunk — so
the other two are illegal destinations and a filter hides nothing usable.

Family areas are **geography, and every area is a legal destination for every
family**. Adopting summer's filter would hide 74 usable rooms to show 8. That
copies the widget while discarding the reason it works. §4 asks for the
reasoning to transfer, not the control.

The earlier justification — "82 rooms across 8 areas need grouping where
summer's ~40 bunks don't" — argued from volume. Volume argues for chunking, not
for _this_ chunking. The semantic argument is the load-bearing one.

Measured cost of sectioning, for the record: **24 card rows against a flat 21**
at four columns, plus 8 headings and 7 inter-section gaps, plus **18 empty slots
in partial last rows**. Roughly 20% of board height. Area distribution is even —
18 / 13 / 13 / 10 / 8 / 7 / 7 / 6, median 8.5, no degenerate single-room areas —
so the sections carry real weight rather than fragmenting into noise.

**The wrapping grid of small cards, not tall columns.** A summer bunk column is
tall because it holds 10–14 campers; a lodging unit holds nothing, one party, or
occasionally two. `boardLayout.ts`'s header explains this. Do not make family
cards summer-height.

**The area hue stripe** (`border-t-[3px]` plus the section dot) is §3.10 and must
survive any chrome change. It is an inline `borderTopColor`, so it outranks
`.card-lodge`'s `border-border` and its `border-primary/50` hover. There is a
test pinning it.

Note the coupling: `boardLayout.ts` justifies the eight-hue ramp as decorative
_because_ "the section headers do the actual grouping". **Sections and hue stand
or fall together.** Removing the sections obliges you to delete the hue or
re-justify it against §3.10.

---

## Remaining work, grouped as it should be built

### Package A — slot shape

`items-start` (§5) + empty-state geometry + occupant well (§3). **One change,
three edits.** No decisions required; blocked only on sequencing.

Deleting `items-start` alone makes things _worse_, and this is the trap:

- Grid row height already equals the tallest card in that row. Removing
  `items-start` does not reclaim a pixel — it relocates the whitespace from
  outside the card border to inside it.
- Current dead space is **3,034px across 24 rows** (per row, the sum of every
  card's shortfall against its row's tallest).
- Card heights at four columns: **0 parties → 139px flat, all 28 of them**;
  1 party → 168–268px, median 188; 2 parties → 305–357px, only 3 cards.
- So stretch alone yields 28 empty cards blown up to 200–357px with the word
  "Empty" pinned to the top edge at `py-1`.

Summer gets away with stretch because its empties read as intentional drop
zones — `py-8 text-center` inside a `min-h-[100px]` well — on cards that are
uniformly tall to begin with. Do all three, or none.

### Package B — occupancy

Occupancy figure + colour ramp + utilization bar + over-capacity chrome (§3).
The only item on any table that is **not** a mechanical port. Four real
decisions:

1. **There is no occupancy value.** `BoardSlot` is `{unit, parties, consent}`.
   Derive it as the sum of `party_size ?? adults + children`; that helper is
   currently private inside `FamilyCard` and needs lifting into `boardLayout.ts`.
2. **A merged party is drawn on every room it holds** (since #2010; one party
   currently spans two cards). Sum naively and a 4-person party reads `4/4` on
   _both_ rooms — the board would claim 8 people in 8 beds where there are 4.
   Needs a rule: split across rooms, attribute to one, or say "shared across 2
   rooms".
3. **6 of 82 units have no capacity at all**, rendering `—`, because
   `sleeps: null` means unmeasured rather than zero. A percentage-of-capacity
   ramp cannot colour those six, and the bar has no width for them. Summer never
   hits this; its `defaultCapacity` is a hardcoded 12 that always exists.
4. **Summer's ramp is tuned to a denominator of 12.** Family denominators are
   real and small. A room that sleeps 2 jumps green → orange the moment a second
   person arrives, with no useful gradient between. Decide whether the ramp earns
   its place at these sizes, or whether the bare `2/5` figure is the whole story.

Also: summer's over-capacity chrome is `border-destructive/50 border-2`, and
this card's border already carries two channels — area hue on top, amber for
consent all round. A third claimant needs somewhere else to live.

### Package C — findability, and why the sections survive

Not a table row, but it is what the sections get blamed for.

Summer does not solve "where can this camper go?" with layout either. It solves
it during the drag: `BunkCard` applies `pointer-events-none opacity-40` to every
invalid bunk the moment a camper is picked up. `LodgingUnitCard` indicates
nothing — it deliberately accepts every drop, for a good reason stated in its
comment (fit is advisory; no cabin is confirmed until staff walk the property).

**Declining to refuse a drop is not the same as declining to indicate fit.**
Dimming poor fits without blocking them is summer's own pattern and squarely
§4. Build that and the sections stop being load-bearing for search — which is
the only job they are bad at.

Related: **collapse state is `useState`** (`LodgingBoard.tsx`), so it resets on
reload and is not linkable. Collapsing 7 of 8 areas _is_ the filter, and it
evaporates. §4's URL-state rule applies for the same reason it applies to tabs.

---

## How to re-measure

The dev server for this work runs on `:3135` with `AUTH_MODE=bypass`. Board with
real placements: `/weekend/fc1`. Drive it with `dev-browser` — Playwright pages,
so `setViewportSize`, not `setViewport`, and pass `--timeout` above the 30s
default.

```js
const cards = [...document.querySelectorAll("[data-unit-card]")];
// arbitrary font sizes anywhere inside a card — should be []
[
  ...new Set(
    cards
      .flatMap((c) => [c, ...c.querySelectorAll("*")])
      .flatMap((e) => [...e.classList])
      .filter((k) => /^text-\[\d+px\]$/.test(k)),
  ),
];
// truncated unit titles
cards
  .map((c) => c.querySelector("h3"))
  .filter((t) => t.scrollWidth > t.clientWidth).length;
```

`docs/architecture/lodging-occupancy.md` covers the occupancy data model that
package B has to sit on. `docs/reference/lodging-registry.md` covers where the
unit names come from and why they are not in this repository — **no unit names
in this document either.**
