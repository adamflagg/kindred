/**
 * Put a family in this space, or write somebody into it — AS2 and W3,
 * kindred#2072.
 *
 * ## It is a modal now, and that SUPERSEDES a standing ruling
 *
 * The 2026-08-09 ruling on kindred#2080 was explicit — *"not a popover and not
 * a second surface"* — and `PlaceFamilyPicker` honoured it: an inline combobox
 * in the unit card's own badge row, growing the card in place exactly as
 * `UnitAvailabilityControl` does. That ruling is superseded FOR THIS CONTROL
 * ONLY (owner, 2026-08-19), and the width is what buys the supersession: every
 * candidate row now carries its party size against the beds left, the need
 * glyphs already coloured against this room, last year's cabin and a plain fit
 * verdict. None of that fits in a 244px card.
 *
 * Nothing else on the board moves to a modal. `UnitAvailabilityControl` and
 * the merge/split controls stay inline, because none of them has information
 * that wants width.
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
 *
 * The `People` field W3 draws is kindred#2503 and is NOT BUILT: `lodging_write_ins`
 * carries `occupant_name` and `note` and nothing else, and a control with no
 * destination is worse than an absent one (owner ruling, 2026-08-19). The
 * layout leaves it room.
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
import { placementCandidates, type PlacementCandidate } from './placementCandidates'
import { effectiveSleeps, partyBeds } from './rosterAttention'

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
  onWriteIn?: ((write: { occupantName: string; note: string }) => void) | undefined
  /** True while a write THIS card started is in flight. */
  isSaving?: boolean
}

/**
 * What the room offers, in WORDS.
 *
 * The unit card spends its title row on icons because it has 280px; this has
 * the width to say them, and a staff member reading a candidate's glyphs
 * against the room should not have to decode two icon sets at once.
 *
 * PRESENCE for the bathroom, matching the card's own mark (ruling 2): the
 * CampMinder question asks whether a bathroom can be reached without leaving
 * the cabin, never whether it is exclusive (vocabulary §4).
 */
function amenityWords(unit: LodgingUnitRow): string[] {
  const bathroom = unit.bathroom ?? 'unknown'
  // Power first, then bathroom — the review artifact's order
  // (`2 of 4 beds free · power · bathroom`). Arbitrary in isolation, so it
  // follows the artifact rather than inventing a second convention.
  return [
    unit.has_power === true ? 'power' : null,
    bathroom !== 'none' && bathroom !== 'unknown' ? 'bathroom' : null,
    unit.has_ac === true ? 'air conditioning' : null,
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
 * ⚠️ THE UNIT CARD DOES NOT AGREE WITH THIS YET, AND THAT IS A KNOWN,
 * DELIBERATE ONE-RELEASE DIVERGENCE (owner ruling 2026-08-20, option A: the
 * card is stage 3's file, so it is fixed there).
 *
 * The card's denominator is the RAW `unit.sleeps`. Measured against the
 * production snapshot, **all 15 containers record `sleeps = 0`**, which the API
 * maps to `null` and the card renders as an em dash — so on each of the four
 * combined containers the card says "capacity not recorded" while this header
 * says, correctly, how many beds the rooms beneath it hold:
 *
 *     gt-clouds-rest   own 0, 4 rooms, leaves sum 8
 *     gt-wawona        own 0, 2 rooms, leaves sum 7
 *     hc-downstairs    own 0, 2 rooms, leaves sum 5
 *     hc-doctors-house own 0, 2 rooms, leaves sum 5
 *
 * THIS surface is the correct one — `countUnmeasuredSpaces` and the map peek
 * already use `effectiveSleeps`, and the card is the only reader of the raw
 * value left. Do not "resolve" the disagreement by making this one read
 * `unit.sleeps`. Raised by CodeRabbit on PR #2506.
 */
function capacitySentence(
  unit: LodgingUnitRow,
  units: LodgingUnitRow[],
  occupants: number,
  spanWidth: number
): string {
  const capacity = effectiveSleeps(unit, units)
  if (capacity === null) return 'Capacity not recorded'
  // The card's own gate, mirrored — see `spanWidth`'s doc. A spanning
  // placement keeps its figure and loses the claim.
  if (occupants > capacity && spanWidth === 0) {
    return `Over capacity — ${String(occupants)} placed, sleeps ${String(capacity)}`
  }
  return `${String(Math.max(0, capacity - occupants))} of ${String(capacity)} beds free`
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

  const choose = (party: RosterPartyRow) => {
    onSelect(party)
    setQuery('')
    setNote('')
    onClose()
  }

  const writeIn = () => {
    // The single guard is enough, and the redundant `onWriteIn === undefined`
    // that used to sit beside it is gone: `offersWriteIn` is a `const` whose
    // definition includes that check, so TypeScript narrows through it.
    if (!offersWriteIn) return
    // The TRIMMED text, which is what the offer shows. Staff type into a search
    // box and a trailing space is a typing artefact, not a name.
    onWriteIn({ occupantName: trimmed, note: note.trim() })
    setQuery('')
    setNote('')
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
      {offersWriteIn ? (
        <>
          <span className="flex-1">↵ in a field saves · backspace to a match to go back</span>
          <button
            type="button"
            onClick={writeIn}
            disabled={isSaving}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            Write in
          </button>
        </>
      ) : (
        <span className="flex-1">
          {parties.length === 0
            ? ''
            : `${String(candidates.length)} of ${String(parties.length)} · click a family, or keep typing`}
        </span>
      )}
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
      // ⚠️ CENTRED IN THE HEADER BAND (owner ruling 2026-08-20, option A).
      // `ui/Modal`'s default `top-4` assumes a header at least 52px tall —
      // 16px plus a 36px box — and this header is 51px, so the button hung
      // past its own ground: 5px while the header rule was still there, where
      // its hover fill painted across the rule, and 1px after the rule came
      // out. The opt-in leaves every other dialog on `top-4`.
      //
      // Option B — the artifact's 18px circled mark in flow on the header row
      // — is the one the owner preferred, and is filed as its own issue
      // because it should land on every dialog at once rather than here alone.
      closeAlign="center"
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
      <div className="flex flex-col gap-[9px] px-3.5 pt-0 pb-[9px]">
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
              {/* kindred#2503's `People` field belongs HERE, above the note.
                  It is not built: `lodging_write_ins` has `occupant_name` and
                  `note` and nowhere to put a count, and a field with no
                  destination is worse than an absent one. When #2503 lands it
                  STACKS above `Note` in this column — the artifact draws it
                  that way too — so the note moves down by one field's height.
                  The swap region has a fixed height, so the dialog will not
                  move around it. */}
              {/* `gap-[3px]` is the artifact's `.mfield`. */}
              <label className="flex flex-col gap-[3px] text-xs font-medium">
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
              {candidates.map((candidate) => {
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
                          {partyBeds(party)}
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
