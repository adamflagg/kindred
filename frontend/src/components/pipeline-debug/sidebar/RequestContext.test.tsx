/**
 * Tests for RequestContext sidebar component.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RequestContext } from './RequestContext'
import type { TraceData } from '../types'

const minimalTraceData: TraceData = {
  pre_phase1: {
    original_text: 'I want to bunk with Emma Johnson',
    cleaned_text: 'I want to bunk with Emma Johnson',
    field_path: 'bunk_with',
    action: 'parsed',
    na_prefix_stripped: false,
    skip_reason: null,
    socialize_mapped_value: null,
    requester_info: { name: 'Liam Garcia', cm_id: 12345, grade: '5' },
    session_cm_ids: [1000001],
    staff_metadata: null,
  },
  phase1_parse: {
    ran: true,
    is_valid: true,
    parsed_intents: [
      {
        target_name: 'Emma Johnson',
        request_type: 'BUNK_WITH',
        confidence: 0.9,
        keywords_found: [],
        needs_clarification: false,
        reasoning: '',
        ai_reasoning_summary: null,
        parse_notes: '',
        temporal_info: null,
        csv_position: 0,
      },
    ],
    ai_raw_response: {},
    parse_request: {},
    error_message: null,
    ai_reasoning_summary: null,
    token_count: null,
    processing_time_ms: null,
    sanitization: {
      is_suspicious: false,
      risk_level: null,
      confidence_penalty: 0,
    },
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
      final_result: {
        person_name: 'Emma Johnson',
        person_cm_id: 54321,
        confidence: 0.95,
        method: 'exact_match',
        is_resolved: true,
        is_ambiguous: false,
        confidence_factors: {},
      },
      all_candidates: [],
      social_graph_details: {
        enhanced: false,
        connection_strength: null,
        shared_friends: null,
        smart_resolved: false,
        candidates_reranked: false,
      },
      staff_filtered: false,
      hallucination_detected: false,
      spread_filter_applied: false,
    },
  ],
  historical_verification: {
    ran: false,
    boost_applied: false,
    original_confidence: null,
    boosted_confidence: null,
  },
  phase3_disambiguation: [],
  batch_signals: {
    reciprocal: {
      detected: false,
      pair_cm_id: null,
      boost_applied: false,
      boost_amount: null,
    },
  },
  conflict_detection: { has_conflict: false, details: [] },
  disposition: {
    final_bunk_requests: [
      {
        bunk_request_id: null,
        requester_cm_id: 12345,
        requested_cm_id: 54321,
        requested_name: 'Emma Johnson',
        request_type: 'BUNK_WITH',
        status: 'RESOLVED',
        confidence: 0.95,
        resolution_method: 'exact_match',
        declined_reason: '',
        disposition_reason: '',
        is_reciprocal: false,
      },
    ],
  },
  dedup_save: {
    was_duplicate: false,
    kept_over: null,
    self_reference: { detected: false },
  },
}

describe('RequestContext', () => {
  it('renders requester name and CM ID', () => {
    render(<RequestContext traceData={minimalTraceData} activeIntentIndex={0} />)
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.getByText(/CM 12345/)).toBeInTheDocument()
  })

  it('renders "View all traces" button with camper CM ID', () => {
    const onViewAllTraces = vi.fn()
    render(
      <RequestContext
        traceData={minimalTraceData}
        activeIntentIndex={0}
        onViewAllTraces={onViewAllTraces}
      />
    )
    const btn = screen.getByRole('button', { name: /all traces/i })
    expect(btn).toBeInTheDocument()
  })

  it('calls onViewAllTraces with requester cm_id when button clicked', async () => {
    const user = userEvent.setup()
    const onViewAllTraces = vi.fn()
    render(
      <RequestContext
        traceData={minimalTraceData}
        activeIntentIndex={0}
        onViewAllTraces={onViewAllTraces}
      />
    )
    await user.click(screen.getByRole('button', { name: /all traces/i }))
    expect(onViewAllTraces).toHaveBeenCalledWith(12345)
  })

  it('renders "Reprocess" button when onReprocess callback is provided', () => {
    const onReprocess = vi.fn()
    render(
      <RequestContext
        traceData={minimalTraceData}
        activeIntentIndex={0}
        onReprocess={onReprocess}
      />
    )
    expect(screen.getByRole('button', { name: /reprocess/i })).toBeInTheDocument()
  })

  it('shows confirmation dialog when Reprocess is clicked', async () => {
    const user = userEvent.setup()
    const onReprocess = vi.fn()
    render(
      <RequestContext
        traceData={minimalTraceData}
        activeIntentIndex={0}
        onReprocess={onReprocess}
      />
    )
    await user.click(screen.getByRole('button', { name: /reprocess/i }))
    // Should show confirmation dialog with the camper's name in context
    expect(screen.getByText(/regenerate all parsed requests/i)).toBeInTheDocument()
    // The name appears both in sidebar and dialog; just verify the dialog text exists
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('calls onReprocess when confirmation is accepted', async () => {
    const user = userEvent.setup()
    const onReprocess = vi.fn()
    render(
      <RequestContext
        traceData={minimalTraceData}
        activeIntentIndex={0}
        onReprocess={onReprocess}
      />
    )
    await user.click(screen.getByRole('button', { name: /reprocess/i }))
    // Click the confirm button in the dialog
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onReprocess).toHaveBeenCalled()
  })

  it('does not call onReprocess when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const onReprocess = vi.fn()
    render(
      <RequestContext
        traceData={minimalTraceData}
        activeIntentIndex={0}
        onReprocess={onReprocess}
      />
    )
    await user.click(screen.getByRole('button', { name: /reprocess/i }))
    // Click the cancel button in the dialog
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onReprocess).not.toHaveBeenCalled()
    // Dialog should be dismissed
    expect(screen.queryByText(/regenerate all parsed requests/i)).not.toBeInTheDocument()
  })
})
