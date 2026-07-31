/**
 * The state of one weekend, in the order staff actually ask about it:
 * does it fit, who still needs a cabin, and what is the registry unsure of?
 *
 * Two rules the numbers obey, both from the spec:
 *   - Held cabins are EXCLUDED from availability (§3.7), and the banner says
 *     so rather than quietly shrinking the denominator.
 *   - Cabins of unknown capacity are excluded from the bed total, so that
 *     figure is a floor. The ledger shows the gap as a band instead of a "+".
 *
 * Every capacity figure upstream already excludes container rows — including
 * them would report 408 beds against a true 389.
 *
 * The notes row states registry facts, not alarms. A signal that is true of
 * every cabin (amenities are unconfirmed for all 82 in 2026) describes the
 * registry rather than warning about it, and is worded that way — a warning
 * that is always on teaches staff to stop reading the row.
 */
import { Home, Users } from 'lucide-react'

import type { RosterCountSummary } from '../../types/lodging'
import { CapacityLedger } from './CapacityLedger'

export interface RosterHealthBannerProps {
  counts: RosterCountSummary
  /** Beds the enrolled parties need. Summed from the roster, not the counts. */
  bedsNeeded: number
  /**
   * Family spaces whose capacity nobody has recorded.
   *
   * NOT `counts.units_capacity_unknown` — that counts every unmeasured cabin
   * including the ones held for staff, so on real 2026 data it reports 5 when
   * only 2 of the 79 family spaces are actually unmeasured. Computed from the
   * spaces the roster can place into.
   */
  spacesUnmeasured: number
}

/**
 * A "space" is a bookable cabin or room — what a family occupies whole.
 * `units_family_available` already excludes container rows and held cabins,
 * which is exactly the set a family can be placed into.
 */

export function RosterHealthBanner({
  counts,
  bedsNeeded,
  spacesUnmeasured,
}: RosterHealthBannerProps) {
  // Pydantic defaults render as optional in TypeScript; the server always
  // populates them, but read sites still need `?? 0`.
  const partiesTotal = counts.parties_total ?? 0
  const partiesAssigned = counts.parties_assigned ?? 0
  const partiesUnassigned = counts.parties_unassigned ?? 0
  const unitsTotal = counts.units_total ?? 0
  const unitsAvailable = counts.units_family_available ?? 0
  const unitsReserved = counts.units_reserved ?? 0

  const notes: string[] = []
  const unconfirmed = counts.units_unconfirmed ?? 0
  if (unconfirmed > 0) {
    notes.push(
      unconfirmed >= unitsTotal && unitsTotal > 0
        ? 'No cabin amenities confirmed yet'
        : `${String(unconfirmed)} of ${String(unitsTotal)} cabins have unconfirmed amenities`
    )
  }
  const unresolvedAliases = counts.unresolved_aliases ?? 0
  if (unresolvedAliases > 0) notes.push(`${String(unresolvedAliases)} cabin names need mapping`)
  const missingAllocation = counts.units_missing_allocation ?? 0
  if (missingAllocation > 0)
    notes.push(`${String(missingAllocation)} cabins have no allocation default`)

  return (
    <div className="card-lodge flex flex-col gap-5 p-5">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <CapacityLedger
          families={partiesTotal}
          spaces={unitsAvailable}
          spacesUnmeasured={spacesUnmeasured}
          bedsNeeded={bedsNeeded}
          bedsAvailable={counts.beds_family_available ?? 0}
        />

        <div className="border-border/70 flex flex-col justify-center gap-3 md:border-l md:pl-6">
          <div className="flex items-start gap-2.5">
            <Users className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="text-foreground text-sm font-semibold tabular-nums">
                {partiesAssigned} of {partiesTotal} placed
              </p>
              <p
                className={`text-xs ${partiesUnassigned > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
              >
                {partiesUnassigned > 0
                  ? `${String(partiesUnassigned)} still need a cabin`
                  : // "Everyone has a cabin" over an empty weekend reads as
                    // success when nothing has happened yet.
                    partiesTotal > 0
                    ? 'Everyone has a cabin'
                    : 'No one enrolled yet'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Home className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="text-foreground text-sm font-semibold tabular-nums">
                {unitsAvailable} of {unitsTotal} cabins open to families
              </p>
              {unitsReserved > 0 && (
                <p className="text-muted-foreground text-xs">
                  {unitsReserved} held for staff, not counted above
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="border-border/70 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            Registry
          </span>
          {notes.map((note) => (
            <span key={note} className="text-muted-foreground text-xs">
              {note}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
