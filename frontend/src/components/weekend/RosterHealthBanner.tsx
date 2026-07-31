/**
 * Honest counts for one weekend.
 *
 * Two rules the numbers must obey, both from the spec:
 *   - Reserved units are EXCLUDED from availability (§3.7), and the banner
 *     says so rather than quietly shrinking the denominator.
 *   - Units with unknown capacity are excluded from the bed total, so the
 *     figure is a floor. It is rendered "389+" when any capacity is unknown.
 *
 * Every capacity figure upstream already excludes container rows — including
 * them would report 408 beds against a true 389.
 */
import { AlertTriangle, BedDouble, Home, Users } from 'lucide-react'

import type { RosterCountSummary } from '../../types/lodging'

export interface RosterHealthBannerProps {
  counts: RosterCountSummary
}

function Stat({
  icon: Icon,
  primary,
  secondary,
}: {
  icon: typeof Home
  primary: string
  secondary: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="text-muted-foreground h-4 w-4 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-foreground text-sm font-semibold">{primary}</p>
        <p className="text-muted-foreground text-xs">{secondary}</p>
      </div>
    </div>
  )
}

export function RosterHealthBanner({ counts }: RosterHealthBannerProps) {
  // Pydantic defaults render as optional in TypeScript; the server always
  // populates them, but read sites still need `?? 0`.
  const partiesTotal = counts.parties_total ?? 0
  const partiesAssigned = counts.parties_assigned ?? 0
  const partiesUnassigned = counts.parties_unassigned ?? 0
  const unitsTotal = counts.units_total ?? 0
  const unitsAvailable = counts.units_family_available ?? 0
  const unitsReserved = counts.units_reserved ?? 0
  const beds = counts.beds_family_available ?? 0
  const capacityUnknown = counts.units_capacity_unknown ?? 0
  const unconfirmed = counts.units_unconfirmed ?? 0
  const missingAllocation = counts.units_missing_allocation ?? 0
  const unresolvedAliases = counts.unresolved_aliases ?? 0

  const warnings: string[] = []
  if (unresolvedAliases > 0) warnings.push(`${String(unresolvedAliases)} unresolved cabin names`)
  if (unconfirmed > 0) warnings.push(`${String(unconfirmed)} units with unconfirmed amenities`)
  if (capacityUnknown > 0) warnings.push(`${String(capacityUnknown)} units with unknown capacity`)
  if (missingAllocation > 0)
    warnings.push(`${String(missingAllocation)} units missing an allocation default`)

  return (
    <div className="card-lodge flex flex-col gap-3 p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={Users}
          primary={`${String(partiesAssigned)} of ${String(partiesTotal)} placed`}
          secondary={`${String(partiesUnassigned)} unplaced`}
        />
        <Stat
          icon={Home}
          primary={`${String(unitsAvailable)} of ${String(unitsTotal)} units open to families`}
          secondary={`${String(unitsReserved)} reserved (excluded)`}
        />
        <Stat
          icon={BedDouble}
          primary={`${String(beds)}${capacityUnknown > 0 ? '+' : ''} beds available`}
          secondary={
            capacityUnknown > 0
              ? 'Excludes units with unknown capacity'
              : 'All capacities confirmed'
          }
        />
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-amber-200/60 pt-3 dark:border-amber-900/40">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          {warnings.map((warning) => (
            <span
              key={warning}
              className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {warning}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
