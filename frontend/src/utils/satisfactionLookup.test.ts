import { describe, it, expect } from 'vitest'
import { buildSatisfactionLookup, evaluateRequest, resolveBadgeBucket } from './satisfactionLookup'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'
import type { PerRequestStatus, RequestBucket } from '../types/satisfaction'

describe('buildSatisfactionLookup', () => {
  it('returns satisfied + detail for a known request_id', () => {
    const perRequest: PerRequestStatus[] = [
      { request_id: 'r1', bucket: 'material_parent', satisfied: true, detail: 'Same bunk' },
    ]
    const lookup = buildSatisfactionLookup(perRequest)
    expect(lookup('r1')).toEqual({ satisfied: true, detail: 'Same bunk' })
  })

  it('returns {satisfied: null, detail: null} for an unknown request_id', () => {
    const lookup = buildSatisfactionLookup([])
    expect(lookup('missing')).toEqual({ satisfied: null, detail: null })
  })

  it('coerces undefined detail to null', () => {
    const perRequest: PerRequestStatus[] = [
      { request_id: 'r1', bucket: 'material_parent', satisfied: false },
    ]
    const lookup = buildSatisfactionLookup(perRequest)
    expect(lookup('r1')).toEqual({ satisfied: false, detail: null })
  })

  it('surfaces backend "Requester not assigned" detail (regression: do NOT suppress for unassigned campers)', () => {
    // When a camper is unassigned, the backend evaluates every request as
    // (False, "Requester not assigned"). The lookup MUST surface this — earlier
    // behavior in CamperDetail / CamperDetailsPanel short-circuited to
    // {satisfied: null, detail: null} when assigned_bunk_cm_id was null,
    // suppressing legitimate API-provided detail strings.
    const perRequest: PerRequestStatus[] = [
      {
        request_id: 'r1',
        bucket: 'material_parent',
        satisfied: false,
        detail: 'Requester not assigned',
      },
    ]
    const lookup = buildSatisfactionLookup(perRequest)
    expect(lookup('r1')).toEqual({
      satisfied: false,
      detail: 'Requester not assigned',
    })
  })
})

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

describe('evaluateRequest — unknown-state branches (TS-only, not parity-tested)', () => {
  it('returns unknown when requester has no bunk (any request type)', () => {
    const result = evaluateRequest({
      request: req({ request_type: 'bunk_with', requestee_id: 200 }),
      requesterBunkCmId: null,
      requesterBunkmates: [],
      targetBunkCmId: 42,
      requesterGrade: 7,
    })
    expect(result.status).toBe('unknown')
    expect(result.detail).toBe('Requester not assigned')
  })

  it('returns unknown for bunk_with with no requestee', () => {
    const result = evaluateRequest({
      request: req({ request_type: 'bunk_with', requestee_id: 0 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: 7,
    })
    expect(result.status).toBe('unknown')
  })

  it('returns unknown for not_bunk_with with no requestee', () => {
    const result = evaluateRequest({
      request: req({ request_type: 'not_bunk_with', requestee_id: 0 }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: 7,
    })
    expect(result.status).toBe('unknown')
  })

  it('returns unknown for age_preference with no grade on file', () => {
    const result = evaluateRequest({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [{ cmId: 200, grade: 8 }],
      targetBunkCmId: null,
      requesterGrade: null,
    })
    expect(result.status).toBe('unknown')
    expect(result.detail).toBe('No grade on file')
  })

  it('returns not_satisfied for age_preference with empty bunk roster', () => {
    const result = evaluateRequest({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [],
      targetBunkCmId: null,
      requesterGrade: 7,
    })
    expect(result.status).toBe('not_satisfied')
    expect(result.detail).toBe('No bunkmates assigned yet')
  })

  it('age_preference satisfied detail is wrapped with bunk-grade breakdown', () => {
    const result = evaluateRequest({
      request: req({ request_type: 'age_preference', age_preference_target: 'older' }),
      requesterBunkCmId: 42,
      requesterBunkmates: [
        { cmId: 200, grade: 8 },
        { cmId: 201, grade: 9 },
      ],
      targetBunkCmId: null,
      requesterGrade: 7,
    })
    expect(result.status).toBe('satisfied')
    expect(result.detail).toMatch(/^Bunk: .*— /)
  })
})

describe('resolveBadgeBucket — #1172 centralized-bucket-with-source-field-fallback', () => {
  it('material_parent bucket → P badge regardless of source_field', () => {
    const result = resolveBadgeBucket('material_parent', {
      source_field: 'bunking_notes',
    })
    expect(result).toEqual({ isMaterialAgePref: true, isStaffBadge: false })
  })

  it('staff bucket → S badge regardless of source_field', () => {
    const result = resolveBadgeBucket('staff', { source_field: 'bunk_with' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })

  it('immaterial_parent bucket → no badges', () => {
    const result = resolveBadgeBucket('immaterial_parent', {
      source_field: 'bunk_with',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + age_preference + source_field=bunk_with → P badge (fallback)', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'bunk_with',
      request_type: 'age_preference',
    })
    expect(result).toEqual({ isMaterialAgePref: true, isStaffBadge: false })
  })

  it('undefined bucket + source_field=bunking_notes → S badge (fallback)', () => {
    const result = resolveBadgeBucket(undefined, { source_field: 'bunking_notes' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })

  it('undefined bucket + neither → no badges', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'socialize_with',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + missing source fields → no badges', () => {
    const result = resolveBadgeBucket(undefined, {})
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('handles all RequestBucket values without throwing', () => {
    const buckets: Array<RequestBucket | undefined> = [
      'material_parent',
      'immaterial_parent',
      'staff',
      undefined,
    ]
    for (const b of buckets) {
      expect(() => resolveBadgeBucket(b, {})).not.toThrow()
    }
  })

  it('undefined bucket + bunk_with request_type + source_field=bunk_with → no P badge', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'bunk_with',
      request_type: 'bunk_with',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + age_preference request_type + source_field=bunk_with → P badge', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'bunk_with',
      request_type: 'age_preference',
    })
    expect(result).toEqual({ isMaterialAgePref: true, isStaffBadge: false })
  })

  it('undefined bucket + empty source_field → no badges (#1142 stage 4)', () => {
    // Stage 4 dropped the `source` column; no fallback exists for unknown source_field.
    const result = resolveBadgeBucket(undefined, { source_field: '' })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + unknown source_field → no badges (#1142 stage 4)', () => {
    const result = resolveBadgeBucket(undefined, {
      source_field: 'legacy_unknown_field',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: false })
  })

  it('undefined bucket + source_field=manual → S badge (admin-UI staff entry)', () => {
    // CreateRequestModal writes source_field='manual' for staff-created requests.
    // Manual entry is staff entry by definition — recognize 'manual' as a 6th
    // canonical source_field value mapping to STAFF (#1142 stage 4 follow-up).
    const result = resolveBadgeBucket(undefined, {
      source_field: 'manual',
      request_type: 'age_preference',
    })
    expect(result).toEqual({ isMaterialAgePref: false, isStaffBadge: true })
  })
})
