/**
 * Phase2Detail - Detail panel for Phase 2 (Name Resolution).
 *
 * Input:   Parsed intents (target names) from Phase 1
 * Action:  Fast-path lookups, fuzzy/phonetic/school matching, social graph boost
 * Output:  Resolved person (CM ID, confidence, method) per intent
 */

import type { Phase2IntentTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { confidenceColor } from './panelUtils'
import { CollapsibleSection } from './CollapsibleSection'
import { IntentTabs } from './IntentTabs'
import { PhaseHeader } from './PhaseHeader'

interface Phase2DetailProps {
  data: Phase2IntentTrace[]
  activeTab: number
  onTabChange: (idx: number) => void
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean | undefined
}

function IntentPanel({ intent }: { intent: Phase2IntentTrace }) {
  return (
    <div className="space-y-4">
      {/* INPUT */}
      <PanelSection label="Input">
        <DataRow
          label="Target Name"
          value={intent.target_name || <em className="text-muted-foreground">unnamed</em>}
        />
        <div className="flex items-start gap-3 py-1">
          <span className="text-muted-foreground shrink-0 text-xs font-medium">Fast Paths</span>
          <div className="flex flex-wrap gap-1">
            {intent.fast_path_tried.length === 0 ? (
              <span className="text-muted-foreground text-sm italic">none tried</span>
            ) : (
              intent.fast_path_tried.map((fp, idx) => <Badge key={idx} label={fp} color="blue" />)
            )}
          </div>
        </div>
        {intent.fast_path_result && (
          <pre className="bg-muted text-muted-foreground mt-1 max-h-24 overflow-auto rounded p-2 text-[10px]">
            {JSON.stringify(intent.fast_path_result, null, 2)}
          </pre>
        )}
      </PanelSection>

      {/* ACTION */}
      <PanelSection label="Action">
        <div className="space-y-1">
          {intent.pipeline_strategies_tried.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">No strategies ran</p>
          ) : (
            intent.pipeline_strategies_tried.map((s, idx) => (
              <div
                key={idx}
                className="bg-muted text-foreground flex items-center gap-2 rounded-md px-2 py-1 text-xs"
              >
                <Badge label={String(s['strategy'] ?? 'unknown')} color="blue" />
                {s['confidence'] !== undefined && (
                  <span className="text-muted-foreground">conf: {String(s['confidence'])}</span>
                )}
                {s['candidates_found'] !== undefined && (
                  <span className="text-muted-foreground">
                    {String(s['candidates_found'])} candidates
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        {intent.social_graph_details.enhanced && (
          <div className="mt-2 rounded-lg border border-blue-200 p-3 dark:border-blue-800/40">
            <p className="mb-1 text-xs font-medium text-blue-700 dark:text-blue-400">
              Social Graph Enhanced
            </p>
            <DataRow
              label="Connection Strength"
              value={String(intent.social_graph_details.connection_strength ?? '-')}
            />
            <DataRow
              label="Shared Friends"
              value={String(intent.social_graph_details.shared_friends ?? '-')}
            />
            <DataRow
              label="Smart Resolved"
              value={intent.social_graph_details.smart_resolved ? 'Yes' : 'No'}
            />
            <DataRow
              label="Reranked"
              value={intent.social_graph_details.candidates_reranked ? 'Yes' : 'No'}
            />
          </div>
        )}
        {(intent.staff_filtered ||
          intent.hallucination_detected ||
          intent.spread_filter_applied) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {intent.staff_filtered && <Badge label="Staff Filtered" color="amber" />}
            {intent.hallucination_detected && <Badge label="Hallucination Detected" color="red" />}
            {intent.spread_filter_applied && <Badge label="Spread Filter" color="amber" />}
          </div>
        )}
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        <div className="bg-muted rounded-lg p-3">
          <DataRow
            label="Person"
            value={
              intent.final_result.person_name ?? (
                <em className="text-muted-foreground">Not resolved</em>
              )
            }
          />
          <DataRow label="CM ID" value={String(intent.final_result.person_cm_id ?? '—')} mono />
          <DataRow
            label="Confidence"
            value={
              <Badge
                label={`${Math.round(intent.final_result.confidence * 100)}%`}
                color={confidenceColor(intent.final_result.confidence)}
              />
            }
          />
          <DataRow label="Method" value={intent.final_result.method} />
          <DataRow
            label="Status"
            value={
              <Badge
                label={
                  intent.final_result.is_resolved
                    ? 'Resolved'
                    : intent.final_result.is_ambiguous
                      ? 'Ambiguous'
                      : 'Unresolved'
                }
                color={
                  intent.final_result.is_resolved
                    ? 'green'
                    : intent.final_result.is_ambiguous
                      ? 'amber'
                      : 'red'
                }
              />
            }
          />
        </div>
      </PanelSection>

      {/* ADDITIONAL DATA */}
      <CollapsibleSection title={`All Candidates (${intent.all_candidates.length})`}>
        <div className="space-y-2">
          {intent.all_candidates.map((c, idx) => (
            <div key={idx} className="border-border rounded border p-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-foreground font-medium">{c.name}</span>
                <span className="text-muted-foreground">#{c.person_cm_id}</span>
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap gap-2">
                {c.session_cm_id && <span>Session: {c.session_cm_id}</span>}
                {c.grade !== null && <span>Grade: {c.grade}</span>}
                {c.school && <span>School: {c.school}</span>}
              </div>
              {Object.keys(c.score_breakdown).length > 0 && (
                <pre className="text-muted-foreground mt-1 text-[10px]">
                  {JSON.stringify(c.score_breakdown, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {Object.keys(intent.final_result.confidence_factors).length > 0 && (
        <CollapsibleSection title="Confidence Factors">
          <pre className="text-foreground text-xs">
            {JSON.stringify(intent.final_result.confidence_factors, null, 2)}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  )
}

export function Phase2Detail({
  data,
  activeTab,
  onTabChange,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: Phase2DetailProps) {
  const resolvedCount = data.filter((i) => i.final_result.is_resolved).length

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="phase2"
        status={data.length === 0 ? 'not_run' : 'ran'}
        statusLabel={data.length === 0 ? 'not run' : 'ran'}
        metrics={
          data.length > 0 ? (
            <>
              <DataRow label="Intents" value={String(data.length)} />
              <DataRow label="Resolved" value={`${resolvedCount}/${data.length}`} />
            </>
          ) : null
        }
      />

      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No resolution data available.</p>
      ) : (
        <>
          <IntentTabs items={data} activeTab={activeTab} onTabChange={onTabChange} />
          {data[activeTab] != null && <IntentPanel intent={data[activeTab]} />}
        </>
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
