/**
 * The weekend's numbers, in the contextual-bar grammar the summer session
 * view uses (`SessionStatsCompact`): icon, bold figure, muted label, pipe
 * separators, one line.
 *
 * The unit is the SPACE, not the spot. A family holds a whole cabin whether
 * or not it fills it, so a cabin sleeping 8 housing a family of 3 leaves
 * five spots no other family can use — counting spots reports comfortable
 * headroom on a weekend that has run out of rooms. Spots still answer
 * whether a PARTICULAR family fits a PARTICULAR cabin, which is the board's
 * question, so they stay on the bar but never lead. (Still rendered as
 * "beds" below — staff say that colloquially, and the code being
 * unambiguous matters more than the label changing; kindred#2582.)
 *
 * The space count is provisional: merging or splitting cabins on the board
 * moves it, which the title on the spaces figure says.
 *
 * The bar is one line, and that is a budget. Placed, spaces and beds, the
 * needs-a-cabin warning, the attribution chip and the right-aligned Compare
 * and Push write-ins controls together overran it and wrapped to two, so the
 * staff-housing count came out (2026-09-01). It was not wrong — permanent
 * staff cabins were never the weekend's inventory, which is why they are
 * excluded from spaces rather than counted in them — it was just the figure
 * staff act on least, and it is still visible where they DO act on it: the
 * admin unit list, the unit form's allocation field, and the board legend's
 * dashed square. Anything added here from now on costs one of the figures
 * above it.
 */
import { AlertCircle, BedDouble, Home, Users } from 'lucide-react'
import type { ReactNode } from 'react'

import type { RosterCountSummary } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'

export interface WeekendStatsBarProps {
  counts: RosterCountSummary
  spotsNeeded: number
  /**
   * Family spaces whose capacity nobody has recorded. NOT
   * `counts.units_capacity_unknown`: that asks about the planning inventory,
   * which keeps a cabin held back this weekend because it returns next
   * weekend. This one asks what a family could be put in RIGHT NOW, which is
   * the reading that matches the bed count beside it. See
   * `countUnmeasuredSpaces`.
   */
  spacesUnmeasured: number
  /**
   * The cabin-weekend attribution chip (kindred#2648 UI half), INLINE with the
   * bar's other figures — Q1, decided 2026-08-31. It is a figure, not an
   * action, and it sits with the figures it is one of.
   *
   * THE ONLY SLOT LEFT. There was a `trailing` one beside it, holding the
   * right-aligned Compare and Push write-ins controls; 2026-09-02 moved those
   * to the page header, where summer's `SessionHeader` keeps its actions.
   * That is also what stopped this bar wrapping to two lines — the pressure
   * kindred#2686 relieved by striking the staff-housing count a day earlier.
   */
  attributionChip?: ReactNode
}

const DIVIDER = <span className="text-border hidden sm:inline">|</span>

export function WeekendStatsBar({
  counts,
  spotsNeeded,
  spacesUnmeasured,
  attributionChip,
}: WeekendStatsBarProps) {
  const partiesTotal = counts.parties_total ?? 0
  const partiesAssigned = counts.parties_assigned ?? 0
  const partiesUnassigned = counts.parties_unassigned ?? 0
  const spaces = counts.units_family_available ?? 0
  const unitsTotal = counts.units_total ?? 0
  const spots = counts.spots_family_available ?? 0
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
          {/* kindred#2177: all three notes in this group were `title` on a
              plain `<span>`, so a staff member on a tablet could read the
              figure and never why it moves. */}
          {/* Each figure names its own unit. As a `<span>` these were never
              focusable and the word beside them was enough; as tab stops they
              were three buttons called "79", "3" and "21", because the word
              lives in a sibling the accessible name cannot reach. Each label
              still CONTAINS its visible text, so the name matches what is on
              screen (WCAG 2.5.3). */}
          <Tooltip
            content="Merging or splitting cabins on the board changes this count"
            aria-label={`${String(spaces)} spaces`}
            className="font-semibold tabular-nums"
          >
            {spaces}
          </Tooltip>
          <span className="text-muted-foreground">spaces</span>
          <span className="text-muted-foreground tabular-nums">
            ({spare < 0 ? `${String(Math.abs(spare))} short` : `${String(spare)} spare`})
          </span>
          {/* Two chips used to hang off this figure and both are gone. The
              write-ins one went 2026-08-21 (kindred#2503): its tooltip said a
              write-in was "excluded from family spaces", which stopped being
              true the moment a sized write-in left the cabin available with
              beds free. The staff-housing one (`units_staff_housing`) went
              2026-09-01, for room rather than for being wrong — see the
              header comment. */}
        </div>

        {DIVIDER}

        {/* Beds answer "does this family fit this cabin" — the board's
            question. Present, never leading. */}
        <div className="flex items-center gap-2">
          <BedDouble className="text-muted-foreground h-4 w-4 flex-shrink-0" />
          <span className="tabular-nums">
            <span className="font-semibold">{spotsNeeded}</span>
            <span className="text-muted-foreground">/{spots}</span>
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

        {attributionChip !== undefined && (
          <>
            {DIVIDER}
            <div className="flex items-center gap-2">{attributionChip}</div>
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
