import { Bug, Trees } from 'lucide-react'
import { useState } from 'react'

import { DebugTabs } from '../../../components/debug/DebugTabs'
import { useSolverRuns } from '../../../hooks/useSolverRuns'
import type { SolverRunsFilters } from '../../../utils/queryKeys'

export default function SolverDebugPage() {
  const [filters] = useState<SolverRunsFilters>({})
  const runs = useSolverRuns(filters)

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

      {hasNoRuns ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          No solver runs yet — trigger one above, or any solver run from the main page will appear
          here.
        </div>
      ) : (
        <div data-testid="runs-table-placeholder" />
      )}
    </div>
  )
}
