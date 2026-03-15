/**
 * Phase1Node - React Flow node for Phase 1 (AI Parse).
 *
 * States:
 * - success: is_valid with high-confidence intents
 * - warning: is_valid but low confidence or needs_clarification
 * - error: !is_valid or error_message present
 * - skipped: ran = false
 */

import type { NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { Phase1Trace } from '../types'

interface Phase1NodeData {
  phase1: Phase1Trace
  isStale?: boolean
  [key: string]: unknown
}

function getState(data: Phase1Trace): NodeState {
  if (!data.ran) return 'skipped'
  if (!data.is_valid || data.error_message) return 'error'
  const hasLowConf = data.parsed_intents.some((i) => i.confidence < 0.6)
  const needsClarification = data.parsed_intents.some((i) => i.needs_clarification)
  if (hasLowConf || needsClarification) return 'warning'
  return 'success'
}

function getMetric(data: Phase1Trace): string {
  if (!data.ran) return 'not run'
  if (!data.is_valid) return 'parse failed'
  const count = data.parsed_intents.length
  return `${count} intent${count !== 1 ? 's' : ''}`
}

export function Phase1Node({ data }: NodeProps<Phase1NodeData>) {
  const trace = data.phase1
  return (
    <BaseNode
      label="Phase 1 Parse"
      state={getState(trace)}
      metric={getMetric(trace)}
      isStale={data.isStale}
    />
  )
}
