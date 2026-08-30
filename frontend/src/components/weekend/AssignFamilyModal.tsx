/**
 * Put a family in this space, or write somebody into it — AS2 and W3,
 * kindred#2072.
 *
 * ## It is a modal now, and that SUPERSEDES a standing ruling
 *
 * The 2026-08-09 ruling on kindred#2080 was explicit — *"not a popover and not
 * a second surface"* — and `PlaceFamilyPicker` honoured it: an inline combobox
 * in the unit card's own badge row, growing the card in place exactly as
 * `UnitAvailabilityControl` did before that control was itself cut. That ruling is superseded FOR THIS CONTROL
 * ONLY (owner, 2026-08-19), and the width is what buys the supersession: every
 * candidate row now carries its party size against the beds left, the need
 * glyphs already coloured against this room, last year's cabin and a plain fit
 * verdict. None of that fits in a 244px card.
 *
 * Nothing else on the board moves to a modal: the merge and split controls
 * stay inline, because neither has information that wants width.
 *
 * ⚠️ THIS PARAGRAPH USED TO NAME `UnitAvailabilityControl` AS THE OTHER
 * CONTROL STAYING INLINE. It is not inline any more — it is GONE, cut with
 * the `Released` badge and the `Release` / `Clear` control it drew
 * (kindred#2072 stage 3, vocabulary §3: both need a staff unit or an existing
 * override, and this board has neither). Its `UnitAvailabilityWrite` type
 * moved to `writeIn.ts`, where every remaining producer of that write is a
 * write-in — this modal's `onWriteIn`, and each `WriteInCard`'s pencil and X.
 * The reasoning above is unchanged; only its example was.
 *
 * ## One mounted control instead of ~82
 *
 * The inline picker was mounted on every placeable card, each holding the
 * WHOLE unplaced queue and memoising `placementCandidates` over it — 82 copies
 * of an annotate-and-sort across up to 63 parties, re-run on any board
 * re-render. The modal is mounted only while it is open, so the work happens
 * once, for the card the staff member actually clicked.
 *
 * ## W3, and none of it is a nicety
 *
 * - ONE live input, and it IS the occupant name. There is no separate occupant
 *   field, because asking "is this a family or a write-in?" before the staff
 *   member has typed anything is the question the single box removes.
 * - It NEVER LOCKS. Typing continues straight through the moment the last
 *   family match disappears.
 * - ONLY THE REGION BELOW IT SWAPS. Header, input and footer stay mounted, so
 *   the panel does not jump under the cursor mid-keystroke.
 * - BACKSPACING BACK INTO A MATCH SWAPS IT BACK, and the flip commits nothing
 *   in either direction — and destroys nothing either, so a note survives the
 *   round trip.
 * - `Enter` SAVES FROM A FIELD, NEVER FROM THE SEARCH BOX. This is the ruling,
 *   not a keybinding detail: a family name one character off matches nothing,
 *   and a write-in is silent about having been the wrong thing to do. The
 *   keystroke that commits lives in a field the staff member moved to on
 *   purpose. The list rows are real buttons, so a keyboard still has a path.
 * - AMENDED 2026-08-29: `Ctrl`/`Cmd`+`Enter` commits the write-in from
 *   ANYWHERE in the dialog, the search box included (owner: *"a small thing,
 *   but ctrl/cmd enter on the write in modal should submit just like clicking
 *   'write in'"*). This does not weaken the rule above, because what the rule
 *   protects against is an ACCIDENTAL commit: bare `Enter` is one keystroke
 *   away from every character of a name being typed, and a modifier chord is
 *   not reachable by accident. Bare `Enter` in the box stays swallowed, and
 *   the chord commits nothing the `Write in` button would refuse — it calls
 *   the button's own handler rather than re-deriving its conditions, so a
 *   matched family still means the offer is a PLACEMENT and the chord is
 *   inert.
 *
 * The `People` field W3 draws is kindred#2503, and it IS BUILT, in the slot
 * the layout always reserved for it: it stacks above `Note` in the write-in
 * region, so the note that used to sit first now sits second — the same shift
 * the reserved-slot comment promised before the destination existed.
 *
 * It is OPTIONAL, unlike the occupant name beside it (owner ruling
 * 2026-08-21): *"staff doesn't want the integer field mandatory on input
 * since most will be staff, and she isn't concerned about staff housing
 * hitting quantity limits, and the paper write-ins are fewer."* Blank is a
 * COMPLETE answer meaning the write-in takes the room wholesale, not a
 * missing one — most write-ins are non-rostered staff who will type nothing,
 * and requiring a number would tax every one of them to buy precision only
 * the rarer paper registrations need. A TYPED value still has to parse,
 * though: `0` and anything non-numeric disable `Write in` rather than being
 * silently dropped, because saving a write-in the staff member believes
 * carries a count, without one, is worse than refusing the keystroke.
 * `Enter` saves from it exactly as it does from `Note` below — adding a field
 * adds a save site, never an exception to that ruling.
 *
 * Built on `ui/Modal`, which owns the portal, the focus trap, the background
 * `inert` and `ui/modalStack`'s Escape ordering. Do not hand-roll any of it.
 */
import { Users } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { displayTruncatedAge } from '../../utils/age'
import { Modal } from '../ui/Modal'
import { childrenRunLabel, partyIdentityLabel, partySearchText } from './householdIdentity'
import { NeedGlyphMark } from './NeedGlyph'
import { resolveNeedGlyphs } from './needGlyphs'
import { partyKey } from './partyKey'
import {
  UNPLACED_FILTER_GROUPS,
  unplacedFilterGroup,
  type UnplacedFilterKey,
} from './unplacedFilters'
import {
  partitionByGroup,
  placementCandidates,
  type PlacementCandidate,
} from './placementCandidates'
import { effectiveSleeps, partySpots } from './rosterAttention'
import {
  PARTY_SIZE_CHOICES,
  coveringWriteIns,
  writeInDemand,
  writeInEntries,
  writeInOccupantLabel,
} from './writeIn'

export interface AssignFamilyModalProps {
  isOpen: boolean
  onClose: () => void
  /** The card this was opened from. */
  unit: LodgingUnitRow
  /**
   * Every UNPLACED party, exactly as the queue holds them. NEVER pre-filtered
   * by fit — that is the ruling `placementCandidates` carries, not a caller
   * convenience. Empty where placement is not live, which is how this knows it
   * is a write-in box only.
   */
  parties: RosterPartyRow[]
  /**
   * The whole registry. Needed only to total a combined house's capacity;
   * `[]` is correct for every leaf card.
   */
  units?: LodgingUnitRow[]
  /** Beds already taken on this card — the card's own occupancy numerator. */
  occupants: number
  /**
   * How many cards this slot's placement is spread across, from
   * `slotOccupancy`. `0` for an ordinary placement.
   *
   * ⚠️ IT EXISTS ONLY TO SUPPRESS AN OVER-CAPACITY CLAIM, mirroring the card
   * exactly. A party holding several rooms is drawn on each of them (#2010),
   * so the same people are counted on more than one card and the figure
   * legitimately over-states — the card keeps the number and withholds the
   * VERDICT (`overCapacity` gates on `spanWidth === 0`). Without the same gate
   * here the header would say "Over capacity" about a household that is not
   * over anything, while the card it was opened from says nothing. Measured at
   * zero spanning parties after #2040, so this is a guard on a
   * reachable-but-empty state — the kind that rots undetected.
   */
  spanWidth?: number
  onSelect: (party: RosterPartyRow) => void
  /**
   * Record a name that is not a registered family.
   *
   * Optional, and the offer is absent when it is: a caller with no write path
   * must not be shown an affordance it cannot honour.
   */
  onWriteIn?:
    ((write: { occupantName: string; note: string; partySize: number | null }) => void) | undefined
  /** True while a write THIS card started is in flight. */
  isSaving?: boolean
}

