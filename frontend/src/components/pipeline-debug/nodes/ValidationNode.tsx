/**
 * ValidationNode - React Flow node for the Validation stage.
 *
 * States:
 * - success: all validations passed, no rejections
 * - warning: temporal conflicts filtered
 * - error: type validation failed or source text rejections
 * - skipped: phase1 did not run (stop-at-phase stopped before validation)
 */

import type { Node, NodeProps, Position } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { ValidationTrace } from '../types'

type ValidationNodeType = Node<{
  validation: ValidationTrace
  phase1Ran?: boolean | undefined
  isStale?: boolean | undefined
  tooltip?: string | undefined
  inputPosition?: Position | undefined
  outputPosition?: Position | undefined
  showInput?: boolean | undefined
  showOutput?: boolean | undefined
}>

function getState(data: ValidationTrace, phase1Ran?: boolean): NodeState {
  if (phase1Ran === false) return 'skipped'
  const hasRejections = !data.type_validation.passed || data.source_text_validation.rejected > 0
  if (hasRejections) return 'error'
  if (data.temporal_conflicts.filtered > 0) return 'warning'
  return 'success'
}

function getMetric(data: ValidationTrace, phase1Ran?: boolean): string {
  if (phase1Ran === false) return 'not run'
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
      state={getState(trace, data.phase1Ran)}
      metric={getMetric(trace, data.phase1Ran)}
      isStale={data.isStale}
      tooltip={data.tooltip}
      showInput={data.showInput}
      showOutput={data.showOutput}
      inputPosition={data.inputPosition}
      outputPosition={data.outputPosition}
    />
  )
}
