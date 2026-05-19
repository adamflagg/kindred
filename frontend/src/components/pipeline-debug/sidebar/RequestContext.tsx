import { useState } from 'react'
import { History, RotateCcw, AlertTriangle } from 'lucide-react'
import type { TraceData } from '../types'

interface RequestContextProps {
  traceData: TraceData
  /** Currently selected intent index (from IntentTabs in Phase2/Phase3 detail panels). */
  activeIntentIndex: number
  /** Callback when user clicks "View all traces" for the requester. Receives requester CM ID. */
  onViewAllTraces?: (cmId: number) => void
  /** Callback to reprocess from source for this camper. */
  onReprocess?: () => void
  /** Whether a reprocess operation is in progress. */
  isReprocessing?: boolean
}

/** Source field display names. */
const FIELD_LABELS: Record<string, string> = {
  ai_parse: 'AI Parse',
  socialize_direct_map: 'Socialize',
  bunk_request_form: 'bunk_request_form',
  staff_not_bunk_with: 'staff_not_bunk_with',
  bunking_notes: 'bunking_notes',
  internal_notes: 'internal_notes',
}

function statusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'RESOLVED':
      return 'bg-green-600 text-white'
    case 'PENDING':
      return 'bg-amber-500 text-white'
    case 'DECLINED':
      return 'bg-red-600 text-white'
    case 'DEDUPED':
      return 'bg-gray-500 text-white'
    default:
      return 'bg-gray-500 text-white'
  }
}

export function RequestContext({
  traceData,
  activeIntentIndex,
  onViewAllTraces,
  onReprocess,
  isReprocessing,
}: RequestContextProps) {
  const [showReprocessConfirm, setShowReprocessConfirm] = useState(false)
  const { requester_info, original_text, field_path } = traceData.pre_phase1
  const intents = traceData.phase1_parse.parsed_intents
  const totalIntents = intents.length
  const activeIntent = intents[activeIntentIndex] ?? intents[0]
  const finalBRs = traceData.disposition.final_bunk_requests
  const activeBR = finalBRs[activeIntentIndex] ?? finalBRs[0]

  return (
    <div className="space-y-3">
      <p className="text-primary text-[10px] font-semibold tracking-widest uppercase">
        Request Context
      </p>

      {/* Requester */}
      <div>
        <p className="text-foreground text-sm font-semibold">{requester_info.name}</p>
        <p className="text-muted-foreground text-xs">
          Grade {requester_info.grade} · CM {requester_info.cm_id}
        </p>
      </div>

      {/* Original text */}
      <div>
        <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
          Original
        </p>
        <div className="border-primary bg-muted mt-1 rounded-lg border-l-2 px-2 py-1.5">
          <p className="text-foreground text-xs leading-relaxed break-words">
            {original_text || <em className="text-muted-foreground">empty</em>}
          </p>
        </div>
      </div>

      {/* BR fragment — what P1 split out for this specific BR */}
      {activeIntent && (
        <div>
          <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            This BR&apos;s Fragment
          </p>
          <div className="border-accent bg-muted mt-1 rounded-lg border-l-2 px-2 py-1.5">
            <p className="text-foreground text-xs font-medium">
              &quot;{activeIntent.target_name}&quot;
              {activeIntent.request_type !== 'BUNK_WITH' && (
                <span className="text-muted-foreground ml-1">({activeIntent.request_type})</span>
              )}
            </p>
          </div>
          {totalIntents > 1 && (
            <p className="text-muted-foreground mt-0.5 text-[10px]">
              BR {activeIntentIndex + 1} of {totalIntents} ·{' '}
              {FIELD_LABELS[field_path] ?? field_path}
            </p>
          )}
          {totalIntents <= 1 && (
            <p className="text-muted-foreground mt-0.5 text-[10px]">
              {FIELD_LABELS[field_path] ?? field_path}
            </p>
          )}
        </div>
      )}

      {/* Final result */}
      {activeBR && (
        <div className="border-border border-t pt-2">
          <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            Result
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(activeBR.status)}`}
            >
              {activeBR.status}
            </span>
            <span className="text-muted-foreground text-xs">{activeBR.confidence}</span>
          </div>
          {activeBR.requested_name && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              → {activeBR.requested_name} ({activeBR.resolution_method})
            </p>
          )}
          {activeBR.disposition_reason &&
            activeBR.disposition_reason !== activeBR.resolution_method && (
              <p className="text-muted-foreground text-[10px]">{activeBR.disposition_reason}</p>
            )}
        </div>
      )}

      {/* Action buttons */}
      {(onViewAllTraces || onReprocess) && (
        <div className="border-border flex flex-col gap-1.5 border-t pt-2">
          {onViewAllTraces && (
            <button
              onClick={() => onViewAllTraces(requester_info.cm_id)}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs font-medium transition-colors"
            >
              <History className="h-3 w-3" />
              View all traces
            </button>
          )}
          {onReprocess && (
            <button
              onClick={() => setShowReprocessConfirm(true)}
              disabled={isReprocessing}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 transition-colors hover:text-amber-700 disabled:opacity-50 dark:text-amber-400 dark:hover:text-amber-300"
            >
              <RotateCcw className={`h-3 w-3 ${isReprocessing ? 'animate-spin' : ''}`} />
              {isReprocessing ? 'Reprocessing...' : 'Reprocess from source'}
            </button>
          )}
        </div>
      )}

      {/* Reprocess confirmation dialog */}
      {showReprocessConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card shadow-lodge-lg mx-4 max-w-sm rounded-xl p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <h3 className="text-foreground text-sm font-semibold">Reprocess from Source</h3>
            </div>
            <p className="text-muted-foreground mb-4 text-xs">
              Re-run the full pipeline for{' '}
              <span className="text-foreground font-medium">{requester_info.name}</span>&apos;s
              original bunk request text. This will regenerate all parsed requests from the source
              CSV row and write them to production.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowReprocessConfirm(false)}
                className="text-muted-foreground hover:bg-muted rounded-md px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReprocessConfirm(false)
                  onReprocess?.()
                }}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
