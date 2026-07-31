/** The per-weekend roster table. Read-only in this slice. */
import type { RosterPartyRow } from '../../types/lodging'
import { HouseholdRosterRow } from './HouseholdRosterRow'

export interface HouseholdRosterTableProps {
  parties: RosterPartyRow[]
  year: number
}

export function HouseholdRosterTable({ parties, year }: HouseholdRosterTableProps) {
  if (parties.length === 0) {
    return (
      <div className="card-lodge p-6">
        <p className="text-muted-foreground text-sm">
          No households enrolled for this weekend yet.
        </p>
      </div>
    )
  }

  return (
    <div className="card-lodge overflow-x-auto p-4">
      <table className="w-full min-w-4xl text-left">
        <thead>
          <tr className="border-border border-b">
            <th className="text-muted-foreground pb-2 text-xs font-semibold tracking-wide uppercase">
              Party
            </th>
            <th className="text-muted-foreground pb-2 text-xs font-semibold tracking-wide uppercase">
              Cabin
            </th>
            <th className="text-muted-foreground pb-2 text-xs font-semibold tracking-wide uppercase">
              Requests
            </th>
            <th className="text-muted-foreground pb-2 text-xs font-semibold tracking-wide uppercase">
              Accessibility
            </th>
          </tr>
        </thead>
        <tbody>
          {parties.map((party) => (
            // Both grains number independently, so a household cm_id can equal
            // a person cm_id — the key carries the grain and both ids.
            <HouseholdRosterRow
              key={`${party.grain}-${String(party.household_cm_id ?? 0)}-${String(party.person_cm_id ?? 0)}`}
              party={party}
              year={year}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
