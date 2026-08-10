/**
 * Everything the family card omits (spec §3.9).
 *
 * This is what makes §3.8's three omissions a DEFERRAL rather than a loss —
 * the request text and the medical narrative are one click away, not gone.
 * Request text is unchanged in REACH, only in placement: it already renders on
 * the roster row through the same `ShareRequestPanel`. Moving it here rather
 * than onto 62 simultaneously-visible cards is the whole of the narrowing.
 *
 * **Mirror the contract, not the code.** `CamperDetailsPanel` is 1442 lines and
 * deeply camper-coupled — bunk requests, satisfaction buckets, AG collapse,
 * camper journeys. None of it is reused. What is copied is the interaction
 * shape the board already implements: `{ onClose, requestClose }`,
 * `requestClose` driving an animated close, the `pointer-events-none fixed
 * inset-0 z-[59]` click-outside layer, and `shouldKeepPanelsOpen` for
 * dismissal.
 *
 * **One component, both surfaces.** The board and the map both open this same
 * slide-in overlay — there is no second implementation to keep in sync.
 */
import { Clock, Home, Repeat, Star, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  AccessibilityFlags,
  LodgingUnitRow,
  RosterPartyRow,
  ShareRequest,
} from '../../types/lodging'
import { displayCampMinderAge } from '../../utils/age'
import { hasOpenModal } from '../ui/modalStack'
import { AccessibilityFlagList } from './AccessibilityFlagList'
import { HouseholdJourneyCard } from './HouseholdJourneyCard'
import { namedAdults, partyFamilyLabel, partyHeadcount } from './householdIdentity'
import { MedicalNarrative } from './MedicalNarrative'
import { partyKey } from './partyKey'
import { ATTENTION_LABEL, partyAttention } from './rosterAttention'
import { ShareRequestPanel } from './ShareRequestPanel'

