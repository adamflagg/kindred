import { describe, expect, it } from 'vitest'

import {
  formatSort,
  groupRows,
  fold,
  matchedId,
  matchesSearch,
  nextSort,
  parseSort,
  sortRows,
  stepHighlight,
  type CellValue,
} from './table'

interface Row {
  id: string
  camper: string
  decided: CellValue
}

const ROWS: Row[] = [
  { id: 'a', camper: 'Olivia Chen', decided: 950 },
  { id: 'b', camper: 'Liam Garcia', decided: null },
  { id: 'c', camper: 'Emma Johnson', decided: 1800 },
  { id: 'd', camper: 'Samuel Johnson', decided: 950 },
]
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('sortRows (D18: every column sorts)', () => {
  it('sorts numbers numerically, stably, either way', () => {
    expect(ids(sortRows(ROWS, (r) => r.decided, 'asc'))).toEqual(['a', 'd', 'c', 'b'])
    expect(ids(sortRows(ROWS, (r) => r.decided, 'desc'))).toEqual(['c', 'a', 'd', 'b'])
  })

  it('keeps "nothing there" last whichever way you sort', () => {
    expect(ids(sortRows(ROWS, (r) => r.decided, 'desc')).at(-1)).toBe('b')
  })

  it('sorts names alphabetically, ignoring case', () => {
    expect(ids(sortRows(ROWS, (r) => r.camper, 'asc'))).toEqual(['c', 'b', 'a', 'd'])
  })
})

describe('the sort in the URL (D15)', () => {
  it('reads "key:dir", and refuses an unknown column', () => {
    expect(parseSort('decided:desc', ['decided'])).toEqual({ key: 'decided', dir: 'desc' })
    expect(parseSort('decided', ['decided'])).toEqual({ key: 'decided', dir: 'asc' })
    expect(parseSort('bogus:asc', ['decided'])).toBeNull()
    expect(parseSort(null, ['decided'])).toBeNull()
  })

  it('writes it back', () => {
    expect(formatSort({ key: 'decided', dir: 'desc' })).toBe('decided:desc')
  })

  it('goes ascending first, then descending, then ascending', () => {
    const first = nextSort(null, 'decided')
    expect(first).toEqual({ key: 'decided', dir: 'asc' })
    const second = nextSort(first, 'decided')
    expect(second).toEqual({ key: 'decided', dir: 'desc' })
    expect(nextSort(second, 'decided')).toEqual({ key: 'decided', dir: 'asc' })
    expect(nextSort(second, 'camper')).toEqual({ key: 'camper', dir: 'asc' })
  })
})

describe('matchesSearch (D18, D27: names and CampMinder ids)', () => {
  const fields = ['Johnson', 'Emma Johnson', 1000002]

  it('matches every term somewhere, ignoring case', () => {
    expect(matchesSearch(fields, 'emma john')).toBe(true)
    expect(matchesSearch(fields, 'emma garcia')).toBe(false)
  })

  it('matches an id', () => {
    expect(matchesSearch(fields, '1000002')).toBe(true)
  })

  it('matches everything on an empty query', () => {
    expect(matchesSearch(fields, '  ')).toBe(true)
  })
})

// Ruling 2026-10-01 (plan review): D27's matched-id chip is built, not dropped.
describe('fold and accent-insensitive search (I3)', () => {
  it('folds case and accents', () => {
    expect(fold('José')).toBe('jose')
    expect(fold('ÉLODIE Çelik')).toBe('elodie celik')
  })

  it('finds an accented name from the unaccented spelling, and the other way round', () => {
    expect(matchesSearch(['José Garcia', 1000002], 'jose')).toBe(true)
    expect(matchesSearch(['Jose Garcia', 1000002], 'josé')).toBe(true)
    expect(matchesSearch(['José Garcia'], 'jose chen')).toBe(false)
  })
})

describe('matchedId (D27: which id a search matched, for the chip under the name)', () => {
  it('names the id an all-digit term found', () => {
    expect(matchedId([1000001, 1000002], '1000002')).toBe(1000002)
    expect(matchedId([1000001, 1000002], 'emma 10000')).toBe(1000001)
  })

  it('is null when the search matched on a name, or there is none', () => {
    expect(matchedId([1000001], 'emma')).toBeNull()
    expect(matchedId([1000001], '')).toBeNull()
    expect(matchedId([1000001], '999')).toBeNull()
  })
})

describe('groupRows (by family, by reason; D23, D24)', () => {
  it('keeps the order each group first appears in', () => {
    const groups = groupRows(ROWS, (r) => {
      const family = r.camper.split(' ')[1] ?? ''
      return { id: family, heading: family }
    })
    expect(groups.map((g) => g.heading)).toEqual(['Chen', 'Garcia', 'Johnson'])
    expect(ids(groups[2]?.rows ?? [])).toEqual(['c', 'd'])
  })
})

describe('stepHighlight (up/down; D13, D31)', () => {
  const order = ['a', 'b', 'c']

  it('starts at the top going down and at the bottom going up', () => {
    expect(stepHighlight(order, null, 1)).toBe('a')
    expect(stepHighlight(order, null, -1)).toBe('c')
  })

  it('moves one row and holds at the ends', () => {
    expect(stepHighlight(order, 'a', 1)).toBe('b')
    expect(stepHighlight(order, 'c', 1)).toBe('c')
    expect(stepHighlight(order, 'a', -1)).toBe('a')
  })

  it('starts over when the highlighted row is gone (filtered out)', () => {
    expect(stepHighlight(order, 'z', 1)).toBe('a')
  })

  it('has nothing to highlight in an empty table', () => {
    expect(stepHighlight([], null, 1)).toBeNull()
  })
})
