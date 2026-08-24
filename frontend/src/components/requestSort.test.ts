/**
 * Tests for the requests-tab sort function.
 *
 * Feature: staff asked (April 2026) for the requests tab to default to
 * grade-ascending (youngest first) with a name tiebreaker. Clicking a
 * column header replaces this default for the session; the default comes
 * back on refresh.
 */
import { describe, it, expect } from 'vitest'
import {
  sortRequests,
  orderByTablePosition,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
} from './requestSort'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

describe('requests-tab default sort constants', () => {
  it('defaults to grade ascending (youngest first) per staff feedback', () => {
    expect(DEFAULT_SORT_BY).toBe('grade')
    expect(DEFAULT_SORT_ORDER).toBe('asc')
  })
})

function person(partial: Partial<PersonsResponse> & { cm_id: number }): PersonsResponse {
  return {
    cm_id: partial.cm_id,
    first_name: partial.first_name ?? '',
    last_name: partial.last_name ?? '',
    grade: partial.grade,
    year: 2026,
    // Fields below are not read by the sort but are part of the type:
    id: `p-${partial.cm_id}`,
    collectionId: 'c-persons',
    collectionName: 'persons',
    created: '',
    updated: '',
  } as PersonsResponse
}

function request(
  partial: Partial<BunkRequestsResponse> & { id: string; requester_id: number }
): BunkRequestsResponse {
  return {
    id: partial.id,
    requester_id: partial.requester_id,
    requestee_id: partial.requestee_id ?? 0,
    confidence_score: partial.confidence_score ?? 0.5,
    status: partial.status ?? ('pending' as BunkRequestsResponse['status']),
    parse_notes: partial.parse_notes ?? '',
    session_id: partial.session_id ?? 1000001,
    year: 2026,
    collectionId: 'c-br',
    collectionName: 'bunk_requests',
    created: '',
    updated: '',
  } as BunkRequestsResponse
}

describe('sortRequests — grade default', () => {
  it('orders by requester grade ascending (youngest at top)', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Emma', last_name: 'Johnson', grade: 8 })],
      [2, person({ cm_id: 2, first_name: 'Liam', last_name: 'Garcia', grade: 3 })],
      [3, person({ cm_id: 3, first_name: 'Olivia', last_name: 'Chen', grade: 5 })],
    ])
    const requests = [
      request({ id: 'r1', requester_id: 1 }),
      request({ id: 'r2', requester_id: 2 }),
      request({ id: 'r3', requester_id: 3 }),
    ]

    const sorted = sortRequests(requests, personMap, 'grade', 'asc')
    expect(sorted.map((r) => r.id)).toEqual(['r2', 'r3', 'r1'])
  })

  it('tiebreaks same-grade requesters by first name then last name', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Riley', last_name: 'Sam', grade: 5 })],
      [2, person({ cm_id: 2, first_name: 'Samuel', last_name: 'Johnson', grade: 5 })],
      [3, person({ cm_id: 3, first_name: 'Ada', last_name: 'Johnson', grade: 5 })],
    ])
    const requests = [
      request({ id: 'rSam', requester_id: 1 }),
      request({ id: 'rSamuel', requester_id: 2 }),
      request({ id: 'rAda', requester_id: 3 }),
    ]

    const sorted = sortRequests(requests, personMap, 'grade', 'asc')
    // Same grade → first name asc (Ada < Riley < Samuel).
    expect(sorted.map((r) => r.id)).toEqual(['rAda', 'rSam', 'rSamuel'])
  })

  it('tiebreaks same first name within same grade by last name', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Riley', last_name: 'Zimmerman', grade: 5 })],
      [2, person({ cm_id: 2, first_name: 'Riley', last_name: 'Adams', grade: 5 })],
    ])
    const requests = [
      request({ id: 'rZim', requester_id: 1 }),
      request({ id: 'rAdm', requester_id: 2 }),
    ]

    const sorted = sortRequests(requests, personMap, 'grade', 'asc')
    // Same grade + same first name → last name asc (Adams < Zimmerman).
    expect(sorted.map((r) => r.id)).toEqual(['rAdm', 'rZim'])
  })

  it('places requesters with missing / zero grade at the bottom (ascending)', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Emma', last_name: 'Johnson', grade: 5 })],
      [2, person({ cm_id: 2, first_name: 'Liam', last_name: 'Garcia' })], // no grade
      [3, person({ cm_id: 3, first_name: 'Olivia', last_name: 'Chen', grade: 0 })],
    ])
    const requests = [
      request({ id: 'rNoGrade', requester_id: 2 }),
      request({ id: 'rZero', requester_id: 3 }),
      request({ id: 'rGraded', requester_id: 1 }),
    ]

    const sorted = sortRequests(requests, personMap, 'grade', 'asc')
    expect(sorted[0]?.id).toBe('rGraded')
    // rNoGrade and rZero both at the bottom — relative order between them is
    // not prescribed here, only that they follow the graded row.
    expect(
      sorted
        .slice(1)
        .map((r) => r.id)
        .sort()
    ).toEqual(['rNoGrade', 'rZero'])
  })
})

