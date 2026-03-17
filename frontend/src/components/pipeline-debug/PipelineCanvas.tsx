/**
 * PipelineCanvas - React Flow canvas with 8 pipeline phase nodes.
 *
 * Serpentine 4x2 layout:
 *   Pre-P1 -> P1 Parse -> Validation -> P2 Resolution
 *                                             |
 *   Post-Pipeline <- P3 Disambig <- P2.5 Historical <- Expansion
 *
 * Clicking a node calls onNodeSelect to open the detail panel.
 */

import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  Position,
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
import { PHASE_DESCRIPTIONS } from './phaseDescriptions'

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

const X_SPACING = 220
const Y_SPACING = 120

/** Serpentine 4x2 node positions */
const NODE_POSITIONS: Record<PipelinePhase, { x: number; y: number }> = {
  pre_phase1: { x: 0, y: 0 },
  phase1: { x: X_SPACING, y: 0 },
  validation: { x: 2 * X_SPACING, y: 0 },
  phase2: { x: 3 * X_SPACING, y: 0 },
  expansion: { x: 3 * X_SPACING, y: Y_SPACING },
  historical: { x: 2 * X_SPACING, y: Y_SPACING },
  phase3: { x: X_SPACING, y: Y_SPACING },
  post_pipeline: { x: 0, y: Y_SPACING },
}

/** Handle positions for each node in the serpentine layout */
const NODE_HANDLE_POSITIONS: Record<
  PipelinePhase,
  {
    inputPosition?: Position
    outputPosition?: Position
    showInput: boolean
    showOutput: boolean
  }
> = {
  pre_phase1: { outputPosition: Position.Right, showInput: false, showOutput: true },
  phase1: {
    inputPosition: Position.Left,
    outputPosition: Position.Right,
    showInput: true,
    showOutput: true,
  },
  validation: {
    inputPosition: Position.Left,
    outputPosition: Position.Right,
    showInput: true,
    showOutput: true,
  },
  phase2: {
    inputPosition: Position.Left,
    outputPosition: Position.Bottom,
    showInput: true,
    showOutput: true,
  },
  expansion: {
    inputPosition: Position.Top,
    outputPosition: Position.Left,
    showInput: true,
    showOutput: true,
  },
  historical: {
    inputPosition: Position.Right,
    outputPosition: Position.Left,
    showInput: true,
    showOutput: true,
  },
  phase3: {
    inputPosition: Position.Right,
    outputPosition: Position.Left,
    showInput: true,
    showOutput: true,
  },
  post_pipeline: { inputPosition: Position.Right, showInput: true, showOutput: false },
}

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

/** Explicit edge definitions for serpentine layout */
const EDGE_DEFINITIONS: Array<{ source: PipelinePhase; target: PipelinePhase; type?: string }> = [
  { source: 'pre_phase1', target: 'phase1' },
  { source: 'phase1', target: 'validation' },
  { source: 'validation', target: 'phase2' },
  { source: 'phase2', target: 'expansion', type: 'smoothstep' },
  { source: 'expansion', target: 'historical' },
  { source: 'historical', target: 'phase3' },
  { source: 'phase3', target: 'post_pipeline' },
]

function getNodeData(traceData: TraceData, phase: PipelinePhase, isStale: boolean) {
  const handles = NODE_HANDLE_POSITIONS[phase]
  const base = { isStale, tooltip: PHASE_DESCRIPTIONS[phase], ...handles }
  switch (phase) {
    case 'pre_phase1':
      return { prePhase1: traceData.pre_phase1, ...base }
    case 'phase1':
      return { phase1: traceData.phase1_parse, ...base }
    case 'validation':
      return { validation: traceData.validation, phase1Ran: traceData.phase1_parse.ran, ...base }
    case 'phase2':
      return { phase2: traceData.phase2_resolution, ...base }
    case 'expansion':
      return { expansion: traceData.placeholder_expansion, ...base }
    case 'historical':
      return { historical: traceData.historical_verification, ...base }
    case 'phase3':
      return { phase3: traceData.phase3_disambiguation, ...base }
    case 'post_pipeline':
      return { postPipeline: traceData.post_pipeline, ...base }
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
      PHASE_ORDER.map((phase) => ({
        id: phase,
        type: PHASE_NODE_TYPES[phase],
        position: NODE_POSITIONS[phase],
        data: getNodeData(traceData, phase, stalePhases.has(phase)),
        selected: selectedNode === phase,
      })),
    [traceData, selectedNode, stalePhases]
  )

  const edges: Edge[] = useMemo(
    () =>
      EDGE_DEFINITIONS.map(({ source, target, type }) => ({
        id: `e-${source}-${target}`,
        source,
        target,
        type,
        animated: false,
        style: { stroke: '#94a3b8', strokeWidth: 2 },
      })),
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
        <Controls showInteractive={false} className="!bottom-2 !left-2" />
      </ReactFlow>
    </div>
  )
}
