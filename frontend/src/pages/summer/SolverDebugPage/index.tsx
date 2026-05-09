import { AlertCircle, Bug, Loader2, Trees } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import { DebugTabs } from '../../../components/debug/DebugTabs'
import { useCancelSweep, useRunSweep } from '../../../hooks/useRunSweep'
import { useScenarioList } from '../../../hooks/useScenarioList'
import { useSessionList } from '../../../hooks/useSessionList'
import { useSolverRuns } from '../../../hooks/useSolverRuns'
import { downloadJson } from '../../../utils/jsonExport'
import type { SolverRunsFilters } from '../../../utils/queryKeys'

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
  // Year scoping: solver_runs has no `year` column, so we exclude runs whose
  // session_id isn't in the current-year session list. Empty array (sessions
  // loaded, none for year) → no rows. undefined while sessions are still
  // loading → keep prior behavior, then re-query when sessions resolve.
  const validSessionIds = sessions.data ? sessions.data.map((s) => s.cm_id) : undefined
  const scopedFilters = useMemo(
    () => (validSessionIds !== undefined ? { ...filters, validSessionIds } : filters),
    [filters, validSessionIds]
  )
  const runs = useSolverRuns(scopedFilters, {
    pollMs: activeSweepId ? 5_000 : false,
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
  // when no fetch happened — `runs.data?.items ?? []` would otherwise create a
  // fresh array reference each render.
  const items = useMemo(() => runs.data?.items ?? [], [runs.data])

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

  const inFlightSweep = useMemo(() => {
    if (!activeSweepId) return null
    const sweepChildren = items.filter((r) => r.details?.sweep_id === activeSweepId)
    if (sweepChildren.length === 0) return null
    const completed = sweepChildren.filter(
      (r) => r.status === 'success' || r.status === 'failed' || r.status === 'error'
    ).length
    if (completed === sweepChildren.length) return null
    return { sweep_id: activeSweepId, completed, total: sweepChildren.length }
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
      (r) => r.status === 'success' || r.status === 'failed' || r.status === 'error'
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

  const hasNoRuns = runs.isSuccess && runs.data.totalItems === 0

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
      />

      <SolverFiltersBar
        filters={filters}
        onFiltersChange={setFilters}
        visibleColumns={visibleColumns}
        onColumnsChange={handleColumnsChange}
        sessions={sessions.data ?? []}
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
        />
      )}

      <DrillDownDrawer run={selectedRun} onClose={() => setSelectedRunId(null)} />
    </div>
  )
}
