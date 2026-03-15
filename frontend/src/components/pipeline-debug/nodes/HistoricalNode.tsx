/**
 * HistoricalNode - React Flow node for Phase 2.5 (Historical Verification).
 *
 * States:
 * - success: ran (with or without boost)
 * - skipped: not ran
 */

import type { NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { HistoricalVerificationTrace } from '../types'

interface HistoricalNodeData {
  historical: HistoricalVerificationTrace
  isStale?: boolean
  [key: string]: unknown
}

function getState(data: HistoricalVerificationTrace): NodeState {
  if (!data.ran) return 'skipped'
  return 'success'
}

function getMetric(data: HistoricalVerificationTrace): string {
  if (!data.ran) return 'not run'
  if (data.boost_applied) {
    return `boosted: ${data.original_confidence?.toFixed(2)} -> ${data.boosted_confidence?.toFixed(2)}`
  }
  return 'no boost needed'
}

export function HistoricalNode({ data }: NodeProps<HistoricalNodeData>) {
  const trace = data.historical
  return (
    <BaseNode
      label="P2.5 Historical"
      state={getState(trace)}
      metric={getMetric(trace)}
      isStale={data.isStale}
    />
  )
}
