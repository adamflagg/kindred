/**
 * Phase2Node - React Flow node for Phase 2 (Name Resolution).
 *
 * States:
 * - success: all intents resolved
 * - warning: some ambiguous
 * - error: unresolved (no match found)
 * - skipped: empty resolution array
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { Phase2IntentTrace, BaseNodeData } from '../types'
import { baseNodeProps } from '../types'

interface Phase2Data extends BaseNodeData {
  phase2: Phase2IntentTrace[]
}
type Phase2NodeType = Node<Phase2Data>

function getState(intents: Phase2IntentTrace[]): NodeState {
  if (intents.length === 0) return 'skipped'
  const hasUnresolved = intents.some(
    (i) => !i.final_result.is_resolved && !i.final_result.is_ambiguous
  )
  if (hasUnresolved) return 'error'
  const hasAmbiguous = intents.some((i) => i.final_result.is_ambiguous)
  if (hasAmbiguous) return 'warning'
  return 'success'
}

function getMetric(intents: Phase2IntentTrace[]): string {
  if (intents.length === 0) return 'no intents'
  const resolved = intents.filter((i) => i.final_result.is_resolved)
  if (resolved.length === intents.length && resolved.length === 1) {
    return resolved[0]!.final_result.method
  }
  return `${resolved.length}/${intents.length} resolved`
}

export function Phase2Node({ data }: NodeProps<Phase2NodeType>) {
  const intents = data.phase2
  return (
    <BaseNode
      label="Phase 2 Resolution"
      state={getState(intents)}
      metric={getMetric(intents)}
      {...baseNodeProps(data)}
    />
  )
}
