import { describe, it, expect } from 'vitest'
import { parseFilterFromSearchParams } from './graphFilter'

describe('parseFilterFromSearchParams', () => {
  it('returns empty filter when no params present', () => {
    const params = new URLSearchParams()
    expect(parseFilterFromSearchParams(params)).toEqual({
      units: [],
      bunks: [],
      edgeMode: 'strict',
    })
  })

  it('parses units from comma-separated slugs', () => {
    const params = new URLSearchParams('units=galil,eilat')
    const result = parseFilterFromSearchParams(params)
    expect(result.units).toEqual(['Galil', 'Eilat'])
    expect(result.bunks).toEqual([])
    expect(result.edgeMode).toBe('strict')
  })

  it('parses bunks as numeric cm_ids', () => {
    const params = new URLSearchParams('bunks=9,17')
    expect(parseFilterFromSearchParams(params).bunks).toEqual([9, 17])
  })

  it('parses edges=cross to edgeMode cross-scope', () => {
    const params = new URLSearchParams('edges=cross')
    expect(parseFilterFromSearchParams(params).edgeMode).toBe('cross-scope')
  })

  it('treats unknown unit slugs as drops, keeps the rest', () => {
    const params = new URLSearchParams('units=galil,nonexistent,eilat')
    expect(parseFilterFromSearchParams(params).units).toEqual(['Galil', 'Eilat'])
  })

  it('drops malformed bunk ids', () => {
    const params = new URLSearchParams('bunks=9,abc,17')
    expect(parseFilterFromSearchParams(params).bunks).toEqual([9, 17])
  })

  it('handles multi-word unit slugs (Chalutzim 1)', () => {
    const params = new URLSearchParams('units=chalutzim-1,chalutzim-2')
    expect(parseFilterFromSearchParams(params).units).toEqual(['Chalutzim 1', 'Chalutzim 2'])
  })
})
