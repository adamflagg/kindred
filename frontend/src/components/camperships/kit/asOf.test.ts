/** The as-of state (D15, D20; the 3c reads' `?as_of=` and `?as_of_axis=`). */
import { describe, expect, it } from 'vitest'

import { aidHref, asOfQuery, parseAsOf } from './asOf'

const TODAY = '2026-10-01'

describe('parseAsOf', () => {
  it('is live with no date', () => {
    expect(parseAsOf(null, null, TODAY)).toEqual({ kind: 'live' })
    expect(parseAsOf('', null, TODAY)).toEqual({ kind: 'live' })
  })

  it("reads a past day, on CampMinder's axis by default", () => {
    expect(parseAsOf('2026-04-01', null, TODAY)).toEqual({
      kind: 'past',
      date: '2026-04-01',
      axis: 'campminder',
    })
  })

  it('reads the recorded axis', () => {
    expect(parseAsOf('2026-04-01', 'recorded', TODAY)).toEqual({
      kind: 'past',
      date: '2026-04-01',
      axis: 'recorded',
    })
  })

  // Ruling 2026-10-01 (plan review): today is live, as the server's `_past_day` treats it
  // (api/services/financial_aid_decisions_service.py), so the band never pills a live view.
  it('treats today, on camp time, as live, as the server does', () => {
    expect(parseAsOf(TODAY, null, TODAY)).toEqual({ kind: 'live' })
  })

  it.each(['2026-13-01', 'yesterday', '2026-4-1', '2026-10-02'])(
    'calls %j invalid rather than quietly showing live',
    (raw) => {
      expect(parseAsOf(raw, null, TODAY)).toEqual({ kind: 'invalid', raw })
    }
  )
})

describe('asOfQuery', () => {
  it('sends nothing when live or invalid', () => {
    expect(asOfQuery({ kind: 'live' })).toEqual({})
    expect(asOfQuery({ kind: 'invalid', raw: 'x' })).toEqual({})
  })

  it("sends the date, and the axis only when it isn't the default", () => {
    expect(asOfQuery({ kind: 'past', date: '2026-04-01', axis: 'campminder' })).toEqual({
      as_of: '2026-04-01',
    })
    expect(asOfQuery({ kind: 'past', date: '2026-04-01', axis: 'recorded' })).toEqual({
      as_of: '2026-04-01',
      as_of_axis: 'recorded',
    })
  })
})

describe('aidHref (D15: a pasted link reproduces the view; D85, Decision 9: with its season)', () => {
  it('leaves a link bare while the season is not known yet (0) and the view is live', () => {
    expect(aidHref('/aid/season/rules', { year: 0, asOf: { kind: 'live' } })).toBe(
      '/aid/season/rules'
    )
  })

  it('carries the season', () => {
    expect(aidHref('/aid/season/rules', { year: 2027, asOf: { kind: 'live' } })).toBe(
      '/aid/season/rules?year=2027'
    )
  })

  it('carries extra parameters, the season and a past date, in that order', () => {
    expect(
      aidHref(
        '/aid/season/rounds-budget',
        { year: 2027, asOf: { kind: 'past', date: '2026-04-01', axis: 'campminder' } },
        { pool: 'pool_a' }
      )
    ).toBe('/aid/season/rounds-budget?pool=pool_a&year=2027&as_of=2026-04-01')
  })
})
