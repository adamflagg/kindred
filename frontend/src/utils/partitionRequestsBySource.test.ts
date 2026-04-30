import { describe, it, expect } from 'vitest'
import { partitionRequestsBySource } from './partitionRequestsBySource'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(
  overrides: Partial<EnhancedBunkRequest> & Record<string, any> = {}
): EnhancedBunkRequest {
  return {
    id: 'r' + Math.random().toString(36).slice(2, 8),
    requester_id: 1000001,
    requestee_id: 1000002,
    request_type: 'bunk_with',
    source_field: 'bunk_with',
    source: 'family',
    status: 'resolved',
    priority: 1,
    targetPerson: { first_name: 'Aa', last_name: 'Aa' },
    ...overrides,
  } as unknown as EnhancedBunkRequest
}

describe('partitionRequestsBySource', () => {
  it('routes bunk_with source_field to parent', () => {
    const r = row({ source_field: 'bunk_with' })
    const { parent, staff, age } = partitionRequestsBySource([r])
    expect(parent).toEqual([r])
    expect(staff).toEqual([])
    expect(age).toEqual([])
  })

  it('routes socialize_with source_field to parent (best-effort still parent-rendered)', () => {
    const r = row({ request_type: 'bunk_with', source_field: 'socialize_with' })
    const { parent } = partitionRequestsBySource([r])
    expect(parent).toEqual([r])
  })

  it('routes age_preference of any source_field to age', () => {
    const a = row({
      request_type: 'age_preference',
      source_field: 'bunk_with',
      age_preference_target: 'older',
    })
    const b = row({
      request_type: 'age_preference',
      source_field: 'socialize_with',
      age_preference_target: 'younger',
    })
    const c = row({
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      source: 'staff',
    })
    const { parent, staff, age } = partitionRequestsBySource([a, b, c])
    expect(parent).toEqual([])
    expect(staff).toEqual([])
    expect(age).toHaveLength(3)
  })

  it('routes not_bunk_with with source_field=bunk_with to parent (post-bug-fix)', () => {
    const r = row({ request_type: 'not_bunk_with', source_field: 'bunk_with' })
    const { parent, staff } = partitionRequestsBySource([r])
    expect(parent).toEqual([r])
    expect(staff).toEqual([])
  })

  it('routes not_bunk_with with staff source_field to staff', () => {
    const r = row({ request_type: 'not_bunk_with', source_field: 'not_bunk_with', source: 'staff' })
    const { parent, staff } = partitionRequestsBySource([r])
    expect(parent).toEqual([])
    expect(staff).toEqual([r])
  })

  it('routes bunk_with with bunking_notes source to staff', () => {
    const r = row({ request_type: 'bunk_with', source_field: 'bunking_notes', source: 'staff' })
    const { staff } = partitionRequestsBySource([r])
    expect(staff).toEqual([r])
  })

  it('sorts parent rows by requestee first_name, tiebreak last_name', () => {
    const a = row({ id: 'a', targetPerson: { first_name: 'Olivia', last_name: 'Chen' } })
    const b = row({ id: 'b', targetPerson: { first_name: 'Emma', last_name: 'Johnson' } })
    const c = row({ id: 'c', targetPerson: { first_name: 'Liam', last_name: 'Garcia' } })
    const { parent } = partitionRequestsBySource([a, b, c])
    expect(parent.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('tiebreaks identical first_name by last_name', () => {
    const a = row({ id: 'a', targetPerson: { first_name: 'Riley', last_name: 'Torres' } })
    const b = row({ id: 'b', targetPerson: { first_name: 'Riley', last_name: 'Sam' } })
    const { parent } = partitionRequestsBySource([a, b])
    expect(parent.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('handles missing targetPerson gracefully (sorts to top)', () => {
    const a = row({ id: 'a', targetPerson: { first_name: 'Riley', last_name: 'Sam' } })
    const b = row({ id: 'b', targetPerson: undefined })
    const { parent } = partitionRequestsBySource([a, b])
    expect(parent.map((r) => r.id)).toEqual(['b', 'a'])
  })
})
