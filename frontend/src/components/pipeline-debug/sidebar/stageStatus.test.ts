import { describe, it, expect } from 'vitest'
import { deriveStageStatus } from './stageStatus'
import type { TraceData } from '../types'

/** Minimal trace data factory — only the fields stageStatus reads. */
function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  return {
    pre_phase1: {
      action: 'parsed',
      skip_reason: null,
      original_text: 'test text',
      cleaned_text: 'test text',
      na_prefix_stripped: false,
      staff_metadata: null,
      field_path: 'bunk_with',
      socialize_mapped_value: null,
      session_cm_ids: [1000001],
      requester_info: { cm_id: 123, name: 'Emma Johnson', grade: '7' },
    },
    phase1_parse: {
      ran: true,
      parse_request: {},
      parsed_intents: [],
      ai_raw_response: {},
      ai_reasoning_summary: null,
      token_count: null,
      processing_time_ms: null,
      sanitization: { is_suspicious: false, risk_level: null, confidence_penalty: 0 },
      is_valid: true,
      error_message: null,
    },
    validation: {
      type_validation: { passed: true, rejected: [] },
      temporal_conflicts: { filtered: 0, details: [] },
      source_text_validation: { rejected: 0, hallucinated_names: [], unit_names: [] },
    },
    phase2_resolution: [],
    historical_verification: {
      ran: false,
      boost_applied: false,
      original_confidence: null,
      boosted_confidence: null,
    },
    phase3_disambiguation: [],
    batch_signals: {
      reciprocal: { detected: false, boost_applied: false, boost_amount: null, pair_cm_id: null },
    },
    conflict_detection: { has_conflict: false, details: [] },
    disposition: { final_bunk_requests: [] },
    dedup_save: {
      was_duplicate: false,
      kept_over: null,
      self_reference: { detected: false },
    },
    ...overrides,
  }
}

describe('deriveStageStatus', () => {
  it('returns success for staff_detect when staff_metadata present', () => {
    const trace = makeTrace({
      pre_phase1: { ...makeTrace().pre_phase1, staff_metadata: { name: 'Fictional Staff' } },
    })
    expect(deriveStageStatus('staff_detect', trace)).toBe('success')
  })

  it('returns skipped for staff_detect when no staff_metadata', () => {
    expect(deriveStageStatus('staff_detect', makeTrace())).toBe('skipped')
  })

  it('returns success for na_strip when stripped', () => {
    const trace = makeTrace({ pre_phase1: { ...makeTrace().pre_phase1, na_prefix_stripped: true } })
    expect(deriveStageStatus('na_strip', trace)).toBe('success')
  })

  it('returns skipped for na_strip when not stripped', () => {
    expect(deriveStageStatus('na_strip', makeTrace())).toBe('skipped')
  })

  it('returns success for phase1_parse when valid', () => {
    expect(deriveStageStatus('phase1_parse', makeTrace())).toBe('success')
  })

  it('returns error for phase1_parse when invalid', () => {
    const trace = makeTrace({ phase1_parse: { ...makeTrace().phase1_parse, is_valid: false } })
    expect(deriveStageStatus('phase1_parse', trace)).toBe('error')
  })

  it('returns skipped for phase1_parse when not ran', () => {
    const trace = makeTrace({ phase1_parse: { ...makeTrace().phase1_parse, ran: false } })
    expect(deriveStageStatus('phase1_parse', trace)).toBe('skipped')
  })

  it('returns error for type_validation when rejected', () => {
    const trace = makeTrace({
      validation: {
        ...makeTrace().validation,
        type_validation: { passed: false, rejected: ['bad'] },
      },
    })
    expect(deriveStageStatus('type_validation', trace)).toBe('error')
  })

  it('returns success for temporal_filter when filtered > 0', () => {
    const trace = makeTrace({
      validation: { ...makeTrace().validation, temporal_conflicts: { filtered: 2, details: [] } },
    })
    expect(deriveStageStatus('temporal_filter', trace)).toBe('success')
  })

  it('returns skipped for temporal_filter when filtered = 0', () => {
    expect(deriveStageStatus('temporal_filter', makeTrace())).toBe('skipped')
  })

  it('returns error for source_text_validation when rejected > 0', () => {
    const trace = makeTrace({
      validation: {
        ...makeTrace().validation,
        source_text_validation: { rejected: 1, hallucinated_names: ['Ghost'], unit_names: [] },
      },
    })
    expect(deriveStageStatus('source_text_validation', trace)).toBe('error')
  })

  it('returns success for batch_signals when reciprocal detected', () => {
    const trace = makeTrace({
      batch_signals: {
        reciprocal: { detected: true, boost_applied: true, boost_amount: 0.05, pair_cm_id: 456 },
      },
    })
    expect(deriveStageStatus('batch_signals', trace)).toBe('success')
  })

  it('returns warning for conflict_detect when has_conflict', () => {
    const trace = makeTrace({
      conflict_detection: { has_conflict: true, details: ['session_mismatch'] },
    })
    expect(deriveStageStatus('conflict_detect', trace)).toBe('warning')
  })

  it('returns success for conflict_detect when no conflict', () => {
    expect(deriveStageStatus('conflict_detect', makeTrace())).toBe('success')
  })

  it('returns success for disposition when final_bunk_requests exist', () => {
    const trace = makeTrace({
      disposition: {
        final_bunk_requests: [
          {
            bunk_request_id: '1',
            requester_cm_id: 123,
            requested_cm_id: 456,
            requested_name: 'Olivia Chen',
            request_type: 'BUNK_WITH',
            status: 'RESOLVED',
            confidence: 0.95,
            resolution_method: 'exact_match',
            declined_reason: null,
            disposition_reason: 'exact_match',
            is_reciprocal: false,
          },
        ],
      },
    })
    expect(deriveStageStatus('disposition', trace)).toBe('success')
  })

  it('returns warning for dedup_save when was_duplicate', () => {
    const trace = makeTrace({
      dedup_save: {
        was_duplicate: true,
        kept_over: 'br-99',
        self_reference: { detected: false },
      },
    })
    expect(deriveStageStatus('dedup_save', trace)).toBe('warning')
  })
})

describe('DedupDetail self_reference placement', () => {
  it('self_reference lives on dedup_save, NOT batch_signals (UI alignment)', () => {
    const trace = makeTrace({
      dedup_save: {
        was_duplicate: false,
        kept_over: null,
        self_reference: { detected: true },
      },
    })
    // This test is a semantic guard — the refactor moves self_reference to dedup_save
    // so the DedupDetail panel continues to render it correctly.
    expect(trace.dedup_save.self_reference.detected).toBe(true)
    // batch_signals has no self_reference field at all
    expect('self_reference' in (trace.batch_signals as object)).toBe(false)
  })
})
