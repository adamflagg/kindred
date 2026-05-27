/**
 * TDD Tests for pipeline detail panels.
 *
 * Tests each of the 8 detail panels renders key trace data, collapsible sections,
 * multi-intent tabs (P2, P3, Post), action buttons, and confirmation dialog.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { PrePhase1Detail } from './PrePhase1Detail'
import { Phase1Detail } from './Phase1Detail'
import { ValidationDetail } from './ValidationDetail'
import { Phase2Detail } from './Phase2Detail'
import { HistoricalDetail } from './HistoricalDetail'
import { Phase3Detail } from './Phase3Detail'
import { BatchSignalsDetail } from './BatchSignalsDetail'
import { ConflictDetail } from './ConflictDetail'
import { DispositionDetail } from './DispositionDetail'
import { DedupDetail } from './DedupDetail'
import type {
  PrePhase1Trace,
  Phase1Trace,
  ValidationTrace,
  Phase2IntentTrace,
  HistoricalVerificationTrace,
  Phase3IntentTrace,
  BatchSignalsTrace,
  ConflictDetectionTrace,
  DispositionTrace,
  DedupSaveTrace,
} from '../types'

// Common action callbacks
const defaultActions = {
  onRerunPhase: vi.fn(),
  onRunFromHere: vi.fn(),
  activeTab: 0,
  onTabChange: vi.fn(),
}

// ---- Mock trace data ----

const prePhase1: PrePhase1Trace = {
  action: 'parsed',
  skip_reason: null,
  original_text: 'bunk with Emma Johnson and Liam Garcia',
  cleaned_text: 'bunk with Emma Johnson and Liam Garcia',
  na_prefix_stripped: false,
  staff_metadata: { name: 'Camp Staff', timestamp: '2026-03-15' },
  field_path: 'ai_parse',
  socialize_mapped_value: null,
  session_cm_ids: [1000001, 1000002],
  requester_info: { cm_id: 12345, name: 'Test Parent', grade: '5' },
}

const phase1: Phase1Trace = {
  ran: true,
  parse_request: { prompt: 'test prompt' },
  parsed_intents: [
    {
      target_name: 'Emma Johnson',
      request_type: 'BUNK_WITH',
      confidence: 0.95,
      keywords_found: ['bunk with'],
      reasoning: 'Clear request for named camper',
      ai_reasoning_summary: 'Reasoning model chain-of-thought',
      parse_notes: 'Full name provided',
      needs_clarification: false,
      temporal_info: null,
      csv_position: 1,
    },
    {
      target_name: 'Liam Garcia',
      request_type: 'BUNK_WITH',
      confidence: 0.88,
      keywords_found: ['and'],
      reasoning: 'Second named camper in conjunction',
      ai_reasoning_summary: null,
      parse_notes: '',
      needs_clarification: false,
      temporal_info: null,
      csv_position: 2,
    },
  ],
  ai_raw_response: { model: 'gpt-5-nano', choices: [{ text: 'response' }] },
  ai_reasoning_summary: 'Overall reasoning for the parse',
  token_count: 342,
  processing_time_ms: 1200,
  sanitization: { is_suspicious: false, risk_level: null, confidence_penalty: 0 },
  is_valid: true,
  error_message: null,
}

const validation: ValidationTrace = {
  type_validation: { passed: true, rejected: [] },
  temporal_conflicts: { filtered: 1, details: ['Prior bunk request superseded'] },
  source_text_validation: { rejected: 0, hallucinated_names: [], unit_names: [] },
}

const phase2Intents: Phase2IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    fast_path_tried: ['prior_bunkmate', 'ai_id_validation'],
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
        score_breakdown: { session_match: 0.3, grade_proximity: 0.2 },
      },
    ],
    final_result: {
      person_cm_id: 67890,
      person_name: 'Emma Johnson',
      confidence: 0.95,
      method: 'exact_match',
      is_resolved: true,
      is_ambiguous: false,
      confidence_factors: { session_match: true },
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
  {
    target_name: 'Liam Garcia',
    fast_path_tried: [],
    fast_path_result: null,
    pipeline_strategies_tried: [
      { strategy: 'fuzzy_match', confidence: 0.8, resolved: true, candidates_found: 2 },
    ],
    all_candidates: [
      {
        person_cm_id: 67891,
        name: 'Liam Garcia',
        session_cm_id: 1000001,
        grade: 5,
        school: 'Oak Valley Middle',
        score_breakdown: { session_match: 0.3 },
      },
    ],
    final_result: {
      person_cm_id: 67891,
      person_name: 'Liam Garcia',
      confidence: 0.8,
      method: 'fuzzy_match',
      is_resolved: true,
      is_ambiguous: false,
      confidence_factors: {},
    },
    staff_filtered: false,
    hallucination_detected: false,
    social_graph_details: {
      enhanced: true,
      connection_strength: 0.7,
      shared_friends: 3,
      smart_resolved: false,
      candidates_reranked: true,
    },
    spread_filter_applied: false,
  },
]

const historical: HistoricalVerificationTrace = {
  ran: true,
  boost_applied: true,
  original_confidence: 0.7,
  boosted_confidence: 0.85,
}

const phase3Intents: Phase3IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    ran: true,
    candidates_sent: [
      { person_cm_id: 67890, name: 'Emma Johnson', grade: 5 },
      { person_cm_id: 67892, name: 'Emma Johns', grade: 6 },
    ],
    ai_context: { session: '1', requester_grade: '5' },
    ai_selection: 67890,
    ai_reasoning: 'Best match based on session and grade proximity',
    ai_reasoning_summary: 'Chain-of-thought reasoning from model',
    result: 'resolved',
    confidence_before: 0.5,
    confidence_after: 0.9,
  },
]

const phase3Reranked: Phase3IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    ran: true,
    candidates_sent: [
      { person_cm_id: 67890, name: 'Emma Johnson', grade: 5 },
      { person_cm_id: 67892, name: 'Emma Johns', grade: 6 },
    ],
    ai_context: { session: '1', requester_grade: '5' },
    ai_selection: 67890,
    ai_reasoning: 'Best match based on session and grade proximity',
    ai_reasoning_summary: 'Chain-of-thought reasoning from model',
    result: 'resolved',
    confidence_before: 0.5,
    confidence_after: 0.85,
    reranked: true,
    jw_score: 0.92,
    ai_confidence: 0.9,
    no_match_signal: false,
  },
]

const phase3NoMatch: Phase3IntentTrace[] = [
  {
    target_name: 'Olivia Chen',
    ran: true,
    candidates_sent: [{ person_cm_id: 67890, name: 'Olivia Chang', grade: 5 }],
    ai_context: { session: '1' },
    ai_selection: null,
    ai_reasoning: null,
    ai_reasoning_summary: null,
    result: 'no_match',
    confidence_before: 0.5,
    confidence_after: 0.0,
    reranked: false,
    jw_score: null,
    ai_confidence: null,
    no_match_signal: true,
  },
]

const phase3InvalidAI: Phase3IntentTrace[] = [
  {
    target_name: 'Emma Johnson',
    ran: true,
    candidates_sent: [{ person_cm_id: 67890, name: 'Emma Johnson', grade: 5 }],
    ai_context: { session: '1' },
    ai_selection: null,
    ai_reasoning: null,
    ai_reasoning_summary: null,
    result: 'invalid_ai_output',
    confidence_before: 0.5,
    confidence_after: 0.2,
  },
]

const batchSignals: BatchSignalsTrace = {
  reciprocal: { detected: true, boost_applied: true, boost_amount: 0.1, pair_cm_id: 67890 },
}

const conflictDetection: ConflictDetectionTrace = {
  has_conflict: false,
  details: [],
}

const dedupSave: DedupSaveTrace = {
  was_duplicate: false,
  kept_over: null,
  self_reference: { detected: false },
}

const disposition: DispositionTrace = {
  final_bunk_requests: [
    {
      bunk_request_id: 'req1',
      requester_cm_id: 12345,
      requested_cm_id: 67890,
      requested_name: 'Emma Johnson',
      request_type: 'BUNK_WITH',
      status: 'RESOLVED',
      confidence: 0.95,
      resolution_method: 'exact_match',
      declined_reason: null,
      disposition_reason: 'exact_match',
      is_reciprocal: true,
    },
    {
      bunk_request_id: 'req2',
      requester_cm_id: 12345,
      requested_cm_id: 67891,
      requested_name: 'Liam Garcia',
      request_type: 'BUNK_WITH',
      status: 'RESOLVED',
      confidence: 0.8,
      resolution_method: 'fuzzy_match',
      declined_reason: null,
      disposition_reason: 'high_confidence_match',
      is_reciprocal: false,
    },
  ],
}

// =============================================================================
// PrePhase1Detail
// =============================================================================
describe('PrePhase1Detail', () => {
  it('renders original and cleaned text', () => {
    render(<PrePhase1Detail data={prePhase1} {...defaultActions} />)
    expect(screen.getByText(/bunk with Emma Johnson and Liam Garcia/)).toBeInTheDocument()
  })

  it('renders action and field path', () => {
    render(<PrePhase1Detail data={prePhase1} {...defaultActions} />)
    expect(screen.getByText('parsed')).toBeInTheDocument()
    expect(screen.getByText('ai_parse')).toBeInTheDocument()
  })

  it('renders requester info', () => {
    render(<PrePhase1Detail data={prePhase1} {...defaultActions} />)
    expect(screen.getByText(/Test Parent/)).toBeInTheDocument()
    expect(screen.getByText(/12345/)).toBeInTheDocument()
  })

  it('renders session IDs', () => {
    render(<PrePhase1Detail data={prePhase1} {...defaultActions} />)
    expect(screen.getByText(/1000001/)).toBeInTheDocument()
  })

  it('renders action buttons', () => {
    render(<PrePhase1Detail data={prePhase1} {...defaultActions} />)
    expect(screen.getByRole('button', { name: /rerun this phase/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run from here/i })).toBeInTheDocument()
  })
})

// =============================================================================
// Phase1Detail
// =============================================================================
describe('Phase1Detail', () => {
  it('renders parsed intents', () => {
    render(<Phase1Detail data={phase1} {...defaultActions} />)
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('renders confidence values', () => {
    render(<Phase1Detail data={phase1} {...defaultActions} />)
    expect(screen.getByText(/0\.95/)).toBeInTheDocument()
    expect(screen.getByText(/0\.88/)).toBeInTheDocument()
  })

  it('renders token count and processing time', () => {
    render(<Phase1Detail data={phase1} {...defaultActions} />)
    expect(screen.getByText(/342/)).toBeInTheDocument()
    expect(screen.getByText(/1200/)).toBeInTheDocument()
  })

  it('renders raw AI response in collapsible section', async () => {
    const user = userEvent.setup()
    render(<Phase1Detail data={phase1} {...defaultActions} />)
    const toggle = screen.getByText(/raw ai response/i)
    expect(toggle).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByText(/gpt-5-nano/)).toBeInTheDocument()
  })
})

// =============================================================================
// ValidationDetail
// =============================================================================
describe('ValidationDetail', () => {
  it('renders type validation status', () => {
    render(<ValidationDetail data={validation} {...defaultActions} />)
    expect(screen.getByText(/passed/i)).toBeInTheDocument()
  })

  it('renders temporal conflict info', () => {
    render(<ValidationDetail data={validation} {...defaultActions} />)
    expect(screen.getByText(/1 filtered/i)).toBeInTheDocument()
  })

  it('renders object rejected items without [object Object]', () => {
    const withObjectRejections: ValidationTrace = {
      type_validation: {
        passed: false,
        rejected: [
          { field: 'target_name', reason: 'Invalid type for field' },
          'Simple string rejection',
        ],
      },
      temporal_conflicts: {
        filtered: 1,
        details: [{ type: 'superseded', original: 'old request', replacement: 'new request' }],
      },
      source_text_validation: { rejected: 0, hallucinated_names: [], unit_names: [] },
    }
    render(<ValidationDetail data={withObjectRejections} {...defaultActions} />)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('Simple string rejection')).toBeInTheDocument()
    expect(screen.getByText(/Invalid type for field/)).toBeInTheDocument()
  })
})

// =============================================================================
// Phase2Detail
// =============================================================================
describe('Phase2Detail', () => {
  it('renders tabs for multi-intent resolution', () => {
    render(<Phase2Detail data={phase2Intents} {...defaultActions} />)
    // Both names should appear as tab buttons
    expect(screen.getByRole('tab', { name: /Emma Johnson/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Liam Garcia/i })).toBeInTheDocument()
  })

  it('renders resolution method for first intent', () => {
    render(<Phase2Detail data={phase2Intents} {...defaultActions} />)
    // exact_match appears in method data row
    expect(screen.getAllByText(/exact_match/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows fast paths tried', () => {
    render(<Phase2Detail data={phase2Intents} {...defaultActions} />)
    expect(screen.getByText(/prior_bunkmate/)).toBeInTheDocument()
  })

  it('switches tabs to show second intent', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    const { rerender } = render(
      <Phase2Detail data={phase2Intents} {...defaultActions} onTabChange={onTabChange} />
    )
    const liamTab = screen.getByRole('tab', { name: /Liam Garcia/i })
    await user.click(liamTab)
    expect(onTabChange).toHaveBeenCalledWith(1)

    // Re-render with activeTab=1 to simulate controlled state update
    rerender(
      <Phase2Detail
        data={phase2Intents}
        {...defaultActions}
        activeTab={1}
        onTabChange={onTabChange}
      />
    )
    expect(screen.getAllByText(/fuzzy_match/).length).toBeGreaterThanOrEqual(1)
  })
})

// =============================================================================
// HistoricalDetail
// =============================================================================
describe('HistoricalDetail', () => {
  it('renders boost information', () => {
    render(<HistoricalDetail data={historical} {...defaultActions} />)
    expect(screen.getByText(/0\.7/)).toBeInTheDocument()
    expect(screen.getByText(/0\.85/)).toBeInTheDocument()
  })

  it('renders boost applied badge', () => {
    render(<HistoricalDetail data={historical} {...defaultActions} />)
    // "Boost Applied" appears as a badge
    expect(screen.getAllByText(/boost applied/i).length).toBeGreaterThanOrEqual(1)
  })
})

// =============================================================================
// Phase3Detail
// =============================================================================
describe('Phase3Detail', () => {
  it('renders disambiguation result', () => {
    render(<Phase3Detail data={phase3Intents} {...defaultActions} />)
    expect(screen.getByText(/resolved/i)).toBeInTheDocument()
  })

  it('renders AI reasoning', () => {
    render(<Phase3Detail data={phase3Intents} {...defaultActions} />)
    expect(screen.getByText(/Best match based on session/)).toBeInTheDocument()
  })

  it('renders confidence before/after', () => {
    render(<Phase3Detail data={phase3Intents} {...defaultActions} />)
    expect(screen.getByText(/0\.5/)).toBeInTheDocument()
    expect(screen.getByText(/0\.9/)).toBeInTheDocument()
  })

  it('renders invalid_ai_output badge with amber color', () => {
    render(<Phase3Detail data={phase3InvalidAI} {...defaultActions} />)
    const badge = screen.getByText('invalid_ai_output')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toMatch(/amber/)
  })

  it('renders reranked badge when reranked is true', () => {
    render(<Phase3Detail data={phase3Reranked} {...defaultActions} />)
    expect(screen.getByText('Reranked')).toBeInTheDocument()
  })

  it('renders JW score when reranked', () => {
    render(<Phase3Detail data={phase3Reranked} {...defaultActions} />)
    expect(screen.getByText('JW Score')).toBeInTheDocument()
    expect(screen.getByText('0.92')).toBeInTheDocument()
  })

  it('renders AI raw confidence when available', () => {
    render(<Phase3Detail data={phase3Reranked} {...defaultActions} />)
    expect(screen.getByText('AI Confidence')).toBeInTheDocument()
    expect(screen.getByText('0.9')).toBeInTheDocument()
  })

  it('renders no_match signal badge', () => {
    render(<Phase3Detail data={phase3NoMatch} {...defaultActions} />)
    expect(screen.getByText('No Match')).toBeInTheDocument()
  })

  it('does not render reranker section when reranked is undefined (old traces)', () => {
    render(<Phase3Detail data={phase3Intents} {...defaultActions} />)
    expect(screen.queryByText('Reranked')).not.toBeInTheDocument()
    expect(screen.queryByText('JW Score')).not.toBeInTheDocument()
  })

  it('renders structured candidate cards with name, cm_id, and grade', () => {
    render(<Phase3Detail data={phase3Reranked} {...defaultActions} />)
    // CollapsibleSection button includes the count in the title
    const toggle = screen.getByRole('button', { name: /Candidates Sent/i })
    fireEvent.click(toggle)
    // Name appears multiple times (Target row + candidate card) — getAllByText is intentional
    expect(screen.getAllByText('Emma Johnson').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('#67890')).toBeInTheDocument()
    expect(screen.getByText('Grade: 5')).toBeInTheDocument()
    expect(screen.getByText('Grade: 6')).toBeInTheDocument()
  })

  it('renders per-candidate ai_confidence when available', () => {
    const withScores: Phase3IntentTrace[] = [
      {
        target_name: 'Emma Johnson',
        ran: true,
        candidates_sent: [
          { person_cm_id: 67890, name: 'Emma Johnson', grade: 5, ai_confidence: 0.9 },
          { person_cm_id: 67892, name: 'Emma Johns', grade: 6, ai_confidence: 0.65 },
        ] as Array<Record<string, unknown>>,
        ai_context: { session: '1', requester_grade: '5' },
        ai_selection: 67890,
        ai_reasoning: 'Best match based on session and grade proximity',
        ai_reasoning_summary: 'Chain-of-thought reasoning from model',
        result: 'resolved',
        confidence_before: 0.5,
        confidence_after: 0.85,
        reranked: true,
        jw_score: 0.92,
        ai_confidence: 0.9,
        no_match_signal: false,
      },
    ]
    render(<Phase3Detail data={withScores} {...defaultActions} />)
    const toggle = screen.getByRole('button', { name: /Candidates Sent/i })
    fireEvent.click(toggle)
    expect(screen.getByText('AI: 0.90')).toBeInTheDocument()
    expect(screen.getByText('AI: 0.65')).toBeInTheDocument()
  })

  it('renders candidate cards without scores for legacy traces', () => {
    render(<Phase3Detail data={phase3Intents} {...defaultActions} />)
    const toggle = screen.getByRole('button', { name: /Candidates Sent/i })
    fireEvent.click(toggle)
    // Name appears multiple times (Target row + candidate card) — getAllByText is intentional
    expect(screen.getAllByText('Emma Johnson').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('#67890')).toBeInTheDocument()
  })
})

// =============================================================================
// Finalization Panels (flattened top-level trace fields — issue #877)
// =============================================================================
describe('BatchSignalsDetail', () => {
  it('renders reciprocal detection info', () => {
    render(<BatchSignalsDetail data={batchSignals} disposition={disposition} {...defaultActions} />)
    expect(screen.getAllByText(/reciprocal/i).length).toBeGreaterThanOrEqual(1)
  })

  it('renders action buttons', () => {
    render(<BatchSignalsDetail data={batchSignals} disposition={disposition} {...defaultActions} />)
    expect(screen.getByRole('button', { name: /rerun this phase/i })).toBeInTheDocument()
  })
})

describe('ConflictDetail', () => {
  it('renders clean state when no conflicts', () => {
    render(<ConflictDetail data={conflictDetection} {...defaultActions} />)
    expect(screen.getByText(/no enrollment/i)).toBeInTheDocument()
  })

  it('renders object details without [object Object]', () => {
    const withConflicts: ConflictDetectionTrace = {
      has_conflict: true,
      details: [
        { type: 'enrollment', message: 'Not enrolled in session' },
        'Simple string conflict',
      ],
    }
    render(<ConflictDetail data={withConflicts} {...defaultActions} />)
    // Object should be serialized readably, not as [object Object]
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    // The string detail should render directly
    expect(screen.getByText('Simple string conflict')).toBeInTheDocument()
    // The object detail should show its contents
    expect(screen.getByText(/Not enrolled in session/)).toBeInTheDocument()
  })

  it('renders null and undefined details gracefully', () => {
    const withNullDetails: ConflictDetectionTrace = {
      has_conflict: true,
      details: [null, undefined, ''],
    }
    render(<ConflictDetail data={withNullDetails} {...defaultActions} />)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('renders array details without [object Object]', () => {
    const withArrayDetails: ConflictDetectionTrace = {
      has_conflict: true,
      details: [['nested', 'array', 'values']],
    }
    render(<ConflictDetail data={withArrayDetails} {...defaultActions} />)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText(/nested/)).toBeInTheDocument()
  })
})

describe('DispositionDetail', () => {
  it('renders final bunk requests table', () => {
    render(<DispositionDetail data={disposition} {...defaultActions} />)
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })
})

describe('DedupDetail', () => {
  it('renders dedup and self-reference checks', () => {
    render(<DedupDetail data={dedupSave} disposition={disposition} {...defaultActions} />)
    expect(screen.getByText('Unique')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('reads self_reference from dedup_save (issue #877 UI alignment)', () => {
    const withSelfRef: DedupSaveTrace = {
      was_duplicate: false,
      kept_over: null,
      self_reference: { detected: true },
    }
    render(<DedupDetail data={withSelfRef} disposition={disposition} {...defaultActions} />)
    // When self_reference.detected is true the panel should not show the "None" badge
    // for self-reference (it shows "Detected" instead). Verify by looking for "Detected".
    expect(screen.getByText(/detected/i)).toBeInTheDocument()
  })
})
