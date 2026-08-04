/**
 * One placeable party.
 *
 * Family camp: CampMinder enrols only the CHILDREN, so the adults come from
 * the scraped `family_camp_adults` table and the party is a household.
 * Adult weekends: individuals enrol directly, so the party is one person and
 * has no children.
 *
 * The left rail is the page's scanning spine. It is drawn ONLY for parties
 * that need something — a weekend that is fully placed and unconstrained shows
 * no rails at all, so the design tells the truth about the weekend's state
 * instead of decorating every row equally.
 */
import { Clock, Repeat } from 'lucide-react'
import { Fragment } from 'react'

import type {
  AccessibilityFlags,
  LodgingUnitRow,
  RosterPartyRow,
  ShareRequest,
} from '../../types/lodging'
import { AccessibilityFlagList } from './AccessibilityFlagList'
import type { AttentionLevel } from './rosterAttention'
import { partyAttention } from './rosterAttention'
import { ShareRequestPanel } from './ShareRequestPanel'

export interface HouseholdRosterRowProps {
  party: RosterPartyRow
  // No `year`: this row renders chips only. `year` was here to fetch the
  // medical narrative, which moved to FamilyDetailsPanel in kindred#1889.
  /** Adult weekends carry no share requests; the column is dropped entirely. */
  showRequests: boolean
  /** The assigned cabin, when it resolves. Undefined for a merged slot. */
  unit?: LodgingUnitRow | undefined
}

/** An unanswered request, used when the payload omits the block entirely. */
const NO_SHARE_REQUEST: ShareRequest = {
  preference: 'unknown',
  preference_raw: '',
  proximity: [],
  request_text: '',
  needs_resolution: false,
}

const NO_FLAGS: AccessibilityFlags = {
  needs_private_bathroom: false,
  needs_power: false,
  needs_accommodation: false,
  accommodation_is_mandatory: false,
  has_infant: false,
}

/** Settled parties get no rail — absence is the signal. */
const RAIL: Record<AttentionLevel, string> = {
  required: 'border-red-500',
  unmet: 'border-red-500',
  unplaced: 'border-amber-500',
  unverified: 'border-sky-400 dark:border-sky-500',
  settled: 'border-transparent',
}

const REASON_TONE: Record<AttentionLevel, string> = {
  required: 'text-red-700 dark:text-red-400',
  unmet: 'text-red-700 dark:text-red-400',
  unplaced: 'text-amber-700 dark:text-amber-400',
  unverified: 'text-muted-foreground',
  settled: '',
}

function composition(party: RosterPartyRow): string {
  const adults = party.adults?.length ?? 0
  const children = party.children?.length ?? 0
  const parts: string[] = [`${String(adults)} adult${adults === 1 ? '' : 's'}`]
  if (children > 0) {
    parts.push(`${String(children)} child${children === 1 ? '' : 'ren'}`)
  }
  return parts.join(' · ')
}

export function HouseholdRosterRow({ party, showRequests, unit }: HouseholdRosterRowProps) {
  const isAssigned = (party.unit_name ?? '').length > 0
  const attention = partyAttention(party, unit)
  const adults = party.adults ?? []
  const children = party.children ?? []
  const showAdults = party.grain === 'household'

  return (
    <tr className="border-border/40 hover:bg-muted/30 border-b align-top transition-colors">
      <td className={`border-l-[3px] py-3 pr-4 pl-3 ${RAIL[attention.level]}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-foreground text-sm font-semibold">{party.display_name}</span>
          {party.is_returning === true && (
            <span
              title="Stayed with us before"
              className="text-forest-700 dark:text-forest-300 bg-forest-100 dark:bg-forest-900/50 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              <Repeat className="h-3 w-3 flex-shrink-0" />
              Returning
            </span>
          )}
        </div>
        {/* Only the two states that name a real failure get words. "No cabin
            yet" would repeat the Cabin column's "Unassigned", and an
            unverified need would repeat the chips under Housing needs — the
            rail and the section heading already carry the state. */}
        {(attention.level === 'required' || attention.level === 'unmet') && (
          <p className={`mt-0.5 text-xs font-medium ${REASON_TONE[attention.level]}`}>
            {attention.level === 'required' ? 'Accommodation required' : attention.reason}
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-xs tabular-nums">{composition(party)}</p>
        {/* Members are reference detail, not scanning material — one wrapped
            line rather than two stacked ones, so 62 rows stay a page. An
            adult weekend enrols the individual directly, so the party IS the
            adult and `display_name` above already named them. */}
        <p className="text-muted-foreground/75 mt-0.5 text-xs leading-snug">
          {showAdults &&
            adults.map((adult, index) => (
              <Fragment
                key={`${String(adult.adult_number ?? index)}-${String(adult.display_name)}`}
              >
                {index > 0 && ', '}
                {/* Each name is its own element so it stays one text node —
                    a separator inside the span would split it. */}
                <span>{adult.display_name}</span>
              </Fragment>
            ))}
          {children.map((child, index) => (
            <Fragment key={String(child.person_cm_id ?? index)}>
              {(index > 0 || (showAdults && adults.length > 0)) && ' · '}
              <span>
                {child.age === null || child.age === undefined
                  ? child.display_name
                  : `${String(child.display_name)} (${String(child.age)})`}
              </span>
            </Fragment>
          ))}
        </p>
      </td>

      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm ${isAssigned ? 'text-foreground font-medium' : 'text-muted-foreground italic'}`}
          >
            {isAssigned ? party.unit_name : 'Unassigned'}
          </span>
          {party.is_merged_slot === true && (
            <span
              title="Two rooms combined into one slot"
              className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              Merged
            </span>
          )}
        </div>
        {(party.arrival_eta ?? '').length > 0 && (
          <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {party.arrival_eta}
          </p>
        )}
      </td>

      {showRequests && (
        <td className="py-3 pr-4">
          <ShareRequestPanel share={party.share ?? NO_SHARE_REQUEST} />
        </td>
      )}

      <td className="py-3 pr-3">
        {/* Chips only. The medical narrative is `FamilyDetailsPanel`'s, one
            household at a time — see MedicalNarrative (kindred#1889). */}
        <AccessibilityFlagList flags={party.flags ?? NO_FLAGS} />
      </td>
    </tr>
  )
}
