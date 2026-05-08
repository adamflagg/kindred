/**
 * Phase3Detail - Detail panel for Phase 3 (AI Disambiguation).
 *
 * Input:   Ambiguous candidates from Phase 2 that couldn't be resolved locally
 * Action:  AI picks the best match from the candidate list
 * Output:  Selected match, confidence before/after, AI reasoning
 */

import type { Phase3IntentTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { CollapsibleSection } from './CollapsibleSection'
import { IntentTabs } from './IntentTabs'
import { PhaseHeader } from './PhaseHeader'

interface Phase3DetailProps {
  data: Phase3IntentTrace[]
  activeTab: number
  onTabChange: (idx: number) => void
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean | undefined
}

function resultColor(result: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (result) {
    case 'resolved':
      return 'green'
    case 'still_ambiguous':
      return 'amber'
    case 'no_match':
      return 'red'
    case 'invalid_ai_output':
      return 'amber'
    default:
      return 'gray'
  }
}

function IntentPanel({ intent }: { intent: Phase3IntentTrace }) {
  return (
    <div className="space-y-4">
      {/* INPUT */}
      <PanelSection label="Input">
        <DataRow
          label="Target"
          value={intent.target_name || <em className="text-muted-foreground">unnamed</em>}
        />
        <DataRow label="Candidates Sent" value={String(intent.candidates_sent.length)} />
      </PanelSection>

      {/* ACTION */}
      <PanelSection label="Action">
        <DataRow
          label="AI Ran"
          value={
            <Badge label={intent.ran ? 'Yes' : 'Skipped'} color={intent.ran ? 'green' : 'gray'} />
          }
        />
        {intent.ran && intent.ai_selection !== null && (
          <DataRow label="AI Selection" value={String(intent.ai_selection)} mono />
        )}
        {intent.ran && intent.ai_reasoning && (
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-1 text-xs font-medium">AI Reasoning</p>
            <p className="text-foreground text-sm">{intent.ai_reasoning}</p>
          </div>
        )}
        {intent.ran && intent.ai_reasoning_summary && (
          <DataRow label="AI Summary" value={intent.ai_reasoning_summary} />
        )}
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        <div className="flex flex-wrap gap-2">
          <Badge label={intent.result} color={resultColor(intent.result)} />
          {intent.reranked && <Badge label="Reranked" color="blue" />}
          {intent.no_match_signal && <Badge label="No Match" color="red" />}
        </div>
        {intent.ran && (
          <div className="bg-muted rounded-lg p-3">
            <DataRow
              label="Confidence Before"
              value={intent.confidence_before !== null ? String(intent.confidence_before) : '—'}
            />
            {intent.ai_confidence != null && (
              <DataRow label="AI Confidence" value={String(intent.ai_confidence)} />
            )}
            <DataRow
              label="Confidence After"
              value={intent.confidence_after !== null ? String(intent.confidence_after) : '—'}
            />
            {intent.jw_score != null && (
              <DataRow label="JW Score" value={String(intent.jw_score)} />
            )}
          </div>
        )}
      </PanelSection>

      {/* ADDITIONAL DATA */}
      {intent.ran && (
        <>
          <CollapsibleSection title={`Candidates Sent (${intent.candidates_sent.length})`}>
            {intent.candidates_sent.length === 0 ? (
              <p className="text-muted-foreground text-xs">No candidates</p>
            ) : (
              <div className="space-y-2">
                {intent.candidates_sent.map((c, idx) => {
                  const cmId = c['person_cm_id'] as number
                  const name = c['name'] as string
                  const grade = c['grade'] as number | undefined
                  const aiConf =
                    typeof c['ai_confidence'] === 'number' ? c['ai_confidence'] : undefined
                  const isSelected = cmId === intent.ai_selection
                  return (
                    <div
                      key={idx}
                      className={`rounded border p-2 text-xs ${isSelected ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20' : 'border-border'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">{name}</span>
                        <span className="text-muted-foreground">#{cmId}</span>
                        {isSelected && <Badge label="Selected" color="blue" />}
                      </div>
                      <div className="text-muted-foreground mt-1 flex flex-wrap gap-2">
                        {grade != null && <span>Grade: {grade}</span>}
                        {aiConf != null && <span>AI: {aiConf.toFixed(2)}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CollapsibleSection>

          {Object.keys(intent.ai_context).length > 0 && (
            <CollapsibleSection title="AI Context">
              <pre className="text-foreground max-h-48 overflow-auto text-xs">
                {JSON.stringify(intent.ai_context, null, 2)}
              </pre>
            </CollapsibleSection>
          )}
        </>
      )}
    </div>
  )
}

export function Phase3Detail({
  data,
  activeTab,
  onTabChange,
  onRerunPhase,
  onRunFromHere,
  isRunning,
}: Phase3DetailProps) {
  const ranCount = data.filter((i) => i.ran).length
  const resolvedCount = data.filter((i) => i.result === 'resolved').length

  let phaseStatus: 'not_run' | 'skipped' | 'ran'
  let phaseStatusLabel: string
  if (data.length === 0) {
    phaseStatus = 'not_run'
    phaseStatusLabel = 'not run'
  } else if (ranCount === 0) {
    phaseStatus = 'skipped'
    phaseStatusLabel = 'skipped'
  } else {
    phaseStatus = 'ran'
    phaseStatusLabel = `${ranCount} ran`
  }

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="phase3"
        status={phaseStatus}
        statusLabel={phaseStatusLabel}
        metrics={
          data.length > 0 && ranCount > 0 ? (
            <>
              <DataRow label="Intents" value={String(data.length)} />
              <DataRow label="Matched" value={`${resolvedCount}/${ranCount}`} />
            </>
          ) : null
        }
      />

      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No disambiguation data.</p>
      ) : (
        <>
          <IntentTabs items={data} activeTab={activeTab} onTabChange={onTabChange} />
          {data[activeTab] != null && <IntentPanel intent={data[activeTab]} />}
        </>
      )}

      <ActionButtons
        onRerunPhase={onRerunPhase}
        onRunFromHere={onRunFromHere}
        isRunning={isRunning}
      />
    </div>
  )
}
