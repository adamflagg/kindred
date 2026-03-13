import { describe, it, expect } from 'vitest'
import { sortEnrolledFirst } from './enrollmentSort'

describe('sortEnrolledFirst', () => {
  it('sorts enrolled before non-enrolled', () => {
    const items = [
      { status: 'waitlisted', sessionType: 'main' },
      { status: 'enrolled', sessionType: 'main' },
    ]
    const sorted = [...items].sort((a, b) =>
      sortEnrolledFirst(a.status, a.sessionType, b.status, b.sessionType)
    )
    expect(sorted[0]!.status).toBe('enrolled')
  })

  it('sorts by session type when both enrolled', () => {
    const items = [
      { status: 'enrolled', sessionType: 'ag' },
      { status: 'enrolled', sessionType: 'main' },
    ]
    const sorted = [...items].sort((a, b) =>
      sortEnrolledFirst(a.status, a.sessionType, b.status, b.sessionType)
    )
    expect(sorted[0]!.sessionType).toBe('main')
  })

  it('sorts by session type when both non-enrolled', () => {
    const items = [
      { status: 'waitlisted', sessionType: 'embedded' },
      { status: 'cancelled', sessionType: 'main' },
    ]
    const sorted = [...items].sort((a, b) =>
      sortEnrolledFirst(a.status, a.sessionType, b.status, b.sessionType)
    )
    expect(sorted[0]!.sessionType).toBe('main')
  })

  it('enrolled main beats waitlisted main', () => {
    const result = sortEnrolledFirst('enrolled', 'main', 'waitlisted', 'main')
    expect(result).toBeLessThan(0)
  })
})
