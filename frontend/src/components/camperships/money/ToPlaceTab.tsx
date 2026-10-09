import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
import { useAidToPlace } from '../../../hooks/camperships/useAidToPlace'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import type { AidView } from '../kit/asOf'
import { CS_TOOLBAR_LEAD, CS_TOOLBAR_STATUS } from '../kit/csType'
import { AidFilterChip } from '../kit/Toolbar'
import { hiddenTicks } from '../requests/ticks'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { BulkPlaceBar } from './BulkPlaceBar'
import { BulkPlaceDialog } from './BulkPlaceDialog'
import { bulkEligible, bulkPlan, MAX_BULK_LINES } from './bulkPlaceModel'
import { GrantLinesGroup } from './GrantLinesGroup'
import { LeftLines } from './LeftLines'
import { toPlaceHref } from './moneyTabs'
import { ReclassifiedLines } from './ReclassifiedLines'
import { lineKey } from './toPlaceColumns'
import { ToPlaceOpenRow, type LineAccess } from './ToPlaceOpenRow'
import { ToPlaceTable } from './ToPlaceTable'
import {
  allLines,
  grantCsvRows,
  grantLinesFor,
  leadWords,
  lineFamily,
  openLineWords,
  toPlaceCsvName,
} from './toPlaceModel'
import { useInFlightLines, type InFlightLines } from './useInFlightLines'
import { useToPlaceNotes } from './useToPlaceNotes'

/** The last write's outcome, for the season it was written in (#2990 F). */
interface WriteNote {
  readonly tone: 'done' | 'refused'
  readonly words: string
  /** The full words behind a short result, for the status's title. */
  readonly title?: string | undefined
  readonly year: number
}

/** What the family chip says in its title, the old sentence (§6; answers 1a). */
const oneFamilyTitle = (family: string) =>
  `${family}: the household and every household that shares its requests. ✕ shows every family.`

