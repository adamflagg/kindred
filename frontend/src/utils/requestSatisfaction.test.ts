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
import { computeRequestSatisfaction, resolveBadgeBucket } from './requestSatisfaction'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'
import type { RequestBucket } from '../types/satisfaction'

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

  it('returns unknown for not_bunk_with with no requestee (symmetric with bunk_with)', () => {
    const result = computeRequestSatisfaction({
      request: req({ request_type: 'not_bunk_with', requestee_id: 0 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: REQUESTER_GRADE,
    })
    expect(result.status).toBe('unknown')
  })
})

describe('resolveBadgeBucket — #1172 centralized-bucket-with-source-field-fallback', () => {
  // Pin contract: when the centralized aggregator (CamperSatisfaction.per_request)
  // classifies the row, that wins. When it has no entry (aggregator unavailable
  // or row not in the response), fall back to the row's own source_field/source —
  // pre-#1158 behavior. Centralized 'immaterial_parent' yields no badge.

  it('material_parent bucket → P badge regardless of source_field', () => {
    const result = resolveBadgeBucket('material_parent', {
      source_field: 'bunking_notes',
      source: 'staff',
    })
    expect(result).toEqual({ isMaterialAgePref: true, isStaffBadge: false })
  })

  it('staff bucket → S badge regardless of source_field', () => {
    const result = resolveBadgeBucket('staff', { source_field: 'bunk_with', source: 'family' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })

  it('immaterial_parent bucket → no badges', () => {
    const result = resolveBadgeBucket('immaterial_parent', {
      source_field: 'bunk_with',
      source: 'staff',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + age_preference + source_field=bunk_with → P badge (fallback)', () => {
    // Pre-#1169 review this test passed without request_type; the function now requires
    // request_type='age_preference' to fire the P badge fallback (see new tests below).
    const result = resolveBadgeBucket(undefined, {
      source_field: 'bunk_with',
      source: 'family',
      request_type: 'age_preference',
    })
    expect(result).toEqual({ isMaterialAgePref: true, isStaffBadge: false })
  })

  it('undefined bucket + source=staff → S badge (fallback)', () => {
    const result = resolveBadgeBucket(undefined, { source_field: 'bunking_notes', source: 'staff' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })

  it('undefined bucket + neither → no badges', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'socialize_with',
      source: 'family',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + missing source fields → no badges', () => {
    const result = resolveBadgeBucket(undefined, {})
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('handles all RequestBucket values without throwing', () => {
    const buckets: (RequestBucket | undefined)[] = [
      'material_parent',
      'immaterial_parent',
      'staff',
      undefined,
    ]
    for (const b of buckets) {
      expect(() => resolveBadgeBucket(b, {})).not.toThrow()
    }
  })

  // #1169 review: the fallback P-badge rule must only fire for age_preference rows.
  // A plain bunk_with request also has source_field='bunk_with' but is NOT a parent
  // age preference — the function should not slap a P badge on it.
  it('undefined bucket + bunk_with request_type + source_field=bunk_with → no P badge', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'bunk_with',
      source: 'family',
      request_type: 'bunk_with',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + age_preference request_type + source_field=bunk_with → P badge', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'bunk_with',
      source: 'family',
      request_type: 'age_preference',
    })
    expect(result).toEqual({ isMaterialAgePref: true, isStaffBadge: false })
  })

  // Regression: source_field=='' is truthy via `!= null`, so the previous
  // implementation called sourceFromField('') which throws, crashing the panel.
  // Fall back to req.source instead of throwing.
  it('undefined bucket + empty source_field + source=staff → falls back to source', () => {
    const result = resolveBadgeBucket(undefined, { source_field: '', source: 'staff' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })

  it('undefined bucket + empty source_field + source=family → no staff badge', () => {
    const result = resolveBadgeBucket(undefined, { source_field: '', source: 'family' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + unknown source_field + source=staff → falls back to source', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'legacy_unknown_field',
      source: 'staff',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })
})
