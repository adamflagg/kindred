/**
 * The board's atom: a household party of mixed ages.
 *
 * NOT a camper. The summer board's `CamperCard` sits inside a tall bunk column
 * beside 10–14 siblings-in-cabin; this sits alone, or beside one other party,
 * in a room. The topology differs as much as the domain does, which is why
 * this is a new component rather than a branch inside the 849-line
 * `BunkingBoardByArea.tsx`.
 *
 * ## Three things stay OFF this card (spec §3.8), each measured
 *
 * - **Request text.** 12 of 232 request texts contain health vocabulary
 *   including a named diagnosis. HANDOFF §8 accepted that exposure on the
 *   roster, where you open ONE row to read ONE household; printing it across
 *   62 simultaneously-visible cards is a materially louder exposure than that
 *   decision covered. It lives on `FamilyDetailsPanel`, one click away —
 *   which is what makes this a deferral rather than a loss.
 * - **The medical affordance.** `has_medical_narrative` was true for 62 of 62
 *   parties. A flag that is always on is not a flag — kindred#1889 agreed and
 *   deleted it; the narrative itself lives on `FamilyDetailsPanel`.
 * - **`needs_resolution`.** True for 44 of 62. Same reason.
 *
 * `FamilyCard.test.tsx` pins all three as ABSENCES, because each is exactly
 * the kind of thing a later session adds back helpfully.
 *
 * What IS here: the household name, the party size, the children with their
 * ages — ages are the entire point of a "similar ages" match — and the housing
 * chips the fit check actually judges.
 */
import { useDraggable } from '@dnd-kit/core'
import { Repeat, Users } from 'lucide-react'
import { Fragment } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { SHARE_WORDING, shareWordingChip } from './boardLayout'
import { partyKey } from './partyKey'
import { ATTENTION_LABEL, partyAttention } from './rosterAttention'

export interface FamilyCardProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined while unplaced. */
  unit?: LodgingUnitRow | undefined
  /**
   * Whether another party is in the same room. Declining to share is the
   * ordinary answer and contradicts nothing on its own — it only becomes
   * worth saying when somebody else is in the room (spec §11).
   */
  sharedSlot?: boolean
  /**
   * The card is in the unplaced queue rather than in a slot on the board.
   * Purely a surface choice: the popover's own background is already the
   * page's, so a card inside it needs `bg-card` to read as a card at all,
   * where one sitting in a slot needs `bg-background` to read as distinct
   * from the slot around it.
   */
  inQueue?: boolean
  /**
   * Whether this card can be picked up — true only inside a scenario, for a
   * user holding `bunking.manage`. See `LodgingBoard`.
   *
   * The drag id is derived here rather than passed in, so it cannot disagree
   * with the id `resolveDrop` looks the party back up by.
   */
  isDraggable?: boolean
  onOpen: (party: RosterPartyRow) => void
}

type ChipTone = 'need' | 'warn' | 'share' | 'quiet' | 'muted'

const CHIP_TONE: Record<ChipTone, string> = {
  need: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  warn: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  share: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  quiet: 'border-border text-muted-foreground border border-dashed',
  muted: 'bg-muted text-muted-foreground',
}

