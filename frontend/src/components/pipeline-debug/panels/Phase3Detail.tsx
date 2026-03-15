/**
 * Phase3Detail - Detail panel for Phase 3 (AI Disambiguation).
 *
 * Tabbed per intent. Shows: candidates sent, AI context, AI selection,
 * AI reasoning, ai_reasoning_summary, result, confidence before/after.
 */

import { useState } from 'react'
import type { Phase3IntentTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge } from './DataRow'
import { CollapsibleSection } from './CollapsibleSection'

interface Phase3DetailProps {
  data: Phase3IntentTrace[]
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
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
    default:
      return 'gray'
  }
}

function IntentPanel({ intent }: { intent: Phase3IntentTrace }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge label={intent.result} color={resultColor(intent.result)} />
        {intent.ran && <Badge label="Ran" color="blue" />}
        {!intent.ran && <Badge label="Skipped" color="gray" />}
      </div>

      {intent.ran && (
        <>
          {/* Confidence */}
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
            <DataRow
              label="Confidence Before"
              value={intent.confidence_before !== null ? String(intent.confidence_before) : '-'}
            />
            <DataRow
              label="Confidence After"
              value={intent.confidence_after !== null ? String(intent.confidence_after) : '-'}
            />
            {intent.ai_selection !== null && (
              <DataRow label="AI Selection" value={String(intent.ai_selection)} mono />
            )}
          </div>

          {/* AI reasoning */}
          {intent.ai_reasoning && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                AI Reasoning
              </p>
              <p className="text-sm text-gray-800 dark:text-gray-200">{intent.ai_reasoning}</p>
            </div>
          )}

          {intent.ai_reasoning_summary && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                AI Reasoning Summary
              </p>
              <p className="text-sm text-gray-800 dark:text-gray-200">
                {intent.ai_reasoning_summary}
              </p>
            </div>
          )}

          {/* Candidates sent */}
          <CollapsibleSection title={`Candidates Sent (${intent.candidates_sent.length})`}>
            {intent.candidates_sent.length === 0 ? (
              <p className="text-xs text-gray-400">No candidates</p>
            ) : (
              <pre className="max-h-48 overflow-auto text-xs text-gray-700 dark:text-gray-300">
                {JSON.stringify(intent.candidates_sent, null, 2)}
              </pre>
            )}
          </CollapsibleSection>

          {/* AI context */}
          {Object.keys(intent.ai_context).length > 0 && (
            <CollapsibleSection title="AI Context">
              <pre className="max-h-48 overflow-auto text-xs text-gray-700 dark:text-gray-300">
                {JSON.stringify(intent.ai_context, null, 2)}
              </pre>
            </CollapsibleSection>
          )}
        </>
      )}
    </div>
  )
}

export function Phase3Detail({ data, onRunAgain, onRunFromHere, isRunning }: Phase3DetailProps) {
  const [activeTab, setActiveTab] = useState(0)

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Phase 3 Disambiguation
        </h3>
        <p className="text-sm text-gray-500">No disambiguation data.</p>
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
        Phase 3 Disambiguation
      </h3>

      {/* Tabs for multi-intent */}
      {data.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {data.map((intent, idx) => (
            <button
              key={idx}
              onClick={() => setActiveTab(idx)}
              role="tab"
              aria-label={intent.target_name}
              aria-selected={activeTab === idx}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === idx
                  ? 'border-blue-500 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              {intent.target_name}
            </button>
          ))}
        </div>
      )}

      {data[activeTab] != null && <IntentPanel intent={data[activeTab]} />}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