/**
 * Does the room OFFER this, on the evidence the server resolved?
 *
 * ONE PREDICATE FOR ALL FOUR AMENITIES, and it is `LodgingUnitCard`'s own:
 * anything but `none` and `unknown` is a yes. Written once here so the header
 * cannot answer one dimension differently from another — the four used to be
 * four hand-written conditions over four differently-shaped raw fields, which
 * is how one of them (`has_ramp`, a three-value select where `'no'` is TRUTHY)
 * inverts under a boolean read.
 *
 * ⚠️ `unknown` IS ABSENT, AND THAT IS A CLAIM ABOUT CLAIMS. A word in this
 * header asserts the room HAS the thing; there is no third, neutral state to
 * fall back on, so the only question is which assertion is safer about a space
 * nobody has measured. The owner ruled it for the glyphs on 2026-08-20 —
 * *"unknown values should not equal fits, across all surfaces on the glyphs,
 * its unconfirmed information"* — and this header is read in the same glance
 * as those glyphs, against the same rooms. It takes the same reading.
 *
 * `undefined` is the Pydantic-default gotcha rather than a separate case: a
 * field with a default renders optional in the generated types, so an absent
 * coverage is simply an unstated one.
 *
 * `some` IS a yes, deliberately, and it is again the card's rule: the word
 * says the building offers the thing SOMEWHERE. Whether it reaches a
 * particular family is the need glyph's question, and `needGlyphs.someIs`
 * grades that separately per need.
 */
function offers(value: string | undefined): boolean {
  return value !== undefined && value !== 'none' && value !== 'unknown'
}

/**
 * What the room offers, in WORDS.
 *
 * The unit card spends its title row on icons because it has 280px; this has
 * the width to say them, and a staff member reading a candidate's glyphs
 * against the room should not have to decode two icon sets at once.
 *
 * ⚠️ EVERY FIELD HERE IS THE SERVER-RESOLVED ONE, NEVER ITS RAW TWIN, AND THE
 * RAW READ WAS A MEASURED DEFECT.
 *
 * This function read `unit.has_power` and `unit.has_ac` — the DRAWN row's own
 * columns — while `resolveNeedGlyphs` twelve lines below graded the candidate
 * rows off `power_coverage`. The modal is mounted from `LodgingUnitCard` with
 * the drawn unit, so on a container the header omitted "power" while every
 * candidate row under it drew a met plug: one dialog, two answers, and nothing
 * anywhere saying which was meant.
 *
 * The raw flag is not merely a second opinion, it is the WRONG one on a
 * container. Twelve of the fourteen 2026 family-pool containers record
 * `has_power = 0` while every leaf beneath them has power, and 8 of the 15
 * containers resolve a bathroom their own row calls `none`. `power_coverage`,
 * `fridge_coverage`, `ac_coverage` and the in-place-resolved `bathroom` are
 * the server's answers over the leaves (`amenity_coverage` /
 * `container_bathroom` in `api/services/lodging_rules.py`). Do not "simplify"
 * any of these back to the row's own column.
 *
 * PRESENCE for the bathroom, matching the card's own mark (ruling 2): the
 * CampMinder question asks whether a bathroom can be reached without leaving
 * the cabin, never whether it is exclusive (vocabulary §4). `shared` is
 * therefore a yes, on the same axis kindred#2501 moved the glyph's rule onto.
 *
 * FRIDGE IS A WORD HERE AND HAS NO ICON ON THE CARD. It is one of the four
 * ruled need dimensions, the candidate rows below draw a fridge glyph, and a
 * header silent about it was silent about something the rows were speaking on
 * — the same disagreement power had, one dimension over. `fridge_coverage`
 * also carries the owner's 2026-08-15 ruling that a SHARED fridge IS a fridge,
 * which no client-side read of `has_fridge` would reproduce.
 *
 * STEP-FREE IS DELIBERATELY ABSENT. `ramp_coverage` is the fourth need glyph,
 * but 102 of 118 cabins have never been assessed, so the word would be missing
 * from nine headers in ten and read as "no ramp" rather than as "nobody
 * looked". The glyph can say that — it is only drawn for a household that
 * ASKED — and this unconditional line cannot.
 */
function amenityWords(unit: LodgingUnitRow): string[] {
  // Power first, then bathroom — the review artifact's order
  // (`2 of 4 beds free · power · bathroom`). Arbitrary in isolation, so it
  // follows the artifact rather than inventing a second convention. The two
  // the artifact does not name follow it, fridge before air conditioning:
  // fridge is a need a family can ASK for, and air conditioning is the one
  // amenity on this board with no demand counterpart at all (0 of 184 housing
  // narratives mention it, against 11 for a fridge).
  return [
    offers(unit.power_coverage) ? 'power' : null,
    offers(unit.bathroom) ? 'bathroom' : null,
    offers(unit.fridge_coverage) ? 'fridge' : null,
    offers(unit.ac_coverage) ? 'air conditioning' : null,
  ].filter((word): word is string => word !== null)
}

/**
 * ⚠️ BEDS **FREE**, WHICH IS NOT THE CARD'S FIGURE. Owner ruling 2026-08-19,
 * verbatim:
 *
 *   "The modal states beds FREE because that is the question being asked at
 *    the point of placement — will this party fit in what is left. The card's
 *    N/M is unchanged and over-capacity still means placed exceeds capacity
 *    everywhere on the board."
 *
 * Two framings of one arithmetic, and neither is redefined. Do not "make this
 * consistent" with the card by printing `2/4` here — the card answers "how
 * full is this room", this answers "will they fit".
 *
 * `effectiveSleeps` rather than `unit.sleeps`, so a combined house is judged
 * by its whole-house total (its own delta plus its rooms). `null` is "nobody
 * has counted", never "sleeps nobody", and says so rather than printing a
 * number it does not have — the same refusal the card's em dash makes.
 *
 * ⚠️ THE DENOMINATOR DISAGREEMENT BELOW IS HISTORY, NOT A LIVE WARNING
 * (kindred#2540 fix-round CHEAP 14). It used to say the unit card read the
 * RAW `unit.sleeps` while this header read `effectiveSleeps`, and forbade
 * "resolving" that by touching this file — a real, deliberate one-release
 * divergence at the time (owner ruling 2026-08-20, option A). #2508 shipped
 * the card's own move to `effectiveSleeps` (`LodgingUnitCard.tsx`, its own
 * "denominator of total possible sleeps" comment), so the two surfaces have
 * shared a denominator source since before this PR. The paragraph is kept
 * for the historical record and because the FRAMING difference above —
 * beds free here, `N/M` on the card — is still current and still deliberate;
 * only the denominator-SOURCE disagreement it used to also describe is gone.
 * Raised by CodeRabbit on PR #2506.
 */
