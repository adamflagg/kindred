/**
 * Tests for computeRequestSatisfaction — pure per-request satisfaction.
 *
 * These tests pin the canonical decision tree (design doc §3). Both
 * useSatisfactionData (PB-backed, session-agnostic) and CamperDetailsPanel
 * (scenario-aware, in-memory) call this function — divergence here would
 * desync the full-page view, the modal sidebar, and the bunking-board
 * orange-triangle alert.
 */
import { describe, it, expect } from 'vitest'
import { computeRequestSatisfaction } from './requestSatisfaction'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'

// Minimal request fixture — only fields the utility reads
function req(partial: Partial<EnhancedBunkRequest>): EnhancedBunkRequest {
  return {
    id: 'r-1',
    request_type: 'bunk_with',
    requestee_id: 0,
    age_preference_target: '',
    status: 'resolved',
    ...partial,
  } as unknown as EnhancedBunkRequest
}

const REQUESTER_GRADE = 7

describe('computeRequestSatisfaction — requester unassigned', () => {
  it('returns unknown when requester has no bunk (any request type)', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'bunk_with', requestee_id: 200 }),
      requesterBunkCmId: null,
      requesterBunkmates: [],
      targetBunkCmId: 42,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('unknown')
    expect(result.detail).toBe('Requester not assigned')
  })
})

describe('computeRequestSatisfaction — bunk_with', () => {
  it('satisfied when target is in same bunk as requester', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'bunk_with', requestee_id: 200 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 7 }],
      targetBunkCmId: 42,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('satisfied')
    expect(result.detail).toBe('Same bunk')
  })

  it('not_satisfied when target is in a different bunk', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'bunk_with', requestee_id: 200 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: 99,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('not_satisfied')
    expect(result.detail).toBe('Different bunks')
  })

  it('not_satisfied when target is unassigned (decision: actionable, not unknown)', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'bunk_with', requestee_id: 200 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('not_satisfied')
    expect(result.detail).toBe('Target not assigned')
  })
})

describe('computeRequestSatisfaction — not_bunk_with', () => {
  it('not_satisfied when target is in same bunk (conflict)', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'not_bunk_with', requestee_id: 200 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 7 }],
      targetBunkCmId: 42,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('not_satisfied')
    expect(result.detail).toBe('Same bunk (conflict!)')
  })

  it('satisfied when target is in a different bunk', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'not_bunk_with', requestee_id: 200 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: 99,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('satisfied')
    expect(result.detail).toBe('Different bunks')
  })

  it('satisfied when target is unassigned', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'not_bunk_with', requestee_id: 200 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('satisfied')
    expect(result.detail).toBe('Target not assigned')
  })
})

describe('computeRequestSatisfaction — age_preference', () => {
  it('unknown when requester has no grade on file', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 8 }],
      targetBunkCmId: null,
      requesterGrade: null,
    })
    expect(result.status).toBe('unknown')
    expect(result.detail).toBe('No grade on file')
  })

  it('not_satisfied when bunk is empty (no bunkmates) — decision: actionable, not unknown', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('not_satisfied')
    expect(result.detail).toBe('No bunkmates assigned yet')
  })

  it('satisfied when prefer-older and bunk has older grades; detail includes grade breakdown', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [
        { cmId: 200, grade: 8 },
        { cmId: 201, grade: 9 },
      ],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('satisfied')
    expect(result.detail).toMatch(/^Bunk:.*—.*older bunkmates/)
  })

  it('not_satisfied when prefer-older but only younger bunkmates', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 5 }],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('not_satisfied')
    expect(result.detail).toContain('younger bunkmates')
  })

  it('satisfied when prefer-younger and bunk has younger grades', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'age_preference', age_preference_target: 'younger' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 5 }],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('satisfied')
  })

  it('not_satisfied when prefer-younger but only older bunkmates', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'age_preference', age_preference_target: 'younger' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 9 }],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('not_satisfied')
  })
})

describe('computeRequestSatisfaction — fallback', () => {
  it('returns unknown for request_type with no requestee or age_preference_target', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'bunk_with', requestee_id: 0 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('unknown')
  })
})
