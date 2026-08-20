# The weekend lodging card — mark vocabulary

Every mark the family lodging board draws on a unit card or a family card: what
it is, where it sits, what it means, and **who ruled it**. Ruled 2026-08-19
under kindred#2072 unless a row says otherwise.

**Read this before adding, moving or removing anything on that card.** A mark
absent from this file is not a gap to fill — check §3 first, because seven of
them were removed on purpose.

## Why this file exists at all

The same decisions were written down once before, in
`docs/superpowers/specs/2026-07-31-family-camp-lodging-board-map-design.md` §3
"Decisions locked". That path is **gitignored** (`.gitignore:190`), so it exists
in nobody's clone — while at least nine comments in the shipped code still cite
it by section number (`unitBadges.ts:5` "spec §3.7", `FamilyCard.tsx:10` "spec
§3.8", `FamilyDetailsPanel.tsx:2` "spec §3.9", `SharePreferenceChip.tsx:2`
"spec §4.3", `boardLayout.ts:767` and `:825` "spec §7.3", `FamilyCard.tsx:80`
and `LodgingUnitCard.tsx:1043` "spec §11", `boardLayout.test.ts:706`,
`FamilyCard.test.tsx:740`). Anyone following those citations today reads
nothing.

This file is tracked. Repoint one of those citations here each time you touch
the code around it.

Related: `lodging-board-vs-summer.md` measures this card against summer's and is
the home for _divergences_; this file is the home for _vocabulary_.

---

## 1. Unit card — marks that are drawn

| Mark                                  | Where                         | Means                                                                  | Why it is there                                                                                                                        | Ruled               |
| ------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Unit name                             | title row                     | the room                                                               | —                                                                                                                                      | —                   |
| Amenity icons — bathroom · power · AC | **title row**, variable block | what the room offers                                                   | read against the family's need glyphs on the same card                                                                                 | T2                  |
| Bathroom mark                         | title row                     | **the room has a bathroom in it**                                      | presence only. Private-vs-shared is deliberately **not** drawn — see §3                                                                | 2026-08-19          |
| Occupancy `N/M`                       | title row, right              | placed vs capacity, red when over                                      | the primary number on the card. **No icon** — the red figure absorbed the cut _Over capacity_ pill                                     | unchanged, affirmed |
| `Reconfirm space`                     | unit meta                     | **`is_confirmed = false`** — nobody has checked this cabin this season | relabelled from _Sharing unset_ and **re-gated**: the old gate was `shareability`, where all 118 rows are classified and none is unset | 2026-08-19          |
| `Inactive`                            | unit meta                     | deactivated but still occupied                                         | kept for the unlikely case; hiding it would drop whoever is in it                                                                      | pending staff       |
| Consent warning                       | own line                      | a household declined sharing, or has not answered                      | the sentence that survived the _N families_ cut                                                                                        | pending staff       |
| Occupant write-in card                | the well, above the parties   | somebody in the room who is not on the roster                          | carries its **own always-visible** 18px edit and remove. Solid border, not dashed                                                      | 2026-08-19          |
| `Assign` · `Merge` · `Split`          | **footer row**                | the controls                                                           | moved out of the meta row                                                                                                              | 2026-08-19          |

## 2. Family card — marks that are drawn

| Mark                                                                                      | Where                             | Means                          | Why it is there                                                                                                                                                                                       | Ruled         |
| ----------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Need glyphs — bathroom · power · fridge · step-free                                       | chip row, **icon-only**           | what the household asked for   | the whole point of #2072. One grading for all four, in `needGlyphs.ts` — the three tables that used to grade them separately now call it                                                              | A3            |
| — the bathroom glyph's label                                                              |                                   | `Bathroom in unit`             | not `Private bathroom`: the column's word, never the question's (§4). ⚠️ The **rule** still grades exclusivity until #2501, so for one release a room can show a bathroom while the family shows red  | 2026-08-19    |
| — hues                                                                                    |                                   | sky · purple · teal · orange   | **`text-sky-500 dark:text-sky-400`** and the same 500/400 step for purple, teal, orange. The locked hex values _are_ those Tailwind steps; do not hand-write hex                                      | A3            |
| — unmet state                                                                             |                                   | the placed room has not got it | the glyph takes the **warn** fill, border and icon colour. The shape still says which need it is, which is what makes losing the hue affordable                                                       | N2            |
| — absent state                                                                            |                                   | not asked for                  | **omitted entirely, never dimmed**                                                                                                                                                                    | absence rule  |
| Single parent                                                                             | **line 2**, before the adult name | exactly one attending adult    | left the chip row, where it borrowed the sharing chips' muted grammar and read as a preference. **Amber** — the same tone _First-time_ uses, so amber means _notice this household_ across both marks | S2 + Sa       |
| Returning / First-time                                                                    | bottom-right                      | prior Family Camp attendance   | a **16px icon**, no text label                                                                                                                                                                        | R3            |
| `Needs Accommodation`                                                                     | chip row                          | `accommodation_is_mandatory`   | the hardest stop on the board. Renamed from _Accommodation required_; **the label is explicitly not locked**                                                                                          | pending staff |
| `Near another family` · `Wants to share` · `Did not request sharing` · `Answers disagree` | chip row                          | sharing intent                 | four chips from one object                                                                                                                                                                            | pending staff |

