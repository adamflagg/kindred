/**
 * Phase3Node - React Flow node for Phase 3 (AI Disambiguation).
 *
 * States:
 * - success: resolved
 * - warning: still_ambiguous
 * - error: no_match
 * - skipped: not_needed or ran=false for all intents
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { Phase3IntentTrace } from '../types'

type Phase3NodeType = Node<{ phase3: Phase3IntentTrace[]; isStale?: boolean }>

function getState(intents: Phase3IntentTrace[]): NodeState {
  if (intents.length === 0) return 'skipped'
  const allNotNeeded = intents.every((i) => i.result === 'not_needed' || !i.ran)
  if (allNotNeeded) return 'skipped'
  const hasNoMatch = intents.some((i) => i.ran && i.result === 'no_match')
  if (hasNoMatch) return 'error'
  const hasAmbiguous = intents.some((i) => i.ran && i.result === 'still_ambiguous')
  if (hasAmbiguous) return 'warning'
  return 'success'
}

function getMetric(intents: Phase3IntentTrace[]): string {
  const ran = intents.filter((i) => i.ran)
  if (ran.length === 0) return 'not needed'
  const resolved = ran.filter((i) => i.result === 'resolved')
  if (resolved.length === ran.length) return `${resolved.length} resolved`
  return `${resolved.length}/${ran.length} resolved`
}

export function Phase3Node({ data }: NodeProps<Phase3NodeType>) {
  const intents = data.phase3
  return (
    <BaseNode
      label="Phase 3 Disambig"
      state={getState(intents)}
      metric={getMetric(intents)}
      isStale={data.isStale}
    />
  )
}
