/** To place's outside-grant lines: words and the bulk plan (§8.2; D126; S3-6; P-17). */
import { describe, expect, it } from 'vitest'

import { GRANTS } from './grantsFixtures'
import { grantLineCell, grantLineWords, grantPlan, planWords, singleSuggestion } from './needsModel'

const [GARCIA] = GRANTS.needs_camper

describe('needs a camper', () => {
  it('words the line', () => {
    expect(GARCIA && grantLineWords(GARCIA)).toBe(
      '$1,500 · Grantor B · posted to the household · Apr 3'
    )
  })

  it('leads the line cell with the date, then who, then the grantor (final UX ★14)', () => {
    expect(GARCIA && grantLineCell(GARCIA)).toBe('Apr 3 · to the household · Grantor B')
    expect(
      GARCIA && grantLineCell({ ...GARCIA, grant: { ...GARCIA.grant, recorded_on: '' } })
    ).toBe('to the household · Grantor B')
  })

  it('takes a suggestion that is the household’s one candidate as single, exact (P-17)', () => {
    if (GARCIA === undefined) throw new Error('fixture')
    expect(singleSuggestion(GARCIA)).toBe(true)
    expect(
      singleSuggestion({
        ...GARCIA,
        candidates: [...GARCIA.candidates, { person_cm_id: 2000009, name: 'Ava Garcia' }],
      })
    ).toBe(false)
    expect(singleSuggestion({ ...GARCIA, suggestion: null })).toBe(false)
  })
})

describe('grantPlan', () => {
  it('takes the single suggestions checked, and counts the checked lines the read no longer lists', () => {
    // 4000010: a line ticked at the click that someone else has placed since.
    const plan = grantPlan(GRANTS.needs_camper, new Set(['4000002', '4000010']), new Set())
    expect(plan.lines.map((l) => [l.need.grant.family_name, l.hidden])).toEqual([['Garcia', false]])
    expect(plan.leftOut).toEqual([])
    expect(plan.gone).toBe(1)
    expect(planWords(plan)).toBe('1 line in 1 household')
  })
})
