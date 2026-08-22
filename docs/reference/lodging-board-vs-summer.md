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
board area is **1188px**. Against the 2026 registry **after #2040**: **76
cards** across 8 areas, 62 parties, 52 occupied cards, 24 empty, 4 rooms with no
recorded capacity. Numbers are restated when the layout changes underneath them
— several already have been, twice.

**Read `frontend/CLAUDE.md` and CLAUDE.md §4 first.** This document assumes
both.

---

## Why measure at all

Three findings here could not have been reached by reading code, and each had
already been asserted wrongly from a careful reading first:

- `hover:shadow-lodge-lg` **does nothing**, on this board or summer's. See
  kindred#2027.
- Widening the grid does **not** unwrap the amenity row, though it looks like it
  must.
- Dropping `items-start` **reclaims no space at all** — the grid row is already
  as tall as its tallest card, so it relocates whitespace rather than removing
  it.
- **A sweep test is only as good as what the render mounts.** The `text-[Npx]`
  sweep in `LodgingUnitCard.test.tsx` calls itself load-bearing and covers
  "anywhere inside the card", but its render did not pass `canMerge`, so the
  merge and split controls never mounted and kept `text-[10px]` through the
  whole migration. Nothing failed; §2 was marked CLOSED on a sweep that was
  blind to two live controls in ordinary use. A coverage assertion that
  enumerates elements is worth more than the sweep it guards — the sweep now
  asserts the two buttons are present by role, so a prop rename fails loudly
  instead of silently re-narrowing it.

Assert nothing about rendered output without rendering it. jsdom parses no
Tailwind, so a `toHaveStyle` assertion on a Tailwind class passes against an
empty string and proves nothing — pin **classes** in vitest and measure
**computed values** in a browser.

> Two dev-browser traps, both of which produced a false result here. **Probe
> handles go stale**: grabbing `page.$$(…)` once and clicking across a React
> re-render reports nonsense, and twice looked like a bug in the code under
> test. **Re-query before every click.** And when sweeping
> `document.styleSheets`, test `selectorText` **before** recursing into
> `cssRules` — under nested-CSS support `CSSStyleRule.cssRules` is a truthy
> empty list, so the obvious walk silently visits zero style rules.

---

## 1. Card chrome and geometry — CLOSED, with two deliberate divergences

| Dimension  | Summer                   | Family                       | Status             |
| ---------- | ------------------------ | ---------------------------- | ------------------ |
| Base class | `.card-lodge`            | `.card-lodge`                | done               |
| Radius     | `rounded-2xl` (16px)     | same                         | done               |
| Border     | `border-2 border-border` | same (no per-unit hue — §6)  | done               |
| Shadow     | two-layer lodge          | same                         | done               |
| Padding    | `p-4` (16px)             | `p-2.5 px-3`                 | **divergent — §6** |
| Row rhythm | `mb-3` (12px)            | `gap-2` (8px)                | **divergent — §6** |
| Hover      | `.card-lodge:hover`      | `.card-lodge:hover`          | done — see below   |

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

## 2. Type scale — CLOSED

Summer uses three steps of the stock scale. The family board was built on
arbitrary bracket literals whose **largest** size was smaller than summer's
**body**.

| Slot                | Summer           | Family before | Family now |
| ------------------- | ---------------- | ------------- | ---------- |
| Unit title          | `text-lg` (18px) | `text-[13px]` | `text-lg`  |
| Capacity figure     | `text-sm`        | `text-[11px]` | `text-sm`  |
| Card body           | `text-sm`        | `text-[11px]` | `text-sm`  |
| Badges, chips       | `text-xs`        | `text-[10px]` | `text-xs`  |
| Occupant name       | `text-sm`        | `text-[13px]` | `text-sm`  |
| Occupant secondary  | `text-xs`        | `text-[11px]` | `text-xs`  |
| Merge / split pills | —                | `text-[10px]` | `text-xs`  |

The occupant card steps **down** from the unit card, as `CamperCard` does from
`BunkCard`. It does not inherit the unit card's body size, or the household name
would print as large as the room holding it.

