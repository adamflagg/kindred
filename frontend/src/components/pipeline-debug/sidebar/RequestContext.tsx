import type { TraceData } from '../types'

interface RequestContextProps {
  traceData: TraceData
  /** Currently selected intent index (from IntentTabs in Phase2/Phase3 detail panels). */
  activeIntentIndex: number
}

/** Source field display names. */
const FIELD_LABELS: Record<string, string> = {
  ai_parse: 'AI Parse',
  socialize_direct_map: 'Socialize',
  bunk_with: 'bunk_with',
  not_bunk_with: 'not_bunk_with',
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

export function RequestContext({ traceData, activeIntentIndex }: RequestContextProps) {
  const { requester_info, original_text, field_path } = traceData.pre_phase1
  const intents = traceData.phase1_parse.parsed_intents
  const totalIntents = intents.length
  const activeIntent = intents[activeIntentIndex] ?? intents[0]
  const finalBRs = traceData.post_pipeline.final_bunk_requests
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
    </div>
  )
}
