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
import { Clock, Repeat, Star } from 'lucide-react'
import { Fragment } from 'react'

import type {
  AccessibilityFlags,
  LodgingUnitRow,
  RosterPartyRow,
  ShareRequest,
} from '../../types/lodging'
import { displayCampMinderAge } from '../../utils/age'
import { Tooltip } from '../ui/Tooltip'
import { AccessibilityFlagList } from './AccessibilityFlagList'
import { namedAdults, partyIdentityLabel } from './householdIdentity'
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
  /**
   * Opens `FamilyDetailsPanel` for this row's party (kindred#1996). The row
   * itself stays chips-only per kindred#1889 — this only routes to where the
   * narrative and request text already live, the same way `FamilyCard`
   * routes to the identical panel on Housing and Map.
   */
  onOpen: (party: RosterPartyRow) => void
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

/**
 * "1 adult · 2 children" — the PEOPLE this row prints, broken out.
 *
 * NOT `party.party_size`: that is a BED count since #1925/#2046 (blank and
 * placeholder adult slots dropped, a child under 18 months discounted), so for
 * an infant household it sits below the members listed just underneath. This
 * line and that list have to agree, which is what kindred#2152 is about.
 *
 * NOT `partyHeadcount` either, and this is the interesting half: it wants the
 * same PEOPLE number, but as two figures rather than one. `partyHeadcount`
 * returns only their sum, so substituting it would render "3" where the row
 * needs "1 adult · 2 children". The genuinely shared primitive is
 * `namedAdults`, which this already calls — there is no duplicated arithmetic
 * left here to hoist. `HouseholdRosterTable.test` pins both halves.
 */
function composition(party: RosterPartyRow): string {
  // A blank `family_camp_adults` slot is not an attending adult -- counting
  // it inflated this figure right beside the (now-filtered) identity label
  // above it (kindred#2084 scan finding).
  const adults = namedAdults(party).length
  const children = party.children?.length ?? 0
  const parts: string[] = [`${String(adults)} adult${adults === 1 ? '' : 's'}`]
  if (children > 0) {
    parts.push(`${String(children)} child${children === 1 ? '' : 'ren'}`)
  }
  return parts.join(' · ')
}

export function HouseholdRosterRow({ party, showRequests, unit, onOpen }: HouseholdRosterRowProps) {
  const isAssigned = (party.unit_name ?? '').length > 0
  const attention = partyAttention(party, unit)
  // A blank `family_camp_adults` slot is not an attending adult -- rendering
  // it left a dangling ', ' separator with nothing after it (kindred#2084
  // scan finding).
  const adults = namedAdults(party)
  const children = party.children ?? []
  const showAdults = party.grain === 'household'

  return (
    // `role="button"` used to live here, overriding the native `row` role —
    // `queryAllByRole('row')` collapsed to 1 (the header alone) and the four
    // `<td>` cells lost their owning row (kindred#2063). The affordance now
    // lives in a real `<button>` inside the first cell instead, which keeps
    // row/cell semantics intact and still satisfies `clickoutsidePredicate`'s
    // `isInteractive` check (`button` is already in its selector list).
    <tr className="border-border/40 border-b align-top">
      <td className={`border-l-[3px] ${RAIL[attention.level]}`}>
        {/* Content below stays `<span>`, never `<div>`/`<p>` — a `<button>`'s
            content model is phrasing content only, the same reason
            `FamilyCardBody` (this row's card-view counterpart) is spans
            throughout. Tailwind's `block`/`flex` classes still give each span
            the same layout its `<div>`/`<p>` had. */}
        <button
          type="button"
          onClick={() => {
            onOpen(party)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen(party)
            }
          }}
          className="hover:bg-muted/30 focus-visible:ring-ring block w-full cursor-pointer py-3 pr-4 pl-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* kindred#2084: this used to be `party.display_name` -- CampMinder's
                mailing_title salutation, which disagreed with the real
                attending-adult list on 26.7% of 2026's rostered households.
                Reuses FamilyCard's own construction (`householdIdentity.ts`)
                instead, so staff never learn two identities for one household. */}
            <span
              data-testid="household-row-name"
              className="text-foreground text-sm font-semibold"
            >
              {partyIdentityLabel(party)}
            </span>
            {/* kindred#2177 converted the board's `title` tooltips to a
                focusable `ui/Tooltip`. These two badges are the deliberate
                exception, and the reason is three lines up: they sit INSIDE
                the row's own `<button>`, whose content model is phrasing
                content with no interactive descendants. A focusable trigger
                here would be invalid HTML and would eat the row's click.

                Real `sr-only` text instead. That is strictly more than the
                `title` gave — `title` on a `<span>` is not reliably announced
                at all — and the touch gap it leaves is the smallest on the
                board, since the badge's visible word already IS the fact and
                the sentence only rephrases it. */}
            {party.is_returning === true && (
              <span className="text-forest-700 dark:text-forest-300 bg-forest-100 dark:bg-forest-900/50 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
                <Repeat className="h-3 w-3 flex-shrink-0" />
                Returning
                <span className="sr-only">(stayed with us before)</span>
              </span>
            )}
            {/* `is_returning` is only ever computed for household-grain
                parties (`_build_household_parties` sets it from
                `prior_cm_ids`). An adult weekend guest is `grain: 'person'`
                (`showAdults` false), for which the field is never set and
                arrives as the Pydantic default `false` -- untracked, not
                "no". Gating on grain keeps this badge from calling every
                adult weekend regular a first-timer. */}
            {showAdults && party.is_returning !== true && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <Star className="h-3 w-3 flex-shrink-0" />
                First-time
                <span className="sr-only">(first time at camp)</span>
              </span>
            )}
          </span>
          {/* Only the two states that name a real failure get words. "No cabin
              yet" would repeat the Cabin column's "Unassigned", and an
              unverified need would repeat the chips under Housing needs — the
              rail and the section heading already carry the state. */}
          {(attention.level === 'required' || attention.level === 'unmet') && (
            <span className={`mt-0.5 block text-xs font-medium ${REASON_TONE[attention.level]}`}>
              {attention.level === 'required' ? 'Accommodation required' : attention.reason}
            </span>
          )}
          <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
            {composition(party)}
          </span>
          {/* Members are reference detail, not scanning material — one wrapped
              line rather than two stacked ones, so 62 rows stay a page. An
              adult weekend enrols the individual directly, so the party IS the
              adult and `display_name` above already named them. */}
          <span
            data-testid="household-row-members"
            className="text-muted-foreground/75 mt-0.5 block text-xs leading-snug"
          >
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
                    : `${String(child.display_name)} (${displayCampMinderAge(child.age)})`}
                </span>
              </Fragment>
            ))}
          </span>
        </button>
      </td>

      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm ${isAssigned ? 'text-foreground font-medium' : 'text-muted-foreground italic'}`}
          >
            {isAssigned ? party.unit_name : 'Unassigned'}
          </span>
          {party.is_merged_slot === true && (
            // Outside the row button, so this one CAN be a real trigger
            // (kindred#2177).
            <Tooltip
              content="Two rooms combined into one slot"
              className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              Merged
            </Tooltip>
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
