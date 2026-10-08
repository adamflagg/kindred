import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidToPlace } from '../../../hooks/camperships/useAidToPlace'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import type { AidView } from '../kit/asOf'
import { CS_LINK } from '../kit/csType'
import { formatMoney } from '../kit/money'
import { hiddenTicks } from '../requests/ticks'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { BulkPlaceBar } from './BulkPlaceBar'
import { BulkPlaceDialog } from './BulkPlaceDialog'
import { bulkEligible, bulkPlan, MAX_BULK_LINES } from './bulkPlaceModel'
import { LeftLines } from './LeftLines'
import { toPlaceHref } from './moneyTabs'
import { ReclassifiedLines } from './ReclassifiedLines'
import { lineKey } from './toPlaceColumns'
import { ToPlaceOpenRow, type LineAccess } from './ToPlaceOpenRow'
import { ToPlaceTable } from './ToPlaceTable'
import { allLines, toPlaceCsvName } from './toPlaceModel'
import { DONE_NOTE } from './toPlaceStyles'
import { useInFlightLines, type InFlightLines } from './useInFlightLines'

/** The last write's outcome, for the season it was written in (#2990 F). */
interface WriteNote {
  readonly tone: 'done' | 'refused'
  readonly words: string
  readonly year: number
}

/**
 * One read of To place and the work on it: the result line, the open count, the bulk bar and its
 * dialog, the table with its opened rows, and the lines left or reclassified. Keyed by season and
 * scope, so the checks belong to the read they were made on.
 */
function ToPlaceBody({
  data,
  view,
  householdCmId,
  access,
  inFlight,
  shown,
  onDone,
  onRefused,
}: {
  data: ApiAidToPlace
  view: AidView
  householdCmId: number | null
  access: LineAccess
  inFlight: InFlightLines
  shown: WriteNote | null
  onDone: (words: string) => void
  onRefused: (words: string) => void
}) {
  const open = useMemo(() => data.groups.flatMap((g) => g.lines), [data.groups])
  const every = useMemo(() => allLines(data), [data])
  // Bulk (§4.10; P-6): checks persist across a search (owner ruling 2026-10-02); they are line ids,
  // and a line the read no longer holds open (placed elsewhere) drops out of the plan.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [matching, setMatching] = useState<ReadonlySet<string> | null>(null)
  const onMatchingChange = useCallback(
    (keys: ReadonlySet<string>) =>
      setMatching((prev) =>
        prev !== null && prev.size === keys.size && [...keys].every((k) => prev.has(k))
          ? prev
          : keys
      ),
    []
  )
  const openKeys = useMemo(() => new Set(open.map(lineKey)), [open])
  const checked = useMemo(() => [...selected].filter((k) => openKeys.has(k)), [selected, openKeys])
  const hidden = useMemo(
    () => hiddenTicks(checked, matching, openKeys),
    [checked, matching, openKeys]
  )
  const exact = useMemo(() => open.filter(bulkEligible).map(lineKey), [open])
  // R1-13: one click checks at most the route's 200; the button says so past that.
  const firstExact = useMemo(() => exact.slice(0, MAX_BULK_LINES), [exact])
  // The bulk dialog (plan review I4): the keys checked at the click, while it shows. The plan itself
  // is derived from the CURRENT read on every render, so a Confirm after a refusal (the write layer
  // refreshes the reads before it rejects) sends what is still open, never the refused body, and a
  // line someone else placed meanwhile is counted as gone.
  const [atClick, setAtClick] = useState<ReadonlySet<string> | null>(null)
  const plan = useMemo(
    () => (atClick === null ? null : bulkPlan(open, atClick, hidden, (txn) => inFlight.has(txn))),
    [atClick, open, hidden, inFlight]
  )
  const bulkDone = useCallback(
    (words: string, placed: readonly number[]) => {
      const gone = new Set(placed.map(String))
      setSelected((current) => new Set([...current].filter((k) => !gone.has(k))))
      setAtClick(null)
      onDone(words)
    },
    [onDone]
  )
  const renderRow = useCallback(
    (line: ApiAidToPlaceLine) => (
      <ToPlaceOpenRow
        key={line.transaction_cm_id}
        line={line}
        year={data.year}
        view={view}
        scope={householdCmId}
        access={access}
        inFlight={inFlight}
        onDone={onDone}
        onRefused={onRefused}
      />
    ),
    [data.year, view, householdCmId, access, inFlight, onDone, onRefused]
  )

  return (
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
      {access.casework && (
        <BulkPlaceBar
          count={checked.length}
          hidden={hidden.size}
          exact={exact.length}
          onConfirmExact={() => {
            setSelected((current) => new Set([...current, ...firstExact]))
            setAtClick(new Set(firstExact))
          }}
          onConfirmSelected={() => setAtClick(new Set(checked))}
          onClear={() => setSelected(new Set())}
        />
      )}
      {access.casework && (
        <BulkPlaceDialog
          plan={plan}
          year={data.year}
          allLines={every}
          onClose={() => setAtClick(null)}
          onDone={bulkDone}
          onRefused={onRefused}
        />
      )}
      <ToPlaceTable
        data={data}
        view={view}
        csvFilename={toPlaceCsvName(data.year, householdCmId)}
        renderRow={renderRow}
        selected={access.casework ? selected : undefined}
        onSelectedChange={access.casework ? setSelected : undefined}
        onMatchingChange={access.casework ? onMatchingChange : undefined}
      />
      <LeftLines
        lines={data.left ?? []}
        total={data.left_total ?? 0}
        year={data.year}
        canWork={access.casework}
        onDone={onDone}
        onRefused={onRefused}
      />
      <ReclassifiedLines lines={data.reclassified ?? []} total={data.reclassified_total ?? 0} />
    </div>
  )
}

