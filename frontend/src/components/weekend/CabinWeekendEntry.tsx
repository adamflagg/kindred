/**
 * The cabin-weekend chip's stats-bar entry point — Home 1 (kindred#2648 UI
 * half). Owns the modal's open state, exactly as `PushWriteInsEntry` owns
 * `PushWriteInsModal`'s: rendered through `WeekendStatsBar`'s inline chip
 * slot (Q1, decided 2026-08-31 — inline in the stats bar, not the trailing
 * slot the push/compare buttons use).
 *
 * Hidden for a user without `bunking.manage`. The confirm write is gated
 * server-side by the collection's existing rule regardless (kindred#2648's
 * backend contract adds no new permission), but the affordance follows the
 * same RBAC placement every other board write control does (CLAUDE.md §4).
 */
import { useState } from 'react'

import { useSessionAttributionQueue } from '../../hooks/useSessionAttributionQueue'
import type { RosterPartyRow } from '../../types/lodging'
import { CabinWeekendChip } from './CabinWeekendChip'
import { CabinWeekendModal } from './CabinWeekendModal'

export interface CabinWeekendEntryProps {
  /** `0` is "no weekend selected" and hides the entry. */
  sessionCmId: number
  weekendLabel: string
  canManage: boolean
  /**
   * Threaded straight through to `CabinWeekendModal` (kindred#2650) — this
   * chip holds no roster of its own, `WeekendRosterPage` does. See that
   * modal's own doc for why.
   */
  parties?: RosterPartyRow[]
  /** Threaded straight through to `CabinWeekendModal`. */
  onOpenFamily?: ((party: RosterPartyRow) => void) | undefined
}

export function CabinWeekendEntry({
  sessionCmId,
  weekendLabel,
  canManage,
  parties = [],
  onOpenFamily,
}: CabinWeekendEntryProps) {
  const [open, setOpen] = useState(false)
  // Hooks run unconditionally; the render guard below is what stops a hidden
  // entry from showing anything — the query itself stays cheap (a single
  // React Query cache slot the modal, if opened elsewhere, would share).
  const { data } = useSessionAttributionQueue()

  const visible = canManage && sessionCmId > 0
  if (!visible) return null

  const count = (data ?? []).filter(
    (i) => !i.isStale && i.candidates.some((c) => c.sessionCmId === sessionCmId)
  ).length

  return (
    <>
      <CabinWeekendChip
        count={count}
        onClick={() => {
          setOpen(true)
        }}
      />
      <CabinWeekendModal
        isOpen={open}
        onClose={() => {
          setOpen(false)
        }}
        weekendCmId={sessionCmId}
        weekendLabel={weekendLabel}
        parties={parties}
        onOpenFamily={onOpenFamily}
      />
    </>
  )
}