#2040's merge/split controls render inside the card and are part of its scale —
a 10px pill in a 14px meta row is the same bug, and all three sat at 10px until
the sweep was made to render them. Measured live with 25 controls mounted:
every one is 12px, matching the chips beside them, and the card sweep returns
empty. (That measurement was taken while `UnitAvailabilityControl` was the
third of the three; kindred#2072 stage 3 deleted it, and the rule it was
measured under governs whatever renders inside the card next.)

A sweep test fails on any arbitrary size anywhere inside either card —
including variant-prefixed and rem/em forms (`sm:text-[11px]`,
`text-[0.75rem]`), though arbitrary _colours_ stay out of scope — because a
single arbitrary size left on a nested row is invisible in a spot check and is
how the two scales diverged in the first place.

**The typeface was the larger half of this row, and it is not a size at all.**
`index.css` sets `h1, h2, h3 { font-family: var(--font-display) }` — Fraunces,
`-0.02em`, `ss01`/`ss02`. Summer titles its bunk in an `<h3>` and gets it; this
card used a `<span>` and rendered the same 18px in the body sans. The tag was
doing typographic work, not only semantic work. Now `<h3>`, measured at
18px/600/−0.27px with `ss01`+`ss02`. `text-lg` is a utility and outranks the base
rule's `text-2xl md:text-3xl`, so only the face and tracking carry over.

## 3. What the card reports — ONE ROW OPEN

| Row                    | Summer                           | Family                           | Status                      |
| ---------------------- | -------------------------------- | -------------------------------- | --------------------------- |
| Occupancy figure       | `{occupancy}/{capacity}`         | `{occupancy}/{capacity}`         | **done**                    |
| Over-capacity emphasis | `border-destructive/50 border-2` | `text-destructive` on the figure | **done, differently**       |
| Colour ramp            | 4 stops                          | none                             | **closed — will not build** |
| Utilization bar        | `BunkUtilizationBar`             | none                             | **closed — will not build** |
| Empty state wording    | "Drop campers here"              | **nothing — struck**             | **divergent — see below**   |
| Empty state geometry   | `py-8 text-center`               | **n/a — nothing to centre**      | **struck with the wording** |
| Occupant well          | `min-h-[100px]`                  | `flex-1`, no min-height          | **divergent — see below**   |
| Actions                | 2×2 `btn-ghost` grid             | pills; `Assign` opens a modal    | **CLOSED — see below**      |
| Warnings block         | `BunkWarnings`                   | consent line only                | keep divergent              |

⚠️ **The empty-state text is STRUCK, and this paragraph used to argue FOR it.**
It read: _"Empty state wording is conditional on `canPlace`. Without a scenario
or without `bunking.manage` there is nothing to drop, so the invitation would
name an action the reader cannot take. Summer renders nothing at all in
production mode; these cards are small enough that a blank body reads as broken
rather than read-only, so the state is stated instead."_

That reasoning was sound about ONE card and wrong about the board. Measured:
**81% of live cards are empty**, so "Drop families here" was the most-repeated
sentence on the screen — and a sentence repeated sixty times is chrome, not a
state. The dashed border and the visibly empty well already say it, which lands
the board where summer's production mode already was.

