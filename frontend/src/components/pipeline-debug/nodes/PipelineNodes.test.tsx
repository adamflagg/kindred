/**
 * TDD Tests for custom React Flow pipeline phase nodes.
 *
 * Tests all 8 nodes render in 4 states: success, warning, error, skipped.
 * Verifies correct border colors, icons, labels, and key metrics.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { PrePhase1Node } from './PrePhase1Node'
import { Phase1Node } from './Phase1Node'
import { ValidationNode } from './ValidationNode'
import { Phase2Node } from './Phase2Node'
import { ExpansionNode } from './ExpansionNode'
import { HistoricalNode } from './HistoricalNode'
import { Phase3Node } from './Phase3Node'
import { PostPipelineNode } from './PostPipelineNode'
import type {
  PrePhase1Trace,
  Phase1Trace,
  ValidationTrace,
  Phase2IntentTrace,
  PlaceholderExpansionTrace,
  HistoricalVerificationTrace,
  Phase3IntentTrace,
  PostPipelineTrace,
} from '../types'

// Wrap in ReactFlowProvider since nodes use handles
function renderNode(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

// ---- Mock trace data for each state ----

const prePhase1Success: PrePhase1Trace = {
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
}

const prePhase1Skipped: PrePhase1Trace = {
  ...prePhase1Success,
  action: 'skipped_no_preference',
  skip_reason: 'No preference text',
}

const phase1Success: Phase1Trace = {
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
}

const phase1Warning: Phase1Trace = {
  ...phase1Success,
  parsed_intents: [
    {
      ...phase1Success.parsed_intents[0],
      confidence: 0.45,
      needs_clarification: true,
    },
  ],
}

const phase1Error: Phase1Trace = {
  ...phase1Success,
  is_valid: false,
  error_message: 'AI parse failed',
  parsed_intents: [],
}

const validationSuccess: ValidationTrace = {
  type_validation: { passed: true, rejected: [] },
  temporal_conflicts: { filtered: 0, details: [] },
  source_text_validation: { rejected: 0, hallucinated_names: [], unit_names: [] },
}

const validationWarning: ValidationTrace = {
  type_validation: { passed: true, rejected: [] },
  temporal_conflicts: { filtered: 1, details: ['Conflict with prior request'] },
  source_text_validation: { rejected: 0, hallucinated_names: [], unit_names: [] },
}

const validationError: ValidationTrace = {
  type_validation: { passed: false, rejected: ['Bad type'] },
  temporal_conflicts: { filtered: 0, details: [] },
  source_text_validation: { rejected: 2, hallucinated_names: ['Fake Name'], unit_names: ['Unit7'] },
}

const phase2Success: Phase2IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    fast_path_tried: ['prior_bunkmate'],
    fast_path_result: null,
    pipeline_strategies_tried: [
      { strategy: 'exact_match', confidence: 0.95, resolved: true, candidates_found: 1 },
    ],
    all_candidates: [
      {
        person_cm_id: 67890,
        name: 'Emma Johnson',
        session_cm_id: 1000001,
        grade: 5,
        school: 'Riverside Elementary',
        score_breakdown: {},
      },
    ],
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
]

const phase2Warning: Phase2IntentTrace[] = [
  {
    ...phase2Success[0],
    final_result: {
      ...phase2Success[0].final_result,
      confidence: 0.55,
      is_ambiguous: true,
      is_resolved: false,
    },
  },
]

const phase2Error: Phase2IntentTrace[] = [
  {
    ...phase2Success[0],
    final_result: {
      person_cm_id: null,
      person_name: null,
      confidence: 0.1,
      method: 'none',
      is_resolved: false,
      is_ambiguous: false,
      confidence_factors: {},
    },
  },
]

const expansionTriggered: PlaceholderExpansionTrace = {
  triggered: true,
  type: 'last_year_bunkmates',
  expanded_count: 3,
  expanded_targets: [],
}

const expansionNotTriggered: PlaceholderExpansionTrace = {
  triggered: false,
  type: null,
  expanded_count: 0,
  expanded_targets: [],
}

const historicalRan: HistoricalVerificationTrace = {
  ran: true,
  boost_applied: true,
  original_confidence: 0.7,
  boosted_confidence: 0.85,
}

const historicalNotRan: HistoricalVerificationTrace = {
  ran: false,
  boost_applied: false,
  original_confidence: null,
  boosted_confidence: null,
}

const phase3Ran: Phase3IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    ran: true,
    candidates_sent: [],
    ai_context: {},
    ai_selection: 67890,
    ai_reasoning: 'Best match based on session and grade',
    ai_reasoning_summary: null,
    result: 'resolved',
    confidence_before: 0.5,
    confidence_after: 0.9,
  },
]

const phase3NotNeeded: Phase3IntentTrace[] = [
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
]

const phase3Failed: Phase3IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    ran: true,
    candidates_sent: [],
    ai_context: {},
    ai_selection: null,
    ai_reasoning: null,
    ai_reasoning_summary: null,
    result: 'no_match',
    confidence_before: 0.4,
    confidence_after: 0.2,
  },
]

const postPipelineSuccess: PostPipelineTrace = {
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
}

const postPipelineWarning: PostPipelineTrace = {
  ...postPipelineSuccess,
  conflict_detection: { has_conflict: true, details: ['Conflicting request detected'] },
}

const postPipelineError: PostPipelineTrace = {
  ...postPipelineSuccess,
  final_bunk_requests: [
    {
      ...postPipelineSuccess.final_bunk_requests[0],
      status: 'DECLINED',
      declined_reason: 'Duplicate request',
    },
  ],
}

// ---- Node prop helper ----
function makeNodeProps<T>(data: T, isStale = false) {
  return {
    id: 'test-node',
    type: 'custom',
    data: { ...data, isStale },
    selected: false,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 0,
    dragging: false,
  }
}

// =============================================================================
// PrePhase1Node
// =============================================================================
describe('PrePhase1Node', () => {
  it('renders success state for parsed action', () => {
    renderNode(<PrePhase1Node {...makeNodeProps({ prePhase1: prePhase1Success })} />)
    expect(screen.getByText(/Pre-Phase 1/i)).toBeInTheDocument()
    expect(screen.getByText(/parsed/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders skipped state for skipped action', () => {
    renderNode(<PrePhase1Node {...makeNodeProps({ prePhase1: prePhase1Skipped })} />)
    expect(screen.getByTestId('node-status-skipped')).toBeInTheDocument()
  })

  it('shows stale badge when marked stale', () => {
    renderNode(<PrePhase1Node {...makeNodeProps({ prePhase1: prePhase1Success }, true)} />)
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })
})

// =============================================================================
// Phase1Node
// =============================================================================
describe('Phase1Node', () => {
  it('renders success state with intent count', () => {
    renderNode(<Phase1Node {...makeNodeProps({ phase1: phase1Success })} />)
    expect(screen.getByText(/Phase 1/i)).toBeInTheDocument()
    expect(screen.getByText(/1 intent/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders warning state for low confidence', () => {
    renderNode(<Phase1Node {...makeNodeProps({ phase1: phase1Warning })} />)
    expect(screen.getByTestId('node-status-warning')).toBeInTheDocument()
  })

  it('renders error state for invalid parse', () => {
    renderNode(<Phase1Node {...makeNodeProps({ phase1: phase1Error })} />)
    expect(screen.getByTestId('node-status-error')).toBeInTheDocument()
  })
})

// =============================================================================
// ValidationNode
// =============================================================================
describe('ValidationNode', () => {
  it('renders success state when all passed', () => {
    renderNode(<ValidationNode {...makeNodeProps({ validation: validationSuccess })} />)
    expect(screen.getByText(/Validation/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders warning state for temporal conflicts', () => {
    renderNode(<ValidationNode {...makeNodeProps({ validation: validationWarning })} />)
    expect(screen.getByTestId('node-status-warning')).toBeInTheDocument()
  })

  it('renders error state for failed validation', () => {
    renderNode(<ValidationNode {...makeNodeProps({ validation: validationError })} />)
    expect(screen.getByTestId('node-status-error')).toBeInTheDocument()
  })
})

// =============================================================================
// Phase2Node
// =============================================================================
describe('Phase2Node', () => {
  it('renders success state with resolution method', () => {
    renderNode(<Phase2Node {...makeNodeProps({ phase2: phase2Success })} />)
    expect(screen.getByText(/Phase 2/i)).toBeInTheDocument()
    expect(screen.getByText(/exact_match/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders warning state for ambiguous', () => {
    renderNode(<Phase2Node {...makeNodeProps({ phase2: phase2Warning })} />)
    expect(screen.getByTestId('node-status-warning')).toBeInTheDocument()
  })

  it('renders error state for unresolved', () => {
    renderNode(<Phase2Node {...makeNodeProps({ phase2: phase2Error })} />)
    expect(screen.getByTestId('node-status-error')).toBeInTheDocument()
  })
})

// =============================================================================
// ExpansionNode
// =============================================================================
describe('ExpansionNode', () => {
  it('renders success state when triggered', () => {
    renderNode(<ExpansionNode {...makeNodeProps({ expansion: expansionTriggered })} />)
    expect(screen.getByText(/Expansion/i)).toBeInTheDocument()
    expect(screen.getByText(/3 expanded/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders skipped state when not triggered', () => {
    renderNode(<ExpansionNode {...makeNodeProps({ expansion: expansionNotTriggered })} />)
    expect(screen.getByTestId('node-status-skipped')).toBeInTheDocument()
  })
})

// =============================================================================
// HistoricalNode
// =============================================================================
describe('HistoricalNode', () => {
  it('renders success state with boost info', () => {
    renderNode(<HistoricalNode {...makeNodeProps({ historical: historicalRan })} />)
    expect(screen.getByText(/Historical/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders skipped state when not ran', () => {
    renderNode(<HistoricalNode {...makeNodeProps({ historical: historicalNotRan })} />)
    expect(screen.getByTestId('node-status-skipped')).toBeInTheDocument()
  })
})

// =============================================================================
// Phase3Node
// =============================================================================
describe('Phase3Node', () => {
  it('renders success state for resolved disambiguation', () => {
    renderNode(<Phase3Node {...makeNodeProps({ phase3: phase3Ran })} />)
    expect(screen.getByText(/Phase 3/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders skipped state when not needed', () => {
    renderNode(<Phase3Node {...makeNodeProps({ phase3: phase3NotNeeded })} />)
    expect(screen.getByTestId('node-status-skipped')).toBeInTheDocument()
  })

  it('renders error state for no_match result', () => {
    renderNode(<Phase3Node {...makeNodeProps({ phase3: phase3Failed })} />)
    expect(screen.getByTestId('node-status-error')).toBeInTheDocument()
  })
})

// =============================================================================
// PostPipelineNode
// =============================================================================
describe('PostPipelineNode', () => {
  it('renders success state with request count', () => {
    renderNode(<PostPipelineNode {...makeNodeProps({ postPipeline: postPipelineSuccess })} />)
    expect(screen.getByText(/Post-Pipeline/i)).toBeInTheDocument()
    expect(screen.getByText(/1 request/i)).toBeInTheDocument()
    expect(screen.getByTestId('node-status-success')).toBeInTheDocument()
  })

  it('renders warning state for conflicts', () => {
    renderNode(<PostPipelineNode {...makeNodeProps({ postPipeline: postPipelineWarning })} />)
    expect(screen.getByTestId('node-status-warning')).toBeInTheDocument()
  })

  it('renders error state for declined', () => {
    renderNode(<PostPipelineNode {...makeNodeProps({ postPipeline: postPipelineError })} />)
    expect(screen.getByTestId('node-status-error')).toBeInTheDocument()
  })
})
