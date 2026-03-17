/**
 * HistoricalNode - React Flow node for Phase 2.5 (Historical Verification).
 *
 * States:
 * - success: ran (with or without boost)
 * - skipped: not ran
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { HistoricalVerificationTrace, BaseNodeData } from '../types'
import { baseNodeProps } from '../types'

interface HistoricalData extends BaseNodeData {
  historical: HistoricalVerificationTrace
}
type HistoricalNodeType = Node<HistoricalData>

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

export function HistoricalNode({ data }: NodeProps<HistoricalNodeType>) {
  const trace = data.historical
  return (
    <BaseNode
      label="P2.5 Historical"
      state={getState(trace)}
      metric={getMetric(trace)}
      {...baseNodeProps(data)}
    />
  )
}
