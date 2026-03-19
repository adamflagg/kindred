import { describe, it, expect } from 'vitest'
import {
  extractBunkIds,
  filterAgBunks,
  deduplicateBunksByName,
  mergeCampers,
  buildBunkRequestsFilter,
} from './useSessionData'

describe('extractBunkIds', () => {
  it('extracts unique bunk IDs, filtering nulls', () => {
    const plans = [{ bunk: 'b1' }, { bunk: 'b2' }, { bunk: 'b1' }, { bunk: null }, { bunk: 'b3' }]
    expect(extractBunkIds(plans)).toEqual(['b1', 'b2', 'b3'])
  })

  it('returns empty array when all nulls', () => {
    expect(extractBunkIds([{ bunk: null }, { bunk: null }])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(extractBunkIds([])).toEqual([])
  })
})

describe('filterAgBunks', () => {
  const bunks = [{ name: 'B-1' }, { name: 'G-2' }, { name: 'AG-8' }, { name: 'AG-10' }]

  it('returns only AG bunks when includeAg is true', () => {
    const result = filterAgBunks(bunks, true)
    expect(result.map((b) => b.name)).toEqual(['AG-8', 'AG-10'])
  })

  it('returns only non-AG bunks when includeAg is false', () => {
    const result = filterAgBunks(bunks, false)
    expect(result.map((b) => b.name)).toEqual(['B-1', 'G-2'])
  })
})

describe('deduplicateBunksByName', () => {
  it('keeps first occurrence when names collide', () => {
    const bunks = [
      { id: '1', name: 'AG-8' },
      { id: '2', name: 'AG-8' },
      { id: '3', name: 'AG-10' },
    ]
    const result = deduplicateBunksByName(bunks)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('1')
  })

  it('returns all when no duplicates', () => {
    const bunks = [
      { id: '1', name: 'B-1' },
      { id: '2', name: 'G-1' },
    ]
    expect(deduplicateBunksByName(bunks)).toHaveLength(2)
  })
})

describe('mergeCampers', () => {
  it('merges without duplicates by id', () => {
    const main = [
      { id: 'c1', name: 'Alice' },
      { id: 'c2', name: 'Bob' },
    ]
    const additional = [
      { id: 'c2', name: 'Bob' },
      { id: 'c3', name: 'Charlie' },
    ]
    const result = mergeCampers(main, additional)
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('returns main campers when additional is empty', () => {
    const main = [{ id: 'c1', name: 'Alice' }]
    expect(mergeCampers(main, [])).toEqual(main)
  })
})

describe('buildBunkRequestsFilter', () => {
  it('builds filter with pending status when includeAll is false', () => {
    const filter = buildBunkRequestsFilter(1000001, 2025, false)
    expect(filter).toBe('session_id = 1000001 && year = 2025 && status = "pending"')
  })

  it('builds filter without status when includeAll is true', () => {
    const filter = buildBunkRequestsFilter(1000001, 2025, true)
    expect(filter).toBe('session_id = 1000001 && year = 2025')
  })

  it('uses spaces around operators (PocketBase syntax requirement)', () => {
    const filter = buildBunkRequestsFilter(999, 2026, false)
    expect(filter).toMatch(/session_id = 999/)
    expect(filter).toMatch(/year = 2026/)
    expect(filter).not.toMatch(/session_id=|year=/)
  })
})
