/**
 * Place a family from the space itself (kindred#2080).
 *
 * ## Inline, in the card, in Hold's shape
 *
 * Owner ruling 2026-08-09: option A. This is not a popover and not a second
 * surface — it is a control that lives in the unit card's own badge row,
 * exactly as `UnitAvailabilityControl` does, and it grows the card in place
 * the same way Hold's reason form does. Its children carry `w-full`, so it
 * wraps onto its own line inside that flex row rather than fighting the chips
 * for space; that is the precedent Hold set and the reason the card needed no
 * new layout to host this.
 *
 * ## The list does not exist until somebody asks for it
 *
 * The second half of the ruling, and the half that makes an inline picker
 * affordable at all: **the list is not rendered until the staff member
 * engages the search box.** A card that grew on mount would push its whole
 * grid row down on ~82 cards at once. Engaging one card grows one card.
 *
 * "Engages" means POINTER OR KEYBOARD. A typeahead that only opened on click
 * would be a trap on a board already close to pointer-only, so this opens on
 * focus — which covers a Tab arrival as well as a click — is arrow-navigable,
 * and closes on Escape without letting the key reach the surfaces behind it.
 *
 * It also closes when focus LEAVES, which is the same rule stated from the
 * other end: a card that was Tabbed away from has been abandoned as surely as
 * one clicked away from, and must shrink back. Focus itself never enters the
 * list — the rows are `tabIndex={-1}` and the combobox keeps focus through
 * `aria-activedescendant` — so one Tab leaves the whole control however many
 * families are in it.
 *
 * ## It never hides a family
 *
 * See `placementCandidates.ts` for the arithmetic. Rows are annotated and
 * ordered by fit; nothing is withheld and nothing is refused here. The only
 * refusals on this path are the drag path's own, inherited whole through
 * `resolvePickerPlacement` → `resolveDrop`.
 *
 * The fit annotations live in the LIST ROWS. They deliberately touch none of
 * the card's three ruled signal channels (dim = refusal, hatch = advisory
 * misfit, forest tint = open), and draw no ring — kindred#2179 struck the last
 * one an hour before this was written.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { partyIdentityLabel, partySearchText } from './householdIdentity'
import { partyKey } from './partyKey'
import { placementCandidates } from './placementCandidates'
import { partyBeds } from './rosterAttention'

export interface PlaceFamilyPickerProps {
  /** The card this control is mounted on. */
  unit: LodgingUnitRow
  /**
   * Every UNPLACED party, exactly as the queue holds them. NEVER pre-filtered
   * by fit — that is the ruling, not a caller convenience.
   */
  parties: RosterPartyRow[]
  /**
   * The whole registry. Needed only to total a combined house's capacity;
   * `[]` is correct for every leaf card.
   */
  units?: LodgingUnitRow[]
  onSelect: (party: RosterPartyRow) => void
  /**
   * Record a name that is not a registered family — the write-in
   * (owner ruling, 2026-08-18).
   *
   * The card used to carry a SECOND typeable box for this, on the availability
   * strip, so every tile asked "who is sleeping here" twice and staff had to
   * choose a control before they knew which kind of answer they had. One box
   * answers both: a family if one matches, a written-in name if none does.
   *
   * Optional, and the offer is absent when it is: a caller with no write path
   * (read-only staff) must not be shown an affordance it cannot honour.
   */
  onWriteIn?: (occupantName: string) => void
  /**
   * True while a write THIS card started is in flight.
   *
   * Inherited from the strip button this box replaced: 81 cards share one
   * mutation, so the gate has to be per-card or one cabin's write freezes the
   * board. It matters more here than it did on a button — a combobox invites
   * a staff member to keep typing, and a second write-in submitted against an
   * unsettled first is a duplicate nobody asked for.
   */
  isSaving?: boolean
}

/**
 * Notes are advisory, so they get the board's advisory ink rather than its
 * destructive red — an over-capacity placement is permitted and routinely
 * made. `partial` stays muted: "some rooms have power" is a qualification, not
 * a warning.
 */
const NOTE_TONE: Record<'partial' | 'unmet', string> = {
  unmet: 'text-amber-700 dark:text-amber-400',
  partial: 'text-muted-foreground',
}