export interface FamilyDetailsPanelProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined for a merge. */
  unit?: LodgingUnitRow | undefined
  year: number
  /** Parent-driven animated close, as the summer board does. */
  requestClose?: boolean
  onClose: () => void
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function FamilyDetailsPanel({
  party,
  unit,
  year,
  requestClose = false,
  onClose,
}: FamilyDetailsPanelProps) {
  const [isClosing, setIsClosing] = useState(false)

  // The board and map stopped keying this panel per party, so a family switch
  // updates it in place instead of remounting. Remounting used to reset
  // `isClosing` for free; nothing else does. Without this, closing one family
  // and picking another inside the 300ms slide-out hands the new family the
  // old one's exit, and `handleAnimationEnd` closes the panel on them.
  //
  // Adjusted during render, not in an effect: an effect commits one frame with
  // the exit class still on, which is the flicker this exists to prevent.
  // `requestClose` needs no equivalent HERE for a same-click family switch —
  // the parent's `openParty` already sets it false. A party that DEPARTS the
  // roster instead of being switched away from is a different path
  // (kindred#2137 bug 2): this panel can unmount mid-exit-animation before
  // `onClose` ever fires, so nothing here would clear a latched
  // `requestClose` for it. `usePanelParty`'s own render-time correction is
  // what clears it in that case, not this component.
  const identity = partyKey(party)
  const [shownIdentity, setShownIdentity] = useState(identity)
  if (identity !== shownIdentity) {
    setShownIdentity(identity)
    setIsClosing(false)
  }

  const exiting = requestClose || isClosing

  const handleClose = useCallback(() => {
    setIsClosing(true)
  }, [])

  const handleAnimationEnd = useCallback(
    (event: React.AnimationEvent) => {
      if (!exiting) return
      // jsdom reports an empty animationName; allow it so tests can drive the
      // same path the browser takes.
      const name = event.animationName || ''
      if (name.length === 0 || name.includes('Out')) onClose()
    },
    [exiting, onClose]
  )

  useEffect(() => {
    if (isClosing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // A `ui/Modal` this panel HOSTS owns Escape while it is open --
      // kindred#2073's "see members" is the first, and this panel is the
      // first surface in the repo to host one. Both handlers sit on
      // `document`, so propagation cannot separate them: without this the
      // single press dismisses the dialog AND the panel behind it, and the
      // family the staff member was reading goes with it.
      if (hasOpenModal()) return
      handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isClosing, handleClose])

  // A blank `family_camp_adults` slot is not an attending adult -- rendering
  // it left an empty <li> in the Party list (kindred#2084 scan finding).
  const adults = namedAdults(party)
  const children = party.children ?? []
  const isHousehold = party.grain === 'household'
  // A person-grain party has no household, and the API sends 0 rather than
  // omitting the field. `null` says "nothing to look up", so the medical
  // narrative is not fetched where it could only ever 404.
  const householdCmId = isHousehold ? (party.household_cm_id ?? 0) : 0
  // "The X Family", built from the children's deduplicated surnames
  // (kindred#2180, owner ruling 2026-08-09). It REPLACES the attending-adult
  // headline kindred#2084 installed here; the adults are not lost and are not
  // demoted to a sub-line -- they are in the Party list below, with the kids.
  //
  // This is not the salutation coming back. That was CampMinder's
  // `mailing_title`, which disagreed with the real adult list on 26.7% of
  // 2026's 382 rostered households, in both directions; a surname derived
  // from the children's own `persons.last_name` carries none of that. The
  // four OTHER surfaces (`HouseholdRosterRow`, `MapUnitPopover`,
  // `FloatingUnplacedBadge`, and the card's grey line) still show the adult
  // list -- this replacement is scoped to the panel headline, where there is
  // a full members list one section down to carry the names.
  //
  // `partyFamilyLabel` falls all the way back through the adult list to the
  // salutation, so a party whose children carry no surname still has a
  // heading.
  const identityLabel = partyFamilyLabel(party)
  const attention = partyAttention(party, unit)
  const isPlaced = (party.unit_name ?? '').length > 0
  // NOT `party.party_size` — that became a BED count under kindred#1925/
  // #2046 (it drops blank/placeholder adult slots and discounts an
  // under-18-month infant) and can legitimately disagree with the adults and
  // children this panel prints just below. `partyHeadcount` is that printed
  // count, the same one FamilyCard's own badge uses, so the two surfaces —
  // and this panel's own list — can never disagree with each other
  // (kindred#2152).
  //
  // Named `headcount`, NOT `partySize`: "party size" is the bed number now
  // (`boardLayout.partySize`, `rosterAttention.partyBeds`), and a local of
  // that name holding the other figure is the exact confusion this issue
  // exists to end.
  const headcount = partyHeadcount(party)

  const body = (
    <div className="flex flex-col gap-4 p-4">
      <Section title="Placement">
        <div className="flex flex-wrap items-center gap-2">
          <Home className="text-muted-foreground h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {isPlaced ? (
            <span className="text-foreground text-sm font-medium">{party.unit_name}</span>
          ) : (
            <span className="text-muted-foreground text-sm italic">No cabin yet</span>
          )}
          {party.is_merged_slot === true && (
            <span
              title="Two rooms combined into one slot"
              className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              Merged
            </span>
          )}
          {unit?.area_name !== undefined && unit.area_name.length > 0 && (
            <span className="text-muted-foreground text-xs">{unit.area_name}</span>
          )}
        </div>
        {/* "Unverified" is the honest verdict for a constrained party whose
            cabin nobody has confirmed — an unset `has_power` means "nobody has
            said", not "there is no power". Not a bug to route around, and no
            longer the universal case this used to claim: it said "0 of 93
            units are confirmed today", and production is 118/118 confirmed as
            of 2026-08-09. */}
        {attention.level !== 'settled' && attention.level !== 'unplaced' && (
          <p className="text-muted-foreground flex flex-wrap items-baseline gap-1.5 text-xs">
            <span className="font-medium">{ATTENTION_LABEL[attention.level]}</span>
            {attention.reason.length > 0 && <span>{attention.reason}</span>}
          </p>
        )}
      </Section>

      <Section title="Party">
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {`${String(headcount)} ${headcount === 1 ? 'person' : 'people'}`}
          </span>
          {(party.arrival_eta ?? '').length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {party.arrival_eta}
            </span>
          )}
          {party.is_returning === true && (
            <span className="text-forest-700 dark:text-forest-300 inline-flex items-center gap-1 font-semibold">
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              Returning
            </span>
          )}
          {/* `is_returning` is only ever computed for household-grain parties
              (`_build_household_parties` sets it from `prior_cm_ids`). An
              adult weekend guest is `grain: 'person'`, for which the field is
              never set and arrives as the Pydantic default `false` --
              untracked, not "no". Gating on grain keeps this badge from
              calling every adult weekend regular a first-timer. */}
          {party.is_returning !== true && isHousehold && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
              <Star className="h-3.5 w-3.5" aria-hidden="true" />
              First-time
            </span>
          )}
        </div>

        {isHousehold && adults.length > 0 && (
          // NOT redundant: Tailwind Preflight sets list-style: none on every <ul>, which strips the
          // implicit `list` role in Safari's a11y tree unless role="list" is explicit. See
          // CamperAlertSection.tsx for the same pattern.
          // eslint-disable-next-line jsx-a11y/no-redundant-roles
          <ul data-testid="family-panel-adults" className="flex flex-col gap-0.5" role="list">
            {adults.map((adult, index) => (
              <li
                key={`${String(adult.adult_number ?? index)}-${String(adult.display_name)}`}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="text-foreground">{adult.display_name}</span>
                {(adult.relationship ?? '').length > 0 && (
                  <span className="text-muted-foreground text-xs">{adult.relationship}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {children.length > 0 && (
          // NOT redundant: Tailwind Preflight sets list-style: none on every <ul>, which strips the
          // implicit `list` role in Safari's a11y tree unless role="list" is explicit. See
          // CamperAlertSection.tsx for the same pattern.
          // eslint-disable-next-line jsx-a11y/no-redundant-roles
          <ul className="flex flex-col gap-0.5" role="list">
            {children.map((child, index) => (
              <li
                key={String(child.person_cm_id ?? index)}
                className="flex flex-wrap items-baseline gap-2 text-sm"
              >
                <span className="text-foreground">{child.display_name}</span>
                <span className="text-muted-foreground text-xs">
                  {/* An age or grade we do not have is omitted, never zero. */}
                  {[
                    child.age === null || child.age === undefined
                      ? ''
                      : `Age ${displayCampMinderAge(child.age)}`,
                    child.grade === null || child.grade === undefined || child.grade === 0
                      ? ''
                      : `Grade ${String(child.grade)}`,
                  ]
                    .filter((part) => part.length > 0)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Share request">
        <ShareRequestPanel share={party.share ?? NO_SHARE_REQUEST} />
      </Section>

      <Section title="Housing needs">
        <div className="flex flex-col gap-1.5">
          <AccessibilityFlagList flags={party.flags ?? NO_FLAGS} />
          {/* Kept in this section rather than given its own, because it is
              where the narrative already appeared and staff know to look here.
              It self-hides for a viewer without `lodging.phi` and for a
              household with nothing on file, so no empty block is left
              behind. */}
          <MedicalNarrative householdCmId={householdCmId > 0 ? householdCmId : null} year={year} />
        </div>
      </Section>

      {/* kindred#2073. NOT wrapped in a `Section`: it is a sidebar CARD with
          its own forest band, the same shape `camper/CampJourneyTimeline`
          takes on the camper page, and a `Section` heading above it would
          title the card twice.

          The panel is the right host for the same reason `MedicalNarrative`
          lives here rather than on a roster row: it shows ONE household at a
          time, which is what makes a fetch on mount proportionate. A
          person-grain party has no household, and the card renders nothing
          and fetches nothing for it. */}
      <HouseholdJourneyCard
        householdCmId={householdCmId > 0 ? householdCmId : null}
        currentYear={year}
      />
    </div>
  )

  const header = (
    <div className="from-forest-700 via-forest-800 to-forest-900 flex flex-shrink-0 items-start gap-3 bg-gradient-to-br p-4 text-white">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-bold">{identityLabel}</h2>
        <p className="text-forest-100 mt-0.5 text-xs">
          {isHousehold ? 'Household' : 'Adult weekend guest'}
        </p>
      </div>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close panel"
        className="-mr-1 rounded-lg p-1.5 transition-colors hover:bg-white/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  return (
    <>
      {/* Click-outside layer, as the summer board lays over the page. */}
      <div
        data-testid="family-panel-backdrop"
        className="pointer-events-none fixed inset-0 z-[59]"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        data-panel="family-details"
        data-testid="family-details-panel"
        role="dialog"
        aria-label={`${identityLabel} details`}
        className={`bg-card shadow-lodge-xl border-border fixed top-0 right-0 bottom-0 z-[60] flex w-[26rem] max-w-full flex-col border-l ${
          exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
        }`}
        onAnimationEnd={handleAnimationEnd}
      >
        {header}
        <div className="flex-1 overflow-y-auto">{body}</div>
      </div>
    </>
  )
}
