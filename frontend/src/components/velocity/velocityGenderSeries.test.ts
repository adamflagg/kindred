/**
 * Velocity's gender lines (#2898 owner answer #78): the Gender field (Boys, Girls; the default, cabin pacing) or
 * gender identity (one line per group the response holds, in the fixed order). The response says which basis it
 * was built on, so the lines follow the data, never a picker that has moved on ahead of it.
 */
import { describe, expect, it } from 'vitest'

import {
  GENDER_BASIS_PARAM,
  parseGenderBasis,
  sessionGenderCount,
  velocityGenderSeries,
} from './velocityGenderSeries'
import {
  GENDER_ANOTHER_IDENTITY,
  GENDER_BOY_MAN,
  GENDER_GIRL_WOMAN,
} from '../camperships/kit/genderIdentity'
import type { VelocityCurve, VelocityResponse } from '../../types/velocity'

const curve = (gender: string, year = 2026): VelocityCurve => ({
  year,
  session_cm_id: null,
  session_name: null,
  gender,
  daily: [],
  weekly: [],
})

const response = (over: Partial<VelocityResponse>) =>
  ({ by_gender: [], prior_year_by_gender: [], ...over }) as VelocityResponse

describe('parseGenderBasis', () => {
  it('reads only "identity" as gender identity; anything else is the Gender field', () => {
    expect(GENDER_BASIS_PARAM).toBe('gender')
    expect(parseGenderBasis('identity')).toBe('identity')
    expect(parseGenderBasis(null)).toBe('field')
    expect(parseGenderBasis('field')).toBe('field')
    expect(parseGenderBasis('nonsense')).toBe('field')
  })
})

describe('velocityGenderSeries', () => {
  it('is Boys then Girls on the Gender field, keyed as before', () => {
    const series = velocityGenderSeries(
      response({ gender_basis: 'field', by_gender: [curve('M'), curve('F')] })
    )
    expect(series.map((s) => [s.key, s.gender, s.label, s.color, s.dashed])).toEqual([
      ['boys', 'M', 'Boys', GENDER_BOY_MAN, false],
      ['girls', 'F', 'Girls', GENDER_GIRL_WOMAN, false],
    ])
  })

  it('treats a response with no basis as the Gender field', () => {
    expect(velocityGenderSeries(response({ by_gender: [] })).map((s) => s.key)).toEqual([
      'boys',
      'girls',
    ])
  })

  it('is one line per identity group present (this year or the prior), in the fixed order', () => {
    const series = velocityGenderSeries(
      response({
        gender_basis: 'identity',
        by_gender: [curve('Another identity'), curve('Boy/man'), curve('Girl/woman')],
        prior_year_by_gender: [curve('No answer', 2025)],
      })
    )
    expect(series.map((s) => [s.key, s.label])).toEqual([
      ['girl_woman', 'Girl/woman'],
      ['boy_man', 'Boy/man'],
      ['another_identity', 'Another identity'],
      ['no_answer', 'No answer'],
    ])
    expect(series[2]).toMatchObject({ color: GENDER_ANOTHER_IDENTITY, dashed: true })
  })
})

describe('sessionGenderCount', () => {
  const row = {
    session_cm_id: 1,
    session_name: 'Session 2',
    boys_enrolled: 40,
    girls_enrolled: 50,
    by_identity: { 'Girl/woman': 48, 'Boy/man': 39, 'Non-binary': 3 },
  }
  it('reads boys and girls on the Gender field, and the group count on identity', () => {
    const [boys, girls] = velocityGenderSeries(response({ gender_basis: 'field' }))
    expect(sessionGenderCount(row, boys!)).toBe(40)
    expect(sessionGenderCount(row, girls!)).toBe(50)
    const identity = velocityGenderSeries(
      response({ gender_basis: 'identity', by_gender: [curve('Non-binary'), curve('No answer')] })
    )
    expect(identity.map((s) => sessionGenderCount(row, s))).toEqual([3, 0])
    expect(sessionGenderCount(undefined, identity[0]!)).toBeUndefined()
  })
})
