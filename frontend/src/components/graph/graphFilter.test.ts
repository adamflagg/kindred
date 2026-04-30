import { describe, it, expect } from 'vitest'
import { parseFilterFromSearchParams, serializeFilterToSearchParams } from './graphFilter'
import type { FilterState } from './graphFilter'

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

describe('serializeFilterToSearchParams', () => {
  it('omits all keys when filter is empty', () => {
    const base = new URLSearchParams('year=2026')
    const out = serializeFilterToSearchParams({ units: [], bunks: [], edgeMode: 'strict' }, base)
    expect(out.toString()).toBe('year=2026')
  })

  it('encodes units as lowercased slugs', () => {
    const out = serializeFilterToSearchParams(
      { units: ['Galil', 'Chalutzim 1'], bunks: [], edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(out.get('units')).toBe('galil,chalutzim-1')
  })

  it('encodes bunks as comma-separated cm_ids', () => {
    const out = serializeFilterToSearchParams(
      { units: [], bunks: [9, 17], edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(out.get('bunks')).toBe('9,17')
  })

  it('emits edges=cross only for cross-scope mode', () => {
    const a = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [], edgeMode: 'cross-scope' },
      new URLSearchParams()
    )
    expect(a.get('edges')).toBe('cross')
    const b = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [], edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(b.get('edges')).toBeNull()
  })

  it('preserves unrelated query params', () => {
    const base = new URLSearchParams('year=2026&scenario=abc')
    const out = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [9], edgeMode: 'cross-scope' },
      base
    )
    expect(out.get('year')).toBe('2026')
    expect(out.get('scenario')).toBe('abc')
  })

  it('round-trips with parseFilterFromSearchParams', () => {
    const original: FilterState = {
      units: ['Galil', 'Eilat'],
      bunks: [9],
      edgeMode: 'cross-scope',
    }
    const serialized = serializeFilterToSearchParams(original, new URLSearchParams())
    const parsed = parseFilterFromSearchParams(serialized)
    expect(parsed).toEqual(original)
  })
})
