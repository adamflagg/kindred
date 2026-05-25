import { describe, it, expect } from 'vitest'
import {
  bunkToCode,
  parseFilterFromSearchParams,
  serializeFilterToSearchParams,
  normalizeFilter,
  type BunkSummary,
} from './graphFilter'
import type { FilterState } from './graphFilter'

describe('gender dimension in URL', () => {
  it('defaults to "all" when no gender param present', () => {
    const f = parseFilterFromSearchParams(new URLSearchParams('units=galil'))
    expect(f.gender).toBe('all')
  })

  it('parses a valid gender value', () => {
    expect(parseFilterFromSearchParams(new URLSearchParams('gender=girls')).gender).toBe('girls')
    expect(parseFilterFromSearchParams(new URLSearchParams('gender=ag')).gender).toBe('ag')
  })

  it('falls back to "all" for an unknown gender value', () => {
    expect(parseFilterFromSearchParams(new URLSearchParams('gender=banana')).gender).toBe('all')
  })

  it('serializes a non-all gender, omits gender=all', () => {
    const base = new URLSearchParams()
    expect(
      serializeFilterToSearchParams(
        { units: [], bunks: [], gender: 'boys', edgeMode: 'strict' },
        base
      ).get('gender')
    ).toBe('boys')
    expect(
      serializeFilterToSearchParams(
        { units: [], bunks: [], gender: 'all', edgeMode: 'strict' },
        base
      ).has('gender')
    ).toBe(false)
  })
})

describe('bunkToCode', () => {
  it('lowercases the bunk name', () => {
    expect(bunkToCode('B-9')).toBe('b-9')
    expect(bunkToCode('AG-3')).toBe('ag-3')
    expect(bunkToCode('B-Aleph')).toBe('b-aleph')
  })

  it('preserves hyphens already in the name', () => {
    expect(bunkToCode('B-12A')).toBe('b-12a')
  })
})

describe('parseFilterFromSearchParams', () => {
  it('returns empty filter when no params present', () => {
    const params = new URLSearchParams()
    expect(parseFilterFromSearchParams(params)).toEqual({
      units: [],
      bunks: [],
      gender: 'all',
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

  it('parses bunks as lowercase codes', () => {
    const params = new URLSearchParams('bunks=b-9,g-10')
    expect(parseFilterFromSearchParams(params).bunks).toEqual(['b-9', 'g-10'])
  })

  it('parses edges=cross to edgeMode cross-scope', () => {
    const params = new URLSearchParams('edges=cross')
    expect(parseFilterFromSearchParams(params).edgeMode).toBe('cross-scope')
  })

  it('treats unknown unit slugs as drops, keeps the rest', () => {
    const params = new URLSearchParams('units=galil,nonexistent,eilat')
    expect(parseFilterFromSearchParams(params).units).toEqual(['Galil', 'Eilat'])
  })

  it('lowercases incoming bunk codes for consistent matching', () => {
    const params = new URLSearchParams('bunks=B-9,G-10')
    expect(parseFilterFromSearchParams(params).bunks).toEqual(['b-9', 'g-10'])
  })

  it('drops empty bunk segments', () => {
    const params = new URLSearchParams('bunks=b-9,,g-10')
    expect(parseFilterFromSearchParams(params).bunks).toEqual(['b-9', 'g-10'])
  })

  it('handles multi-word unit slugs (Chalutzim 1)', () => {
    const params = new URLSearchParams('units=chalutzim-1,chalutzim-2')
    expect(parseFilterFromSearchParams(params).units).toEqual(['Chalutzim 1', 'Chalutzim 2'])
  })
})

describe('serializeFilterToSearchParams', () => {
  it('omits all keys when filter is empty', () => {
    const base = new URLSearchParams('year=2026')
    const out = serializeFilterToSearchParams(
      { units: [], bunks: [], gender: 'all', edgeMode: 'strict' },
      base
    )
    expect(out.toString()).toBe('year=2026')
  })

  it('encodes units as lowercased slugs', () => {
    const out = serializeFilterToSearchParams(
      { units: ['Galil', 'Chalutzim 1'], bunks: [], gender: 'all', edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(out.get('units')).toBe('galil,chalutzim-1')
  })

  it('encodes bunks as comma-separated codes', () => {
    const out = serializeFilterToSearchParams(
      { units: [], bunks: ['b-9', 'g-10'], gender: 'all', edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(out.get('bunks')).toBe('b-9,g-10')
  })

  it('emits edges=cross only for cross-scope mode', () => {
    const a = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [], gender: 'all', edgeMode: 'cross-scope' },
      new URLSearchParams()
    )
    expect(a.get('edges')).toBe('cross')
    const b = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [], gender: 'all', edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(b.get('edges')).toBeNull()
  })

  it('preserves unrelated query params', () => {
    const base = new URLSearchParams('year=2026&scenario=abc')
    const out = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: ['b-9'], gender: 'all', edgeMode: 'cross-scope' },
      base
    )
    expect(out.get('year')).toBe('2026')
    expect(out.get('scenario')).toBe('abc')
  })

  it('round-trips with parseFilterFromSearchParams', () => {
    const original: FilterState = {
      units: ['Galil', 'Eilat'],
      bunks: ['b-9'],
      gender: 'girls',
      edgeMode: 'cross-scope',
    }
    const serialized = serializeFilterToSearchParams(original, new URLSearchParams())
    const parsed = parseFilterFromSearchParams(serialized)
    expect(parsed).toEqual(original)
  })
})

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' }, // Galil
  { cmId: 2, name: 'G-3' }, // Galil
  { cmId: 3, name: 'B-4' }, // Galil
  { cmId: 4, name: 'G-4' }, // Galil
  { cmId: 5, name: 'B-5' }, // Eilat
  { cmId: 6, name: 'G-5' }, // Eilat
  { cmId: 9, name: 'B-9' }, // Chalutzim 1
]

describe('normalizeFilter', () => {
  it('drops bunks already covered by an included unit', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: ['b-3', 'b-9'] }, ALL_BUNKS)
    expect(result.units).toEqual(['Galil'])
    expect(result.bunks).toEqual(['b-9'])
  })

  it('keeps bunks whose unit is not included', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: ['b-9'] }, ALL_BUNKS)
    expect(result.bunks).toEqual(['b-9'])
  })

  it("drops all of a unit's bunks when the unit is added", () => {
    const result = normalizeFilter(
      { units: ['Galil'], bunks: ['b-3', 'g-3', 'b-4', 'g-4', 'b-9'] },
      ALL_BUNKS
    )
    expect(result.bunks).toEqual(['b-9'])
  })

  it('is a no-op when filter is empty', () => {
    expect(normalizeFilter({ units: [], bunks: [] }, ALL_BUNKS)).toEqual({
      units: [],
      bunks: [],
    })
  })

  it('preserves unknown bunk codes (not in roster) as-is', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: ['q-99'] }, ALL_BUNKS)
    expect(result.bunks).toEqual(['q-99'])
  })

  it('matches bunk codes case-insensitively against roster names', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: ['B-3'] }, ALL_BUNKS)
    // Even though input is 'B-3' uppercase, it matches roster 'B-3' under unit Galil and is dropped
    expect(result.bunks).toEqual([])
  })
})
