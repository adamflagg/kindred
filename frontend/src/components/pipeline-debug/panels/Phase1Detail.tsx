/**
 * Phase1Detail - Detail panel for Phase 1 (AI Parse).
 *
 * Shows: all parsed intents with target name, type, confidence, keywords,
 * reasoning, parse notes, needs_clarification, temporal info.
 * Plus: raw AI response (collapsible), token count, processing time,
 * sanitization, is_valid, error.
 */

import type { Phase1Trace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge } from './DataRow'
import { CollapsibleSection } from './CollapsibleSection'

interface Phase1DetailProps {
  data: Phase1Trace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

function confidenceColor(c: number): 'green' | 'amber' | 'red' {
  if (c >= 0.8) return 'green'
  if (c >= 0.5) return 'amber'
  return 'red'
}

export function Phase1Detail({ data, onRunAgain, onRunFromHere, isRunning }: Phase1DetailProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Phase 1 Parse</h3>

      {/* Summary metrics */}
      <div className="flex flex-wrap gap-4">
        <DataRow
          label="Valid"
          value={
            <Badge label={data.is_valid ? 'Yes' : 'No'} color={data.is_valid ? 'green' : 'red'} />
          }
        />
        <DataRow label="Tokens" value={String(data.token_count ?? '-')} />
        <DataRow label="Time" value={`${data.processing_time_ms ?? '-'}ms`} />
        <DataRow label="Intents" value={String(data.parsed_intents.length)} />
      </div>

      {data.error_message && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {data.error_message}
        </div>
      )}

      {/* Sanitization */}
      {data.sanitization.is_suspicious && (
        <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Suspicious Input</p>
          <DataRow label="Risk Level" value={data.sanitization.risk_level ?? 'unknown'} />
          <DataRow
            label="Confidence Penalty"
            value={String(data.sanitization.confidence_penalty)}
          />
        </div>
      )}

      {/* Parsed intents */}
      {data.parsed_intents.map((intent, idx) => (
        <div key={idx} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {intent.target_name}
            </span>
            <Badge label={intent.request_type} color="blue" />
            <Badge label={String(intent.confidence)} color={confidenceColor(intent.confidence)} />
            {intent.needs_clarification && <Badge label="needs clarification" color="amber" />}
          </div>
          <div className="space-y-1 text-sm">
            <DataRow label="Keywords" value={intent.keywords_found.join(', ')} />
            <DataRow label="Reasoning" value={intent.reasoning} />
            {intent.ai_reasoning_summary && (
              <DataRow label="AI Reasoning" value={intent.ai_reasoning_summary} />
            )}
            {intent.parse_notes && <DataRow label="Parse Notes" value={intent.parse_notes} />}
            {intent.temporal_info && (
              <>
                <DataRow
                  label="Temporal"
                  value={intent.temporal_info.is_superseded ? 'Superseded' : 'Active'}
                />
                {intent.temporal_info.date && (
                  <DataRow label="Date" value={intent.temporal_info.date} />
                )}
              </>
            )}
            <DataRow label="CSV Position" value={String(intent.csv_position)} mono />
          </div>
        </div>
      ))}

      {/* AI reasoning summary */}
      {data.ai_reasoning_summary && (
        <CollapsibleSection title="AI Reasoning Summary">
          <p className="text-sm text-gray-700 dark:text-gray-300">{data.ai_reasoning_summary}</p>
        </CollapsibleSection>
      )}

      {/* Raw AI response */}
      <CollapsibleSection title="Raw AI Response">
        <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
          {JSON.stringify(data.ai_raw_response, null, 2)}
        </pre>
      </CollapsibleSection>

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
