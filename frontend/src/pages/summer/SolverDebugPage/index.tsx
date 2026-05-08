import { Bug, Trees } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DebugTabs } from '../../../components/debug/DebugTabs'
import { useCancelSweep, useRunSweep } from '../../../hooks/useRunSweep'
import { useScenarioList } from '../../../hooks/useScenarioList'
import { useSessionList } from '../../../hooks/useSessionList'
import { type SolverRun, useSolverRuns } from '../../../hooks/useSolverRuns'
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
  const [selectedRun, setSelectedRun] = useState<SolverRun | null>(null)
  const [activeSweepId, setActiveSweepId] = useState<string | null>(null)

  const sessions = useSessionList()
  const scenarios = useScenarioList()
  const runs = useSolverRuns(filters)
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

  const pinnedRuns: (SolverRun | null)[] = pinnedIds.map(
    (id) => runs.data?.items.find((r) => r.id === id) ?? null
  )

  const inFlightSweep = useMemo(() => {
    if (!activeSweepId) return null
    const sweepChildren =
      runs.data?.items.filter((r) => r.details?.sweep_id === activeSweepId) ?? []
    if (sweepChildren.length === 0) return null
    const completed = sweepChildren.filter(
      (r) => r.status === 'success' || r.status === 'failed' || r.status === 'error'
    ).length
    if (completed === sweepChildren.length) return null
    return { sweep_id: activeSweepId, completed, total: sweepChildren.length }
  }, [activeSweepId, runs.data])

  const handleRunSweep = async (req: SweepPanelPayload) => {
    // Translate component-level payload (session_id) into backend SweepRequest
    // shape (session_cm_id + year). The component emits cm_id as session_id.
    const sessionMatch = req.session_id
      ? sessions.data?.find((s) => s.cm_id === req.session_id)
      : undefined

    const result = await runSweep.mutateAsync({
      session_cm_id: req.session_id ?? null,
      year: sessionMatch?.year ?? null,
      scenario_id: req.scenario_id ?? null,
      time_budgets: req.time_budgets,
      label: req.label ?? null,
    })
    setActiveSweepId(result.sweep_id)
  }

  const hasNoRuns = runs.isSuccess && (runs.data?.totalItems ?? 0) === 0

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
      />

      {pinnedRuns[0] && pinnedRuns[1] ? (
        <PinnedComparisonPanel
          runA={pinnedRuns[0]}
          runB={pinnedRuns[1]}
          onClear={() => setPinnedIds([])}
        />
      ) : null}

      {hasNoRuns ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          No solver runs yet — trigger one above, or any solver run from the main page will appear
          here.
        </div>
      ) : (
        <SolverRunsTable
          runs={runs.data?.items ?? []}
          visibleColumns={visibleColumns}
          pinnedRunIds={pinnedIds}
          onTogglePin={handleTogglePin}
          onRowClick={setSelectedRun}
        />
      )}

      <DrillDownDrawer run={selectedRun} onClose={() => setSelectedRun(null)} />
    </div>
  )
}
