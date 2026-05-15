import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Bug, Loader2, Trees } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import { DebugTabs } from '../../../components/debug/DebugTabs'
import SolverDebugImpossibilityModal from '../../../components/SolverDebugImpossibilityModal'
import { useApiWithAuth } from '../../../hooks/useApiWithAuth'
import { useYear } from '../../../hooks/useCurrentYear'
import { useCancelSweep, useRunSweep } from '../../../hooks/useRunSweep'
import { useScenarioList } from '../../../hooks/useScenarioList'
import { useSessionList } from '../../../hooks/useSessionList'
import { useSolverRuns } from '../../../hooks/useSolverRuns'
import { solverService } from '../../../services/solver'
import { downloadJson } from '../../../utils/jsonExport'
import { queryKeys, type SolverRunsFilters } from '../../../utils/queryKeys'

import { DrillDownDrawer } from './DrillDownDrawer'
import { PinnedComparisonPanel } from './PinnedComparisonPanel'
import { SolverFiltersBar } from './SolverFiltersBar'
import { DEFAULT_VISIBLE_COLUMNS } from './solverColumns'
import { SolverRunsTable } from './SolverRunsTable'
import { SweepPanel, type SweepPanelPayload } from './SweepPanel'

const COLUMNS_STORAGE_KEY = 'solver-debug.visible-columns'