describe('sortRequests — ungraded always at bottom regardless of direction', () => {
  it('desc: graded requester comes BEFORE ungraded requester', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Emma', last_name: 'Johnson', grade: 3 })],
      [2, person({ cm_id: 2, first_name: 'Liam', last_name: 'Garcia' })], // no grade
    ])
    const requests = [
      request({ id: 'rUngraded', requester_id: 2 }),
      request({ id: 'rGraded', requester_id: 1 }),
    ]

    const sorted = sortRequests(requests, personMap, 'grade', 'desc')
    // Graded must come first; ungraded parked at the bottom even in desc mode.
    expect(sorted.map((r) => r.id)).toEqual(['rGraded', 'rUngraded'])
  })

  it('asc: ungraded requester stays at the bottom', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Emma', last_name: 'Johnson', grade: 3 })],
      [2, person({ cm_id: 2, first_name: 'Liam', last_name: 'Garcia' })], // no grade
    ])
    const requests = [
      request({ id: 'rUngraded', requester_id: 2 }),
      request({ id: 'rGraded', requester_id: 1 }),
    ]

    const sorted = sortRequests(requests, personMap, 'grade', 'asc')
    expect(sorted.map((r) => r.id)).toEqual(['rGraded', 'rUngraded'])
  })

  it('both ungraded → tiebreak by first name then last name (stable, not direction-inverted)', () => {
    const personMap = new Map<number, PersonsResponse>([
      [1, person({ cm_id: 1, first_name: 'Zelda', last_name: 'Morris' })],
      [2, person({ cm_id: 2, first_name: 'Ada', last_name: 'Morris' })],
    ])
    const requests = [
      request({ id: 'rZelda', requester_id: 1 }),
      request({ id: 'rAda', requester_id: 2 }),
    ]

    // In asc mode: Ada < Zelda → rAda first
    expect(sortRequests(requests, personMap, 'grade', 'asc').map((r) => r.id)).toEqual([
      'rAda',
      'rZelda',
    ])
    // In desc mode: direction flips the grade ordering but NOT the ungraded-bottom rule.
    // Both are ungraded, so name tiebreak should still put Ada before Zelda
    // (or at minimum the direction flip should not push ungraded rows to the top).
    const descSorted = sortRequests(requests, personMap, 'grade', 'desc')
    // Both are ungraded → they should both still be at the "bottom" of their peer group;
    // we only assert they stay in a stable relative order, not pushed above graded rows.
    expect(descSorted.map((r) => r.id)).toEqual(['rAda', 'rZelda'])
  })
})

describe('sortRequests — column click behavior preserved', () => {
  const personMap = new Map<number, PersonsResponse>([
    [1, person({ cm_id: 1, first_name: 'Emma', last_name: 'Johnson', grade: 8 })],
    [2, person({ cm_id: 2, first_name: 'Liam', last_name: 'Garcia', grade: 3 })],
  ])

  it('sorts by confidence when column is clicked (no grade grouping retained)', () => {
    const requests = [
      request({ id: 'high', requester_id: 1, confidence_score: 0.9 }),
      request({ id: 'low', requester_id: 2, confidence_score: 0.2 }),
    ]
    expect(sortRequests(requests, personMap, 'confidence', 'desc').map((r) => r.id)).toEqual([
      'high',
      'low',
    ])
  })
})

/**
 * kindred#2538 scan, finding 1. The merge dialog seeds `selectedTargetId` from
 * `requests[0]` and POSTs it as `keep_target_from`, so the ORDER of the pair
 * handed to it is load-bearing. Both of RequestReviewPanel's openers now build
 * that pair through this helper, so they cannot disagree.
 */
describe('orderByTablePosition', () => {
  const table = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]

  it('orders a subset by its position in the table, not by the subset order', () => {
    const picked = [{ id: 'b' }, { id: 'c' }]
    expect(orderByTablePosition(picked, table).map((r) => r.id)).toEqual(['c', 'b'])
  })

  it('leaves a member the table does not contain at the end rather than dropping it', () => {
    // The reason the caller filters `requests` and not `sortedRequests`: an
    // active search can hide a row that is still a legitimate merge member.
    // Losing it would open a one-item merge dialog.
    const picked = [{ id: 'hidden' }, { id: 'b' }]
    expect(orderByTablePosition(picked, table).map((r) => r.id)).toEqual(['b', 'hidden'])
  })

  it('does not mutate the array it is given', () => {
    const picked = [{ id: 'b' }, { id: 'a' }]
    orderByTablePosition(picked, table)
    expect(picked.map((r) => r.id)).toEqual(['b', 'a'])
  })
})
