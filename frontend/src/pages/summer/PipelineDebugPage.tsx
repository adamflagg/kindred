/**
 * PipelineDebugPage - Full pipeline debug/trace tool
 *
 * Batch overview: run selector + summary table with PB-native filtering.
 * Drill-down: React Flow pipeline canvas with phase nodes and detail panels.
 *
 * Route: /summer/debug/pipeline (batch) or /summer/debug/pipeline/:traceId (drill-down)
 */

import { Bug, GitGraph } from 'lucide-react'

export default function PipelineDebugPage() {
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

      {/* Stub content */}
      <div className="card-lodge flex flex-col items-center justify-center gap-4 p-12">
        <GitGraph className="text-muted-foreground h-12 w-12" />
        <p className="text-muted-foreground text-sm">
          Pipeline debug view coming soon. Run selector and batch summary will appear here.
        </p>
      </div>
    </div>
  )
}
