/**
 * One placeable party.
 *
 * Family camp: CampMinder enrols only the CHILDREN, so the adults come from
 * the scraped `family_camp_adults` table and the party is a household.
 * Adult weekends: individuals enrol directly, so the party is one person and
 * has no children.
 */
import { Clock, Repeat } from 'lucide-react'

import type { AccessibilityFlags, RosterPartyRow, ShareRequest } from '../../types/lodging'
import { AccessibilityFlagList } from './AccessibilityFlagList'
import { ShareRequestPanel } from './ShareRequestPanel'

export interface HouseholdRosterRowProps {
  party: RosterPartyRow
  year: number
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
  has_medical_narrative: false,
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

export function HouseholdRosterRow({ party, year }: HouseholdRosterRowProps) {
  const isAssigned = party.unit_name !== undefined && party.unit_name.length > 0
  const unitLabel = isAssigned ? party.unit_name : 'Unassigned'

  return (
    <tr className="border-border/50 border-b align-top">
      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{party.display_name}</span>
          {party.is_returning === true && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
              <Repeat className="h-3 w-3" />
              Returning
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{composition(party)}</p>
        {/* An adult weekend enrols the individual directly, so the party IS
            the adult and `display_name` above already named them. Repeating
            the roster would print the same name twice. */}
        {party.grain === 'household' && (
          <p className="text-muted-foreground mt-1 text-xs">
            {(party.adults ?? []).map((adult) => adult.display_name).join(', ')}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {(party.children ?? [])
            .map((child) =>
              child.age === null || child.age === undefined
                ? child.display_name
                : `${String(child.display_name)} (${String(child.age)})`
            )
            .join(', ')}
        </p>
      </td>

      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm ${isAssigned ? 'text-foreground font-medium' : 'text-muted-foreground italic'}`}
          >
            {unitLabel}
          </span>
          {party.is_merged_slot === true && (
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
              Merged
            </span>
          )}
        </div>
        {party.arrival_eta !== undefined && party.arrival_eta.length > 0 && (
          <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {party.arrival_eta}
          </p>
        )}
      </td>

      <td className="py-3 pr-4">
        <ShareRequestPanel share={party.share ?? NO_SHARE_REQUEST} />
      </td>

      <td className="py-3">
        <AccessibilityFlagList
          flags={party.flags ?? NO_FLAGS}
          householdCmId={party.household_cm_id ?? 0}
          year={year}
        />
      </td>
    </tr>
  )
}
