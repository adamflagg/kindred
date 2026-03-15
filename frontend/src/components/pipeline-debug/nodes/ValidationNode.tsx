/**
 * ValidationNode - React Flow node for the Validation stage.
 *
 * States:
 * - success: all validations passed, no rejections
 * - warning: temporal conflicts filtered
 * - error: type validation failed or source text rejections
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { ValidationTrace } from '../types'

type ValidationNodeType = Node<{ validation: ValidationTrace; isStale?: boolean }>

function getState(data: ValidationTrace): NodeState {
  const hasRejections = !data.type_validation.passed || data.source_text_validation.rejected > 0
  if (hasRejections) return 'error'
  if (data.temporal_conflicts.filtered > 0) return 'warning'
  return 'success'
}

function getMetric(data: ValidationTrace): string {
  if (!data.type_validation.passed) return 'type check failed'
  if (data.source_text_validation.rejected > 0) {
    return `${data.source_text_validation.rejected} rejected`
  }
  if (data.temporal_conflicts.filtered > 0) {
    return `${data.temporal_conflicts.filtered} conflict${data.temporal_conflicts.filtered !== 1 ? 's' : ''}`
  }
  return 'all passed'
}

export function ValidationNode({ data }: NodeProps<ValidationNodeType>) {
  const trace = data.validation
  return (
    <BaseNode
      label="Validation"
      state={getState(trace)}
      metric={getMetric(trace)}
      isStale={data.isStale}
    />
  )
}
