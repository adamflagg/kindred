/**
 * Tests for requestEditableHelpers — TDD tests written before fixes.
 */
import { describe, it, expect } from 'vitest'
import { computeTypeUpdate, computeTargetUpdate } from './requestEditableHelpers'

// ---------------------------------------------------------------------------
// computeTypeUpdate
// ---------------------------------------------------------------------------
describe('computeTypeUpdate', () => {
  it('sets request_type to age_preference', () => {
    const result = computeTypeUpdate('age_preference')
    expect(result.request_type).toBe('age_preference')
  })

  it('clears requestee_id to null when switching to age_preference', () => {
    const result = computeTypeUpdate('age_preference')
    expect(result.requestee_id).toBeNull()
  })

  it('clears age_preference_target when switching to bunk_with', () => {
    const result = computeTypeUpdate('bunk_with')
    expect(result.age_preference_target).toBe('')
  })

  // #1028 — switching type must reset stale resolution state
  it('resets status to pending when switching to age_preference (#1028)', () => {
    const result = computeTypeUpdate('age_preference')
    expect(result.status).toBe('pending')
  })

  it('resets confidence_score to 0 when switching to age_preference (#1028)', () => {
    const result = computeTypeUpdate('age_preference')
    expect(result.confidence_score).toBe(0)
  })

  it('resets status to pending when switching to bunk_with (#1028)', () => {
    const result = computeTypeUpdate('bunk_with')
    expect(result.status).toBe('pending')
  })

  it('resets confidence_score to 0 when switching to bunk_with (#1028)', () => {
    const result = computeTypeUpdate('bunk_with')
    expect(result.confidence_score).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeTargetUpdate
// ---------------------------------------------------------------------------
describe('computeTargetUpdate', () => {
  it('sets requestee_id when provided', () => {
    const result = computeTargetUpdate({ requestee_id: 42 })
    expect(result.requestee_id).toBe(42)
  })

  it('sets status=resolved and confidence=1.0 when requestee_id > 0', () => {
    const result = computeTargetUpdate({ requestee_id: 42 })
    expect(result.status).toBe('resolved')
    expect(result.confidence_score).toBe(1.0)
  })

  it('sets age_preference_target when provided', () => {
    const result = computeTargetUpdate({ age_preference_target: 'older' })
    expect(result.age_preference_target).toBe('older')
  })

  // #997 — clearing requestee_id must demote to pending
  it('resets status to pending when requestee_id is cleared to null (#997)', () => {
    const result = computeTargetUpdate({ requestee_id: null })
    expect(result.status).toBe('pending')
  })

  it('resets confidence_score to 0 when requestee_id is cleared to null (#997)', () => {
    const result = computeTargetUpdate({ requestee_id: null })
    expect(result.confidence_score).toBe(0)
  })

  it('resets status to pending when requestee_id is cleared to 0 (#997)', () => {
    const result = computeTargetUpdate({ requestee_id: 0 })
    expect(result.status).toBe('pending')
  })

  it('resets confidence_score to 0 when requestee_id is cleared to 0 (#997)', () => {
    const result = computeTargetUpdate({ requestee_id: 0 })
    expect(result.confidence_score).toBe(0)
  })
})
