import { describe, it, expect } from 'vitest'
import { resolveEffectiveScope, shouldDegrade, genderBannerText } from './graphScope'
import type { BunkSummaryWithGender } from './genderFilter'

const ROSTER: BunkSummaryWithGender[] = [
  { cmId: 1, name: 'B-3', code: 'b-3' },
  { cmId: 2, name: 'G-3', code: 'g-3' },
  { cmId: 3, name: 'G-4', code: 'g-4' },
]

describe('resolveEffectiveScope', () => {
  it('all + no manual = inactive, empty scope', () => {
    const r = resolveEffectiveScope({
      gender: 'all',
      manualUnits: [],
      manualBunks: [],
      dropped: new Set(),
      roster: ROSTER,
    })
    expect(r).toEqual({ units: [], bunks: [], active: false })
  })

  it('all + manual bunks = active manual scope', () => {
    const r = resolveEffectiveScope({
      gender: 'all',
      manualUnits: ['Galil'],
      manualBunks: ['b-3'],
      dropped: new Set(),
      roster: ROSTER,
    })
    expect(r).toEqual({ units: ['Galil'], bunks: ['b-3'], active: true })
  })

  it('girls derives girl bunks from roster', () => {
    const r = resolveEffectiveScope({
      gender: 'girls',
      manualUnits: [],
      manualBunks: [],
      dropped: new Set(),
      roster: ROSTER,
    })
    expect(r.bunks).toEqual(['g-3', 'g-4'])
    expect(r.units).toEqual([])
    expect(r.active).toBe(true)
  })

  it('girls minus a dropped cabin', () => {
    const r = resolveEffectiveScope({
      gender: 'girls',
      manualUnits: [],
      manualBunks: [],
      dropped: new Set(['g-3']),
      roster: ROSTER,
    })
    expect(r.bunks).toEqual(['g-4'])
  })

  it('girls on a roster with no girls = active but empty (will degrade)', () => {
    const r = resolveEffectiveScope({
      gender: 'girls',
      manualUnits: [],
      manualBunks: [],
      dropped: new Set(),
      roster: [{ cmId: 1, name: 'B-3', code: 'b-3' }],
    })
    expect(r).toEqual({ units: [], bunks: [], active: true })
  })
})

describe('shouldDegrade', () => {
  it('true when active scope yields zero nodes, not loading, no error', () => {
    expect(
      shouldDegrade({ scopeActive: true, isLoading: false, hasError: false, nodeCount: 0 })
    ).toBe(true)
  })
  it('false while loading', () => {
    expect(
      shouldDegrade({ scopeActive: true, isLoading: true, hasError: false, nodeCount: 0 })
    ).toBe(false)
  })
  it('false on error', () => {
    expect(
      shouldDegrade({ scopeActive: true, isLoading: false, hasError: true, nodeCount: 0 })
    ).toBe(false)
  })
  it('false when scope inactive (genuinely empty session is not degradation)', () => {
    expect(
      shouldDegrade({ scopeActive: false, isLoading: false, hasError: false, nodeCount: 0 })
    ).toBe(false)
  })
  it('false when nodes exist', () => {
    expect(
      shouldDegrade({ scopeActive: true, isLoading: false, hasError: false, nodeCount: 5 })
    ).toBe(false)
  })
})

describe('genderBannerText', () => {
  it('per-scope copy', () => {
    expect(genderBannerText('boys')).toMatch(/boys/i)
    expect(genderBannerText('girls')).toMatch(/girls/i)
    expect(genderBannerText('ag')).toMatch(/AG/)
    expect(genderBannerText('all')).toBe('')
  })
})
