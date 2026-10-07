import { describe, expect, it } from 'vitest'

import { columnCount, flowColumns, MIN_COLUMN } from './programsCostsFlow'

const cells = (cols: ReturnType<typeof flowColumns>) =>
  cols.map((c) => c.map((x) => (x.continued ? `${String(x.index)}c` : String(x.index))))

describe('flowColumns (spec §5.2 F, the mock packCols / layoutFlows)', () => {
  it('cuts equal rows into balanced columns', () => {
    expect(cells(flowColumns([20, 20, 20, 20], new Set(), 2))).toEqual([
      ['0', '1'],
      ['2', '3'],
    ])
  })

  it('counts a wrapped two-line row double', () => {
    expect(cells(flowColumns([40, 20, 20], new Set(), 2))).toEqual([['0'], ['1', '2']])
  })

  it('never leaves a label alone at the foot of a column', () => {
    expect(cells(flowColumns([20, 20, 20, 20, 20], new Set([2]), 2))).toEqual([
      ['0', '1'],
      ['2', '3', '4'],
    ])
  })

  it('repeats a label as "continued" atop a column that carries its run on', () => {
    expect(cells(flowColumns([20, 20, 20, 20, 20], new Set([0]), 2))).toEqual([
      ['0', '1', '2'],
      ['0c', '3', '4'],
    ])
  })

  it('uses fewer columns when the rows fit', () => {
    expect(flowColumns([20], new Set(), 4)).toHaveLength(1)
    expect(flowColumns([], new Set(), 4)).toEqual([])
  })

  it('puts unmeasured rows (all zero, as jsdom draws them) in one column', () => {
    expect(cells(flowColumns([0, 0, 0], new Set([0]), 3))).toEqual([['0', '1', '2']])
  })

  it('sizes the columns: 4 at 1440 read-only, 3 at 1100, fewer when editing', () => {
    expect(columnCount(1316, MIN_COLUMN.read)).toBe(4)
    expect(columnCount(1316, MIN_COLUMN.editPerPerson)).toBe(3)
    expect(columnCount(976, MIN_COLUMN.read)).toBe(3)
    expect(columnCount(976, MIN_COLUMN.editPerPerson)).toBe(2)
    expect(columnCount(200, MIN_COLUMN.read)).toBe(1)
  })

  it('counts the gap between columns: 1000px fits two 330px columns, not three', () => {
    expect(columnCount(1000, 330)).toBe(2)
  })
})
