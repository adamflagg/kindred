/**
 * The per-weekend roster, ordered by what needs a decision.
 *
 * Alphabetical order is what a list does. This page groups by attention state
 * so the six parties without a cabin sit above the fifty that are settled,
 * because those six are the whole job. Order within a section is the API's,
 * which is stable and alphabetical.
 *
 * Read-only in this slice.
 */
import { useState } from 'react'

import { useDismissOnDeadSpace } from '../../hooks/useDismissOnDeadSpace'
import { usePanelParty } from '../../hooks/usePanelParty'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import type { NeedFilterKey } from './AccessibilityFlagList'
import { NEED_FILTER_OPTIONS } from './AccessibilityFlagList'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { HouseholdRosterRow } from './HouseholdRosterRow'
import { partyKey } from './partyKey'
import { attentionSections, indexUnitsByCode, resolvePartyUnit } from './rosterAttention'

/**
 * First season `needs_private_bathroom`/`needs_power` carry real signal.
 * family-camp-grain-campaign.md Trap 1 / decision D2: these are 2 of eight
 * columns the sync only started populating in 2026 — every earlier row reads
 * `false`, not "unknown". `needs_accommodation` is excluded on purpose: it is
 * sourced from a field that existed in earlier seasons too (an older "FAM
 * Camp-Accommodation" generation), so it carries real, if sparser, historical
 * signal.
 *
 * `infant`, by contrast, is IN this set (kindred#2251 ruling D18). In the
 * production snapshot `has_infant` is `0` on all 3,923
 * `family_camp_registrations` rows across all ten years 2017-2026, so
 * `flags.has_infant` is false on every party the API can emit there and the
 * chip lands on the zero-match empty state. The cause is not a 2026-only
 * column the way bathroom/power are — the underlying raw field
 * (`Adult-Infant`, cm_id 257248) is answered exclusively by
 * `session_type='adult'` attendees, so on family weekends it is dead by
 * construction, and every 2026 adult-weekend answer so far reads "No" or an
 * unrelated write-in.
 *
 * Deliberately NOT stated as "no true row exists at any year": a local 2025
 * replay derives exactly 3 true rows (all adult-session), and some dev
 * databases carry one, so the banner copy below is scoped to the pre-2026
 * seasons this set already gates on rather than claiming the filter can
 * never match anything.
 */
const NEEDS_DATA_FIRST_YEAR = 2026
const HISTORICAL_GAP_KEYS: ReadonlySet<NeedFilterKey> = new Set(['bathroom', 'power', 'infant'])

export interface HouseholdRosterTableProps {
  parties: RosterPartyRow[]
  /**
   * The weekend's cabins, so a row can ask whether its own cabin provides
   * what the family requested. Optional: without it every constrained party
   * reports as unverified, which is the honest answer.
   */
  units?: LodgingUnitRow[]
  /** Threads through to `FamilyDetailsPanel`'s medical-narrative fetch (kindred#1996). */
  year: number
  /**
   * The weekend this roster belongs to, so a household enrolled in TWO
   * weekends (kindred#2138) can be told apart from one that merely refetched.
   * Optional and defaulting to 0 for the same reason `LodgingBoard`'s prop
   * of the same name does: most tests render one weekend's roster and never
   * exercise a session change.
   */
  sessionCmId?: number
}

const HEAD_CELL = 'text-muted-foreground pb-2 text-xs font-bold tracking-wider uppercase'

function hasAnyRequest(parties: RosterPartyRow[]): boolean {
  return parties.some((p) => {
    const share = p.share
    if (!share) return false
    return (
      (share.preference !== undefined && share.preference !== 'unknown') ||
      (share.proximity ?? []).length > 0 ||
      (share.request_text ?? '').length > 0 ||
      // kindred#2330: 32 rostered 2026 households carry their ask ONLY in the
      // bunking-CSV lane, which `family_camp_registrations.request_text` is
      // not fed from — so the joined column alone under-counts requests.
      (share.request_blocks ?? []).length > 0
    )
  })
}

