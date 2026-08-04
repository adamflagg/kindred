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
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { HouseholdRosterRow } from './HouseholdRosterRow'
import { attentionSections, indexUnitsByCode } from './rosterAttention'

export interface HouseholdRosterTableProps {
  parties: RosterPartyRow[]
  /**
   * The weekend's cabins, so a row can ask whether its own cabin provides
   * what the family requested. Optional: without it every constrained party
   * reports as unverified, which is the honest answer.
   */
  units?: LodgingUnitRow[]
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

export function HouseholdRosterTable({ parties, units = [] }: HouseholdRosterTableProps) {
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
              // Both grains number independently, so a household cm_id can
              // equal a person cm_id — the key carries the grain and both ids.
              <HouseholdRosterRow
                key={`${party.grain}-${String(party.household_cm_id ?? 0)}-${String(party.person_cm_id ?? 0)}`}
                party={party}
                showRequests={showRequests}
                unit={unitsByCode.get(party.unit_code ?? '')}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
