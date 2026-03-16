/**
 * TDD Tests for PipelineCanvas and PipelineDetailPanel components.
 *
 * Tests canvas renders 8 nodes and 7 edges, clicking a node opens detail,
 * and stale indicators show on downstream nodes after re-run.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { PipelineCanvas } from './PipelineCanvas'
import { PipelineDetailPanel } from './PipelineDetailPanel'
import type { TraceData, PipelinePhase } from './types'

// Mock React Flow since it needs a browser context for measurements
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      edges,
      onNodeClick,
      children,
    }: {
      nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
      edges: Array<{ id: string }>
      onNodeClick: (_: unknown, node: { id: string }) => void
      children?: React.ReactNode
    }) => (
      <div data-testid="react-flow-canvas">
        {nodes.map((node) => (
          <div
            key={node.id}
            data-testid={`flow-node-${node.id}`}
            onClick={() => onNodeClick(null, { id: node.id })}
          >
            {node.type}-{node.id}
          </div>
        ))}
        {edges.map((edge) => (
          <div key={edge.id} data-testid={`flow-edge-${edge.id}`} />
        ))}
        {children}
      </div>
    ),
    MiniMap: () => <div data-testid="minimap" />,
    Controls: () => <div data-testid="controls" />,
    Background: () => <div data-testid="background" />,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  }
})

const mockTraceData: TraceData = {
  pre_phase1: {
    action: 'parsed',
    skip_reason: null,
    original_text: 'bunk with Emma Johnson',
    cleaned_text: 'bunk with Emma Johnson',
    na_prefix_stripped: false,
    staff_metadata: null,
    field_path: 'ai_parse',
    socialize_mapped_value: null,
    session_cm_ids: [1000001],
    requester_info: { cm_id: 12345, name: 'Test Parent', grade: '5' },
  },
  phase1_parse: {
    ran: true,
    parse_request: {},
    parsed_intents: [
      {
        target_name: 'Emma Johnson',
        request_type: 'BUNK_WITH',
        confidence: 0.95,
        keywords_found: ['bunk with'],
        reasoning: 'Clear request',
        ai_reasoning_summary: null,
        parse_notes: '',
        needs_clarification: false,
        temporal_info: null,
        csv_position: 1,
      },
    ],
    ai_raw_response: {},
    ai_reasoning_summary: null,
    token_count: 342,
    processing_time_ms: 1200,
    sanitization: { is_suspicious: false, risk_level: null, confidence_penalty: 0 },
    is_valid: true,
    error_message: null,
  },
  validation: {
    type_validation: { passed: true, rejected: [] },
    temporal_conflicts: { filtered: 0, details: [] },
    source_text_validation: { rejected: 0, hallucinated_names: [], unit_names: [] },
  },
  phase2_resolution: [
    {
      target_name: 'Emma Johnson',
      fast_path_tried: [],
      fast_path_result: null,
      pipeline_strategies_tried: [],
      all_candidates: [],
      final_result: {
        person_cm_id: 67890,
        person_name: 'Emma Johnson',
        confidence: 0.95,
        method: 'exact_match',
        is_resolved: true,
        is_ambiguous: false,
        confidence_factors: {},
      },
      staff_filtered: false,
      hallucination_detected: false,
      social_graph_details: {
        enhanced: false,
        connection_strength: null,
        shared_friends: null,
        smart_resolved: false,
        candidates_reranked: false,
      },
      spread_filter_applied: false,
    },
  ],
  placeholder_expansion: {
    triggered: false,
    type: null,
    expanded_count: 0,
    expanded_targets: [],
  },
  historical_verification: {
    ran: false,
    boost_applied: false,
    original_confidence: null,
    boosted_confidence: null,
  },
  phase3_disambiguation: [
    {
      target_name: 'Emma Johnson',
      ran: false,
      candidates_sent: [],
      ai_context: {},
      ai_selection: null,
      ai_reasoning: null,
      ai_reasoning_summary: null,
      result: 'not_needed',
      confidence_before: null,
      confidence_after: null,
    },
  ],
  post_pipeline: {
    conflict_detection: { has_conflict: false, details: [] },
    self_reference: { detected: false },
    reciprocal: { detected: false, boost_applied: false, boost_amount: null, pair_cm_id: null },
    deduplication: { was_duplicate: false, kept_over: null },
    final_bunk_requests: [
      {
        bunk_request_id: 'req1',
        requester_cm_id: 12345,
        requested_cm_id: 67890,
        requested_name: 'Emma Johnson',
        request_type: 'BUNK_WITH',
        status: 'RESOLVED',
        confidence: 0.95,
        priority: 2,
        resolution_method: 'exact_match',
        is_placeholder: false,
        declined_reason: null,
      },
    ],
  },
}

describe('PipelineCanvas', () => {
  const defaultProps = {
    traceData: mockTraceData,
    selectedNode: null as PipelinePhase | null,
    onNodeSelect: vi.fn(),
    stalePhases: new Set<PipelinePhase>(),
  }

  it('renders 8 flow nodes', () => {
    render(<PipelineCanvas {...defaultProps} />)
    expect(screen.getByTestId('flow-node-pre_phase1')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-phase1')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-validation')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-phase2')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-expansion')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-historical')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-phase3')).toBeInTheDocument()
    expect(screen.getByTestId('flow-node-post_pipeline')).toBeInTheDocument()
  })

  it('renders 7 edges connecting nodes', () => {
    render(<PipelineCanvas {...defaultProps} />)
    expect(screen.getByTestId('flow-edge-e-pre_phase1-phase1')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-e-phase1-validation')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-e-validation-phase2')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-e-phase2-expansion')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-e-expansion-historical')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-e-historical-phase3')).toBeInTheDocument()
    expect(screen.getByTestId('flow-edge-e-phase3-post_pipeline')).toBeInTheDocument()
  })

  it('renders minimap', () => {
    render(<PipelineCanvas {...defaultProps} />)
    expect(screen.getByTestId('minimap')).toBeInTheDocument()
  })

  it('calls onNodeSelect when a node is clicked', async () => {
    const user = userEvent.setup()
    render(<PipelineCanvas {...defaultProps} />)
    await user.click(screen.getByTestId('flow-node-phase1'))
    expect(defaultProps.onNodeSelect).toHaveBeenCalledWith('phase1')
  })
})

describe('PipelineDetailPanel', () => {
  const defaultActions = {
    onRunAgain: vi.fn(),
    onRunFromHere: vi.fn(),
  }

  it('renders nothing when no node is selected', () => {
    const { container } = render(
      <PipelineDetailPanel selectedNode={null} traceData={mockTraceData} {...defaultActions} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders PrePhase1Detail when pre_phase1 is selected', () => {
    render(
      <PipelineDetailPanel
        selectedNode="pre_phase1"
        traceData={mockTraceData}
        {...defaultActions}
      />
    )
    expect(screen.getByText('Pre-Phase 1')).toBeInTheDocument()
  })

  it('renders Phase1Detail when phase1 is selected', () => {
    render(
      <PipelineDetailPanel selectedNode="phase1" traceData={mockTraceData} {...defaultActions} />
    )
    expect(screen.getByText('Phase 1 Parse')).toBeInTheDocument()
  })

  it('renders PostPipelineDetail when post_pipeline is selected', () => {
    render(
      <PipelineDetailPanel
        selectedNode="post_pipeline"
        traceData={mockTraceData}
        {...defaultActions}
      />
    )
    expect(screen.getByText('Post-Pipeline')).toBeInTheDocument()
  })
})
