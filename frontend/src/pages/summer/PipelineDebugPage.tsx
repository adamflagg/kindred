/**
 * PipelineDebugPage - Full pipeline debug/trace tool
 *
 * Batch overview: run selector + summary table with PB-native filtering.
 * Drill-down: sidebar stage nav + detail panel (flex row layout).
 *
 * Route: /summer/debug/pipeline (batch) or /summer/debug/pipeline/:traceId (drill-down)
 */

import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { Link } from 'react-router'
import { Bug, GitGraph, ArrowLeft, Loader2, Plus } from 'lucide-react'
import { DebugTabs } from '../../components/debug/DebugTabs'
import { useYear } from '../../hooks/useCurrentYear'
import {
  PipelineRunSelector,
  PipelineBatchList,
  PipelineSidebar,
  PipelineDetailPanel,
  NewTraceModal,
} from '../../components/pipeline-debug'
import { QueryGuard } from '../../components/QueryGuard'
import { usePipelineRuns, useToggleRunPin } from '../../hooks/usePipelineRuns'
import { usePipelineSummary } from '../../hooks/usePipelineSummary'
import { usePipelineTrace } from '../../hooks/usePipelineTrace'
import { useRunFromPhase, useRunFullTrace } from '../../hooks/useRunPhase'
import {
  STAGE_ORDER,
  type PipelineSummaryFilters,
  type PipelinePhase,
  type PipelineStage,
} from '../../components/pipeline-debug/types'

