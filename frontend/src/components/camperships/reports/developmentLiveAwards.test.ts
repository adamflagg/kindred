import { describe, expect, it } from 'vitest'

import type { ApiAidDevelopment } from '../../../types/api-types'
import { liveAwards, liveColumnIndex } from './developmentModel'

const dev = (over: Partial<ApiAidDevelopment> = {}): ApiAidDevelopment =>
  ({
    year: 2027,
    figures_on: '2027-04-10',
    groups: [],
    not_built: [],
    sources: [],
    columns: [
      { season: 2026, basis: 'r', as_of: null, label: '2026' },
      { season: 2027, basis: 'P', as_of: '2027-03-01', label: '2027 (dated)' },
      { season: 2027, basis: 'P', as_of: '2027-04-10', label: '2027' },
    ],
    rows: [
      { key: 'awards', group: 'camp_quest', values: [100, 90, 80] },
      { key: 'awards', group: null, values: [480, 400, 521] },
    ],
    ...over,
  }) as unknown as ApiAidDevelopment

describe('the live column of the Development read', () => {
  it('finds the dashboard column of the read season as of the figures day, not a dated one', () => {
    expect(liveColumnIndex(dev())).toBe(2)
  })
  it("reads the total Grants/Awards row's live figure, not a group's", () => {
    expect(liveAwards(dev())).toBe(521)
  })
  it('is null when there is no live column or the figure is not built', () => {
    expect(liveAwards(dev({ columns: [] }))).toBeNull()
    expect(
      liveAwards(dev({ rows: [{ key: 'awards', group: null, values: [1, 2, null] }] as never }))
    ).toBeNull()
  })
})
