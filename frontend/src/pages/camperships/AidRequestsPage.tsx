import { ListChecks } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { ACTION_LINK, AMBER_NOTE } from '../../components/admin/lodging/lodgingStyles'
import { QueryGuard } from '../../components/QueryGuard'
import { aidHref } from '../../components/camperships/kit/asOf'
import type { AidRowNav } from '../../components/camperships/kit/AidTable'
import { campToday } from '../../components/camperships/kit/dates'
import type { EditorSave } from '../../components/camperships/kit/RequestEditor'
import { useEditorWalk } from '../../components/camperships/kit/useEditorWalk'
import { BulkBar, type TickResult } from '../../components/camperships/requests/BulkBar'
import { BulkConfirmDialog } from '../../components/camperships/requests/BulkConfirmDialog'
import { GridEditorRow } from '../../components/camperships/requests/GridEditorRow'
import { GridFiltersBar } from '../../components/camperships/requests/GridFiltersBar'
import {
  RequestsGrid,
  type HouseholdLinks,
} from '../../components/camperships/requests/RequestsGrid'
import { programGroups } from '../../components/camperships/requests/programLabel'
import { RequestViewNav } from '../../components/camperships/requests/RequestViewNav'
import {
  lensCounts,
  lensRows,
  stripCsvName,
  type RequestLens,
} from '../../components/camperships/requests/strip'
import {
  hiddenTicks,
  tickedLine,
  tickPlan,
  type TickAction,
  type TickPlan,
} from '../../components/camperships/requests/ticks'
import {
  useGridParams,
  type GridParamName,
} from '../../components/camperships/requests/useGridParams'
import {
  filterRows,
  viewCounts,
  type GridFilters,
  type RequestView,
} from '../../components/camperships/requests/views'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { Permission } from '../../constants/permissions'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useAidGrid } from '../../hooks/camperships/useAidGrid'
import { useAidApprovedRules } from '../../hooks/camperships/useAidRules'
import { useAidKeyAsk, useAidTickPosted } from '../../hooks/camperships/useAidWrites'
import { usePermissions } from '../../hooks/usePermissions'
import { useYear } from '../../hooks/useCurrentYear'
import type { ApiAidGridRow, ApiAidWriteOut } from '../../types/api-types'

/**
 * `/aid/requests` (§6.1, §6.2): the spine. One read, every view filtered from it in memory (D21,
 * §10). The view, the filters and Show IDs live in the URL (§3.6). The highlighted row is sync state,
 * mirrored to the URL (Decision 2; Ruling 2026-10-01 (plan review) I2).
 */