/**
 * One read of To place and the work on it: the toolbar's one row (the open count, the switch, the
 * status of the last action, the search, the bulk buttons and Download CSV), the table with its
 * opened rows, the outside grants, and the lines left or reclassified. Keyed by season and scope, so
 * the checks belong to the read they were made on.
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
  onDone: (words: string, title?: string) => void
  onRefused: (words: string) => void
}) {
  const navigate = useNavigate()
  const marks = useToPlaceNotes()
  const open = useMemo(() => data.groups.flatMap((g) => g.lines), [data.groups])
  // The outside-grant lines (the fourth group) count in the open line; a failed or loading grants
  // read counts none, and the camp-aid groups stand on their own.
  const grants = useAidGrants()
  const grantLines = useMemo(
    () => grantLinesFor(grants.data?.needs_camper ?? [], householdCmId),
    [grants.data, householdCmId]
  )
  const sessions = useAidSessionNames(data.year)
  const grantCsv = useMemo(() => grantCsvRows(grantLines, sessions), [grantLines, sessions])
  const every = useMemo(() => allLines(data), [data])
  // The one search box, held here so the grant lines answer it too (the mock's `matches`).
  const [query, setQuery] = useState('')
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
    (words: string, placed: readonly number[], title?: string) => {
      const gone = new Set(placed.map(String))
      setSelected((current) => new Set([...current].filter((k) => !gone.has(k))))
      setAtClick(null)
      onDone(words, title)
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
        marks={marks}
        onDone={onDone}
        onRefused={onRefused}
      />
    ),
    [data.year, view, householdCmId, access, inFlight, marks, onDone, onRefused]
  )

  const grantAmounts = grantLines.map((n) => n.grant)
  const lead = leadWords(data.open_count, data.open_total, grantAmounts)
  // The one status slot (§5–6): the checked count while anything is checked, else the last write's
  // result or refusal. It truncates; the full words are its title.
  const status =
    checked.length > 0
      ? {
          text: `${String(checked.length)} checked${hidden.size > 0 ? ` · ${String(hidden.size)} hidden` : ''}`,
          title: `${String(checked.length)} checked${hidden.size > 0 ? `, ${String(hidden.size)} of them hidden by the search` : ''}. Checks stay when you search; the dialog lists the hidden ones.`,
          refused: false,
        }
      : shown !== null
        ? {
            text: shown.tone === 'done' ? `✓ ${shown.words}` : shown.words,
            title: shown.tone === 'done' ? `✓ ${shown.title ?? shown.words}` : shown.words,
            refused: shown.tone === 'refused',
          }
        : null
  const scoped = every.find((l) => l.household_cm_id === householdCmId)
  const family = scoped === undefined ? 'This family' : lineFamily(scoped).text

  return (
    <div className="space-y-3">
      <ToPlaceTable
        data={data}
        view={view}
        marks={marks}
        csvFilename={toPlaceCsvName(data.year, householdCmId)}
        csvAppend={grantCsv}
        renderRow={renderRow}
        selected={access.casework ? selected : undefined}
        onSelectedChange={access.casework ? setSelected : undefined}
        onMatchingChange={access.casework ? onMatchingChange : undefined}
        query={query}
        onQueryChange={setQuery}
        toolbarLead={
          <span
            className={CS_TOOLBAR_LEAD}
            title={openLineWords(data.open_count, data.open_total, grantAmounts)}
          >
            {lead.head}
            <span className="text-muted-foreground font-normal"> · {lead.rest}</span>
          </span>
        }
        toolbarAfterGrouping={
          householdCmId === null ? undefined : (
            <AidFilterChip
              title={oneFamilyTitle(family)}
              onClear={() => void navigate(toPlaceHref(view, null))}
            >
              One family
            </AidFilterChip>
          )
        }
        toolbarStatus={
          status === null ? undefined : (
            <span
              className={
                status.refused
                  ? CS_TOOLBAR_STATUS.replace(
                      'text-muted-foreground',
                      'text-amber-700 dark:text-amber-400'
                    )
                  : CS_TOOLBAR_STATUS
              }
              title={status.title}
            >
              {status.text}
            </span>
          )
        }
        toolbarActions={
          access.casework ? (
            <BulkPlaceBar
              count={checked.length}
              exact={exact.length}
              onConfirmExact={() => {
                setSelected((current) => new Set([...current, ...firstExact]))
                setAtClick(new Set(firstExact))
              }}
              onConfirmChecked={() => setAtClick(new Set(checked))}
              onClear={() => setSelected(new Set())}
            />
          ) : undefined
        }
      />
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
      <GrantLinesGroup
        view={view}
        householdCmId={householdCmId}
        canWork={access.casework}
        query={query}
        onDone={onDone}
      />
      <LeftLines
        view={view}
        lines={data.left ?? []}
        total={data.left_total ?? 0}
        year={data.year}
        canWork={access.casework}
        onDone={onDone}
        onRefused={onRefused}
      />
      <ReclassifiedLines
        view={view}
        lines={data.reclassified ?? []}
        total={data.reclassified_total ?? 0}
      />
    </div>
  )
}

/**
 * Money › To place (spec §8.1; D12, D16, D26, D58, D62, D104, D151, D152; final UX, money-to-place.html):
 * camp-aid lines no single request takes, grouped by reason, each with the dashboard's suggestion, its
 * evidence and what Confirm will mark Posted; the lines left at family level and those reclassified
 * apart. Live only. Casework confirms, splits, places elsewhere, confirms in bulk and leaves; `rules`
 * reclassifies. `householdCmId` scopes it to one family (`?household=`; P-8, ruling C), shown as a
 * removable chip in the toolbar.
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
    (words: string, title?: string) => setNote({ tone: 'done', words, title, year: view.year }),
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
      {/* Ruling I: the server's notes, shown so the owner reads them in place (the mock bolds each term). */}
      <AidDefinitionNotes surface="money-to-place" boldTerm />
    </div>
  )
}
