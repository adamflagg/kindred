/**
 * PipelineDebugPage - Full pipeline debug/trace tool
 *
 * Batch overview: run selector + summary table with PB-native filtering.
 * Drill-down: React Flow pipeline canvas with phase nodes and detail panels (future chunk).
 *
 * Route: /summer/debug/pipeline (batch) or /summer/debug/pipeline/:traceId (drill-down)
 */

import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { Bug, GitGraph } from 'lucide-react'
import { PipelineRunSelector, PipelineBatchList } from '../../components/pipeline-debug'
import { QueryGuard } from '../../components/QueryGuard'
import { usePipelineRuns, useToggleRunPin } from '../../hooks/usePipelineRuns'
import { usePipelineSummary } from '../../hooks/usePipelineSummary'
import type { PipelineSummaryFilters } from '../../components/pipeline-debug/types'

export default function PipelineDebugPage() {
  const { traceId } = useParams<{ traceId?: string }>()
  const navigate = useNavigate()

  // Batch view state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [filters, setFilters] = useState<PipelineSummaryFilters>({})

  // Data fetching
  const runsQuery = usePipelineRuns()
  const togglePin = useToggleRunPin()
  const summaryQuery = usePipelineSummary(selectedRunId, filters)

  const handleSelectRun = useCallback((runId: string | null) => {
    setSelectedRunId(runId)
    setFilters({}) // Reset filters when switching runs
  }, [])

  const handleTogglePin = useCallback(
    (runId: string) => {
      togglePin.mutate(runId)
    },
    [togglePin]
  )

  const handleRowClick = useCallback(
    (clickedTraceId: string) => {
      void navigate(`/summer/debug/pipeline/${clickedTraceId}`)
    },
    [navigate]
  )

  // Drill-down view (future: Chunk 6 will implement PipelineCanvas)
  if (traceId) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
            <Bug className="text-forest-900 h-7 w-7" />
          </div>
          <div className="flex-1">
            <h1 className="font-display text-foreground text-2xl font-bold">Pipeline Debug</h1>
            <p className="text-muted-foreground mt-1 text-sm">Trace drill-down: {traceId}</p>
          </div>
          <button
            onClick={() => navigate('/summer/debug/pipeline')}
            className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            Back to batch view
          </button>
        </div>

        {/* Drill-down placeholder - Chunk 6 will replace this with PipelineCanvas */}
        <div className="card-lodge flex flex-col items-center justify-center gap-4 p-12">
          <GitGraph className="text-muted-foreground h-12 w-12" />
          <p className="text-muted-foreground text-sm">
            Pipeline canvas drill-down coming in next chunk.
          </p>
        </div>
      </div>
    )
  }

  // Batch overview
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
          <Bug className="text-forest-900 h-7 w-7" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-foreground text-2xl font-bold">Pipeline Debug</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Trace and debug the full bunk request processing pipeline
          </p>
        </div>
      </div>

      {/* Run selector */}
      <QueryGuard
        isLoading={runsQuery.isLoading}
        error={runsQuery.error}
        data={runsQuery.data}
        label="pipeline runs"
        emptyMessage="No pipeline runs found. Process requests with trace collection enabled to generate runs."
      >
        {(runsData) => (
          <PipelineRunSelector
            runs={runsData.items}
            selectedRunId={selectedRunId}
            onSelectRun={handleSelectRun}
            onTogglePin={handleTogglePin}
            isPinning={togglePin.isPending}
          />
        )}
      </QueryGuard>

      {/* Summary table — only show when a run is selected */}
      {selectedRunId && (
        <QueryGuard
          isLoading={summaryQuery.isLoading}
          error={summaryQuery.error}
          data={summaryQuery.data}
          label="pipeline summary"
          emptyMessage="No summary data for this run."
        >
          {(summaryData) => (
            <PipelineBatchList
              items={summaryData.items}
              total={summaryData.total}
              filters={filters}
              onFiltersChange={setFilters}
              onRowClick={handleRowClick}
              isLoading={false}
            />
          )}
        </QueryGuard>
      )}

      {/* Prompt to select a run */}
      {!selectedRunId && runsQuery.data && runsQuery.data.items.length > 0 && (
        <div className="card-lodge flex flex-col items-center justify-center gap-4 p-12">
          <GitGraph className="text-muted-foreground h-12 w-12" />
          <p className="text-muted-foreground text-sm">
            Select a pipeline run above to view the batch summary.
          </p>
        </div>
      )}
    </div>
  )
}