export default function AidRequestsPage() {
  const year = useYear()
  const asOf = useAidAsOf()
  const navigate = useNavigate()
  const {
    view,
    lens,
    stage,
    program,
    pool,
    round,
    tick,
    showIds,
    sort,
    group,
    row: rowParam,
    setParam,
    setParams,
  } = useGridParams()
  const grid = useAidGrid()
  // The rules name their programs and pools. A failed or missing read never blocks the grid: keys spelled out.
  const approvedRules = useAidApprovedRules(null)
  const today = campToday()
  const viewState = useMemo(() => ({ year, asOf }), [year, asOf])

  // I2: a ↓ must move on React's sync lane, not a router transition, so the next row's editor has
  // focus before the next key. Seeded once from ?row=; the URL follows below, with replace.
  const [highlighted, setHighlighted] = useState<string | null>(rowParam)
  // The URL follows each highlight move directly (replace); nothing mirrors it in an effect, so
  // nothing can race a navigation that follows.
  // The last key `onHighlight` set, so "Go back" can tell whether the walk really moved there.
  const lastMoved = useRef<string | null>(null)
  const onHighlight = useCallback(
    (key: string | null) => {
      lastMoved.current = key
      setHighlighted(key)
      setParam('row', key)
    },
    [setParam]
  )

  const rows = grid.data?.rows
  // A past-date read carries `as_of`; its rows' queues are null (Decision 11).
  const live = !grid.data?.as_of
  const filters = useMemo(
    (): GridFilters => ({ program, pool, round, tick, ids: null }),
    [program, pool, round, tick]
  )
  // The lens narrows every row and count (T4, RULED P2); each lens counts itself over the filters.
  const lensed = useMemo(() => (rows ? lensRows(rows, lens) : undefined), [rows, lens])
  const visible = useMemo(
    () => (lensed ? filterRows(lensed, view.key, filters) : []),
    [lensed, view.key, filters]
  )
  const counts = useMemo(
    () => (lensed ? viewCounts(lensed, filters, live) : null),
    [lensed, filters, live]
  )
  const countsByLens = useMemo(
    () => (rows ? lensCounts(rows, filters, live) : null),
    [rows, filters, live]
  )
  // T6: one Program dropdown, each budget pool a heading over its programs.
  const groups = useMemo(
    () =>
      programGroups(
        (rows ?? []).map((r) => ({ program: r.program_key, pool: r.pool })),
        approvedRules.data
      ),
    [rows, approvedRules.data]
  )

  const { hasPermission } = usePermissions()
  // Casework edits a live read only: a past date shows what was, not what can change.
  const canWork = hasPermission(Permission.FINANCIAL_AID_CASEWORK) && live
  const { mutateAsync: keyAsk } = useAidKeyAsk()
  // The hand Posted tick (#2996): the existing Posted write, one round at its decided amount.
  const { mutateAsync: tickPosted } = useAidTickPosted()
  const markPosted = useCallback(
    (r: ApiAidGridRow, round: number, amount: number) => {
      if (round !== 1 && round !== 2 && round !== 3)
        return Promise.reject(new Error('No such round'))
      return tickPosted({ year, body: { rows: [{ request_id: r.request_id, round, amount }] } })
    },
    [tickPosted, year]
  )
  const save = useCallback(
    (requestId: string, entry: EditorSave) =>
      keyAsk({
        requestId,
        // Decision 14: an appeal is dated the day it is keyed, camp time.
        body: { round: 2, amount: entry.amount, asked_on: campToday(), note: entry.reason },
      }),
    [keyAsk]
  )
  // Build ruling 2: a failure on a row the read no longer has is pruned, so it can't block a leave.
  const rowKeys = useMemo(() => new Set((rows ?? []).map((r) => r.request_id)), [rows])
  // The page's own `onHighlight`, never the bare setter: every walk move (↓, a jump back, Go back,
  // Esc) must write `?row=` too, or Back lands on a stale row (PR 2 final review, "PR 3 seams").
  const walk = useEditorWalk({ highlighted, setHighlighted: onHighlight, save, rowKeys })
  // Every way out the page owns saves first (Decision 4; I4). Without the walk, it just goes.
  const { leave } = walk
  // `leave` is stable while `onHighlight` and `save` are, so no ref is needed.
  const leaveThen = useCallback(
    (rowKey: string | null, go: () => void) => {
      if (canWork) leave(rowKey, go)
      else {
        if (rowKey !== null) onHighlight(rowKey)
        go()
      }
    },
    [canWork, leave, onHighlight]
  )
  // Bulk ticks (§4.10). Ticks persist across a search, a view and a filter (owner ruling
  // 2026-10-02): the selection is request ids, and what a tick does is chosen at the bar, not by the
  // view, so a row ticked anywhere means the same thing everywhere.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [plan, setPlan] = useState<TickPlan | null>(null)
  const [result, setResult] = useState<TickResult | null>(null)
  // The rows the table's search matches, told by the table (it owns the search); null until it has.
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
  // Every ticked row the read still has, on screen or not.
  const selectedRows = useMemo(
    () => (rows ? rows.filter((r) => selected.has(r.request_id)) : []),
    [rows, selected]
  )
  // Ticked, but not on screen: the search, the view or a filter hides it.
  const visibleKeys = useMemo(() => new Set(visible.map((r) => r.request_id)), [visible])
  const hiddenKeys = useMemo(
    () =>
      hiddenTicks(
        selectedRows.map((r) => r.request_id),
        matching,
        visibleKeys
      ),
    [selectedRows, matching, visibleKeys]
  )
  // A tick leaves through the walk's save-first exit like every page-owned exit (Decision 4; F2-4):
  // a typed ask on the row is saved first, a failed save opens nothing. The plan is then built in the
  // next render from the rows as they stand after that save, never from the click's stale closure.
  const [tickRequest, setTickRequest] = useState<{
    keys: readonly string[]
    action: TickAction
  } | null>(null)
  const startTick = useCallback(
    (keys: readonly string[], action: TickAction) =>
      leaveThen(null, () => {
        setResult(null)
        setTickRequest({ keys, action })
      }),
    [leaveThen]
  )
  if (tickRequest !== null) {
    const asked = new Set(tickRequest.keys)
    setTickRequest(null)
    setPlan(
      tickPlan(
        (rows ?? []).filter((r) => asked.has(r.request_id)),
        tickRequest.action,
        new Set([...asked].filter((k) => hiddenKeys.has(k)))
      )
    )
  }
  const onTick = useCallback(
    (r: ApiAidGridRow, action: TickAction) => startTick([r.request_id], action),
    [startTick]
  )
  // A checkbox is an exit like ↓ and a filter (A18): what is typed on the open row is saved first,
  // then the selection changes. A failed save keeps the person here and leaves the box as it was.
  const changeSelected = useCallback(
    (next: ReadonlySet<string>) => leaveThen(null, () => setSelected(next)),
    [leaveThen]
  )
  const closePlan = useCallback(() => setPlan(null), [])
  const tickDone = useCallback(
    (words: string, out: ApiAidWriteOut) => {
      // Only the rows this tick wrote leave the selection: the person may have changed it while
      // the write was in flight, and a row that had nothing to tick stays selected.
      const ticked = new Set((plan?.rows ?? []).map((r) => r.requestId))
      setSelected((current) => new Set([...current].filter((key) => !ticked.has(key))))
      setResult({
        words,
        lines: (plan?.rows ?? []).map(tickedLine),
        someAlreadyTicked: out.unchanged > 0,
      })
      setPlan(null)
    },
    [plan]
  )
  const changeFilter = useCallback(
    (name: GridParamName, value: string | null) => leaveThen(null, () => setParam(name, value)),
    [leaveThen, setParam]
  )
  const onProgramPool = useCallback(
    (nextPool: string | null, nextProgram: string | null) =>
      leaveThen(null, () => setParams({ pool: nextPool, program: nextProgram })),
    [leaveThen, setParams]
  )
  const openView = useCallback(
    (href: string) => leaveThen(null, () => void navigate(href)),
    [leaveThen, navigate]
  )
  const byKey = useMemo(() => new Map((rows ?? []).map((r) => [r.request_id, r] as const)), [rows])
  // "Go back" (Decision 3): a click on that row (ruling B). A row the view or a filter hides is
  // brought back on All (no `view` param: All is its absence) with no filters first (the PR 1 final review: `keep` would leave it hidden).
  // A row the table's search hides needs nothing: AidTable keeps the highlighted row through a
  // search (PR 1), out of the totals, group counts and CSV.
  const goBack = (key: string) => {
    lastMoved.current = null
    // Move first: the walk's own `?row=` replace reads the URL as rendered, so a navigation made
    // before it would be overwritten. The push after it carries `row` itself and wins.
    walk.onHighlight(key)
    // Read through a function: TypeScript would narrow the ref to the null just written above.
    const movedTo = (): string | null => lastMoved.current
    // Already highlighted counts too: a failed ↓ jumps back to its row before Go back is clicked.
    if ((movedTo() === key || highlighted === key) && !visibleKeys.has(key)) {
      void navigate(
        aidHref('/aid/requests', viewState, {
          row: key,
          ...(showIds ? { ids: '1' } : {}),
        })
      )
    }
  }

  // The filters and Show IDs travel with every link out (view links, and the household page and
  // back: M5). Built with spreads: the index-signature dot form is a tsc error here (I1).
  const keep = useMemo(
    (): Record<string, string> => ({
      ...(program !== null ? { program } : {}),
      ...(pool !== null ? { pool } : {}),
      ...(round !== null ? { round: String(round) } : {}),
      ...(tick !== null ? { tick } : {}),
      ...(showIds ? { ids: '1' } : {}),
    }),
    [program, pool, round, tick, showIds]
  )
  // One scheme (owner ruling 2026-10-03): `?view=<stage slug>` and `?lens=appeals`, each absent
  // for none. A stage link keeps the lens; a lens link clears the stage.
  const lensKeep = useMemo(
    (): Record<string, string> => (lens === 'appeals' ? { lens } : {}),
    [lens]
  )
  const hrefOf = useCallback(
    (v: RequestView) => aidHref('/aid/requests', viewState, { view: v.slug, ...lensKeep, ...keep }),
    [viewState, lensKeep, keep]
  )
  const lensHrefOf = useCallback(
    (l: RequestLens) =>
      aidHref('/aid/requests', viewState, { ...(l === 'appeals' ? { lens: l } : {}), ...keep }),
    [viewState, keep]
  )
  // The household page's walk reads the same pair: `from=<stage slug>` (or `all`) and the lens.
  const from = stage?.slug ?? 'all'

  const links = useMemo(
    (): HouseholdLinks => ({
      href: (r: ApiAidGridRow) =>
        aidHref(`/aid/households/${String(r.household_cm_id)}`, viewState, {
          from,
          ...lensKeep,
          ...keep,
          // The table's order, so the walk steps through, and Back restores, what is on screen (I1).
          ...(sort !== null ? { sort } : {}),
          ...(group !== null ? { group } : {}),
        }),
      open: (r: ApiAidGridRow, href: string) => {
        // Back lands on this row (§3.5). With the editor open, what is typed is saved first, and
        // every save in flight has landed (Decision 4; C1). The walk highlights the row through
        // `onHighlight`, which writes `?row=` before `go` navigates; the explicit write stays for
        // the no-walk path and costs nothing.
        leaveThen(r.request_id, () => {
          setParam('row', r.request_id)
          void navigate(href)
        })
      },
    }),
    [viewState, from, lensKeep, keep, sort, group, setParam, navigate, leaveThen]
  )

  const csvFilename = stripCsvName(
    lens,
    view,
    filters,
    year,
    asOf.kind === 'past' ? asOf.date : null
  )

  const filtersBar = (
    <GridFiltersBar
      groups={groups}
      program={program}
      pool={pool}
      round={round}
      tick={tick}
      showIds={showIds}
      onChange={changeFilter}
      onProgramPool={onProgramPool}
    />
  )
  // The filters share the grid's own toolbar line with search and Download CSV; with no grid on
  // screen (loading, failed, a past date) they stand on a line of their own.
  const gridShown = grid.data !== undefined && (live || view.key === 'all')

  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand
        icon={ListChecks}
        title="Requests"
        subtitle={`Season ${String(year)}`}
        asOf={asOf}
      />
      <RequestViewNav
        lens={lens}
        stage={stage?.key ?? null}
        counts={counts}
        lensCounts={countsByLens}
        hrefOf={hrefOf}
        lensHrefOf={lensHrefOf}
        onOpen={openView}
      />
      {!gridShown && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">{filtersBar}</div>
      )}
      {view.key === 'waiting_on_family' && (
        <p className="text-muted-foreground text-xs">
          Posted is the amount posted in this round, not yet accepted.
        </p>
      )}
      {view.key === 'needs_offer' && (
        // ⚠ Decision 39's interim: grid rows can't say which requests are split yet.
        <p className="text-muted-foreground text-xs">
          A request split between households posts one amount per household: open the household for
          each share.
        </p>
      )}
      {[...walk.failures].map(([key, message]) => {
        const failedRow = byKey.get(key)
        const name =
          failedRow === undefined
            ? key
            : failedRow.camper_name !== ''
              ? failedRow.camper_name
              : failedRow.family_name
        return (
          <p key={key} className={`${AMBER_NOTE} flex flex-wrap items-center gap-2`}>
            {`Couldn't save ${name}'s Round 2 ask: ${message}`}
            <button type="button" className={ACTION_LINK} onClick={() => goBack(key)}>
              Go Back
            </button>
          </p>
        )
      })}
      {canWork && (
        <BulkBar
          count={selectedRows.length}
          hidden={hiddenKeys.size}
          onTick={(action) =>
            startTick(
              selectedRows.map((r) => r.request_id),
              action
            )
          }
          onClear={() => setSelected(new Set())}
          result={result}
        />
      )}
      {canWork && (
        <BulkConfirmDialog plan={plan} year={year} onClose={closePlan} onDone={tickDone} />
      )}
      <QueryGuard
        isLoading={grid.isLoading}
        // Decision 33: a failed background refetch keeps what loaded.
        error={grid.data ? null : grid.error}
        data={grid.data}
        label="Requests"
      >
        {(data) =>
          !live && view.key !== 'all' ? (
            <div className="card-lodge text-muted-foreground p-6 text-sm">
              {view.label} needs today&apos;s data: which list a row is in isn&apos;t rebuilt for a
              past date. All shows that day&apos;s figures.
            </div>
          ) : (
            <RequestsGrid
              rows={visible}
              view={view}
              showIds={showIds}
              tickedSeason={data.ticked_season}
              today={today}
              csvFilename={csvFilename}
              highlighted={highlighted}
              onHighlight={canWork ? walk.onHighlight : onHighlight}
              marked={canWork ? walk.failed : undefined}
              renderBelowHighlighted={
                canWork
                  ? (r: ApiAidGridRow, nav: AidRowNav) => (
                      <GridEditorRow
                        key={walk.editorKey(r.request_id)}
                        row={r}
                        walk={walk.editorFor(r.request_id, nav)}
                        links={links}
                      />
                    )
                  : undefined
              }
              links={links}
              filters={filtersBar}
              selected={canWork ? selected : undefined}
              onSelectedChange={canWork ? changeSelected : undefined}
              onMatchingChange={canWork ? onMatchingChange : undefined}
              onTick={canWork ? onTick : undefined}
              onMarkPosted={canWork ? markPosted : undefined}
            />
          )
        }
      </QueryGuard>
      <AidDefinitionNotes surface="requests" />
    </div>
  )
}
