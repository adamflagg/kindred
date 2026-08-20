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
import { placementCandidates } from './placementCandidates'
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
  return [
    bathroom !== 'none' && bathroom !== 'unknown' ? 'bathroom' : null,
    unit.has_power === true ? 'power' : null,
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
  occupants: number
): string {
  const capacity = effectiveSleeps(unit, units)
  if (capacity === null) return 'Capacity not recorded'
  if (occupants > capacity) {
    return `Over capacity — ${String(occupants)} placed, sleeps ${String(capacity)}`
  }
  return `${String(capacity - occupants)} of ${String(capacity)} beds free`
}

export function AssignFamilyModal({
  isOpen,
  onClose,
  unit,
  parties,
  units = [],
  occupants,
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

  const header = (
    <div className="border-border border-b px-6 py-4 pr-14">
      <h2 className="truncate text-lg font-bold">{`Assign to ${unit.name}`}</h2>
      <p data-testid="assign-capacity" className="text-muted-foreground mt-0.5 text-xs">
        {[capacitySentence(unit, units, occupants), ...amenityWords(unit)].join(' · ')}
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
            goes. Its own scroller, so a long queue never moves the input or
            the footer. */}
        <div className="max-h-80 overflow-y-auto">
          {offersWriteIn ? (
            <div data-testid="write-in-region" className="flex flex-col gap-3 py-1">
              <p className="text-muted-foreground text-sm">
                {`No family matches “${trimmed}” — this will be written in.`}
              </p>
              {/* kindred#2503's `People` field belongs HERE, beside the note.
                  It is not built: `lodging_write_ins` has `occupant_name` and
                  `note` and nowhere to put a count, and a field with no
                  destination is worse than an absent one. When #2503 lands it
                  slots in beside `Note` without moving anything. */}
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
            <div role="listbox" aria-label={`Families to place in ${unit.name}`}>
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
                    /* A REAL TAB STOP, unlike the inline picker's rows.
                       There, ~82 mounted lists meant every row was a stop and
                       Tabbing off a card walked staff through the whole queue;
                       here the list is inside a focus-trapped dialog and is
                       the only one on screen. It is also what keeps a keyboard
                       path open while `Enter` in the search box stays inert. */
                    className="hover:bg-muted focus-visible:bg-muted flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left focus-visible:outline-none disabled:opacity-40"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                        {partyIdentityLabel(party)}
                      </span>
                      <span className="text-muted-foreground inline-flex flex-shrink-0 items-center gap-0.5 text-xs tabular-nums">
                        <Users className="h-3 w-3" />
                        {partyBeds(party)}
                      </span>
                      {/* ⚠️ `insideControl` IS LOAD-BEARING HERE, not a style
                          flag. This row IS a `<button>` that places the family,
                          and a `ui/Tooltip` trigger is a `<button>` too — so
                          the default mark nested one control inside another
                          and a click on a glyph silently placed the family and
                          closed the modal. `NeedGlyph.tsx` carries the full
                          account and the rule it comes from (kindred#2222). */}
                      <span className="flex flex-shrink-0 items-center gap-1">
                        {glyphs.map((glyph) => (
                          <NeedGlyphMark key={glyph.key} glyph={glyph} insideControl />
                        ))}
                      </span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      {/* What no glyph can say. A note repeating an unmet need
                          would state one fact twice, which is the reason
                          `No private bathroom` was struck from the family card
                          (N2) — so `placementCandidates` emits capacity alone. */}
                      <span
                        className={`min-w-0 flex-1 truncate text-xs ${
                          candidate.notes.length > 0
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {candidate.notes.length > 0
                          ? candidate.notes.join(' · ')
                          : candidate.fit === 'fits'
                            ? 'fits'
                            : ''}
                      </span>
                      {lastYearCabin.length > 0 && (
                        <span className="text-muted-foreground flex-shrink-0 text-xs whitespace-nowrap">
                          {lastYearCabin}
                        </span>
                      )}
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
