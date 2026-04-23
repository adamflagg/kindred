import { describe, it, expect } from 'vitest'
import { hasMatchedRequestTarget, isConfirmedRequest } from './bunkRequest'
import type { BunkRequestsResponse } from '../types/pocketbase-types'

function makeRequest(overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse {
  return {
    id: 'r1',
    requester_id: 100,
    requestee_id: 200,
    request_type: 'bunk_with',
    status: 'resolved',
    priority: 1,
    requested_person_name: 'Emma Johnson',
    year: 2025,
    session_id: 1001,
    is_reciprocal: false,
    confidence_score: 0.95,
    created: '2025-01-01',
    ...overrides,
  } as unknown as BunkRequestsResponse
}

describe('isConfirmedRequest', () => {
  it('returns true when status is resolved and requestee_id > 0', () => {
    expect(isConfirmedRequest({ status: 'resolved', requestee_id: 42 })).toBe(true)
  })

  it('returns false when status is not resolved', () => {
    expect(isConfirmedRequest({ status: 'pending', requestee_id: 42 })).toBe(false)
    expect(isConfirmedRequest({ status: 'declined', requestee_id: 42 })).toBe(false)
  })

  it('returns false when requestee_id is missing or 0', () => {
    expect(isConfirmedRequest({ status: 'resolved', requestee_id: 0 })).toBe(false)
    expect(isConfirmedRequest({ status: 'resolved', requestee_id: null })).toBe(false)
    expect(isConfirmedRequest({ status: 'resolved' })).toBe(false)
  })
})

describe('hasMatchedRequestTarget', () => {
  it('returns true when requestee_id > 0 and targetName is a non-empty string', () => {
    expect(hasMatchedRequestTarget(makeRequest({ requestee_id: 201 }), 'Olivia Chen')).toBe(true)
  })

  it('returns true for declined requests with a matched requestee_id and target name', () => {
    expect(
      hasMatchedRequestTarget(makeRequest({ requestee_id: 201, status: 'declined' }), 'Olivia Chen')
    ).toBe(true)
  })

  it('returns false when requestee_id is 0', () => {
    expect(hasMatchedRequestTarget(makeRequest({ requestee_id: 0 }), 'Olivia Chen')).toBe(false)
  })

  it('returns false when requestee_id is null', () => {
    expect(
      hasMatchedRequestTarget(
        makeRequest({ requestee_id: null as unknown as number }),
        'Olivia Chen'
      )
    ).toBe(false)
  })

  it('returns false when requestee_id is undefined', () => {
    const req = makeRequest()
    // @ts-expect-error — deliberately removing for test
    delete req.requestee_id
    expect(hasMatchedRequestTarget(req, 'Olivia Chen')).toBe(false)
  })

  it('returns false when targetName is undefined', () => {
    expect(hasMatchedRequestTarget(makeRequest({ requestee_id: 201 }), undefined)).toBe(false)
  })

  it('returns false when targetName is null', () => {
    expect(hasMatchedRequestTarget(makeRequest({ requestee_id: 201 }), null)).toBe(false)
  })

  it('returns false when targetName is an empty string', () => {
    expect(hasMatchedRequestTarget(makeRequest({ requestee_id: 201 }), '')).toBe(false)
  })
})
