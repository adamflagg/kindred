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
 * What IS here: the children lead, bold, with truncated whole-year ages —
 * ages are the entire point of a "similar ages" match — the party size, the
 * attending adults one line down in grey, and the housing chips the fit
 * check actually judges.
 *
 * ## The household salutation is gone, not demoted (kindred#2074)
 *
 * The bold line used to be `party.display_name`, which is CampMinder's
 * `mailing_title` -- a postal salutation, not a party manifest. Measured
 * against 2026's 382 rostered households, it disagreed with the actual adult
 * list on 26.7%, in both directions: naming an adult who wasn't attending,
 * and naming only one adult when two were. A two-directional failure can't
 * be repaired inside the string, so it was deleted rather than sanitised —
 * see the issue for the full accounting. This only applies to household-grain
 * parties: a person-grain party (an adult weekend guest) IS the identity, so
 * its `display_name` stays.
 */
import { useDraggable } from '@dnd-kit/core'
import { Home, Repeat, Star, Users, type LucideIcon } from 'lucide-react'
import { Fragment } from 'react'

import type { LodgingUnitRow, PartyChildRow, RosterPartyRow } from '../../types/lodging'
import { displayCampMinderAge, displayTruncatedAge } from '../../utils/age'
import { partySize, SHARE_WORDING, shareWordingChip } from './boardLayout'
import { attendingAdults as computeAttendingAdults } from './householdIdentity'
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
   * Whether this PLACEMENT — this party's own occupied leaves, not the
   * card it happens to share — covers an entire building (kindred#2008).
   * A household holding a whole building is private in a way no
   * combination of room-level flags conveys; the caller computes this from
   * `boardLayout.ts`'s `wholeBuildingHolders`, never re-derived here.
   */
  holdsWholeBuilding?: boolean
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

type ChipTone = 'need' | 'warn' | 'share' | 'quiet' | 'muted' | 'building'

const CHIP_TONE: Record<ChipTone, string> = {
  need: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  warn: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  share: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  quiet: 'border-border text-muted-foreground border border-dashed',
  muted: 'bg-muted text-muted-foreground',
  // Distinct from `share` (a REQUEST) and `warn` (a problem) — a whole
  // building held is neither, it is a privacy fact staff act on. Distinct
  // from `unitBadges.ts`'s violet "Staff" badge too, so the two never read
  // as the same signal on adjoining cards.
  building: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300',
}

function Chip({
  label,
  tone,
  icon: Icon,
}: {
  label: string
  tone: ChipTone
  /** Optional, e.g. the "Whole building" chip's `Home` — every other chip omits it. */
  icon?: LucideIcon
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${CHIP_TONE[tone]}`}
    >
      {Icon && <Icon className="mr-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />}
      {label}
    </span>
  )
}

/**
 * A party's children as one `Name (age) · Name (age)` run.
 *
 * `FamilyCardBody` renders a child list TWICE — the household bold identity
 * line and the person-grain grey secondary line — and the two differ only in
 * which age formatter they call and what wraps them. Everything else (the key
 * strategy, the separator, the missing-age omission, the blank-name fallback)
 * is one decision each, and each was drifting toward being made in two places:
 * the blank-name fallback had to be hand-applied to both copies in kindred#2074.
 * Shared for the same reason `FamilyCardPreview` shares `FamilyCardBody` —
 * so the copies cannot drift apart (kindred#2153).
 *
 * The caller supplies the wrapper, because the two sites want different ones:
 * the bold line's span is also the non-household branch's, and the grey line's
 * exists only when there are children to put in it.
 *
 * @param formatAge - `displayTruncatedAge` on the bold line (whole years are
 *   the point of a similar-ages match), `displayCampMinderAge` on the grey one.
 */
function ChildList({
  children,
  formatAge,
}: {
  children: PartyChildRow[]
  formatAge: (age: number) => string
}) {
  return (
    <>
      {children.map((child, index) => (
        <Fragment key={String(child.person_cm_id ?? index)}>
          {index > 0 && ' · '}
          {/* An age we do not have is omitted, never rendered as 0.
              A blank name (no first/preferred/last name on file --
              `_person_display_name` has no fallback the way
              `_household_display_name` does) falls back rather than
              leaving this segment, or the whole card when it's the
              only child, with no accessible text at all. */}
          <span>
            {child.age === null || child.age === undefined
              ? child.display_name || 'Unnamed camper'
              : `${child.display_name || 'Unnamed camper'} (${formatAge(child.age)})`}
          </span>
        </Fragment>
      ))}
    </>
  )
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
  holdsWholeBuilding = false,
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot: boolean
  holdsWholeBuilding?: boolean
}) {
  const flags = party.flags ?? {}
  const children = party.children ?? []
  const isHousehold = party.grain === 'household'
  // The filter itself -- family_camp_adults stores adult slots 1-5 as
  // separate rows per household, and a slot with no name on file is not an
  // attending adult, CampMinder leaves it blank rather than omitting the
  // row -- lives in `householdIdentity.ts`, shared with the four non-card
  // surfaces that replaced the salutation with this same list (kindred#2084).
  const attendingAdults = computeAttendingAdults(party)
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
          // `min-w-0 flex-1 truncate` matches summer's CamperCard.tsx, whose
          // equivalent identity line needs it for the same reason: an
          // unbounded name (here, a multi-child concatenation) sits in a flex
          // row against the party-size badge at the end and would otherwise
          // squeeze it rather than wrap or clip.
          className="text-foreground min-w-0 flex-1 truncate text-sm leading-tight font-semibold"
        >
          {isHousehold ? (
            <ChildList children={children} formatAge={displayTruncatedAge} />
          ) : (
            party.display_name
          )}
        </span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-0.5 text-xs tabular-nums">
          <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          {partySize(party)}
        </span>
      </span>

      {isHousehold
        ? attendingAdults.length > 0 && (
            <span className="text-muted-foreground text-xs leading-snug">
              {attendingAdults.map((adult, index) => (
                <Fragment key={String(adult.adult_number ?? index)}>
                  {index > 0 && ' · '}
                  <span>{adult.display_name}</span>
                </Fragment>
              ))}
            </span>
          )
        : // Person-grain (adult weekend) parties are a single guest identified
          // by the bold line above, not a household -- so there is no separate
          // adult list. The old children-with-CampMinder-age line stays for the
          // rare person-grain party that carries children of its own.
          children.length > 0 && (
            <span className="text-muted-foreground text-xs leading-snug">
              <ChildList children={children} formatAge={displayCampMinderAge} />
            </span>
          )}

      <span className="flex flex-wrap gap-1">
        {/* #2008: this PLACEMENT covers every leaf of a building, not merely
            a card it happens to share — see `holdsWholeBuilding`'s doc.
            First in the row: it is a fact about the household's privacy, not
            a need or a warning, and staff scan left-to-right. */}
        {holdsWholeBuilding && <Chip label="Whole building" tone="building" icon={Home} />}
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
        {/* `is_returning` is only ever computed for household-grain parties
            (`_build_household_parties` sets it from `prior_cm_ids`). An
            adult weekend guest is `grain: 'person'`, for which the field is
            never set and arrives as the Pydantic default `false` -- untracked,
            not "no". Gating on grain keeps this badge from calling every
            adult weekend regular a first-timer. */}
        {isHousehold && party.is_returning !== true && (
          <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Star className="h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
            First-time
          </span>
        )}
      </span>
    </>
  )
}

/**
 * The card's own frame, shared by the real card and the drag overlay.
 *
 * `rounded-xl border-2 p-2.5` is `CamperCard`'s geometry exactly (CLAUDE.md
 * §4). At `rounded-lg`, a 1px border and `px-2 py-1.5` this read as a table
 * row sitting inside a card -- the same criticism that opened this whole
 * exercise, one level down.
 *
 * `overflow-hidden` is deliberately NOT copied across. `CamperCard` needs it
 * to clip an absolutely-positioned gradient at its foot; this card has no such
 * element, so the class would be cargo.
 */
const CARD_FRAME =
  'group border-border flex w-full flex-col gap-1 rounded-xl border-2 p-2.5 text-left'

export function FamilyCard({
  party,
  unit,
  sharedSlot = false,
  holdsWholeBuilding = false,
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
      <FamilyCardBody
        party={party}
        unit={unit}
        sharedSlot={sharedSlot}
        holdsWholeBuilding={holdsWholeBuilding}
      />
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
  holdsWholeBuilding = false,
}: {
  party: RosterPartyRow
  unit?: LodgingUnitRow | undefined
  sharedSlot?: boolean
  holdsWholeBuilding?: boolean
}) {
  return (
    <div className={`${CARD_FRAME} bg-card shadow-lodge-lg border-primary/50 rotate-2`}>
      <FamilyCardBody
        party={party}
        unit={unit}
        sharedSlot={sharedSlot}
        holdsWholeBuilding={holdsWholeBuilding}
      />
    </div>
  )
}