export function HouseholdRosterTable({
  parties,
  units = [],
  year,
  sessionCmId = 0,
}: HouseholdRosterTableProps) {
  // A third `FamilyDetailsPanel` callsite (kindred#1996), wired exactly as
  // `LodgingBoard` and `LodgingMap` wire the other two — same `usePanelParty`
  // hook, same `useDismissOnDeadSpace` hookup. The row itself stays
  // chips-only per kindred#1889; this only gives it somewhere to send a
  // click. `panelParty`/`requestClose`/`openParty`/`closePanel` used to be
  // four lines of hand-rolled state and an 11-line comment per surface
  // (kindred#2139) — see `usePanelParty`'s own docstring for the derivation
  // this now shares with `LodgingBoard` and `LodgingMap`.
  const { panelParty, requestClose, openParty, closePanel, requestPanelClose } =
    usePanelParty(parties)

  // Filter by housing need (kindred#2251) -- OR across whatever is selected,
  // matching the standard "broaden as you add a chip" reading of a
  // multi-select filter group. An AND reading would frequently show zero
  // rows, since the four flags name unrelated needs rather than degrees of
  // one need. Local state, not the URL: this narrows an in-page scan rather
  // than picking a view, so it does not need to survive a reload or be
  // linked, unlike the weekend TAB itself (CLAUDE.md §4 "URL style").
  //
  // Declared ABOVE the session-reset block below so its setter is in scope
  // there. Both `useState` calls stay above the `parties.length === 0` early
  // return -- rules of hooks.
  const [selectedNeeds, setSelectedNeeds] = useState<Set<NeedFilterKey>>(() => new Set())

  // RESET, not filtered (kindred#2138) — the owner's ruling was explicit: a
  // session change closes the panel outright, it does not merely stop
  // rendering it while the selection quietly survives underneath.
  // `usePanelParty`'s own guard only catches a household that drops OUT of
  // `parties`; a household enrolled in two weekends never does that, since
  // `partyKey` (deliberately — see partyKey.ts) carries no session
  // dimension, so the same key still matches after the switch and the panel
  // would keep rendering the PREVIOUS weekend's placement data. The needs
  // filter above gets the same treatment for the same reason: a filter
  // chosen on one weekend must not quietly keep narrowing a different
  // weekend's roster after staff switch sessions.
  //
  // This is React's own "storing information from previous renders"
  // pattern: compare this render's prop against the last one seen, and if
  // it moved, correct the state right here in the render body rather than
  // in an Effect. Calling `closePanel` conditionally during render does not
  // add a paint the way an Effect would — React discards this render's
  // output and re-renders synchronously with the corrected state before
  // anything commits, so nobody ever sees the stale mid-render frame.
  const [lastSessionCmId, setLastSessionCmId] = useState(sessionCmId)
  if (sessionCmId !== lastSessionCmId) {
    setLastSessionCmId(sessionCmId)
    closePanel()
    setSelectedNeeds(new Set())
  }

  useDismissOnDeadSpace(panelParty !== null, requestPanelClose)

  if (parties.length === 0) {
    return (
      <div className="dark:bg-card rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-600">
        <p className="text-foreground text-sm font-medium">No one is enrolled for this weekend.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Parties appear here once registrations sync from CampMinder.
        </p>
      </div>
    )
  }

  const activeNeeds = NEED_FILTER_OPTIONS.filter((option) => selectedNeeds.has(option.key))
  const filteredParties =
    activeNeeds.length === 0
      ? parties
      : parties.filter((p) => activeNeeds.some((option) => option.matches(p.flags ?? {})))

  const unitsByCode = indexUnitsByCode(units)
  const sections = attentionSections(filteredParties, unitsByCode)
  // An untouched adult weekend is 123 parties all in one state; heading that
  // with "Needs a cabin (123)" repeats what the banner already said.
  const showSectionHeads = sections.length > 1
  // Adult weekends carry no share requests — don't render a dead column.
  // Keyed off the FULL roster, not the filtered one: the column set is a
  // property of the weekend, not of whatever is currently toggled, and
  // letting it flicker in and out as a filter narrows the rows would be a
  // second, unrelated thing changing on every click.
  const showRequests = hasAnyRequest(parties)

  // needs_private_bathroom/needs_power are 0 for every pre-2026 row (Trap 1 /
  // D2 — see the constant above), and has_infant is 0 for every pre-2026 row
  // as well (kindred#2251 D18), so an empty or thin result here can read as
  // "nobody needed it" when the true answer is "we never asked". Shown
  // whenever any gap flag is part of the ACTIVE filter on a season before the
  // data exists, even if the OR combination still finds matches through a
  // different flag — the gapped signal itself stays silently incomplete in
  // that result too.
  const activeGapNeeds = activeNeeds.filter((option) => HISTORICAL_GAP_KEYS.has(option.key))
  const showHistoricalGapWarning = year < NEEDS_DATA_FIRST_YEAR && activeGapNeeds.length > 0
  // The two gaps are not the same gap, so they do not get the same sentence.
  // Bathroom and power are 2026-onward columns and start carrying signal that
  // season; has_infant is 0 in 2026 too, so "only recorded starting the 2026
  // season" is not a true statement about it and must not be shown to someone
  // who filtered on infants alone. When a 2026-column flag is also active its
  // as-shipped wording wins — that sentence is still the accurate one for the
  // flag the roster is mostly being narrowed by.
  const gapIsInfantOnly = activeGapNeeds.every((option) => option.key === 'infant')

  const toggleNeed = (key: NeedFilterKey) => {
    setSelectedNeeds((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="bg-muted/50 dark:bg-muted/30 border-border/50 flex flex-wrap items-center gap-1 rounded-xl border p-1">
          {NEED_FILTER_OPTIONS.map((option) => {
            const Icon = option.icon
            const isSelected = selectedNeeds.has(option.key)
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  toggleNeed(option.key)
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                }`}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                {option.label}
              </button>
            )
          })}
        </div>
        {activeNeeds.length > 0 && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {filteredParties.length} of {parties.length}
          </span>
        )}
      </div>

      {showHistoricalGapWarning && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-100 p-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/50 dark:text-amber-300">
          {gapIsInfantOnly ? (
            <>
              Infant in party is not recorded before the 2026 season. A result for {year} reflects
              missing data, not that nobody had an infant.
            </>
          ) : (
            <>
              Private bathroom and power needs are only recorded starting the 2026 season. A result
              for {year} reflects missing data, not that nobody needed one.
            </>
          )}
        </p>
      )}

      {filteredParties.length === 0 ? (
        <div className="dark:bg-card rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center dark:border-stone-600">
          <p className="text-foreground text-sm font-medium">
            No one matches the selected housing needs.
          </p>
        </div>
      ) : (
        <div className="dark:bg-card overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-700">
          <table className="w-full min-w-3xl text-left">
            <thead>
              <tr className="border-border border-b">
                <th className={`${HEAD_CELL} pt-4 pl-3`}>Party</th>
                <th className={`${HEAD_CELL} pt-4`}>Cabin</th>
                {showRequests && <th className={`${HEAD_CELL} pt-4`}>Requests</th>}
                <th className={`${HEAD_CELL} pt-4 pr-3`}>Housing needs</th>
              </tr>
            </thead>

            {sections.map((section) => (
              <tbody key={section.level}>
                {showSectionHeads && (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={showRequests ? 4 : 3}
                      className="bg-forest-50/70 dark:bg-forest-900/40 text-forest-800 dark:text-forest-200 border-border/60 border-y px-3 py-2 text-left text-xs font-bold tracking-wider uppercase"
                    >
                      {section.label}
                      <span className="text-muted-foreground ml-2 font-semibold normal-case tabular-nums">
                        {section.parties.length}
                      </span>
                    </th>
                  </tr>
                )}
                {section.parties.map((party) => (
                  // `partyKey`, not a hand-rolled string (kindred#2139): the two
                  // used to disagree on an unresolved household (both ids 0),
                  // where this file's own inline key collapsed two different
                  // households into one React key and `partyKey` did not, by
                  // falling through to `display_name`. No live incidence — see
                  // `partyKey.ts`'s own docstring — but importing `partyKey`
                  // into this file and then hand-rolling a second, weaker
                  // definition beside it was the inconsistency worth fixing.
                  <HouseholdRosterRow
                    key={partyKey(party)}
                    party={party}
                    showRequests={showRequests}
                    unit={resolvePartyUnit(party, unitsByCode)}
                    onOpen={openParty}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {panelParty !== null && (
        <FamilyDetailsPanel
          party={panelParty}
          unit={resolvePartyUnit(panelParty, unitsByCode)}
          year={year}
          requestClose={requestClose}
          onClose={closePanel}
        />
      )}
    </>
  )
}
