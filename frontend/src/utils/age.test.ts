/**
 * Tests for age utility functions
 */
import { describe, it, expect } from 'vitest'
import { formatAge, displayCampMinderAge, displayTruncatedAge } from './age'

describe('formatAge', () => {
  it('should format age with years and months', () => {
    expect(formatAge(11.06)).toBe('11 years, 6 months')
  })

  it('should format age with just years when months is 0', () => {
    expect(formatAge(10.0)).toBe('10 years')
    expect(formatAge(12)).toBe('12 years')
  })

  it('should use singular "month" for 1 month', () => {
    expect(formatAge(9.01)).toBe('9 years, 1 month')
  })

  it('should handle edge cases', () => {
    expect(formatAge(0)).toBe('0 years')
    expect(formatAge(0.11)).toBe('0 years, 11 months')
  })

  it('should round months correctly', () => {
    // CampMinder format uses .01 for 1 month, .02 for 2 months, etc.
    expect(formatAge(11.03)).toBe('11 years, 3 months')
    expect(formatAge(11.12)).toBe('11 years, 12 months')
  })
})

describe('displayCampMinderAge', () => {
  it('should display age with 2 decimal places', () => {
    expect(displayCampMinderAge(11.06)).toBe('11.06')
    expect(displayCampMinderAge(10)).toBe('10.00')
  })

  it('should handle edge cases', () => {
    expect(displayCampMinderAge(0)).toBe('0.00')
    expect(displayCampMinderAge(15.11)).toBe('15.11')
  })
})

describe('displayTruncatedAge', () => {
  // kindred#2074: the family card leads with the campers' whole-year ages.
  // `persons.age` is CampMinder's yy.mm, encoded so months never exceed .11
  // -- a fraction that itself always rounds DOWN (0.11 < 0.5), so `Math.round`
  // happens to agree with `Math.trunc` on every value this format can produce.
  // `Math.trunc` is still required: it matches the "completed years" semantics
  // the format intends, rather than "nearest year", which coincides today only
  // because no valid month fraction reaches .5. The out-of-range case below is
  // what actually goes red under `Math.round` -- see its comment.
  it('truncates 6 years 11 months to 6, never rounds up to 7', () => {
    expect(displayTruncatedAge(6.11)).toBe('6')
  })

  it('truncates a sub-1 age to 0, not 1', () => {
    // A real 6-month-old (0.06), not the "unknown age" sentinel -- the
    // caller is responsible for that distinction, this just truncates.
    expect(displayTruncatedAge(0.06)).toBe('0')
  })

  it('leaves a whole-year age unchanged', () => {
    expect(displayTruncatedAge(15)).toBe('15')
  })

  it('does not round the fractional part under any circumstance', () => {
    // Not a realistic CampMinder value (months cap at .11) -- deliberately
    // out of range to prove the implementation truncates unconditionally
    // rather than happening to work only inside the CampMinder envelope.
    expect(displayTruncatedAge(11.99)).toBe('11')
  })
})