## 3. STRUCK — do not reintroduce

**A cut is a ruling.** Each of these was removed deliberately; each has come
back at least once in this codebase's history when the reason was not written
down. Pinned negatively in `LodgingUnitCard.test.tsx` / `FamilyCard.test.tsx`.

| Struck                                                   | Why                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No private bathroom` / `No power`                       | a bathroom glyph beside a chip saying the bathroom is missing states one fact twice. The glyph carries the state itself (N2)                                                                                                                                                                                     |
| `Reconfirm amenities` (the whole `unverified` chip)      | its name was wrong on both arms. Arm (a) is superseded by _Reconfirm space_. Arm (b) fires **because the cabin is confirmed**, so "reconfirm" asked for a check already done — what it meant was _this family wrote an accommodation note the system cannot check_, which now travels with `Needs Accommodation` |
| `Staff` badge                                            | all 25 staff units fail `isPlanningInventory`, so no staff card is ever drawn here. Survives on the map and the units admin table                                                                                                                                                                                |
| `Released` badge **and** the `Release` / `Clear` control | both need a staff unit or an existing override; this board has neither, and `lodging_availability` is empty in every year                                                                                                                                                                                        |
| `One-family space`                                       | staff know which spaces hold one family. Never fired: all 23 room-sharing cards are classified `shareable`                                                                                                                                                                                                       |
| `Spans N rooms`                                          | dropping somebody into a container is a deliberate act; the figure needs no explaining                                                                                                                                                                                                                           |
| `Drop families here` / `Empty`                           | the dashed border and the empty well already say it, and at **81% of live cards empty** this was the most-repeated sentence on the board. ⚠️ `lodging-board-vs-summer.md` §3 previously argued _for_ this text — that paragraph is superseded                                                                    |
| The unit **meta row** as a general-purpose row           | T2 lifts the amenities to the title and the footer takes the controls. It survives ONLY as a conditional row for the two marks in §5a, and will render on no live card. **Lands in stage 3** (§9) — until then the row is still unconditional in code                                                            |
| Private-vs-shared bathroom on the unit card              | the form never asked about exclusivity — see §4                                                                                                                                                                                                                                                                  |
| `Building` (the unit card's copy)                        | ruled cut 2026-08-19. The `reservationBadge` arm survives for `MapUnitPopover`'s header and its collapsed grid cell; the card stops calling it, so a board card draws none of that function's four labels. **Lands in stage 3** (§9) — the card still draws `Building` until then                                |
| Earlier cuts, still struck                               | `Whole building` · `N families` · `Shared OK` · `Over capacity` pill. **`Whole building` had never been landed** and was still on the card in code; it went with the glyph row. It survives on the MAP, the same split `Staff` takes                                                                             |

### Older absences on the family card, still absent

These three predate #2072 and are the reason `FamilyCard.tsx` cited a
gitignored "spec §3.8". Repointed here so the citation lands somewhere
readable; the reasoning is unchanged and each is pinned negatively in
`FamilyCard.test.tsx`.

| Struck                 | Why                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request text           | 12 of 232 request texts contain health vocabulary including a named diagnosis. The roster's exposure was accepted for opening ONE row at a time, not for printing it across 62 simultaneously-visible cards |
| The medical affordance | `has_medical_narrative` was true for 62 of 62 parties. A flag that is always on is not a flag — kindred#1889 deleted it; the narrative lives on `FamilyDetailsPanel`                                        |
| `needs_resolution`     | true for 44 of 62. Same reason                                                                                                                                                                              |

## 4. The bathroom axis — a correction worth keeping

The flag is called `needs_private_bathroom` and the UI called it _Private
bathroom_, but **the CampMinder question never asks about exclusivity**:

> "Does your family require access to a bathroom that doesn't require you to
> leave your cabin for a medical or accessibility-related reason?"

That is _in-cabin vs walk-to-the-bathhouse_ — `bathroom != 'none'` — which a
`shared` unit satisfies as fully as a `private` one. Of the 90 free-text answers
behind that question, **at most 5 rows, 3–5 households, ~5%** describe something
a shared bathroom cannot meet; the rest are about speed and distance.

The word _private_ entered at the column name and propagated to the label.
Private-vs-shared is an artefact of how containers and `bathroom_group`s were
modelled, not a question anyone asked a family.

Fixing the rule is **kindred#2501** (`satisfiedBy` → `effective_bathroom !==
'none'`), gated on reading the Adult form's wording, which supplies 19 of 66
flagged households and has never been audited.

## 5. Open — silence here is not consent

- **Pending staff input**, unchanged until they weigh in: the `Needs
Accommodation` label, the four sharing-intent chips (including whether the
  cluster consolidates), the consent warning, `Inactive`.
- **The `Needs Accommodation` rename did not reach `AccessibilityFlagList`**,
  and that is deliberate rather than missed. The details panel's housing-needs
  list carries a PAIR — `Accommodation required` / `Accommodation requested` —
  keyed on the same `accommodation_is_mandatory` the chip reads, and renaming
  half of a pair breaks it. The card and that list therefore word one fact two
  ways today. **Put both in front of staff together**, since the label is
  explicitly not locked.
- **The roster's own wording did not move either**, for a sharper reason: the
  glyph is called _Bathroom in unit_ because that is the axis the form asks
  about, but `rosterAttention` still grades exclusivity until #2501, and
  "No bathroom in unit" would be a false sentence about a cabin with a shared
  bathroom in it. Both halves move together when #2501 lands.

## 5a. Answered 2026-08-19 — the four rulings the implementation needed

Each is a place a locked ruling met a fact it did not know about. None could be
resolved by an implementer without guessing.

| Question                                                                                                                             | Ruling                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The meta row is not empty.** Ruling 12 deletes it, but `Inactive`, `Building` and `Reconfirm space` survive T2 and the footer move | `Building` is **cut** (§3). The row **stays, rendering only when `Inactive` or `Reconfirm space` is present** — never, on today's data, so ruling 12's outcome holds on every live card while both marks keep a home for when #2500 makes `Reconfirm space` fire on all 118 units at season start. **Lands in stage 3** (§9) |
| **The Assign modal's `People` field has no column.** `lodging_write_ins` holds `occupant_name` and `note` only                       | Land the modal **without the people count**, and scope kindred#2503 to add it — that issue body now owns the field explicitly                                                                                                                                                                                                |
| **"Party size vs REMAINING beds" redefines a staff-facing number**                                                                   | Owner, verbatim: _"The modal states beds FREE because that is the question being asked at the point of placement — will this party fit in what is left. The card's N/M is unchanged and over-capacity still means placed exceeds capacity everywhere on the board."_                                                         |
| **Rulings 2 and 4 contradict until #2501** — presence on the room, exclusivity on the family                                         | **Accept for one release**, named in the PR body with a comment at both sites. `needGlyphs.test.ts` carries the assertion that flips when #2501 lands                                                                                                                                                                        |

## 6. Policies with no line of code to sit on

- **The absence rule.** A need not asked for is _omitted_, never dimmed. This
  governs marks that do not exist yet.
- **The hue set is closed.** Four dimensions, four hues, light/dark as the
  500/400 step. A fifth need does not get a fifth colour without a ruling.
- **Enter does not save from the Assign modal's search box** — only from
  _People_ or _Note_. That is what stops a mistyped family name silently
  becoming a write-in instead of a placement. The rule is the point; the
  keybinding is the implementation.
- **The mock's colours are approximations.** The review artifact simulates the
  app's tokens. Use the app's own scale, never hex copied out of the mock.

## 7. Deferred, with issues

| Issue        | What                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| kindred#2499 | evaluate removing the `Write-in` badge from the map surfaces                                                                                           |
| kindred#2500 | year roll-forward should create units **unconfirmed** — this is what makes _Reconfirm space_ fire at all                                               |
| kindred#2501 | the bathroom fit rule, above                                                                                                                           |
| kindred#2502 | `_build_units` scores a container's bathroom on its own blank row                                                                                      |
| kindred#2503 | optional party size on a write-in, its effect on the occupancy numerator, **and the Assign modal's `People` field** — the modal ships without it (§5a) |

## 8. Where the deliberation lives

The mocks, the measurements and the rejected options are in a review artifact
kept with the owner, sourced from `docs/plans/2026-08-19-glyph-gutter-review.html`
(local only). **This file is the record; that artifact is the argument.** If they
disagree, this file is wrong — fix it here.

---

## 9. Where each ruling landed

Three PRs, in this order — the modal needs the glyphs, not the reverse, and it
carries every backend-shaped risk, so isolating it keeps that from blocking the
visual work.

| Stage | What                                                                                                                    | Landed                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1     | The glyph vocabulary — `needGlyphs.ts`, the family card's third line, S2 + Sa, R3, and the family-card half of the cuts | `feature/weekend-glyph-vocabulary` |
| 2     | The Assign modal — AS2 + W3                                                                                             | pending                            |
| 3     | The unit card — T2, the footer, the padding, and the board half of the cuts                                             | pending                            |

**`needGlyphs.ts` is the artifact to know about.** There was no per-need fit
resolver before it: the four ruled glyphs were graded by three mutually
disjoint tables that already disagreed — `rosterAttention`'s
`VERIFIABLE_NEEDS` read the RAW `has_power`, `needsFit`'s `NEEDS_DIMENSIONS`
read the server-resolved `power_coverage`, and `FamilyCardChips` drew words.
The roster therefore called twelve entirely-powered buildings unpowered while
the board's own hatch called them fine. All three call the resolver now.

WHICH needs a surface reports is still per-surface, and each scope is written
down where it lives rather than implied: the drag hatch grades three (bathroom
would hatch 112 of 118 cards and 90 even after #2501), the roster grades two
(adding fridge and step-free moves parties between staff-facing section counts
and needs its own ruling), and the card draws all four.