export default function SolverDebugPage() {
  const [filters, setFilters] = useState<SolverRunsFilters>({ hideFailed: true })
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(COLUMNS_STORAGE_KEY)
      return stored ? (JSON.parse(stored) as string[]) : DEFAULT_VISIBLE_COLUMNS
    } catch {
      return DEFAULT_VISIBLE_COLUMNS
    }
  })
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  // Store the selected run by id so the drawer reflects live polling updates
  // instead of a click-time snapshot.
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeSweepId, setActiveSweepId] = useState<string | null>(null)

  const sessions = useSessionList()
  const scenarios = useScenarioList()
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const [selectedSessionCmId, setSelectedSessionCmId] = useState<number | null>(null)
  const [preCheckModalOpen, setPreCheckModalOpen] = useState(false)

  const preCheckQuery = useQuery({
    queryKey: queryKeys.preCheck(selectedSessionCmId, year),
    queryFn: async () => {
      if (!selectedSessionCmId) return null
      return solverService.preValidateRequests(selectedSessionCmId, year, fetchWithAuth)
    },
    enabled: !!selectedSessionCmId,
  })

  const filtersWithYear = useMemo(() => ({ ...filters, year }), [filters, year])
  // Polling: kicks in when the user just clicked Run sweep (activeSweepId) or
  // when the fetched data shows an unsettled sweep (page-refresh case). The
  // latter is synced via effect so first render polls=false; once data arrives
  // and the effect runs, the next render flips to 5s and React Query picks up
  // the new interval.
  const [hasUnsettledSweepInData, setHasUnsettledSweepInData] = useState(false)
  const runs = useSolverRuns(filtersWithYear, {
    pollMs: activeSweepId != null || hasUnsettledSweepInData ? 5_000 : false,
  })
  const runSweep = useRunSweep()
  const cancelSweep = useCancelSweep()

  const handleColumnsChange = (next: string[]) => {
    setVisibleColumns(next)
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next))
  }

  const handleTogglePin = (runId: string) => {
    setPinnedIds((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId)
      return [...prev.slice(prev.length >= 2 ? 1 : 0), runId]
    })
  }

  // Memoize the items array so downstream useMemo/useEffect deps are stable
  // when no fetch happened — flatMap creates a fresh array reference each render.
  const items = useMemo(() => runs.data?.pages.flatMap((p) => p.items) ?? [], [runs.data])
  const totalItems = runs.data?.pages[0]?.totalItems ?? 0

  // Sync the "unsettled sweep in data" flag so polling can recover after a
  // page refresh (where activeSweepId is wiped). Must be an effect because
  // the flag drives pollMs which is a hook arg to useSolverRuns — feeding
  // items directly into pollMs would be a forward reference.
  useEffect(() => {
    const unsettled = items.some(
      (r) =>
        !!r.details?.sweep_id &&
        r.status !== 'success' &&
        r.status !== 'failed' &&
        r.status !== 'error' &&
        r.status !== 'cancelled'
    )
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived flag with fetched data; needed so refetchInterval reacts on the next render.
    setHasUnsettledSweepInData(unsettled)
  }, [items])

  // Restrict pinned ids to runs currently visible in the fetched window.
  // Computed at render time — no setState-in-effect cascade — and the
  // underlying `pinnedIds` state is preserved so a pin re-appears when the
  // user clears the filter that hid it.
  const visiblePinnedIds = useMemo(() => {
    if (pinnedIds.length === 0) return pinnedIds
    const visibleIds = new Set(items.map((r) => r.id))
    return pinnedIds.filter((id) => visibleIds.has(id))
  }, [pinnedIds, items])

  const pinnedRuns = visiblePinnedIds.map((id) => items.find((r) => r.id === id) ?? null)

  const selectedRun = selectedRunId ? (items.find((r) => r.id === selectedRunId) ?? null) : null

  // Distinct sweeps in the current run window, for the sweep filter dropdown.
  // Counted from the fetched page; not a server-side aggregate.
  const availableSweeps = useMemo(() => {
    const byId = new Map<string, { id: string; label?: string | null; count: number }>()
    for (const r of items) {
      const id = r.details?.sweep_id
      if (!id) continue
      const existing = byId.get(id)
      if (existing) {
        existing.count += 1
      } else {
        byId.set(id, { id, label: r.details?.sweep_label ?? null, count: 1 })
      }
    }
    return Array.from(byId.values())
  }, [items])

  const inFlightSweep = useMemo(() => {
    // Derive the in-flight sweep from the items themselves so a page refresh
    // (which wipes activeSweepId from React state) doesn't lose the banner.
    // Group children by sweep_id, find the most recent one that isn't fully
    // settled. items is already sorted by -created in the query.
    const bySweep = new Map<string, typeof items>()
    for (const r of items) {
      const sid = r.details?.sweep_id
      if (!sid) continue
      const list = bySweep.get(sid) ?? []
      list.push(r)
      bySweep.set(sid, list)
    }
    const isSettled = (r: (typeof items)[number]) =>
      r.status === 'success' ||
      r.status === 'failed' ||
      r.status === 'error' ||
      r.status === 'cancelled'
    for (const [sid, children] of bySweep) {
      const completed = children.filter(isSettled).length
      if (completed === children.length) continue
      // Prefer the actual stats budget (set once the solver runs), but fall
      // back to details.time_limit_seconds so pre-created pending rows still
      // contribute a slot to the budget bar.
      const budgets = children
        .flatMap((r) => {
          const seconds = r.stats?.time_budget_seconds ?? r.details?.time_limit_seconds
          if (seconds == null) return []
          const walltime = r.stats?.walltime_seconds ?? null
          const state: 'done' | 'running' | 'pending' = isSettled(r)
            ? 'done'
            : r.stats
              ? 'running'
              : 'pending'
          return [{ seconds, walltime, state }]
        })
        .sort((a, b) => a.seconds - b.seconds)
      return { sweep_id: sid, completed, total: children.length, budgets }
    }
    // No in-flight sweep visible in the data — but if we just kicked one off,
    // show a placeholder until the first child row lands (otherwise the user
    // sees nothing and re-clicks, tripping the backend's single-flight 409).
    if (activeSweepId) {
      return { sweep_id: activeSweepId, completed: 0, total: 0, budgets: [] }
    }
    return null
  }, [activeSweepId, items])

  // Once the in-flight sweep settles (children have all landed and finished),
  // clear the active id so polling can shut off. This must be an effect because
  // `activeSweepId` is the source of truth for whether to poll — we can't
  // derive it without a feedback loop.
  useEffect(() => {
    if (!activeSweepId) return
    const sweepChildren = items.filter((r) => r.details?.sweep_id === activeSweepId)
    if (sweepChildren.length === 0) return
    const allSettled = sweepChildren.every(
      (r) =>
        r.status === 'success' ||
        r.status === 'failed' ||
        r.status === 'error' ||
        r.status === 'cancelled'
    )
    if (allSettled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local "is sweep running?" flag with external runs data; clearing this flag is precisely what stops the 5s poll.
      setActiveSweepId(null)
    }
  }, [activeSweepId, items])

  const handleExport = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadJson(items, `solver-runs-${stamp}.json`)
  }

  const handleRunSweep = async (req: SweepPanelPayload) => {
    // Translate component-level payload (session_id) into backend SweepRequest
    // shape (session_cm_id + year). The component emits cm_id as session_id.
    const sessionMatch = req.session_id
      ? sessions.data?.find((s) => s.cm_id === req.session_id)
      : undefined

    try {
      const result = await runSweep.mutateAsync({
        session_cm_id: req.session_id ?? null,
        year: sessionMatch?.year ?? null,
        scenario_id: req.scenario_id ?? null,
        time_budgets: req.time_budgets,
        label: req.label ?? null,
      })
      setActiveSweepId(result.sweep_id)
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error'
      toast.error(`Sweep failed: ${detail}`)
    }
  }

  const hasNoRuns = runs.isSuccess && totalItems === 0

  return (
    <div className="relative space-y-6">
      <div className="text-forest-200/30 dark:text-forest-800/20 pointer-events-none absolute -top-4 right-8">
        <Trees className="h-24 w-24" strokeWidth={1} />
      </div>

      <div className="relative flex items-center gap-4" data-tour="debug-header">
        <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
          <Bug className="text-forest-900 h-7 w-7" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-foreground text-2xl font-bold">Solver Debug</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            OR-Tools internals across past solver runs — benchmark sweeps, comparison, drill-down
          </p>
        </div>
      </div>

      <DebugTabs />

      {sessions.isError || scenarios.isError ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          <AlertCircle className="h-4 w-4" />
          Could not load sweep options. Refresh the page to retry.
        </div>
      ) : null}

      <SweepPanel
        sessions={sessions.data ?? []}
        scenarios={scenarios.data ?? []}
        onRunSweep={handleRunSweep}
        onCancelSweep={(id) => cancelSweep.mutate(id)}
        inFlightSweep={inFlightSweep}
        preCheckIsLoading={preCheckQuery.isLoading}
        preCheckIsError={preCheckQuery.isError}
        {...(typeof preCheckQuery.data?.impossibility_report.total_impossible === 'number'
          ? {
              preCheckImpossibilityCount: preCheckQuery.data.impossibility_report.total_impossible,
              preCheckEntirelyImpossibleCount:
                preCheckQuery.data.impossibility_report.mp_campers_entirely_impossible?.length ?? 0,
              onOpenPreCheck: () => setPreCheckModalOpen(true),
            }
          : {})}
        onSessionChange={setSelectedSessionCmId}
      />

      {preCheckQuery.data && (
        <SolverDebugImpossibilityModal
          isOpen={preCheckModalOpen}
          onClose={() => setPreCheckModalOpen(false)}
          report={preCheckQuery.data.impossibility_report}
          sessionCmId={selectedSessionCmId}
          year={year}
        />
      )}

      <SolverFiltersBar
        filters={filters}
        onFiltersChange={setFilters}
        visibleColumns={visibleColumns}
        onColumnsChange={handleColumnsChange}
        sessions={sessions.data ?? []}
        availableSweeps={availableSweeps}
        onExport={handleExport}
      />

      {pinnedRuns[0] && pinnedRuns[1] ? (
        <PinnedComparisonPanel
          runA={pinnedRuns[0]}
          runB={pinnedRuns[1]}
          onClear={() => setPinnedIds([])}
        />
      ) : null}

      {runs.isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center rounded-xl border border-gray-200 bg-white py-12">
          <Loader2 className="text-primary mr-2 h-6 w-6 animate-spin" />
          Loading solver runs…
        </div>
      ) : runs.isError ? (
        <div className="flex items-center justify-center rounded-xl border border-red-200 bg-red-50 py-12 text-red-700">
          <AlertCircle className="mr-2 h-6 w-6" />
          Failed to load solver runs: {runs.error.message}
        </div>
      ) : hasNoRuns ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          No solver runs yet — trigger one above, or any solver run from the main page will appear
          here.
        </div>
      ) : (
        <SolverRunsTable
          runs={items}
          visibleColumns={visibleColumns}
          pinnedRunIds={visiblePinnedIds}
          onTogglePin={handleTogglePin}
          onRowClick={(run) => setSelectedRunId(run.id)}
          hasNextPage={runs.hasNextPage}
          fetchNextPage={runs.fetchNextPage}
          totalItems={totalItems}
        />
      )}

      <DrillDownDrawer run={selectedRun} onClose={() => setSelectedRunId(null)} />
    </div>
  )
}
