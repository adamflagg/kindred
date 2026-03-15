/**
 * PrePhase1Node - React Flow node for the Pre-Phase 1 (preparation) stage.
 *
 * States:
 * - success: action = "parsed" or "direct_mapped"
 * - skipped: action starts with "skipped_"
 * - (no warning/error states for pre-phase 1)
 */

import type { NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { PrePhase1Trace } from '../types'

interface PrePhase1NodeData {
  prePhase1: PrePhase1Trace
  isStale?: boolean
  [key: string]: unknown
}

function getState(data: PrePhase1Trace): NodeState {
  if (data.action.startsWith('skipped_')) return 'skipped'
  return 'success'
}

function getMetric(data: PrePhase1Trace): string {
  return data.action
}

export function PrePhase1Node({ data }: NodeProps<PrePhase1NodeData>) {
  const trace = data.prePhase1
  return (
    <BaseNode
      label="Pre-Phase 1"
      state={getState(trace)}
      metric={getMetric(trace)}
      isStale={data.isStale}
      showInput={false}
    />
  )
}
