import { ListChecks } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { QueryGuard } from '../../components/QueryGuard'
import { aidHref } from '../../components/camperships/kit/asOf'
import { campToday } from '../../components/camperships/kit/dates'
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
import { useGridParams } from '../../components/camperships/requests/useGridParams'
import {
  filterRows,
  viewCounts,
  type GridFilters,
  type RequestView,
} from '../../components/camperships/requests/views'
import { AidDefinitionNotes } from '../../components/camperships/shell/AidDefinitionNotes'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useAidGrid } from '../../hooks/camperships/useAidGrid'
import { useAidApprovedRules } from '../../hooks/camperships/useAidRules'
import { useYear } from '../../hooks/useCurrentYear'
import type { ApiAidGridRow } from '../../types/api-types'

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
  const onHighlight = useCallback(
    (key: string | null) => {
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
  const onProgramPool = useCallback(
    (nextPool: string | null, nextProgram: string | null) =>
      setParams({ pool: nextPool, program: nextProgram }),
    [setParams]
  )

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
        }),
      open: (r: ApiAidGridRow, href: string) => {
        // Back lands on this row (§3.5): it is highlighted, and written to the URL, before leaving.
        setHighlighted(r.request_id)
        setParam('row', r.request_id)
        void navigate(href)
      },
    }),
    [viewState, from, lensKeep, keep, setParam, navigate]
  )

  const csvFilename = stripCsvName(
    lens,
    view,
    filters,
    year,
    asOf.kind === 'past' ? asOf.date : null
  )

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
      />
      <GridFiltersBar
        groups={groups}
        program={program}
        pool={pool}
        round={round}
        tick={tick}
        showIds={showIds}
        onChange={setParam}
        onProgramPool={onProgramPool}
      />
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
      <QueryGuard
        isLoading={grid.isLoading}
        // Decision 33: a failed background refetch keeps what loaded.
        error={grid.data ? null : grid.error}
        data={grid.data}
        label="Requests"
      >
        {() =>
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
              today={today}
              csvFilename={csvFilename}
              highlighted={highlighted}
              onHighlight={onHighlight}
              links={links}
            />
          )
        }
      </QueryGuard>
      <AidDefinitionNotes surface="requests" />
    </div>
  )
}
