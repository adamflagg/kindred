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
import { useMemo, useState } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { Modal } from '../ui/Modal'
import { partyIdentityLabel, partySearchText } from './householdIdentity'
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
function fitVerdict(candidate: PlacementCandidate): string {
  if (candidate.notes.length > 0) return candidate.notes.join(' · ')
  if (candidate.fit === 'fits') return 'fits'
  // "some rooms only" for a partial, "does not fit" for an unmet need. The
  // glyph says WHICH need; this says how the room answers it overall.
  return candidate.fit === 'partial' ? 'partial fit' : 'does not fit'
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
  const candidates = useMemo(
    () =>
      placementCandidates(parties, unit, units).filter(
        (candidate) =>
          needle === '' || partySearchText(candidate.party).toLowerCase().includes(needle)
      ),
    [parties, unit, units, needle]
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
  const header = (
    <div className="border-border flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-6 py-4 pr-14">
      <h2 className="min-w-0 truncate text-lg font-bold">{`Assign to ${unit.name}`}</h2>
      <p data-testid="assign-capacity" className="text-muted-foreground text-xs">
        {[capacitySentence(unit, units, occupants, spanWidth), ...amenityWords(unit)].join(' · ')}
      </p>
    </div>
  )

  const footer = (
    <div className="border-border text-muted-foreground flex items-center gap-3 border-t px-6 py-3 text-xs">
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
      noPadding
      size="lg"
    >
      <div className="flex flex-col gap-3 px-6 py-4">
        {/* THE ONE LIVE INPUT, and it is also the occupant name. It is never
            disabled by the flip and never remounted by it — it is rendered
            outside the swap region below precisely so React keeps the same
            node, and with it the focus and the caret, straight through the
            moment the last match disappears. */}
        <input
          type="search"
          value={query}
          disabled={isSaving}
          // The modal exists to be typed into: opening it and then asking for
          // a click before a keystroke lands is the friction it removes. It is
          // also inside `ui/Modal`'s focus trap, which restores focus to the
          // pill on close.
          autoFocus
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
          className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
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
          className="border-border h-80 overflow-y-auto border-t border-dashed pt-2"
        >
          {offersWriteIn ? (
            <div data-testid="write-in-region" className="flex flex-col gap-3 py-1">
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
              <label className="flex flex-col gap-1 text-xs font-medium">
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
                  className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 rounded-md border px-2 py-1.5 text-sm font-normal focus:ring-2 focus:outline-none"
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
              className="flex flex-col gap-1"
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
                     * ONE LINE, AND A DRAWN RECTANGLE — the artifact's `.crow`
                     * (`display:flex; align-items:center; gap:6px; border:1px;
                     * border-radius:8px; padding:5px 7px; background`).
                     *
                     * It was two stacked lines with no border, so the rows ran
                     * together as text and each cost 54px against the
                     * artifact's 33px — about 5.9 rows visible in the scroller
                     * where the artifact fits 9.7. A list you scan for one
                     * family wants rows you can count.
                     *
                     * A REAL TAB STOP, unlike the inline picker's rows. There,
                     * ~82 mounted lists meant every row was a stop; here the
                     * list is inside a focus-trapped dialog and is the only one
                     * on screen. It is also what keeps a keyboard path open
                     * while `Enter` in the search box stays inert.
                     */
                    className="border-border hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-sm focus-visible:outline-none disabled:opacity-40"
                  >
                    {/* The artifact's order, and it is the scan order: who they
                        are, how many, what they asked for, where they were,
                        how this room answers. */}
                    <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                      {partyIdentityLabel(party)}
                    </span>
                    <span className="text-muted-foreground inline-flex flex-shrink-0 items-center gap-0.5 text-xs tabular-nums">
                      <Users className="h-3 w-3" />
                      {partyBeds(party)}
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      {glyphs.map((glyph) => (
                        <NeedGlyphMark key={glyph.key} glyph={glyph} insideControl />
                      ))}
                    </span>
                    {lastYearCabin.length > 0 && (
                      <span className="text-muted-foreground flex-shrink-0 text-xs whitespace-nowrap">
                        {lastYearCabin}
                      </span>
                    )}
                    {/* Stated for every row — see `fitVerdict`. Capacity is the
                        only dimension that still spends words, because no glyph
                        carries it. */}
                    <span
                      className={`flex-shrink-0 text-xs whitespace-nowrap ${
                        candidate.fit === 'fits'
                          ? 'text-muted-foreground'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {fitVerdict(candidate)}
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