It took the well's `min-h-[100px]` with it, and that coupling is why both rows
above moved together: the min-height existed to give that sentence room to sit
in. `flex-1` STAYS — it is what makes the grid's stretch survivable, which is a
different decision entirely (kindred#2072, B·1 and B·2).

**The ramp and the bar are closed as WILL NOT BUILD, not as pending.** Summer's
ramp is a percentage of a fixed capacity of 12 and has five distinguishable
states. Family rooms average about five beds and plenty sleep two, where the same
ramp is a binary wearing four colours — green on the first occupant, orange on
the second. (The border argument in the original ruling has partly lapsed — the
area hue left the card in kindred#2528 — but the arithmetic one above has not,
and it is what decided this.) What is kept is
the figure and **one** emphasis state, for the only actionable case; two cards
qualify on 2026 data.

Consequently the over-capacity emphasis is `text-destructive` on the figure and
nothing else, **not** summer's border treatment. See §6 — the border is no
longer full (kindred#2528 struck the hue top edge), but only the arithmetic
argument here ever depended on the figure, and that stands. (This paragraph used to end "plus a chip". kindred#2072 stage 3 struck the
`Over capacity` pill — it stated at chip weight exactly what the figure states
in colour, on the two cards a weekend that qualify. `LodgingUnitCard.test.tsx`
pins its absence.)

**Actions are CLOSED, and kindred#2072 is what closed them.** Summer's four do
not port: there is no roster swap, no social graph and no lock concept for
lodging, and CSV export belongs on an area header or a board toolbar rather
than on a card that holds one party. What the row was really open on was the
shape of the card's OWN actions, and that is now ruled — the controls sit in
the card's own row as pills, and `Assign` opens a modal.

**The modal is a CONVERGENCE with summer, not a divergence, and it is worth
being precise about which.** Summer already solves "pick somebody for this
container, starting from the container" with a dialog — `BunkSwapModal`,
reached from a bunk. The weekend board reached the same interaction by a
different road: kindred#2080 built it inline under a 2026-08-09 ruling ("not a
popover and not a second surface"), and kindred#2072's AS2 superseded that
ruling for this one control once the row had to carry party size against the
beds left, the need glyphs coloured against the room, last year's cabin and a
fit verdict. So the two boards now agree on the shape.

They still disagree on FILTERING, deliberately: `BunkSwapModal` hides
ineligible bunks via `isEligibleSwapTarget`, and this list hides nothing.
`placementCandidates.ts` carries the arithmetic — **36 of 118 units** answer the
bathroom need against **66 of 479 registrations** asking for one, so a list
narrowed to "what fits" would be empty most of the time and staff would go back
to dragging. (An earlier draft of this paragraph said "45 parties". That figure
is real but belongs to `needsFit.ts`, which counts ROSTERED parties for the
drag-time hatch rather than raw registrations — a different population, and the
mis-attribution is the defect rather than the number. It is **41** on the
2026-08-20 snapshot.) The supply figure read **6 of 118** until that same day:
kindred#2501 moved the need from exclusivity to presence and kindred#2502
resolved 8 of the 15 containers over their rooms. Summer's gender rule is a hard
constraint; amenity fit here is explicitly advisory.

⚠️ **`UnitAvailabilityControl` IS GONE, and this paragraph used to say it stays.**
It read: _"`UnitAvailabilityControl` and the merge/split pills stay INLINE.
Nothing else on the card has information that wants width, and the supersession
was scoped to the one control that does."_ kindred#2072 stage 3 deleted the
control outright — the Assign modal absorbed its occupant prompt (#2506) and
`writeIn.ts` took its `UnitAvailabilityWrite` type. The merge/split pills stay
inline, and the rest of the reasoning still holds for them.

**`BunkWarnings` stays divergent.** Summer's four hazards — age gap, grade ratio,
grade count, over capacity — have no family analogue. Over capacity is the
exception and is handled by the emphasis state above.

### The occupancy numerator is BEDS, and used to be knowingly wrong

`party_size` used to be `len(adults) + len(children)` over the household's
**listed** adults — blank and placeholder `family_camp_adults` slots included —
and every child, infants among them. **#1925** and **#2046** fixed both terms
server-side: an adult slot counts only when its coalesced name is neither blank
nor a placeholder, and a child under **18 months** at session start consumes no
bed. The rules and the placeholder token list are hardcoded in
`api/constants/lodging.py` and mirrored in `householdIdentity.ts`, with a
grep-based test failing if the two drift.

The payload still carries **every** adult row, so the number is legitimately
lower than the names printed beside it. Splitting the card into two figures is
**#2152**'s, not this layer's.

Two related issues are settled rather than open: **#1946** (rows with no name in
any column) shipped as `5f29cf3b` and clears at the source on the next derived
sync; **#1947** (a second adults field) was ruled against — that field is
deliberately never ingested.

⚠️ **There is no "one definition".** This section used to say `partySize` lived
in `boardLayout.ts` as the single read site, "so #1925 is one edit rather than a
hunt". That was false when written: `rosterAttention.partyBeds` is a
byte-identical copy and `FamilyDetailsPanel` holds a third, inline — and the
third was spelled `??` where the other two used `> 0`, so a reported `0`
rendered "0 people" on one surface while the board beside it counted bodies.
All three now agree. Change one, change all three.

### Spanning withholds the verdict, not the figure

Since #2010 a party holding several rooms is drawn on **each** of them, and #2040
deliberately left that rule alone. So the same people can appear on more than one
card, with no per-room breakdown to divide them by.

`slotOccupancy` returns `spanWidth`, and a non-zero value withholds the
over-capacity claim while keeping the figure. Counting the party in full rather
than dropping it is the safer of the two errors: it over-states, which reads as
"look at this", where counting only wholly-contained parties would under-state
and read as "room for more" — the permissive direction `occupiedLeafCodes` exists
to close. A `Spans N rooms` chip used to stop the bare figure reading as a
fault; kindred#2072 stage 3 struck it (vocabulary §3), and
`LodgingUnitCard.test.tsx` pins its absence. What withholds the red is
`spanWidth` itself, in the `overCapacity` guard — the figure simply stays
neutral rather than explaining itself in a chip.

**Measured after #2040: ZERO parties span cards, down from one.** Combining a
whole-let building rolls them onto a single card, and prod will combine more.
Owner-confirmed that a straddling household is never joined in one of its rooms
by a second family, so such a card holds exactly one party — the figure is that
family's size, not an aggregate. This is a guard on a reachable-but-empty state,
which is the kind that rots undetected, so it is tested.

## 4. Occupant card — CLOSED

| Dimension      | Summer `CamperCard`                 | Family `FamilyCard`       | Status                       |
| -------------- | ----------------------------------- | ------------------------- | ---------------------------- |
| Name size      | `text-sm`                           | `text-sm`                 | done                         |
| Secondary size | `text-xs`                           | `text-xs`                 | done                         |
| Radius         | `rounded-xl` (12px)                 | `rounded-xl`              | done                         |
| Border         | `border-2`                          | `border-2`                | done                         |
| Padding        | `p-2.5`                             | `p-2.5`                   | done                         |
| Background     | gender-tinted                       | neutral                   | **closed — no analogue**     |
| Hover          | `hover:shadow-lodge` (inert, #2027) | `hover:border-primary/50` | **closed — family is ahead** |
| Overflow       | `overflow-hidden`                   | none                      | **closed — deliberate**      |

**Gender tint has no family analogue** — a party is mixed by definition. Giving
this card a colour channel would mean choosing a _different_ fact to encode
(share eligibility, fit verdict). That is a design question and must not be
smuggled in under §4.

**The hover row resolves in the family board's favour.** Summer's is one of the
nine inert classes in #2027 and renders nothing; `hover:border-primary/50` works.
Copying summer here would be copying a no-op.

**`overflow-hidden` is deliberately not copied.** `CamperCard` needs it to clip
an absolutely-positioned gradient at its foot; this card has no such element, so
the class would be cargo.

## 5. Grid and row layout — CLOSED

| Dimension     | Summer                       | Family                         | Status            |
| ------------- | ---------------------------- | ------------------------------ | ----------------- |
| Columns       | `grid-cols-1 sm:2 lg:3 xl:4` | `minmax(280px,1fr)` → 4 @288px | done              |
| Gap           | `gap-3` (12px)               | `gap-3`                        | done              |
| Row alignment | default `stretch`            | `stretch`                      | done              |
| Grouping      | flat, area is a filter       | collapsible section per area   | **keep** — see §6 |

Summer sets columns by breakpoint; this board sets a minimum width and lets
`auto-fill` decide. Different mechanism, same result at the sizes that matter,
and the width-driven form degrades better across the viewports staff use.

**What `minmax(280px)` bought,** over `minmax(200px)` (5 columns at 228px):

- truncated unit titles **12 of 82 → 2**. An 18px title had ~180px to work with
  at 228px once padding and the capacity figure were out.
- amenity-row free space on its last line: median **153px → 213px**, 25th
  percentile **115px → 175px**. Roughly one more indicator chip per card, which
  is why the change was wanted.
- cost: **+11% scroll**.

**Widening did NOT reduce how often the amenity row wrapped.** 28 / 29 / 25 cards
sat at one, two and three lines at _both_ widths. The wrapping was structural:
`UnitAvailabilityControl` gave its stored-reason line and its open form
`w-full`, so each took its own line however wide the card was.

⚠️ **Both the control and the amenity row are now gone** — kindred#2072 stage 3
deleted the control and lifted the amenities onto the title row (see the note at
the end of §6). The closing instruction here used to read _"Anyone wanting a
denser amenity row must change that control, not the grid"_; there is no such
row and no such control to change. The measurement is kept because it is what
settled the column width, and that width still stands.
`LodgingBoard.test.tsx` carries the corrected version of this reasoning.

**Row alignment could not be fixed alone.** Dropping `items-start` reclaims
nothing — the row is already as tall as its tallest card, so stretch relocates
whitespace from outside the card border to inside it. Landed together with the
`min-h-[100px]` well and a centred invitation: dead space within rows **3,034px →
0**, no ragged row, at a cost of **+7.9%** board height. The whitespace was never
reclaimed; it was absorbed.

## 6. Deliberate divergences — SETTLED, do not "fix"

**Per-area collapsible sections.** Keep — but not for the reason originally
recorded.

`BunkingBoardByArea` groups by **gender** (boys / girls / all-gender) and
`selectedArea === 'all'` concatenates all three into one flat grid. Summer's
areas are _mutually exclusive by rule_ — a boy cannot go in a girls' bunk — so
the other two are illegal destinations and a filter hides nothing usable.

Family areas are **geography, and every area is a legal destination for every
family**. Adopting summer's filter would hide 74 usable rooms to show 8. That
copies the widget while discarding the reason it works. §4 asks for the reasoning
to transfer, not the control.

The earlier justification — "82 rooms across 8 areas need grouping where summer's
~40 bunks don't" — argued from volume. Volume argues for chunking, not for _this_
chunking. The semantic argument is the load-bearing one.

Measured cost of sectioning, for the record: **24 card rows against a flat 21**
at four columns, plus 8 headings and 7 inter-section gaps, plus **18 empty slots
in partial last rows** — roughly 20% of board height. Area distribution is even
(18 / 13 / 13 / 10 / 8 / 7 / 7 / 6, median 8.5, no degenerate single-room areas),
so the sections carry real weight rather than fragmenting into noise.

**Collapse state lives in the URL** (`?closed=GT&closed=HC`), not `useState`.
Collapsing seven of eight areas _is_ the filter this board was said to lack, and
in component state it evaporated on every reload. §4's URL-state rule applies for
the same reason it applies to tabs. A query **param**, not a path segment: the
view is already a segment because it selects _what_ you are looking at; this
modifies how that view is arranged.

The token is **generated** (`areaTokens`), not read from the registry's
`area_code`, which is hand-entered and ragged — two letters for some areas, four
for others. **Two characters is not always enough**, which is why `areaTokens`
takes the whole set rather than one area at a time: on the 2026 registry two
areas both reduce to the same pair of initials, and both first words share their
first two letters. The colliding group — and only that group — deepens a letter
at a time until distinct, leaving every other token, and every link already
holding one, alone.

Repeated entries rather than a comma list: `URLSearchParams` percent-encodes a
comma, and a link somebody can read is most of the point. Sorted, so one set of
collapsed areas always produces one URL; dropped entirely when empty.

**The wrapping grid of small cards, not tall columns.** A summer bunk column is
tall because it holds 10–14 campers; a lodging unit holds nothing, one party, or
occasionally two. `boardLayout.ts`'s header explains this. Do not make family
cards summer-height.

**The area hue stripe came OFF the card on 2026-08-21** (kindred#2528). This
paragraph used to say the opposite — that the stripe must survive any chrome
change, and that a test pinned it. Both were true until the owner ruled;
the test now asserts the card carries no inline style at all.

The reasoning is the coupling this paragraph already named. `boardLayout.ts`
justifies the eight-hue ramp as decorative _because_ "the section headers do the
actual grouping" — so the hue was never load-bearing on the card, and it was
carried FOUR times over (the `<section>`, the heading, the header dot, and 73
card top-edges). Only the card edge was on every card, always on. **The section
dot is now its only carrier on the board**, at 8 instances instead of 73.

Sections and hue still stand or fall together: removing the sections obliges you
to restore a per-unit carrier or re-justify the ramp against §3.10. The MAP
keeps its per-unit hue, because it has no section headers.

**The card border is no longer full.** It carried the area hue on top and amber
for consent all round, which is why over-capacity took a text colour rather than
summer's `border-destructive/50`. The area hue is gone (kindred#2528), so the top
edge is free — but the text colour stays, and is now doing MORE work: the
drag-time "no room for this family" mark reuses it deliberately, because it is
the same statement as over-capacity rather than a second vocabulary for it.
A future state may take the freed edge; do not assume the border is still full.
The `Over capacity` chip that used to accompany that text colour is struck
(kindred#2072): it stated at chip weight exactly what the red figure states in
colour.

**The padding and the row rhythm are TIGHTER than summer's, and that is
topology rather than taste.** Summer is `p-4` (16px) with an `mb-3` (12px)
rhythm; this card is `p-2.5 px-3` with `gap-2`.

A summer bunk card holds **10–14 campers**, so 16px of padding and a 12px
rhythm are a small fraction of a tall card. A lodging card holds nothing, one
party, or occasionally two — at `p-4` the chrome was most of an empty card, and
81% of live cards are empty. Measured: **−148px across the board, 8.3%**, and
with the dropped well min-height about **−15% of column height**. The two were
measured together and found perfectly additive.

`px-3` rather than a flat `p-2.5` because the horizontal squeeze is what the
~244px inner width can least afford: the vertical tightening is the aggressive
half, the horizontal one is not.

⚠️ **MEASURED IN THE APP AFTER THE FACT, and it is bigger than the mock's
figure — do not "correct" this back.** The review artifact measured B·1 and
B·2 alone at −148px (8.3%) and about −15% of column height. Driven in a real
browser against the 2026 board, 73 cards at the same viewport, the whole stage
lands at:

|                      | before  | after   |            |
| -------------------- | ------- | ------- | ---------- |
| Board scroll height  | 7000px  | 5286px  | **−24.5%** |
| Sum of card heights  | 19937px | 14373px | **−27.9%** |
| Empty card, shortest | 219px   | 91px    | −58%       |
| Empty card, median   | 273px   | 178px   | −35%       |

The difference is not padding: the mock measured the geometry change alone,
while the shipped stage also removed the empty-state sentence, the meta row and
five chips. **The card is shorter because it says less, and only secondarily
because it is tighter.**

⚠️ This supersedes §1's own note that the card "ran at a flat 8px, which left
the title sitting on top of the amenity row". T2 lifted the amenities onto the
title row, so there is no amenity row left for the title to sit on top of.

---

## What #2040 and #2029 settled

Both merged while this branch was in flight. Neither is optional reading before
touching occupancy or the draw level.

**#2040 — a whole-let building draws as one card.** A merge is a **promotion to
the parent**: the card is the container's own registry row.

⚠️ **This paragraph used to add that the container row "carries its measured
whole-house `sleeps`, which is not the sum of its rooms (one building records 7
against rooms summing to 6)", and to say _never re-derive it_. That is false
against the registry and was measured so on 2026-08-20**: **all 15 containers
record `sleeps = 0`**, so no container carries a measured whole-house figure at
all. The four combined ones hold 8, 7, 5 and 5 beds in their rooms and 0 on
their own row.

What supersedes it is kindred#2041's delta ruling — a container's own `sleeps`
is the beds belonging to no single room, so the whole-house capacity IS the
delta plus its rooms, which is what `effectiveSleeps` computes and what
`countUnmeasuredSpaces` and the map peek already read. The unit card is the one
surface still reading the raw value, so a combined container's card prints an em
dash ("capacity not recorded") over rooms that are all measured. Raised by
CodeRabbit on PR #2506; owner ruled it fixed in kindred#2072's stage 3, since
the card is that stage's file.

The instruction that DOES survive is the narrow one #2040 actually earned: do
not re-derive **containment** — `unitLevel.ts` owns which codes a card covers,
and `slotOccupancy` reads it rather than working it out again. It also gave this board `unitLevel.ts`
(`coveredCodes`, `drawnUnits`, `representingCodes`) and `overlappingPartyKeys` /
`occupiedLeafCodes`, which `slotOccupancy` reads rather than re-deriving
containment. #2040 records what re-deriving costs: the overlap rule was fixed at
the slot level and came straight back one level down in `FamilyCard`, because the
second copy had not been told.

**#2029 — the registry records its season.** Year scoping is server-side and
admin-side. The board's read shape is **unchanged**: `LodgingUnitRow` is an alias
for the generated `LodgingUnitSummary`, and `types/lodging.test.ts`'s
`Required<LodgingUnitRow>` fixture compiles with no `year` field. It also removed
the weekend Inventory tab, so the board now reads Housing / Roster / Map.

---

## Remaining work

### Findability — the one substantive item left

Summer does not solve "where can this camper go?" with layout. It solves it
during the drag: `BunkCard` applies `pointer-events-none opacity-40` to every
invalid bunk the moment a camper is picked up. `LodgingUnitCard` indicates
nothing — it deliberately accepts every drop, for a good reason stated in its
comment (fit is advisory; no cabin is confirmed until staff walk the property).

**Declining to refuse a drop is not the same as declining to indicate fit.**
Dimming poor fits without blocking them is summer's own pattern and squarely §4.
It is also what keeps the per-area sections defensible: sections are bad at
search, and this removes the need to search. The well built for §3 is where the
reason goes ("Sleeps 2", "No power").

The uniform slot shape made this _more_ urgent, not less: every empty card is now
an identically well-formed target, so they are harder to tell apart at a glance
than when they were ragged.

### ~~Closing §3's actions row~~ — CLOSED

Closed by kindred#2072's AS2, 2026-08-19. See §3: the card's own actions are
pills, `Assign` opens a modal, and summer's 2×2 grid is not ported. Summer's
`BunkSwapModal` is the convergence; the refusal to filter the list is the
remaining, deliberate divergence.

---

## How to re-measure

The dev server for this work runs on `:3135` with `AUTH_MODE=bypass`. Board with
real placements: `/weekend/fc1/housing`.

**Vite needs `.env` exported at launch**, not just `VITE_DISABLE_AUTH=true` — the
bypass path reads `POCKETBASE_ADMIN_EMAIL`/`POCKETBASE_ADMIN_PASSWORD` through
`vite.config.ts`, and a bare `npm run dev` lands on an authentication error.
Source `.env` first, or use `scripts/start_dev.sh`.

Drive it with `dev-browser` — Playwright pages, so `setViewportSize`, not
`setViewport`, and pass `--timeout` above the 30s default. Re-query element
handles before every click; see the warning at the top.

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
// occupancy figures, over-capacity cards, spanning cards
cards.map((c) => c.querySelector('[title*="placed"]')?.textContent.trim());
cards.filter((c) => c.innerText.includes("Over capacity")).length;
cards.filter((c) => /Spans \d+ rooms/.test(c.innerText)).length;
```

`docs/architecture/lodging-occupancy.md` covers the occupancy data model.
`docs/reference/lodging-registry.md` covers where the unit names come from and
why they are not in this repository — **no unit names in this document either.**
