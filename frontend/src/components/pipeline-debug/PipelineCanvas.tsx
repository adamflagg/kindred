/**
 * PipelineCanvas - React Flow canvas with 8 pipeline phase nodes.
 *
 * Horizontal left-to-right layout with fitView and minimap.
 * Clicking a node calls onNodeSelect to open the detail panel.
 */

import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PrePhase1Node } from './nodes/PrePhase1Node'
import { Phase1Node } from './nodes/Phase1Node'
import { ValidationNode } from './nodes/ValidationNode'
import { Phase2Node } from './nodes/Phase2Node'
import { ExpansionNode } from './nodes/ExpansionNode'
import { HistoricalNode } from './nodes/HistoricalNode'
import { Phase3Node } from './nodes/Phase3Node'
import { PostPipelineNode } from './nodes/PostPipelineNode'
import { PHASE_ORDER, type TraceData, type PipelinePhase } from './types'

interface PipelineCanvasProps {
  traceData: TraceData
  selectedNode: PipelinePhase | null
  onNodeSelect: (phase: PipelinePhase) => void
  stalePhases: Set<PipelinePhase>
}

const NODE_TYPES = {
  prePhase1: PrePhase1Node,
  phase1: Phase1Node,
  validation: ValidationNode,
  phase2: Phase2Node,
  expansion: ExpansionNode,
  historical: HistoricalNode,
  phase3: Phase3Node,
  postPipeline: PostPipelineNode,
}

/** Horizontal spacing between nodes */
const X_SPACING = 200
const Y_POS = 50

const PHASE_NODE_TYPES: Record<PipelinePhase, string> = {
  pre_phase1: 'prePhase1',
  phase1: 'phase1',
  validation: 'validation',
  phase2: 'phase2',
  expansion: 'expansion',
  historical: 'historical',
  phase3: 'phase3',
  post_pipeline: 'postPipeline',
}

function getNodeData(traceData: TraceData, phase: PipelinePhase, isStale: boolean) {
  switch (phase) {
    case 'pre_phase1':
      return { prePhase1: traceData.pre_phase1, isStale }
    case 'phase1':
      return { phase1: traceData.phase1_parse, isStale }
    case 'validation':
      return { validation: traceData.validation, isStale }
    case 'phase2':
      return { phase2: traceData.phase2_resolution, isStale }
    case 'expansion':
      return { expansion: traceData.placeholder_expansion, isStale }
    case 'historical':
      return { historical: traceData.historical_verification, isStale }
    case 'phase3':
      return { phase3: traceData.phase3_disambiguation, isStale }
    case 'post_pipeline':
      return { postPipeline: traceData.post_pipeline, isStale }
  }
}

export function PipelineCanvas({
  traceData,
  selectedNode,
  onNodeSelect,
  stalePhases,
}: PipelineCanvasProps) {
  const nodes: Node[] = useMemo(
    () =>
      PHASE_ORDER.map((phase, idx) => ({
        id: phase,
        type: PHASE_NODE_TYPES[phase],
        position: { x: idx * X_SPACING, y: Y_POS },
        data: getNodeData(traceData, phase, stalePhases.has(phase)),
        selected: selectedNode === phase,
      })),
    [traceData, selectedNode, stalePhases]
  )

  const edges: Edge[] = useMemo(
    () =>
      PHASE_ORDER.slice(0, -1).map((phase, idx) => {
        const nextPhase = PHASE_ORDER[idx + 1]!
        return {
          id: `e-${phase}-${nextPhase}`,
          source: phase,
          target: nextPhase,
          animated: false,
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        }
      }),
    []
  )

  const handleNodeClick = useCallback(
    (_: unknown, node: { id: string }) => {
      onNodeSelect(node.id as PipelinePhase)
    },
    [onNodeSelect]
  )

  return (
    <div className="h-[280px] w-full rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
        <MiniMap
          className="!right-2 !bottom-2"
          nodeStrokeWidth={3}
          pannable={false}
          zoomable={false}
        />
        <Controls showInteractive={false} className="!bottom-2 !left-2" />
      </ReactFlow>
    </div>
  )
}
