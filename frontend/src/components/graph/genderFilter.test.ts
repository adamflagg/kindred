/**
 * Tests for gender/AG tab selector logic (Feature A — #1610 part 1).
 *
 * Verifies the pure derivation function `filterBunksByGender`:
 *   - "All" returns every bunk
 *   - "Boys" returns only B-* bunks
 *   - "Girls" returns only G-* bunks
 *   - "AG" returns only AG-* bunks
 *   - `hasAGBunks` is true iff the session roster contains ≥1 AG bunk
 */
import { describe, it, expect } from 'vitest'
import {
  filterBunksByGender,
  hasAGBunks,
  scopeToTab,
  tabToScope,
  type GenderTab,
  type GenderScope,
  type BunkSummaryWithGender,
} from './genderFilter'

const ROSTER: BunkSummaryWithGender[] = [
  { cmId: 1, name: 'B-3', code: 'b-3' },
  { cmId: 2, name: 'B-4', code: 'b-4' },
  { cmId: 3, name: 'G-3', code: 'g-3' },
  { cmId: 4, name: 'G-4', code: 'g-4' },
  { cmId: 5, name: 'AG-1', code: 'ag-1' },
  { cmId: 6, name: 'AG-2', code: 'ag-2' },
]

const NO_AG_ROSTER: BunkSummaryWithGender[] = [
  { cmId: 1, name: 'B-3', code: 'b-3' },
  { cmId: 2, name: 'G-3', code: 'g-3' },
]

describe('filterBunksByGender', () => {
  it('All tab returns codes for every bunk', () => {
    const codes = filterBunksByGender(ROSTER, 'All')
    expect(codes).toHaveLength(ROSTER.length)
    expect(codes).toContain('b-3')
    expect(codes).toContain('g-3')
    expect(codes).toContain('ag-1')
  })

  it('Boys tab returns only B-* bunk codes', () => {
    const codes = filterBunksByGender(ROSTER, 'Boys')
    expect(codes).toEqual(expect.arrayContaining(['b-3', 'b-4']))
    expect(codes).not.toContain('g-3')
    expect(codes).not.toContain('g-4')
    expect(codes).not.toContain('ag-1')
    expect(codes).toHaveLength(2)
  })

  it('Girls tab returns only G-* bunk codes', () => {
    const codes = filterBunksByGender(ROSTER, 'Girls')
    expect(codes).toEqual(expect.arrayContaining(['g-3', 'g-4']))
    expect(codes).not.toContain('b-3')
    expect(codes).not.toContain('b-4')
    expect(codes).not.toContain('ag-1')
    expect(codes).toHaveLength(2)
  })

  it('AG tab returns only AG-* bunk codes', () => {
    const codes = filterBunksByGender(ROSTER, 'AG')
    expect(codes).toEqual(expect.arrayContaining(['ag-1', 'ag-2']))
    expect(codes).not.toContain('b-3')
    expect(codes).not.toContain('g-3')
    expect(codes).toHaveLength(2)
  })

  it('Boys tab on a roster with no boys returns empty array', () => {
    const girlsOnly: BunkSummaryWithGender[] = [{ cmId: 1, name: 'G-3', code: 'g-3' }]
    expect(filterBunksByGender(girlsOnly, 'Boys')).toEqual([])
  })

  it('All tab on empty roster returns empty array', () => {
    expect(filterBunksByGender([], 'All')).toEqual([])
  })

  it('returns bunk codes in stable order matching the roster order', () => {
    // Confirms the function doesn't sort or shuffle — consumers rely on stable ordering.
    const codes = filterBunksByGender(ROSTER, 'Boys')
    expect(codes).toEqual(['b-3', 'b-4'])
  })
})

describe('hasAGBunks', () => {
  it('returns true when the roster contains at least one AG bunk', () => {
    expect(hasAGBunks(ROSTER)).toBe(true)
  })

  it('returns false when the roster has no AG bunks', () => {
    expect(hasAGBunks(NO_AG_ROSTER)).toBe(false)
  })

  it('returns false for an empty roster', () => {
    expect(hasAGBunks([])).toBe(false)
  })

  it('recognises AG names with a space (e.g. "AG 1")', () => {
    const mixed: BunkSummaryWithGender[] = [
      { cmId: 1, name: 'AG 1', code: 'ag-1' },
      { cmId: 2, name: 'B-3', code: 'b-3' },
    ]
    expect(hasAGBunks(mixed)).toBe(true)
  })
})

describe('GenderTab type', () => {
  it('accepts the four valid tab values', () => {
    const tabs: GenderTab[] = ['All', 'Boys', 'Girls', 'AG']
    expect(tabs).toHaveLength(4)
  })
})

describe('scopeToTab / tabToScope', () => {
  it('maps every scope to its display tab', () => {
    expect(scopeToTab('all')).toBe('All')
    expect(scopeToTab('boys')).toBe('Boys')
    expect(scopeToTab('girls')).toBe('Girls')
    expect(scopeToTab('ag')).toBe('AG')
  })

  it('maps every tab back to its url scope', () => {
    expect(tabToScope('All')).toBe('all')
    expect(tabToScope('Boys')).toBe('boys')
    expect(tabToScope('Girls')).toBe('girls')
    expect(tabToScope('AG')).toBe('ag')
  })

  it('round-trips scope → tab → scope', () => {
    const scopes: GenderScope[] = ['all', 'boys', 'girls', 'ag']
    for (const s of scopes) expect(tabToScope(scopeToTab(s))).toBe(s)
  })
})