function capacitySentence(
  unit: LodgingUnitRow,
  units: LodgingUnitRow[],
  occupants: number,
  spanWidth: number
): string {
  const capacity = effectiveSleeps(unit, units)
  // ⚠️ `consumed`, NOT `sized` — DELIBERATE, and the same reviewer who
  // flagged it agreed once the reasoning was in front of them (kindred#2540
  // fix-round FINDING 7, declined by the owner 2026-08-22). The card
  // (`LodgingUnitCard.tsx`) and the map peek (`MapUnitPopover.tsx`) both grade
  // against `sized`, so a 4-bed room with one write-in of 6 and no families
  // shows red `6` on the card and amber `6 of 4` on the map, while this
  // header — reading `consumed` — says plain "0 of 4 beds free". The figure
  // `6` never appears here and `Over capacity` below never fires for it, even
  // though that branch exists and does fire for placed families.
  //
  // Owner ruling, verbatim: "the modal can stay calm — '0 free' is clear
  // enough." This header is the placement moment, and the ruling above (BEDS
  // FREE, not the card's figure) has always framed it as answering "will this
  // party fit in what is left" — "0 of 4 beds free" answers that truthfully
  // on its own, without needing the overage spelled out.
  //
  // The split is BY ROLE, not by surface, and that is the clause that matters:
  // `consumed` is capped at capacity because it answers "how many beds are
  // left", and a remainder cannot go negative. `sized` is deliberately
  // UNCAPPED (`writeInDemand`'s own doc) because it answers "is this over,
  // and by how much" — the question the card's red exists to show. Two
  // different questions, not two copies of one answer that drifted. Do NOT
  // "harmonise" this to `sized` — that is precisely the change the owner
  // declined.
  const { consumed, usable } = writeInDemand(capacity, coveringWriteIns(unit))
  // ⚠️ THE WRITE-IN REFUSAL IS GONE, NOT NARROWED AGAIN — kindred#2543, owner
  // ruling 2026-08-29: *"sure modal can follow the floor, roll that fix in as
  // well."* This header carried a sentence of its own,
  // `Sleeps N · occupancy not counted (write-in)`, for a card whose covers were
  // not all sized. That sentence is DELETED rather than left unreachable: the
  // only state that produced it now publishes a number, and the stats bar, the
  // board card's drag marks and the candidate rows beneath this line all
  // publish the same one. The narrowing this replaces was kindred#2503's, and
  // its own comment promised the refusal would narrow rather than disappear —
  // the owner has now struck the remainder of it.
  //
  // `usable`, NOT `known`. `known` asks *"did a human size every party"*;
  // `usable` asks *"was there a capacity this was subtracted from"*, and only
  // the second decides whether a number may be printed. An unsized cover is
  // charged the WHOLE capacity of the unit it NAMES and a party cannot exceed
  // the leaf it sleeps in, so what is left is a FLOOR: reported free ≤ true
  // free. It can only understate, never overstate — and overstating is the
  // direction that would seat a family in a bed that is not there.
  //
  // ⚠️ SO "5 of 10 beds free" MAY BE A FLOOR PRINTED IN A SENTENCE THAT READS
  // AS A FACT, which is the accepted cost rather than an oversight: an unsized
  // occupant who turns out to be one person leaves 7. Verbatim — *"if that
  // slightly undercounts 'real' availability, staff will know that when looking
  // over the shared cabins."* The card's own occupant list names who is in the
  // room, which is where a staff member goes to check.
  //
  // `capacity === null` IS `usable === false` today, in every branch, and both
  // are spelled because only the first narrows `capacity` for the arithmetic
  // below. Reading `usable` rather than re-deriving it is what makes a future
  // branch that renders `consumed` meaningless say so once, in `writeInDemand`,
  // instead of in each of its callers.
  if (capacity === null || !usable) return 'Capacity not recorded'
  // The card's own gate, mirrored — see `spanWidth`'s doc. A spanning
  // placement keeps its figure and loses the claim. `consumed` folds the
  // write-in headcount into `taken` exactly the way `occupants` already did
  // on its own — `consumed` is `0` whenever there is nothing to count.
  const taken = occupants + consumed
  // ⚠️ THE OVER-CAPACITY SENTENCE COUNTS PLACED FAMILIES ONLY, never `taken`
  // (kindred#2540 final scan, FINDING 2). `consumed` is `capacity` on an
  // ancestor cover -- a whole-house let takes the whole card -- so
  // `occupants + consumed` exceeded capacity the moment ANY family was placed
  // in a room inside a let house, and the sentence read `Over capacity — 12
  // placed, sleeps 10` with two people in the room. Twelve is a number nobody
  // recorded, printed under the word "placed".
  //
  // This is NOT the declined FINDING 7. That one asked the header to START
  // shouting over-capacity from `sized`, and the owner ruled the modal stays
  // calm ("0 free is clear enough"). This keeps it calm -- a write-in overage
  // still says `0 of N beds free` -- and only stops the sentence claiming a
  // headcount for beds a whole-card claim took. `taken` still pays for the
  // write-in in the free-bed arithmetic below, unchanged.
  if (occupants > capacity && spanWidth === 0) {
    return `Over capacity — ${String(occupants)} placed, sleeps ${String(capacity)}`
  }
  return `${String(Math.max(0, capacity - taken))} of ${String(capacity)} beds free`
}

/**
 * The row's fit verdict, and it is stated for EVERY candidate.
 *
 * ⚠️ IT USED TO BE BLANK ON THE ROWS THAT NEEDED IT MOST. The rule was
 * "notes, else `fits`, else nothing", which meant a party whose cabin lacked
 * its bathroom rendered an EMPTY verdict — less annotated than one that fits —
 * while a `partial` row said nothing at all despite its glyph deliberately
 * reading as met (§6). The tracked vocabulary doc promises this element ("…and
 * a fit verdict"), so an empty one is a missing mark rather than a quiet one.
 *
 * This is NOT the per-need note that was struck. That note named the need
 * ("No private bathroom") and duplicated the glyph beside it (N2). This names
 * the ROW's overall verdict and duplicates nothing — capacity is the one
 * dimension that still contributes words, because no glyph carries it.
 */
/**
 * What a candidate row calls the party — THE CHILDREN, WITH THEIR AGES.
 *
 * `Isla (3) Nguyen`, the same run the family card's bold line prints, from
 * `householdIdentity.childrenRun`. Owner ruling 2026-08-20, reversing the
 * `partyIdentityLabel` (attending adults) reading this modal shipped with in
 * #2506 and flagged in its body.
 *
 * ⚠️ THE RUN IS NOT COPIED, AND THAT IS WHY THE RULING WAS FREE. The original
 * objection was real — matching the artifact looked like it meant a second
 * implementation of `youngestFirst` + `dedupeChildNames` + the age formatter,
 * inside the very change that exists to collapse duplicated rules. The answer
 * was to move the derivation rather than to decline the ruling: it lives in
 * `householdIdentity.ts` now and `FamilyCard`'s `ChildList` calls the same
 * function. `MapUnitPopover`'s hand-reproduced `Whole building` chip is the
 * measure of what a copy costs.
 *
 * `displayTruncatedAge` is the card's BOLD-line formatter, so the two lines
 * of type agree to the character. The grey person-grain line's
 * `displayCampMinderAge` is a different question and stays where it is.
 *
 * Falls back to `partyIdentityLabel` when the run is empty: a household with
 * no children on file, and every person-grain adult-weekend party, which IS
 * its own identity rather than a salutation over one.
 */
function candidateIdentity(party: RosterPartyRow): string {
  // ⚠️ GRAIN-GATED, because the card's bold line is. `FamilyCardIdentity`
  // renders the children run only under `isHousehold`; a person-grain party —
  // an adult-weekend guest — is named by its own `display_name`, and the rare
  // one that carries children of its own draws them on a SEPARATE grey line.
  // Without this gate the modal would name such a guest by their children
  // while the card names them by themselves.
  if (party.grain !== 'household') return partyIdentityLabel(party)
  return childrenRunLabel(party.children, displayTruncatedAge) || partyIdentityLabel(party)
}

function fitVerdict(candidate: PlacementCandidate): string {
  if (candidate.notes.length > 0) return candidate.notes.join(' · ')
  if (candidate.fit === 'fits') return 'fits'
  // "some rooms only" for a partial, "does not fit" for an unmet need. The
  // glyph says WHICH need; this says how the room answers it overall.
  return candidate.fit === 'partial' ? 'partial fit' : 'does not fit'
}