export function PlaceFamilyPicker({
  unit,
  parties,
  units = [],
  onSelect,
  onWriteIn,
  isSaving = false,
}: PlaceFamilyPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** -1 is "no row active", which is the state Enter must do nothing in. */
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Unique per mounted card. ~82 of these can be on the board at once, and
  // `aria-activedescendant` points at an id — a shared one would aim every
  // card's screen reader at the first card's rows.
  const baseId = useId()
  const listId = `${baseId}-list`

  /**
   * Shut, and forget which row was active.
   *
   * Both halves, always. A dismissal that dropped `open` but left
   * `activeIndex` would leave `aria-activedescendant` naming a row that no
   * longer exists — the next thing a screen reader would try to announce.
   */
  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node) === true) return
      close()
    }
    document.addEventListener('mousedown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
    }
  }, [open, close])

  /*
   * The active row follows the arrows THROUGH the scroller.
   *
   * The list is `max-h-48` — about five rows — over a queue that ran to 63
   * unplaced parties on the 2026 weekend, so without this the highlight walks
   * off the bottom on the sixth ArrowDown and the keyboard user is steering
   * something they cannot see. `block: 'nearest'` scrolls the list only when
   * the row is actually out of view, and never moves the page.
   */
  useEffect(() => {
    if (activeIndex < 0) return
    document.getElementById(`${baseId}-${String(activeIndex)}`)?.scrollIntoView({
      block: 'nearest',
    })
  }, [activeIndex, baseId])

  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  // Annotated and ordered FIRST, then narrowed by what the staff member
  // typed. The typed filter is the user's own; it is not a fit gate, and it
  // is the only thing that ever removes a row.
  //
  // Memoised because ~82 of these are mounted at once and every one of them
  // holds the WHOLE unplaced queue: recomputed on each render, one board
  // re-render (a drag starting, a panel opening) would re-annotate and re-sort
  // that queue eighty-two times over. `parties` is `board.unplaced` and
  // `units` the registry, both already memo-stable in `LodgingBoard`.
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
   *                    is most likely still typing toward it, and stealing
   *                    Enter from a visible row would place the wrong thing.
   *                    The ruling says it in those words: "if they type
   *                    something, and it has no matches and they hit enter".
   *
   * Consequence worth stating: a name that happens to match a family's search
   * text can never become a write-in from this box. That is the right trade —
   * the far more common mistake is writing in somebody who IS registered — and
   * an extra distinguishing word reaches the offer.
   */
  const offersWriteIn = onWriteIn !== undefined && trimmed !== '' && candidates.length === 0

  /**
   * Whether this card can place a family at all.
   *
   * FALSE on the CampMinder mirror, where there is no scenario: recording who
   * is sleeping in a cabin is a fact about the weekend, not about a plan, so
   * the write-in half stays live where the placement half cannot be. The
   * caller passes an empty queue in that case rather than a second flag.
   */
  const placementLive = parties.length > 0 || onWriteIn === undefined
  const placeLabel =
    onWriteIn === undefined
      ? `Place a family in ${unit.name}`
      : `Place a family in ${unit.name}, or write in a name`

  const choose = (party: RosterPartyRow) => {
    onSelect(party)
    setQuery('')
    close()
  }

  const writeIn = () => {
    if (!offersWriteIn || onWriteIn === undefined) return
    // The TRIMMED text, which is what the offer row shows. Staff type into a
    // search box and a trailing space is a typing artefact, not a name.
    onWriteIn(trimmed)
    setQuery('')
    close()
  }

  // CORRECT AS-IS, no overlay token (kindred#2237). This is a React SYNTHETIC
  // handler bound to the combobox input, not a document listener: it only ever
  // fires while that input holds focus, and the control closes on blur, so an
  // overlay opening on top takes focus and this stops firing on its own. It
  // also sits on the weekend roster alongside `FamilyDetailsPanel`, which
  // stands down for anything in the token stack -- so a token here would make
  // that panel yield Escape to a combobox, the same regression documented on
  // `LodgingMap` above.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (!open) return
      // The board and its detail panel both close on Escape. Dismissing this
      // list must not also dismiss the surface it is sitting in.
      event.stopPropagation()
      event.preventDefault()
      close()
      inputRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, candidates.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => (index <= 0 ? candidates.length - 1 : index - 1))
      return
    }
    if (event.key === 'Enter') {
      // Never a submit: this control can be mounted inside a release form.
      event.preventDefault()
      if (offersWriteIn) {
        writeIn()
        return
      }
      const chosen = candidates[activeIndex]
      if (chosen !== undefined) choose(chosen.party)
    }
  }

  const activeId =
    activeIndex >= 0 && activeIndex < candidates.length
      ? `${baseId}-${String(activeIndex)}`
      : undefined

  return (
    <div
      ref={containerRef}
      className="flex w-full flex-col gap-1"
      /*
       * Focus leaving the control closes it, and that is the other half of
       * "the card only grows while somebody is using it". Dismissal on an
       * outside MOUSEDOWN alone leaves a card that was Tabbed away from
       * standing open — grown, and holding a listbox nobody is looking at.
       *
       * `relatedTarget` is where focus WENT: `null` (focus fell to the body)
       * and anything outside this container both count as leaving. A click on
       * a row never gets here — the row's `onMouseDown` keeps focus on the
       * combobox precisely so it does not.
       */
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        close()
      }}
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        // Named for the cabin, exactly as Hold's own button is: ~82 controls
        // all called "Place a family" is unusable with a screen reader.
        // NAMED FOR WHAT THIS CARD CAN ACTUALLY DO, which is not always both.
        // On the CampMinder mirror there is no scenario, so nothing can be
        // placed and the box is a write-in box only — calling it "Place a
        // family" there would name an action the staff member cannot take.
        aria-label={placementLive ? placeLabel : `Write in an occupant for ${unit.name}`}
        placeholder={
          placementLive
            ? onWriteIn === undefined
              ? 'Place a family…'
              : 'Place a family, or write in…'
            : 'Write in a name…'
        }
        value={query}
        disabled={isSaving}
        aria-expanded={open}
        aria-autocomplete="list"
        // Unconditional, though the listbox only exists while open: the
        // combobox role REQUIRES it (jsx-a11y/role-has-required-aria-props),
        // and a reference to a not-yet-rendered id is the standard combobox
        // shape rather than a dangling pointer.
        aria-controls={listId}
        {...(activeId === undefined ? {} : { 'aria-activedescendant': activeId })}
        onFocus={() => {
          setOpen(true)
        }}
        onClick={() => {
          setOpen(true)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          // The row that was active is not the row that is active now — the
          // list under it just changed. Enter on a stale index would place a
          // family the staff member is no longer looking at.
          setActiveIndex(-1)
        }}
        onKeyDown={onKeyDown}
        // Hold's reason input, to the class. Same control, same card, same
        // shape (CLAUDE.md §4).
        className="border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/10 w-full rounded-md border px-1.5 py-1 text-sm focus:ring-2 focus:outline-none"
      />

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={`Families to place in ${unit.name}`}
          className="border-border bg-background max-h-48 overflow-y-auto rounded-md border"
        >
          {offersWriteIn ? (
            /* The one row an empty result offers, rather than a dead end.
               `role="option"` and `aria-selected` because it IS the listbox's
               only option here — Enter acts on it without an arrow press, so
               saying it is selected is the truth rather than a decoration. */
            <button
              type="button"
              role="option"
              aria-selected={true}
              tabIndex={-1}
              data-testid="write-in-offer"
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={writeIn}
              className="bg-muted flex w-full flex-col gap-0.5 px-2 py-1.5 text-left text-sm"
            >
              <span className="truncate">{`Write in "${trimmed}"`}</span>
              {/* Both halves of what just happened: no family matched, and
                  this records a name instead. The muted key is the list's own
                  advisory ink, not a warning — writing somebody in is an
                  ordinary act, not a fallback from a failure. */}
              <span className="text-muted-foreground text-xs">
                No family matches — records who is in this space
              </span>
            </button>
          ) : parties.length === 0 ? (
            /* Nothing left to place. `FloatingUnplacedBadge` already says this
               over the same parties — one state, one sentence.

               BELOW the write-in offer, deliberately: on the CampMinder mirror
               there is no scenario and therefore no placement queue at all, so
               this branch is the one an unfiltered box lands on. Above the
               offer it would tell a staff member "everyone has a cabin" while
               swallowing the name they had just typed. */
            <p className="text-muted-foreground px-2 py-3 text-center text-sm italic">
              Everyone has a cabin.
            </p>
          ) : candidates.length === 0 ? (
            /* A typo, not a fit verdict. `FloatingQueueBadge`'s own wording,
               in the same "parties" vocabulary an adult weekend needs. Only
               reachable where the caller offers no write-in path; otherwise
               the offer row above says the same thing and gives it somewhere
               to go. */
            <p className="text-muted-foreground px-2 py-3 text-center text-sm">
              {`No parties match "${trimmed}"`}
            </p>
          ) : (
            candidates.map((candidate, index) => (
              <button
                key={partyKey(candidate.party)}
                id={`${baseId}-${String(index)}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                // Out of the tab order, because `aria-activedescendant` means
                // focus never leaves the combobox. A `<button>` is a tab stop
                // by default, so without this every row is one: Tabbing off a
                // card would walk the staff member through all 63 unplaced
                // parties first, on each of ~82 cards.
                tabIndex={-1}
                data-fit={candidate.fit}
                // Keeps focus on the combobox through the click, so Escape and
                // the arrows still work after a mis-click on a row.
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
                onMouseEnter={() => {
                  setActiveIndex(index)
                }}
                onClick={() => {
                  choose(candidate.party)
                }}
                className={`flex w-full flex-col gap-0.5 px-2 py-1.5 text-left text-sm ${
                  index === activeIndex ? 'bg-muted' : ''
                }`}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate">{partyIdentityLabel(candidate.party)}</span>
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {`${String(partyBeds(candidate.party))} beds`}
                  </span>
                </span>
                {candidate.notes.length > 0 && (
                  <span
                    className={`text-xs ${NOTE_TONE[candidate.fit === 'unmet' ? 'unmet' : 'partial']}`}
                  >
                    {candidate.notes.join(' · ')}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
