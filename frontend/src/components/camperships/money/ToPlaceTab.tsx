import { useCallback, useMemo, useState } from 'react'

import { Permission } from '../../../constants/permissions'
import { useAidToPlace } from '../../../hooks/camperships/useAidToPlace'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import type { AidView } from '../kit/asOf'
import { formatMoney } from '../kit/money'
import { LeftLines } from './LeftLines'
import { ToPlaceLinePanel, type LinePanelAccess } from './ToPlaceLinePanel'
import { ToPlaceTable } from './ToPlaceTable'
import { toPlaceCsvName } from './toPlaceModel'
import { DONE_NOTE } from './toPlaceStyles'
import { useInFlightLines } from './useInFlightLines'

/**
 * Money › To place (spec §8.1; D12, D16, D58, D62, D151, D152; money-v2.html): camp-aid lines no
 * single request takes, grouped by reason, each with Kindred's suggestion, its evidence and what
 * Confirm will tick; the lines left at family level apart. Live only. Casework confirms and leaves;
 * `rules` reclassifies (PR 2).
 */
export function ToPlaceTab({ view }: { view: AidView }) {
  const toPlace = useAidToPlace()
  const { hasPermission } = usePermissions()
  const access = useMemo(
    (): LinePanelAccess => ({
      casework: hasPermission(Permission.FINANCIAL_AID_CASEWORK),
      rules: hasPermission(Permission.FINANCIAL_AID_RULES),
    }),
    [hasPermission]
  )
  // The outcome of the last write lives here, not in a panel: a refusal that drops its line from the
  // table would otherwise unmount the only place it was shown (review I1).
  const [note, setNote] = useState<{
    tone: 'done' | 'refused'
    words: string
    year: number
  } | null>(null)
  const onDone = useCallback(
    (words: string) => setNote({ tone: 'done', words, year: view.year }),
    [view.year]
  )
  const onRefused = useCallback(
    (words: string) => setNote({ tone: 'refused', words, year: view.year }),
    [view.year]
  )
  const inFlight = useInFlightLines()
  // Another season is another page: its last write's note is not shown (no reset effect needed).
  const shown = note !== null && note.year === view.year ? note : null
  const renderPanel = useCallback(
    (line: ApiAidToPlaceLine) => (
      <ToPlaceLinePanel
        key={line.transaction_cm_id}
        line={line}
        year={view.year}
        view={view}
        access={access}
        inFlight={inFlight}
        onDone={onDone}
        onRefused={onRefused}
      />
    ),
    [view, access, inFlight, onDone, onRefused]
  )

  return (
    <QueryGuard
      isLoading={toPlace.isLoading}
      // Owner ruling Group 5: a failed background refetch keeps what loaded.
      error={toPlace.data ? null : toPlace.error}
      data={toPlace.data}
      label="To place"
    >
      {(data) =>
        data.skipped ? (
          <div className="card-lodge text-muted-foreground p-6 text-sm">
            Nothing to place: {data.skipped}.
          </div>
        ) : (
          <div className="space-y-3">
            {shown?.tone === 'done' && <p className={DONE_NOTE}>✓ {shown.words}</p>}
            {shown?.tone === 'refused' && <p className={AMBER_NOTE}>{shown.words}</p>}
            <p className="text-sm">
              <span className="font-medium">
                {`${String(data.open_count)} ${data.open_count === 1 ? 'line' : 'lines'} open · ${formatMoney(data.open_total)}`}
              </span>{' '}
              <span className="text-muted-foreground text-xs">
                Click a line to see what it could belong to and what Confirm does.
              </span>
            </p>
            <ToPlaceTable
              data={data}
              csvFilename={toPlaceCsvName(data.year, null)}
              renderPanel={renderPanel}
            />
            <LeftLines
              lines={data.left ?? []}
              total={data.left_total ?? 0}
              year={data.year}
              canWork={access.casework}
              onDone={onDone}
              onRefused={onRefused}
            />
          </div>
        )
      }
    </QueryGuard>
  )
}