/**
 * The verdict's ink — GREEN when it fits, RED when it does not (owner ruling
 * 2026-08-20).
 *
 * ⚠️ IT WAS `text-muted-foreground` AT NORMAL WEIGHT, which is the same ink
 * and weight as last year's cabin immediately to its left — so the row's
 * CONCLUSION read as one more of the row's facts. The artifact draws it as
 * `.fitok` / `.fitno`, 11px and bold, and colour is the whole of the
 * difference between them.
 *
 * ★ `green`, NOT `forest`, AND THE CHOICE WAS MEASURED RATHER THAN ARGUED.
 *
 * `forest` is this board's other green and the obvious candidate — the
 * Returning mark is `text-forest-700 dark:text-forest-300`. It was rejected
 * on two grounds, in this order:
 *
 * 1. IT CANNOT SIGNAL IN LIGHT MODE. `forest-700` resolves to `#003917`
 *    against a `--foreground` of `#0c3125` — a contrast ratio of **1.08:1**
 *    between the verdict and the ordinary row text beside it (measured in
 *    Chromium against this app's own tokens, not computed from the palette's
 *    hex comments, which are stale). The ruling exists BECAUSE the verdict
 *    was reading as one more of the row's facts; forest-700 would leave it
 *    reading exactly that way in a different hue. `green-700` is `#008236`,
 *    2.87:1 against the same text. `forest-600` and `-500` are 1.43 and 1.93
 *    — no step of a palette built to sit UNDER dark-green text can carry a
 *    signal ON it.
 * 2. THE PAIR IT BELONGS TO IS ALREADY SEMANTIC. The other half of this
 *    verdict is `red-800 dark:red-300`, the warn ink `NeedGlyph` owns, and
 *    the card's First-time mark is `amber-700`. Status on this board is
 *    Tailwind's semantic ramps; `forest` is the lodge's chrome — buttons,
 *    headers, borders, the primary. Pairing a semantic red with a brand green
 *    is the mismatch, not using the ramp the red already comes from.
 *
 * The artifact's own `--ret` is green-700/green-300, so this is also what it
 * draws. That is corroboration rather than the reason: vocabulary §6 says the
 * mock's colours are approximations of the app's scale, and §2 of the
 * vocabulary is what closes the HUE set — for the four need glyphs, which
 * this is not.
 *
 * ⚠️ Two greens now exist on the board, deliberately, and they answer
 * different questions: `forest` says something about the HOUSEHOLD (it has
 * been here before), `green` says something about THIS ROOM AND THIS PARTY.
 * If they should be one, make Returning the semantic one — not this.
 *
 * TWO STATES, NOT THREE, and `partial fit` is therefore red. Two glyph states
 * are ruled (§2) and `NeedGlyph` refuses a third word for the same reason; a
 * third verdict colour here would re-open it from the other side. A capacity
 * note is red too and cannot be otherwise: `candidateFit` writes one only
 * when capacity is `unmet`, and `fit` is the worst of every dimension.
 */
function fitTone(candidate: PlacementCandidate): string {
  return candidate.fit === 'fits'
    ? 'text-green-700 dark:text-green-300'
    : 'text-red-800 dark:text-red-300'
}

