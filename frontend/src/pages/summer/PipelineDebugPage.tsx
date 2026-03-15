/**
 * PipelineDebugPage - Full pipeline debug/trace tool
 *
 * Batch overview: run selector + summary table with PB-native filtering.
 * Drill-down: React Flow pipeline canvas with phase nodes and detail panels.
 *
 * Route: /summer/debug/pipeline (batch) or /summer/debug/pipeline/:traceId (drill-down)
 */

import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { Bug, GitGraph, ArrowLeft, Loader2 } from 'lucide-react'
import {
  PipelineRunSelector,
  PipelineBatchList,
  PipelineCanvas,
  PipelineDetailPanel,
} from '../../components/pipeline-debug'
import { QueryGuard } from '../../components/QueryGuard'
import { usePipelineRuns, useToggleRunPin } from '../../hooks/usePipelineRuns'
import { usePipelineSummary } from '../../hooks/usePipelineSummary'
import { usePipelineTrace } from '../../hooks/usePipelineTrace'
import { useRunFromPhase } from '../../hooks/useRunPhase'
import type { PipelineSummaryFilters, PipelinePhase } from '../../components/pipeline-debug/types'

/** Pipeline phase ordering for computing stale downstream phases. */
const PHASE_ORDER: PipelinePhase[] = [
  'pre_phase1',
  'phase1',
  'validation',
  'phase2',
  'expansion',
  'historical',
  'phase3',
  'post_pipeline',
]

export default function PipelineDebugPage() {
  const { traceId } = useParams<{ traceId?: string }>()
  const navigate = useNavigate()

  // Batch view state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [filters, setFilters] = useState<PipelineSummaryFilters>({})

  // Drill-down state
  const [selectedNode, setSelectedNode] = useState<PipelinePhase | null>(null)
  const [stalePhases, setStalePhases] = useState<Set<PipelinePhase>>(new Set())

  // Data fetching
  const runsQuery = usePipelineRuns()
  const togglePin = useToggleRunPin()
  const summaryQuery = usePipelineSummary(selectedRunId, filters)
  const traceQuery = usePipelineTrace(traceId ?? null)
  const runFromPhase = useRunFromPhase()

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

  const handleNodeSelect = useCallback((phase: PipelinePhase) => {
    setSelectedNode(phase)
  }, [])

  /** Run Again: re-run single phase (always dry-run). Mark downstream as stale. */
  const handleRunAgain = useCallback(
    (phase: PipelinePhase) => {
      if (!traceId) return
      // Mark all downstream phases as stale
      const phaseIdx = PHASE_ORDER.indexOf(phase)
      const downstream = new Set<PipelinePhase>(PHASE_ORDER.filter((_, idx) => idx > phaseIdx))
      setStalePhases(downstream)

      // Run the phase (dry-run, single phase via runFromPhase with same start/end)
      runFromPhase.mutate(
        {
          phase,
          request: { trace_id: traceId, write_to_production: false },
        },
        {
          onSuccess: (result) => {
            if (result.trace_id) {
              void navigate(`/summer/debug/pipeline/${result.trace_id}`)
            }
          },
        }
      )
    },
    [traceId, runFromPhase, navigate]
  )

  /** Run From Here: cascade from phase through remaining phases. */
  const handleRunFromHere = useCallback(
    (phase: PipelinePhase, writeToProduction: boolean) => {
      if (!traceId) return
      setStalePhases(new Set()) // Clear stale since we're re-running everything downstream

      runFromPhase.mutate(
        {
          phase,
          request: { trace_id: traceId, write_to_production: writeToProduction },
        },
        {
          onSuccess: (result) => {
            if (result.trace_id) {
              void navigate(`/summer/debug/pipeline/${result.trace_id}`)
            }
          },
        }
      )
    },
    [traceId, runFromPhase, navigate]
  )

  // Drill-down view
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
            <p className="text-muted-foreground mt-1 text-sm">
              Trace: <span className="font-mono text-xs">{traceId}</span>
              {traceQuery.data && (
                <span className="ml-2">
                  {traceQuery.data.source_field} — requester #{traceQuery.data.requester_cm_id}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedNode(null)
              setStalePhases(new Set())
              void navigate('/summer/debug/pipeline')
            }}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to batch view
          </button>
        </div>

        {/* Canvas + Detail Panel */}
        <QueryGuard
          isLoading={traceQuery.isLoading}
          error={traceQuery.error}
          data={traceQuery.data}
          label="pipeline trace"
          emptyMessage="Trace not found."
        >
          {(trace) => (
            <>
              <PipelineCanvas
                traceData={trace.trace_data}
                selectedNode={selectedNode}
                onNodeSelect={handleNodeSelect}
                stalePhases={stalePhases}
              />
              <PipelineDetailPanel
                selectedNode={selectedNode}
                traceData={trace.trace_data}
                onRunAgain={handleRunAgain}
                onRunFromHere={handleRunFromHere}
                isRunning={runFromPhase.isPending}
              />
              {!selectedNode && (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  Click a pipeline phase node above to view its details.
                </p>
              )}
            </>
          )}
        </QueryGuard>

        {/* Running indicator */}
        {runFromPhase.isPending && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running phase...
          </div>
        )}
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