/**
 * Money › To place (spec §8.1; D12, D16, D26, D58, D62, D104, D151, D152; money-v2.html): camp-aid
 * lines no single request takes, grouped by reason, each with the dashboard's suggestion, its
 * evidence and what Confirm will mark posted; the lines left at family level and those reclassified
 * apart. Live only. Casework confirms, splits, places elsewhere, confirms in bulk and leaves; `rules`
 * reclassifies. `householdCmId` scopes it to one family (`?household=`; P-8, ruling C).
 */
export function ToPlaceTab({
  view,
  householdCmId = null,
}: {
  view: AidView
  householdCmId?: number | null | undefined
}) {
  const toPlace = useAidToPlace(householdCmId)
  const { hasPermission } = usePermissions()
  const access = useMemo(
    (): LineAccess => ({
      casework: hasPermission(Permission.FINANCIAL_AID_CASEWORK),
      rules: hasPermission(Permission.FINANCIAL_AID_RULES),
    }),
    [hasPermission]
  )
  // The outcome of the last write lives here, not in a panel: a refusal that drops its line from the
  // table would otherwise unmount the only place it was shown (review I1).
  const [note, setNote] = useState<WriteNote | null>(null)
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

  return (
    <div className="space-y-3">
      {householdCmId !== null && (
        <p className="text-sm">
          One family&apos;s lines: the household and every household that shares its requests.{' '}
          <Link className={CS_LINK} to={toPlaceHref(view, null)}>
            All Families ›
          </Link>
        </p>
      )}
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
            <ToPlaceBody
              key={`${String(data.year)}:${String(householdCmId ?? 'all')}`}
              data={data}
              view={view}
              householdCmId={householdCmId}
              access={access}
              inFlight={inFlight}
              shown={shown}
              onDone={onDone}
              onRefused={onRefused}
            />
          )
        }
      </QueryGuard>
      {/* Ruling I: the server's notes, shown so the owner reads them in place (no text changed here). */}
      <AidDefinitionNotes surface="money-to-place" />
    </div>
  )
}
