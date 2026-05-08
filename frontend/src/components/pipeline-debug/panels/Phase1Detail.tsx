/**
 * Phase1Detail - Detail panel for Phase 1 (AI Parse).
 *
 * Input:   Cleaned text from pre-phase1 + source field
 * Action:  AI parsing — extracts person names and request types from free text
 * Output:  Parsed intents (target names, types, confidence, keywords, reasoning)
 */

import type { Phase1Trace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { PhaseHeader } from './PhaseHeader'
import { CollapsibleSection } from './CollapsibleSection'
import { confidenceColor } from './panelUtils'

interface Phase1DetailProps {
  data: Phase1Trace
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean | undefined
}

export function Phase1Detail({ data, onRerunPhase, onRunFromHere, isRunning }: Phase1DetailProps) {
  let status: 'not_run' | 'ran' | 'error'
  let statusLabel: string
  if (!data.ran) {
    status = 'not_run'
    statusLabel = 'skipped'
  } else if (data.is_valid) {
    status = 'ran'
    statusLabel = 'valid'
  } else {
    status = 'error'
    statusLabel = 'invalid'
  }

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="phase1"
        status={status}
        statusLabel={statusLabel}
        metrics={
          data.ran ? (
            <>
              <DataRow label="Intents" value={String(data.parsed_intents.length)} />
              {data.token_count != null && (
                <DataRow label="Tokens" value={String(data.token_count)} />
              )}
              {data.processing_time_ms != null && (
                <DataRow label="Time" value={`${data.processing_time_ms}ms`} />
              )}
            </>
          ) : null
        }
      />

      {data.error_message && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {data.error_message}
        </div>
      )}

      {/* INPUT */}
      <PanelSection label="Input">
        <DataRow
          label="Source Field"
          value={data.parse_request['field_name'] ? String(data.parse_request['field_name']) : '—'}
          mono
        />
        {data.sanitization.is_suspicious && (
          <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              ⚠ Suspicious input detected
            </p>
            <DataRow label="Risk Level" value={data.sanitization.risk_level ?? 'unknown'} />
            <DataRow
              label="Confidence Penalty"
              value={String(data.sanitization.confidence_penalty)}
            />
          </div>
        )}
      </PanelSection>

      {/* ACTION */}
      <PanelSection label="Action">
        <DataRow
          label="AI Ran"
          value={<Badge label={data.ran ? 'Yes' : 'No'} color={data.ran ? 'green' : 'gray'} />}
        />
        {data.ai_reasoning_summary && (
          <DataRow label="AI Summary" value={data.ai_reasoning_summary} />
        )}
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        {data.parsed_intents.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">No intents parsed</p>
        ) : (
          data.parsed_intents.map((intent, idx) => (
            <div key={idx} className="border-border rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-foreground text-sm font-semibold">
                  {intent.target_name || (
                    <em className="text-muted-foreground font-normal">unnamed</em>
                  )}
                </span>
                <Badge label={intent.request_type} color="blue" />
                <Badge
                  label={String(intent.confidence)}
                  color={confidenceColor(intent.confidence)}
                />
                {intent.needs_clarification && <Badge label="needs clarification" color="amber" />}
              </div>
              <div className="space-y-1 text-sm">
                {intent.keywords_found.length > 0 && (
                  <DataRow label="Keywords" value={intent.keywords_found.join(', ')} />
                )}
                {intent.reasoning && <DataRow label="Reasoning" value={intent.reasoning} />}
                {intent.ai_reasoning_summary && (
                  <DataRow label="AI Reasoning" value={intent.ai_reasoning_summary} />
                )}
                {intent.parse_notes && <DataRow label="Notes" value={intent.parse_notes} />}
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
              </div>
            </div>
          ))
        )}
      </PanelSection>

      {/* ADDITIONAL DATA */}
      <CollapsibleSection title="Raw AI Response">
        <pre className="bg-muted text-muted-foreground max-h-64 overflow-auto rounded-lg p-3 text-xs">
          {JSON.stringify(data.ai_raw_response, null, 2)}
        </pre>
      </CollapsibleSection>

      <ActionButtons
        onRerunPhase={onRerunPhase}
        onRunFromHere={onRunFromHere}
        isRunning={isRunning}
      />
    </div>
  )
}
