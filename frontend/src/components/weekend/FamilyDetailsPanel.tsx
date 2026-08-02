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
 * shape the board already implements: `{ onClose, requestClose, embedded }`,
 * `requestClose` driving an animated close, the `pointer-events-none fixed
 * inset-0 z-[59]` click-outside layer, and `shouldKeepPanelsOpen` for
 * dismissal.
 *
 * **One component, both surfaces.** The map (Step 6) opens this same panel
 * embedded; a second implementation is exactly what `embedded` exists to
 * prevent.
 */
import { Clock, Home, Repeat, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  AccessibilityFlags,
  LodgingUnitRow,
  RosterPartyRow,
  ShareRequest,
} from '../../types/lodging'
import { AccessibilityFlagList } from './AccessibilityFlagList'
import { ATTENTION_LABEL, partyAttention } from './rosterAttention'
import { ShareRequestPanel } from './ShareRequestPanel'

export interface FamilyDetailsPanelProps {
  party: RosterPartyRow
  /** The cabin it sits in, when one resolves. Undefined for a merge. */
  unit?: LodgingUnitRow | undefined
  year: number
  /** Rendered inline (the map's sidebar) rather than as a slide-in overlay. */
  embedded?: boolean
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
  has_medical_narrative: false,
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
  embedded = false,
  requestClose = false,
  onClose,
}: FamilyDetailsPanelProps) {
  const [isClosing, setIsClosing] = useState(false)
  const exiting = requestClose || isClosing

  const handleClose = useCallback(() => {
    // Embedded has no slide-out to run, so waiting for an animation that never
    // fires would leave the panel stuck open.
    if (embedded) onClose()
    else setIsClosing(true)
  }, [embedded, onClose])

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
    if (embedded || isClosing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [embedded, isClosing, handleClose])

  const adults = party.adults ?? []
  const children = party.children ?? []
  const isHousehold = party.grain === 'household'
  // A person-grain party has no household, and the API sends 0 rather than
  // omitting the field. `null` says "nothing to look up", so the medical
  // reveal is not offered where it could only ever 404.
  const householdCmId = isHousehold ? (party.household_cm_id ?? 0) : 0
  const attention = partyAttention(party, unit)
  const isPlaced = (party.unit_name ?? '').length > 0
  const partySize = party.party_size ?? adults.length + children.length

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
        {/* 0 of 93 units are confirmed today, so "unverified" is the honest
            verdict for every constrained party — not a bug to route around. */}
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
            {`${String(partySize)} ${partySize === 1 ? 'person' : 'people'}`}
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
        </div>

        {isHousehold && adults.length > 0 && (
          <ul className="flex flex-col gap-0.5" role="list">
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
                    child.age === null || child.age === undefined ? '' : `Age ${String(child.age)}`,
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
        <AccessibilityFlagList
          flags={party.flags ?? NO_FLAGS}
          householdCmId={householdCmId > 0 ? householdCmId : null}
          year={year}
        />
      </Section>
    </div>
  )

  const header = (
    <div className="from-forest-700 via-forest-800 to-forest-900 flex flex-shrink-0 items-start gap-3 bg-gradient-to-br p-4 text-white">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-bold">{party.display_name}</h2>
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

  if (embedded) {
    return (
      <div
        data-panel="family-details"
        data-testid="family-details-panel"
        className="bg-card shadow-lodge-lg flex h-full flex-col overflow-hidden rounded-2xl"
      >
        {header}
        <div className="flex-1 overflow-y-auto">{body}</div>
      </div>
    )
  }

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
        aria-label={`${String(party.display_name)} details`}
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
