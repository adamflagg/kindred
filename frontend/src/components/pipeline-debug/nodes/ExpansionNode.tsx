/**
 * ExpansionNode - React Flow node for Placeholder Expansion.
 *
 * States:
 * - success: triggered with expansions
 * - skipped: not triggered
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { PlaceholderExpansionTrace } from '../types'

type ExpansionNodeType = Node<{ expansion: PlaceholderExpansionTrace; isStale?: boolean }>

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
      isStale={data.isStale}
    />
  )
}
