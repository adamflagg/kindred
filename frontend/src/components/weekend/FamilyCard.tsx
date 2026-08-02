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
 * - **The medical affordance.** `has_medical_narrative` is true for 62 of 62
 *   parties. A flag that is always on is not a flag.
 * - **`needs_resolution`.** True for 44 of 62. Same reason.
 *
 * `FamilyCard.test.tsx` pins all three as ABSENCES, because each is exactly
 * the kind of thing a later session adds back helpfully.
 *
 * What IS here: the household name, the party size, the children with their
 * ages — ages are the entire point of a "similar ages" match — and the housing
 * chips the fit check actually judges.
 */
import { Repeat, Users } from 'lucide-react'
import { Fragment } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { ATTENTION_LABEL, partyAttention } from './rosterAttention'

export interface FamilyCardProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined on the rail. */
  unit?: LodgingUnitRow | undefined
  /**
   * Whether another party is in the same room. Declining to share is the
   * ordinary answer and contradicts nothing on its own — it only becomes
   * worth saying when somebody else is in the room (spec §11).
   */
  sharedSlot?: boolean
  /** Rail cards sit on the page background rather than inside a slot. */
  onRail?: boolean
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
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${CHIP_TONE[tone]}`}
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

export function FamilyCard({
  party,
  unit,
  sharedSlot = false,
  onRail = false,
  onOpen,
}: FamilyCardProps) {
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
    <button
      type="button"
      data-family-card
      onClick={() => {
        onOpen(party)
      }}
      className={`group border-border hover:border-primary/50 focus-visible:ring-ring flex w-full flex-col gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
        onRail ? 'bg-card' : 'bg-background'
      }`}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="text-foreground text-[13px] leading-tight font-semibold">
          {party.display_name}
        </span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-0.5 text-[11px] tabular-nums">
          <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          {partySize(party)}
        </span>
      </span>

      {children.length > 0 && (
        <span className="text-muted-foreground text-[11px] leading-snug">
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
          <Chip label="Did not request sharing" tone="warn" />
        )}
        {/* 16 households for 2026 carry disagreeing answers. Shown on the card
            as well as the slot, so a party sitting alone still surfaces one. */}
        {party.share?.answers_conflict === true && <Chip label="Answers disagree" tone="warn" />}
        {wantsToShare && <Chip label="Wants to share" tone="share" />}
        {/* NEAR and WITH are different requests: NEAR is satisfied by map
            distance between units, WITH by putting both in one room. */}
        {wantsNear && <Chip label="Near another family" tone="muted" />}

        {party.is_returning === true && (
          <span className="text-forest-700 dark:text-forest-300 inline-flex items-center gap-0.5 text-[10px] font-semibold">
            <Repeat className="h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
            Returning
          </span>
        )}
      </span>
    </button>
  )
}
