/**
 * ExpansionNode - React Flow node for Placeholder Expansion.
 *
 * States:
 * - success: triggered with expansions
 * - skipped: not triggered
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { PlaceholderExpansionTrace, BaseNodeData } from '../types'
import { baseNodeProps } from '../types'

interface ExpansionData extends BaseNodeData {
  expansion: PlaceholderExpansionTrace
}
type ExpansionNodeType = Node<ExpansionData>

function getState(data: PlaceholderExpansionTrace): NodeState {
  if (!data.triggered) return 'skipped'
  return 'success'
}

function getMetric(data: PlaceholderExpansionTrace): string {
  if (!data.triggered) return 'not triggered'
  return `${data.expanded_count} expanded`
}

export function ExpansionNode({ data }: NodeProps<ExpansionNodeType>) {
  const trace = data.expansion
  return (
    <BaseNode
      label="Expansion"
      state={getState(trace)}
      metric={getMetric(trace)}
      {...baseNodeProps(data)}
    />
  )
}
