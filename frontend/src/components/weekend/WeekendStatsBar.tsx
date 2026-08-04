/**
 * The weekend's numbers, in the contextual-bar grammar the summer session
 * view uses (`SessionStatsCompact`): icon, bold figure, muted label, pipe
 * separators, one line.
 *
 * The unit is the SPACE, not the bed. A family holds a whole cabin whether or
 * not it fills it, so a cabin sleeping 8 housing a family of 3 leaves five
 * beds no other family can use — counting beds reports comfortable headroom
 * on a weekend that has run out of rooms. Beds still answer whether a
 * PARTICULAR family fits a PARTICULAR cabin, which is the board's question,
 * so they stay on the bar but never lead.
 *
 * The space count is provisional: merging or splitting cabins on the board
 * moves it, which the title on the spaces figure says.
 */
import { AlertCircle, BedDouble, Home, Users } from 'lucide-react'

import type { RosterCountSummary } from '../../types/lodging'

export interface WeekendStatsBarProps {
  counts: RosterCountSummary
  bedsNeeded: number
  /**
   * Family spaces whose capacity nobody has recorded. NOT
   * `counts.units_capacity_unknown`, which spans staff holds and building
   * rows — on real 2026 data that says 5 where only 2 of the 79 placeable
   * spaces are unmeasured.
   */
  spacesUnmeasured: number
}

const DIVIDER = <span className="text-border hidden sm:inline">|</span>

export function WeekendStatsBar({ counts, bedsNeeded, spacesUnmeasured }: WeekendStatsBarProps) {
  const partiesTotal = counts.parties_total ?? 0
  const partiesAssigned = counts.parties_assigned ?? 0
  const partiesUnassigned = counts.parties_unassigned ?? 0
  const spaces = counts.units_family_available ?? 0
  const unitsTotal = counts.units_total ?? 0
  const unitsReserved = counts.units_reserved ?? 0
  const beds = counts.beds_family_available ?? 0
  const spare = spaces - partiesTotal

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
    <div className="border-border/50 border-b py-2.5">
      {/* `min-h-10` matches summer's bar, which is the same `py-2.5` around a
          segmented area control 40px tall. This one holds a single line of
          `text-sm` — 20px — so identical padding still reads 20px tighter. */}
      <div className="flex min-h-10 flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Users className="text-primary h-4 w-4 flex-shrink-0" />
          <span className="tabular-nums">
            <span className="font-semibold">{partiesAssigned}</span>
            <span className="text-muted-foreground">/{partiesTotal}</span>
          </span>
          <span className="text-muted-foreground">placed</span>
        </div>

        {DIVIDER}

        <div className="flex items-center gap-2">
          <Home className="text-bark-500 dark:text-bark-400 h-4 w-4 flex-shrink-0" />
          <span
            className="font-semibold tabular-nums"
            title="Merging or splitting cabins on the board changes this count"
          >
            {spaces}
          </span>
          <span className="text-muted-foreground">spaces</span>
          <span className="text-muted-foreground tabular-nums">
            ({spare < 0 ? `${String(Math.abs(spare))} short` : `${String(spare)} spare`})
          </span>
          {unitsReserved > 0 && (
            <span className="text-muted-foreground" title="Held for staff, excluded from spaces">
              · {unitsReserved} held
            </span>
          )}
        </div>

        {DIVIDER}

        {/* Beds answer "does this family fit this cabin" — the board's
            question. Present, never leading. */}
        <div className="flex items-center gap-2">
          <BedDouble className="text-muted-foreground h-4 w-4 flex-shrink-0" />
          <span className="tabular-nums">
            <span className="font-semibold">{bedsNeeded}</span>
            <span className="text-muted-foreground">/{beds}</span>
          </span>
          <span className="text-muted-foreground">beds</span>
          {spacesUnmeasured > 0 && (
            <span className="text-muted-foreground">
              ({spacesUnmeasured} unmeasured space{spacesUnmeasured === 1 ? '' : 's'})
            </span>
          )}
        </div>

        {partiesUnassigned > 0 && (
          <>
            {DIVIDER}
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="font-semibold tabular-nums">{partiesUnassigned}</span>
              <span>need a cabin</span>
            </div>
          </>
        )}

        {/* Registry state, not an alarm: a note true of every cabin describes
            the registry rather than warning about it. */}
        {notes.length > 0 && (
          <span className="text-muted-foreground/80 text-xs">{notes.join(' · ')}</span>
        )}
      </div>
    </div>
  )
}
