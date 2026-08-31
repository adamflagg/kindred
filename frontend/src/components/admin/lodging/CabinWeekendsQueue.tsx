/**
 * The cabin-weekend attribution queue's admin tab.
 *
 * Home 2 in the approved design (kindred#2648 UI half): the
 * always-accessible surface, unlike the board's stats-bar chip modal (Home
 * 1), which only exists while a weekend is selected. Both read
 * `useSessionAttributionQueue` and render `SessionAttributionRow` — this
 * component adds only the stale-rows toggle, defaulted hidden per the
 * approved design.
 */
import { useState } from 'react'

import { useSessionAttributionQueue } from '../../../hooks/useSessionAttributionQueue'
import type { SessionAttributionQueueItem } from '../../../hooks/useSessionAttributionQueue'
import { useHouseholdFamilyLabel } from '../../../hooks/useWeekendRoster'
import { QueryGuard } from '../../QueryGuard'
import { BUTTON_SECONDARY } from './lodgingStyles'
import { SessionAttributionRow } from './SessionAttributionRow'

const NOTHING_WAITING = 'No cabins are waiting on a weekend.'

/**
 * One row, resolving ITS OWN family name (kindred#2650).
 *
 * `useHouseholdFamilyLabel` is a hook and this tab has no roster to build a
 * lookup from up front — each row is its own household, so each row fetches
 * its own journey. `SessionAttributionRow` itself stays a plain function of
 * props; this is the one place that hook is called, satisfying the rules of
 * hooks (one call per mounted row, never inside the `.map()` below).
 *
 * No `onOpenFamily`: `FamilyDetailsPanel` needs a full roster `RosterPartyRow`
 * (adults, children, journey-driven housing state) that this admin route has
 * no way to build without pulling the whole roster — the board's modal has
 * one already loaded and wires the click there instead. A name with no click
 * beats a click that goes nowhere.
 */
function AttributionRow({
  item,
  onConfirm,
  isConfirming,
}: {
  item: SessionAttributionQueueItem
  onConfirm: (sessionCmId: number) => void
  isConfirming: boolean
}) {
  const familyName = useHouseholdFamilyLabel(item.householdCmId)
  return (
    <SessionAttributionRow
      item={item}
      isConfirming={isConfirming}
      onConfirm={onConfirm}
      familyName={familyName}
    />
  )
}

export function CabinWeekendsQueue() {
  const { isLoading, error, data, confirm, isConfirming } = useSessionAttributionQueue()
  const [showStale, setShowStale] = useState(false)

  return (
    <QueryGuard
      isLoading={isLoading}
      error={error}
      data={data}
      label="cabin weekends"
      emptyMessage={NOTHING_WAITING}
    >
      {(items) => {
        const staleCount = items.filter((i) => i.isStale).length
        const visible = items.filter((i) => showStale || !i.isStale)

        if (items.length === 0) {
          // QueryGuard's emptyMessage only fires on `!data`, and an empty
          // array is truthy — without this the settled-empty case renders a
          // blank page, matching UnresolvedAliasQueue's own guard.
          return (
            <p className="text-muted-foreground py-12 text-center text-sm">{NOTHING_WAITING}</p>
          )
        }

        return (
          <div className="flex flex-col gap-4">
            {staleCount > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowStale((current) => !current)
                  }}
                  className={BUTTON_SECONDARY}
                >
                  {showStale ? 'Hide outdated' : `Show ${String(staleCount)} outdated`}
                </button>
              </div>
            )}

            {visible.length === 0 ? (
              <p className="text-muted-foreground py-12 text-center text-sm">
                No cabins are waiting on a weekend.
              </p>
            ) : (
              visible.map((item) => (
                <AttributionRow
                  key={item.id}
                  item={item}
                  isConfirming={isConfirming}
                  onConfirm={(sessionCmId) => {
                    confirm(item, sessionCmId)
                  }}
                />
              ))
            )}
          </div>
        )
      }}
    </QueryGuard>
  )
}
