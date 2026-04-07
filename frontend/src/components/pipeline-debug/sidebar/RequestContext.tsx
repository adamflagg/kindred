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
      <p className="text-[10px] font-semibold tracking-widest text-blue-400 uppercase">
        Request Context
      </p>

      {/* Requester */}
      <div>
        <p className="text-sm font-semibold text-gray-100">{requester_info.name}</p>
        <p className="text-xs text-gray-400">
          Grade {requester_info.grade} · CM {requester_info.cm_id}
        </p>
      </div>

      {/* Original text */}
      <div>
        <p className="text-[10px] font-medium tracking-wide text-gray-500 uppercase">Original</p>
        <div className="mt-1 rounded border-l-2 border-blue-500 bg-gray-800/50 px-2 py-1.5">
          <p className="text-xs leading-relaxed break-words text-gray-300">
            {original_text || <em className="text-gray-500">empty</em>}
          </p>
        </div>
      </div>

      {/* BR fragment — what P1 split out for this specific BR */}
      {activeIntent && (
        <div>
          <p className="text-[10px] font-medium tracking-wide text-gray-500 uppercase">
            This BR&apos;s Fragment
          </p>
          <div className="mt-1 rounded border-l-2 border-pink-400 bg-gray-800/50 px-2 py-1.5">
            <p className="text-xs text-pink-300">
              &quot;{activeIntent.target_name}&quot;
              {activeIntent.request_type !== 'BUNK_WITH' && (
                <span className="ml-1 text-gray-500">({activeIntent.request_type})</span>
              )}
            </p>
          </div>
          {totalIntents > 1 && (
            <p className="mt-0.5 text-[10px] text-gray-500">
              BR {activeIntentIndex + 1} of {totalIntents} ·{' '}
              {FIELD_LABELS[field_path] ?? field_path}
            </p>
          )}
          {totalIntents <= 1 && (
            <p className="mt-0.5 text-[10px] text-gray-500">
              {FIELD_LABELS[field_path] ?? field_path}
            </p>
          )}
        </div>
      )}

      {/* Final result */}
      {activeBR && (
        <div className="border-t border-gray-700 pt-2">
          <p className="text-[10px] font-medium tracking-wide text-gray-500 uppercase">Result</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor(activeBR.status)}`}
            >
              {activeBR.status}
            </span>
            <span className="text-xs text-gray-400">{activeBR.confidence}</span>
          </div>
          {activeBR.requested_name && (
            <p className="mt-0.5 text-xs text-gray-400">
              → {activeBR.requested_name} ({activeBR.resolution_method})
            </p>
          )}
          {activeBR.disposition_reason &&
            activeBR.disposition_reason !== activeBR.resolution_method && (
              <p className="text-[10px] text-gray-500">{activeBR.disposition_reason}</p>
            )}
        </div>
      )}
    </div>
  )
}
