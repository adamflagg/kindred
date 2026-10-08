/** ZIP codes' tables in words (spec §9.4; D90; owner ruling C). */
import { describe, expect, it } from 'vitest'

import { headingLines, reportText } from '../kit/report'
import { ZIP } from './zipFixtures'
import { zipColumns, zipCsvName, zipGroups, zipHeading, zipRows, zipScopeWords } from './zipModel'

const texts = (row: { cells: ReadonlyArray<Parameters<typeof reportText>[0]> } | undefined) =>
  (row?.cells ?? []).map(reportText)

describe('ZIP codes', () => {
  it("keeps Outside the US and No ZIP on file last, and the server's total (D90)", () => {
    const rows = zipRows(ZIP.every_camper, false)
    expect(rows.map((r) => r.kind)).toEqual(['body', 'body', 'end', 'end', 'total'])
    expect(texts(rows[4])).toEqual(['All · 2 ZIPs', '16', '11'])
  })

  it('adds the dollars column to the aid table only', () => {
    expect(zipColumns(false, () => null).map((c) => c.header)).toEqual([
      'ZIP',
      'Campers',
      'Families',
    ])
    expect(texts(zipRows(ZIP.with_aid ?? ZIP.every_camper, true)[1])).toEqual([
      '00012',
      '3',
      '2',
      '$5,400',
    ])
  })

  it("offers exactly the read's groups, All last, never a list of its own (ruling C)", () => {
    expect(zipGroups(ZIP).map((g) => g.label)).toEqual(['Pool A', 'Pool B', 'All groups'])
    expect(zipGroups({ ...ZIP, groups: [] })).toEqual([])
  })

  it('names the group in the heading and the scope line, and leaves it out when the read has none (no rules)', () => {
    expect(zipHeading(ZIP, 'Every camper').title).toBe('Every camper · Pool A')
    expect(zipScopeWords(ZIP)).toBe(
      "Pool A: campers enrolled in an aid-eligible session, by their household's billing ZIP."
    )
    const noGroup = { ...ZIP, groups: [], group_label: '' }
    expect(zipHeading(noGroup, 'Every camper').title).toBe('Every camper')
    expect(zipScopeWords(noGroup)).toBe(
      "Campers enrolled in an aid-eligible session, by their household's billing ZIP."
    )
  })

  it('prints no internal id in the heading lines Copy and the CSV carry', () => {
    const lines = headingLines(zipHeading(ZIP, 'Every camper')).join('\n')
    expect(lines).not.toMatch(/\bD\d{2,3}\b|RPT-|O-930/)
    expect(lines).toContain('Basis: P (awarded = Posted) plus every outside grant: all money')
  })

  it('names the file with the group', () => {
    expect(zipCsvName({ year: 2027, asOf: { kind: 'live' } }, ZIP, 'with-aid')).toBe(
      'camperships-reports-zip-with-aid-pool-a-2027.csv'
    )
  })
})