export default function PipelineDebugPage() {
  const { traceId } = useParams<{ traceId?: string }>()
  const navigate = useNavigate()
  const year = useYear()

  // Batch view state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [filters, setFilters] = useState<PipelineSummaryFilters>({})

  // New Trace modal state
  const [isNewTraceOpen, setIsNewTraceOpen] = useState(false)

  // Drill-down state
  const [selectedStage, setSelectedStage] = useState<PipelineStage>(STAGE_ORDER[0] as PipelineStage)
  const [activeIntentIndex, setActiveIntentIndex] = useState(0)
  const [stalePhases, setStalePhases] = useState<Set<PipelinePhase>>(new Set())

  // Data fetching — the summary query fetches all rows for the run in a
  // single request. Filtering/sorting/searching happen client-side in
  // PipelineBatchList, so the queryKey is stable and typing/scrolling never
  // trigger a refetch.
  const runsQuery = usePipelineRuns()
  const togglePin = useToggleRunPin()
  const summaryQuery = usePipelineSummary(selectedRunId)
  const traceQuery = usePipelineTrace(traceId ?? null)
  const runFromPhase = useRunFromPhase()
  const runFullTrace = useRunFullTrace()

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

  const handleStageSelect = useCallback((stage: PipelineStage) => {
    setSelectedStage(stage)
    setActiveIntentIndex(0)
  }, [])

  /** Rerun this phase: isolated single-phase execution (dry-run). */
  const handleRerunPhase = useCallback(
    (phase: PipelinePhase) => {
      if (!traceId) return
      // Only this phase is re-executed — downstream phases are left unchanged,
      // so we do not mark them stale.
      setStalePhases(new Set())

      const trace = traceQuery.data
      runFromPhase.mutate(
        {
          phase,
          request: {
            trace_id: traceId,
            year: trace?.year ?? 0,
            session_cm_ids: trace?.session_cm_id ? [trace.session_cm_id] : [],
            dry_run: true,
            stop_at_phase: phase,
          },
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
    [traceId, traceQuery.data, runFromPhase, navigate]
  )

  /** Run From Here: cascade from phase through remaining phases (dry-run only). */
  const handleRunFromHere = useCallback(
    (phase: PipelinePhase) => {
      if (!traceId) return
      setStalePhases(new Set()) // Clear stale since we're re-running everything downstream

      const trace = traceQuery.data
      runFromPhase.mutate(
        {
          phase,
          request: {
            trace_id: traceId,
            year: trace?.year ?? 0,
            session_cm_ids: trace?.session_cm_id ? [trace.session_cm_id] : [],
            dry_run: true,
          },
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
    [traceId, traceQuery.data, runFromPhase, navigate]
  )

  /** New Trace: run the full pipeline for selected original requests. */
  const handleRunTrace = useCallback(
    (originalRequestIds: string[], sessionCmIds: number[], stopAtPhase: string | null) => {
      runFullTrace.mutate(
        {
          original_request_ids: originalRequestIds,
          year,
          session_cm_ids: sessionCmIds,
          dry_run: true,
          stop_at_phase: stopAtPhase,
        },
        {
          onSuccess: (result) => {
            setIsNewTraceOpen(false)
            if (result.trace_id) {
              void navigate(`/summer/debug/pipeline/${result.trace_id}`)
            }
          },
        }
      )
    },
    [runFullTrace, navigate, year]
  )

  // Drill-down view
  if (traceId) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4" data-tour="debug-header">
          <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
            <Bug className="text-forest-900 h-7 w-7" />
          </div>
          <div className="flex-1">
            <h1 className="font-display text-foreground text-2xl font-bold">Pipeline Debug</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Trace: <span className="font-mono text-xs">{traceId}</span>
              {traceQuery.data && (
                <span className="ml-2">
                  {traceQuery.data.source_field} —{' '}
                  <Link
                    to={`/camper/${traceQuery.data.requester_cm_id}`}
                    className="text-primary hover:underline"
                  >
                    {traceQuery.data.trace_data.pre_phase1.requester_info.name}
                  </Link>{' '}
                  <span className="font-mono text-xs">#{traceQuery.data.requester_cm_id}</span>
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => setIsNewTraceOpen(true)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm transition-colors hover:border-gray-200 dark:hover:border-gray-700"
          >
            <Plus className="h-4 w-4" />
            New Trace
          </button>
          <button
            onClick={() => {
              setSelectedStage(STAGE_ORDER[0] as PipelineStage)
              setStalePhases(new Set())
              void navigate('/summer/debug/pipeline')
            }}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to batch view
          </button>
        </div>

        <DebugTabs />

        {/* Sidebar layout: detail panel (flex-1) + sidebar (220px fixed right) */}
        <QueryGuard
          isLoading={traceQuery.isLoading}
          error={traceQuery.error}
          data={traceQuery.data}
          label="pipeline trace"
          emptyMessage="Trace not found."
        >
          {(trace) => (
            <div className="flex gap-4">
              {/* Detail panel — left, fills remaining space */}
              <div className="min-w-0 flex-1">
                <PipelineDetailPanel
                  selectedStage={selectedStage}
                  traceData={trace.trace_data}
                  activeIntentIndex={activeIntentIndex}
                  onTabChange={setActiveIntentIndex}
                  onRerunPhase={handleRerunPhase}
                  onRunFromHere={handleRunFromHere}
                  isRunning={runFromPhase.isPending}
                />
              </div>

              {/* Sidebar — right, fixed 220px */}
              <PipelineSidebar
                traceData={trace.trace_data}
                selectedStage={selectedStage}
                onStageSelect={handleStageSelect}
                stalePhases={stalePhases}
                activeIntentIndex={activeIntentIndex}
                onViewAllTraces={() => {
                  setFilters({})
                  void navigate('/summer/debug/pipeline')
                }}
                onReprocess={() => {
                  runFullTrace.mutate({
                    original_request_ids: [trace.original_request_id],
                    year: trace.year,
                    session_cm_ids: [trace.session_cm_id],
                    dry_run: false,
                  })
                }}
                isReprocessing={runFullTrace.isPending}
              />
            </div>
          )}
        </QueryGuard>

        {/* Running indicator */}
        {runFromPhase.isPending && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running phase...
          </div>
        )}

        <NewTraceModal
          isOpen={isNewTraceOpen}
          onClose={() => setIsNewTraceOpen(false)}
          onRunTrace={handleRunTrace}
          isRunning={runFullTrace.isPending}
          year={year}
          error={runFullTrace.isError ? runFullTrace.error.message : null}
        />
      </div>
    )
  }

  // Batch overview
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4" data-tour="debug-header">
        <div className="shadow-lodge flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 ring-4 shadow-amber-500/25 ring-amber-100 dark:ring-amber-900/30">
          <Bug className="text-forest-900 h-7 w-7" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-foreground text-2xl font-bold">Pipeline Debug</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Trace and debug the full bunk request processing pipeline
          </p>
        </div>
        <button
          onClick={() => setIsNewTraceOpen(true)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm transition-colors hover:border-gray-200 dark:hover:border-gray-700"
        >
          <Plus className="h-4 w-4" />
          New Trace
        </button>
      </div>

      <DebugTabs />

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

      {/* Summary table — only show when a run is selected.
          The query fetches ALL rows for the run in one shot; filtering /
          sorting / searching happen client-side inside PipelineBatchList.
          Because the queryKey is stable per run, the QueryGuard only
          shows the loading skeleton on the first load, never on keystrokes
          or scroll. */}
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
              filters={filters}
              onFiltersChange={setFilters}
              onRowClick={handleRowClick}
              isLoading={false}
              error={summaryQuery.error}
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

      <NewTraceModal
        isOpen={isNewTraceOpen}
        onClose={() => setIsNewTraceOpen(false)}
        onRunTrace={handleRunTrace}
        isRunning={runFullTrace.isPending}
        year={year}
        error={runFullTrace.isError ? runFullTrace.error.message : null}
      />
    </div>
  )
}
