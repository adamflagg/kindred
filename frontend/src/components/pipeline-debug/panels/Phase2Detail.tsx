/**
 * Phase2Detail - Detail panel for Phase 2 (Name Resolution).
 *
 * Tabbed per intent. Shows: fast paths tried + results, all candidates with
 * score breakdowns, pipeline strategies, final result, staff_filtered,
 * hallucination_detected, social graph details, spread_filter.
 */

import { useState } from 'react'
import type { Phase2IntentTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, confidenceColor } from './DataRow'
import { CollapsibleSection } from './CollapsibleSection'
import { IntentTabs } from './IntentTabs'

interface Phase2DetailProps {
  data: Phase2IntentTrace[]
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean | undefined
}

function IntentPanel({ intent }: { intent: Phase2IntentTrace }) {
  return (
    <div className="space-y-3">
      {/* Final result */}
      <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Final Result</p>
        <div className="space-y-1">
          <DataRow label="Person" value={intent.final_result.person_name ?? 'Not resolved'} />
          <DataRow label="CM ID" value={String(intent.final_result.person_cm_id ?? '-')} mono />
          <DataRow
            label="Confidence"
            value={
              <Badge
                label={String(intent.final_result.confidence)}
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
      </div>

      {/* Fast paths */}
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Fast Paths Tried</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {intent.fast_path_tried.length === 0 ? (
            <span className="text-xs text-gray-400">none</span>
          ) : (
            intent.fast_path_tried.map((fp, idx) => <Badge key={idx} label={fp} color="blue" />)
          )}
        </div>
        {intent.fast_path_result && (
          <pre className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {JSON.stringify(intent.fast_path_result, null, 2)}
          </pre>
        )}
      </div>

      {/* Pipeline strategies */}
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Strategies Tried</p>
        <div className="mt-1 space-y-1">
          {intent.pipeline_strategies_tried.map((s, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300"
            >
              <Badge label={String(s['strategy'] ?? 'unknown')} />
              {s['confidence'] !== undefined && <span>conf: {String(s['confidence'])}</span>}
              {s['candidates_found'] !== undefined && (
                <span>{String(s['candidates_found'])} candidates</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-2">
        {intent.staff_filtered && <Badge label="Staff Filtered" color="amber" />}
        {intent.hallucination_detected && <Badge label="Hallucination Detected" color="red" />}
        {intent.spread_filter_applied && <Badge label="Spread Filter" color="amber" />}
      </div>

      {/* Social graph details */}
      {intent.social_graph_details.enhanced && (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Social Graph</p>
          <DataRow
            label="Connection"
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

      {/* All candidates */}
      <CollapsibleSection title={`All Candidates (${intent.all_candidates.length})`}>
        <div className="space-y-2">
          {intent.all_candidates.map((c, idx) => (
            <div
              key={idx}
              className="rounded border border-gray-100 p-2 text-xs dark:border-gray-700"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-200">{c.name}</span>
                <span className="text-gray-500">#{c.person_cm_id}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-gray-600 dark:text-gray-400">
                {c.session_cm_id && <span>Session: {c.session_cm_id}</span>}
                {c.grade !== null && <span>Grade: {c.grade}</span>}
                {c.school && <span>School: {c.school}</span>}
              </div>
              {Object.keys(c.score_breakdown).length > 0 && (
                <pre className="mt-1 text-[10px] text-gray-500 dark:text-gray-500">
                  {JSON.stringify(c.score_breakdown, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Confidence factors */}
      {Object.keys(intent.final_result.confidence_factors).length > 0 && (
        <CollapsibleSection title="Confidence Factors">
          <pre className="text-xs text-gray-700 dark:text-gray-300">
            {JSON.stringify(intent.final_result.confidence_factors, null, 2)}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  )
}

export function Phase2Detail({ data, onRunAgain, onRunFromHere, isRunning }: Phase2DetailProps) {
  const [activeTab, setActiveTab] = useState(0)

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Phase 2 Resolution
        </h3>
        <p className="text-sm text-gray-500">No resolution data available.</p>
        <ActionButtons
          onRunAgain={onRunAgain}
          onRunFromHere={onRunFromHere}
          isRunning={isRunning}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Phase 2 Resolution
      </h3>

      <IntentTabs items={data} activeTab={activeTab} onTabChange={setActiveTab} />

      {data[activeTab] != null && <IntentPanel intent={data[activeTab]} />}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
