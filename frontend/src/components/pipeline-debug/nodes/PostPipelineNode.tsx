/**
 * PostPipelineNode - React Flow node for Post-Pipeline processing.
 *
 * States:
 * - success: all requests resolved with no conflicts
 * - warning: conflicts detected
 * - error: requests declined
 * - skipped: no final_bunk_requests
 */

import type { Node, NodeProps } from '@xyflow/react'
import { BaseNode, type NodeState } from './BaseNode'
import type { PostPipelineTrace, BaseNodeData } from '../types'
import { baseNodeProps } from '../types'

interface PostPipelineData extends BaseNodeData {
  postPipeline: PostPipelineTrace
}
type PostPipelineNodeType = Node<PostPipelineData>

function getState(data: PostPipelineTrace): NodeState {
  if (data.final_bunk_requests.length === 0) return 'skipped'
  const hasDeclined = data.final_bunk_requests.some((r) => r.status.toUpperCase() === 'DECLINED')
  if (hasDeclined) return 'error'
  if (data.conflict_detection.has_conflict) return 'warning'
  return 'success'
}

function getMetric(data: PostPipelineTrace): string {
  const count = data.final_bunk_requests.length
  if (count === 0) return 'no output'
  return `${count} request${count !== 1 ? 's' : ''}`
}

export function PostPipelineNode({ data }: NodeProps<PostPipelineNodeType>) {
  const trace = data.postPipeline
  return (
    <BaseNode
      label="Post-Pipeline"
      state={getState(trace)}
      metric={getMetric(trace)}
      {...baseNodeProps(data)}
    />
  )
}
