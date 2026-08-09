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
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { HouseholdRosterRow } from './HouseholdRosterRow'
import { partyKey } from './partyKey'
import { attentionSections, indexUnitsByCode, resolvePartyUnit } from './rosterAttention'

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
      (share.request_text ?? '').length > 0
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

  // RESET, not filtered (kindred#2138) — the owner's ruling was explicit: a
  // session change closes the panel outright, it does not merely stop
  // rendering it while the selection quietly survives underneath.
  // `usePanelParty`'s own guard only catches a household that drops OUT of
  // `parties`; a household enrolled in two weekends never does that, since
  // `partyKey` (deliberately — see partyKey.ts) carries no session
  // dimension, so the same key still matches after the switch and the panel
  // would keep rendering the PREVIOUS weekend's placement data.
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

  const unitsByCode = indexUnitsByCode(units)
  const sections = attentionSections(parties, unitsByCode)
  // An untouched adult weekend is 123 parties all in one state; heading that
  // with "Needs a cabin (123)" repeats what the banner already said.
  const showSectionHeads = sections.length > 1
  // Adult weekends carry no share requests — don't render a dead column.
  const showRequests = hasAnyRequest(parties)

  return (
    <>
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
