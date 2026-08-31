/**
 * The cabin-weekend chip's detail modal — Home 1's condensed form popping
 * open (kindred#2648 UI half, Q1/Q2 decided 2026-08-31). `ui/Modal` shell,
 * `SessionAttributionRow` for the shared row rendering, same as the admin
 * queue tab (Home 2).
 *
 * CONDENSED STAYS CONDENSED: unlike the admin tab, this never shows a stale
 * row and offers no toggle to reveal one — that detail belongs to the
 * always-accessible home this modal links out to ("See the full list").
 * Nothing places itself and nothing here pre-selects a candidate as chosen —
 * `SessionAttributionRow` only marks the backend's suggestion, exactly as it
 * does on the admin tab.
 */
import { Link } from 'react-router'

import { useSessionAttributionQueue } from '../../hooks/useSessionAttributionQueue'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, LABEL, MUTED_PILL } from '../admin/lodging/lodgingStyles'
import { SessionAttributionRow } from '../admin/lodging/SessionAttributionRow'
import { Modal } from '../ui/Modal'

export interface CabinWeekendModalProps {
  isOpen: boolean
  onClose: () => void
  weekendCmId: number
  weekendLabel: string
}

export function CabinWeekendModal({
  isOpen,
  onClose,
  weekendCmId,
  weekendLabel,
}: CabinWeekendModalProps) {
  const { data, confirm, isConfirming } = useSessionAttributionQueue()
  const items = data ?? []

  const here = items.filter(
    (i) => !i.isStale && i.candidates.some((c) => c.sessionCmId === weekendCmId)
  )
  const elsewhere = items.filter(
    (i) => !i.isStale && !i.candidates.some((c) => c.sessionCmId === weekendCmId)
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Which weekend is this cabin for? · ${weekendLabel}`}
      size="xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed">
          CampMinder only stores one cabin per household or person per year, so when a party is
          booked into more than one weekend it can&rsquo;t say which weekend the cabin is for.
        </p>

        {here.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Nothing waiting on this weekend.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {here.map((item) => (
              <SessionAttributionRow
                key={item.id}
                item={item}
                isConfirming={isConfirming}
                onConfirm={(sessionCmId) => {
                  confirm(item, sessionCmId)
                }}
              />
            ))}
          </div>
        )}

        {elsewhere.length > 0 && (
          <div className="border-border/50 mt-1 border-t pt-4">
            <p className={LABEL}>Also waiting, for other weekends</p>
            <div className="flex flex-wrap gap-2">
              {elsewhere.map((item) => (
                <span key={item.id} className={MUTED_PILL}>
                  {item.rawValue} · {item.candidates.map((c) => c.short).join('/')}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="border-border/50 flex flex-wrap items-center gap-2 border-t pt-4">
          <Link to="/manage/lodging/attribution" onClick={onClose} className={BUTTON_SECONDARY}>
            See the full list
          </Link>
          <button type="button" onClick={onClose} className={`${BUTTON_PRIMARY} ml-auto`}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
