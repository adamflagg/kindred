/**
 * ValidationNode - React Flow node for the Validation stage.
 *
 * States:
 * - success: all validations passed, no rejections
 * - warning: temporal conflicts filtered
 * - error: type validation failed or source text rejections
 * - skipped: phase1 did not run (stop-at-phase stopped before validation)
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { ValidationTrace, BaseNodeData } from '../types'
import { baseNodeProps } from '../types'

interface ValidationData extends BaseNodeData {
  validation: ValidationTrace
  phase1Ran?: boolean | undefined
  phase1IntentCount?: number | undefined
}
type ValidationNodeType = Node<ValidationData>

function getState(
  data: ValidationTrace,
  phase1Ran?: boolean,
  phase1IntentCount?: number
): NodeState {
  // Skipped if Phase 1 didn't run, or Phase 1 ran but produced no intents
  // (validation has nothing to validate so its default data is meaningless)
  if (phase1Ran === false) return 'skipped'
  if (phase1Ran === true && (phase1IntentCount ?? 0) === 0) return 'skipped'
  const hasRejections = !data.type_validation.passed || data.source_text_validation.rejected > 0
  if (hasRejections) return 'error'
  if (data.temporal_conflicts.filtered > 0) return 'warning'
  return 'success'
}

function getMetric(data: ValidationTrace, phase1Ran?: boolean, phase1IntentCount?: number): string {
  if (phase1Ran === false) return 'not run'
  if (phase1Ran === true && (phase1IntentCount ?? 0) === 0) return 'not run'
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
      state={getState(trace, data.phase1Ran, data.phase1IntentCount)}
      metric={getMetric(trace, data.phase1Ran, data.phase1IntentCount)}
      {...baseNodeProps(data)}
    />
  )
}
