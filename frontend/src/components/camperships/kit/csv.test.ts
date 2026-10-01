import { describe, expect, it } from 'vitest'

import { aidCsvFilename, csvCell, withLinkLine } from './csv'

describe('aidCsvFilename (D70; Decision 7, RULED 2026-10-01)', () => {
  it('follows camperships-<surface>-<view>[-<filters>]-<season>[-as-of-<date>]', () => {
    expect(
      aidCsvFilename({
        surface: 'requests',
        view: 'holds',
        filters: ['Pool A'],
        season: 2027,
        asOf: '2027-04-10',
      })
    ).toBe('camperships-requests-holds-pool-a-2027-as-of-2027-04-10.csv')
  })

  it('leaves out what a view does not have', () => {
    expect(aidCsvFilename({ surface: 'money', season: 2027 })).toBe('camperships-money-2027.csv')
  })
})

describe('csvCell (§11)', () => {
  it('writes numbers plain and signed, and nothing there as empty', () => {
    expect(csvCell(-1200)).toBe('-1200')
    expect(csvCell(2399.72)).toBe('2399.72')
    expect(csvCell(null)).toBe('')
    expect(csvCell('Emma Johnson')).toBe('Emma Johnson')
  })
})

describe('withLinkLine (D15: the file records the view it came from, at the end)', () => {
  it('adds a blank line and the link after the rows', () => {
    expect(withLinkLine([['a']], 'http://localhost/aid/requests?view=holds')).toEqual([
      ['a'],
      [],
      ['Link', 'http://localhost/aid/requests?view=holds'],
    ])
  })
})
