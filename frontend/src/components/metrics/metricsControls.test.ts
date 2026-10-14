/**
 * metricsControls — which of Analytics' controls show on a page, and why one is disabled.
 *
 * PR 4 pick 4B (owner, 2026-10-14): a control that does nothing on a page is shown disabled with
 * the reason written inside it, instead of vanishing. That includes the two that used to show
 * but do nothing (Compare on Day 1, Expanded analysis on Trends › Cancellations). On an empty
 * season (board 9 A) every control that would otherwise work reads "no {year} enrollments yet";
 * the session picker stays live.
 */
import { describe, it, expect } from 'vitest'
import { metricsControls } from './metricsControls'

const full = { scopeHasTeens: true, emptyYear: null }

describe('metricsControls — which controls a section shows', () => {
  it('Registration shows Compare only', () => {
    const c = metricsControls('/analytics/registration/overview', full)
    expect(c.compare).toEqual({ shown: true, reason: null })
    expect(c.expanded.shown).toBe(false)
    expect(c.teen.shown).toBe(false)
  })

  it('Trends shows Expanded analysis only', () => {
    const c = metricsControls('/analytics/trends', full)
    expect(c.expanded).toEqual({ shown: true, reason: null })
    expect(c.compare.shown).toBe(false)
    expect(c.teen.shown).toBe(false)
  })

  it('Retention shows the teen box only', () => {
    const c = metricsControls('/analytics/retention', full)
    expect(c.teen).toEqual({ shown: true, reason: null })
    expect(c.compare.shown).toBe(false)
    expect(c.expanded.shown).toBe(false)
  })
})

describe('metricsControls — disabled with the reason inside (4B)', () => {
  it.each([
    ['/analytics/registration/forecast', 'not on Forecast'],
    ['/analytics/registration/availability', 'not on Availability'],
    ['/analytics/registration/day1', 'not on Day 1'],
  ])('Compare on %s reads "%s"', (path, reason) => {
    expect(metricsControls(path, full).compare).toEqual({ shown: true, reason })
  })

  it('Compare works on the other Registration pages', () => {
    for (const p of ['overview', 'geo', 'waitlist', 'cancellations']) {
      expect(metricsControls(`/analytics/registration/${p}`, full).compare.reason).toBeNull()
    }
    expect(metricsControls('/analytics/registration', full).compare.reason).toBeNull()
  })

  it.each([
    ['/analytics/trends/velocity', 'not on Velocity'],
    ['/analytics/trends/cancellations', 'not on Cancellations'],
  ])('Expanded analysis on %s reads "%s"', (path, reason) => {
    expect(metricsControls(path, full).expanded).toEqual({ shown: true, reason })
  })

  it('the teen box needs a scope with teens', () => {
    const c = metricsControls('/analytics/retention/flow', { ...full, scopeHasTeens: false })
    expect(c.teen).toEqual({ shown: true, reason: 'needs Teens or All Summer' })
  })

  it.each([
    ['/analytics/retention/bunks', 'Bunk Analysis'],
    ['/analytics/retention/staff', 'Staff Analysis'],
  ])('on %s the teen box and the picker are not used', (path, label) => {
    const c = metricsControls(path, full)
    expect(c.teen).toEqual({ shown: true, reason: `not on ${label}` })
    expect(c.pickerUsed).toBe(false)
  })

  it('the picker is used everywhere else', () => {
    for (const p of [
      '/analytics/registration/overview',
      '/analytics/retention',
      '/analytics/retention/flow',
      '/analytics/trends/velocity',
    ]) {
      expect(metricsControls(p, full).pickerUsed).toBe(true)
    }
  })
})

describe('metricsControls — empty season (board 9 A)', () => {
  const empty = { scopeHasTeens: true, emptyYear: 2027 }

  it('a working control reads "no 2027 enrollments yet"', () => {
    expect(metricsControls('/analytics/registration/overview', empty).compare.reason).toBe(
      'no 2027 enrollments yet'
    )
    expect(metricsControls('/analytics/trends', empty).expanded.reason).toBe(
      'no 2027 enrollments yet'
    )
    expect(metricsControls('/analytics/retention', empty).teen.reason).toBe(
      'no 2027 enrollments yet'
    )
  })

  it('a control already off for its page keeps its own reason', () => {
    expect(metricsControls('/analytics/registration/forecast', empty).compare.reason).toBe(
      'not on Forecast'
    )
    expect(metricsControls('/analytics/retention/bunks', empty).teen.reason).toBe(
      'not on Bunk Analysis'
    )
  })

  it('the picker stays live', () => {
    expect(metricsControls('/analytics/registration/overview', empty).pickerUsed).toBe(true)
  })
})
