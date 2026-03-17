/**
 * HistoricalNode - React Flow node for Phase 2.5 (Historical Verification).
 *
 * States:
 * - success: ran (with or without boost)
 * - skipped: not ran
 */

import type { Node, NodeProps, Position } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { HistoricalVerificationTrace } from '../types'

type HistoricalNodeType = Node<{
  historical: HistoricalVerificationTrace
  isStale?: boolean | undefined
  tooltip?: string | undefined
  inputPosition?: Position | undefined
  outputPosition?: Position | undefined
  showInput?: boolean | undefined
  showOutput?: boolean | undefined
}>

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
      isStale={data.isStale}
      tooltip={data.tooltip}
      showInput={data.showInput}
      showOutput={data.showOutput}
      inputPosition={data.inputPosition}
      outputPosition={data.outputPosition}
    />
  )
}
