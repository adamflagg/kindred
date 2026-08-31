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
   * Rendered right-aligned INSIDE this bar's own row (the write-in push
   * entry, kindred#2477). A slot rather than a sibling because the bar owns
   * the band's bottom rule: a control placed beside the bar leaves that rule
   * stopping short of it, which is exactly what the owner caught on the
   * first visual pass (2026-08-24).
   */
  trailing?: ReactNode
  /**
   * The cabin-weekend attribution chip (kindred#2648 UI half), INLINE with
   * the bar's other figures rather than in `trailing` — Q1, decided
   * 2026-08-31. `trailing` is the right-aligned action group (Compare, Push
   * write-ins); this sits with the figures it is one of, ahead of it.
   */
  attributionChip?: ReactNode
}

const DIVIDER = <span className="text-border hidden sm:inline">|</span>

export function WeekendStatsBar({
  counts,
  spotsNeeded,
  spacesUnmeasured,
  trailing,
  attributionChip,
}: WeekendStatsBarProps) {
  const partiesTotal = counts.parties_total ?? 0
  const partiesAssigned = counts.parties_assigned ?? 0
  const partiesUnassigned = counts.parties_unassigned ?? 0
  const spaces = counts.units_family_available ?? 0
  const unitsTotal = counts.units_total ?? 0
  const unitsStaffHousing = counts.units_staff_housing ?? 0
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
          {/* Write-ins and staff housing were DIFFERENT facts with different
              remedies, and were one number until `units_staff_housing` split
              them out: a written-into cabin is inventory that comes back next
              weekend — somebody the system does not know about is sleeping in
              it, most often non-rostered weekend staff — while a staff cabin
              never comes back, since it houses full-time staff who are not
              enrolled per session and was never part of the weekend's
              inventory to begin with.

              The write-ins chip that used to sit beside this one was struck
              2026-08-21 (kindred#2503): its tooltip said a write-in was
              "excluded from family spaces", which stopped being true the
              moment a sized write-in left the cabin available with beds free
              (Task 4). The owner ruled the chip is not wanted rather than
              reworded. Staff housing keeps its own count regardless — it was
              never inventory, so it needs a different remedy than "release
              it", and that distinction did not depend on the write-ins
              chip's wording. */}
          {unitsStaffHousing > 0 && (
            <Tooltip
              content="Permanent staff housing, never part of the weekend's inventory"
              aria-label={`${String(unitsStaffHousing)} staff cabins`}
              className="text-muted-foreground"
            >
              · {unitsStaffHousing} staff
            </Tooltip>
          )}
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

        {trailing !== undefined && <div className="ml-auto flex-shrink-0">{trailing}</div>}
      </div>
    </div>
  )
}