export function AssignFamilyModal({
  isOpen,
  onClose,
  unit,
  parties,
  units = [],
  occupants,
  spanWidth = 0,
  onSelect,
  onWriteIn,
  isSaving = false,
}: AssignFamilyModalProps) {
  /*
   * ⚠️ THE SEARCH BOX IS FOCUSED THROUGH `ui/Modal`, NOT THROUGH `autoFocus`,
   * and that is a fix rather than a style choice. Measured 2026-08-20 in a
   * browser and reproduced in jsdom: `autoFocus` was applied by React during
   * commit and then TAKEN BACK by `ui/Modal`'s own focus effect, which lands
   * on `focusable[0]` — the Close button, because a custom header renders it
   * above the body. The dialog whose doc says it "exists to be typed into"
   * opened with focus on a button that swallows printable keys and CLOSES on
   * Space or Enter.
   *
   * It also broke the restore this file's `anchor` comment claims: `autoFocus`
   * had already moved `document.activeElement` inside the dialog before
   * `ui/Modal` captured it, so closing restored focus to a detached input and
   * it fell to `<body>` instead of to the Assign pill. Both halves are pinned
   * in `Modal.test.tsx`.
   */
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  /*
   * The note SURVIVES the flip, deliberately. "Backspacing back into a match
   * swaps it back" is offered as a way out of a mistyped name, so a staff
   * member who typed a note, backspaced to check a family and typed forward
   * again must not find it gone. The flip commits nothing — and destroys
   * nothing.
   */
  const [note, setNote] = useState('')
  /*
   * OPTIONAL, unlike the occupant name beside it (owner ruling 2026-08-21).
   * Most write-ins are non-rostered staff and staff will choose nothing here;
   * blank means the cabin is taken wholesale, which is the correct answer for
   * that population rather than a missing one. It is the FIRST option and the
   * default, so the control opens on it.
   *
   * A STRING, because that is what a `<select>` value is. `''` is the blank
   * option and every other value is one of `PARTY_SIZE_CHOICES` rendered by
   * `String(...)`, so `Number(...)` below is total over anything this state
   * can hold — there is no parse to fail.
   *
   * ⚠️ THERE IS NOTHING TO VALIDATE HERE ANY MORE, and the absence is the
   * point (owner ruling 2026-08-23). This used to be an `<input
   * type="number">` guarded by a `peopleBadInput` state, a `peopleFieldRef`,
   * a `peopleCountValid` check and a live `validity.badInput` re-read at
   * submit — four mechanisms to catch text the control should never have
   * accepted. `PARTY_SIZE_CHOICES`'s own doc carries why that never fully
   * worked. A select cannot express `0`, a fraction, `1e3` or `abc`, so all
   * four are gone rather than fixed. Do not reintroduce a People-shaped
   * disable on the commit: it would be dead code, and a dead disable is
   * exactly what left the old button looking enabled while doing nothing.
   */
  const [people, setPeople] = useState('')
  const partySize = people === '' ? null : Number(people)

  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  // Annotated and ordered FIRST, then narrowed by what the staff member typed.
  // The typed filter is the user's own; it is not a fit gate, and it is the
  // only thing that ever removes a row.
  /*
   * ⚠️ THE OCCUPANCY IS THREADED IN, AND A ROW GRADES WHAT IS LEFT (owner
   * ruling 2026-08-20). See `capacityVerdict`. Without it the row said `fits`
   * about a party the header directly above it had just said there was no
   * room for.
   *
   * `spanWidth` gates it exactly as it gates the header's own over-capacity
   * claim, and mirrors the card (`overCapacity` gates on `spanWidth === 0`):
   * a party holding several rooms is drawn on every one of them (#2010), so
   * `occupants` counts the same people more than once and legitimately
   * over-states. Subtracting an over-stated figure would print `does not fit`
   * on rows that fit — a worse failure than the one being fixed, because the
   * header beside it would be claiming nothing was wrong.
   */
  const occupied = spanWidth === 0 ? occupants : 0
  const candidates = useMemo(
    () =>
      placementCandidates(parties, unit, units, occupied).filter(
        (candidate) =>
          needle === '' || partySearchText(candidate.party).toLowerCase().includes(needle)
      ),
    [parties, unit, units, occupied, needle]
  )

  /**
   * The staff-group pin (kindred#2480, owner pick "B" 2026-08-24). Single-select
   * like the Unplaced popout's row, because the ruling behind that — a party in
   * two groups never needs a tie-break — is the same one here.
   */
  const [group, setGroup] = useState<UnplacedFilterKey | null>(null)

  // Over every party the card offered, never the typed subset: the number
  // answers "is this group worth pinning" before the click, and one that moved
  // while you typed would stop answering it. Same rule as the popout's chips.
  const groupCounts = useMemo(() => {
    const tally = {} as Record<UnplacedFilterKey, number>
    for (const spec of UNPLACED_FILTER_GROUPS) {
      tally[spec.key] = parties.filter((party) => spec.matches(party)).length
    }
    return tally
  }, [parties])

  /**
   * PINNED, NOT FILTERED. Both halves render, one after the other — see
   * `partitionByGroup`, and the "never hide" ruling it protects. `candidates`
   * itself is untouched, which is what keeps the footer count and the write-in
   * offer honest.
   */
  const { pinned, rest } = useMemo(() => partitionByGroup(candidates, group), [candidates, group])

  const listEntries = useMemo(() => {
    type ListEntry =
      { kind: 'band'; label: string } | { kind: 'row'; candidate: PlacementCandidate }
    const entries: ListEntry[] = []
    if (pinned.length > 0 && group) {
      entries.push({
        kind: 'band',
        label: `${String(pinned.length)} asked for ${unplacedFilterGroup(group).label.toLowerCase()}`,
      })
      for (const candidate of pinned) entries.push({ kind: 'row', candidate })
      entries.push({ kind: 'band', label: 'Everyone else' })
    }
    for (const candidate of rest) entries.push({ kind: 'row', candidate })
    return entries
  }, [pinned, rest, group])

  /**
   * THE WRITE-IN OFFER, and the three conditions are each load-bearing.
   *
   * `onWriteIn` — the caller can actually write one.
   * `trimmed !== ''` — whitespace asserts nothing, and an occupant name is
   *                    required; an empty write-in would name nobody.
   * `candidates.length === 0` — a family still matching means the staff member
   *                    is most likely still typing toward it.
   *
   * Consequence worth stating: a name that happens to match a family's search
   * text can never become a write-in from this box. That is the right trade —
   * the far more common mistake is writing in somebody who IS registered — and
   * an extra distinguishing word reaches the offer.
   */
  const offersWriteIn = onWriteIn !== undefined && trimmed !== '' && candidates.length === 0

  /**
   * ⚠️ WHO A WRITE-IN FROM THIS BOX WOULD DESTROY, or `null` for nobody.
   *
   * `set_availability` resolves a write-in BY UNIT and upserts
   * (`find_write_in` -> `_upsert_row`'s `if existing is not None: update(...)`),
   * and this modal's `onWriteIn` targets the card's own unit unconditionally.
   * So on a cabin that already holds its OWN row, typing a second name and
   * clicking "Write in" REPLACES the first occupant — their name, their note
   * and the party size somebody recorded — silently, on all 118 units.
   *
   * ⚠️ THE ANSWER IS A WARNING, NOT A REFUSAL, and that is a ruling rather
   * than a preference. kindred#2432 deliberately struck the `!writtenInto`
   * gate that used to refuse this box on an occupied card, so that a family
   * and a write-in can share a space in either order —
   * `LodgingUnitCard.tsx` marks the two struck gates in capitals and says
   * NEITHER MAY COME BACK. Re-gating `offersWriteIn` above would undo it.
   *
   * OWN ROWS ONLY. A merged container draws its rooms' write-ins and a room
   * draws its building's; those covers name a DIFFERENT row, so a write-in
   * here CREATES one and replaces nobody. Warning about an inherited
   * occupant would teach staff to read past the sentence in the case that
   * matters.
   *
   * IT RETIRES ITSELF. Once a unit may hold two write-in rows this write
   * stops replacing and starts adding, and this whole block goes with it.
   */
  const replacedOccupant = useMemo(() => {
    const own = writeInEntries(unit).find((entry) => entry.source.isOwn)
    return own === undefined ? null : writeInOccupantLabel(own.occupant)
  }, [unit])

  const choose = (party: RosterPartyRow) => {
    onSelect(party)
    setQuery('')
    setNote('')
    setPeople('')
    onClose()
  }

  const writeIn = () => {
    // ONE guard, unchanged in meaning: the caller can write one, a name was
    // typed, and no family still matches. The two count guards that stood
    // beside it (`peopleCountValid` and a live `validity.badInput` re-read)
    // are gone with the number input -- see the `people` state's doc.
    if (!offersWriteIn) return
    // The TRIMMED text, which is what the offer shows. Staff type into a search
    // box and a trailing space is a typing artefact, not a name.
    onWriteIn({ occupantName: trimmed, note: note.trim(), partySize })
    setQuery('')
    setNote('')
    setPeople('')
    onClose()
  }

  /**
   * Whether this card can place a family at all.
   *
   * FALSE on the CampMinder mirror, where there is no scenario: recording who
   * is sleeping in a cabin is a fact about the WEEKEND, not about a plan, so
   * the write-in half stays live where the placement half cannot be. The
   * caller passes an empty queue in that case rather than a second flag.
   */
  const placementLive = parties.length > 0 || onWriteIn === undefined

  /*
   * ONE BASELINE ROW — title and sub together, the artifact's `.mhead`
   * (`display:flex; align-items:baseline; gap:8px; flex-wrap:wrap`).
   *
   * They were stacked, which read as a title with a caption under it and put
   * 79px of header above a list. On one line the cabin and what it offers are
   * a single statement: "Assign to X · 2 of 4 beds free · power · bathroom".
   * `flex-wrap` is the artifact's too — a long cabin name drops the sub to its
   * own line rather than squeezing it.
   */
  /*
   * ⚠️ NO RULE UNDER THE HEADER (owner ruling 2026-08-20), and the comment
   * that used to justify one was simply WRONG. It said `ui/Modal`'s header
   * slot "draws one on every dialog in the app" — it does not: the custom
   * header branch renders `{header}` and a floating close button and nothing
   * else, so the `border-b` here was this dialog's own and removing it moves
   * no other surface.
   *
   * What the rule cost: measured in Chromium, the title's ink ended ~10px
   * above it while it sat 4px above the search box, so the line read as
   * belonging to the input rather than as dividing anything — "the spacing
   * under the title and its line seems a bit too tight… why a line there at
   * all". The approved artifact has none (`.modalcard{gap:9px}` is plain
   * whitespace between `.mhead` and `.pinput`), and the ruled 9px is now
   * undivided and carried entirely here, in `pb-[9px]`.
   */
  const header = (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3.5 pt-3.5 pr-14 pb-[9px]">
      <h2 className="min-w-0 truncate text-lg font-bold">{`Assign to ${unit.name}`}</h2>
      <p data-testid="assign-capacity" className="text-muted-foreground text-xs">
        {[capacitySentence(unit, units, occupants, spanWidth), ...amenityWords(unit)].join(' · ')}
      </p>
    </div>
  )

  const footer = (
    // `border-dashed`, the artifact's `.mfoot{border-top:1px dashed}` — the
    // same ruled block that gives the swap region its dashed separator. Solid
    // here and dashed 200px above it made one dialog draw two grammars of rule.
    // ⚠️ `py-[9px]`, WHICH SUPERSEDES TWO OF §3.3's OWN NUMBERS (owner ruling
    // 2026-08-20, on looking at the built dialog). The artifact's
    // `.mfoot{padding-top:4px}` plus the card's 14px bottom inset put this one
    // line 4px under the rule and 14px above the card's edge, so it sat hard
    // against the rule instead of in the band — "kinda just off". 9 and 9 is
    // the same 34px band with the line centred in it, so the card's height is
    // unchanged and the 14px inset stands everywhere else. An alignment
    // ruling, not a spacing one.
    <div className="border-border text-muted-foreground flex items-center gap-2.5 border-t border-dashed px-3.5 py-[9px] text-xs">
      {/* ⚠️ ONE ELEMENT IN BOTH MODES, AND THAT IS THE POINT (owner ruling
          2026-08-20, option C). The Write in button used to live HERE beside
          the hint, which made this band 51px on the flip against 35px in list
          mode — so the card's bottom edge dropped 16px while everything above
          it correctly stayed put. The button now sits in the swap region, next
          to the field it commits; this line is all the footer ever holds, so
          there is nothing left that can change its height. */}
      <span className="flex-1">
        {offersWriteIn
          ? '↵ in a field saves · backspace to a match to go back'
          : parties.length === 0
            ? ''
            : `${String(candidates.length)} of ${String(parties.length)} · click a family, or keep typing`}
      </span>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={header}
      footer={footer}
      // `ui/Modal`'s own contract: a caller using the custom `header` slot has
      // to thread a name, because there is no `title` for it to derive one
      // from. Threaded for that reason rather than as an accessibility
      // measure — it names the dialog after the cabin it writes to, which is
      // also the only thing distinguishing one of these from another.
      ariaLabel={`Assign to ${unit.name}`}
      // ⚠️ TOP-ANCHORED, and it is load-bearing. Centred, the dialog is laid
      // out around a content-height card, so every change in the swap region
      // re-centres the whole thing — measured at 133px of search-box travel
      // across a three-character typeahead, and 28px on the keystroke that
      // performs the flip. W3's ruling is that the panel does not jump under
      // the cursor; this and the swap region's fixed height are the two halves
      // of honouring it. The artifact anchors the same way
      // (`.modalwrap{align-items:flex-start}`).
      anchor="top"
      // The modal exists to be typed into: opening it and then asking for a
      // click before a keystroke lands is the friction it removes. See
      // `searchRef` for why this is a ref rather than the `autoFocus` it was.
      initialFocusRef={searchRef}
      noPadding
      // ⚠️ 520px EXACTLY, WHICH IS A RULED NUMBER (owner, 2026-08-20). It
      // shipped at `size="lg"` — `max-w-2xl`, 672px — which was a default
      // nobody chose and 152px wider than the artifact the row's five columns
      // were laid out against (`.modalcard{max-width:520px}`).
      //
      // `size="md"` (`max-w-lg`, 512px) was the alternative and is four
      // pixels off. Taken literally instead, because the width is the whole
      // argument for AS2 superseding the "not a second surface" ruling and is
      // the one dimension in this dialog that was measured rather than
      // chosen — a row that truncates a name eight pixels earlier than the
      // design it is being compared against is not the design. `ui/Modal`'s
      // `maxWidthClassName` is opt-in and no other caller is touched.
      maxWidthClassName="max-w-[520px]"
      // The close button is centred in the header band, and this dialog no
      // longer has to ask: kindred#2507 made centring `ui/Modal`'s DEFAULT, so
      // the `closeAlign="center"` that used to sit here is gone as redundant
      // rather than as a change of mind. This header is 51px and the old
      // `top-4` default assumed at least 52px, which is how the button came to
      // hang 1px past its own ground here first.
      // ⚠️ THE CARD'S BORDER IS `ui/Modal`'s 1px, NOT the artifact's 2px, AND
      // THAT IS NOW RULED (owner, 2026-08-20, having compared the two at 4×).
      // §3.3's quoted block carries `.modalcard{border:2px}`, but that ruling's
      // subject was spacing; the weight belongs to `ui/Modal` and changing it
      // moves ~20 unrelated dialogs. The artifact's 2px is not the app's
      // grammar, so it does not travel — do not "fix" this to match the mock.
    >
      {/* ⚠️ THE WHOLE VERTICAL RHYTHM IS THE ARTIFACT'S, AND IT IS RULED
          (owner, 2026-08-20). It was `px-6 py-4 gap-3` against the artifact's
          14px padding and 9px gap, with the dashed separator 12px below the
          input and only 8px above the first row — so the line that divides
          "what you typed" from "what that found" sat nearer the rows than the
          box, and read as belonging to the list.
          `.modalcard{padding:14px; gap:9px}` is what every number here comes
          from, and the three sections split it:
             card top → header text      14px   `pt-3.5`
             header text → search box     9px   the header's own `pb-[9px]`
             box → dashed separator       9px   this `gap-[9px]`
             separator → first row        9px   the swap region's `pt-[9px]`
             row → row                    6px   the list's `gap-[6px]`
             last row → footer rule       9px   this `pb-[9px]`
             footer rule → footer text    9px   the footer's `py-[9px]`
             footer text → card bottom    9px   the same, and see it for why
                                                these two stopped being 4/14
          The artifact has NO rule under its header and NEITHER DOES THIS ONE
          any more (owner, 2026-08-20) — the 9px above is plain gap, carried by
          the header's own `pb-[9px]`, so this element adds nothing on top of
          it. `pt-0` is therefore load-bearing rather than noise: the previous
          `pt-1` was the lower half of a 4 + rule + 4 split that no longer
          exists, and leaving it would make the one distance §3.3 ruled 13px
          instead of 9. */}
      <div
        className="flex flex-col gap-[9px] px-3.5 pt-0 pb-[9px]"
        /* ⌘/CTRL + ↵ COMMITS THE WRITE-IN, from anywhere in this region —
           the search box included, which bare `Enter` deliberately never does
           (see the amended ruling in the module docstring).

           ON THE CONTAINER, not on each field: the point is that it works
           wherever the caret happens to be, and three copies of one chord is
           three places for it to drift. `keydown` bubbles, so the fields'
           own bare-`Enter` handlers below are untouched and still run first
           for the unmodified key.

           ⚠️ AND THE FIELDS HAND THE CHORD UP RATHER THAN ANSWERING IT.
           Bubbling cuts both ways: `Note` and `People` also answer `Enter`,
           so while they ignored the modifiers a Ctrl/Cmd+Enter pressed in
           one of them committed there AND again here — two `onWriteIn`
           calls, two round trips and two `onClose()`s from one keystroke, on
           the commonest path there is, since `Note` is the last thing staff
           fill in. Each field now returns on a held modifier, so the chord
           has exactly one handler wherever it is pressed.

           IT CALLS `writeIn()`, which is the `Write in` button's own
           onClick. That is deliberate rather than incidental: `writeIn`
           starts `if (!offersWriteIn) return`, so the chord inherits every
           condition the button has — a name was typed, no family still
           matches (with a match the offer is a PLACEMENT, and writing in over
           it is the exact mistyped-name failure the ruling exists to stop),
           and the caller offers a write-in path at all. A shortcut that can
           commit what the button refuses is a bug, so there is no second copy
           of those conditions here.

           `isSaving` IS the one thing `writeIn` does not check, because the
           button spells it as `disabled` instead. */
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          if (!event.ctrlKey && !event.metaKey) return
          if (isSaving) return
          event.preventDefault()
          writeIn()
        }}
      >
        {/* THE ONE LIVE INPUT, and it is also the occupant name. It is never
            disabled by the flip and never remounted by it — it is rendered
            outside the swap region below precisely so React keeps the same
            node, and with it the focus and the caret, straight through the
            moment the last match disappears. */}
        <input
          type="search"
          ref={searchRef}
          value={query}
          disabled={isSaving}
          aria-label={
            placementLive
              ? `Place a family in ${unit.name}, or write in a name`
              : `Write in an occupant for ${unit.name}`
          }
          placeholder={placementLive ? 'Place a family, or write in…' : 'Write in a name…'}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            /* ⚠️ `Enter` DOES NOTHING HERE, ON PURPOSE (W3). It is what stops a
               mistyped family name silently becoming a write-in instead of a
               placement. `preventDefault` because this box can be mounted
               inside a form; the swallow is the feature. */
            if (event.key === 'Enter') event.preventDefault()
          }}
          // `px-1.5 py-1` is the artifact's `.pinput{padding:4px 6px}`; it
          // was `px-2 py-1.5` (8px/6px). `rounded-md` is its 6px radius and
          // `bg-background` its `--s-bg` — the PAGE colour on a `bg-card`
          // dialog, which is the same ground the rows take (§3.6).
          className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none"
        />
        {parties.length > 0 && (
          <div
            data-testid="assign-group-chips"
            // No padding and NO negative margin: this row lives INSIDE the
            // search box's `flex flex-col gap-[9px] … pb-[9px]` container, so
            // that container's gap is the single vertical rhythm, its padding
            // the single bottom gap, and its `px-3.5` the left edge the chip
            // BOX shares with the typeahead above and the candidate rows below.
            //
            // A `-ml-2` was tried here to flush the ICON rather than the box and
            // it reads as overhanging — the Unplaced popout, which is the
            // reference for this row, aligns the box and not the glyph.
            className="flex flex-wrap items-center gap-1"
          >
            {UNPLACED_FILTER_GROUPS.map((spec) => {
              const Icon = spec.Icon
              const isActive = group === spec.key
              const count = groupCounts[spec.key]
              return (
                <button
                  key={spec.key}
                  type="button"
                  // Icon + count, no text label — the popout's locked style.
                  // The label is the button's only name, a test handle per
                  // frontend/CLAUDE.md rather than an accessibility posture.
                  aria-label={spec.label}
                  aria-pressed={isActive}
                  title={spec.label}
                  // Dimmed at zero, never hidden — a chip that vanished could
                  // not say the group is empty. The active chip stays live at
                  // zero so a pin can always be undone.
                  disabled={(count === 0 && !isActive) || isSaving}
                  onClick={() => {
                    setGroup((current) => (current === spec.key ? null : spec.key))
                  }}
                  // Geometry is the Unplaced popout's, verbatim — same radius,
                  // padding, icon size and active treatment. One chip row means
                  // one chip, and the popout is the reference (owner ruling,
                  // 2026-08-24). Do not re-tune it on this side alone.
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                      : 'text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? '' : spec.hueClassName}`}
                  />
                  {count}
                </button>
              )
            })}
          </div>
        )}

        {/* THE SWAP REGION — the only thing that changes when the last match
            goes.

            `h-80`, NOT `max-h-80`, and that is the fix for a measured defect
            rather than a tidy-up. `ui/Modal` lays the dialog out around a card
            whose height is its content's, so a shorter swap region re-centred
            the WHOLE card: the search box moved 133px across a three-character
            typeahead and 28px on the keystroke that performs the flip — the
            exact jump W3 forbids. Anchoring the dialog (`anchor="top"`) fixes
            the direction; a constant height fixes the amount, so the input does
            not move at all.

            The artifact's separator (`.mswap`'s `border-top: 1px dashed`) is
            what makes the boundary between "what you typed" and "what that
            found" legible once the region no longer shrinks to fit. */}
        {/* THE GROUP CHIPS — above the swap region on purpose. That region's
            `h-80` is a fixed height fixing a measured jump; putting a row of
            controls INSIDE it would spend list rows on chrome, and putting one
            that can change height inside it would reopen the jump. Here the row
            is constant and the region below is untouched. */}

        <div
          data-testid="assign-swap-region"
          className="border-border h-80 overflow-y-auto border-t border-dashed pt-[9px]"
        >
          {offersWriteIn ? (
            /* `gap-[6px]`, the swap region's own rhythm — this div stands
               where the artifact's `.mswap` children stand. It was `gap-3`
               with a stray `py-1` that put the sentence 4px below a
               separator whose padding had already placed it. */
            <div data-testid="write-in-region" className="flex flex-col gap-[6px]">
              {/* ⚠️ THE SENTENCE LIVES INSIDE THE FIXED-HEIGHT REGION, and the
                  artifact puts it OUTSIDE (`.mnote.flip`, above `.mswap`).
                  A deliberate divergence, and it was measured both ways: the
                  artifact anchors its dialog but lets the card grow, so only
                  its footer moves. W3 says header, input AND FOOTER stay put.
                  Outside the region this one paragraph pushed the footer 32px
                  on the flip; inside a region whose height is fixed it costs
                  nothing, and all three measure 0px of travel. */}
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {`No family matches “${trimmed}” — this will be written in.`}
              </p>
              {/* THE OVERWRITE WARNING — see `replacedOccupant`. One line,
                  in the region that already swapped, so the fixed-height
                  region absorbs it and nothing above or below moves (W3).
                  No new visual language: the same sentence weight as the line
                  above it, in the destructive colour the board already uses
                  for a removal. */}
              {replacedOccupant !== null && (
                <p
                  data-testid="write-in-replaces"
                  className="text-sm font-medium text-red-700 dark:text-red-400"
                >
                  {`${unit.name} already holds ${replacedOccupant} — writing in will replace them.`}
                </p>
              )}
              {/* ONE ROW, People then Note (owner ruling 2026-08-23). They
                  were stacked; a select needs ~5.5rem and the note wants the
                  rest, so the pair costs one field's height instead of two.
                  The region's height is FIXED (W3, no jump), so what this
                  actually buys is empty ground below rather than a shorter
                  dialog -- nothing above or below it moves either way.

                  `items-end` so the two controls sit on a common baseline
                  despite `People`'s narrower label; `gap-2` matches the
                  artifact's field rhythm. */}
              <div data-testid="write-in-fields" className="flex items-end gap-2">
                {/* `gap-[3px]` is the artifact's `.mfield`, matching `Note`. */}
                <label className="flex w-[5.5rem] shrink-0 flex-col gap-[3px] text-xs font-medium">
                  People
                  <select
                    value={people}
                    disabled={isSaving}
                    onChange={(event) => {
                      setPeople(event.target.value)
                    }}
                    onKeyDown={(event) => {
                      // ↵ SAVES FROM A FIELD -- the same half of the ruling
                      // `Note` beside it carries. A select is still a field;
                      // changing the control's type does not change which
                      // half of the keybinding rule it takes
                      // (weekend-card-vocabulary.md §6).
                      if (event.key !== 'Enter') return
                      // ⚠️ THE CHORD IS NOT THIS HANDLER'S, and leaving it
                      // here made one keypress two writes. `keydown` bubbles,
                      // so a Ctrl/Cmd+Enter pressed in this field ran the
                      // commit HERE and then ran it again on the container --
                      // two `onWriteIn` calls, two round trips and two
                      // `onClose()`s, on the commonest path there is. The
                      // container owns the chord (see the region's own
                      // comment); this field owns the BARE key. One handler
                      // per keystroke, and the guard is spelled the same way
                      // in both places so the split reads as deliberate.
                      if (event.ctrlKey || event.metaKey) return
                      event.preventDefault()
                      writeIn()
                    }}
                    // The SAME `.pinput` as `Note` and the search box above,
                    // minus the placeholder colour a select has no use for.
                    className="border-border bg-background text-foreground focus:border-primary/50 focus:ring-primary/10 rounded-md border px-1.5 py-1 text-sm font-normal focus:ring-2 focus:outline-none"
                  >
                    {/* BLANK FIRST AND DEFAULT -- wholesale, the common case
                        (owner ruling 2026-08-21). The em dash is the same
                        glyph the card draws for an unsized write-in, so the
                        control and the card say the absence the same way. */}
                    <option value="">—</option>
                    {PARTY_SIZE_CHOICES.map((count) => (
                      <option key={count} value={String(count)}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-[3px] text-xs font-medium">
                  Note
                  <input
                    type="text"
                    value={note}
                    disabled={isSaving}
                    placeholder="Optional — e.g. back Monday"
                    onChange={(event) => {
                      setNote(event.target.value)
                    }}
                    onKeyDown={(event) => {
                      // ↵ SAVES FROM A FIELD. This is the other half of the
                      // ruling above, and the half that makes it usable.
                      if (event.key !== 'Enter') return
                      // THE CHORD BELONGS TO THE CONTAINER, for the reason
                      // `People` beside it spells out: `keydown` bubbles, so
                      // handling it here too turned one Ctrl/Cmd+Enter into
                      // two write-ins.
                      if (event.ctrlKey || event.metaKey) return
                      event.preventDefault()
                      writeIn()
                    }}
                    // The SAME `.pinput` as the search box above — one class in
                    // the artifact, so one set of numbers here. It kept the
                    // pre-ruling `px-2 py-1.5` when §3.3 was applied, which left
                    // the two inputs 4px different in height with both on screen
                    // at once.
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 rounded-md border px-1.5 py-1 text-sm font-normal focus:ring-2 focus:outline-none"
                  />
                </label>
              </div>
              {/* ⚠️ THE COMMIT LIVES HERE, NOT IN THE FOOTER (owner ruling
                  2026-08-20, option C), and it is the last of the jump W3
                  forbids. In the footer this button made that band 51px on the
                  flip against 35px in list mode, so the card's bottom edge
                  dropped 16px — everything ABOVE the footer already travelled
                  0px, which is why nobody had caught it. This region's height
                  is fixed, so a button inside it costs nothing and moves
                  nothing.

                  It also puts the action under the field it commits rather
                  than 250px below it, past the region's empty ground. The
                  design artifact draws it in the footer; that is a deliberate
                  divergence, because the artifact's own card simply grows on
                  the flip and following it here would import the defect.
                  `AssignFamilyModal.test.tsx` pins both halves. */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={writeIn}
                  disabled={isSaving}
                  className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  Write in
                </button>
              </div>
            </div>
          ) : parties.length === 0 ? (
            /* Nothing left to place. `FloatingUnplacedBadge` already says this
               over the same parties — one state, one sentence. BELOW the
               write-in offer, deliberately: on the CampMinder mirror there is
               no scenario and therefore no placement queue at all, so this
               branch is the one an unfiltered box lands on. Above the offer it
               would say "everyone has a cabin" while swallowing the name just
               typed. */
            <p className="text-muted-foreground px-2 py-6 text-center text-sm italic">
              Everyone has a cabin.
            </p>
          ) : candidates.length === 0 ? (
            /* A typo, not a fit verdict. Only reachable where the caller offers
               no write-in path; otherwise the region above says the same thing
               and gives it somewhere to go. */
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {`No parties match “${trimmed}”`}
            </p>
          ) : (
            <div
              role="listbox"
              aria-label={`Families to place in ${unit.name}`}
              className="flex flex-col gap-[6px]"
            >
              {listEntries.map((entry) => {
                if (entry.kind === 'band') {
                  return (
                    <div
                      key={`band-${entry.label}`}
                      className="text-muted-foreground flex items-center gap-1.5 pt-0.5 text-[10px] font-bold tracking-wider uppercase"
                    >
                      <span>{entry.label}</span>
                      <span className="bg-border h-px flex-1" />
                    </div>
                  )
                }
                const candidate = entry.candidate
                const party = candidate.party
                const lastYearCabin = (party.last_year_cabin ?? '').trim()
                // The PROSPECTIVE reading — graded against the cabin being
                // considered, never against a placement this party does not
                // have. See `needGlyphs.NeedReading`.
                const glyphs = resolveNeedGlyphs(party, unit, 'prospective')
                return (
                  <button
                    key={partyKey(party)}
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-testid={`candidate-${partyKey(party)}`}
                    data-fit={candidate.fit}
                    disabled={isSaving}
                    onClick={() => {
                      choose(party)
                    }}
                    /*
                     * TWO LINES — OPTION A, owner 2026-08-20 — AND A DRAWN
                     * RECTANGLE (the artifact's `.crow`: `border:1px;
                     * border-radius:8px; padding:5px 7px; background`).
                     *
                     * ⚠️ THE SECOND LINE EXISTS TO STOP THE IDENTITY BEING
                     * CRUSHED, and that was measured rather than feared. On one
                     * line this row had FOUR columns that refuse to shrink —
                     * the bed count, the glyph strip, last year's cabin
                     * (`whitespace-nowrap`) and the fit verdict
                     * (`whitespace-nowrap`) — and exactly one that yields, the
                     * family's name. At 520px, on the worst case the board can
                     * produce (five children, four glyphs, a 26-character cabin
                     * name and an over-capacity sentence) the four took 461px
                     * of a 476px track and the name rendered as `G.`: 12.7px,
                     * two characters, on a staff-facing list whose whole job is
                     * telling families apart.
                     *
                     * So line 1 is the identity and its headcount and nothing
                     * else — nothing can compete with it — and the detail line
                     * takes the rest. There the CABIN is the flexible column:
                     * the most advisory of the three, and the only one that
                     * still reads when clipped.
                     *
                     * It costs height, and the cost is real: ~53px against 32,
                     * which is about 5.5 rows in the fixed region rather than
                     * 8.6. Two things pay for it. The list is TYPED INTO —
                     * the search box is how staff narrow it, not the scrollbar
                     * — and taller rows fill a region whose fixed height
                     * otherwise left visible empty ground under a short list.
                     *
                     * A REAL TAB STOP, unlike the inline picker's rows. There,
                     * ~82 mounted lists meant every row was a stop; here the
                     * list is inside a focus-trapped dialog and is the only one
                     * on screen. It is also what keeps a keyboard path open
                     * while `Enter` in the search box stays inert.
                     */
                    className="border-border bg-background hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-1.5 rounded-lg border px-[7px] py-[5px] text-left text-[13px] focus-visible:outline-none disabled:opacity-40"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* LINE 1 — who they are, and how many. */}
                      <span className="flex min-w-0 items-center gap-1.5">
                        {/* `font-semibold`, the artifact's
                            `.cname{font-weight:600}`. The row's own text is
                            13px, so the name needs the weight to lead it. */}
                        <span className="text-foreground min-w-0 flex-1 truncate font-semibold">
                          {candidateIdentity(party)}
                        </span>
                        <span className="text-muted-foreground inline-flex flex-shrink-0 items-center gap-0.5 text-xs tabular-nums">
                          <Users className="h-3 w-3" />
                          {partySpots(party)}
                        </span>
                      </span>

                      {/* LINE 2 — what they asked for, where they were, how
                          this room answers. ALWAYS RENDERED (owner ruling
                          2026-08-20), and it used to be dropped when it held
                          nothing but the verdict.

                          ⚠️ THE COLLAPSE WAS THE WRONG SAVING, AND THE
                          MEASUREMENT IS WHY. Its reasoning was sound as far as
                          it went — a household with no glyphs and no cabin
                          should not pay a whole line for one word — but
                          dropping the line put the verdict back on line 1,
                          where it competes with the identity. The verdict is
                          at its LONGEST precisely when the row carries nothing
                          else, because an over-capacity note is a sentence:
                          measured in Chromium, a three-child household with no
                          glyphs, no cabin and 9 beds against 4 rendered its
                          name clipped at 268px of the 335px it wanted. The
                          same failure the two-line row exists to prevent,
                          reached by the branch meant to be cheap.

                          It also ends a raggedness: rows measured 53.5px with
                          a glyph, 50px without one and 31.5px collapsed, in
                          one list. */}
                      <span
                        data-testid="candidate-detail-line"
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        {/* ⚠️ RENDERED ONLY WHEN THERE ARE GLYPHS (owner ruling
                            2026-08-20). An empty flex child still takes the
                            line's 6px gap, so last year's cabin began at x=404
                            while the name directly above it began at x=398 — a
                            6px indent drawn by a glyph that is not there, and
                            not the 26px a row WITH a glyph indents by either,
                            so it lined nothing up. Reserving a fixed slot so
                            every cabin shares one x was the alternative, was
                            mocked, and was rejected: "drop the empty strip".
                            `gap-[3px]` is the artifact's `.cglyphs{gap:3px}`. */}
                        {glyphs.length > 0 ? (
                          <span className="flex flex-shrink-0 items-center gap-[3px]">
                            {glyphs.map((glyph) => (
                              <NeedGlyphMark key={glyph.key} glyph={glyph} insideControl />
                            ))}
                          </span>
                        ) : null}
                        {/* THE COLUMN THAT YIELDS. `min-w-0 flex-1 truncate`
                            rather than the `whitespace-nowrap` it carried on
                            one line: a cabin name is the one thing here that
                            still means something half-read. Empty when there is
                            no cabin on file, where it becomes the spacer that
                            keeps the verdict at the line's end. */}
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                          {lastYearCabin}
                        </span>
                        {/* Stated for every row (see `fitVerdict`): capacity is
                            the only dimension that still spends words, because
                            no glyph carries it. */}
                        <span
                          data-testid={`candidate-${partyKey(party)}-fit`}
                          className={`flex-shrink-0 text-[11px] font-bold whitespace-nowrap ${fitTone(candidate)}`}
                        >
                          {fitVerdict(candidate)}
                        </span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
