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
import { QueryGuard } from '../../QueryGuard'
import { BUTTON_SECONDARY } from './lodgingStyles'
import { SessionAttributionRow } from './SessionAttributionRow'

const NOTHING_WAITING = 'No cabins are waiting on a weekend.'

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
                <SessionAttributionRow
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
