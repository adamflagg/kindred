import { describe, it, expect } from 'vitest'
import {
  getStatusIndicator,
  getStatusPriority,
  filterEnrollmentsByStatus,
} from './enrollmentFilter'
import type { Camper } from '../types/app-types'

function makeCamper(overrides: Partial<Camper> = {}): Camper {
  return {
    id: '1:1000',
    name: 'Emma Johnson',
    age: 12,
    grade: 6,
    gender: 'F',
    session_cm_id: 1000,
    person_cm_id: 1,
    created: '2026-01-01',
    updated: '2026-01-01',
    attendee_status: 'enrolled',
    ...overrides,
  }
}

describe('getStatusIndicator', () => {
  it('returns null for enrolled status', () => {
    expect(getStatusIndicator('enrolled')).toBeNull()
  })

  it('returns null for undefined status', () => {
    expect(getStatusIndicator(undefined)).toBeNull()
  })

  it('returns W for waitlisted', () => {
    const result = getStatusIndicator('waitlisted')
    expect(result).not.toBeNull()
    expect(result!.letter).toBe('W')
    expect(result!.colorClass).toContain('amber')
  })

  it('returns C for cancelled', () => {
    const result = getStatusIndicator('cancelled')
    expect(result).not.toBeNull()
    expect(result!.letter).toBe('C')
    expect(result!.colorClass).toContain('red')
  })

  it('returns A for applied', () => {
    const result = getStatusIndicator('applied')
    expect(result).not.toBeNull()
    expect(result!.letter).toBe('A')
    expect(result!.colorClass).toContain('blue')
  })

  it('returns X for withdrawn', () => {
    const result = getStatusIndicator('withdrawn')
    expect(result).not.toBeNull()
    expect(result!.letter).toBe('X')
  })

  it('returns D for dismissed', () => {
    const result = getStatusIndicator('dismissed')
    expect(result).not.toBeNull()
    expect(result!.letter).toBe('D')
  })

  it('returns null for unknown status', () => {
    expect(getStatusIndicator('some_unknown_status')).toBeNull()
  })
})

describe('getStatusPriority', () => {
  it('waitlisted has highest priority (lowest number)', () => {
    expect(getStatusPriority('waitlisted')).toBeLessThan(getStatusPriority('applied'))
    expect(getStatusPriority('waitlisted')).toBeLessThan(getStatusPriority('cancelled'))
  })

  it('applied has higher priority than cancelled', () => {
    expect(getStatusPriority('applied')).toBeLessThan(getStatusPriority('cancelled'))
  })

  it('cancelled has higher priority than withdrawn', () => {
    expect(getStatusPriority('cancelled')).toBeLessThan(getStatusPriority('withdrawn'))
  })

  it('unknown status gets lowest priority', () => {
    expect(getStatusPriority('unknown_status')).toBe(999)
    expect(getStatusPriority(undefined)).toBe(999)
  })
})

describe('filterEnrollmentsByStatus', () => {
  it('returns enrolled campers when some are enrolled', () => {
    const enrolled = makeCamper({ id: '1:1000', attendee_status: 'enrolled', session_cm_id: 1000 })
    const waitlisted = makeCamper({
      id: '1:2000',
      attendee_status: 'waitlisted',
      session_cm_id: 2000,
    })

    const result = filterEnrollmentsByStatus([enrolled, waitlisted])
    expect(result.enrolled).toHaveLength(1)
    expect(result.enrolled[0]!.session_cm_id).toBe(1000)
    expect(result.fallback).toBeNull()
  })

  it('returns multiple enrolled campers for multi-session', () => {
    const enrolled1 = makeCamper({
      id: '1:1000',
      attendee_status: 'enrolled',
      session_cm_id: 1000,
    })
    const enrolled2 = makeCamper({
      id: '1:2000',
      attendee_status: 'enrolled',
      session_cm_id: 2000,
    })

    const result = filterEnrollmentsByStatus([enrolled1, enrolled2])
    expect(result.enrolled).toHaveLength(2)
    expect(result.fallback).toBeNull()
  })

  it('returns fallback when no campers are enrolled', () => {
    const waitlisted = makeCamper({
      id: '1:1000',
      attendee_status: 'waitlisted',
      session_cm_id: 1000,
    })
    const cancelled = makeCamper({
      id: '1:2000',
      attendee_status: 'cancelled',
      session_cm_id: 2000,
    })

    const result = filterEnrollmentsByStatus([waitlisted, cancelled])
    expect(result.enrolled).toHaveLength(0)
    expect(result.fallback).not.toBeNull()
    // Waitlisted has higher priority than cancelled
    expect(result.fallback!.attendee_status).toBe('waitlisted')
  })

  it('returns empty result for empty input', () => {
    const result = filterEnrollmentsByStatus([])
    expect(result.enrolled).toHaveLength(0)
    expect(result.fallback).toBeNull()
  })

  it('picks waitlisted over cancelled as fallback', () => {
    const cancelled = makeCamper({
      id: '1:1000',
      attendee_status: 'cancelled',
      session_cm_id: 1000,
    })
    const waitlisted = makeCamper({
      id: '1:2000',
      attendee_status: 'waitlisted',
      session_cm_id: 2000,
    })

    // Pass cancelled first to verify sorting works
    const result = filterEnrollmentsByStatus([cancelled, waitlisted])
    expect(result.fallback!.attendee_status).toBe('waitlisted')
  })

  it('does not include non-enrolled in enrolled array even when mixed', () => {
    const enrolled = makeCamper({ id: '1:1000', attendee_status: 'enrolled', session_cm_id: 1000 })
    const cancelled = makeCamper({
      id: '1:2000',
      attendee_status: 'cancelled',
      session_cm_id: 2000,
    })
    const waitlisted = makeCamper({
      id: '1:3000',
      attendee_status: 'waitlisted',
      session_cm_id: 3000,
    })

    const result = filterEnrollmentsByStatus([enrolled, cancelled, waitlisted])
    expect(result.enrolled).toHaveLength(1)
    expect(result.enrolled.every((c) => c.attendee_status === 'enrolled')).toBe(true)
    expect(result.fallback).toBeNull()
  })
})