function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CHIP_TONE[tone]}`}
    >
      {label}
    </span>
  )
}

/** How many people the party brings. */
function partySize(party: RosterPartyRow): number {
  const reported = party.party_size ?? 0
  if (reported > 0) return reported
  return (party.adults?.length ?? 0) + (party.children?.length ?? 0)
}

/**
 * Everything the card SHOWS, with nothing about how it is picked up.
 *
 * Split out so the drag overlay can render the card without dnd-kit — see
 * `FamilyCardPreview`. Sharing the body rather than hand-rolling a second one
 * is the only reason the overlay cannot drift away from the real card.
 */
function FamilyCardBody({
  party,
  unit,
  sharedSlot,
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot: boolean
}) {
  const flags = party.flags ?? {}
  const children = party.children ?? []
  const attention = partyAttention(party, unit)
  const proximity = party.share?.proximity ?? []
  // `similar_ages` ACCOMPANIES `with`; it never replaces it. One chip covering
  // both is what keeps 22 households from dropping out of a "wants to share"
  // view — a chip showing one *or* the other loses them.
  const wantsToShare = proximity.includes('with') || proximity.includes('similar_ages')
  const wantsNear = proximity.includes('near')

  return (
    <>
      <span className="flex items-baseline gap-1.5">
        <span
          data-testid="family-card-name"
          className="text-foreground text-sm leading-tight font-semibold"
        >
          {party.display_name}
        </span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-0.5 text-xs tabular-nums">
          <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          {partySize(party)}
        </span>
      </span>

      {children.length > 0 && (
        <span className="text-muted-foreground text-xs leading-snug">
          {children.map((child, index) => (
            <Fragment key={String(child.person_cm_id ?? index)}>
              {index > 0 && ' · '}
              {/* An age we do not have is omitted, never rendered as 0. */}
              <span>
                {child.age === null || child.age === undefined
                  ? child.display_name
                  : `${String(child.display_name)} (${String(child.age)})`}
              </span>
            </Fragment>
          ))}
        </span>
      )}

      <span className="flex flex-wrap gap-1">
        {/* The needs a cabin field can actually answer — the same two the fit
            check judges. `needs_accommodation` names no specific amenity, so
            it is carried by the verdict chip below instead of duplicated. */}
        {flags.needs_private_bathroom === true && <Chip label="Private bathroom" tone="need" />}
        {flags.needs_power === true && <Chip label="Power" tone="need" />}

        {attention.level === 'required' && <Chip label={ATTENTION_LABEL.required} tone="warn" />}
        {attention.level === 'unmet' && <Chip label={attention.reason} tone="warn" />}
        {attention.level === 'unverified' && (
          <Chip label={ATTENTION_LABEL.unverified} tone="quiet" />
        )}

        {/* Keyed off the RESOLVED verdict, not the registration gate. The gate
            is superseded wherever the Family Camp form answered, so a household
            that said no at registration and then named a partner is legitimately
            placed — chipping it "declined" repeats at card level exactly the
            false positive the slot flag was moved off the gate to avoid.
            Wording matches the slot: the form has no refusal option. */}
        {sharedSlot && party.share?.eligibility === 'declined' && (
          <Chip label={shareWordingChip(SHARE_WORDING.declined)} tone="warn" />
        )}
        {/* 16 households for 2026 carry disagreeing answers. Shown on the card
            as well as the slot, so a party sitting alone still surfaces one. */}
        {party.share?.answers_conflict === true && (
          <Chip label={shareWordingChip(SHARE_WORDING.conflict)} tone="warn" />
        )}
        {wantsToShare && <Chip label="Wants to share" tone="share" />}
        {/* NEAR and WITH are different requests: NEAR is satisfied by map
            distance between units, WITH by putting both in one room. */}
        {wantsNear && <Chip label="Near another family" tone="muted" />}

        {party.is_returning === true && (
          <span className="text-forest-700 dark:text-forest-300 inline-flex items-center gap-0.5 text-xs font-semibold">
            <Repeat className="h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
            Returning
          </span>
        )}
      </span>
    </>
  )
}

/** The card's own frame, shared by the real card and the drag overlay. */
const CARD_FRAME =
  'group border-border flex w-full flex-col gap-1 rounded-lg border px-2 py-1.5 text-left'

export function FamilyCard({
  party,
  unit,
  sharedSlot = false,
  inQueue = false,
  isDraggable = false,
  onOpen,
}: FamilyCardProps) {
  // `disabled` does NOT prevent registration — dnd-kit registers the node in
  // `draggableNodes` unconditionally and `disabled` only nulls the listeners
  // (verified in @dnd-kit/core 6.3.1). What gates the interaction is the
  // conditional spread below, which four tests pin. `disabled` is kept for
  // the `aria-disabled` it sets and as a second refusal to hand back
  // listeners.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: partyKey(party),
    disabled: !isDraggable,
  })

  return (
    <button
      type="button"
      data-family-card
      ref={setNodeRef}
      // Spread ONLY when draggable. dnd-kit sets `aria-roledescription` and
      // the rest regardless of its own `disabled` flag, so a read-only board
      // would announce every card as draggable to a screen reader and offer a
      // keyboard drag that goes nowhere.
      {...(isDraggable ? attributes : {})}
      {...(isDraggable ? listeners : {})}
      onClick={() => {
        onOpen(party)
      }}
      className={`${CARD_FRAME} hover:border-primary/50 focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none ${
        inQueue ? 'bg-card' : 'bg-background'
      } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''} ${
        // The card stays mounted and dimmed rather than being removed: the
        // grid would reflow under the pointer mid-drag, moving every other
        // drop target out from under it.
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <FamilyCardBody party={party} unit={unit} sharedSlot={sharedSlot} />
    </button>
  )
}

/**
 * The card as it appears under the pointer, inside `<DragOverlay>`.
 *
 * IT MUST NOT CALL `useDraggable`, and that is the whole reason it exists.
 * dnd-kit registers a draggable node unconditionally — `disabled` does not
 * stop it — so rendering a real `FamilyCard` here would register a SECOND
 * draggable under the same `partyKey`, overwrite the source card's entry in
 * `draggableNodes`, and then delete that entry outright when the overlay
 * unmounts. The card the staff member just dropped would be gone from the
 * registry, and its own effect never re-fires.
 *
 * Summer reached the same conclusion first and hand-rolls plain markup in its
 * DragOverlay (`BunkingBoardByArea.tsx:662-702`) rather than reusing its
 * draggable `CamperCard`. This shares the body instead of copying it, so the
 * overlay cannot drift away from the card it represents.
 */
export function FamilyCardPreview({
  party,
  unit,
  sharedSlot = false,
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot?: boolean
}) {
  return (
    <div className={`${CARD_FRAME} bg-card shadow-lodge-lg border-primary/50 rotate-2`}>
      <FamilyCardBody party={party} unit={unit} sharedSlot={sharedSlot} />
    </div>
  )
}
